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

vi.mock('../../utils/module-matcher.js', () => ({
    stringifyYaml: vi.fn((config: unknown) => JSON.stringify(config)),
}));

import { gitService } from '../../services/git.service.js';
import { enableAction } from '../memory/enable.js';
import {
    MERGE_HOOK_MARKER,
    CODEX_NOTIFY_LINE,
    CODEX_NOTIFY_LINE_LEGACY,
} from '../memory/hooks.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-enable-test-'));
    await fs.mkdir(path.join(tmpDir, '.git', 'hooks'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src', 'commands'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src', 'services'), { recursive: true });
    vi.mocked(gitService.getGitRoot).mockResolvedValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('enableAction', () => {
    it('installs all hooks + modules.yml when none exist', async () => {
        await enableAction({
            codexConfig: path.join(tmpDir, '.codex', 'config.toml'),
        });

        // Claude settings created
        const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(settings.hooks).toHaveProperty('UserPromptSubmit');
        expect(settings.hooks).toHaveProperty('Stop');
        expect(settings.hooks).toHaveProperty('PostToolUse');

        // Codex config created
        const codexConfig = await fs.readFile(
            path.join(tmpDir, '.codex', 'config.toml'),
            'utf-8',
        );
        expect(codexConfig).toContain(CODEX_NOTIFY_LINE);

        // Post-merge hook created
        const hookContent = await fs.readFile(
            path.join(tmpDir, '.git', 'hooks', 'post-merge'),
            'utf-8',
        );
        expect(hookContent).toContain(MERGE_HOOK_MARKER);

        // modules.yml created
        const modulesContent = await fs.readFile(
            path.join(tmpDir, '.kody', 'modules.yml'),
            'utf-8',
        );
        expect(modulesContent).toContain('commands');
        expect(modulesContent).toContain('services');
    });

    it('is idempotent (second run reports already configured)', async () => {
        const codexConfig = path.join(tmpDir, '.codex', 'config.toml');

        await enableAction({ codexConfig });
        await enableAction({ codexConfig });

        const calls = vi.mocked(console.log).mock.calls.flat().join('\n');
        expect(calls).toContain('already configured');
    });

    it('migrates legacy codex notify line to stop event', async () => {
        const codexConfig = path.join(tmpDir, '.codex', 'config.toml');
        await fs.mkdir(path.dirname(codexConfig), { recursive: true });
        await fs.writeFile(
            codexConfig,
            `${CODEX_NOTIFY_LINE_LEGACY}\n`,
            'utf-8',
        );

        await enableAction({ codexConfig });

        const content = await fs.readFile(codexConfig, 'utf-8');
        expect(content).toContain(CODEX_NOTIFY_LINE);
        expect(content).not.toContain(CODEX_NOTIFY_LINE_LEGACY);
    });

    it('--agents claude skips codex', async () => {
        await enableAction({
            agents: 'claude',
            codexConfig: path.join(tmpDir, '.codex', 'config.toml'),
        });

        const calls = vi.mocked(console.log).mock.calls.flat().join('\n');
        expect(calls).toContain('Codex notify: skipped');

        // Codex config should not exist
        await expect(
            fs.access(path.join(tmpDir, '.codex', 'config.toml')),
        ).rejects.toThrow();
    });

    it('--force overwrites modules.yml', async () => {
        const configPath = path.join(tmpDir, '.kody', 'modules.yml');
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, 'old-content', 'utf-8');

        await enableAction({
            force: true,
            codexConfig: path.join(tmpDir, '.codex', 'config.toml'),
        });

        const content = await fs.readFile(configPath, 'utf-8');
        expect(content).not.toBe('old-content');
    });

    it('without --force preserves existing modules.yml', async () => {
        const configPath = path.join(tmpDir, '.kody', 'modules.yml');
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, 'old-content', 'utf-8');

        await enableAction({
            codexConfig: path.join(tmpDir, '.codex', 'config.toml'),
        });

        const content = await fs.readFile(configPath, 'utf-8');
        expect(content).toBe('old-content');

        const calls = vi.mocked(console.log).mock.calls.flat().join('\n');
        expect(calls).toContain('already exists');
    });
});
