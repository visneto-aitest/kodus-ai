import { createCapabilityToolRuntime } from '@libs/agents/skills/runtime/capability-runtime.resolver';
import {
    fetchPullRequestDiff,
    fetchPullRequestMetadata,
    fetchTaskContext as fetchTaskContextCapability,
    PrDiffReadParams,
    PrMetadataReadParams,
} from '@libs/agents/skills/capabilities';
import {
    CapabilityExecutionHooks,
    CapabilityExecutionTrace,
    SkillCapabilityRuntimeConfig,
    ToolCaller,
} from '@libs/agents/skills/runtime/skill-runtime.types';

import {
    BusinessRulesContext,
    TaskContextNormalized,
    TaskQuality,
} from './types';

export const SKILL_NAME = 'business-rules-validation';
export const PR_METADATA_CAPABILITY = 'pr.metadata.read';
export const PR_DIFF_CAPABILITY = 'pr.diff.read';

interface ToolingResult<T> {
    value: T;
    traces: CapabilityExecutionTrace[];
}

interface ExecutionScope {
    organizationId: string;
    teamId: string;
}

interface PullRequestRef {
    organizationId: string;
    teamId: string;
    repositoryId: string;
    pullRequestNumber: number;
}

export interface BusinessRulesBlueprintTooling {
    fetchPullRequestBody: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<string | undefined>>;
    fetchPullRequestDiff: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<string>>;
    fetchTaskContext: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<TaskContextNormalized | undefined>>;
}

export function resolvePullRequestDescription(
    ctx: BusinessRulesContext,
): string {
    const description = ctx.prepareContext?.pullRequestDescription;
    return typeof description === 'string' ? description : '';
}

export function resolveTaskContext(ctx: BusinessRulesContext): string {
    const taskContext = ctx.prepareContext?.taskContext;
    return typeof taskContext === 'string' ? taskContext : '';
}

export function classifyTaskQuality(taskContext: string): TaskQuality {
    const normalized = taskContext.trim();
    if (!normalized.length) {
        return 'EMPTY';
    }
    if (normalized.length < 80) {
        return 'MINIMAL';
    }
    if (normalized.length < 260) {
        return 'PARTIAL';
    }
    return 'COMPLETE';
}

function resolvePullRequestMetadataToolArgs(
    ctx: BusinessRulesContext,
): PrMetadataReadParams | undefined {
    const pullRequestRef = resolvePullRequestRef(ctx);
    if (!pullRequestRef) {
        return undefined;
    }

    const repositoryName =
        resolveRepositoryName(ctx) ?? pullRequestRef.repositoryId;

    return {
        organizationId: pullRequestRef.organizationId,
        teamId: pullRequestRef.teamId,
        repositoryId: pullRequestRef.repositoryId,
        repositoryName,
        pullRequestNumber: pullRequestRef.pullRequestNumber,
    };
}

function resolvePullRequestDiffToolArgs(
    ctx: BusinessRulesContext,
): PrDiffReadParams | undefined {
    const pullRequestRef = resolvePullRequestRef(ctx);
    if (!pullRequestRef) {
        return undefined;
    }

    const repositoryName = resolveRepositoryName(ctx);

    return {
        organizationId: pullRequestRef.organizationId,
        teamId: pullRequestRef.teamId,
        repositoryId: pullRequestRef.repositoryId,
        repositoryName,
        pullRequestNumber: pullRequestRef.pullRequestNumber,
    };
}

export function createBusinessRulesBlueprintTooling(
    fetcher: ToolCaller,
    capabilityRuntime: SkillCapabilityRuntimeConfig,
    hooks?: CapabilityExecutionHooks<BusinessRulesContext>,
): BusinessRulesBlueprintTooling {
    const providerType = capabilityRuntime.providerType || 'external';
    const registeredTools = getRegisteredToolNames(fetcher);
    const capabilityTools = createCapabilityToolRuntime({
        config: capabilityRuntime,
        registeredTools,
    });

    return {
        fetchPullRequestBody: async (ctx: BusinessRulesContext) => {
            const args = resolvePullRequestMetadataToolArgs(ctx);
            const toolName = capabilityTools.getToolName(PR_METADATA_CAPABILITY);
            const metadata = await fetchPullRequestMetadata(
                fetcher,
                toolName,
                args,
                buildCapabilityExecutionContext(ctx, providerType),
            );

            await recordCapabilityExecutionTraces(
                hooks,
                metadata.traces,
            );

            return {
                value: metadata.body,
                traces: metadata.traces,
            };
        },

        fetchPullRequestDiff: async (ctx: BusinessRulesContext) => {
            const args = resolvePullRequestDiffToolArgs(ctx);
            const toolName = capabilityTools.getToolName(PR_DIFF_CAPABILITY);
            const diff = await fetchPullRequestDiff(
                fetcher,
                toolName,
                args,
                buildCapabilityExecutionContext(ctx, providerType),
            );

            await recordCapabilityExecutionTraces(
                hooks,
                diff.traces,
            );

            return {
                value: diff.diff,
                traces: diff.traces,
            };
        },

        fetchTaskContext: async (ctx: BusinessRulesContext) => {
            const scope = resolveExecutionScope(ctx);
            const taskContext = await fetchTaskContextCapability(
                fetcher,
                capabilityRuntime,
                {
                    skillName: SKILL_NAME,
                    organizationId: scope.organizationId,
                    teamId: scope.teamId,
                    pullRequestNumber: resolvePullRequestNumber(ctx),
                    prBody: ctx.prBody,
                    headRef: resolvePullRequestHeadRef(ctx),
                    userQuestion: readPrepareContextString(ctx, 'userQuestion'),
                    pullRequestDescription: readPrepareContextString(
                        ctx,
                        'pullRequestDescription',
                    ),
                    taskContext: readPrepareContextString(ctx, 'taskContext'),
                    userLanguage: ctx.userLanguage,
                    thread: ctx.thread,
                    excludedTools: resolveExcludedTools(capabilityTools),
                    taskContextResolutionMode:
                        hooks?.resolveTaskContextMode?.(ctx, providerType) ??
                        'cache_first',
                    enableAgenticFallback:
                        ctx.prepareContext?.enableAgenticFallback,
                },
                {
                    getSeedTaskContextTools: hooks?.getSeedTaskContextTools,
                    getCachedTaskContextTools: hooks?.getCachedTaskContextTools,
                    saveCachedTaskContextTools:
                        hooks?.saveCachedTaskContextTools,
                    resolvePreferredTool: hooks?.resolvePreferredTool,
                    recordExecution: hooks?.recordExecution,
                },
            );

            return {
                value: taskContext.normalized,
                traces: taskContext.traces,
            };
        },
    };
}

