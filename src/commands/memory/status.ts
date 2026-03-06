import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { loadConfig } from '../../utils/module-matcher.js';
import { exitWithCode } from '../../utils/cli-exit.js';
import { cliError, cliInfo } from '../../utils/logger.js';

export async function statusAction(): Promise<void> {
    const isRepo = await gitService.isGitRepository();
    if (!isRepo) {
        cliError(chalk.red('Error: Not a git repository.'));
        exitWithCode(1);
    }

    const repoRoot = (await gitService.getGitRoot()).trim();

    let branch: string;
    try {
        branch = (await gitService.getCurrentBranch()).trim();
    } catch {
        cliError(chalk.red('Error: Could not determine current branch.'));
        exitWithCode(1);
    }

    cliInfo(chalk.bold(`Branch: ${branch}`));
    cliInfo('');

    // PR memory status
    const prMemory = await memoryService.readPrMemory(repoRoot, branch);
    if (prMemory && prMemory.meta) {
        const meta = prMemory.meta;
        cliInfo(chalk.green('PR Memory:'));
        cliInfo(`  Sessions: ${meta.sessionCount}`);
        cliInfo(`  Last SHA: ${meta.lastSha}`);
        cliInfo(`  Agent: ${meta.agent}`);
        cliInfo(`  Updated: ${meta.updatedAt}`);

        // Count decisions in content
        const decisionCount = (prMemory.content.match(/^### \[\w+\]/gm) || [])
            .length;
        const captureCount = (
            prMemory.content.match(/^### \d{4}-\d{2}-\d{2}T/gm) || []
        ).length;
        cliInfo(`  Decisions: ${decisionCount}`);
        cliInfo(`  Captures: ${captureCount}`);
    } else {
        cliInfo(chalk.dim('No PR memory for this branch yet.'));
    }

    cliInfo('');

    // Module config status
    const config = await loadConfig(repoRoot);
    if (config) {
        cliInfo(
            chalk.green(`Module config: ${config.modules.length} module(s)`),
        );
        for (const mod of config.modules) {
            cliInfo(chalk.dim(`  - ${mod.id}: ${mod.paths.join(', ')}`));
        }
    } else {
        cliInfo(
            chalk.dim(
                'No module config found. Run `kodus decisions enable` to create one.',
            ),
        );
    }
}
