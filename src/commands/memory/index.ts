import { Command } from 'commander';
import { enableAction } from './enable.js';
import { disableAction } from './disable.js';
import { captureAction } from './capture.js';
import { statusAction } from './status.js';
import { showAction } from './show.js';
import { promoteAction } from './promote.js';

export const decisionsCommand = new Command('decisions').description(
    'Capture and persist coding-session decisions',
);

decisionsCommand
    .command('enable')
    .description(
        'Install all hooks and initialize module config for decision capture',
    )
    .option(
        '--agents <agents>',
        'Comma-separated list: claude,cursor,codex',
        'claude,cursor,codex',
    )
    .option(
        '--codex-config <path>',
        'Path to Codex config.toml (default: ~/.codex/config.toml)',
    )
    .option('--force', 'Overwrite existing modules.yml')
    .action(enableAction);

decisionsCommand
    .command('disable')
    .description('Remove all decision hooks (preserves .kody/ data)')
    .action(disableAction);

decisionsCommand
    .command('capture')
    .description('Internal hook command to persist decision capture')
    .argument('[payload]', 'Optional payload JSON (used by Codex notify)')
    .requiredOption(
        '--agent <agent>',
        'Agent name: claude-compatible, claude-code, cursor, codex',
    )
    .requiredOption('--event <event>', 'Hook event name')
    .option('--summary <text>', 'Optional summary text')
    .action(captureAction);

decisionsCommand
    .command('status')
    .description('Show current branch decision status')
    .action(statusAction);

decisionsCommand
    .command('show')
    .description('Show PR decisions (current branch) or module decisions')
    .argument('[name]', 'Module name or branch name')
    .action(showAction);

decisionsCommand
    .command('promote')
    .description('Promote PR decisions to module decision files')
    .option('--branch <name>', 'Branch name (default: current branch)')
    .option(
        '--modules <ids>',
        'Comma-separated module IDs (default: all matched)',
    )
    .action(promoteAction);
