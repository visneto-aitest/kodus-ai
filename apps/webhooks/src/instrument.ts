import 'dotenv/config';

import { setupSentryAndOpenTelemetry } from '@libs/core/infrastructure/config/log/otel';

process.env.COMPONENT_TYPE = 'webhook';
setupSentryAndOpenTelemetry();
