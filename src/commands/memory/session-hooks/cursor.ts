import { claudeCodeAgent } from '../../../agents/claude-code.agent.js';
import { handleHook } from './shared.js';
import type { ClaudeCodeHookEvent } from '../../../types/session.js';

/**
 * Cursor uses the same Claude Code hooks format (same settings.json schema),
 * so we reuse the Claude Code agent adapter.
 */

const VALID_HOOKS: Set<ClaudeCodeHookEvent> = new Set([
  'session-start',
  'session-end',
  'stop',
  'user-prompt-submit',
  'pre-task',
  'post-task',
  'post-todo',
]);

export async function cursorHookAction(hookName: string): Promise<void> {
  if (!VALID_HOOKS.has(hookName as ClaudeCodeHookEvent)) {
    if (process.env.KODUS_VERBOSE === 'true') {
      console.error(`[decisions] unknown Cursor hook: ${hookName}`);
    }
    return;
  }

  await handleHook(claudeCodeAgent, hookName);
}
