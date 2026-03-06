import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { installMergeHook, MERGE_HOOK_MARKER } from '../memory/hooks.js';

vi.mock('../../services/git.service.js', () => ({
    gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getGitRoot: vi.fn(),
    },
}));

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-merge-hook-test-'));
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function hookPath(): string {
    return path.join(tmpDir, '.git', 'hooks', 'post-merge');
}

describe('installMergeHook', () => {
    it('creates new hook when none exists', async () => {
        const result = await installMergeHook(tmpDir);

        expect(result.alreadyInstalled).toBe(false);
        expect(result.hookPath).toBe(hookPath());

        const content = await fs.readFile(hookPath(), 'utf-8');
        expect(content).toContain('#!/bin/sh');
        expect(content).toContain(MERGE_HOOK_MARKER);
        expect(content).toContain('kodus decisions promote');

        // Check executable
        const stat = await fs.stat(hookPath());
        expect(stat.mode & 0o100).toBeTruthy();
    });

    it('skips when marker already present', async () => {
        await fs.writeFile(
            hookPath(),
            `#!/bin/sh\n${MERGE_HOOK_MARKER}\nkodus decisions promote\n`,
        );

        const result = await installMergeHook(tmpDir);

        expect(result.alreadyInstalled).toBe(true);
    });

    it('appends to existing non-kodus hook', async () => {
        const existingContent = '#!/bin/sh\necho "existing hook"\n';
        await fs.writeFile(hookPath(), existingContent);

        const result = await installMergeHook(tmpDir);

        expect(result.alreadyInstalled).toBe(false);

        const content = await fs.readFile(hookPath(), 'utf-8');
        expect(content).toContain('echo "existing hook"');
        expect(content).toContain(MERGE_HOOK_MARKER);
        expect(content).toContain('kodus decisions promote');
    });
});
