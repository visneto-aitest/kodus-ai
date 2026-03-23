import * as Sentry from '@sentry/nestjs';

let sentryInitialized = false;

export function setupSentryAndOpenTelemetry() {
    if (sentryInitialized) {
        return;
    }

    const dsn = process.env.API_BETTERSTACK_DSN;

    if (!dsn) {
        return;
    }

    const environment =
        process.env.API_NODE_ENV || process.env.NODE_ENV || 'development';
    const componentType = process.env.COMPONENT_TYPE || 'api';

    try {
        Sentry.init({
            dsn,
            environment,
            release: `kodus-orchestrator@${
                process.env.SENTRY_RELEASE || environment
            }`,
            serverName: `kodus-${componentType}`,
            initialScope: {
                tags: {
                    component: componentType,
                },
            },
        });

        sentryInitialized = true;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'unknown error';

        console.warn(
            '[Sentry] initialization failed, continuing without error tracking:',
            message,
        );
    }
}
