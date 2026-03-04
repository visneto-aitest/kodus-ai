import fs from 'fs/promises';
import type { AgentAdapter } from './agent.interface.js';
import type {
  AgentType,
  LifecycleEvent,
  EventType,
  TokenUsage,
  TranscriptParseResult,
  TranscriptContentBlock,
  ClaudeCodeHookEvent,
  ToolCall,
} from '../types/session.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const COMMAND_TOOLS = new Set(['Bash']);

const HOOK_TO_EVENT_TYPE: Record<ClaudeCodeHookEvent, EventType> = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  'stop': 'SessionEnd',
  'user-prompt-submit': 'TurnStart',
  'pre-task': 'SubagentStart',
  'post-task': 'SubagentEnd',
  'post-todo': 'TurnEnd',
};

export class ClaudeCodeAgent implements AgentAdapter {
  readonly agentType: AgentType = 'claude-code';

  parseHookEvent(hookName: string, payload: unknown): LifecycleEvent | null {
    const eventType = HOOK_TO_EVENT_TYPE[hookName as ClaudeCodeHookEvent];
    if (!eventType) return null;

    const obj = (payload && typeof payload === 'object' && !Array.isArray(payload))
      ? payload as Record<string, unknown>
      : {};

    const sessionId = pickString(obj, ['session_id', 'sessionId']) ?? '';
    const sessionRef = pickString(obj, ['transcript_path', 'transcriptPath', 'session_ref']) ?? '';
    const prompt = pickString(obj, ['prompt', 'user_message']);
    const toolUseId = pickString(obj, ['tool_use_id', 'toolUseId']);
    const subagentId = pickString(obj, ['subagent_id', 'subagentId']);
    const subagentType = pickString(obj, ['subagent_type', 'subagentType']);
    const taskDescription = pickString(obj, ['task_description', 'taskDescription']);

    let toolInput: unknown;
    if (obj['tool_input'] !== undefined) {
      toolInput = obj['tool_input'];
    } else if (obj['input'] !== undefined) {
      toolInput = obj['input'];
    }

    return {
      type: eventType,
      sessionId,
      sessionRef,
      prompt,
      timestamp: new Date(),
      toolUseId,
      subagentId,
      subagentType,
      taskDescription,
      toolInput,
    };
  }

  async readTranscript(transcriptPath: string, fromOffset = 0): Promise<TranscriptParseResult> {
    const result: TranscriptParseResult = {
      prompts: [],
      assistantMessages: [],
      modifiedFiles: [],
      tokenUsage: emptyTokenUsage(),
      summary: '',
      subagentIds: [],
      entryCount: 0,
      toolCalls: [],
      filesRead: [],
      commands: [],
    };

    const modifiedFilesSet = new Set<string>();
    const filesReadSet = new Set<string>();
    const subagentIdsSet = new Set<string>();
    let lastAssistantText = '';

    try {
      const content = await fs.readFile(transcriptPath, 'utf-8');
      const lines = content.slice(fromOffset).split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        result.entryCount++;

        const message = entry['message'] as Record<string, unknown> | undefined;
        if (!message) continue;

        const role = message['role'] as string | undefined;

        // Extract prompts from human/user messages
        if (role === 'human' || role === 'user') {
          const text = extractTextFromContent(message['content']);
          if (text) result.prompts.push(text);
        }

        // Extract assistant messages and token usage
        if (role === 'assistant') {
          const text = extractTextFromContent(message['content']);
          if (text) {
            result.assistantMessages.push(text);
            lastAssistantText = text;
          }

          // Token usage from assistant messages
          const usage = message['usage'] as Record<string, unknown> | undefined;
          if (usage) {
            result.tokenUsage.inputTokens += toNumber(usage['input_tokens']);
            result.tokenUsage.outputTokens += toNumber(usage['output_tokens']);
            result.tokenUsage.cacheCreationTokens += toNumber(usage['cache_creation_input_tokens']);
            result.tokenUsage.cacheReadTokens += toNumber(usage['cache_read_input_tokens']);
            result.tokenUsage.apiCallCount++;
          }

          // Extract tool calls from content blocks
          const content = message['content'];
          if (Array.isArray(content)) {
            for (const block of content) {
              if (!block || typeof block !== 'object') continue;
              const b = block as TranscriptContentBlock;

              if (b.type !== 'tool_use' || !b.name) continue;

              const toolName = b.name;
              const isMcp = toolName.includes('__') || toolName.startsWith('mcp_');
              const input = b.input ?? {};
              const filePath = input['file_path'] ?? input['filePath'];

              const toolCall: ToolCall = {
                toolName,
                toolUseId: b.id ?? '',
                timestamp: new Date().toISOString(),
                input: input as Record<string, unknown>,
                isMcp,
                mcpServer: isMcp ? toolName.split('__')[1] ?? toolName.split('_')[1] : undefined,
                fileAffected: typeof filePath === 'string' ? filePath : undefined,
              };
              result.toolCalls.push(toolCall);

              if (WRITE_TOOLS.has(toolName) && typeof filePath === 'string') {
                modifiedFilesSet.add(filePath);
              }
              if (READ_TOOLS.has(toolName) && typeof filePath === 'string') {
                filesReadSet.add(filePath);
              }
              if (COMMAND_TOOLS.has(toolName)) {
                const command = input['command'];
                if (typeof command === 'string') {
                  result.commands.push(command);
                }
              }
            }
          }
        }

        // Subagent tracking
        const subagentId = entry['subagent_id'] as string | undefined;
        if (subagentId) {
          subagentIdsSet.add(subagentId);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    result.modifiedFiles = [...modifiedFilesSet];
    result.filesRead = [...filesReadSet];
    result.subagentIds = [...subagentIdsSet];
    result.summary = lastAssistantText.slice(0, 500);

    return result;
  }

  async extractPrompts(transcriptPath: string): Promise<string[]> {
    const result = await this.readTranscript(transcriptPath);
    return result.prompts;
  }

  async extractSummary(transcriptPath: string): Promise<string> {
    const result = await this.readTranscript(transcriptPath);
    return result.summary;
  }

  async extractModifiedFiles(transcriptPath: string): Promise<string[]> {
    const result = await this.readTranscript(transcriptPath);
    return result.modifiedFiles;
  }

  async calculateTokenUsage(transcriptPath: string): Promise<TokenUsage> {
    const result = await this.readTranscript(transcriptPath);
    return result.tokenUsage;
  }

  async waitForTranscriptFlush(transcriptPath: string, timeoutMs = 3000): Promise<boolean> {
    const pollInterval = 50;
    const startTime = Date.now();
    let lastSize = -1;
    let stableCount = 0;
    const requiredStable = 3; // 150ms of no changes

    while (Date.now() - startTime < timeoutMs) {
      try {
        const stat = await fs.stat(transcriptPath);
        const currentSize = stat.size;

        if (currentSize === lastSize) {
          stableCount++;
          if (stableCount >= requiredStable) {
            return true; // File is stable
          }
        } else {
          stableCount = 0;
          lastSize = currentSize;
        }
      } catch {
        // File doesn't exist yet
        stableCount = 0;
      }

      await sleep(pollInterval);
    }

    return stableCount >= requiredStable;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      texts.push(b['text'] as string);
    }
  }
  return texts.join('\n');
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    apiCallCount: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const claudeCodeAgent = new ClaudeCodeAgent();
