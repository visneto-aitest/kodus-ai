import { Test, TestingModule } from '@nestjs/testing';

import { CentralizedConfigSyncUseCase } from '@libs/centralized-config/application/use-cases/centralized-config-sync.use-case';
import { CentralizedConfigPrService } from '@libs/centralized-config/infrastructure/adapters/services/centralized-config-pr.service';
import {
    CENTRALIZED_CONFIG_SERVICE_TOKEN,
    ICentralizedConfigService,
} from '@libs/centralized-config/domain/contracts/CentralizedConfigService.contract';
import { PullRequestClosedEvent } from '@libs/core/domain/events/pull-request-closed.event';
import { CentralizedConfigSyncListener } from './centralized-config-sync.listener';

describe('CentralizedConfigSyncListener', () => {
    let listener: CentralizedConfigSyncListener;

    const centralizedConfigSyncUseCaseMock = {
        execute: jest.fn(),
    };

    const centralizedConfigPrServiceMock = {
        clearActivePullRequestMetadataIfMatching: jest.fn(),
    };

    const centralizedConfigServiceMock: jest.Mocked<ICentralizedConfigService> =
        {
            validateCentralizedConfig: jest.fn(),
            getCentralizedConfigRepository: jest.fn(),
            discoverConfigFiles: jest.fn(),
            fetchConfigFile: jest.fn(),
            synchronizeConfigs: jest.fn(),
            removeStaleConfigs: jest.fn(),
            discoverKodyRulesFiles: jest.fn(),
            fetchKodyRuleFile: jest.fn(),
            synchronizeKodyRules: jest.fn(),
            removeStaleKodyRules: jest.fn(),
        };

    beforeEach(async () => {
        centralizedConfigSyncUseCaseMock.execute.mockReset();
        centralizedConfigPrServiceMock.clearActivePullRequestMetadataIfMatching.mockReset();
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CentralizedConfigSyncListener,
                {
                    provide: CentralizedConfigSyncUseCase,
                    useValue: centralizedConfigSyncUseCaseMock,
                },
                {
                    provide: CentralizedConfigPrService,
                    useValue: centralizedConfigPrServiceMock,
                },
                {
                    provide: CENTRALIZED_CONFIG_SERVICE_TOKEN,
                    useValue: centralizedConfigServiceMock,
                },
            ],
        }).compile();

        listener = module.get<CentralizedConfigSyncListener>(
            CentralizedConfigSyncListener,
        );
    });

    it('should sync centralized config when pull-request.closed is emitted and validation succeeds', async () => {
        const event = new PullRequestClosedEvent(
            {
                organizationId: 'org-1',
                teamId: 'team-1',
            } as any,
            {
                id: 'centralized-config-repo',
                name: 'kodus',
            },
            42,
            [],
        );

        centralizedConfigServiceMock.validateCentralizedConfig.mockResolvedValue(
            {
                success: true,
                message: 'Valid',
            },
        );

        await listener.handlePullRequestClosedEvent(event);

        expect(
            centralizedConfigServiceMock.validateCentralizedConfig,
        ).toHaveBeenCalledWith({
            organizationAndTeamData: event.organizationAndTeamData,
            repository: event.repository,
        });
        expect(
            centralizedConfigPrServiceMock.clearActivePullRequestMetadataIfMatching,
        ).toHaveBeenCalledWith({
            organizationAndTeamData: event.organizationAndTeamData,
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
        });
        expect(centralizedConfigSyncUseCaseMock.execute).toHaveBeenCalledWith({
            organizationAndTeamData: event.organizationAndTeamData,
            repository: event.repository,
        });
    });

    it('should skip sync when centralized config validation fails', async () => {
        const event = new PullRequestClosedEvent(
            {
                organizationId: 'org-1',
                teamId: 'team-1',
            } as any,
            {
                id: 'centralized-config-repo',
                name: 'kodus',
            },
            42,
            [],
        );

        centralizedConfigServiceMock.validateCentralizedConfig.mockResolvedValue(
            {
                success: false,
                message: 'Not configured',
            },
        );

        await listener.handlePullRequestClosedEvent(event);

        expect(
            centralizedConfigServiceMock.validateCentralizedConfig,
        ).toHaveBeenCalledWith({
            organizationAndTeamData: event.organizationAndTeamData,
            repository: event.repository,
        });
        expect(
            centralizedConfigPrServiceMock.clearActivePullRequestMetadataIfMatching,
        ).not.toHaveBeenCalled();
        expect(centralizedConfigSyncUseCaseMock.execute).not.toHaveBeenCalled();
    });
});
