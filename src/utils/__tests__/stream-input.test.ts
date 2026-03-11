import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readStreamPayload } from '../stream-input.js';

function createStream(): PassThrough & { isTTY?: boolean } {
    const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
    stream.isTTY = false;
    return stream;
}

describe('readStreamPayload', () => {
    it('returns empty string for tty streams', async () => {
        const stream = createStream();
        stream.isTTY = true;

        await expect(readStreamPayload(stream)).resolves.toBe('');
    });

    it('supports concurrent readers on the same stream', async () => {
        const stream = createStream();

        const first = readStreamPayload(stream, {
            noDataTimeoutMs: 50,
            brokenStreamTimeoutMs: 200,
        });
        const second = readStreamPayload(stream, {
            noDataTimeoutMs: 50,
            brokenStreamTimeoutMs: 200,
        });

        stream.write('payload');
        stream.end();

        await expect(first).resolves.toBe('payload');
        await expect(second).resolves.toBe('payload');
    });
});
