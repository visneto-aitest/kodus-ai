import "server-only";

import { NextRequest, NextResponse } from "next/server";

/**
 * Shared factory for the browser -> internal service proxy routes
 * introduced by the web-runtime-config-migration. All three proxies
 * (`/api/proxy/api`, `/api/proxy/mcp`, `/api/proxy/billing`) used to
 * duplicate the same forwarding logic; now they share this factory.
 *
 * Responsibilities:
 *  - Strip the incoming Host header so the upstream sees its own vhost.
 *  - Forward cookies, content-type, X-Forwarded-* intact.
 *  - Optionally inject an Authorization Bearer token (MCP case).
 *  - Block paths that must never be reachable from the browser
 *    (admin/metrics/internal routes) — applied BEFORE the upstream
 *    request so the backend never even sees them.
 *  - Rate-limit each sessionId to protect the backend from a
 *    compromised browser session.
 *  - Strip upstream Content-Encoding / Content-Length / Transfer-Encoding
 *    headers because undici auto-decompresses and the browser would
 *    otherwise reject with ERR_CONTENT_DECODING_FAILED.
 */

export type ProxyHandlerOptions = {
    /** Resolve the upstream URL from the remaining path + query string. */
    resolveUpstream: (upstreamPath: string, search: string) => string;
    /**
     * Optional Bearer token resolver. The returned token replaces any
     * Authorization header already on the incoming request.
     */
    resolveBearerToken?: (req: NextRequest) => Promise<string | null>;
    /**
     * Deny a request when the joined path matches any of these prefixes
     * (case-insensitive). Matches are done against the upstream path
     * starting with "/" — e.g. ["/admin", "/metrics/raw"].
     * Returns 404 (not 403) so attackers can't probe for existence.
     */
    denyPathPrefixes?: string[];
};

/**
 * Small in-process sliding-window limiter. Resets every window. Good
 * enough for single-instance selfhosted; a distributed deploy should
 * swap this for Redis/Memcached. The limit applies per
 * "session-identifying cookie" — we don't have a stable userId at this
 * layer so we hash the auth cookie.
 */
const RATE_LIMIT = { maxPerWindow: 120, windowMs: 10_000 } as const;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitKey(req: NextRequest): string {
    // Cookie-based key is stable across tabs of the same session. Fall
    // back to IP-ish signal so unauthenticated misuse still gets bucketed.
    const cookie = req.headers.get("cookie") ?? "";
    const m = cookie.match(/authjs\.session-token=([^;]+)/);
    if (m) return `session:${m[1].slice(0, 16)}`;
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return `ip:${fwd.split(",")[0].trim()}`;
    return "anon";
}

function isRateLimited(key: string): boolean {
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        rateBuckets.set(key, {
            count: 1,
            resetAt: now + RATE_LIMIT.windowMs,
        });
        return false;
    }
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT.maxPerWindow) return true;
    return false;
}

function pathIsDenied(
    upstreamPath: string,
    denyPathPrefixes?: string[],
): boolean {
    if (!denyPathPrefixes?.length) return false;
    const normalized = upstreamPath.toLowerCase();
    return denyPathPrefixes.some((prefix) =>
        normalized.startsWith(prefix.toLowerCase()),
    );
}

/**
 * Normalize the path segments to prevent directory-traversal abuse
 * (`..`, empty, dot). Returns null when the path is unsafe so the
 * caller can 404 without forwarding.
 */
function normalizeUpstreamPath(segments: string[]): string | null {
    for (const segment of segments) {
        if (segment === ".." || segment === "." || segment.includes("\0")) {
            return null;
        }
    }
    return "/" + segments.join("/");
}

async function forward(
    req: NextRequest,
    pathSegments: string[],
    options: ProxyHandlerOptions,
): Promise<NextResponse> {
    const upstreamPath = normalizeUpstreamPath(pathSegments);
    if (!upstreamPath) {
        return new NextResponse(null, { status: 404 });
    }

    if (pathIsDenied(upstreamPath, options.denyPathPrefixes)) {
        // 404 instead of 403 — makes path probing indistinguishable
        // from a typo.
        return new NextResponse(null, { status: 404 });
    }

    if (isRateLimited(rateLimitKey(req))) {
        return new NextResponse("Too Many Requests", { status: 429 });
    }

    const search = req.nextUrl.search;
    const url = options.resolveUpstream(upstreamPath, search);

    const headers = new Headers(req.headers);
    headers.delete("host");

    if (options.resolveBearerToken) {
        const token = await options.resolveBearerToken(req);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        else headers.delete("authorization");
    }

    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
        (init as RequestInit & { duplex?: string }).duplex = "half";
    }

    const upstream = await fetch(url, init);

    // undici transparently decompresses — strip encoding-related
    // headers or the browser tries to decode plaintext and fails.
    const outHeaders = new Headers(upstream.headers);
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");

    return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: outHeaders,
    });
}

type RouteCtx = { params: Promise<{ path: string[] }> };
type MethodHandler = (req: NextRequest, ctx: RouteCtx) => Promise<NextResponse>;

/**
 * Produce the 5 HTTP method handlers a Next App Router route.ts
 * expects (GET, POST, PUT, PATCH, DELETE) from a single options bag.
 */
export function createProxyHandler(options: ProxyHandlerOptions): {
    GET: MethodHandler;
    POST: MethodHandler;
    PUT: MethodHandler;
    PATCH: MethodHandler;
    DELETE: MethodHandler;
} {
    const handler: MethodHandler = async (req, ctx) =>
        forward(req, (await ctx.params).path, options);

    return {
        GET: handler,
        POST: handler,
        PUT: handler,
        PATCH: handler,
        DELETE: handler,
    };
}

// Exports kept in-file (rather than in sibling test helpers) so the
// behaviour stays in one place. Tests import via the public factory.
export const __testing = { normalizeUpstreamPath, pathIsDenied };
