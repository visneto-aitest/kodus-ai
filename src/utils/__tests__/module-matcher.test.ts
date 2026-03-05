import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModuleConfig } from '../../types/memory.js';

// Mock fs before importing the module
vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        access: vi.fn(),
    },
}));

import { matchFiles, loadConfig } from '../module-matcher.js';
import fs from 'fs/promises';

const modules: ModuleConfig[] = [
    {
        id: 'auth',
        name: 'Authentication',
        paths: ['src/services/auth/**', 'src/middleware/auth.ts'],
        memoryFile: '.kody/memory/auth.md',
    },
    {
        id: 'api',
        name: 'API',
        paths: ['src/api/**'],
        memoryFile: '.kody/memory/api.md',
    },
    {
        id: 'utils',
        name: 'Utilities',
        paths: ['src/utils/*'],
        memoryFile: '.kody/memory/utils.md',
    },
    {
        id: 'config',
        name: 'Config',
        paths: ['src/config'],
        memoryFile: '.kody/memory/config.md',
    },
];

describe('matchFiles', () => {
    it('matches files with glob star patterns', () => {
        const result = matchFiles(['src/services/auth/jwt.ts'], modules);
        expect(result).toEqual(['auth']);
    });

    it('matches files with double glob star', () => {
        const result = matchFiles(['src/api/routes/v1/users.ts'], modules);
        expect(result).toEqual(['api']);
    });

    it('matches exact file paths', () => {
        const result = matchFiles(['src/middleware/auth.ts'], modules);
        expect(result).toEqual(['auth']);
    });

    it('matches directory prefix', () => {
        const result = matchFiles(['src/config/database.ts'], modules);
        expect(result).toEqual(['config']);
    });

    it('matches single-level wildcard without nested', () => {
        const result = matchFiles(['src/utils/helpers.ts'], modules);
        expect(result).toEqual(['utils']);
    });

    it('single-level wildcard does not match nested dirs', () => {
        const result = matchFiles(['src/utils/deep/nested.ts'], modules);
        expect(result).toEqual([]);
    });

    it('matches mid-path globstar with zero directories', () => {
        const customModules: ModuleConfig[] = [
            {
                id: 'scripts',
                name: 'Scripts',
                paths: ['src/**/index.ts'],
                memoryFile: '.kody/memory/scripts.md',
            },
        ];

        const result = matchFiles(['src/index.ts'], customModules);
        expect(result).toEqual(['scripts']);
    });

    it('matches mid-path globstar with nested directories', () => {
        const customModules: ModuleConfig[] = [
            {
                id: 'scripts',
                name: 'Scripts',
                paths: ['src/**/index.ts'],
                memoryFile: '.kody/memory/scripts.md',
            },
        ];

        const result = matchFiles(['src/a/b/index.ts'], customModules);
        expect(result).toEqual(['scripts']);
    });

    it('returns multiple matched modules', () => {
        const result = matchFiles(
            ['src/services/auth/jwt.ts', 'src/api/routes/users.ts'],
            modules,
        );
        expect(result).toContain('auth');
        expect(result).toContain('api');
    });

    it('deduplicates module IDs', () => {
        const result = matchFiles(
            ['src/services/auth/jwt.ts', 'src/services/auth/session.ts'],
            modules,
        );
        expect(result).toEqual(['auth']);
    });

    it('returns empty array for unmatched files', () => {
        const result = matchFiles(['README.md', 'package.json'], modules);
        expect(result).toEqual([]);
    });

    it('returns empty array for empty files list', () => {
        const result = matchFiles([], modules);
        expect(result).toEqual([]);
    });

    it('returns empty array for empty modules list', () => {
        const result = matchFiles(['src/auth.ts'], []);
        expect(result).toEqual([]);
    });
});

describe('loadConfig', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('parses valid modules.yml', async () => {
        const yaml = `version: 1
modules:
  - id: auth
    name: Authentication
    paths:
      - src/auth/**
    memoryFile: .kody/memory/auth.md
`;
        vi.mocked(fs.readFile).mockResolvedValue(yaml);

        const result = await loadConfig('/repo');
        expect(result).toEqual({
            version: 1,
            modules: [
                {
                    id: 'auth',
                    name: 'Authentication',
                    paths: ['src/auth/**'],
                    memoryFile: '.kody/memory/auth.md',
                },
            ],
        });
    });

    it('returns null for missing file', async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        vi.mocked(fs.readFile).mockRejectedValue(err);

        const result = await loadConfig('/repo');
        expect(result).toBeNull();
    });

    it('returns null for invalid YAML', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('not: [valid yaml');

        const result = await loadConfig('/repo');
        expect(result).toBeNull();
    });

    it('returns null for wrong version', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('version: 2\nmodules: []');

        const result = await loadConfig('/repo');
        expect(result).toBeNull();
    });

    it('skips modules without id', async () => {
        const yaml = `version: 1
modules:
  - name: NoId
    paths:
      - src/**
`;
        vi.mocked(fs.readFile).mockResolvedValue(yaml);

        const result = await loadConfig('/repo');
        expect(result?.modules).toEqual([]);
    });

    it('skips modules without paths', async () => {
        const yaml = `version: 1
modules:
  - id: empty
    name: Empty
    paths: []
`;
        vi.mocked(fs.readFile).mockResolvedValue(yaml);

        const result = await loadConfig('/repo');
        expect(result?.modules).toEqual([]);
    });

    it('defaults memoryFile when not provided', async () => {
        const yaml = `version: 1
modules:
  - id: auth
    paths:
      - src/auth/**
`;
        vi.mocked(fs.readFile).mockResolvedValue(yaml);

        const result = await loadConfig('/repo');
        expect(result?.modules[0].memoryFile).toBe('.kody/memory/auth.md');
    });
});
