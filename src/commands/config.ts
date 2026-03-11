import { Command } from 'commander';
import chalk from 'chalk';
import { repoConfigService } from '../services/repo-config.service.js';
import { exitWithCode } from '../utils/cli-exit.js';
import { cliError, cliInfo } from '../utils/logger.js';
import { normalizeCommandError } from '../utils/command-errors.js';

export async function configRepoAction(repository = '.'): Promise<void> {
    try {
        const result = await repoConfigService.addRepository(repository);

        if (result.status === 'already-added') {
            cliInfo(
                chalk.yellow(
                    `Repository '${result.repositoryFullName}' is already added to Kodus.`,
                ),
            );
            return;
        }

        cliInfo(
            chalk.green(
                `Repository '${result.repositoryFullName}' was added to Kodus successfully.`,
            ),
        );
    } catch (error) {
        const normalized = normalizeCommandError(error);
        cliError(chalk.red(normalized.message));
        exitWithCode(normalized.exitCode);
    }
}

export async function configRepoAddAction(repository = '.'): Promise<void> {
    await configRepoAction(repository);
}

export async function configRepoListAction(): Promise<void> {
    try {
        const repositories = await repoConfigService.listRepositories();

        if (repositories.length === 0) {
            cliInfo(chalk.yellow('No repositories are currently configured.'));
            return;
        }

        cliInfo('Configured repositories:');
        for (const repository of repositories) {
            cliInfo(`- ${repository.fullName}`);
        }
    } catch (error) {
        const normalized = normalizeCommandError(error);
        cliError(chalk.red(normalized.message));
        exitWithCode(normalized.exitCode);
    }
}

export const configCommand = new Command('config').description(
    'Configuration commands',
);

const repoCommand = configCommand
    .command('repo')
    .description('Manage repository configuration in Kodus.')
    .argument('[repository]', "Repository to add. Use '.' for the current repo.", '.')
    .action(configRepoAction);

repoCommand
    .command('add [repository]')
    .description("Add a repository to Kodus. Use '.' for the current repo.")
    .action(configRepoAddAction);

repoCommand
    .command('list')
    .description('List repositories already configured in Kodus.')
    .action(configRepoListAction);
