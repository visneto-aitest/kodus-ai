import { describe, expect, it } from 'vitest';
import { ApiError, AuthError } from '../../types/index.js';
import { CommandError, normalizeCommandError } from '../command-errors.js';

describe('command errors', () => {
    it('keeps explicit CommandError code', () => {
        const normalized = normalizeCommandError(
            new CommandError('INVALID_INPUT', 'bad input', 1, {
                flag: '--foo',
            }),
        );

        expect(normalized.code).toBe('INVALID_INPUT');
        expect(normalized.message).toBe('bad input');
        expect(normalized.exitCode).toBe(1);
        expect(normalized.details).toEqual({ flag: '--foo' });
    });

    it('maps auth errors to AUTH_REQUIRED', () => {
        const normalized = normalizeCommandError(
            new AuthError('Not authenticated'),
        );
        expect(normalized.code).toBe('AUTH_REQUIRED');
    });

    it('maps api errors to API_REQUEST_FAILED', () => {
        const normalized = normalizeCommandError(
            new ApiError(500, 'server down'),
        );
        expect(normalized.code).toBe('API_REQUEST_FAILED');
    });

    it('maps unknown errors to INTERNAL_ERROR', () => {
        const normalized = normalizeCommandError(new Error('boom'));
        expect(normalized.code).toBe('INTERNAL_ERROR');
    });
});
