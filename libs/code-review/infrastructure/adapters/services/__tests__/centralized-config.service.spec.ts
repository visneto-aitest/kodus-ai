import { createLogger } from '@kodus/flow';
import { Test, TestingModule } from '@nestjs/testing';
import { CODE_BASE_CONFIG_SERVICE_TOKEN } from '@libs/code-review/domain/contracts/CodeBaseConfigService.contract';
import { IConfigFileMeta } from '@libs/code-review/domain/contracts/CentralizedConfigService.contract';
import { ParametersKey } from '@libs/core/domain/enums';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { ConfigLevel } from '@libs/core/infrastructure/config/types/general/pullRequestMessages.type';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@libs/integrations/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { CreateOrUpdateParametersUseCase } from '@libs/organization/application/use-cases/parameters/create-or-update-use-case';
import { PARAMETERS_SERVICE_TOKEN } from '@libs/organization/domain/parameters/contracts/parameters.service.contract';
import { CodeManagementService } from '@libs/platform/infrastructure/adapters/services/codeManagement.service';
import { DeleteRepositoryCodeReviewParameterUseCase } from '@libs/code-review/application/use-cases/configuration/delete-repository-code-review-parameter.use-case';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@libs/code-review/application/use-cases/configuration/update-or-create-code-review-parameter-use-case';
import { CreateOrUpdatePullRequestMessagesUseCase } from '@libs/code-review/application/use-cases/pullRequestMessages/create-or-update-pull-request-messages.use-case';
import { PULL_REQUEST_MESSAGES_SERVICE_TOKEN } from '@libs/code-review/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { CentralizedConfigService } from '../centralized-config.service';

