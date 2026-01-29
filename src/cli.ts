import { createRequire } from 'node:module';
import { Command } from 'commander';
import { reviewCommand } from './commands/review.js';
import { authCommand } from './commands/auth/index.js';
import { upgradeCommand } from './commands/upgrade.js';
import { prCommand } from './commands/pr.js';
import { checkForUpdates } from './utils/update-check.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('kodus')
  .description('Kodus CLI - AI-powered code review from your terminal')
  .version(pkg.version)
  .option('-f, --format <format>', 'Output format: terminal, json, markdown', 'terminal')
  .option('-o, --output <file>', 'Output file (for json/markdown)')
  .option('-v, --verbose', 'Verbose output', false)
  .option('-q, --quiet', 'Quiet mode (errors only)', false)
  ;

program.addCommand(reviewCommand);
program.addCommand(authCommand);
program.addCommand(upgradeCommand);
program.addCommand(prCommand);

program.hook('postAction', async () => {
  await checkForUpdates(pkg.version);
});

export { program };
