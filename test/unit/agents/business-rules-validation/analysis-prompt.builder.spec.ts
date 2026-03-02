import { buildBusinessRulesAnalysisPrompt } from '@libs/agents/infrastructure/services/kodus-flow/business-rules-validation/analysis-prompt.builder';
import { BusinessRulesContext } from '@libs/agents/infrastructure/services/kodus-flow/business-rules-validation/types';

describe('buildBusinessRulesAnalysisPrompt', () => {
    it('renders a fallback marker when the PR diff is an empty string', () => {
        const prompt = buildBusinessRulesAnalysisPrompt({
            organizationAndTeamData: {
                organizationId: 'org-1',
                teamId: 'team-1',
            },
            userLanguage: 'en-US',
            taskQuality: 'COMPLETE',
            taskContext:
                'Task ID: 15604\n\nTitle: Kody rules por time\n\nDescription: Review billing lookup by team.',
            prDiff: '',
            prBody: '',
        } as BusinessRulesContext);

        expect(prompt).toContain('PR_DIFF:\n(not available)');
        expect(prompt).toContain('PR_DESCRIPTION:\n(not available)');
    });
});
