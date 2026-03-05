import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { exitWithCode } from '../../utils/cli-exit.js';
import { cliError, cliInfo } from '../../utils/logger.js';

interface PromoteOptions {
    branch?: string;
    modules?: string;
}

export async function promoteAction(options: PromoteOptions): Promise<void> {
    const isRepo = await gitService.isGitRepository();
    if (!isRepo) {
        cliError(chalk.red('Error: Not a git repository.'));
        exitWithCode(1);
    }

    const repoRoot = (await gitService.getGitRoot()).trim();

    let branch = options.branch;
    if (!branch) {
        try {
            branch = (await gitService.getCurrentBranch()).trim();
        } catch {
            cliError(
                chalk.red(
                    'Error: Could not determine current branch. Use --branch to specify.',
                ),
            );
            exitWithCode(1);
        }
    }

    const moduleIds = options.modules
        ? options.modules
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean)
        : undefined;

    const result = await memoryService.promoteToModuleMemory(
        repoRoot,
        branch,
        moduleIds,
    );

    if (result.promoted === 0) {
        cliInfo(chalk.dim('No decisions to promote.'));
        if (result.modules.length === 0) {
            cliInfo(
                chalk.dim(
                    'Check that modules.yml exists and PR memory has decisions with matching files.',
                ),
            );
        }
        return;
    }

    cliInfo(
        chalk.green(
            `✓ Promoted ${result.promoted} decision(s) to ${result.modules.length} module(s):`,
        ),
    );
    for (const modId of result.modules) {
        cliInfo(chalk.dim(`  - .kody/memory/${modId}.md`));
    }
}
