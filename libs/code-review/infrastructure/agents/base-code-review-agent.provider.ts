import { createLogger } from '@kodus/flow';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { Injectable } from '@nestjs/common';

import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import {
    CodeReviewConfig,
    CodeSuggestion,
    FileChange,
} from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { RemoteCommands } from '@libs/code-review/infrastructure/adapters/services/collectCrossFileContexts.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { IKodyRule } from '@libs/kodyRules/domain/interfaces/kodyRules.interface';
import { byokToVercelModel, getModelName } from './llm/byok-to-vercel';
import { runAgentLoop } from './llm/agent-loop';
import { DocumentationSearchAdapter } from './llm/agent-tools.factory';

/**
 * Category-specific agent configuration provided by each concrete subclass.
 */
export interface ReviewAgentIdentity {
    name: string;
    description: string;
    goal: string;
    expertise: string[];
}

/**
 * Input passed to the agent for a single review execution.
 */
/**
 * Progress event emitted by agents during investigation.
 */
export interface AgentProgressEvent {
    agentName: string;
    status: 'started' | 'investigating' | 'completed' | 'error';
    step?: number;
    toolCalls?: Array<{ tool: string; args: string; durationMs?: number }>;
    findings?: number;
    durationMs?: number;
    totalTokens?: number;
    /** How the agent finished — helps surface timeouts and max-steps in the UI */
    finishReason?: 'stop' | 'timeout' | 'max-steps' | 'error';
    /** How findings were obtained — 'json-parse' (normal), 'second-chance', 'generate-object' (fallback LLM), 'empty' */
    source?: string;
}

export interface ReviewAgentInput {
    organizationAndTeamData: OrganizationAndTeamData;
    changedFiles: FileChange[];
    remoteCommands: RemoteCommands;
    prNumber: number;
    repositoryId?: string;
    repositoryFullName: string;
    languageResultPrompt: string;
    memoryRules?: Partial<IKodyRule>[];
    v2PromptOverrides?: CodeReviewConfig['v2PromptOverrides'];
    generationMain?: string;
    documentationSearchService?: DocumentationSearchAdapter;
    prTitle?: string;
    prBody?: string;
    onAgentProgress?: (event: AgentProgressEvent) => void;
    gitHubToken?: string;
    /** Base branch of the PR (e.g. "main"). Passed to tools for git diff. */
    baseBranch?: string;
}

/**
 * Output from a single agent execution.
 */
export interface ReviewAgentOutput {
    suggestions: Partial<CodeSuggestion>[];
    agentName: string;
    turnsUsed: number;
    durationMs: number;
}

/**
 * Abstract base class for code review agents (Bugs, Security, Performance).
 *
 * Uses Vercel AI SDK with native function calling instead of text-based ReAct.
 * This works with any model (BYOK) because the SDK translates tool definitions
 * to each provider's native format (OpenAI function_call, Anthropic tool_use,
 * Gemini function_calling, OpenRouter, etc.).
 *
 * Subclasses only define:
 * - identity (name, description, goal, expertise)
 * - category-specific system prompt
 * - category label
 */
@Injectable()
export abstract class BaseCodeReviewAgentProvider {
    private readonly agentLogger = createLogger('CodeReviewAgent');

    constructor(
        protected readonly promptRunnerService: PromptRunnerService,
        protected readonly permissionValidationService: PermissionValidationService,
        protected readonly observabilityService: ObservabilityService,
    ) {}

    protected abstract getIdentity(): ReviewAgentIdentity;
    protected abstract getCategoryPrompt(): string;
    protected abstract getCategoryLabel(): string;

