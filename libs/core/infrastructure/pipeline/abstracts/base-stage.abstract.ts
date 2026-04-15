import { produce } from 'immer';
import {
    PipelineContext,
    PipelineErrorSeverity,
} from '../interfaces/pipeline-context.interface';
import { PipelineStage } from '../interfaces/pipeline.interface';
import { PipelineExecutor } from '../services/pipeline-executor.service';
import { StageVisibility } from '../enums/stage-visibility.enum';

export abstract class BasePipelineStage<
    TContext extends PipelineContext,
> implements PipelineStage<TContext> {
    abstract stageName: string;
    label?: string;
    visibility: StageVisibility = StageVisibility.SECONDARY;

    /**
     * How a thrown error in this stage contributes to the pipeline's final
     * conclusion. Default 'critical' preserves historical behavior. Stages
     * whose failure should not red-flag the whole review should override to
     * 'partial' (e.g. business-logic validation, summary, PR-level comments).
     * See PipelineErrorSeverity for the semantics.
     */
    errorSeverity: PipelineErrorSeverity = 'critical';

    async execute(context: TContext): Promise<TContext> {
        return await this.executeStage(context);
    }

    protected abstract executeStage(context: TContext): Promise<TContext>;

    protected updateContext(
        context: TContext,
        updater: (draft: TContext) => void,
    ): TContext {
        return produce(context, updater);
    }

    protected async executeSubPipeline<TSubContext extends PipelineContext>(
        subContext: TSubContext,
        stages: PipelineStage<TSubContext>[],
        pipelineName: string,
        pipelineExecutor: PipelineExecutor<TSubContext>,
    ): Promise<TSubContext> {
        try {
            return await pipelineExecutor.execute(
                subContext,
                stages,
                pipelineName,
                subContext.pipelineMetadata?.parentPipelineId,
                subContext.pipelineMetadata?.rootPipelineId,
            );
        } catch (error) {
            subContext?.errors?.push({
                pipelineId: subContext?.pipelineMetadata?.pipelineId,
                stage: this.stageName,
                substage: pipelineName,
                error,
            });
            throw error;
        }
    }
}
