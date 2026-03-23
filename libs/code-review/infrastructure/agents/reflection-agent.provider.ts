import { Injectable } from '@nestjs/common';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    BaseCodeReviewAgentProvider,
    ReviewAgentIdentity,
    ReviewAgentInput,
    ReviewAgentOutput,
} from './base-code-review-agent.provider';
import { CodeSuggestion } from '@libs/core/infrastructure/config/types/general/codeReview.type';

/**
 * Verify result for a single finding.
 */
export interface VerifyResult {
    status: 'confirmed' | 'rejected';
    reason: string;
    /** The original finding, returned only when confirmed (may be enriched). */
    suggestion?: Partial<CodeSuggestion>;
    turnsUsed: number;
    durationMs: number;
}

/**
 * Reflection Agent — runs AFTER the main agents (bug, security, performance).
 *
 * Sentry-inspired pattern with two separate phases:
 * 1. VERIFY: One call per finding (parallel). Deep-dives into a single hypothesis.
 * 2. DISCOVER: One call with the full diff. Finds issues nobody caught.
 *
 * Does NOT validate Kody Rules findings — those are rule-based and always correct.
 * Opt-in via `enableReflection: true` in config.
 */
@Injectable()
export class ReflectionAgentProvider extends BaseCodeReviewAgentProvider {
    constructor(
        promptRunnerService: PromptRunnerService,
        permissionValidationService: PermissionValidationService,
        observabilityService: ObservabilityService,
    ) {
        super(
            promptRunnerService,
            permissionValidationService,
            observabilityService,
        );
    }

    protected getIdentity(): ReviewAgentIdentity {
        return {
            name: 'kodus-reflection-review-agent',
            description:
                'Senior code review agent that verifies bug hypotheses from other agents ' +
                'and searches for missed issues. Deep-dives into each finding individually.',
            goal: 'Verify each bug hypothesis by re-reading the actual code. Remove anything ' +
                'that is not a real bug. Then look for issues the other agents missed.',
            expertise: [
                'Bug hypothesis verification',
                'False positive detection',
                'Cross-cutting concern analysis',
                'Missed issue discovery',
            ],
        };
    }

    protected getCategoryLabel(): string {
        return 'reflection';
    }

    protected getCategoryPrompt(): string {
        return this.activePrompt;
    }

    private activePrompt = '';

    // ─── VERIFY: one finding at a time ───────────────────────────────────

    /**
     * Verify a single finding. The agent deep-dives into ONE hypothesis,
     * reads the actual code, and confirms or rejects with evidence.
     */
    async verifySingle(
        input: ReviewAgentInput,
        finding: Partial<CodeSuggestion>,
        index: number,
    ): Promise<VerifyResult> {
        const startTime = Date.now();

        this.pendingFinding = finding;
        this.pendingFindingIndex = index;
        this.mode = 'verify';

        this.activePrompt = `## Focus: Verify a Single Bug Hypothesis

You are a senior verification agent. Another agent reported a potential bug.
Your ONLY job is to determine: **is this bug real or a false positive?**

### Mandatory investigation steps (do ALL of these before deciding):
1. **Read the code**: Use readFile to read the FULL file containing the reported issue, not just the diff snippet.
2. **Find callers**: Use grep to find every place that calls the reported function/method. How is it used? What values flow in?
3. **Check error handling**: Is this case handled by a try/catch, guard clause, middleware, or framework feature upstream?
4. **Trace the path**: Can a real user/request actually trigger this code path with the problematic values?

You MUST complete at least steps 1-3 before making your decision. Do NOT confirm after only reading the file — always check callers and error handling.

### Decision criteria:
- **CONFIRMED**: The issue genuinely exists AND can be triggered in practice. You verified callers confirm it's reachable.
- **REJECTED**: You have CONCRETE proof it's wrong — the issue is handled elsewhere, the function is never called with those values, or the framework prevents it.
- **When in doubt after thorough investigation, CONFIRM.**

### Skip:
- Do not look for other bugs — focus ONLY on this one finding
- Do not add style/naming suggestions`;

        const modifiedInput: ReviewAgentInput = {
            ...input,
            generationMain: 'You are verifying a single bug hypothesis. Investigate thoroughly, then confirm or reject.',
        };

        try {
            const result = await super.execute(modifiedInput);
            const durationMs = Date.now() - startTime;

            const confirmed = result.suggestions.length > 0;

            return {
                status: confirmed ? 'confirmed' : 'rejected',
                reason: result.validationResults?.[0]?.reason || (confirmed ? 'Confirmed by investigation' : 'Rejected by investigation'),
                suggestion: confirmed ? result.suggestions[0] : undefined,
                turnsUsed: result.turnsUsed,
                durationMs,
            };
        } catch (error) {
            // On error, keep the finding (fail-safe)
            return {
                status: 'confirmed',
                reason: 'Verification failed — keeping finding as precaution',
                suggestion: finding,
                turnsUsed: 0,
                durationMs: Date.now() - startTime,
            };
        }
    }

