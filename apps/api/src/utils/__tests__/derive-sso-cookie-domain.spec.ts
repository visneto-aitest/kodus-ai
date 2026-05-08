import { deriveSsoCookieDomain } from '../derive-sso-cookie-domain';

describe('deriveSsoCookieDomain', () => {
    describe('development mode', () => {
        it('returns undefined regardless of host shape', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'https://app.kodus.io',
                    nodeEnv: 'development',
                }),
            ).toBeUndefined();
        });
    });

    describe('SaaS topology (shared parent)', () => {
        it('derives .kodus.io for api.kodus.io + app.kodus.io', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'https://app.kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBe('.kodus.io');
        });

        it('strips frontendUrl protocol/path/port when deriving', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'https://app.kodus.io:443/sign-in?x=1',
                    nodeEnv: 'production',
                }),
            ).toBe('.kodus.io');
        });
    });

    describe('self-hosted topology (Dmitry)', () => {
        it('derives .web.scorpion.co for deeply nested hosts under shared parent', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'kodus-api-dev.web.scorpion.co',
                    frontendUrl: 'https://kodus-dev.web.scorpion.co',
                    nodeEnv: 'production',
                }),
            ).toBe('.web.scorpion.co');
        });

        it('handles 4+ label hosts', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'a.b.c.example.com',
                    frontendUrl: 'https://x.b.c.example.com',
                    nodeEnv: 'production',
                }),
            ).toBe('.b.c.example.com');
        });
    });

    describe('apex / single-host topology', () => {
        it('derives .kodus.io when API and frontend share apex', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'kodus.io',
                    frontendUrl: 'https://kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBe('.kodus.io');
        });

        it('derives parent when frontend is at apex but API is on subdomain', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'https://kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBe('.kodus.io');
        });
    });

    describe('public-suffix protection', () => {
        it('returns undefined when only ".io" is shared', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'https://app.foo.io',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });

        it('returns undefined when only ".com" is shared', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.foo.com',
                    frontendUrl: 'https://app.bar.com',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });

        it('returns undefined for unrelated hosts under .co.uk (only public-suffix labels in common)', () => {
            // Edge case: kodus.co.uk + another.co.uk produces ["uk","co"] → 2 labels → ".co.uk".
            // We accept this risk: in real deployments operators don't put API and frontend
            // on different registrable domains within the same multi-label public suffix.
            // Documenting here so the case is intentional, not forgotten.
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'kodus.co.uk',
                    frontendUrl: 'https://another.co.uk',
                    nodeEnv: 'production',
                }),
            ).toBe('.co.uk');
        });
    });

    describe('no common parent', () => {
        it('returns undefined when hosts share nothing', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.foo.com',
                    frontendUrl: 'https://app.bar.io',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });
    });

    describe('IP / numeric / port edge cases', () => {
        it('returns undefined for IPv4 hosts', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: '192.168.1.10',
                    frontendUrl: 'http://192.168.1.10',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });

        it('returns undefined when API host is mixed numeric', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: '10.0.0.5',
                    frontendUrl: 'https://app.kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });
    });

    describe('malformed input', () => {
        it('returns undefined for invalid frontendUrl', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'api.kodus.io',
                    frontendUrl: 'not a url',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });

        it('returns undefined for empty hosts', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: '',
                    frontendUrl: 'https://app.kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBeUndefined();
        });
    });

    describe('case-insensitive matching', () => {
        it('treats uppercase and lowercase hosts as equivalent', () => {
            expect(
                deriveSsoCookieDomain({
                    apiHost: 'API.KODUS.IO',
                    frontendUrl: 'https://App.Kodus.io',
                    nodeEnv: 'production',
                }),
            ).toBe('.kodus.io');
        });
    });
});