describe('CentralizedConfigService', () => {
    let service: CentralizedConfigService;
    let mockParametersService: any;
    let mockIntegrationConfigService: any;
    let mockCodeManagementService: any;
    let mockUpdateOrCreateCodeReviewParameterUseCase: any;
    let mockDeleteRepositoryCodeReviewParameterUseCase: any;
    let mockCreateOrUpdateParametersUseCase: any;
    let mockCreateOrUpdatePullRequestMessagesUseCase: any;
    let mockPullRequestMessagesService: any;
    let mockCodeBaseConfigService: any;

    const organizationAndTeamData: OrganizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    const actor = {
        organizationId: 'org-1',
        source: 'sync' as const,
        userEmail: 'kody@kodus.io',
        userId: 'kody',
    };

    beforeEach(async () => {
        mockParametersService = {
            findByKey: jest.fn(),
            findOne: jest.fn(),
        };

        mockIntegrationConfigService = {
            findIntegrationConfigFormatted: jest.fn(),
        };

        mockCodeManagementService = {
            getRepositoryTree: jest.fn(),
        };

        mockUpdateOrCreateCodeReviewParameterUseCase = {
            execute: jest.fn(),
        };

        mockDeleteRepositoryCodeReviewParameterUseCase = {
            execute: jest.fn(),
        };

        mockCreateOrUpdateParametersUseCase = {
            execute: jest.fn(),
        };

        mockCreateOrUpdatePullRequestMessagesUseCase = {
            execute: jest.fn(),
        };

        mockPullRequestMessagesService = {
            findOne: jest.fn(),
        };

        mockCodeBaseConfigService = {
            getKodusConfigFile: jest.fn(),
            getDirectoryIdForPath: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CentralizedConfigService,
                {
                    provide: PARAMETERS_SERVICE_TOKEN,
                    useValue: mockParametersService,
                },
                {
                    provide: INTEGRATION_CONFIG_SERVICE_TOKEN,
                    useValue: mockIntegrationConfigService,
                },
                {
                    provide: CodeManagementService,
                    useValue: mockCodeManagementService,
                },
                {
                    provide: UpdateOrCreateCodeReviewParameterUseCase,
                    useValue: mockUpdateOrCreateCodeReviewParameterUseCase,
                },
                {
                    provide: DeleteRepositoryCodeReviewParameterUseCase,
                    useValue: mockDeleteRepositoryCodeReviewParameterUseCase,
                },
                {
                    provide: CreateOrUpdateParametersUseCase,
                    useValue: mockCreateOrUpdateParametersUseCase,
                },
                {
                    provide: CreateOrUpdatePullRequestMessagesUseCase,
                    useValue: mockCreateOrUpdatePullRequestMessagesUseCase,
                },
                {
                    provide: PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
                    useValue: mockPullRequestMessagesService,
                },
                {
                    provide: CODE_BASE_CONFIG_SERVICE_TOKEN,
                    useValue: mockCodeBaseConfigService,
                },
            ],
        }).compile();

        service = module.get<CentralizedConfigService>(
            CentralizedConfigService,
        );

        // Mock the logger to avoid console output during tests
        jest.spyOn(createLogger(''), 'log').mockImplementation(() => {});
        jest.spyOn(createLogger(''), 'error').mockImplementation(() => {});
        jest.spyOn(createLogger(''), 'warn').mockImplementation(() => {});
    });

    describe('synchronizeConfigs', () => {
        it('should sync custom messages from centralized config', async () => {
            const configFiles: IConfigFileMeta[] = [
                {
                    repositoryId: 'repo-1',
                    centralizedDirectoryPath: 'repo1',
                    directoryPath: '/src',
                },
            ];

            const configFileWithCustomMessages = {
                version: '2.0',
                automatedReviewActive: true,
                customMessages: {
                    globalSettings: {
                        hideComments: false,
                        suggestionCopyPrompt: true,
                    },
                    startReviewMessage: {
                        status: 'every_push',
                        content: 'Custom start message',
                    },
                    endReviewMessage: {
                        status: 'every_push',
                        content: 'Custom end message',
                    },
                },
            };

            // Mock repository lookup
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue(
                [{ id: 'repo-1', name: 'repo1', full_name: 'org/repo1' }],
            );

            // Mock directory ID resolution
            mockCodeBaseConfigService.getDirectoryIdForPath.mockResolvedValue(
                'dir-1',
            );

            // Mock existing parent configs (empty for this test)
            mockPullRequestMessagesService.findOne.mockResolvedValue(null);

            // Mock config file fetch
            mockCodeBaseConfigService.getKodusConfigFile.mockResolvedValue(
                configFileWithCustomMessages,
            );

            // Mock parameter operations - different mocks for different keys
            mockParametersService.findByKey.mockImplementation(
                (key, orgAndTeamData) => {
                    if (key === ParametersKey.CENTRALIZED_CONFIG) {
                        return Promise.resolve({
                            configValue: {
                                enabled: true,
                                repository: {
                                    id: 'centralized-repo-1',
                                    name: 'centralized-repo',
                                },
                            },
                        });
                    }
                    if (key === ParametersKey.CODE_REVIEW_CONFIG) {
                        return Promise.resolve({
                            configValue: {},
                        });
                    }
                    return Promise.resolve({
                        configValue: {},
                    });
                },
            );

            mockUpdateOrCreateCodeReviewParameterUseCase.execute.mockResolvedValue(
                undefined,
            );

            const result = await service.synchronizeConfigs({
                organizationAndTeamData,
                configFiles,
                actor,
            });

            expect(result.success).toBe(true);
            expect(
                mockCreateOrUpdatePullRequestMessagesUseCase.execute,
            ).toHaveBeenCalledWith(
                {
                    uuid: 'kody',
                    email: 'kody@kodus.io',
                    organization: { uuid: 'org-1' },
                },
                {
                    organizationId: 'org-1',
                    configLevel: ConfigLevel.DIRECTORY,
                    repositoryId: 'repo-1',
                    directoryId: 'dir-1',
                    startReviewMessage: {
                        status: 'every_push',
                        content: 'Custom start message',
                    },
                    endReviewMessage: {
                        status: 'every_push',
                        content: 'Custom end message',
                    },
                    globalSettings: {
                        hideComments: false,
                        suggestionCopyPrompt: true,
                    },
                },
            );

            // Verify customMessages are removed from the config stored in Postgres
            expect(
                mockUpdateOrCreateCodeReviewParameterUseCase.execute,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    configValue: expect.not.objectContaining({
                        customMessages: expect.anything(),
                    }),
                }),
            );
        });

        it('should handle global config custom messages', async () => {
            const configFiles: IConfigFileMeta[] = [{}]; // Global config

            const configFileWithCustomMessages = {
                version: '2.0',
                automatedReviewActive: true,
                customMessages: {
                    globalSettings: {
                        hideComments: true,
                        suggestionCopyPrompt: false,
                    },
                    startReviewMessage: {
                        status: 'only_when_opened',
                        content: 'Global start message',
                    },
                    endReviewMessage: {
                        status: 'off',
                        content: '',
                    },
                },
            };

            // Mock config file fetch
            mockCodeBaseConfigService.getKodusConfigFile.mockResolvedValue(
                configFileWithCustomMessages,
            );

            // Mock parameter operations - different mocks for different keys
            mockParametersService.findByKey.mockImplementation(
                (key, orgAndTeamData) => {
                    if (key === ParametersKey.CENTRALIZED_CONFIG) {
                        return Promise.resolve({
                            configValue: {
                                enabled: true,
                                repository: {
                                    id: 'centralized-repo-1',
                                    name: 'centralized-repo',
                                },
                            },
                        });
                    }
                    if (key === ParametersKey.CODE_REVIEW_CONFIG) {
                        return Promise.resolve({
                            configValue: {},
                        });
                    }
                    return Promise.resolve({
                        configValue: {},
                    });
                },
            );

            mockUpdateOrCreateCodeReviewParameterUseCase.execute.mockResolvedValue(
                undefined,
            );

            const result = await service.synchronizeConfigs({
                organizationAndTeamData,
                configFiles,
                actor,
            });

            expect(result.success).toBe(true);
            expect(
                mockCreateOrUpdatePullRequestMessagesUseCase.execute,
            ).toHaveBeenCalledWith(expect.any(Object), {
                organizationId: 'org-1',
                configLevel: ConfigLevel.GLOBAL,
                repositoryId: 'global',
                directoryId: undefined,
                startReviewMessage: {
                    status: 'only_when_opened',
                    content: 'Global start message',
                },
                endReviewMessage: {
                    status: 'off',
                    content: '',
                },
                globalSettings: {
                    hideComments: true,
                    suggestionCopyPrompt: false,
                },
            });
        });

        it('should skip custom messages sync when customMessages is not present', async () => {
            const configFiles: IConfigFileMeta[] = [{}];

            const configFileWithoutCustomMessages = {
                version: '2.0',
                automatedReviewActive: true,
            };

            // Mock config file fetch
            mockCodeBaseConfigService.getKodusConfigFile.mockResolvedValue(
                configFileWithoutCustomMessages,
            );

            // Mock parameter operations - different mocks for different keys
            mockParametersService.findByKey.mockImplementation(
                (key, orgAndTeamData) => {
                    if (key === ParametersKey.CENTRALIZED_CONFIG) {
                        return Promise.resolve({
                            configValue: {
                                enabled: true,
                                repository: {
                                    id: 'centralized-repo-1',
                                    name: 'centralized-repo',
                                },
                            },
                        });
                    }
                    if (key === ParametersKey.CODE_REVIEW_CONFIG) {
                        return Promise.resolve({
                            configValue: {},
                        });
                    }
                    return Promise.resolve({
                        configValue: {},
                    });
                },
            );

            mockUpdateOrCreateCodeReviewParameterUseCase.execute.mockResolvedValue(
                undefined,
            );

            const result = await service.synchronizeConfigs({
                organizationAndTeamData,
                configFiles,
                actor,
            });

            expect(result.success).toBe(true);
            expect(
                mockCreateOrUpdatePullRequestMessagesUseCase.execute,
            ).not.toHaveBeenCalled();
        });

        it('should handle errors in custom messages sync gracefully', async () => {
            const configFiles: IConfigFileMeta[] = [{}];

            const configFileWithCustomMessages = {
                version: '2.0',
                automatedReviewActive: true,
                customMessages: {
                    globalSettings: {
                        hideComments: false,
                        suggestionCopyPrompt: true,
                    },
                    startReviewMessage: {
                        status: 'every_push',
                        content: 'Custom start message',
                    },
                    endReviewMessage: {
                        status: 'every_push',
                        content: 'Custom end message',
                    },
                },
            };

            // Mock config file fetch
            mockCodeBaseConfigService.getKodusConfigFile.mockResolvedValue(
                configFileWithCustomMessages,
            );

            // Mock parameter operations - different mocks for different keys
            mockParametersService.findByKey.mockImplementation(
                (key, orgAndTeamData) => {
                    if (key === ParametersKey.CENTRALIZED_CONFIG) {
                        return Promise.resolve({
                            configValue: {
                                enabled: true,
                                repository: {
                                    id: 'centralized-repo-1',
                                    name: 'centralized-repo',
                                },
                            },
                        });
                    }
                    if (key === ParametersKey.CODE_REVIEW_CONFIG) {
                        return Promise.resolve({
                            configValue: {},
                        });
                    }
                    return Promise.resolve({
                        configValue: {},
                    });
                },
            );

            mockUpdateOrCreateCodeReviewParameterUseCase.execute.mockResolvedValue(
                undefined,
            );

            // Mock custom messages sync to fail
            mockCreateOrUpdatePullRequestMessagesUseCase.execute.mockRejectedValue(
                new Error('Custom messages sync failed'),
            );

            const result = await service.synchronizeConfigs({
                organizationAndTeamData,
                configFiles,
                actor,
            });

            // Should still succeed because custom messages errors don't fail the whole sync
            expect(result.success).toBe(true);
            expect(result.message).toBe(
                'Config files synchronized successfully',
            );
        });
    });
});
