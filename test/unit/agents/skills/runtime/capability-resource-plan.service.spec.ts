import { CapabilityResourcePlanService } from '@libs/agents/skills/runtime/capability-resource-plan.service';

describe('CapabilityResourcePlanService', () => {
    it('loads seeded tools from the runtime capability seeds folder', () => {
        const service = new CapabilityResourcePlanService();

        const tools = service.getSeedTools('jira', 'task.context.read');

        expect(tools).toEqual(
            expect.arrayContaining([
                'getAccessibleAtlassianResources',
                'getJiraIssue',
                'searchJiraIssuesUsingJql',
                'search',
                'fetch',
            ]),
        );
    });

    it('loads seeded tools for non-jira providers', () => {
        const service = new CapabilityResourcePlanService();

        const linearTools = service.getSeedTools('linear', 'task.context.read');

        expect(linearTools).toEqual(
            expect.arrayContaining(['search', 'fetch', 'getIssue']),
        );
    });

    it('stores and retrieves cached tools by tenant scope', async () => {
        const service = new CapabilityResourcePlanService();
        const scope = {
            organizationId: 'org-1',
            teamId: 'team-1',
            skillName: 'business-rules-validation',
            capability: 'task.context.read',
            provider: 'jira',
        };

        await service.saveCachedTools(scope, ['search', 'getJiraIssue']);
        const cached = await service.getCachedTools(scope);

        expect(cached).toEqual(['search', 'getJiraIssue']);
    });
});
