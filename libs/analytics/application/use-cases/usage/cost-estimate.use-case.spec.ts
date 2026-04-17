import { CostEstimateUseCase } from './cost-estimate.use-case';

type UsageRow = {
    input: number;
    output: number;
    outputReasoning: number;
};

const INPUT_PER_MILLION = 1.25;
const OUTPUT_PER_MILLION = 10.0;

describe('CostEstimateUseCase', () => {
    let useCase: CostEstimateUseCase;
    let tokenUsageService: { getUsageByPr: jest.Mock };
    let pullRequestsService: { findOne: jest.Mock };

    beforeEach(() => {
        tokenUsageService = { getUsageByPr: jest.fn() };
        pullRequestsService = { findOne: jest.fn() };
        useCase = new CostEstimateUseCase(
            tokenUsageService as any,
            pullRequestsService as any,
        );
    });

    describe('aggregateTokenUsage (private)', () => {
        const aggregate = (rows: UsageRow[]) =>
            (useCase as any).aggregateTokenUsage(rows);

        const cases: Array<{
            name: string;
            rows: UsageRow[];
            expected: {
                inputTokens: number;
                outputTokens: number;
                reasoningTokens: number;
                totalTokens: number;
                cacheReadTokens: number;
                cacheWriteTokens: number;
            };
        }> = [
            {
                name: 'empty input',
                rows: [],
                expected: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    totalTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            },
            {
                name: 'single row with reasoning',
                rows: [{ input: 100, output: 50, outputReasoning: 30 }],
                expected: {
                    inputTokens: 100,
                    outputTokens: 50,
                    reasoningTokens: 30,
                    // totalTokens MUST NOT include reasoning — output already does (Vercel SDK convention)
                    totalTokens: 150,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            },
            {
                name: 'single row with zero reasoning',
                rows: [{ input: 1_000, output: 500, outputReasoning: 0 }],
                expected: {
                    inputTokens: 1_000,
                    outputTokens: 500,
                    reasoningTokens: 0,
                    totalTokens: 1_500,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            },
            {
                name: 'multiple rows summed correctly',
                rows: [
                    { input: 100, output: 50, outputReasoning: 30 },
                    { input: 200, output: 80, outputReasoning: 40 },
                    { input: 50, output: 20, outputReasoning: 10 },
                ],
                expected: {
                    inputTokens: 350,
                    outputTokens: 150,
                    reasoningTokens: 80,
                    totalTokens: 500,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            },
            {
                name: 'large numbers (no overflow, no double-count)',
                rows: [
                    {
                        input: 5_000_000,
                        output: 2_000_000,
                        outputReasoning: 1_500_000,
                    },
                ],
                expected: {
                    inputTokens: 5_000_000,
                    outputTokens: 2_000_000,
                    reasoningTokens: 1_500_000,
                    totalTokens: 7_000_000,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            },
        ];

        it.each(cases)('$name', ({ rows, expected }) => {
            expect(aggregate(rows)).toEqual(expected);
        });

        it('does not double-count reasoning tokens in totalTokens', () => {
            // Regression guard: the bug was totalTokens = input + output + reasoning.
            // outputTokens already includes reasoning, so total must be input + output only.
            const result = aggregate([
                { input: 1000, output: 800, outputReasoning: 500 },
            ]);
            expect(result.totalTokens).toBe(1800);
            expect(result.totalTokens).not.toBe(2300); // would be the bug
        });
    });

    describe('execute (end-to-end cost math)', () => {
        const buildUsage = (rows: UsageRow[]) =>
            rows.map((r, i) => ({
                ...r,
                total: r.input + r.output,
                model: 'gemini-3.1-pro',
                prNumber: i + 1,
            }));

        beforeEach(() => {
            pullRequestsService.findOne.mockResolvedValue({
                user: { username: 'alice' },
            });
        });

        it('returns zero cost and 1 developer when there is no usage', async () => {
            tokenUsageService.getUsageByPr.mockResolvedValue([]);

            const result = await useCase.execute('org-1');

            expect(result.tokenUsage).toEqual({
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                totalTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });
            expect(result.estimatedMonthlyCost).toBe(0);
            expect(result.costPerDeveloper).toBe(0);
            expect(result.developerCount).toBe(1); // floor of 1 even when no devs
            expect(result.periodDays).toBe(14);
            expect(result.projectionDays).toBe(30);
        });

        it('aggregates usage and projects monthly cost without double-counting reasoning', async () => {
            // 1M input + 500K output across 2 PRs by 2 distinct devs.
            // Reasoning = 200K (already inside output, must NOT inflate total).
            tokenUsageService.getUsageByPr.mockResolvedValue(
                buildUsage([
                    { input: 600_000, output: 300_000, outputReasoning: 120_000 },
                    { input: 400_000, output: 200_000, outputReasoning: 80_000 },
                ]),
            );
            pullRequestsService.findOne
                .mockResolvedValueOnce({ user: { username: 'alice' } })
                .mockResolvedValueOnce({ user: { username: 'bob' } });

            const result = await useCase.execute('org-1');

            expect(result.tokenUsage).toEqual({
                inputTokens: 1_000_000,
                outputTokens: 500_000,
                reasoningTokens: 200_000,
                totalTokens: 1_500_000, // input + output ONLY
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });

            // Cost over 14 days
            const inputCost = (1_000_000 / 1_000_000) * INPUT_PER_MILLION; // 1.25
            const outputCost = (500_000 / 1_000_000) * OUTPUT_PER_MILLION; // 5.0
            const cost14 = inputCost + outputCost; // 6.25
            const monthly = cost14 * (30 / 14); // ~13.39

            expect(result.estimatedMonthlyCost).toBe(
                Math.round(monthly * 100) / 100,
            );
            expect(result.developerCount).toBe(2);
            expect(result.costPerDeveloper).toBe(
                Math.round((monthly / 2) * 100) / 100,
            );
        });

        it('counts unique developers only once per username', async () => {
            tokenUsageService.getUsageByPr.mockResolvedValue(
                buildUsage([
                    { input: 100, output: 50, outputReasoning: 0 },
                    { input: 100, output: 50, outputReasoning: 0 },
                    { input: 100, output: 50, outputReasoning: 0 },
                ]),
            );
            pullRequestsService.findOne
                .mockResolvedValueOnce({ user: { username: 'alice' } })
                .mockResolvedValueOnce({ user: { username: 'alice' } })
                .mockResolvedValueOnce({ user: { username: 'bob' } });

            const result = await useCase.execute('org-1');

            expect(result.developerCount).toBe(2);
        });

        it('falls back to developerCount=1 when no developers are resolved', async () => {
            tokenUsageService.getUsageByPr.mockResolvedValue(
                buildUsage([{ input: 1000, output: 500, outputReasoning: 0 }]),
            );
            pullRequestsService.findOne.mockResolvedValue(null);

            const result = await useCase.execute('org-1');

            expect(result.developerCount).toBe(1);
            expect(result.costPerDeveloper).toBe(result.estimatedMonthlyCost);
        });

        it('passes byok=false and a 14-day window to the token-usage service', async () => {
            tokenUsageService.getUsageByPr.mockResolvedValue([]);

            await useCase.execute('org-1');

            expect(tokenUsageService.getUsageByPr).toHaveBeenCalledTimes(1);
            const [call] = tokenUsageService.getUsageByPr.mock.calls[0];
            expect(call.organizationId).toBe('org-1');
            expect(call.byok).toBe(false);
            const diffMs = call.end.getTime() - call.start.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            // 14 days minus a few seconds (end is 23:59:59.999 of today, start is 00:00:00 14 days ago)
            expect(diffDays).toBeGreaterThan(14);
            expect(diffDays).toBeLessThan(15);
        });
    });
});
