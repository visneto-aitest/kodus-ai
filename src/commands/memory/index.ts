import { Command } from 'commander';
import { enableAction } from './enable.js';
import { disableAction } from './disable.js';
import { captureAction } from './capture.js';
import { statusAction } from './status.js';
import { showAction } from './show.js';
import { promoteAction } from './promote.js';
import { sessionHooksCommand } from './session-hooks/index.js';
import { listAction } from './list.js';

export const decisionsCommand = new Command('decisions')
  .description('Session tracking, decision capture, and structured logging');

decisionsCommand.addCommand(sessionHooksCommand);

decisionsCommand
  .command('enable')
  .description('Install session tracking and decision capture hooks')
  .option('--agents <agents>', 'Comma-separated list: claude,cursor,codex', 'claude,cursor,codex')
  .option('--codex-config <path>', 'Path to Codex config.toml (default: ~/.codex/config.toml)')
  .option('--force', 'Overwrite existing modules.yml')
  .action(enableAction);

decisionsCommand
  .command('disable')
  .description('Remove all hooks (preserves session data)')
  .action(disableAction);

decisionsCommand
  .command('capture')
  .description('Internal hook command to persist decision capture')
  .argument('[payload]', 'Optional payload JSON (used by Codex notify)')
  .requiredOption('--agent <agent>', 'Agent name: claude-compatible, claude-code, cursor, codex')
  .requiredOption('--event <event>', 'Hook event name')
  .option('--summary <text>', 'Optional summary text')
  .action(captureAction);

decisionsCommand
  .command('status')
  .description('Show session and decision status')
  .action(statusAction);

decisionsCommand
  .command('list')
  .description('List all tracked sessions')
  .action(listAction);

decisionsCommand
  .command('show')
  .description('Show session details or module decisions')
  .argument('[name]', 'Session ID prefix, module name, or branch name')
  .action(showAction);

decisionsCommand
  .command('promote')
  .description('Promote PR decisions to module decision files')
  .option('--branch <name>', 'Branch name (default: current branch)')
  .option('--modules <ids>', 'Comma-separated module IDs (default: all matched)')
  .action(promoteAction);
