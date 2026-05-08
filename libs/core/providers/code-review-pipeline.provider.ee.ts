/**
 * @license
 * Kodus Tech. All rights reserved.
 */
import { CodeReviewAgentPipelineStrategy } from '@libs/code-review/pipeline/strategy/code-review-agent-pipeline.strategy';
import { CodeReviewPipelineContext } from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { IPipeline } from '@libs/core/infrastructure/pipeline/interfaces/pipeline.interface';
import { PipelineExecutor } from '@libs/core/infrastructure/pipeline/services/pipeline-executor.service';
import { Provider } from '@nestjs/common';
import { CodeReviewPipelineStrategyEE } from '@libs/ee/codeReview/strategies/code-review-pipeline.strategy.ee';
import { createLogger } from '@kodus/flow';
import { CodeReviewPipelineObserver } from '@libs/code-review/infrastructure/observers/code-review-pipeline.observer';
import { FeatureGateService } from '@libs/feature-gate/application/feature-gate.service';
import { FEATURE_KEYS } from '@libs/feature-gate/domain/feature-keys';
import { ORGANIZATION_SERVICE_TOKEN } from '@libs/organization/domain/organization/contracts/organization.service.contract';
import type { IOrganizationService } from '@libs/organization/domain/organization/contracts/organization.service.contract';

export const CODE_REVIEW_PIPELINE_TOKEN = 'CODE_REVIEW_PIPELINE';

const logger = createLogger('codeReviewPipelineProvider');

export const codeReviewPipelineProvider: Provider = {
    provide: CODE_REVIEW_PIPELINE_TOKEN,
    useFactory: (
        eeStrategy: CodeReviewPipelineStrategyEE,
        agentStrategy: CodeReviewAgentPipelineStrategy,
        observer: CodeReviewPipelineObserver,
        featureGate: FeatureGateService,
        organizationService: IOrganizationService,
    ): IPipeline<CodeReviewPipelineContext> => {
        logger.log({
            message: `Pipeline provider initialized with EE (v4) and Agent strategies`,
            context: 'CodeReviewPipelineProvider',
        });

        return {
            pipeLineName: 'CodeReviewPipeline',
            execute: async (
                context: CodeReviewPipelineContext,
            ): Promise<CodeReviewPipelineContext> => {
                const featureIdentifier =
                    context.organizationAndTeamData?.organizationId ||
                    context.organizationAndTeamData?.teamId ||
                    'unknown';

                const repositoryId = context.repository?.id;

                logger.log({
                    message: `[FEATURE-GATE] Evaluating agent-review`,
                    context: 'CodeReviewPipelineProvider',
                    metadata: {
                        featureIdentifier,
                        repositoryId,
                        repositoryName: context.repository?.name,
                        repositoryFullName: context.repository?.fullName,
                        organizationId:
                            context.organizationAndTeamData?.organizationId,
                        teamId: context.organizationAndTeamData?.teamId,
                    },
                });

                let useAgentPipeline = false;

                // Per-instance kill-switch / force-on for agent-review,
                // independent of the broader BETA_FEATURES toggle. Set when
                // an admin wants to pin behavior for this specific feature.
                const envOverride =
                    process.env.API_AGENT_REVIEW_ENABLED?.toLowerCase();
                if (envOverride === 'true' || envOverride === '1') {
                    useAgentPipeline = true;
                    logger.log({
                        message: `[FEATURE-GATE] agent-review forced by API_AGENT_REVIEW_ENABLED env var`,
                        context: 'CodeReviewPipelineProvider',
                        metadata: {
                            repositoryId,
                            featureIdentifier,
                        },
                    });
                } else {
                    const orgId =
                        context.organizationAndTeamData?.organizationId;
                    const releaseTrack = orgId
                        ? await organizationService.getReleaseTrack(orgId)
                        : undefined;
                    useAgentPipeline = await featureGate.isEnabled(
                        FEATURE_KEYS.agentReview,
                        {
                            identifier: featureIdentifier,
                            organizationAndTeamData:
                                context.organizationAndTeamData,
                            repositoryId,
                            releaseTrack,
                        },
                    );

                    logger.log({
                        message: `[FEATURE-GATE] agent-review result: ${useAgentPipeline} (repositoryId=${repositoryId})`,
                        context: 'CodeReviewPipelineProvider',
                        metadata: {
                            flagResult: useAgentPipeline,
                            repositoryId,
                            featureIdentifier,
                        },
                    });
                }

                const strategy = useAgentPipeline ? agentStrategy : eeStrategy;

                logger.log({
                    message: `Pipeline strategy selected: ${strategy.getPipelineName()} (useAgentPipeline=${useAgentPipeline}, identifier=${featureIdentifier}, repositoryId=${repositoryId})`,
                    context: 'CodeReviewPipelineProvider',
                });

                // Mark which engine will run so downstream stages (e.g.
                // FetchChangedFilesStage) can apply engine-specific limits.
                context.pipelineMetadata = {
                    ...(context.pipelineMetadata || {}),
                    useAgentEngine: useAgentPipeline,
                };

                const stages = strategy.configureStages();
                const executor = new PipelineExecutor();
                return (await executor.execute(
                    context,
                    stages,
                    strategy.getPipelineName(),
                    undefined,
                    undefined,
                    [observer],
                )) as CodeReviewPipelineContext;
            },
        };
    },
    inject: [
        CodeReviewPipelineStrategyEE,
        CodeReviewAgentPipelineStrategy,
        CodeReviewPipelineObserver,
        FeatureGateService,
        ORGANIZATION_SERVICE_TOKEN,
    ],
};
