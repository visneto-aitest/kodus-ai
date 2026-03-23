describe('apps/api instrument bootstrap', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.COMPONENT_TYPE;
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
        expect(dotenvLoaded).toBe(true);
        expect(process.env.COMPONENT_TYPE).toBe('api');
    });
});
