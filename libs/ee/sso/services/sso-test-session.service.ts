import { randomUUID } from 'crypto';

import { CacheService } from '@libs/core/cache/cache.service';
import { Injectable } from '@nestjs/common';

import {
    SSOConnectionTestSession,
    SSOConnectionTestSessionStatus,
    SSOConnectionTestStatus,
    SSOProtocol,
    SSOProtocolConfigMap,
} from '../domain/interfaces/ssoConfig.interface';
import {
    buildSSOConfigFingerprint,
    normalizeDomains,
} from '../utils/sso-fingerprint.util';

const SSO_TEST_SESSION_KEY_PREFIX = 'sso:test-session';
const SSO_TEST_SESSION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class SSOTestSessionService {
    constructor(private readonly cacheService: CacheService) {}

    private getCacheKey(sessionId: string): string {
        return `${SSO_TEST_SESSION_KEY_PREFIX}:${sessionId}`;
    }

    async createSession<P extends SSOProtocol>(params: {
        organizationId: string;
        protocol: P;
        providerConfig: SSOProtocolConfigMap[P];
        domains: string[];
        createdBy?: string;
    }): Promise<SSOConnectionTestSession<P>> {
        const now = new Date().toISOString();
        const sessionId = randomUUID();
        const normalizedDomains = normalizeDomains(params.domains);
        const configFingerprint = buildSSOConfigFingerprint({
            protocol: params.protocol,
            providerConfig: params.providerConfig,
            domains: normalizedDomains,
        });

        const session: SSOConnectionTestSession<P> = {
            sessionId,
            organizationId: params.organizationId,
            protocol: params.protocol,
            status: SSOConnectionTestSessionStatus.PENDING,
            configFingerprint,
            providerConfig: params.providerConfig,
            domains: normalizedDomains,
            createdBy: params.createdBy,
            createdAt: now,
            updatedAt: now,
        };

        await this.cacheService.addToCache(
            this.getCacheKey(sessionId),
            session,
            SSO_TEST_SESSION_TTL_MS,
        );

        return session;
    }

    async getSession<P extends SSOProtocol>(
        sessionId: string,
    ): Promise<SSOConnectionTestSession<P> | null> {
        if (!sessionId) {
            return null;
        }

        const session = await this.cacheService.getFromCache<
            SSOConnectionTestSession<P>
        >(this.getCacheKey(sessionId));

        return session || null;
    }

    async markSessionSuccess<P extends SSOProtocol>(
        sessionId: string,
    ): Promise<SSOConnectionTestSession<P> | null> {
        const session = await this.getSession<P>(sessionId);

        if (!session) {
            return null;
        }

        const testedAt = new Date().toISOString();
        const updatedSession: SSOConnectionTestSession<P> = {
            ...session,
            status: SSOConnectionTestSessionStatus.SUCCESS,
            testedAt,
            updatedAt: testedAt,
            failureCode: undefined,
            failureMessage: undefined,
        };

        await this.cacheService.addToCache(
            this.getCacheKey(sessionId),
            updatedSession,
            SSO_TEST_SESSION_TTL_MS,
        );

        return updatedSession;
    }

    async markSessionFailed<P extends SSOProtocol>(
        sessionId: string,
        failure: {
            failureCode: string;
            failureMessage: string;
        },
    ): Promise<SSOConnectionTestSession<P> | null> {
        const session = await this.getSession<P>(sessionId);

        if (!session) {
            return null;
        }

        const testedAt = new Date().toISOString();
        const updatedSession: SSOConnectionTestSession<P> = {
            ...session,
            status: SSOConnectionTestSessionStatus.FAILED,
            testedAt,
            updatedAt: testedAt,
            failureCode: failure.failureCode,
            failureMessage: failure.failureMessage,
        };

        await this.cacheService.addToCache(
            this.getCacheKey(sessionId),
            updatedSession,
            SSO_TEST_SESSION_TTL_MS,
        );

        return updatedSession;
    }

    toConnectionTestMetadata<P extends SSOProtocol>(
        session: SSOConnectionTestSession<P>,
    ) {
        return {
            status:
                session.status === SSOConnectionTestSessionStatus.SUCCESS
                    ? SSOConnectionTestStatus.SUCCESS
                    : SSOConnectionTestStatus.FAILED,
            configFingerprint: session.configFingerprint,
            testedAt: session.testedAt
                ? new Date(session.testedAt)
                : new Date(),
            testedBy: session.createdBy,
            failureCode: session.failureCode,
            failureMessage: session.failureMessage,
        };
    }
}
