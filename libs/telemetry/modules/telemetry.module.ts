import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TelemetryService } from '../application/services/telemetry.service';
import { N8nProvider } from '../infrastructure/providers/n8n.provider';
import { PostHogProvider } from '../infrastructure/providers/posthog.provider';
import { ResendEventsProvider } from '../infrastructure/providers/resend-events.provider';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        PostHogProvider,
        ResendEventsProvider,
        N8nProvider,
        TelemetryService,
    ],
    exports: [TelemetryService],
})
export class TelemetryModule {}