    // ─── DISCOVER: find missed issues ────────────────────────────────────

    /**
     * Scan the full diff for issues that the main agents missed.
     * No previous findings are provided — clean slate.
     */
    async discover(
        input: ReviewAgentInput,
    ): Promise<ReviewAgentOutput> {
        this.mode = 'discover';
        this.pendingFinding = undefined;

        this.activePrompt = `## Focus: Discover Missed Issues

You are a senior code review agent. Other agents have already reviewed this PR,
but they may have missed subtle issues. Your job is to find what they didn't.

### What to look for:
- Interactions between changes across multiple files that no single agent would catch
- Subtle logic errors visible only when reading multiple changed files together
- Edge cases at the boundaries between changed and unchanged code
- Race conditions, state inconsistencies, or data flow bugs
- Issues that require understanding the full context of the change

### How to investigate:
1. Read the diffs to understand what changed
2. Use readFile/grep to understand the broader context
3. Trace data flow across changed files
4. Look for assumptions that might break

### What NOT to report:
- Style, naming, or formatting issues
- Issues that are obvious from the diff alone (other agents already caught those)
- Theoretical concerns without concrete evidence
- Anything that requires production data to verify

### Be selective:
Only report issues you have strong evidence for. Quality over quantity.
If you find nothing new, that's fine — respond with an empty suggestions array.`;

        const modifiedInput: ReviewAgentInput = {
            ...input,
            generationMain: 'Find issues that other agents missed. Only report findings with strong evidence.',
        };

        return super.execute(modifiedInput);
    }

    // ─── Internal state ──────────────────────────────────────────────────

    private mode: 'verify' | 'discover' = 'verify';
    private pendingFinding?: Partial<CodeSuggestion>;
    private pendingFindingIndex = 0;

    /**
     * Override user prompt based on current mode.
     */
    protected buildUserPrompt(input: ReviewAgentInput): string {
        if (this.mode === 'verify') {
            return this.buildVerifyPrompt(input);
        }
        return this.buildDiscoverPrompt(input);
    }

    private buildDiffsSection(input: ReviewAgentInput): string {
        return input.changedFiles
            ?.map((file) => {
                const diff = (file as any).patchWithLinesStr ?? (file as any).patch ?? '';
                return `### ${file.filename}\n\`\`\`diff\n${diff}\n\`\`\``;
            })
            .join('\n\n') || 'No changed files provided.';
    }

    private buildPrContext(input: ReviewAgentInput): string {
        return input.prTitle
            ? `\n  <PRContext>Title: ${input.prTitle}${input.prBody ? '\n' + input.prBody.substring(0, 500) : ''}</PRContext>`
            : '';
    }

    // ─── Verify prompt (single finding) ──────────────────────────────────

