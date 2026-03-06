import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { gitService } from '../../services/git.service.js';
import { KODUS_MARKER } from './install.js';
import { exitWithCode } from '../../utils/cli-exit.js';
import { cliError, cliInfo } from '../../utils/logger.js';

export async function uninstallAction(): Promise<void> {
    const isRepo = await gitService.isGitRepository();
    if (!isRepo) {
        cliError(chalk.red('Error: Not a git repository.'));
        exitWithCode(1);
    }

    const gitRoot = await gitService.getGitRoot();
    const hookPath = path.join(gitRoot.trim(), '.git', 'hooks', 'pre-push');

    let content: string;
    try {
        content = await fs.readFile(hookPath, 'utf-8');
    } catch {
        cliInfo(chalk.yellow('No pre-push hook found.'));
        return;
    }

    if (!content.includes(KODUS_MARKER)) {
        cliInfo(
            chalk.yellow(
                'The pre-push hook was not installed by kodus. Skipping.',
            ),
        );
        return;
    }

    await fs.unlink(hookPath);
    cliInfo(chalk.green('✓ Pre-push hook removed successfully.'));
}
