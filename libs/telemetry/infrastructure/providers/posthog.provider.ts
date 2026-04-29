import { createLogger } from '@kodus/flow';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

@Injectable()
export class PostHogProvider {
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
