jest.mock('posthog-node');

const getClient = async (key: string) => {
    process.env.API_POSTHOG_KEY = key;

    /*
     * We need to import the posthogClient here because it is a singleton and we need to reset the modules
     * to avoid the client being initialized with the wrong key
     */
    const { default: posthogClient } = await import('@/shared/utils/posthog');
    return posthogClient;
};

describe('PostHogClient', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize PostHog client when API key is present', async () => {
            const posthogClient = await getClient('test-key');
            expect(posthogClient['posthog']).toBeDefined();
        });

        it('should not initialize PostHog client when API key is missing', async () => {
            const posthogClient = await getClient('');
            expect(posthogClient['posthog']).toBeNull();
        });
    });

    describe('isFeatureEnabled', () => {
        it('should call isFeatureEnabled when PostHog is initialized', async () => {
            const posthogClient = await getClient('test-key');
            await posthogClient.isFeatureEnabled('test-feature', '123', {
                organizationId: '456',
            } as any);
            expect(
                posthogClient['posthog'].isFeatureEnabled,
            ).toHaveBeenCalledWith('test-feature', '123', {
                groups: { organization: '456' },
            });
        });

        it('should not call isFeatureEnabled when PostHog is not initialized', async () => {
            const posthogClient = await getClient('');
            const isFeatureEnabled = await posthogClient.isFeatureEnabled(
                'test-feature',
                '123',
                { organizationId: '456' } as any,
            );
            expect(isFeatureEnabled).toBe(true);
        });
    });
});
