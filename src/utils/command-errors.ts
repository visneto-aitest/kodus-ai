import { ApiError, AuthError } from '../types/index.js';
import type {
    AgentErrorPayload,
    CommandErrorCode,
} from '../types/command-output.js';

function isMessageMatch(message: string, terms: string[]): boolean {
    const lower = message.toLowerCase();
    return terms.some((term) => lower.includes(term));
}

export class CommandError extends Error {
    constructor(
        public readonly code: CommandErrorCode,
        message: string,
        public readonly exitCode: number = 1,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'CommandError';
    }
}

export interface NormalizedCommandError extends AgentErrorPayload {
    exitCode: number;
}

export function normalizeCommandError(error: unknown): NormalizedCommandError {
    if (error instanceof CommandError) {
        return {
            code: error.code,
            message: error.message,
            details: error.details,
            exitCode: error.exitCode,
        };
    }

    if (error instanceof AuthError) {
        return {
            code: 'AUTH_REQUIRED',
            message: error.message,
            exitCode: 1,
        };
    }

    if (error instanceof ApiError) {
        return {
            code: 'API_REQUEST_FAILED',
            message: error.message,
            details: { statusCode: error.statusCode },
            exitCode: 1,
        };
    }

    if (error instanceof Error) {
        if (
            isMessageMatch(error.message, [
                'not a git repository',
                'run inside a git repo',
            ])
        ) {
            return {
                code: 'NOT_IN_GIT_REPO',
                message: error.message,
                exitCode: 1,
            };
        }

        if (
            isMessageMatch(error.message, [
                'no changes to review',
                'no local changes found',
                'no local diff scope provided',
            ])
        ) {
            return {
                code: 'NO_CHANGES',
                message: error.message,
                exitCode: 0,
            };
        }

        if (
            isMessageMatch(error.message, [
                'invalid --',
                'provide --',
                'choose a mode:',
                'cannot be used with',
            ])
        ) {
            return {
                code: 'INVALID_INPUT',
                message: error.message,
                exitCode: 1,
            };
        }

        return {
            code: 'INTERNAL_ERROR',
            message: error.message,
            exitCode: 1,
        };
    }

    return {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        exitCode: 1,
    };
}
