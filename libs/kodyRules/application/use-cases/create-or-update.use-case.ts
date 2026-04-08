import { createLogger } from '@kodus/flow';
import {
    CentralizedConfigPrService,
    CentralizedPrMetadata,
} from '@libs/centralized-config/infrastructure/adapters/services/centralized-config-pr.service';
import {
    Inject,
    Injectable,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

import { PromptSourceType } from '@libs/ai-engine/domain/prompt/interfaces/promptExternalReference.interface';
import { ContextReferenceDetectionService } from '@libs/ai-engine/infrastructure/adapters/services/context/context-reference-detection.service';
import type { ContextDetectionField } from '@libs/ai-engine/infrastructure/adapters/services/context/context-reference-detection.service';
import { CreateKodyRuleDto } from '@libs/ee/kodyRules/dtos/create-kody-rule.dto';
import {
    buildKodyRuleCentralizedFilePath,
    buildKodyRuleCentralizedMutationRequest,
} from '@libs/mcp-server/tools/kody-rules-centralized-pr.builder';
import {
    CONTEXT_RESOLUTION_SERVICE_TOKEN,
    IContextResolutionService,
} from '@libs/core/context-resolution/domain/contracts/context-resolution.service.contract';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import {
    Action,
    ResourceType,
} from '@libs/identity/domain/permissions/enums/permissions.enum';
import { AuthorizationService } from '@libs/identity/infrastructure/adapters/services/permissions/authorization.service';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@libs/kodyRules/domain/contracts/kodyRules.service.contract';
import {
    IKodyRule,
    KodyRulesOrigin,
    KodyRulesStatus,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

@Injectable()
export class CreateOrUpdateKodyRulesUseCase {
    private readonly logger = createLogger(CreateOrUpdateKodyRulesUseCase.name);
    constructor(
        @Optional()
        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                organization: { uuid: string };
                uuid: string;
                email: string;
            };
        },

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,
        @Inject(CONTEXT_RESOLUTION_SERVICE_TOKEN)
        private readonly contextResolutionService: IContextResolutionService,

        private readonly authorizationService: AuthorizationService,
        private readonly contextReferenceDetectionService: ContextReferenceDetectionService,
        private readonly centralizedConfigPrService: CentralizedConfigPrService,
    ) {}

    async execute(
        kodyRule: CreateKodyRuleDto,
        organizationId: string,
        userInfo?: { userId: string; userEmail: string },
        skipAuthorization?: boolean,
    ): Promise<Partial<any> | CentralizedPrMetadata> {
        try {
            const req: any = this.request as any;
            const reqUser = req?.user;

            const organizationAndTeamData: OrganizationAndTeamData = {
                organizationId,
                teamId: reqUser?.team?.uuid || reqUser?.teamId,
            };

            const userInfoData =
                userInfo ||
                (reqUser?.uuid && reqUser?.email
                    ? { userId: reqUser.uuid, userEmail: reqUser.email }
                    : { userId: 'kody-system', userEmail: 'kody@kodus.io' });

            const bypassCentralizedRouting =
                this.isInternalSyncActor(userInfoData);

            if (
                !skipAuthorization &&
                userInfoData.userId !== 'kody-system' &&
                this.request?.user
            ) {
                await this.authorizationService.ensure({
                    user: this.request.user,
                    action: Action.Create,
                    resource: ResourceType.KodyRules,
                    repoIds: kodyRule.repositoryId
                        ? [kodyRule.repositoryId]
                        : undefined,
                });
            }

            if (!bypassCentralizedRouting) {
                const centralizedPr =
                    await this.createCentralizedMutationIfEnabled(
                        organizationAndTeamData,
                        kodyRule,
                        userInfoData,
                    );

                if (centralizedPr) {
                    return centralizedPr;
                }
            }

            const result = await this.kodyRulesService.createOrUpdate(
                organizationAndTeamData,
                kodyRule,
                userInfoData,
            );

            if (!result) {
                throw new NotFoundException(
                    'Failed to create or update kody rule',
                );
            }

            if (result.uuid && kodyRule.repositoryId && kodyRule.rule) {
                this.logger.log({
                    message:
                        'Rule created/updated, triggering reference detection',
                    context: CreateOrUpdateKodyRulesUseCase.name,
                    metadata: {
                        ruleId: result.uuid,
                        ruleTitle: kodyRule.title,
                        repositoryId: kodyRule.repositoryId,
                        hasRuleText: !!kodyRule.rule,
                        ruleTextLength: kodyRule.rule.length,
                        organizationAndTeamData,
                    },
                });

                this.detectAndSaveReferencesAsync(
                    result.uuid,
                    kodyRule.rule,
                    kodyRule.repositoryId,
                    organizationAndTeamData,
                ).catch((error) => {
                    this.logger.error({
                        message:
                            'Background reference detection failed completely',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        error: this.normalizeError(error),
                        metadata: {
                            ruleId: result.uuid,
                            ruleTitle: kodyRule.title,
                            organizationAndTeamData,
                        },
                    });
                });
            } else {
                this.logger.warn({
                    message:
                        'Reference detection skipped - missing required fields',
                    context: CreateOrUpdateKodyRulesUseCase.name,
                    metadata: {
                        ruleId: result.uuid,
                        hasRepositoryId: !!kodyRule.repositoryId,
                        hasRuleText: !!kodyRule.rule,
                        repositoryId: kodyRule.repositoryId,
                        organizationAndTeamData,
                    },
                });
            }

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Could not create or update Kody rules',
                context: CreateOrUpdateKodyRulesUseCase.name,
                serviceName: 'CreateOrUpdateKodyRulesUseCase',
                error: this.normalizeError(error),
                metadata: {
                    kodyRule,
                    organizationAndTeamData: {
                        organizationId,
                    },
                },
            });
            throw error;
        }
    }

    private async createCentralizedMutationIfEnabled(
        organizationAndTeamData: OrganizationAndTeamData,
        kodyRule: CreateKodyRuleDto,
        userInfo: { userId: string; userEmail: string },
    ): Promise<CentralizedPrMetadata | null> {
        const existingRule =
            kodyRule.uuid &&
            (await this.kodyRulesService.findById(kodyRule.uuid));

        const effectiveRule = {
            ...existingRule,
            ...kodyRule,
        };

        if (!effectiveRule.title || !effectiveRule.repositoryId) {
            return null;
        }

        const resolvedOrgAndTeamData = await this.resolveTeamContextIfMissing(
            organizationAndTeamData,
            effectiveRule.repositoryId,
        );

        const ruleType =
            (effectiveRule.type as KodyRulesType) || KodyRulesType.STANDARD;

        const pr =
            await this.centralizedConfigPrService.createMutationPullRequestIfEnabled(
                buildKodyRuleCentralizedMutationRequest({
                    centralizedConfigPrService: this.centralizedConfigPrService,
                    organizationAndTeamData: resolvedOrgAndTeamData,
                    repositoryId: effectiveRule.repositoryId,
                    ruleContent: effectiveRule,
                    ruleType,
                    operation: kodyRule.uuid ? 'update' : 'create',
                }),
            );

        if (pr.mode !== 'centralized-pr') {
            return null;
        }

        await this.persistRuleAsPendingMerge(
            resolvedOrgAndTeamData,
            effectiveRule,
            ruleType,
            userInfo,
        );

        return pr;
    }

    private async persistRuleAsPendingMerge(
        organizationAndTeamData: OrganizationAndTeamData,
        effectiveRule: Partial<IKodyRule>,
        ruleType: KodyRulesType,
        userInfo: { userId: string; userEmail: string },
    ): Promise<void> {
        if (!effectiveRule.title || !effectiveRule.repositoryId) {
            return;
        }

        try {
            const repositoryFolder =
                await this.centralizedConfigPrService.resolveRepositoryFolderName(
                    organizationAndTeamData,
                    effectiveRule.repositoryId,
                );

            const centralizedSourcePath = buildKodyRuleCentralizedFilePath({
                centralizedConfigPrService: this.centralizedConfigPrService,
                repositoryFolder,
                rulesDirectory:
                    ruleType === KodyRulesType.MEMORY ? 'memories' : 'review',
                ruleContent: effectiveRule,
            });

            await this.kodyRulesService.createOrUpdate(
                organizationAndTeamData,
                {
                    ...(effectiveRule as CreateKodyRuleDto),
                    type: ruleType,
                    repositoryId: effectiveRule.repositoryId,
                    origin: effectiveRule.origin || KodyRulesOrigin.USER,
                    status: KodyRulesStatus.PENDING_MERGE,
                    centralizedSourcePath,
                },
                userInfo,
            );
        } catch (error) {
            this.logger.warn({
                message:
                    'Centralized PR was created, but failed to persist pending_merge rule snapshot',
                context: CreateOrUpdateKodyRulesUseCase.name,
                error: this.normalizeError(error),
                metadata: {
                    organizationAndTeamData,
                    ruleId: effectiveRule.uuid,
                    repositoryId: effectiveRule.repositoryId,
                },
            });
        }
    }

    private async resolveTeamContextIfMissing(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<OrganizationAndTeamData> {
        if (
            organizationAndTeamData.teamId ||
            !repositoryId ||
            repositoryId === 'global'
        ) {
            return organizationAndTeamData;
        }

        try {
            const resolvedTeamId =
                await this.contextResolutionService.getTeamIdByOrganizationAndRepository(
                    organizationAndTeamData.organizationId,
                    repositoryId,
                );

            if (!resolvedTeamId) {
                return organizationAndTeamData;
            }

            return {
                ...organizationAndTeamData,
                teamId: resolvedTeamId,
            };
        } catch (error) {
            this.logger.warn({
                message:
                    'Failed to resolve team context for centralized kody rule mutation',
                context: CreateOrUpdateKodyRulesUseCase.name,
                error: this.normalizeError(error),
                metadata: {
                    organizationId: organizationAndTeamData.organizationId,
                    repositoryId,
                },
            });

            return organizationAndTeamData;
        }
    }

    private async detectAndSaveReferencesAsync(
        ruleId: string,
        ruleText: string,
        repositoryId: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void> {
        return new Promise((resolve) => {
            setImmediate(async () => {
                try {
                    let resolvedTeamId: string | undefined;
                    if (
                        repositoryId !== 'global' &&
                        !organizationAndTeamData.teamId
                    ) {
                        try {
                            resolvedTeamId =
                                await this.contextResolutionService.getTeamIdByOrganizationAndRepository(
                                    organizationAndTeamData.organizationId,
                                    repositoryId,
                                );
                        } catch (error) {
                            this.logger.warn({
                                message:
                                    'Failed to resolve team for repository, detection may miss cross-repo context',
                                context: CreateOrUpdateKodyRulesUseCase.name,
                                error: this.normalizeError(error),
                                metadata: {
                                    repositoryId,
                                    organizationAndTeamData,
                                },
                            });
                        }
                    }

                    let repositoryName: string;
                    try {
                        if (repositoryId === 'global') {
                            repositoryName = 'global';
                        } else {
                            repositoryName =
                                await this.contextResolutionService.getRepositoryNameByOrganizationAndRepository(
                                    organizationAndTeamData.organizationId,
                                    repositoryId,
                                );
                        }
                    } catch (error) {
                        this.logger.warn({
                            message:
                                'Failed to resolve repository name, using ID as fallback',
                            context: CreateOrUpdateKodyRulesUseCase.name,
                            error: this.normalizeError(error),
                            metadata: {
                                repositoryId,
                                organizationAndTeamData,
                            },
                        });
                        repositoryName = repositoryId;
                    }

                    const detectionOrgData: OrganizationAndTeamData =
                        resolvedTeamId
                            ? {
                                  ...organizationAndTeamData,
                                  teamId: resolvedTeamId,
                              }
                            : organizationAndTeamData;

                    const detectionFields: ContextDetectionField[] = [
                        {
                            fieldId: '',
                            path: ['kodyRule', ruleId],
                            sourceType: PromptSourceType.KODY_RULE,
                            text: ruleText,
                            metadata: {
                                sourceSnippet: ruleText,
                            },
                            consumerKind: 'prompt',
                            consumerName: ruleId,
                            conversationIdOverride: ruleId,
                            requestDomain: 'code',
                            taskIntent: 'Process kodyRule references',
                        },
                    ];

                    const contextReferenceId =
                        await this.contextReferenceDetectionService.detectAndSaveReferences(
                            {
                                entityType: 'kodyRule',
                                entityId: ruleId,
                                fields: detectionFields,
                                repositoryId,
                                repositoryName,
                                organizationAndTeamData: detectionOrgData,
                            },
                        );

                    await this.kodyRulesService.updateRuleReferences(
                        organizationAndTeamData.organizationId,
                        ruleId,
                        {
                            contextReferenceId,
                        },
                    );

                    this.logger.log({
                        message:
                            'KodyRule successfully processed with Context OS',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        metadata: {
                            ruleId,
                            contextReferenceId,
                            repositoryId,
                        },
                    });
                } catch (error) {
                    this.logger.error({
                        message: 'Failed to process kodyRule with Context OS',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        error: this.normalizeError(error),
                        metadata: {
                            ruleId,
                            repositoryId,
                            organizationAndTeamData,
                        },
                    });
                }

                resolve();
            });
        });
    }

    private normalizeError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }

    private isInternalSyncActor(userInfo: {
        userId: string;
        userEmail: string;
    }): boolean {
        return (
            userInfo.userId === 'kody' && userInfo.userEmail === 'kody@kodus.io'
        );
    }
}
