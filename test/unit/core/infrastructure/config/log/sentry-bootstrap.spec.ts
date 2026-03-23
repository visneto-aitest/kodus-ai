jest.mock('@sentry/nestjs', () => ({
    init: jest.fn(),
}));

describe('setupSentryAndOpenTelemetry', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        delete process.env.SENTRY_RELEASE;
        delete process.env.API_BETTERSTACK_DSN;
        process.env.API_NODE_ENV = 'production';
        process.env.COMPONENT_TYPE = 'api';
    });

    it('does not initialize Sentry when no DSN is configured', async () => {
        const { setupSentryAndOpenTelemetry } = await import(
            '@libs/core/infrastructure/config/log/otel'
        );
        const sentry = jest.requireMock('@sentry/nestjs') as {
            init: jest.Mock;
        };

        setupSentryAndOpenTelemetry();

        expect(sentry.init).not.toHaveBeenCalled();
    });

    it('initializes Sentry once with the configured DSN', async () => {
        process.env.API_BETTERSTACK_DSN =
            'https://configured@example.betterstackdata.com/123';

        const { setupSentryAndOpenTelemetry } = await import(
            '@libs/core/infrastructure/config/log/otel'
        );
        const sentry = jest.requireMock('@sentry/nestjs') as {
            init: jest.Mock;
        };

        setupSentryAndOpenTelemetry();
        setupSentryAndOpenTelemetry();

        expect(sentry.init).toHaveBeenCalledTimes(1);
        expect(sentry.init).toHaveBeenCalledWith(
            expect.objectContaining({
                dsn: 'https://configured@example.betterstackdata.com/123',
                environment: 'production',
                release: 'kodus-orchestrator@production',
                serverName: 'kodus-api',
            }),
        );
    });

    it('ignores the old Sentry env name', async () => {
        (process.env as Record<string, string | undefined>).API_SENTRY_DSN =
            'https://legacy@example.betterstackdata.com/456';

        const { setupSentryAndOpenTelemetry } = await import(
            '@libs/core/infrastructure/config/log/otel'
        );
        const sentry = jest.requireMock('@sentry/nestjs') as {
            init: jest.Mock;
        };

        setupSentryAndOpenTelemetry();

        expect(sentry.init).not.toHaveBeenCalled();
    });

    it('does not crash the platform if Sentry init throws', async () => {
        process.env.API_BETTERSTACK_DSN =
            'https://configured@example.betterstackdata.com/123';

        const { setupSentryAndOpenTelemetry } = await import(
            '@libs/core/infrastructure/config/log/otel'
        );
        const sentry = jest.requireMock('@sentry/nestjs') as {
            init: jest.Mock;
        };
        const consoleWarn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        sentry.init.mockImplementation(() => {
            throw new Error('invalid dsn');
        });

        expect(() => setupSentryAndOpenTelemetry()).not.toThrow();
        expect(consoleWarn).toHaveBeenCalledWith(
            '[Sentry] initialization failed, continuing without error tracking:',
            'invalid dsn',
        );

        consoleWarn.mockRestore();
    });
});
