import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import {
    removeClaudeCompatibleHooks,
    removeCodexNotify,
    removeMergeHook,
    resolveCodexConfigPath,
} from './hooks.js';
import { exitWithCode } from '../../utils/cli-exit.js';
import { cliError, cliInfo } from '../../utils/logger.js';

export async function disableAction(): Promise<void> {
    const isRepo = await gitService.isGitRepository();
    if (!isRepo) {
        cliError(chalk.red('Error: Not a git repository.'));
        exitWithCode(1);
    }

    const gitRoot = (await gitService.getGitRoot()).trim();

    const claudeResult = await removeClaudeCompatibleHooks(gitRoot);
    const codexResult = await removeCodexNotify(resolveCodexConfigPath());
    const mergeResult = await removeMergeHook(gitRoot);

    cliInfo(chalk.green('\u2713 Decision hooks removed.'));
    cliInfo(
        `  Claude Code / Cursor hooks: ${claudeResult.removed ? 'removed' : 'not found'}`,
    );
    cliInfo(`  Codex notify: ${codexResult.removed ? 'removed' : 'not found'}`);
    cliInfo(
        `  Post-merge hook: ${mergeResult.removed ? 'removed' : 'not found'}`,
    );
    cliInfo(chalk.dim('  Memory data in .kody/ preserved.'));
}
