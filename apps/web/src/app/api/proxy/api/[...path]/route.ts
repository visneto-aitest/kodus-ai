import "server-only";

import { pathToApiUrl } from "src/core/utils/helpers";

import { createProxyHandler } from "../../_lib/create-proxy-handler";

/**
 * Proxy route that forwards browser fetches to the internal backend API.
 * Keeps WEB_HOSTNAME_API / WEB_PORT_API out of the client bundle.
 *
 * Denylist: paths the browser must never reach even when authenticated.
 * These endpoints historically assumed network-layer isolation (VPC
 * private ingress, localhost-only) and are not prepared to be exposed
 * through a same-origin proxy.
 */
export const { GET, POST, PUT, PATCH, DELETE } = createProxyHandler({
    resolveUpstream: (path, search) => pathToApiUrl(path + search),
    proxyMountPath: "/api/proxy/api",
    denyPathPrefixes: [
        "/admin",
        "/internal",
        "/metrics",
        "/debug",
        "/health/raw",
    ],
});
