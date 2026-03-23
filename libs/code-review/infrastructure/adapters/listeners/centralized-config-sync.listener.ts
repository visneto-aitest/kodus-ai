import { createLogger } from '@kodus/flow';
import { SyncCentralizedConfigUseCase } from '@libs/code-review/application/use-cases/configuration/sync-centralized-config.use-case';
import { PullRequestClosedEvent } from '@libs/core/domain/events/pull-request-closed.event';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class CentralizedConfigSyncListener {
    private readonly logger = createLogger(CentralizedConfigSyncListener.name);

    constructor(
        private readonly syncCentralizedConfigUseCase: SyncCentralizedConfigUseCase,
    ) {}

    @OnEvent('pull-request.closed')
    async handlePullRequestClosedEvent(event: PullRequestClosedEvent) {
        if (event.repository?.name !== 'kodus') {
            return;
        }

        this.logger.log({
            message:
                'Handling pull-request.closed event for centralized config sync',
            context: CentralizedConfigSyncListener.name,
            metadata: {
                repositoryId: event.repository?.id,
                repositoryName: event.repository?.name,
                pullRequestNumber: event.pullRequestNumber,
            },
        });

        await this.syncCentralizedConfigUseCase.execute({
            organizationAndTeamData: event.organizationAndTeamData,
        });
    }
}
