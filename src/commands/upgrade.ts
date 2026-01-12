import { Command } from 'commander';
import chalk from 'chalk';

const UPGRADE_URL = 'https://kodus.io/pricing';

export const upgradeCommand = new Command('upgrade')
  .description('Open the upgrade page in your browser')
  .action(async () => {
    console.log(chalk.blue('\nOpening upgrade page...'));
    console.log(chalk.dim(`URL: ${UPGRADE_URL}\n`));

    const open = await getOpenCommand();

    if (open) {
      const { execFile } = await import('child_process');
      // Use execFile instead of exec to prevent command injection
      execFile(open, [UPGRADE_URL], (error) => {
        if (error) {
          console.log(chalk.yellow(`Could not open browser. Please visit: ${UPGRADE_URL}`));
        }
      });
    } else {
      console.log(chalk.yellow(`Please visit: ${UPGRADE_URL}`));
    }
  });

async function getOpenCommand(): Promise<string | null> {
  switch (process.platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    case 'linux':
      return 'xdg-open';
    default:
      return null;
  }
}

