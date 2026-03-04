import chalk from 'chalk';

export async function listAction(): Promise<void> {
  console.log(chalk.bold('Session data is available in the Kodus dashboard.'));
  console.log('');
  console.log(chalk.dim('Session tracking data is now sent to the Kodus API.'));
  console.log(chalk.dim('Visit your dashboard to view session history and decisions.'));
}
