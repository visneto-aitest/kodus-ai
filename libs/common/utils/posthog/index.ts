import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { IPostHog, PostHog } from 'posthog-node';

export const FEATURE_FLAGS = {
    tokenUsagePage: 'token-usage-page',
    kodyRuleSuggestions: 'kody-rules-suggestions',
    codeReviewDryRun: 'code-review-dry-run',
    businessLogic: 'business-logic',
    documentationContext: 'documentation-context',
    sso: 'sso',
    cliKeys: 'cli-keys',
    committableSuggestions: 'committable-suggestions',
    agentReview: 'agent-review',
    cockpitInternalSource: 'cockpit-internal-source',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

class PostHogClient {
    private readonly posthog: IPostHog | null = null;

    constructor() {
        const apiKey = process.env.API_POSTHOG_KEY;

        if (apiKey) {
            this.posthog = new PostHog(apiKey, {
                host: 'https://us.i.posthog.com',
            });
        } else {
            this.posthog = null;
        }
    }

    get isInitialized(): boolean {
        return this.posthog !== null;
    }

    async isFeatureEnabled(
        featureName: string,
        identifier: string,
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<boolean> {
        if (!this.posthog) {
            return Promise.resolve(true);
        }

        const groups: Record<string, string> = {
            organization: organizationAndTeamData.organizationId,
        };

        if (repositoryId) {
            groups.repository = repositoryId;
        }

        return await this.posthog.isFeatureEnabled(featureName, identifier, {
            groups,
        });
    }
}

export default new PostHogClient();
