/**
 * billingFetch is dual-mode:
 *   - Server side: direct to internal billing host.
 *   - Client side: through /api/proxy/billing/<path>.
 *
 * Same contract as mcp-manager/utils: keeps internal hostnames out of
 * the client bundle without breaking server-side usage.
 */

jest.mock("src/core/utils/server-side", () => {
    const mod = { isServerSide: true };
    return {
        get isServerSide() {
            return mod.isServerSide;
        },
        __setServerSide: (v: boolean) => {
            mod.isServerSide = v;
        },
    };
});

jest.mock("src/core/utils/helpers", () => ({
    createUrl: (
        host: string | undefined,
        port: string | undefined,
        path: string,
    ) => `http://${host}:${port}${path}`,
}));

const typedFetchMock = jest.fn();
jest.mock("@services/fetch", () => ({
    typedFetch: (...args: unknown[]) => typedFetchMock(...args),
}));

const setServer = (v: boolean) => {
    const mod = require("src/core/utils/server-side");
    mod.__setServerSide(v);
};

describe("billingFetch dual-mode", () => {
    const ORIG_HOST = process.env.WEB_HOSTNAME_BILLING;
    const ORIG_PORT = process.env.WEB_PORT_BILLING;

    beforeEach(() => {
        jest.resetModules();
        typedFetchMock.mockReset();
        typedFetchMock.mockResolvedValue({ ok: true });
        process.env.WEB_HOSTNAME_BILLING = "billing.internal";
        process.env.WEB_PORT_BILLING = "3992";
    });

    afterAll(() => {
        process.env.WEB_HOSTNAME_BILLING = ORIG_HOST;
        process.env.WEB_PORT_BILLING = ORIG_PORT;
    });

    it("server side: hits internal host with /api/billing/ prefix", async () => {
        setServer(true);
        const { billingFetch } = await import("./utils");
        await billingFetch("license/users");
        const [url] = typedFetchMock.mock.calls[0];
        expect(url).toBe(
            "http://billing.internal:3992/api/billing/license/users",
        );
    });

    it("client side: goes through /api/proxy/billing", async () => {
        setServer(false);
        const { billingFetch } = await import("./utils");
        await billingFetch("/license/users");
        const [url] = typedFetchMock.mock.calls[0];
        expect(url).toBe("/api/proxy/billing/license/users");
    });

    it("client side: no internal hostname leaks in the URL", async () => {
        setServer(false);
        const { billingFetch } = await import("./utils");
        await billingFetch("/license/users");
        const [url] = typedFetchMock.mock.calls[0];
        expect(url).not.toContain("billing.internal");
        expect(url).not.toContain("3992");
    });
});
