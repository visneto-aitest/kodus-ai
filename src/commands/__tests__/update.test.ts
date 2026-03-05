import { describe, expect, it } from 'vitest';
import {
    formatInstallInstruction,
    resolveGlobalInstallInstruction,
} from '../update.js';

describe('update command helpers', () => {
    it('uses npm by default', () => {
        expect(resolveGlobalInstallInstruction(undefined)).toEqual({
            command: 'npm',
            args: ['install', '-g', '@kodus/cli@latest'],
        });
    });

    it('uses pnpm when detected', () => {
        expect(
            resolveGlobalInstallInstruction('pnpm/10.0.0 npm/? node/v22.0.0'),
        ).toEqual({
            command: 'pnpm',
            args: ['add', '-g', '@kodus/cli@latest'],
        });
    });

    it('uses yarn global for yarn classic', () => {
        expect(
            resolveGlobalInstallInstruction('yarn/1.22.22 npm/? node/v22.0.0'),
        ).toEqual({
            command: 'yarn',
            args: ['global', 'add', '@kodus/cli@latest'],
        });
    });

    it('uses bun when detected', () => {
        expect(resolveGlobalInstallInstruction('bun/1.2.0')).toEqual({
            command: 'bun',
            args: ['add', '-g', '@kodus/cli@latest'],
        });
    });

    it('formats install instruction for manual command output', () => {
        expect(
            formatInstallInstruction({
                command: 'pnpm',
                args: ['add', '-g', '@kodus/cli@latest'],
            }),
        ).toBe('pnpm add -g @kodus/cli@latest');
    });
});