function resolvePullRequestNumber(
    ctx: BusinessRulesContext,
): number | undefined {
    const nested = ctx.prepareContext?.pullRequest?.pullRequestNumber;
    if (typeof nested === 'number') {
        return nested;
    }
    return undefined;
}

function resolveExecutionScope(ctx: BusinessRulesContext): ExecutionScope {
    return {
        organizationId: ctx.organizationAndTeamData?.organizationId ?? 'unknown-org',
        teamId: ctx.organizationAndTeamData?.teamId ?? 'unknown-team',
    };
}

function resolvePullRequestRef(
    ctx: BusinessRulesContext,
): PullRequestRef | undefined {
    const organizationId = ctx.organizationAndTeamData?.organizationId;
    const teamId = ctx.organizationAndTeamData?.teamId;
    const repositoryId = resolveRepositoryId(ctx);
    const pullRequestNumber = resolvePullRequestNumber(ctx);

    if (
        typeof organizationId !== 'string' ||
        typeof teamId !== 'string' ||
        typeof repositoryId !== 'string' ||
        typeof pullRequestNumber !== 'number'
    ) {
        return undefined;
    }

    return {
        organizationId,
        teamId,
        repositoryId,
        pullRequestNumber,
    };
}

function resolveRepositoryId(ctx: BusinessRulesContext): string | undefined {
    const repositoryId = ctx.prepareContext?.repository?.id;
    if (typeof repositoryId === 'string' && repositoryId.trim().length > 0) {
        return repositoryId;
    }
    if (typeof repositoryId === 'number') {
        return String(repositoryId);
    }
    return undefined;
}

function resolveRepositoryName(ctx: BusinessRulesContext): string | undefined {
    const repositoryName = ctx.prepareContext?.repository?.name;
    return typeof repositoryName === 'string' ? repositoryName : undefined;
}

function resolvePullRequestHeadRef(
    ctx: BusinessRulesContext,
): string | undefined {
    const headRef = ctx.prepareContext?.pullRequest?.headRef;
    return typeof headRef === 'string' ? headRef : undefined;
}

function readPrepareContextString(
    ctx: BusinessRulesContext,
    key: keyof NonNullable<BusinessRulesContext['prepareContext']>,
): string | undefined {
    const value = ctx.prepareContext?.[key];
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function resolveExcludedTools(capabilityTools: {
    getToolName: (capability: string) => string | undefined;
}): string[] {
    return [
        capabilityTools.getToolName(PR_METADATA_CAPABILITY),
        capabilityTools.getToolName(PR_DIFF_CAPABILITY),
    ].filter((toolName): toolName is string => typeof toolName === 'string');
}

function getRegisteredToolNames(fetcher: ToolCaller): string[] {
    return fetcher
        .getRegisteredTools()
        .map((tool) => tool.name ?? '')
        .filter((toolName) => toolName.trim().length > 0);
}

function buildCapabilityExecutionContext(
    ctx: BusinessRulesContext,
    provider: string,
): {
    skillName: string;
    organizationId: string;
    teamId: string;
    provider: string;
} {
    const scope = resolveExecutionScope(ctx);
    return {
        skillName: SKILL_NAME,
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        provider,
    };
}

async function recordCapabilityExecutionTraces(
    hooks: CapabilityExecutionHooks<BusinessRulesContext> | undefined,
    traces: CapabilityExecutionTrace[],
): Promise<void> {
    await Promise.all(
        traces.map((trace) => hooks?.recordExecution?.(trace)),
    );
}