    private buildVerifyPrompt(input: ReviewAgentInput): string {
        const f = this.pendingFinding!;
        const diffsSection = this.buildDiffsSection(input);
        const prContext = this.buildPrContext(input);

        return `<VerifyTask>${prContext}
  <Diffs>
${diffsSection}
  </Diffs>

  <FindingToVerify>
A code review agent reported the following potential bug. Investigate whether it's real.

[${f.label}] ${f.relevantFile}:${f.relevantLinesStart}-${f.relevantLinesEnd}
Summary: ${f.oneSentenceSummary || f.suggestionContent?.substring(0, 300)}
Existing code: ${f.existingCode?.substring(0, 300) || 'N/A'}
Suggested fix: ${f.improvedCode?.substring(0, 300) || 'N/A'}
  </FindingToVerify>

  <OutputFormat>
After investigating with tools, respond with ONLY a JSON block:

\`\`\`json
{
  "reasoning": "What you investigated and what you found",
  "validationResults": [
    {"index": ${this.pendingFindingIndex}, "status": "confirmed|rejected", "reason": "Evidence for your decision"}
  ],
  "suggestions": [
    // Include the finding here ONLY if confirmed. Keep original details but you may improve the description.
    // If rejected, leave this array EMPTY.
    {
      "relevantFile": "path/to/file",
      "language": "...",
      "suggestionContent": "Description of the confirmed issue",
      "existingCode": "problematic code",
      "improvedCode": "fixed code",
      "oneSentenceSummary": "Brief summary",
      "relevantLinesStart": 10,
      "relevantLinesEnd": 15,
      "severity": "critical|high|medium|low"
    }
  ]
}
\`\`\`
  </OutputFormat>

  <Rules>
    <Rule>You MUST perform at least 3 tool calls before deciding: (1) readFile the full file, (2) grep for callers/usages, (3) readFile or grep to check error handling. Do NOT decide after just reading one file.</Rule>
    <Rule>In your "reasoning" field, explicitly state: what callers you found, whether error handling exists, and whether the code path is reachable in production.</Rule>
    <Rule>CONFIRMED = the bug genuinely exists AND is reachable. You verified callers and error handling.</Rule>
    <Rule>REJECTED = you have CONCRETE proof from your investigation. Not just "it seems unlikely."</Rule>
    <Rule>Focus ONLY on this one finding. Do not look for other bugs.</Rule>
  </Rules>
</VerifyTask>`;
    }

    // ─── Discover prompt (find missed issues) ────────────────────────────

    private buildDiscoverPrompt(input: ReviewAgentInput): string {
        const diffsSection = this.buildDiffsSection(input);
        const prContext = this.buildPrContext(input);

        return `<DiscoverTask>${prContext}
  <Diffs>
${diffsSection}
  </Diffs>

  <OutputFormat>
Investigate the changes using tools, then respond with ONLY a JSON block:

\`\`\`json
{
  "reasoning": "Summary of what you investigated and found",
  "suggestions": [
    {
      "relevantFile": "path/to/file",
      "language": "...",
      "suggestionContent": "Description of the issue you found",
      "existingCode": "problematic code",
      "improvedCode": "fixed code",
      "oneSentenceSummary": "Brief summary",
      "relevantLinesStart": 10,
      "relevantLinesEnd": 15,
      "severity": "critical|high|medium|low"
    }
  ]
}
\`\`\`

If you find nothing new, respond with \`{"reasoning": "...", "suggestions": []}\`.
  </OutputFormat>

  <Rules>
    <Rule>Use readFile and grep to investigate the code thoroughly before reporting.</Rule>
    <Rule>Only report issues with strong evidence — no speculative concerns.</Rule>
    <Rule>Focus on cross-file interactions, edge cases, and subtle logic errors.</Rule>
    <Rule>Do NOT report style, naming, or formatting issues.</Rule>
  </Rules>
</DiscoverTask>`;
    }
}
