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
import { installSessionHooks } from './session-hooks-install.js';

interface EnableOptions {
  agents?: string;
  codexConfig?: string;
  force?: boolean;
}

export async function enableAction(options: EnableOptions): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    console.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const gitRoot = (await gitService.getGitRoot()).trim();

  let agents: Set<string>;
  try {
    agents = parseAgents(options.agents ?? 'claude,cursor,codex');
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
    return;
  }

  const installClaudeCompat = agents.has('claude') || agents.has('cursor');
  const installCodex = agents.has('codex');

  // 1. Decision capture hooks (Claude Code / Cursor)
  let captureStatus = 'skipped';
  if (installClaudeCompat) {
    const result = await installClaudeCompatibleHooks(gitRoot);
    captureStatus = result.changed ? 'installed' : 'already configured';
  }

  // 2. Session tracking hooks (Claude Code / Cursor)
  let sessionStatus = 'skipped';
  if (installClaudeCompat) {
    const result = await installSessionHooks(gitRoot, 'claude-code');
    sessionStatus = result.changed ? 'installed' : 'already configured';
  }

  // 3. Codex notify
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

  // 4. Post-merge hook (always)
  const mergeResult = await installMergeHook(gitRoot);
  const mergeStatus = mergeResult.alreadyInstalled ? 'already configured' : 'installed';

  // 5. Init modules.yml
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

    modulesStatus = modules.length > 0
      ? `created (${modules.length} module${modules.length === 1 ? '' : 's'} detected)`
      : 'created (no modules detected)';
  }

  // 6. Ensure logs directory (only local dir needed — session data lives in git)
  await fs.mkdir(path.join(gitRoot, '.kody', 'logs'), { recursive: true });

  // Summary
  console.log(chalk.green('\u2713 Decisions enabled for this repository.'));
  console.log(`  Decision capture hooks: ${captureStatus}`);
  console.log(`  Session tracking hooks: ${sessionStatus}`);
  console.log(`  Codex notify: ${codexStatus}`);
  console.log(`  Post-merge hook: ${mergeStatus}`);
  console.log(`  Module config: ${modulesStatus}`);
}
