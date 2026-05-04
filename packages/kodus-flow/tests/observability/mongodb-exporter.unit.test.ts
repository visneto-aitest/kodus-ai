/**
 * @file mongodb-exporter.unit.test.ts
 *
 * Unit tests for MongoDBExporter — focused on the BSON-safety guard:
 * callers frequently pass shapes with circular refs (Axios errors with
 * config↔request↔response, Mongoose documents, Error.cause loops). The
 * exporter must sanitize them before pushing into the buffer, otherwise
 * `insertMany` blows up with "Cannot convert circular structure to BSON"
 * and the entire batch is lost.
 */

import { describe, it, expect } from 'vitest';
import { MongoDBExporter } from '../../src/observability/exporters/mongodb-exporter.js';

const buildExporter = () =>
    new MongoDBExporter({
        // High batch size so we never trigger flushLogs() during the test.
        batchSize: 999_999,
        connectionString: 'mongodb://localhost:27017/kodus-test',
        database: 'kodus-test',
    });

describe('MongoDBExporter — circular ref safety', () => {
    it('replaces circular references in metadata/attributes with [Circular] before buffering', async () => {
        const exporter = buildExporter();

        // Axios-style cycle: config ↔ request
        const config: any = { url: '/api', method: 'GET' };
        const request: any = { config };
        config.request = request;

        await exporter.exportLog('error', 'request failed', {
            component: 'axios-client',
            organizationId: 'org-1',
            payload: config, // contains the cycle
        } as any);

        const buffer = (exporter as any).logBuffer as any[];
        expect(buffer).toHaveLength(1);

        // Round-trips through JSON without throwing — no cycles remain.
        expect(() => JSON.stringify(buffer[0])).not.toThrow();

        const serialized = JSON.stringify(buffer[0]);
        expect(serialized).toContain('[Circular]');
    });

    it('drops sensitive keys via the shared deepSanitize helper (defense in depth)', async () => {
        const exporter = buildExporter();

        await exporter.exportLog('info', 'webhook received', {
            component: 'webhook',
            organizationId: 'org-1',
            apiKey: 'sk-very-secret-do-not-log',
            password: 'hunter2',
            nested: { token: 'jwt-stuff' },
        } as any);

        const buffer = (exporter as any).logBuffer as any[];
        const serialized = JSON.stringify(buffer[0]);

        // None of the secret values leak into the persisted payload.
        expect(serialized).not.toContain('sk-very-secret-do-not-log');
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('jwt-stuff');
    });

    it('preserves Date instances (BSON understands Date directly)', async () => {
        const exporter = buildExporter();
        const ts = new Date('2026-04-30T12:00:00Z');

        await exporter.exportLog('info', 'ping', {
            component: 'cron',
            occurredAt: ts,
        } as any);

        const buffer = (exporter as any).logBuffer as any[];
        // The attribute came through as a Date, not as a generic object —
        // otherwise BSON would accept it but the time-series collection
        // would no longer be able to query/sort by it.
        expect(buffer[0].attributes.occurredAt).toBeInstanceOf(Date);
        expect(buffer[0].attributes.occurredAt.getTime()).toBe(ts.getTime());
    });
});
