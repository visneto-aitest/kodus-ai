import { createLogger } from '@kodus/flow';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';

/**
 * NestJS DI token for the PostHog provider. Consumers inject the
 * interface via `@Inject(POSTHOG_PROVIDER_TOKEN) posthog: IPostHogProvider`
 * so the concrete class can be swapped in tests without rewriting every
 * call site (see kody rule "Inject services and repositories via DI
 * tokens, not by class").
 */
export const POSTHOG_PROVIDER_TOKEN = Symbol.for('PostHogProvider');

export interface IPostHogProvider {
    readonly isEnabled: boolean;

    capture(
        distinctId: string,
        event: string,
        properties?: Record<string, unknown>,
        groups?: Record<string, string | undefined>,
    ): void;

    identify(
        distinctId: string,
        properties?: Record<string, unknown>,
    ): void;

    groupIdentify(
        groupType: 'organization' | 'team' | 'repository',
        groupKey: string,
        properties?: Record<string, unknown>,
    ): void;

    isFeatureEnabled(
        featureName: string,
        identifier: string,
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<boolean>;
}

@Injectable()
export class PostHogProvider implements IPostHogProvider {
    private readonly logger = createLogger(PostHogProvider.name);
    private readonly client: PostHog | null = null;

    constructor(configService: ConfigService) {
        const apiKey = configService.get<string>('API_POSTHOG_KEY');
        if (apiKey) {
            this.client = new PostHog(apiKey, {
                host: 'https://us.i.posthog.com',
            });
        }
    }

    get isEnabled(): boolean {
        return this.client !== null;
    }

    capture(
        distinctId: string,
        event: string,
        properties: Record<string, unknown> = {},
        groups: Record<string, string | undefined> = {},
    ): void {
        if (!this.client) return;

        try {
            this.client.capture({
                distinctId,
                event,
                properties,
                groups: this.cleanGroups(groups),
            });
        } catch (error) {
            this.swallow('capture', event, error);
        }
    }

    identify(
        distinctId: string,
        properties: Record<string, unknown> = {},
    ): void {
        if (!this.client) return;
        try {
            this.client.identify({ distinctId, properties });
        } catch (error) {
            this.swallow('identify', distinctId, error);
        }
    }

    groupIdentify(
        groupType: 'organization' | 'team' | 'repository',
        groupKey: string,
        properties: Record<string, unknown> = {},
    ): void {
        if (!this.client) return;
        try {
            this.client.groupIdentify({ groupType, groupKey, properties });
        } catch (error) {
            this.swallow('groupIdentify', `${groupType}:${groupKey}`, error);
        }
    }

    /**
     * Evaluates a feature flag against PostHog with the org / repo group
     * context. When no API key is configured (e.g. local dev or self-hosted
     * without telemetry) returns `true` to preserve legacy permissive
     * behavior — cloud-only callers should still gate via the catalog stage.
     */
    async isFeatureEnabled(
        featureName: string,
        identifier: string,
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<boolean> {
        if (!this.client) return true;

        const groups: Record<string, string> = {
            organization: organizationAndTeamData.organizationId,
        };
        if (repositoryId) groups.repository = repositoryId;

        try {
            const result = await this.client.isFeatureEnabled(
                featureName,
                identifier,
                { groups },
            );
            return result === true;
        } catch (error) {
            this.swallow('isFeatureEnabled', featureName, error);
            return false;
        }
    }

    private cleanGroups(
        groups: Record<string, string | undefined>,
    ): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(groups)) {
            if (v) out[k] = v;
        }
        return out;
    }

    private swallow(op: string, label: string, error: unknown): void {
        this.logger.warn({
            message: `PostHog ${op} threw for "${label}" (swallowed)`,
            context: PostHogProvider.name,
            metadata: {
                op,
                label,
                error: error instanceof Error ? error.message : String(error),
            },
        });
    }
}
