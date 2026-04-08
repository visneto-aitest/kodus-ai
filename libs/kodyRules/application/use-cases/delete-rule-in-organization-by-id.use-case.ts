import { createLogger } from '@kodus/flow';
import { Injectable, Inject, Optional } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

import {
    CentralizedConfigPrService,
    CentralizedPrMetadata,
} from '@libs/centralized-config/infrastructure/adapters/services/centralized-config-pr.service';
import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@libs/kodyRules/domain/contracts/kodyRules.service.contract';
import { buildKodyRuleCentralizedMutationRequest } from '@libs/mcp-server/tools/kody-rules-centralized-pr.builder';
import { UserRequest } from '@libs/core/infrastructure/config/types/http/user-request.type';
import { KodyRulesType } from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

@Injectable()
export class DeleteRuleInOrganizationByIdKodyRulesUseCase {
    private readonly logger = createLogger(
        DeleteRuleInOrganizationByIdKodyRulesUseCase.name,
    );
    constructor(
        @Optional()
        @Inject(REQUEST)
        private readonly request: UserRequest,

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly centralizedConfigPrService: CentralizedConfigPrService,
    ) {}

    async execute(
        ruleId: string,
        actor?: {
            source?: 'cli' | 'web' | 'sync';
            organizationId?: string;
            teamId?: string;
            userId?: string;
            userEmail?: string;
        },
    ): Promise<boolean | CentralizedPrMetadata> {
        try {
            const requestUser = this.request?.user as any;
            const organizationId =
                actor?.organizationId || requestUser.organization.uuid;
            const teamId = actor?.teamId || requestUser?.team?.uuid;

            const existingRule = await this.kodyRulesService.findById(ruleId);

            if (existingRule && actor?.source !== 'sync') {
                const pr =
                    await this.centralizedConfigPrService.createMutationPullRequestIfEnabled(
                        buildKodyRuleCentralizedMutationRequest({
                            centralizedConfigPrService:
                                this.centralizedConfigPrService,
                            organizationAndTeamData: {
                                organizationId,
                                teamId,
                            },
                            repositoryId: existingRule.repositoryId,
                            ruleContent: existingRule,
                            ruleType:
                                (existingRule.type as KodyRulesType) ||
                                KodyRulesType.STANDARD,
                            operation: 'delete',
                        }),
                    );

                if (pr.mode === 'centralized-pr') {
                    return pr;
                }
            }

            return await this.kodyRulesService.deleteRuleWithLogging(
                {
                    organizationId,
                },
                ruleId,
                {
                    userId: actor?.userId || requestUser.uuid,
                    userEmail: actor?.userEmail || requestUser.email,
                },
            );
        } catch (error) {
            this.logger.error({
                message: 'Error deleting Kody Rule in organization by ID',
                context: DeleteRuleInOrganizationByIdKodyRulesUseCase.name,
                error: error,
                metadata: {
                    organizationId:
                        actor?.organizationId ||
                        this.request.user.organization.uuid,
                    ruleId,
                },
            });
            throw error;
        }
    }
}
