import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { gitService } from '../../services/git.service.js';
import { stringifyYaml } from '../../utils/module-matcher.js';
import type { ModulesYml } from '../../types/memory.js';
import {
    parseAgents,
    installClaudeCompatibleHooks,
    installCodexNotify,
    installMergeHook,
    resolveCodexConfigPath,
    detectModules,
} from './hooks.js';
import { exitWithCode } from '../../utils/cli-exit.js';
import { cliError, cliInfo } from '../../utils/logger.js';

interface EnableOptions {
    agents?: string;
    codexConfig?: string;
    force?: boolean;
}

export async function enableAction(options: EnableOptions): Promise<void> {
    const isRepo = await gitService.isGitRepository();
    if (!isRepo) {
        cliError(chalk.red('Error: Not a git repository.'));
        exitWithCode(1);
    }

    const gitRoot = (await gitService.getGitRoot()).trim();

    let agents: Set<string>;
    try {
        agents = parseAgents(options.agents ?? 'claude,cursor,codex');
    } catch (error) {
        cliError(chalk.red((error as Error).message));
        exitWithCode(1);
    }

    const installClaudeCompat = agents.has('claude') || agents.has('cursor');
    const installCodex = agents.has('codex');

    // 1. Claude Code / Cursor hooks
    let claudeStatus = 'skipped';
    if (installClaudeCompat) {
        const result = await installClaudeCompatibleHooks(gitRoot);
        claudeStatus = result.changed ? 'installed' : 'already configured';
    }

    // 2. Codex notify
    let codexStatus = 'skipped';
    if (installCodex) {
        const codexConfigPath = resolveCodexConfigPath(options.codexConfig);
        const result = await installCodexNotify(codexConfigPath);
        if (result.changed) {
            codexStatus = 'installed';
        } else if (result.skipped) {
            codexStatus = 'skipped (existing notify entry)';
        } else {
            codexStatus = 'already configured';
        }
    }

    // 3. Post-merge hook (always)
    const mergeResult = await installMergeHook(gitRoot);
    const mergeStatus = mergeResult.alreadyInstalled
        ? 'already configured'
        : 'installed';

    // 4. Init modules.yml
    const configPath = path.join(gitRoot, '.kody', 'modules.yml');
    let modulesStatus: string;
    let modulesExist = false;

    try {
        await fs.access(configPath);
        modulesExist = true;
    } catch {
        // doesn't exist
    }

    if (modulesExist && !options.force) {
        modulesStatus = 'already exists';
    } else {
        const srcPath = path.join(gitRoot, 'src');
        const modules = await detectModules(srcPath);

        const config: ModulesYml = { version: 1, modules };
        const yamlContent = stringifyYaml(config);

        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, yamlContent, 'utf-8');

        modulesStatus =
            modules.length > 0
                ? `created (${modules.length} module${modules.length === 1 ? '' : 's'} detected)`
                : 'created (no modules detected)';
    }

    // Summary
    cliInfo(chalk.green('\u2713 Decisions enabled for this repository.'));
    cliInfo(`  Claude Code / Cursor hooks: ${claudeStatus}`);
    cliInfo(`  Codex notify: ${codexStatus}`);
    cliInfo(`  Post-merge hook: ${mergeStatus}`);
    cliInfo(`  Module config: ${modulesStatus}`);
}
