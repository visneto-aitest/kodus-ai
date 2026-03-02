import { BusinessRulesValidationAgentProvider } from '@libs/agents/infrastructure/services/kodus-flow/business-rules-validation/businessRulesValidationAgent';

function createProvider(): BusinessRulesValidationAgentProvider {
    return new BusinessRulesValidationAgentProvider(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
}

describe('BusinessRulesValidationAgentProvider parser', () => {
    it('parses nested final_answer content from analyzer response', () => {
        const provider = createProvider();

        const payload = JSON.stringify({
            reasoning: 'Stopping due to limit/error.',
            action: {
                type: 'final_answer',
                content:
                    '```json\n{"needsMoreInfo":false,"summary":"## Business Rules Validation\\n\\nAll checks passed."}\n```',
            },
        });

        const parsed = (provider as any).parseValidationResult(payload);

        expect(parsed.needsMoreInfo).toBe(false);
        expect(parsed.summary).toContain('Business Rules Validation');
    });

    it('accepts direct markdown validation summary when structured JSON is missing', () => {
        const provider = createProvider();

        const payload = `## Business Rules Validation

**Status:** Compliant
**Analysis Confidence:** high

---
*Analysis performed by Kodus AI Business Rules Validator*`;

        const parsed = (provider as any).parseValidationResult(payload);

        expect(parsed.needsMoreInfo).toBe(false);
        expect(parsed.summary).toContain('Status');
    });
});

describe('BusinessRulesValidationAgentProvider.withTimeout', () => {
    it('resolves when promise completes before timeout', async () => {
        const provider = createProvider();
        const result = await (provider as any).withTimeout(
            Promise.resolve('ok'),
            5000,
            'test-resolve',
        );
        expect(result).toBe('ok');
    });

    it('rejects with timeout error when promise exceeds timeout', async () => {
        const provider = createProvider();
        let timeoutId: NodeJS.Timeout | undefined;
        const slow = new Promise((resolve) => {
            timeoutId = setTimeout(resolve, 10_000);
        });
        await expect(
            (provider as any).withTimeout(slow, 50, 'test-timeout'),
        ).rejects.toThrow('Timeout after 50ms in test-timeout');
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });

    it('clears the timer after resolution to avoid leaks', async () => {
        const provider = createProvider();
        const clearSpy = jest.spyOn(global, 'clearTimeout');
        await (provider as any).withTimeout(
            Promise.resolve('done'),
            5000,
            'test-clear',
        );
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });
});

describe('BusinessRulesValidationAgentProvider.isParserFallback', () => {
    it('returns true when needsMoreInfo is true and missingInfo contains parser error', () => {
        const provider = createProvider();
        const result = (provider as any).isParserFallback({
            needsMoreInfo: true,
            missingInfo: 'Error parsing validation result from LLM',
            summary: '',
        });
        expect(result).toBe(true);
    });

    it('returns false when needsMoreInfo is false', () => {
        const provider = createProvider();
        const result = (provider as any).isParserFallback({
            needsMoreInfo: false,
            missingInfo: 'error parsing validation result',
            summary: 'ok',
        });
        expect(result).toBe(false);
    });

    it('returns false when missingInfo does not contain parser error message', () => {
        const provider = createProvider();
        const result = (provider as any).isParserFallback({
            needsMoreInfo: true,
            missingInfo: 'Missing acceptance criteria',
            summary: '',
        });
        expect(result).toBe(false);
    });

    it('returns false when missingInfo is undefined', () => {
        const provider = createProvider();
        const result = (provider as any).isParserFallback({
            needsMoreInfo: true,
            summary: '',
        });
        expect(result).toBe(false);
    });
});
