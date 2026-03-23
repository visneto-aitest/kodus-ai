describe('apps/api instrument bootstrap', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('loads dotenv before initializing Sentry', async () => {
        let dotenvLoaded = false;
        const setupSentryAndOpenTelemetry = jest.fn(() => dotenvLoaded);

        jest.doMock('dotenv/config', () => {
            dotenvLoaded = true;
            return {};
        });

        jest.doMock('@libs/core/infrastructure/config/log/otel', () => ({
            setupSentryAndOpenTelemetry,
        }));

        await import('../../../apps/api/src/instrument');

        expect(setupSentryAndOpenTelemetry).toHaveBeenCalledTimes(1);
        expect(setupSentryAndOpenTelemetry).toHaveBeenCalledWith({
            componentType: 'api',
        });
        expect(dotenvLoaded).toBe(true);
    });
});
