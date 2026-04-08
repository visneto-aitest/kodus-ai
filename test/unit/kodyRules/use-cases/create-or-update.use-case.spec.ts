import { REQUEST } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { ContextReferenceDetectionService } from '@libs/ai-engine/infrastructure/adapters/services/context/context-reference-detection.service';
import {
    CONTEXT_RESOLUTION_SERVICE_TOKEN,
    IContextResolutionService,
} from '@libs/core/context-resolution/domain/contracts/context-resolution.service.contract';
import {
    CentralizedConfigPrService,
    CentralizedPrMetadata,
} from '@libs/centralized-config/infrastructure/adapters/services/centralized-config-pr.service';
import { CreateOrUpdateKodyRulesUseCase } from '@libs/kodyRules/application/use-cases/create-or-update.use-case';
import { AuthorizationService } from '@libs/identity/infrastructure/adapters/services/permissions/authorization.service';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@libs/kodyRules/domain/contracts/kodyRules.service.contract';
import {
    KodyRulesOrigin,
    KodyRulesScope,
    KodyRulesStatus,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

jest.mock('@kodus/flow', () => ({
    createLogger: () => ({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    }),
}));

describe('CreateOrUpdateKodyRulesUseCase (centralized pending merge)', () => {
    let useCase: CreateOrUpdateKodyRulesUseCase;
    let kodyRulesServiceMock: jest.Mocked<IKodyRulesService>;
    let centralizedConfigPrServiceMock: {
        createMutationPullRequestIfEnabled: jest.Mock;
        resolveRepositoryFolderName: jest.Mock;
        buildCentralizedPath: jest.Mock;
        sanitizeFileName: jest.Mock;
    };

    beforeEach(async () => {
        kodyRulesServiceMock = {
            createOrUpdate: jest.fn(),
            findById: jest.fn(),
            updateRuleReferences: jest.fn(),
        } as unknown as jest.Mocked<IKodyRulesService>;

        centralizedConfigPrServiceMock = {
            createMutationPullRequestIfEnabled: jest.fn(),
            resolveRepositoryFolderName: jest.fn(),
            buildCentralizedPath: jest.fn(),
            sanitizeFileName: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CreateOrUpdateKodyRulesUseCase,
                {
                    provide: KODY_RULES_SERVICE_TOKEN,
                    useValue: kodyRulesServiceMock,
                },
                {
                    provide: CONTEXT_RESOLUTION_SERVICE_TOKEN,
                    useValue: {
                        getTeamIdByOrganizationAndRepository: jest.fn(),
                        getRepositoryNameByOrganizationAndRepository: jest.fn(),
                    } as Partial<IContextResolutionService>,
                },
                {
                    provide: AuthorizationService,
                    useValue: {
                        ensure: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: ContextReferenceDetectionService,
                    useValue: {
                        detectAndSaveReferences: jest.fn(),
                    },
                },
                {
                    provide: CentralizedConfigPrService,
                    useValue: centralizedConfigPrServiceMock,
                },
                {
                    provide: REQUEST,
                    useValue: {
                        user: {
                            organization: { uuid: 'org-1' },
                            team: { uuid: 'team-1' },
                            uuid: 'user-1',
                            email: 'dev@kodus.io',
                        },
                    },
                },
            ],
        }).compile();

        useCase = module.get(CreateOrUpdateKodyRulesUseCase);
    });

    it('persists create flow as pending_merge when centralized PR mode is active', async () => {
        centralizedConfigPrServiceMock.createMutationPullRequestIfEnabled.mockResolvedValue(
            {
                mode: 'centralized-pr',
                prUrl: 'https://example.com/pr/10',
            } as CentralizedPrMetadata,
        );
        centralizedConfigPrServiceMock.resolveRepositoryFolderName.mockResolvedValue(
            'repo-one',
        );
        centralizedConfigPrServiceMock.sanitizeFileName.mockReturnValue(
            'avoid-debug',
        );
        centralizedConfigPrServiceMock.buildCentralizedPath.mockImplementation(
            ({ repositoryFolder, relativePath }) =>
                `${repositoryFolder}/${relativePath}`,
        );

        kodyRulesServiceMock.findById.mockResolvedValue(null);
        kodyRulesServiceMock.createOrUpdate.mockResolvedValue({
            uuid: 'rule-1',
        } as any);

        const result = await useCase.execute(
            {
                type: KodyRulesType.STANDARD,
                title: 'Avoid debug logs',
                rule: 'Do not commit debug logs',
                severity: 'medium' as any,
                scope: KodyRulesScope.FILE,
                path: '**/*',
                origin: KodyRulesOrigin.USER,
                repositoryId: 'repo-1',
                examples: [],
            },
            'org-1',
        );

        expect(result).toEqual(
            expect.objectContaining({ mode: 'centralized-pr' }),
        );

        expect(kodyRulesServiceMock.createOrUpdate).toHaveBeenCalledWith(
            {
                organizationId: 'org-1',
                teamId: 'team-1',
            },
            expect.objectContaining({
                status: KodyRulesStatus.PENDING_MERGE,
                centralizedSourcePath:
                    'repo-one/.kody-rules/review/avoid-debug.yml',
            }),
            {
                userId: 'user-1',
                userEmail: 'dev@kodus.io',
            },
        );
    });

    it('keeps existing centralizedSourcePath when updating a pending_merge rule', async () => {
        centralizedConfigPrServiceMock.createMutationPullRequestIfEnabled.mockResolvedValue(
            {
                mode: 'centralized-pr',
                prUrl: 'https://example.com/pr/10',
            } as CentralizedPrMetadata,
        );
        centralizedConfigPrServiceMock.resolveRepositoryFolderName.mockResolvedValue(
            'repo-one',
        );

        kodyRulesServiceMock.findById.mockResolvedValue({
            uuid: 'rule-1',
            type: KodyRulesType.STANDARD,
            title: 'Avoid debug logs',
            rule: 'Do not commit debug logs',
            severity: 'medium',
            scope: KodyRulesScope.FILE,
            path: '**/*',
            origin: KodyRulesOrigin.USER,
            repositoryId: 'repo-1',
            status: KodyRulesStatus.PENDING_MERGE,
            centralizedSourcePath: 'repo-one/.kody-rules/review/existing.yml',
        } as any);
        kodyRulesServiceMock.createOrUpdate.mockResolvedValue({
            uuid: 'rule-1',
        } as any);

        await useCase.execute(
            {
                uuid: 'rule-1',
                type: KodyRulesType.STANDARD,
                title: 'Avoid debug logs v2',
                rule: 'Do not commit verbose debug logs',
                severity: 'medium' as any,
                scope: KodyRulesScope.FILE,
                path: '**/*',
                origin: KodyRulesOrigin.USER,
                repositoryId: 'repo-1',
                examples: [],
            },
            'org-1',
        );

        expect(kodyRulesServiceMock.createOrUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                uuid: 'rule-1',
                status: KodyRulesStatus.PENDING_MERGE,
                centralizedSourcePath:
                    'repo-one/.kody-rules/review/existing.yml',
            }),
            expect.anything(),
        );
    });

    it('bypasses centralized PR routing for internal sync actor', async () => {
        kodyRulesServiceMock.createOrUpdate.mockResolvedValue({
            uuid: 'synced-rule-1',
        } as any);

        const result = await useCase.execute(
            {
                type: KodyRulesType.STANDARD,
                title: 'Synced from centralized',
                rule: 'Always prefer safe defaults',
                severity: 'medium' as any,
                scope: KodyRulesScope.FILE,
                path: '**/*',
                origin: KodyRulesOrigin.USER,
                repositoryId: 'repo-1',
                examples: [],
            },
            'org-1',
            {
                userId: 'kody',
                userEmail: 'kody@kodus.io',
            },
            true,
        );

        expect(
            centralizedConfigPrServiceMock.createMutationPullRequestIfEnabled,
        ).not.toHaveBeenCalled();
        expect(kodyRulesServiceMock.createOrUpdate).toHaveBeenCalled();
        expect(result).toEqual(
            expect.objectContaining({ uuid: 'synced-rule-1' }),
        );
    });
});
