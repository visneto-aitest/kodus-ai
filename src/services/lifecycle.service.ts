import { createRequire } from 'node:module';
import { gitService } from './git.service.js';
import { hookLogger } from './hook-logger.service.js';
import { transcriptService } from './transcript.service.js';
import { saveLocal, loadLocal, removeLocal } from './session-local.service.js';
import { api } from './api/index.js';
import type { LifecycleEvent, AgentType, TokenUsage, ToolCall, FileChange } from '../types/session.js';
import type { SessionApiEvent } from '../types/session-events.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

async function getBranch(): Promise<string> {
  try {
    return (await gitService.getCurrentBranch()).trim();
  } catch {
    return '';
  }
}

async function getHead(): Promise<string> {
  return (await gitService.getHeadSha()) ?? '';
}

async function getRemote(): Promise<string> {
  return (await gitService.getRemoteUrl()) ?? '';
}

function sendEvent(event: SessionApiEvent, repoRoot: string): void {
  // Fire and forget — never blocks the agent
  api.sessions.sendEvent(event, repoRoot).catch(() => {});
}

class LifecycleService {
  async dispatch(repoRoot: string, agentType: AgentType, event: LifecycleEvent): Promise<void> {
    await hookLogger.init(repoRoot);

    switch (event.type) {
      case 'SessionStart':
        await this.handleSessionStart(repoRoot, agentType, event);
        break;
      case 'TurnStart':
        await this.handleTurnStart(repoRoot, agentType, event);
        break;
      case 'TurnEnd':
        await this.handleTurnEnd(repoRoot, agentType, event);
        break;
      case 'SessionEnd':
        await this.handleSessionEnd(repoRoot, agentType, event);
        break;
      case 'SubagentStart':
        await this.handleSubagentStart(repoRoot, agentType, event);
        break;
      case 'SubagentEnd':
        await this.handleSubagentEnd(repoRoot, agentType, event);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Session Start
  // -------------------------------------------------------------------------

  private async handleSessionStart(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('session-start', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
      transcript_path: event.sessionRef,
    });

    const [branch, baseCommit, gitRemote] = await Promise.all([
      getBranch(),
      getHead(),
      getRemote(),
    ]);

    sendEvent({
      type: 'session_start',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
      agentType,
      gitRemote,
      baseCommit,
      cliVersion: pkg.version,
    }, repoRoot);
  }

  // -------------------------------------------------------------------------
  // Turn Start (user-prompt-submit)
  // -------------------------------------------------------------------------

  private async handleTurnStart(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('turn-start', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
      prompt: event.prompt?.slice(0, 200),
    });

    const [branch, commitBefore] = await Promise.all([
      getBranch(),
      getHead(),
    ]);

    const turnId = `${Date.now()}`;

    // Save local state for correlation on TurnEnd
    const transcriptPath = event.sessionRef ?? '';
    let transcriptOffset = 0;
    if (transcriptPath) {
      try {
        const fs = await import('fs/promises');
        const s = await fs.stat(transcriptPath);
        transcriptOffset = s.size;
      } catch {
        // File may not exist yet
      }
    }

    await saveLocal(repoRoot, event.sessionId, {
      turnId,
      transcriptPath,
      transcriptOffset,
    });

    sendEvent({
      type: 'turn_start',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
      turnId,
      prompt: event.prompt ?? '',
      commitBefore,
    }, repoRoot);
  }

  // -------------------------------------------------------------------------
  // Turn End (stop / post-todo)
  // -------------------------------------------------------------------------

  private async handleTurnEnd(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('turn-end', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
    });

    const local = await loadLocal(repoRoot, event.sessionId);
    const turnId = local?.turnId ?? '';
    const transcriptPath = local?.transcriptPath ?? event.sessionRef ?? '';
    const transcriptOffset = local?.transcriptOffset ?? 0;

    const emptyTokenUsage: TokenUsage = {
      inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      outputTokens: 0, apiCallCount: 0,
    };

    let toolCalls: ToolCall[] = [];
    let filesModified: FileChange[] = [];
    let filesRead: string[] = [];
    let commands: string[] = [];
    let tokenUsage = emptyTokenUsage;

    if (transcriptPath) {
      const flushed = await transcriptService.waitForFlush(transcriptPath, 3000);
      if (flushed) {
        try {
          const parseResult = await transcriptService.parse(transcriptPath, transcriptOffset);
          toolCalls = parseResult.toolCalls;
          filesRead = parseResult.filesRead;
          commands = parseResult.commands;
          tokenUsage = parseResult.tokenUsage;
          filesModified = parseResult.modifiedFiles.map(p => ({ path: p, action: 'modified' as const }));
        } catch (error) {
          await hookLogger.warn('transcript-parse-error', 'transcript', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const [branch, commitAfter] = await Promise.all([
      getBranch(),
      getHead(),
    ]);

    sendEvent({
      type: 'turn_end',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
      turnId,
      toolCalls,
      filesModified,
      filesRead,
      commands,
      tokenUsage,
      commitAfter,
    }, repoRoot);
  }

  // -------------------------------------------------------------------------
  // Session End
  // -------------------------------------------------------------------------

  private async handleSessionEnd(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('session-end', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
    });

    const branch = await getBranch();

    sendEvent({
      type: 'session_end',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
    }, repoRoot);

    // Clean up local session file
    await removeLocal(repoRoot, event.sessionId);
  }

  // -------------------------------------------------------------------------
  // Subagent Start (pre-task)
  // -------------------------------------------------------------------------

  private async handleSubagentStart(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('subagent-start', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
      tool_use_id: event.toolUseId,
      subagent_type: event.subagentType,
      task_description: event.taskDescription?.slice(0, 200),
    });

    if (!event.toolUseId) return;

    const branch = await getBranch();

    // subagentType/taskDescription may live inside toolInput (Claude Code payload)
    const toolInput = (event.toolInput && typeof event.toolInput === 'object')
      ? event.toolInput as Record<string, unknown>
      : {};
    const subagentType = event.subagentType
      ?? pickString(toolInput, 'subagent_type', 'subagentType')
      ?? 'unknown';
    const taskDescription = event.taskDescription
      ?? pickString(toolInput, 'task_description', 'taskDescription', 'description', 'prompt')
      ?? '';

    sendEvent({
      type: 'subagent_start',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
      toolUseId: event.toolUseId,
      subagentType,
      taskDescription,
    }, repoRoot);
  }

  // -------------------------------------------------------------------------
  // Subagent End (post-task)
  // -------------------------------------------------------------------------

  private async handleSubagentEnd(
    repoRoot: string,
    agentType: AgentType,
    event: LifecycleEvent,
  ): Promise<void> {
    await hookLogger.info('subagent-end', 'lifecycle', {
      agent: agentType,
      model_session_id: event.sessionId,
      tool_use_id: event.toolUseId,
    });

    if (!event.toolUseId) return;

    const branch = await getBranch();

    sendEvent({
      type: 'subagent_end',
      sessionId: event.sessionId,
      branch,
      timestamp: new Date().toISOString(),
      toolUseId: event.toolUseId,
    }, repoRoot);
  }
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

export const lifecycleService = new LifecycleService();