    /**
     * Execute the agent against the provided changed files.
     */
    async execute(input: ReviewAgentInput): Promise<ReviewAgentOutput> {
        const startTime = Date.now();
        const identity = this.getIdentity();

        this.agentLogger.log({
            message: `[AGENT] Starting ${identity.name} for PR#${input.prNumber}`,
            context: identity.name,
            metadata: {
                organizationId: input.organizationAndTeamData?.organizationId,
                teamId: input.organizationAndTeamData?.teamId,
                prNumber: input.prNumber,
                filesCount: input.changedFiles.length,
            },
        });

        // Resolve BYOK config - Scoped locally to prevent race conditions across parallel PR reviews
        const byokConfig = await this.permissionValidationService.getBYOKConfig(
            input.organizationAndTeamData,
        );

        // Create Vercel AI SDK model from BYOK config
        const model = byokToVercelModel(byokConfig);
        const modelName = getModelName(byokConfig);

        this.agentLogger.log({
            message: `[AGENT] ${identity.name} using model: ${modelName}`,
            context: identity.name,
        });

        const systemPrompt = this.buildSystemPrompt(input);
        const userPrompt = this.buildUserPrompt(input);

        this.agentLogger.log({
            message: `[AGENT] ${identity.name} prompt context: memoryRules=${input.memoryRules?.length ?? 0}, overrides=${!!input.v2PromptOverrides}, language=${input.languageResultPrompt || 'default'}`,
            context: identity.name,
        });

        // Emit progress: agent started
        input.onAgentProgress?.({
            agentName: identity.name,
            status: 'started',
        });

        try {
            // Accumulate tool calls for batch progress updates
            const recentToolCalls: AgentProgressEvent['toolCalls'] = [];
            let stepCount = 0;
            const PROGRESS_BATCH_SIZE = 5;

            const loopParams = {
                model,
                systemPrompt,
                userPrompt,
                agentName: identity.name,
                telemetryMetadata: {
                    organizationId:
                        input.organizationAndTeamData?.organizationId,
                    teamId: input.organizationAndTeamData?.teamId,
                    pullRequestId: input.prNumber,
                    repositoryId: input.repositoryId,
                    provider: modelName,
                },
                remoteCommands: input.remoteCommands,
                documentationSearchService: input.documentationSearchService,
                documentationSearchOptions: {
                    organizationAndTeamData: input.organizationAndTeamData,
                    byokConfig: byokConfig,
                },
                byokConfig: byokConfig,
                gitHubToken: input.gitHubToken,
                changedFiles: input.changedFiles,
                prNumber: input.prNumber,
                repositoryFullName: input.repositoryFullName,
                baseBranch: input.baseBranch,

                onStepFinish: (step: any) => {
                    stepCount++;
                    if (step.toolCalls) {
                        for (const tc of step.toolCalls) {
                            this.agentLogger.log({
                                message: `[AGENT-TOOL] PR#${input.prNumber} ${identity.name} tool=${tc.toolName}`,
                                context: identity.name,
                            });
                            recentToolCalls.push({
                                tool: tc.toolName,
                                args: JSON.stringify(
                                    tc.args || tc.input || {},
                                ).substring(0, 100),
                            });
                        }
                    }
                    // Batch progress update every N steps
                    if (
                        stepCount % PROGRESS_BATCH_SIZE === 0 &&
                        recentToolCalls.length > 0
                    ) {
                        input.onAgentProgress?.({
                            agentName: identity.name,
                            status: 'investigating',
                            step: stepCount,
                            toolCalls: [...recentToolCalls],
                        });
                        recentToolCalls.length = 0; // Clear after sending
                    }
                },
            };

            let agentResult;
            if (process.env.LANGCHAIN_TRACING_V2 === 'true') {
                const { traceable } = require('langsmith/traceable');
                const tracedRun = traceable(runAgentLoop, {
                    name: identity.name,
                    metadata: {
                        organizationId:
                            input.organizationAndTeamData?.organizationId,
                        teamId: input.organizationAndTeamData?.teamId,
                        prNumber: input.prNumber,
                        pullRequestId: input.prNumber,
                    },
                });
                agentResult = await tracedRun(loopParams);
            } else {
                agentResult = await runAgentLoop(loopParams);
            }

            const durationMs = Date.now() - startTime;

            // Record token usage to observability (MongoDB spans)
            // Uses runInSpan to ensure proper span lifecycle and MongoDB persistence
            try {
                await this.observabilityService.runInSpan(
                    `${identity.name}::review`,
                    async () => agentResult,
                    {
                        'gen_ai.usage.input_tokens':
                            agentResult.usage.inputTokens,
                        'gen_ai.usage.output_tokens':
                            agentResult.usage.outputTokens,
                        'gen_ai.usage.total_tokens':
                            agentResult.usage.totalTokens,
                        ...(agentResult.usage.reasoningTokens > 0 && {
                            'gen_ai.usage.reasoning_tokens':
                                agentResult.usage.reasoningTokens,
                        }),
                        'gen_ai.response.model': modelName,
                        'gen_ai.run.name': `code-review-${this.getCategoryLabel()}`,
                        'type': byokConfig ? 'byok' : 'system',
                        'organizationId':
                            input.organizationAndTeamData?.organizationId,
                        'teamId': input.organizationAndTeamData?.teamId,
                        'prNumber': input.prNumber,
                        'steps': agentResult.steps,
                        'toolCalls': agentResult.toolCalls.length,
                        'finishReason': agentResult.finishReason,
                        'source': agentResult.source,
                        durationMs,
                    },
                );
            } catch {
                // Observability is best-effort
            }

            // Map findings to CodeSuggestion format
            const validFiles = new Set(
                input.changedFiles.map((f) => f.filename),
            );
            const isKodyRules = this.getCategoryLabel() === 'kody_rules';
            const rawSuggestions = (
                agentResult.findings?.suggestions || []
            ).filter(
                (s) =>
                    s.suggestionContent &&
                    // Kody Rules PR-level suggestions may not have a relevantFile
                    (isKodyRules
                        ? !s.relevantFile || validFiles.has(s.relevantFile)
                        : s.relevantFile && validFiles.has(s.relevantFile)),
            );

            const suggestions = rawSuggestions.map((s) => ({
                relevantFile: s.relevantFile,
                language: s.language || '',
                suggestionContent: s.suggestionContent,
                existingCode: s.existingCode || '',
                improvedCode: s.improvedCode || '',
                oneSentenceSummary: s.oneSentenceSummary || '',
                relevantLinesStart: s.relevantLinesStart,
                relevantLinesEnd: s.relevantLinesEnd,
                label: this.getCategoryLabel(),
                severity: s.severity || 'medium',
                level: s.level || 'issue', // Default to issue — if agent didn't classify, assume it's real
                llmPrompt: s.suggestionContent,
                ...(s.ruleUuid && { brokenKodyRulesIds: [s.ruleUuid] }),
            }));

            // Emit progress: agent completed
            // Only mark as error if the agent hit a hard limit (timeout or MAX_STEPS with tool-calls finish).
            // source=empty with finishReason=stop is legitimate (agent investigated and found nothing).
            const hitHardLimit =
                agentResult.finishReason === 'timeout' ||
                (agentResult.source === 'empty' &&
                    agentResult.finishReason === 'tool-calls');

            input.onAgentProgress?.({
                agentName: identity.name,
                status: hitHardLimit ? 'error' : 'completed',
                findings: suggestions.length,
                durationMs,
                totalTokens: agentResult.usage.totalTokens,
                step: agentResult.steps,
                finishReason:
                    agentResult.finishReason === 'timeout'
                        ? 'timeout'
                        : hitHardLimit
                          ? 'max-steps'
                          : 'stop',
                source: agentResult.source,
                toolCalls: agentResult.toolCalls.map((tc) => ({
                    tool: tc.toolName || tc.tool,
                    args: JSON.stringify(tc.args).substring(0, 100),
                })),
            });

            this.agentLogger.log({
                message: `[AGENT] ${identity.name} completed for PR#${input.prNumber}: ${suggestions.length} suggestions in ${durationMs}ms (source=${agentResult.source}, steps=${agentResult.steps}, tools=${agentResult.toolCalls.length}, input=${agentResult.usage.inputTokens}, output=${agentResult.usage.outputTokens}, total=${agentResult.usage.totalTokens})`,
                context: identity.name,
                metadata: {
                    organizationId:
                        input.organizationAndTeamData?.organizationId,
                    prNumber: input.prNumber,
                    suggestionsCount: suggestions.length,
                    durationMs,
                    source: agentResult.source,
                    steps: agentResult.steps,
                    toolCalls: agentResult.toolCalls.length,
                    inputTokens: agentResult.usage.inputTokens,
                    outputTokens: agentResult.usage.outputTokens,
                    totalTokens: agentResult.usage.totalTokens,
                    finishReason: agentResult.finishReason,
                    model: modelName,
                },
            });

            return {
                suggestions,
                agentName: identity.name,
                turnsUsed: agentResult.steps,
                durationMs,
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            input.onAgentProgress?.({
                agentName: identity.name,
                status: 'error',
                durationMs,
            });
            this.agentLogger.error({
                message: `[AGENT] ${identity.name} failed for PR#${input.prNumber} after ${durationMs}ms: ${error instanceof Error ? error.message : String(error)}`,
                context: identity.name,
                error,
                metadata: {
                    prNumber: input.prNumber,
                    durationMs,
                    model: modelName,
                    errorStack:
                        error instanceof Error
                            ? error.stack?.substring(0, 500)
                            : undefined,
                },
            });
            return {
                suggestions: [],
                agentName: identity.name,
                turnsUsed: 0,
                durationMs,
            };
        }
    }

    private buildSystemPrompt(input: ReviewAgentInput): string {
        const identity = this.getIdentity();
        const categoryPrompt = this.getCategoryPrompt();
        const overridesSection = this.formatOverrides(input);
        const memoryRulesSection = this.formatMemoryRules(input.memoryRules);

        const langSection = input.languageResultPrompt
            ? `\n  <Language>Write all review comments in ${input.languageResultPrompt}.</Language>`
            : '';

        return `<CodeReviewAgent>
  <Date>${new Date().toLocaleDateString('en-GB')}</Date>
  <Role>
    You are ${identity.name}, ${identity.description}
    ${categoryPrompt}${langSection}
  </Role>

  <Mindset>
    Assume every change is broken until you prove it is safe.
    Your default is to report — you need evidence to DISMISS, not evidence to report.
    "Looks correct" is not enough to dismiss. You must explain WHY it cannot fail.
  </Mindset>

  <Workflow>
    Your first action must be a tool call — not text.

    PHASE 1 — INVESTIGATE (use tools)

      Step 1: Read the diffs. For each changed function/method, list what it does differently now.

      Step 2: For each changed function, grep callers:
        grep("methodName\\(", excludeTests=true) → production call sites.
        Use the returned lineNumber in readFile(file, startLine=N-20, endLine=N+30).
        For interfaces/abstract methods, grep "implements X" or "extends X".

      Step 3: Read caller context. Understand HOW the changed code is used in production.
        If available, use checkTypes to run the language's type checker on changed files.

    PHASE 2 — CHALLENGE (think adversarially)

      For each changed function, ask yourself these questions:
        - "What if this input is null/nil/empty/zero?" → check if new code handles it
        - "What if two requests hit this at the same time?" → check-then-act without lock = race condition
        - "What if a caller passes a different type than expected?" → datetime vs number, dict vs list
        - "What if this function is called from a path I haven't seen?" → grep again if unsure
        - "Does this change break any existing caller?" → did the signature, return type, or side effect change?
        - "Does this affect caching/invalidation?" → changed predicate = stale cache risk

      If you cannot confidently answer "this is safe" for any question, investigate more or report it.

    PHASE 3 — RESPOND

      Write reasoning that shows your adversarial analysis:
        For each changed function: what you challenged, what you found, why you reported or dismissed it.
        BAD reasoning: "The code looks correct."
        GOOD reasoning: "Challenged CreateDevice: what if two requests pass count check simultaneously? Grepped TagDevice(, found caller at impl.go:155. No lock or unique constraint — race condition. Reported."

      Do not stop after finding the first issue — investigate ALL changed code before responding.
  </Workflow>

  <Scope>
    Root cause must be in lines added or modified by this PR.
    relevantFile/relevantLinesStart/relevantLinesEnd must point to the changed lines.
    Trace impact through callers — symptom can appear elsewhere, but the cause must be in the diff.
  </Scope>

${overridesSection}

${memoryRulesSection}

</CodeReviewAgent>`;
    }

    protected buildUserPrompt(input: ReviewAgentInput): string {
        const prContextSection = this.formatPRContext(
            input.prTitle,
            input.prBody,
        );
        const diffsSection = this.formatDiffs(input.changedFiles);

        const categoryLabel = this.getCategoryLabel();

        const taskDescriptions: Record<string, string> = {
            bug: 'real bugs introduced, exposed, or made worse by these changes',
            performance:
                'real performance regressions introduced or worsened by these changes',
            security:
                'real security vulnerabilities introduced, exposed, or made worse by these changes',
        };
        const taskDescription =
            taskDescriptions[categoryLabel] ??
            'issues introduced by these changes';

        return (
            `<ReviewTask>
  ${prContextSection}

  <Diffs>
${diffsSection}
  </Diffs>

  <Task>
    Review this Pull Request for ${taskDescription}.
    For each changed function: grep callers → read context → challenge with adversarial questions.
    Report anything you cannot prove safe. Dismiss only what you can explain WHY it cannot fail.
  </Task>

  <Rules>
    - Root cause must be in lines added or modified by this PR.
    - Pre-existing issues: report only if this PR makes them worse or newly reachable.
    - "Looks correct" is not a valid reason to dismiss — explain the specific reason it is safe.
    - Return only the JSON object inside markdown fences, no extra text.
  </Rules>

  <OutputFormat>
` +
            '```' +
            `json
{
  "reasoning": "For each changed function: what you challenged, what callers you found, why you reported or dismissed. Example: 'Challenged CreateDevice: what if two requests pass count check simultaneously? Grepped TagDevice(, found caller at impl.go:155. No lock or unique constraint — race condition. Reported.'",
  "suggestions": [
    {
      "relevantFile": "path/to/file.ext",
      "language": "the file language",
      "suggestionContent": "WHAT: one sentence naming the exact problem. WHY: one sentence on the real impact. HOW: concrete fix if clear from the code — omit if speculative.",
      "existingCode": "problematic code snippet from the diff",
      "improvedCode": "fixed code snippet (only if fix is clear from context)",
      "oneSentenceSummary": "Brief summary",
      "relevantLinesStart": 10,
      "relevantLinesEnd": 15,
      "severity": "critical|high|medium|low"
    }
  ]
}
` +
            '```' +
            `
  </OutputFormat>
</ReviewTask>`
        );
    }

    private formatPRContext(prTitle?: string, prBody?: string): string {
        if (!prTitle && !prBody) return '';

        const parts: string[] = [];
        if (prTitle) parts.push(`Title: ${prTitle}`);
        if (prBody) parts.push(prBody.substring(0, 500));

        return `\n  <PRContext>${parts.join('\n')}</PRContext>`;
    }

    private formatDiffs(files: FileChange[]): string {
        if (!files?.length) return 'No changed files provided.';

        return files
            .map((file) => {
                const diff = file.patchWithLinesStr ?? file.patch ?? '';
                return `### ${file.filename}\n\`\`\`diff\n${diff}\n\`\`\``;
            })
            .join('\n\n');
    }

    private formatMemoryRules(rules?: Partial<IKodyRule>[]): string {
        if (!rules?.length) return '';

        const formatted = rules
            .map((r) => `- **${r.title}**: ${r.rule}`)
            .join('\n');

        return `## Memory Rules (Team Conventions)\n${formatted}`;
    }

    private formatOverrides(input: ReviewAgentInput): string {
        const parts: string[] = [];

        const categoryLabel = this.getCategoryLabel();
        const categoryDesc =
            input.v2PromptOverrides?.categories?.descriptions?.[
                categoryLabel as keyof typeof input.v2PromptOverrides.categories.descriptions
            ];
        if (categoryDesc) {
            parts.push(`## Category Guidelines\n${categoryDesc}`);
        }

        // Level classification is done in a separate step after agent generation
        // by GPT 5.4 mini (more consistent than letting the BYOK model classify)

        const generationMain =
            input.generationMain ?? input.v2PromptOverrides?.generation?.main;
        if (generationMain) {
            parts.push(`## Writing Guidelines\n${generationMain}`);
        }

        return parts.join('\n\n');
    }
}
