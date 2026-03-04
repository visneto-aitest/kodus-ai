import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendEventMock } = vi.hoisted(() => ({
  sendEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../git.service.js', () => ({
  gitService: {
    isGitRepository: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getHeadSha: vi.fn().mockResolvedValue('abc123'),
    getRemoteUrl: vi.fn().mockResolvedValue('git@github.com:org/repo.git'),
    getGitRoot: vi.fn().mockResolvedValue('/tmp/repo'),
  },
}));

vi.mock('../hook-logger.service.js', () => ({
  hookLogger: {
    init: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../transcript.service.js', () => ({
  transcriptService: {
    waitForFlush: vi.fn().mockResolvedValue(false),
    parse: vi.fn().mockResolvedValue({
      toolCalls: [],
      filesRead: [],
      commands: [],
      tokenUsage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, apiCallCount: 0 },
      modifiedFiles: [],
    }),
  },
}));

vi.mock('../session-local.service.js', () => ({
  saveLocal: vi.fn().mockResolvedValue(undefined),
  loadLocal: vi.fn().mockResolvedValue(null),
  removeLocal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/index.js', () => ({
  api: {
    sessions: {
      sendEvent: sendEventMock,
    },
  },
}));

import { lifecycleService } from '../lifecycle.service.js';
import type { LifecycleEvent } from '../../types/session.js';

function makeEvent(overrides: Partial<LifecycleEvent>): LifecycleEvent {
  return {
    type: 'SessionStart',
    sessionId: 'sess-1',
    sessionRef: '/tmp/transcript.jsonl',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('LifecycleService.dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends session_start event with git context', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SessionStart',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session_start',
        sessionId: 'sess-1',
        branch: 'main',
        agentType: 'claude-code',
        gitRemote: 'git@github.com:org/repo.git',
        baseCommit: 'abc123',
      }),
      '/tmp/repo',
    );
  });

  it('sends turn_start event with prompt', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'TurnStart',
      prompt: 'Fix the auth bug',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'turn_start',
        sessionId: 'sess-1',
        prompt: 'Fix the auth bug',
      }),
      '/tmp/repo',
    );
  });

  it('sends turn_end event', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'TurnEnd',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'turn_end',
        sessionId: 'sess-1',
      }),
      '/tmp/repo',
    );
  });

  it('sends session_end event and cleans up local state', async () => {
    const { removeLocal } = await import('../session-local.service.js');

    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SessionEnd',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session_end',
        sessionId: 'sess-1',
      }),
      '/tmp/repo',
    );
    expect(removeLocal).toHaveBeenCalledWith('/tmp/repo', 'sess-1');
  });

  it('sends subagent_start event', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SubagentStart',
      toolUseId: 'tool-1',
      subagentType: 'Explore',
      taskDescription: 'Find all controllers',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subagent_start',
        sessionId: 'sess-1',
        toolUseId: 'tool-1',
        subagentType: 'Explore',
        taskDescription: 'Find all controllers',
      }),
      '/tmp/repo',
    );
  });

  it('sends subagent_end event', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SubagentEnd',
      toolUseId: 'tool-1',
    }));

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subagent_end',
        toolUseId: 'tool-1',
      }),
      '/tmp/repo',
    );
  });

  it('skips subagent_start when toolUseId is missing', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SubagentStart',
      toolUseId: undefined,
    }));

    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it('skips subagent_end when toolUseId is missing', async () => {
    await lifecycleService.dispatch('/tmp/repo', 'claude-code', makeEvent({
      type: 'SubagentEnd',
      toolUseId: undefined,
    }));

    expect(sendEventMock).not.toHaveBeenCalled();
  });
});
