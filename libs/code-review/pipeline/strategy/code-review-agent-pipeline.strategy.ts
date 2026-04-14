/**
 * @license
 * Kodus Tech. All rights reserved.
 */
import { Inject, Injectable } from '@nestjs/common';

import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { IPipelineStrategy } from '@libs/core/infrastructure/pipeline/interfaces/pipeline-strategy.interface';
import { PipelineStage } from '@libs/core/infrastructure/pipeline/interfaces/pipeline.interface';

import { ValidatePrerequisitesStage } from '../stages/validate-prerequisites.stage';
import { ValidateNewCommitsStage } from '../stages/validate-new-commits.stage';
import { ResolveConfigStage } from '../stages/resolve-config.stage';
import { ValidateConfigStage } from '../stages/validate-config.stage';
import { FetchChangedFilesStage } from '../stages/fetch-changed-files.stage';
import {
    ILoadExternalContextStage,
    LOAD_EXTERNAL_CONTEXT_STAGE_TOKEN,
} from '../stages/contracts/loadExternalContextStage.contract';
import { InitialCommentStage } from '../stages/initial-comment.stage';
import { BusinessLogicValidationStage } from '../stages/business-logic-validation.stage';
import { CreatePrLevelCommentsStage } from '../stages/create-pr-level-comments.stage';
import { ValidateSuggestionsStage } from '../stages/validate-suggestions.stage';
import { CreateFileCommentsStage } from '../stages/create-file-comments.stage';
import { AggregateResultsStage } from '../stages/aggregate-result.stage';
import { UpdateCommentsAndGenerateSummaryStage } from '../stages/finish-comments.stage';
import { RequestChangesOrApproveStage } from '../stages/finish-process-review.stage';

// Agent-specific stages
import { CreateSandboxStage } from '../stages/create-sandbox.stage';
import { AgentReviewStage } from '../stages/agent-review.stage';

@Injectable()
export class CodeReviewAgentPipelineStrategy implements IPipelineStrategy<CodeReviewPipelineContext> {
    constructor(
        private readonly validatePrerequisitesStage: ValidatePrerequisitesStage,
        private readonly validateNewCommitsStage: ValidateNewCommitsStage,
        private readonly resolveConfigStage: ResolveConfigStage,
        private readonly validateConfigStage: ValidateConfigStage,
        private readonly fetchChangedFilesStage: FetchChangedFilesStage,
        @Inject(LOAD_EXTERNAL_CONTEXT_STAGE_TOKEN)
        private readonly loadExternalContextStage: ILoadExternalContextStage,
        private readonly initialCommentStage: InitialCommentStage,
        private readonly businessLogicValidationStage: BusinessLogicValidationStage,
        private readonly createSandboxStage: CreateSandboxStage,
        private readonly agentReviewStage: AgentReviewStage,
        private readonly createPrLevelCommentsStage: CreatePrLevelCommentsStage,
        private readonly validateSuggestionsStage: ValidateSuggestionsStage,
        private readonly createFileCommentsStage: CreateFileCommentsStage,
        private readonly aggregateResultsStage: AggregateResultsStage,
        private readonly updateCommentsAndGenerateSummaryStage: UpdateCommentsAndGenerateSummaryStage,
        private readonly requestChangesOrApproveStage: RequestChangesOrApproveStage,
    ) {}

    getPipelineName(): string {
        return 'CodeReviewAgentPipeline';
    }

    configureStages(): PipelineStage<CodeReviewPipelineContext>[] {
        // Removed from this strategy (still used by EE strategy):
        //   - FileContextGateStage: produced augmentationsByFile (MCP outputs).
        //     Kody Rules no longer use MCP in the agent engine, and no other
        //     stage in this pipeline reads that field.
        //   - KodyFineTuningStage: produced clusterizedSuggestions, only
        //     consumed by the EE-only ProcessFilesReviewStage.
        //   - ProcessFilesPrLevelReviewStage: in the agent engine its kody-rules
        //     and cross-file paths were already short-circuited; the only real
        //     work was business-logic validation, now lifted into its own
        //     BusinessLogicValidationStage with rich SUCCESS/SKIPPED/ERROR
        //     status reporting in the PR logs UI.
        return [
            this.validatePrerequisitesStage,
            this.validateNewCommitsStage,
            this.resolveConfigStage,
            this.validateConfigStage,
            this.fetchChangedFilesStage,
            this.loadExternalContextStage,
            this.initialCommentStage,
            this.businessLogicValidationStage,
            this.createSandboxStage,
            this.agentReviewStage,
            this.createPrLevelCommentsStage,
            this.validateSuggestionsStage,
            this.createFileCommentsStage,
            this.aggregateResultsStage,
            this.updateCommentsAndGenerateSummaryStage,
            this.requestChangesOrApproveStage,
        ];
    }
}
