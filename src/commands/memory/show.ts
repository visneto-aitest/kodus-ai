import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';

export async function showAction(name?: string): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    console.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  // If no argument, try current branch PR memory
  if (!name) {
    let branch: string;
    try {
      branch = (await gitService.getCurrentBranch()).trim();
    } catch {
      console.log(chalk.dim('No PR memory found.'));
      console.log('');
      console.log(chalk.dim('Session data is available in the Kodus dashboard.'));
      return;
    }

    const prMemory = await memoryService.readPrMemory(repoRoot, branch);
    if (prMemory) {
      console.log(prMemory.content);
      return;
    }

    console.log(chalk.dim('No PR memory found for this branch.'));
    console.log('');
    console.log(chalk.dim('Session data is available in the Kodus dashboard.'));
    return;
  }

  // Try as module name
  const moduleContent = await memoryService.readModuleMemory(repoRoot, name);
  if (moduleContent) {
    console.log(moduleContent);
    return;
  }

  // Try as branch name
  const branchMemory = await memoryService.readPrMemory(repoRoot, name);
  if (branchMemory) {
    console.log(branchMemory.content);
    return;
  }

  console.log(chalk.dim(`No module or branch memory found for: ${name}`));
  console.log('');
  console.log(chalk.dim('Session data is available in the Kodus dashboard.'));
}
