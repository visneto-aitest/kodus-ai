import { createLogger } from '@kodus/flow';
import { DocumentationLLMPlannerService } from '@libs/code-review/infrastructure/adapters/services/documentation-llm-planner.service';
import { DocumentationPackageDiscoveryService } from '@libs/code-review/infrastructure/adapters/services/documentation-package-discovery.service';
import { DocumentationSearchExaService } from '@libs/code-review/infrastructure/adapters/services/documentation-search-exa.service';
import { BasePipelineStage } from '@libs/core/infrastructure/pipeline/abstracts/base-stage.abstract';
import { StageVisibility } from '@libs/core/infrastructure/pipeline/enums/stage-visibility.enum';
import { Injectable } from '@nestjs/common';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';

@Injectable()
export class GatherDocumentationContextStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'GatherDocumentationContextStage';
    readonly label = 'Gathering Documentation Context';
    readonly visibility = StageVisibility.SECONDARY;

    private readonly logger = createLogger(
        GatherDocumentationContextStage.name,
    );

    constructor(
        private readonly packageDiscoveryService: DocumentationPackageDiscoveryService,
        private readonly llmPlannerService: DocumentationLLMPlannerService,
        private readonly documentationSearchService: DocumentationSearchExaService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        if (!context.changedFiles?.length) {
            return context;
        }

        try {
            const discovery =
                await this.packageDiscoveryService.discoverPackages(context);

            if (!discovery.packages.length) {
                this.logger.log({
                    message:
                        'No packages discovered for documentation context stage',
                    context: this.stageName,
                    metadata: {
                        prNumber: context.pullRequest.number,
                        repository: context.repository.name,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.discoveredPackages = [];
                    draft.documentationQueryPlanByFile = {};
                    draft.documentationByFile = {};
                });
            }

            const documentationQueryPlanByFile =
                await this.llmPlannerService.planDocumentationByFile({
                    packages: discovery.packages,
                    changedFiles: context.changedFiles,
                    byokConfig: context.codeReviewConfig?.byokConfig,
                });

            const documentationByFile =
                await this.documentationSearchService.searchByFilePlan(
                    documentationQueryPlanByFile,
                );

            this.logger.log({
                message: `Documentation context gathered for PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                    discoveredPackages: discovery.packages.length,
                    manifestFiles: discovery.manifestFiles,
                    filesWithDocumentation:
                        Object.keys(documentationByFile).length,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.discoveredPackages = discovery.packages;
                draft.documentationQueryPlanByFile =
                    documentationQueryPlanByFile;
                draft.documentationByFile = documentationByFile;
            });
        } catch (error) {
            this.logger.error({
                message:
                    'Failed to gather documentation context, continuing without documentation',
                context: this.stageName,
                error,
                metadata: {
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                },
            });

            return context;
        }
    }
}
