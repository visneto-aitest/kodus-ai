import { ParametersKey } from '@libs/core/domain/enums';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@libs/organization/domain/parameters/contracts/parameters.service.contract';
import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PullRequestClosedEvent } from '@libs/core/domain/events/pull-request-closed.event';
import { KodyRulesSyncService } from '../services/kodyRulesSync.service';
import { createLogger } from '@kodus/flow';

@Injectable()
export class KodyRulesSyncListener {
    private readonly logger = createLogger(KodyRulesSyncListener.name);

    constructor(
        private readonly kodyRulesSyncService: KodyRulesSyncService,
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
    ) {}

    @OnEvent('pull-request.closed')
    async handlePullRequestClosedEvent(event: PullRequestClosedEvent) {
        if (!event.repository || !event.repository.id) {
            this.logger.warn({
                message:
                    'Received pull-request.closed event without repository information, skipping Kody rules sync',
                context: KodyRulesSyncListener.name,
                metadata: {
                    pullRequestNumber: event.pullRequestNumber,
                },
            });
            return;
        }

        const centralizedConfigEnabled =
            await this.isCentralizedConfigEnabled(event);

        if (centralizedConfigEnabled) {
            this.logger.log({
                message:
                    'Centralized config is enabled, skipping legacy Kody rules sync listener',
                context: KodyRulesSyncListener.name,
                metadata: {
                    organizationAndTeamData: event.organizationAndTeamData,
                    repositoryId: event.repository.id,
                },
            });

            return;
        }

        this.logger.log({
            message: 'Handling pull-request.closed event for Kody Rules Sync',
            context: KodyRulesSyncListener.name,
            metadata: {
                prNumber: event.pullRequestNumber,
                repositoryId: event.repository.id,
            },
        });

        if (!event.files || event.files.length === 0) {
            return;
        }

        await this.kodyRulesSyncService.syncFromChangedFiles({
            organizationAndTeamData: event.organizationAndTeamData,
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
            files: event.files,
        });
    }

    private async isCentralizedConfigEnabled(
        event: PullRequestClosedEvent,
    ): Promise<boolean> {
        try {
            const centralizedConfigParameter =
                await this.parametersService.findByKey(
                    ParametersKey.CENTRALIZED_CONFIG,
                    event.organizationAndTeamData,
                );

            return Boolean(centralizedConfigParameter?.configValue?.enabled);
        } catch (error) {
            this.logger.warn({
                message:
                    'Failed to determine centralized config status for Kody rules listener',
                context: KodyRulesSyncListener.name,
                metadata: {
                    organizationAndTeamData: event.organizationAndTeamData,
                    repositoryId: event.repository?.id,
                },
                error,
            });

            return false;
        }
    }
}
