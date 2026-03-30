import { createLogger } from '@kodus/flow';
import {
    CODE_BASE_CONFIG_SERVICE_TOKEN,
    ICodeBaseConfigService,
} from '@libs/code-review/domain/contracts/CodeBaseConfigService.contract';
import {
    ICentralizedConfigService,
    IConfigFileMeta,
} from '@libs/code-review/domain/contracts/CentralizedConfigService.contract';
import { ParametersKey } from '@libs/core/domain/enums';
import { IntegrationConfigKey } from '@libs/core/domain/enums/Integration-config-key.enum';
import { CodeReviewParameter } from '@libs/core/infrastructure/config/types/general/codeReviewConfig.type';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { ConfigLevel } from '@libs/core/infrastructure/config/types/general/pullRequestMessages.type';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@libs/integrations/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { CreateOrUpdateParametersUseCase } from '@libs/organization/application/use-cases/parameters/create-or-update-use-case';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@libs/organization/domain/parameters/contracts/parameters.service.contract';
import { Repositories } from '@libs/platform/domain/platformIntegrations/types/codeManagement/repositories.type';
import { CodeManagementService } from '@libs/platform/infrastructure/adapters/services/codeManagement.service';
import { DeleteRepositoryCodeReviewParameterUseCase } from '@libs/code-review/application/use-cases/configuration/delete-repository-code-review-parameter.use-case';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@libs/code-review/application/use-cases/configuration/update-or-create-code-review-parameter-use-case';
import { CreateOrUpdatePullRequestMessagesUseCase } from '@libs/code-review/application/use-cases/pullRequestMessages/create-or-update-pull-request-messages.use-case';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@libs/code-review/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { getDefaultKodusConfigFile } from '@libs/common/utils/validateCodeReviewConfigFile';
import { Inject, Injectable } from '@nestjs/common';
import path from 'path';
import { CustomMessageConfig } from 'apps/web/src/lib/services/pull-request-messages/types';
import { KodusConfigFile } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { DeepPartial } from 'typeorm';
import { CreateOrUpdateKodyRulesUseCase } from '@libs/kodyRules/application/use-cases/create-or-update.use-case';
import { DeleteRuleInOrganizationByIdKodyRulesUseCase } from '@libs/kodyRules/application/use-cases/delete-rule-in-organization-by-id.use-case';

