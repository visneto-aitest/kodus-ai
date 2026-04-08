import { PullRequestState } from '@libs/core/domain/enums/pullRequestState.enum';
import { CentralizedConfigPrService } from '../centralized-config-pr.service';

describe('CentralizedConfigPrService', () => {
    const organizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    const centralizedRepository = {
        id: 'repo-centralized',
        name: 'centralized-repo',
    };

    const activePullRequest = {
        prUrl: 'https://example.test/pull/123',
        prNumber: 123,
        sourceBranch: 'kodus-centralized-config-global-123',
        targetBranch: 'main',
        repository: centralizedRepository,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const centralizedConfig = {
        enabled: true,
        repository: centralizedRepository,
        activePullRequest,
    };

    const buildService = (overrides?: {
        pullRequestState?: PullRequestState;
    }) => {
        const parametersService = {
            findByKey: jest.fn().mockResolvedValue({
                configValue: centralizedConfig,
            }),
            createOrUpdateConfig: jest.fn().mockResolvedValue(undefined),
        };

        const integrationConfigService = {
            findIntegrationConfigFormatted: jest.fn().mockResolvedValue([]),
        };

        const codeManagementService = {
            getDefaultBranch: jest.fn().mockResolvedValue('main'),
            getPullRequest: jest.fn().mockResolvedValue({
                state: overrides?.pullRequestState,
            }),
            getRepositoryContentFile: jest.fn().mockResolvedValue({
                data: {
                    content: Buffer.from('ignorePaths: []').toString('base64'),
                    encoding: 'base64',
                },
            }),
        };

        const centralizedConfigSyncUseCase = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                message: 'ok',
            }),
        };

        const service = new CentralizedConfigPrService(
            parametersService as any,
            integrationConfigService as any,
            codeManagementService as any,
            centralizedConfigSyncUseCase as any,
        );

        return {
            service,
            parametersService,
            codeManagementService,
        };
    };

    it('falls back to default branch when tracked active pull request is closed', async () => {
        const { service, parametersService, codeManagementService } =
            buildService({
                pullRequestState: PullRequestState.CLOSED,
            });

        await service.getScopedKodusConfigFileContent({
            organizationAndTeamData,
        });

        expect(
            codeManagementService.getRepositoryContentFile,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                pullRequest: {
                    head: { ref: 'main' },
                    base: { ref: 'main' },
                },
            }),
        );

        expect(parametersService.createOrUpdateConfig).toHaveBeenCalledWith(
            'centralized_config',
            expect.objectContaining({
                activePullRequest: null,
            }),
            organizationAndTeamData,
        );
    });

    it('uses tracked source branch when tracked active pull request is open', async () => {
        const { service, parametersService, codeManagementService } =
            buildService({
                pullRequestState: PullRequestState.OPENED,
            });

        await service.getScopedKodusConfigFileContent({
            organizationAndTeamData,
        });

        expect(
            codeManagementService.getRepositoryContentFile,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                pullRequest: {
                    head: {
                        ref: activePullRequest.sourceBranch,
                    },
                    base: {
                        ref: activePullRequest.sourceBranch,
                    },
                },
            }),
        );

        expect(parametersService.createOrUpdateConfig).not.toHaveBeenCalled();
    });
});
