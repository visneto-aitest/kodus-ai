import { Test, TestingModule } from '@nestjs/testing';

import { SyncCentralizedConfigUseCase } from '@libs/code-review/application/use-cases/configuration/sync-centralized-config.use-case';
import { PullRequestClosedEvent } from '@libs/core/domain/events/pull-request-closed.event';
import { CentralizedConfigSyncListener } from './centralized-config-sync.listener';

describe('CentralizedConfigSyncListener', () => {
    let listener: CentralizedConfigSyncListener;

    const syncCentralizedConfigUseCaseMock = {
        execute: jest.fn(),
    };

    beforeEach(async () => {
        syncCentralizedConfigUseCaseMock.execute.mockReset();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CentralizedConfigSyncListener,
                {
                    provide: SyncCentralizedConfigUseCase,
                    useValue: syncCentralizedConfigUseCaseMock,
                },
            ],
        }).compile();

        listener = module.get<CentralizedConfigSyncListener>(
            CentralizedConfigSyncListener,
        );
    });

    it('should sync centralized config when pull-request.closed is emitted for repository kodus', async () => {
        const event = new PullRequestClosedEvent(
            {
                organizationId: 'org-1',
                teamId: 'team-1',
            } as any,
            {
                id: 'repo-1',
                name: 'kodus',
            },
            42,
            [],
        );

        await listener.handlePullRequestClosedEvent(event);

        expect(syncCentralizedConfigUseCaseMock.execute).toHaveBeenCalledWith({
            organizationAndTeamData: event.organizationAndTeamData,
        });
    });

    it('should not sync centralized config when repository name is not exactly kodus', async () => {
        const event = new PullRequestClosedEvent(
            {
                organizationId: 'org-1',
                teamId: 'team-1',
            } as any,
            {
                id: 'repo-1',
                name: 'Kodus',
            },
            42,
            [],
        );

        await listener.handlePullRequestClosedEvent(event);

        expect(syncCentralizedConfigUseCaseMock.execute).not.toHaveBeenCalled();
    });
});
