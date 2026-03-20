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
 * Reflection Agent — runs AFTER the main agents (bug, security, performance).
 *
 * Two jobs:
 * 1. VALIDATE: Re-investigate each finding to confirm it's real (remove hallucinations)
 * 2. DISCOVER: Look for issues the other agents missed
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
                'Senior code review agent that validates findings from other agents ' +
                'and searches for missed issues. Investigates each finding to confirm ' +
                'it is real, removes false positives, and discovers new issues.',
            goal: 'Validate every finding by re-reading the actual code. Remove anything ' +
                'that is not a real bug. Then look for issues the other agents missed.',
            expertise: [
                'Finding validation and verification',
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
        return `## Focus: Validate Findings & Discover Missed Issues

You are reviewing the work of other code review agents. Your job is two-fold:

### Part 1: VALIDATE existing findings
For each finding listed below, use tools (readFile, grep) to:
1. Read the actual code at the reported location
2. Verify the issue is REAL — does the bug actually exist in the code?
3. Mark findings as CONFIRMED or REJECTED with evidence

Common false positives to watch for:
- Issues in stub/mock/test code that won't run in production
- Theoretical issues that can't actually happen given the control flow
- Issues that are already handled elsewhere in the codebase
- Speculative concerns without concrete evidence

### Part 2: DISCOVER missed issues
After validating, scan the diffs for issues the other agents might have missed:
- Interactions between changes that no single agent would catch
- Subtle logic errors visible only when reading multiple changed files together
- Edge cases at the boundaries between changed and unchanged code

### What to report:
- For VALIDATED findings: include them in your response with the original details
- For REJECTED findings: do NOT include them
- For NEW findings: include them with evidence from your investigation

### Skip:
- Do not re-report Kody Rules findings (those are always valid)
- Do not add style/naming suggestions
- Focus only on correctness, security, and real performance issues`;
    }

    /**
     * Override to accept previous findings and include them in the prompt.
     */
    async executeReflection(
        input: ReviewAgentInput,
        previousFindings: Partial<CodeSuggestion>[],
    ): Promise<ReviewAgentOutput> {
        if (previousFindings.length === 0) {
            return {
                suggestions: [],
                agentName: this.getIdentity().name,
                turnsUsed: 0,
                durationMs: 0,
            };
        }

        // Store findings for injection into user prompt
        this.pendingFindings = previousFindings;

        // Use higher step limit for thorough investigation
        const modifiedInput: ReviewAgentInput = {
            ...input,
            // Override generation main to emphasize validation
            generationMain: [
                input.generationMain || '',
                'You are validating findings from other agents. Be critical — remove anything that is not a confirmed bug.',
            ].filter(Boolean).join('\n'),
        };

        return super.execute(modifiedInput);
    }

    private pendingFindings: Partial<CodeSuggestion>[] = [];

    /**
     * Override user prompt to include previous findings for validation.
     */
    protected buildUserPrompt(input: ReviewAgentInput): string {
        const diffsSection = input.changedFiles
            ?.map((file) => {
                const diff = (file as any).patchWithLinesStr ?? (file as any).patch ?? '';
                return `### ${file.filename}\n\`\`\`diff\n${diff}\n\`\`\``;
            })
            .join('\n\n') || 'No changed files provided.';

        const prContextSection = input.prTitle
            ? `\n  <PRContext>Title: ${input.prTitle}${input.prBody ? '\n' + input.prBody.substring(0, 500) : ''}</PRContext>`
            : '';

        const findingsSection = this.pendingFindings
            .map(
                (s, i) =>
                    `[${i}] [${s.label}] ${s.relevantFile}:${s.relevantLinesStart}-${s.relevantLinesEnd}
  Summary: ${s.oneSentenceSummary || s.suggestionContent?.substring(0, 200)}
  Existing code: ${s.existingCode?.substring(0, 150) || 'N/A'}
  Suggested fix: ${s.improvedCode?.substring(0, 150) || 'N/A'}`,
            )
            .join('\n\n');

        return `<ReviewTask>${prContextSection}
  <Diffs>
${diffsSection}
  </Diffs>

  <FindingsToValidate>
The following ${this.pendingFindings.length} findings were reported by other agents. Validate each one by re-reading the code.

${findingsSection}
  </FindingsToValidate>

  <OutputFormat>
After investigating with tools, respond with ONLY a JSON block containing:
1. CONFIRMED findings (validated as real issues) — keep the original details
2. NEW findings you discovered that the other agents missed
Do NOT include rejected/false positive findings.

\`\`\`json
{
  "reasoning": "Summary of what you validated and what you found",
  "validationResults": [
    {"index": 0, "status": "confirmed", "reason": "Verified: code does X"},
    {"index": 1, "status": "rejected", "reason": "False positive: code handles this at line Y"}
  ],
  "suggestions": [
    {
      "relevantFile": "path/to/file.ts",
      "language": "typescript",
      "suggestionContent": "Description of confirmed or new issue",
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

Important: The "suggestions" array should contain ONLY confirmed findings and new discoveries. Rejected findings should NOT appear in suggestions.
  </OutputFormat>

  <Rules>
    <Rule>Use readFile to re-read the actual code for each finding before confirming or rejecting.</Rule>
    <Rule>A finding is CONFIRMED if the issue genuinely exists in the code.</Rule>
    <Rule>A finding is REJECTED if it's a false positive, already handled, or can't actually happen.</Rule>
    <Rule>After validation, search for issues the other agents missed.</Rule>
    <Rule>Be critical but fair — don't reject findings just because they're edge cases. If an edge case can happen, it's real.</Rule>
  </Rules>
</ReviewTask>`;
    }
}
