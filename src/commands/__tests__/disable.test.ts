import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('../../services/git.service.js', () => ({
    gitService: {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getGitRoot: vi.fn(),
    },
}));

import { gitService } from '../../services/git.service.js';
import { disableAction } from '../memory/disable.js';
import {
    MERGE_HOOK_MARKER,
    CODEX_NOTIFY_LINE,
    CODEX_NOTIFY_LINE_LEGACY,
} from '../memory/hooks.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-disable-test-'));
    await fs.mkdir(path.join(tmpDir, '.git', 'hooks'), { recursive: true });
    vi.mocked(gitService.getGitRoot).mockResolvedValue(tmpDir);

    // Override HOME so resolveCodexConfigPath points to tmpDir
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('disableAction', () => {
    it('removes Claude hooks from settings.json', async () => {
        const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(
            settingsPath,
            JSON.stringify(
                {
                    hooks: {
                        UserPromptSubmit: [
                            {
                                matcher: '',
                                hooks: [
                                    {
                                        type: 'command',
                                        command:
                                            'kodus decisions capture --agent claude-compatible --event user-prompt-submit',
                                    },
                                ],
                            },
                        ],
                        Stop: [
                            {
                                matcher: '',
                                hooks: [
                                    {
                                        type: 'command',
                                        command:
                                            'kodus decisions capture --agent claude-compatible --event stop',
                                    },
                                ],
                            },
                        ],
                    },
                },
                null,
                2,
            ),
        );

        await disableAction();

        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(settings.hooks).toBeUndefined();
    });

    it('removes Codex notify line', async () => {
        const codexPath = path.join(tmpDir, '.codex', 'config.toml');
        await fs.mkdir(path.dirname(codexPath), { recursive: true });
        await fs.writeFile(
            codexPath,
            `model = "gpt-4"\n${CODEX_NOTIFY_LINE}\n`,
        );

        await disableAction();

        const content = await fs.readFile(codexPath, 'utf-8');
        expect(content).not.toContain(CODEX_NOTIFY_LINE);
        expect(content).toContain('model = "gpt-4"');
    });

    it('removes legacy Codex notify line', async () => {
        const codexPath = path.join(tmpDir, '.codex', 'config.toml');
        await fs.mkdir(path.dirname(codexPath), { recursive: true });
        await fs.writeFile(
            codexPath,
            `model = "gpt-4"\n${CODEX_NOTIFY_LINE_LEGACY}\n`,
        );

        await disableAction();

        const content = await fs.readFile(codexPath, 'utf-8');
        expect(content).not.toContain(CODEX_NOTIFY_LINE_LEGACY);
        expect(content).toContain('model = "gpt-4"');
    });

    it('removes kodus section from post-merge hook', async () => {
        const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
        await fs.writeFile(
            hookPath,
            `#!/bin/sh\n${MERGE_HOOK_MARKER}\nif [ -n "$MERGED_BRANCH" ]; then\n  kodus decisions promote --branch "$MERGED_BRANCH" &\nfi\n`,
            { mode: 0o755 },
        );

        await disableAction();

        // Hook file should be deleted (only shebang remained)
        await expect(fs.access(hookPath)).rejects.toThrow();
    });

    it('preserves non-kodus content in post-merge hook', async () => {
        const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
        await fs.writeFile(
            hookPath,
            `#!/bin/sh\necho "custom hook"\n\n${MERGE_HOOK_MARKER}\nif [ -n "$MERGED_BRANCH" ]; then\n  kodus decisions promote --branch "$MERGED_BRANCH" &\nfi\n`,
            { mode: 0o755 },
        );

        await disableAction();

        const content = await fs.readFile(hookPath, 'utf-8');
        expect(content).toContain('echo "custom hook"');
        expect(content).not.toContain(MERGE_HOOK_MARKER);
    });

    it('removes legacy two-if kodus block without leaving orphaned shell lines', async () => {
        const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
        await fs.writeFile(
            hookPath,
            `#!/bin/sh\n${MERGE_HOOK_MARKER}\nMERGED_BRANCH=$(git log -1 --merges --format=%s HEAD 2>/dev/null | sed -n "s/.*Merge branch '\\([^']*\\)'.*/\\1/p")\nif [ -z "$MERGED_BRANCH" ]; then\n  MERGED_BRANCH=$(git log -1 --merges --format=%s HEAD 2>/dev/null | sed -n "s/.*Merge pull request .* from [^/]*\\/\\(.*\\)/\\1/p")\nfi\nif [ -n "$MERGED_BRANCH" ]; then\n  kodus decisions promote --branch "$MERGED_BRANCH" &\nfi\n`,
            { mode: 0o755 },
        );

        await disableAction();

        await expect(fs.access(hookPath)).rejects.toThrow();
    });

    it('preserves .kody/ data', async () => {
        const kodyFile = path.join(tmpDir, '.kody', 'pr', 'test.md');
        await fs.mkdir(path.dirname(kodyFile), { recursive: true });
        await fs.writeFile(kodyFile, '# Test memory');

        await disableAction();

        const content = await fs.readFile(kodyFile, 'utf-8');
        expect(content).toBe('# Test memory');
    });

    it('is idempotent (disable when nothing installed reports not found)', async () => {
        await disableAction();

        const calls = vi.mocked(console.log).mock.calls.flat().join('\n');
        expect(calls).toContain('not found');
    });
});
