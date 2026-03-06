import { Command } from 'commander';
import chalk from 'chalk';
import { listBundledSkills } from '../utils/skills.js';
import { cliInfo } from '../utils/logger.js';

async function listAction(): Promise<void> {
    const skills = await listBundledSkills();

    if (skills.length === 0) {
        cliInfo(chalk.yellow('No bundled skills found.'));
        return;
    }

    cliInfo(chalk.bold(`Available bundled skills (${skills.length})`));
    for (const skill of skills) {
        cliInfo(`- ${skill}`);
    }
}

export const skillsCommand = new Command('skills')
    .description('Inspect bundled Kodus skills')
    .action(listAction);

skillsCommand
    .command('list')
    .description('List bundled skills available in this CLI package')
    .action(listAction);
