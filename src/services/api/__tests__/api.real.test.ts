import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../types/index.js';

const deviceMocks = vi.hoisted(() => ({
    getDeviceIdentity: vi.fn(),
    updateDeviceToken: vi.fn(),
}));

vi.mock('../../../utils/device.js', () => ({
    getDeviceIdentity: deviceMocks.getDeviceIdentity,
    updateDeviceToken: deviceMocks.updateDeviceToken,
}));

import { RealApi } from '../api.real.js';

describe('RealApi request headers', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as any);
        deviceMocks.getDeviceIdentity.mockResolvedValue({
            deviceId: '11111111-1111-4111-8111-111111111111',
            deviceToken: 'device-token-123',
        });
        deviceMocks.updateDeviceToken.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('includes X-Kodus-Device-Id and X-Kodus-Device-Token in API requests', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        fingerprint: 'fp',
                        reviewsUsed: 0,
                        reviewsLimit: 5,
                        filesLimit: 10,
                        linesLimit: 500,
                        resetsAt: new Date().toISOString(),
                        isLimited: false,
                    },
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await api.trial.getStatus('fp');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers['X-Kodus-Device-Id']).toBe(
            '11111111-1111-4111-8111-111111111111',
        );
        expect(options.headers['X-Kodus-Device-Token']).toBe(
            'device-token-123',
        );
    });

    it('updates stored device token from response header', async () => {
        deviceMocks.getDeviceIdentity.mockResolvedValue({
            deviceId: '11111111-1111-4111-8111-111111111111',
        });

        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        reviewsUsed: 0,
                        reviewsLimit: 5,
                        filesLimit: 10,
                        linesLimit: 500,
                        resetsAt: new Date().toISOString(),
                        isLimited: false,
                    },
                }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-kodus-device-token': 'server-issued-token',
                    },
                },
            ),
        );

        const api = new RealApi();
        await api.trial.getStatus('fp');

        expect(deviceMocks.updateDeviceToken).toHaveBeenCalledWith(
            'server-issued-token',
        );
    });

    it('maps DEVICE_LIMIT_REACHED to a user-friendly message', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    code: 'DEVICE_LIMIT_REACHED',
                    details: { limit: 5, current: 5 },
                }),
                {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await expect(api.trial.getStatus('fp')).rejects.toThrow(
            'Device limit reached (5/5).',
        );
    });

    it('keeps compatibility with legacy activeDevices field', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    code: 'DEVICE_LIMIT_REACHED',
                    details: { limit: 5, activeDevices: 5 },
                }),
                {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await expect(api.trial.getStatus('fp')).rejects.toThrow(
            'Device limit reached (5/5).',
        );
    });
});

describe('RealApi review.getPullRequestSuggestions', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as any);
        deviceMocks.getDeviceIdentity.mockResolvedValue({
            deviceId: '11111111-1111-4111-8111-111111111111',
        });
        deviceMocks.updateDeviceToken.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends X-Team-Key header when using team key', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        summary: 'ok',
                        issues: [],
                        filesAnalyzed: 0,
                        duration: 0,
                    },
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await api.review.getPullRequestSuggestions('kodus_team_key', {
            prUrl: 'https://github.com/acme/repo/pull/1',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers['X-Team-Key']).toBe('kodus_team_key');
        expect(options.headers.Authorization).toBeUndefined();
    });

    it('sends Authorization header when using bearer token', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        summary: 'ok',
                        issues: [],
                        filesAnalyzed: 0,
                        duration: 0,
                    },
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await api.review.getPullRequestSuggestions('eyJ.test.token', {
            prUrl: 'https://github.com/acme/repo/pull/1',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers.Authorization).toBe('Bearer eyJ.test.token');
        expect(options.headers['X-Team-Key']).toBeUndefined();
    });

    it('normalizes API auth errors to default CLI English message', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    message: 'Team key required by backend',
                }),
                {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();

        await expect(
            api.review.getPullRequestSuggestions('eyJ.test.token', {
                prUrl: 'https://github.com/acme/repo/pull/1',
            }),
        ).rejects.toEqual(
            expect.objectContaining({
                name: 'ApiError',
                statusCode: 401,
                message:
                    'Authentication failed while fetching pull request suggestions. Run: kodus auth login or configure a valid team key.',
            } satisfies Partial<ApiError>),
        );
    });
});

describe('RealApi review.analyze auth mode', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as any);
        deviceMocks.getDeviceIdentity.mockResolvedValue({
            deviceId: '11111111-1111-4111-8111-111111111111',
        });
        deviceMocks.updateDeviceToken.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends Authorization header for user login token', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        summary: 'ok',
                        issues: [],
                        filesAnalyzed: 0,
                        duration: 0,
                    },
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                },
            ),
        );

        const api = new RealApi();
        await api.review.analyze('diff --git a/file b/file', 'eyJ.test.token');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toContain('/cli/review');
        expect(options.headers.Authorization).toBe('Bearer eyJ.test.token');
        expect(options.headers['X-Team-Key']).toBeUndefined();
    });
});