@Injectable()
export class CentralizedConfigService implements ICentralizedConfigService {
    private readonly logger = createLogger(CentralizedConfigService.name);

    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        private readonly codeManagementService: CodeManagementService,
        private readonly updateOrCreateCodeReviewParameterUseCase: UpdateOrCreateCodeReviewParameterUseCase,
        private readonly deleteRepositoryCodeReviewParameterUseCase: DeleteRepositoryCodeReviewParameterUseCase,
        private readonly createOrUpdateParametersUseCase: CreateOrUpdateParametersUseCase,
        private readonly createOrUpdatePullRequestMessagesUseCase: CreateOrUpdatePullRequestMessagesUseCase,
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,
        @Inject(CODE_BASE_CONFIG_SERVICE_TOKEN)
        private readonly codeBaseConfigService: ICodeBaseConfigService,
        private readonly createOrUpdateKodyRulesUseCase: CreateOrUpdateKodyRulesUseCase,
        private readonly deleteRuleInOrganizationByIdKodyRulesUseCase: DeleteRuleInOrganizationByIdKodyRulesUseCase,
    ) {}

    async validateCentralizedConfig(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository?: { name: string; id: string };
    }): Promise<{
        success: boolean;
        message: string;
    }> {
        const { organizationAndTeamData } = params;

        const centralizedConfigParameter =
            await this.parametersService.findByKey(
                ParametersKey.CENTRALIZED_CONFIG,
                organizationAndTeamData,
            );

        if (
            !centralizedConfigParameter ||
            !centralizedConfigParameter.configValue?.enabled
        ) {
            return {
                success: false,
                message: 'Centralized config is not enabled for this team',
            };
        }

        if (params.repository) {
            const centralizedRepoId =
                centralizedConfigParameter.configValue.repository?.id;

            if (
                centralizedRepoId &&
                params.repository.id !== centralizedRepoId
            ) {
                this.logger.debug({
                    message:
                        'Centralized config is enabled but does not apply to this repository',
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        repository: params.repository,
                        centralizedRepoId,
                    },
                });
                return {
                    success: false,
                    message:
                        'Centralized config does not apply to this repository',
                };
            }
        }

        const { repository } = centralizedConfigParameter.configValue;

        if (!repository?.id) {
            this.logger.error({
                message:
                    'Centralized config is enabled, but no repository is configured to store the files',
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                },
            });

            return {
                success: false,
                message:
                    'Centralized config is enabled, but no repository is configured',
            };
        }

        return {
            success: true,
            message: 'Centralized config is valid and enabled',
        };
    }

    async getCentralizedConfigRepository(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{ name: string; id: string }> {
        const centralizedConfigParameter =
            await this.parametersService.findByKey(
                ParametersKey.CENTRALIZED_CONFIG,
                organizationAndTeamData,
            );

        if (!centralizedConfigParameter?.configValue?.repository) {
            throw new Error('Centralized config repository not configured');
        }

        return centralizedConfigParameter.configValue.repository;
    }

    async discoverConfigFiles(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: { name: string; id: string };
    }): Promise<IConfigFileMeta[]> {
        const { organizationAndTeamData, repository } = params;

        const repoTree = await this.codeManagementService.getRepositoryTree({
            organizationAndTeamData,
            repositoryId: repository.id,
        });

        const repositories =
            await this.integrationConfigService.findIntegrationConfigFormatted<
                Repositories[]
            >(IntegrationConfigKey.REPOSITORIES, {
                organizationId: organizationAndTeamData.organizationId,
                teamId: organizationAndTeamData.teamId,
            });

        if (!repositories || !Array.isArray(repositories)) {
            this.logger.warn({
                message: 'No repositories found in integration config',
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                },
            });
            return [];
        }

        const resolvedRepoIds = new Map<string, string>();
        for (const repo of repositories) {
            if (repo.name) {
                resolvedRepoIds.set(repo.name.toLowerCase(), repo.id);
            }

            if (repo.full_name) {
                resolvedRepoIds.set(repo.full_name.toLowerCase(), repo.id);
            }
        }

        const configFilePaths: IConfigFileMeta[] = [];

        for (const item of repoTree) {
            if (item.type === 'directory') {
                continue;
            }

            const fileName = path.basename(item.path);

            if (fileName !== 'kodus-config.yml') {
                continue;
            }

            const dirName = path.dirname(item.path);
            if (dirName === '.') {
                configFilePaths.push({});
                continue;
            }

            const directorySegments = dirName.split('/');
            const repoName = directorySegments[0];

            const repoId = resolvedRepoIds.get(repoName.toLowerCase());
            if (!repoId) {
                this.logger.warn({
                    message: `Could not resolve repository ID for repository name: ${repoName}`,
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        repoName,
                    },
                });
                continue;
            }

            const relativeDirectoryPath = directorySegments.slice(1).join('/');

            configFilePaths.push({
                repositoryId: repoId,
                centralizedDirectoryPath: dirName,
                directoryPath: relativeDirectoryPath
                    ? `/${relativeDirectoryPath}`
                    : undefined,
            });
        }

        return this.sortConfigFiles(configFilePaths);
    }

    async fetchConfigFile(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: { name: string; id: string };
        dir?: string;
    }) {
        const { organizationAndTeamData, repository, dir } = params;

        try {
            const file = await this.codeBaseConfigService.getKodusConfigFile({
                organizationAndTeamData,
                repository,
                directoryPath: dir,
                removeProperties: false,
            });

            return file;
        } catch (error) {
            this.logger.error({
                message:
                    'Error fetching centralized config file from repository',
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    repository,
                    dir,
                },
                error,
            });

            return null;
        }
    }

    async synchronizeConfigs(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        configFiles: IConfigFileMeta[];
        actor: {
            organizationId: string;
            source: 'web' | 'sync' | 'cli';
            userEmail: string;
            userId: string;
        };
    }): Promise<{
        success: boolean;
        message: string;
    }> {
        const { organizationAndTeamData, configFiles, actor } = params;

        try {
            const codeReviewConfig = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            const hasGlobalConfigFile = configFiles.some(
                (meta) => !meta.repositoryId,
            );

            if (!codeReviewConfig && !hasGlobalConfigFile) {
                await this.updateOrCreateCodeReviewParameterUseCase.execute({
                    actor,
                    skipAuthorization: true,
                    configValue: {},
                    organizationAndTeamData,
                    repositoryId: 'global',
                });
            }

            // Get the centralized config repository once
            const centralizedRepository =
                await this.getCentralizedConfigRepository(
                    organizationAndTeamData,
                );

            for (const configFileMeta of configFiles) {
                const {
                    centralizedDirectoryPath,
                    repositoryId,
                    directoryPath,
                } = configFileMeta;

                const configFile = await this.fetchConfigFile({
                    organizationAndTeamData,
                    repository: centralizedRepository,
                    dir: centralizedDirectoryPath,
                });

                if (!configFile) {
                    this.logger.warn({
                        message:
                            'Config file not found or could not be fetched',
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            centralizedDirectoryPath,
                            repositoryId,
                            directoryPath,
                        },
                    });
                    continue;
                }

                // Remove custom messages from config before storing in Postgres
                const configWithoutCustomMessages = { ...configFile };
                delete configWithoutCustomMessages.customMessages;

                await this.updateOrCreateCodeReviewParameterUseCase.execute({
                    actor,
                    skipAuthorization: true,
                    configValue: configWithoutCustomMessages,
                    organizationAndTeamData,
                    repositoryId,
                    directoryPath,
                });

                // Extract and sync custom messages separately
                const syncCustomMessagesResult = await this.syncCustomMessages(
                    configFile,
                    configFileMeta,
                    organizationAndTeamData,
                    centralizedRepository,
                    actor,
                );

                if (!syncCustomMessagesResult.success) {
                    this.logger.warn({
                        message:
                            'Failed to sync custom messages for config file',
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            centralizedDirectoryPath,
                            repositoryId,
                            directoryPath,
                            syncCustomMessagesMessage:
                                syncCustomMessagesResult.message,
                        },
                    });
                }
            }

            return {
                success: true,
                message: 'Config files synchronized successfully',
            };
        } catch (error) {
            this.logger.error({
                message: 'Error synchronizing config files',
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configFilesCount: configFiles.length,
                },
                error,
            });

            return {
                success: false,
                message: 'Error synchronizing config files',
            };
        }
    }

    async removeStaleConfigs(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        configFiles: IConfigFileMeta[];
        actor: {
            organizationId: string;
            source: 'sync' | 'web' | 'cli';
            userEmail: string;
            userId: string;
        };
    }): Promise<{
        success: boolean;
        message: string;
    }> {
        const { organizationAndTeamData, configFiles, actor } = params;

        try {
            const codeReviewConfig = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            if (!codeReviewConfig?.configValue) {
                return {
                    success: true,
                    message: 'No config to clean up',
                };
            }

            const desiredHasGlobalConfig = configFiles.some(
                (meta) => !meta.repositoryId,
            );

            const desiredRepositoryConfigs = new Set<string>(
                configFiles
                    .filter((meta) => meta.repositoryId && !meta.directoryPath)
                    .map((meta) => meta.repositoryId as string),
            );

            const desiredDirectoryConfigsByRepository = new Map<
                string,
                Set<string>
            >();

            const repositoriesWithDeletedDirectories = new Set<string>();

            for (const meta of configFiles) {
                if (!meta.repositoryId || !meta.directoryPath) {
                    continue;
                }

                if (
                    !desiredDirectoryConfigsByRepository.has(meta.repositoryId)
                ) {
                    desiredDirectoryConfigsByRepository.set(
                        meta.repositoryId,
                        new Set<string>(),
                    );
                }

                desiredDirectoryConfigsByRepository
                    .get(meta.repositoryId)
                    ?.add(meta.directoryPath);
            }

            // Reuse existing deletion logic for directory scope removals.
            for (const repository of codeReviewConfig.configValue
                .repositories ?? []) {
                const desiredDirectoryPaths =
                    desiredDirectoryConfigsByRepository.get(repository.id) ??
                    new Set<string>();

                const staleDirectories = (repository.directories ?? []).filter(
                    (directory) => !desiredDirectoryPaths.has(directory.path),
                );

                for (const staleDirectory of staleDirectories) {
                    await this.deleteRepositoryCodeReviewParameterUseCase.execute(
                        {
                            teamId: organizationAndTeamData.teamId,
                            repositoryId: repository.id,
                            directoryId: staleDirectory.id,
                            organizationAndTeamData,
                            actor,
                        },
                    );

                    repositoriesWithDeletedDirectories.add(repository.id);
                }
            }

            let refreshedCodeReviewConfig =
                await this.parametersService.findByKey(
                    ParametersKey.CODE_REVIEW_CONFIG,
                    organizationAndTeamData,
                );

            if (!refreshedCodeReviewConfig?.configValue) {
                return {
                    success: true,
                    message: 'Config cleaned up successfully',
                };
            }

            for (const repository of refreshedCodeReviewConfig.configValue
                .repositories ?? []) {
                const shouldKeepRepositoryConfig = desiredRepositoryConfigs.has(
                    repository.id,
                );

                if (shouldKeepRepositoryConfig) {
                    continue;
                }

                const hasDirectories =
                    (repository.directories ?? []).length > 0;
                if (hasDirectories) {
                    continue;
                }

                const hasRepositoryConfig =
                    Boolean(repository.isSelected) ||
                    Boolean(
                        repository.configs &&
                        Object.keys(repository.configs).length > 0,
                    );

                const shouldTriggerRepositoryRemovalSideEffects =
                    hasRepositoryConfig ||
                    repositoriesWithDeletedDirectories.has(repository.id);

                if (!shouldTriggerRepositoryRemovalSideEffects) {
                    continue;
                }

                await this.deleteRepositoryCodeReviewParameterUseCase.execute({
                    teamId: organizationAndTeamData.teamId,
                    repositoryId: repository.id,
                    organizationAndTeamData,
                    actor,
                });
            }

            refreshedCodeReviewConfig = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            if (!refreshedCodeReviewConfig?.configValue) {
                return {
                    success: true,
                    message: 'Config cleaned up successfully',
                };
            }

            let hasChanges = false;

            const reconciledConfig: CodeReviewParameter = {
                ...refreshedCodeReviewConfig.configValue,
                configs: desiredHasGlobalConfig
                    ? refreshedCodeReviewConfig.configValue.configs
                    : {},
                repositories: (
                    refreshedCodeReviewConfig.configValue.repositories ?? []
                ).map((repository) => {
                    const shouldKeepRepositoryConfig =
                        desiredRepositoryConfigs.has(repository.id);

                    const nextRepository = {
                        ...repository,
                        configs: shouldKeepRepositoryConfig
                            ? repository.configs
                            : {},
                        isSelected:
                            shouldKeepRepositoryConfig ||
                            (repository.directories ?? []).length > 0,
                    };

                    if (
                        !hasChanges &&
                        (nextRepository.isSelected !== repository.isSelected ||
                            JSON.stringify(nextRepository.configs) !==
                                JSON.stringify(repository.configs))
                    ) {
                        hasChanges = true;
                    }

                    return nextRepository;
                }),
            };

            if (
                !hasChanges &&
                (!desiredHasGlobalConfig ||
                    JSON.stringify(reconciledConfig.configs) !==
                        JSON.stringify(
                            refreshedCodeReviewConfig.configValue.configs,
                        ))
            ) {
                hasChanges = true;
            }

            if (!hasChanges) {
                return {
                    success: true,
                    message: 'No stale configs to remove',
                };
            }

            // Clean up stale custom messages before updating the main config
            const staleMessagesResult = await this.removeStaleCustomMessages(
                configFiles,
                organizationAndTeamData,
            );

            if (!staleMessagesResult.success) {
                this.logger.warn({
                    message: 'Failed to remove stale custom messages',
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        removeStaleMessagesMessage: staleMessagesResult.message,
                    },
                });
            }

            await this.createOrUpdateParametersUseCase.execute(
                ParametersKey.CODE_REVIEW_CONFIG,
                reconciledConfig,
                organizationAndTeamData,
            );

            return {
                success: true,
                message: 'Stale configs removed successfully',
            };
        } catch (error) {
            this.logger.error({
                message: 'Error removing stale configs',
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configFilesCount: configFiles.length,
                },
                error,
            });

            return {
                success: false,
                message: 'Error removing stale configs',
            };
        }
    }

    private sortConfigFiles(configFiles: IConfigFileMeta[]): IConfigFileMeta[] {
        const getPriority = (configFile: IConfigFileMeta) => {
            if (!configFile.repositoryId) {
                return 0;
            }

            if (!configFile.directoryPath) {
                return 1;
            }

            return 2;
        };

        return [...configFiles].sort((a, b) => {
            const priorityA = getPriority(a);
            const priorityB = getPriority(b);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            const depthA =
                a.directoryPath?.split('/').filter(Boolean).length ?? 0;
            const depthB =
                b.directoryPath?.split('/').filter(Boolean).length ?? 0;

            return depthA - depthB;
        });
    }

    //#region Custom Messages Sync Helpers
    private async syncCustomMessages(
        configFile: KodusConfigFile,
        configFileMeta: IConfigFileMeta,
        organizationAndTeamData: OrganizationAndTeamData,
        centralizedRepository: { name: string; id: string },
        actor: {
            organizationId: string;
            source: 'web' | 'sync' | 'cli';
            userEmail: string;
            userId: string;
        },
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        const { repositoryId, directoryPath } = configFileMeta;

        // 1. Determine config level and resolve directory ID FIRST
        let configLevel: ConfigLevel;
        let repositoryIdForMessages: string | undefined;
        let directoryId: string | undefined;

        let targetRepo: { id: string; name: string } | undefined;
        if (repositoryId) {
            const repositories =
                await this.integrationConfigService.findIntegrationConfigFormatted<
                    Repositories[]
                >(IntegrationConfigKey.REPOSITORIES, {
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                });

            const foundRepo = repositories?.find(
                (repo) => repo.id === repositoryId,
            );

            if (foundRepo && foundRepo.name) {
                targetRepo = { id: foundRepo.id, name: foundRepo.name };
            }
        }

        if (!repositoryId) {
            configLevel = ConfigLevel.GLOBAL;
            repositoryIdForMessages = 'global';
        } else if (!directoryPath) {
            configLevel = ConfigLevel.REPOSITORY;
            repositoryIdForMessages = repositoryId;
        } else {
            configLevel = ConfigLevel.DIRECTORY;
            repositoryIdForMessages = repositoryId;

            if (!targetRepo) {
                const message =
                    'Could not find target repository for directory ID resolution';
                this.logger.warn({
                    message,
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryPath,
                    },
                });
                return { success: false, message };
            }

            try {
                directoryId =
                    await this.codeBaseConfigService.getDirectoryIdForPath(
                        organizationAndTeamData,
                        targetRepo,
                        directoryPath,
                    );

                if (!directoryId) {
                    const message = `Could not resolve directory ID for custom messages`;
                    this.logger.warn({
                        message,
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            repositoryId,
                            directoryPath,
                        },
                    });
                    return { success: false, message };
                }
            } catch (error) {
                const message = `Error resolving directory ID for custom messages`;
                this.logger.error({
                    message,
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryPath,
                    },
                    error,
                });
                return { success: false, message };
            }
        }

        // 2. Now check if custom messages exist in the file
        const customMessages = configFile.customMessages;

        if (!customMessages) {
            try {
                const existingEntity =
                    await this.pullRequestMessagesService?.findOne({
                        organizationId: organizationAndTeamData.organizationId,
                        configLevel,
                        repositoryId: repositoryIdForMessages,
                        directoryId,
                    });

                if (existingEntity?.uuid) {
                    this.logger.log({
                        message:
                            'Removing orphaned custom messages (file exists but messages block was removed)',
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            configLevel,
                            repositoryId: repositoryIdForMessages,
                            directoryId,
                            entityUuid: existingEntity.uuid,
                        },
                    });

                    await this.pullRequestMessagesService.delete(
                        existingEntity.uuid,
                    );

                    return {
                        success: true,
                        message:
                            'Orphaned custom messages removed successfully',
                    };
                }
            } catch (error) {
                this.logger.warn({
                    message:
                        'Failed to check or remove orphaned custom messages',
                    context: CentralizedConfigService.name,
                    metadata: {
                        organizationAndTeamData,
                        configLevel,
                        repositoryId: repositoryIdForMessages,
                    },
                    error,
                });
            }

            return {
                success: true,
                message: 'No custom messages to sync',
            };
        }

        // 3. Proceed with normal creation/updating if custom messages DO exist
        try {
            const resolvedCustomMessages =
                await this.resolveCustomMessagesWithInheritance(
                    organizationAndTeamData,
                    configLevel,
                    targetRepo,
                    repositoryIdForMessages,
                    directoryId,
                    directoryPath,
                    customMessages,
                );

            const pullRequestMessages = {
                organizationId: organizationAndTeamData.organizationId,
                configLevel,
                repositoryId: repositoryIdForMessages,
                directoryId,
                startReviewMessage: resolvedCustomMessages.startReviewMessage,
                endReviewMessage: resolvedCustomMessages.endReviewMessage,
                globalSettings: resolvedCustomMessages.globalSettings,
            };

            const userInfo = {
                uuid: actor.userId,
                email: actor.userEmail,
                organization: { uuid: actor.organizationId },
            };

            await this.createOrUpdatePullRequestMessagesUseCase.execute(
                userInfo,
                pullRequestMessages,
            );

            const message = 'Custom messages synced successfully';
            this.logger.log({
                message,
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configLevel,
                    repositoryId: repositoryIdForMessages,
                    directoryId,
                },
            });

            return { success: true, message };
        } catch (error) {
            const message = 'Failed to sync custom messages';
            this.logger.error({
                message,
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configLevel,
                    repositoryId: repositoryIdForMessages,
                    directoryId,
                },
                error,
            });

            return { success: false, message };
        }
    }

    private async resolveCustomMessagesWithInheritance(
        organizationAndTeamData: OrganizationAndTeamData,
        configLevel: ConfigLevel,
        targetRepo: { id: string; name: string } | undefined,
        repositoryId: string | undefined,
        directoryId: string | undefined,
        directoryPath: string | undefined,
        customMessagesFromFile: DeepPartial<CustomMessageConfig>,
    ): Promise<CustomMessageConfig> {
        // Get the default custom messages
        const { customMessages: defaultMessages } = getDefaultKodusConfigFile();

        // Get existing parent configs to merge with
        const parentMessages = await this.getResolvedParentCustomMessages(
            organizationAndTeamData,
            configLevel,
            targetRepo,
            repositoryId,
            directoryId,
            directoryPath,
        );

        // Merge: default -> parent -> file overrides
        return this.mergeCustomMessages(
            defaultMessages,
            parentMessages,
            customMessagesFromFile,
        );
    }

    private async getResolvedParentCustomMessages(
        organizationAndTeamData: OrganizationAndTeamData,
        configLevel: ConfigLevel,
        targetRepo: { id: string; name: string } | undefined,
        repositoryId: string | undefined,
        directoryId: string | undefined,
        directoryPath: string | undefined,
    ): Promise<Partial<CustomMessageConfig>> {
        const globalEntity = await this.pullRequestMessagesService?.findOne({
            organizationId: organizationAndTeamData.organizationId,
            configLevel: ConfigLevel.GLOBAL,
        });
        const globalMessages =
            this.extractCustomMessagesFromEntity(globalEntity);

        if (configLevel === ConfigLevel.GLOBAL) {
            return globalMessages;
        }

        const repoEntity = await this.pullRequestMessagesService?.findOne({
            organizationId: organizationAndTeamData.organizationId,
            repositoryId,
            configLevel: ConfigLevel.REPOSITORY,
        });
        const repoMessages = this.extractCustomMessagesFromEntity(repoEntity);

        let mergedMessages = this.mergeCustomMessages(
            {},
            globalMessages,
            repoMessages,
        );

        if (configLevel === ConfigLevel.REPOSITORY) {
            return mergedMessages;
        }

        if (
            configLevel === ConfigLevel.DIRECTORY &&
            directoryPath &&
            targetRepo
        ) {
            // Trim slashes and split path
            const cleanPath = directoryPath.replace(/^\/+|\/+$/g, '');
            const segments = cleanPath.split('/');

            // Traverse parent directories sequentially
            let currentPath = '';
            for (let i = 0; i < segments.length - 1; i++) {
                currentPath = currentPath
                    ? `${currentPath}/${segments[i]}`
                    : segments[i];

                try {
                    const parentDirId =
                        await this.codeBaseConfigService.getDirectoryIdForPath(
                            organizationAndTeamData,
                            targetRepo,
                            currentPath,
                        );

                    if (parentDirId) {
                        const parentDirEntity =
                            await this.pullRequestMessagesService?.findOne({
                                organizationId:
                                    organizationAndTeamData.organizationId,
                                repositoryId,
                                directoryId: parentDirId,
                                configLevel: ConfigLevel.DIRECTORY,
                            });

                        if (parentDirEntity) {
                            const parentDirMessages =
                                this.extractCustomMessagesFromEntity(
                                    parentDirEntity,
                                );
                            mergedMessages = this.mergeCustomMessages(
                                mergedMessages,
                                parentDirMessages,
                            );
                        }
                    }
                } catch (error) {
                    this.logger.warn({
                        message: `Failed to resolve parent directory messages for path: ${currentPath}`,
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            repositoryId,
                            directoryPath,
                        },
                        error,
                    });
                }
            }
        }

        return mergedMessages;
    }

    private extractCustomMessagesFromEntity(
        entity: any,
    ): Partial<CustomMessageConfig> {
        if (!entity) {
            return {};
        }

        const json = entity.toJson ? entity.toJson() : entity;
        return {
            startReviewMessage: json?.startReviewMessage,
            endReviewMessage: json?.endReviewMessage,
            globalSettings: json?.globalSettings,
        };
    }

    private mergeCustomMessages(
        base: any,
        ...overrides: any[]
    ): CustomMessageConfig {
        const merged = { ...base };

        for (const override of overrides) {
            if (override.startReviewMessage) {
                merged.startReviewMessage = override.startReviewMessage;
            }
            if (override.endReviewMessage) {
                merged.endReviewMessage = override.endReviewMessage;
            }
            if (override.globalSettings) {
                merged.globalSettings = {
                    ...merged.globalSettings,
                    ...override.globalSettings,
                };
            }
        }

        let defaultConfigs: DeepPartial<CustomMessageConfig> | undefined;
        if (
            !merged.startReviewMessage ||
            !merged.endReviewMessage ||
            !merged.globalSettings?.hideComments ||
            !merged.globalSettings?.suggestionCopyPrompt
        ) {
            const defaultConfigFile = getDefaultKodusConfigFile();
            defaultConfigs = defaultConfigFile?.customMessages;

            if (!defaultConfigs) {
                this.logger.warn({
                    message:
                        'Default custom messages are missing from default config file',
                    context: CentralizedConfigService.name,
                });

                throw new Error(
                    'Default custom messages are missing from default config file',
                );
            }
        }

        // Ensure all required fields are present with defaults
        return {
            startReviewMessage:
                merged.startReviewMessage || defaultConfigs?.startReviewMessage,
            endReviewMessage:
                merged.endReviewMessage || defaultConfigs?.endReviewMessage,
            globalSettings: {
                hideComments:
                    merged.globalSettings?.hideComments ??
                    defaultConfigs?.globalSettings?.hideComments,
                suggestionCopyPrompt:
                    merged.globalSettings?.suggestionCopyPrompt ??
                    defaultConfigs?.globalSettings?.suggestionCopyPrompt,
            },
        };
    }

    private async removeStaleCustomMessages(
        configFiles: IConfigFileMeta[],
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            const existingMessages =
                await this.pullRequestMessagesService?.find({
                    organizationId: organizationAndTeamData.organizationId,
                });

            if (!existingMessages || existingMessages.length === 0) {
                return {
                    success: true,
                    message: 'No existing custom messages to remove',
                };
            }

            const repositories =
                await this.integrationConfigService.findIntegrationConfigFormatted<
                    Repositories[]
                >(IntegrationConfigKey.REPOSITORIES, {
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                });

            const desiredKeys = new Set<string>();

            for (const meta of configFiles) {
                if (!meta.repositoryId) {
                    desiredKeys.add(`GLOBAL`);
                } else if (!meta.directoryPath) {
                    desiredKeys.add(`REPO:${meta.repositoryId}`);
                } else {
                    const targetRepo = repositories?.find(
                        (repo) => repo.id === meta.repositoryId,
                    );

                    if (targetRepo?.name) {
                        try {
                            const directoryId =
                                await this.codeBaseConfigService.getDirectoryIdForPath(
                                    organizationAndTeamData,
                                    {
                                        id: targetRepo.id,
                                        name: targetRepo.name,
                                    },
                                    meta.directoryPath,
                                );

                            if (directoryId) {
                                desiredKeys.add(`DIR:${directoryId}`);
                            }
                        } catch (error) {
                            this.logger.warn({
                                message: `Failed to resolve directory ID for stale message cleanup for path: ${meta.directoryPath}`,
                                context: CentralizedConfigService.name,
                                metadata: {
                                    organizationAndTeamData,
                                    repositoryId: meta.repositoryId,
                                    directoryPath: meta.directoryPath,
                                },
                                error,
                            });
                        }
                    }
                }
            }

            // 3. Compare and delete stale entities
            for (const message of existingMessages) {
                let key: string | undefined;

                if (message.configLevel === ConfigLevel.GLOBAL) {
                    key = 'GLOBAL';
                } else if (
                    message.configLevel === ConfigLevel.REPOSITORY &&
                    message.repositoryId
                ) {
                    key = `REPO:${message.repositoryId}`;
                } else if (
                    message.configLevel === ConfigLevel.DIRECTORY &&
                    message.directoryId
                ) {
                    key = `DIR:${message.directoryId}`;
                }

                if (key && !desiredKeys.has(key)) {
                    // Extract the UUID from the entity
                    const entityUuid = message.uuid;

                    if (!entityUuid) {
                        this.logger.warn({
                            message:
                                'Cannot delete stale message: missing uuid on entity',
                            context: CentralizedConfigService.name,
                            metadata: {
                                organizationAndTeamData,
                                configLevel: message.configLevel,
                                repositoryId: message.repositoryId,
                            },
                        });
                        continue;
                    }

                    this.logger.log({
                        message: 'Removing stale custom message configuration',
                        context: CentralizedConfigService.name,
                        metadata: {
                            organizationAndTeamData,
                            configLevel: message.configLevel,
                            repositoryId: message.repositoryId,
                            directoryId: message.directoryId,
                            entityUuid,
                        },
                    });

                    // Execute deletion using only the uuid
                    await this.pullRequestMessagesService.delete(entityUuid);
                }
            }

            const message = 'Stale custom messages removed successfully';
            this.logger.log({
                message,
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configFilesCount: configFiles.length,
                },
            });

            return {
                success: true,
                message,
            };
        } catch (error) {
            const message = 'Error removing stale custom messages';
            this.logger.error({
                message,
                context: CentralizedConfigService.name,
                metadata: {
                    organizationAndTeamData,
                    configFilesCount: configFiles.length,
                },
                error,
            });

            return {
                success: false,
                message,
            };
        }
    }
    //#endregion

    //#region Kody Rules Sync Helpers
    private async syncKodyRules(
        configFile: KodusConfigFile,
        organizationAndTeamData: OrganizationAndTeamData,
        actor: {
            organizationId: string;
            source: 'web' | 'sync' | 'cli';
            userEmail: string;
            userId: string;
        },
    ): Promise<{
        success: boolean;
        message: string;
    }> {}
}
