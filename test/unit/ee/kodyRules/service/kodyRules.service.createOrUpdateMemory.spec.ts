import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { KodyRulesValidationService } from '@libs/ee/kodyRules/service/kody-rules-validation.service';
import { KodyRulesService } from '@libs/ee/kodyRules/service/kodyRules.service';
import {
    IKodyRule,
    IKodyRuleMemory,
    IKodyRules,
    KodyRulesOrigin,
    KodyRulesStatus,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

describe('KodyRulesService.createOrUpdateMemory', () => {
    const organizationAndTeamData: OrganizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    const existingMemory: Partial<IKodyRule> = {
        uuid: 'existing-memory-1',
        type: KodyRulesType.MEMORY,
        status: KodyRulesStatus.ACTIVE,
        title: 'Use strict typing',
        rule: 'Always use explicit types in public APIs',
        repositoryId: 'repo-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const createGeneratedMemory = (
        overrides: Partial<IKodyRuleMemory> = {},
    ): IKodyRuleMemory => ({
        type: KodyRulesType.MEMORY,
        title: 'Use strict typing',
        rule: 'Always use explicit types in public APIs',
        repositoryId: 'repo-1',
        status: KodyRulesStatus.ACTIVE,
        origin: KodyRulesOrigin.GENERATED,
        directoryId: undefined,
        path: undefined,
        ...overrides,
    });

    const setup = (llmResult: any) => {
        const repositoryMock = {
            findByOrganizationId: jest
                .fn()
                .mockResolvedValue({ rules: [existingMemory] } as IKodyRules),
        };

        const observabilityServiceMock = {
            runLLMInSpan: jest.fn().mockResolvedValue({ result: llmResult }),
        };

        const permissionValidationServiceMock = {
            getBYOKConfig: jest.fn().mockResolvedValue(undefined),
        };

        const validationService = new KodyRulesValidationService({} as any);

        const service = new KodyRulesService(
            repositoryMock as any,
            { registerKodyRulesLog: jest.fn() } as any,
            {} as any,
            {} as any,
            validationService,
            {} as any,
            {} as any,
            observabilityServiceMock as any,
            permissionValidationServiceMock as any,
        );

        return {
            service,
            repositoryMock,
            observabilityServiceMock,
        };
    };

    it('skips creation when LLM indicates duplicate generated memory', async () => {
        const { service, observabilityServiceMock } = setup({
            action: 'skip',
            targetMemoryUuid: 'existing-memory-1',
        });

        const createOrUpdateSpy = jest
            .spyOn(service, 'createOrUpdate')
            .mockResolvedValue(null);

        const result = await service.createOrUpdateMemory(
            organizationAndTeamData,
            createGeneratedMemory(),
            { userId: 'kody', userEmail: 'kody@kodus.io' },
        );

        expect(result).toEqual(existingMemory);
        expect(createOrUpdateSpy).not.toHaveBeenCalled();
        expect(observabilityServiceMock.runLLMInSpan).toHaveBeenCalledTimes(1);
    });

    it('updates existing memory when LLM indicates refinement', async () => {
        const { service } = setup({
            action: 'update',
            targetMemoryUuid: 'existing-memory-1',
            updatedTitle: 'Prefer strict typing',
            updatedRule:
                'Use explicit types on exported functions and public APIs',
        });

        const updatedResult = {
            uuid: 'existing-memory-1',
            title: 'Prefer strict typing',
            rule: 'Use explicit types on exported functions and public APIs',
        } as Partial<IKodyRule>;

        const createOrUpdateSpy = jest
            .spyOn(service, 'createOrUpdate')
            .mockResolvedValue(updatedResult as any);

        const result = await service.createOrUpdateMemory(
            organizationAndTeamData,
            createGeneratedMemory(),
            { userId: 'kody', userEmail: 'kody@kodus.io' },
        );

        expect(createOrUpdateSpy).toHaveBeenCalledWith(
            organizationAndTeamData,
            expect.objectContaining({
                uuid: 'existing-memory-1',
                title: 'Prefer strict typing',
                rule: 'Use explicit types on exported functions and public APIs',
                severity: 'medium',
                origin: KodyRulesOrigin.GENERATED,
            }),
            { userId: 'kody', userEmail: 'kody@kodus.io' },
        );
        expect(result).toEqual(updatedResult);
    });

    it('bypasses LLM resolution for non-generated memories', async () => {
        const { service, observabilityServiceMock } = setup({
            action: 'skip',
            targetMemoryUuid: 'existing-memory-1',
        });

        const persistedResult = {
            uuid: 'new-memory',
            title: 'Team preference',
            rule: 'Prefer compact examples',
        } as Partial<IKodyRule>;

        const createOrUpdateSpy = jest
            .spyOn(service, 'createOrUpdate')
            .mockResolvedValue(persistedResult as any);

        const result = await service.createOrUpdateMemory(
            organizationAndTeamData,
            createGeneratedMemory({
                title: 'Team preference',
                rule: 'Prefer compact examples',
                origin: KodyRulesOrigin.USER,
            }),
            { userId: 'user-1', userEmail: 'user@kodus.io' },
        );

        expect(observabilityServiceMock.runLLMInSpan).not.toHaveBeenCalled();
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
        expect(result).toEqual(persistedResult);
    });
});
