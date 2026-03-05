import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPORTED_AGENTS = new Set(['claude', 'cursor', 'codex']);

const DECISIONS_CAPTURE_COMMAND_PREFIX = 'kodus decisions capture';

export const CLAUDE_CAPTURE_COMMANDS = {
    userPromptSubmit:
        'kodus decisions capture --agent claude-compatible --event user-prompt-submit',
    stop: 'kodus decisions capture --agent claude-compatible --event stop',
    postToolUseWrite:
        'kodus decisions capture --agent claude-compatible --event post-tool-use-write',
    postToolUseEdit:
        'kodus decisions capture --agent claude-compatible --event post-tool-use-edit',
};

export const CODEX_NOTIFY_LINE =
    'notify = ["kodus", "decisions", "capture", "--agent", "codex", "--event", "stop"]';
export const CODEX_NOTIFY_LINE_LEGACY =
    'notify = ["kodus", "decisions", "capture", "--agent", "codex", "--event", "agent-turn-complete"]';

export const MERGE_HOOK_MARKER = '# kodus-memory-post-merge';
const MERGE_HOOK_END_MARKER = '# /kodus-memory-post-merge';
const MERGE_PROMOTE_COMMAND = 'kodus decisions promote';

const MERGE_HOOK_SCRIPT = `
${MERGE_HOOK_MARKER}
# Detect merged branch from the merge commit message
MERGED_BRANCH=$(git log -1 --merges --format=%s HEAD 2>/dev/null | sed -n "s/.*Merge branch '\\([^']*\\)'.*/\\1/p")
if [ -z "$MERGED_BRANCH" ]; then
  MERGED_BRANCH=$(git log -1 --merges --format=%s HEAD 2>/dev/null | sed -n "s/.*Merge pull request .* from [^/]*\\/\\(.*\\)/\\1/p")
fi
if [ -n "$MERGED_BRANCH" ]; then
  ${MERGE_PROMOTE_COMMAND} --branch "$MERGED_BRANCH" &
fi
${MERGE_HOOK_END_MARKER}
`.trimStart();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

export function parseAgents(rawAgents: string): Set<string> {
    const aliases: Record<string, string> = {
        'claude': 'claude',
        'claude-code': 'claude',
        'cursor': 'cursor',
        'codex': 'codex',
    };

    const selected = new Set<string>();

    for (const token of rawAgents.split(',')) {
        const normalized = token.trim().toLowerCase();
        if (!normalized) {
            continue;
        }

        const mapped = aliases[normalized];
        if (!mapped || !SUPPORTED_AGENTS.has(mapped)) {
            throw new Error(
                `Unsupported agent: ${normalized}. Supported values: claude, cursor, codex`,
            );
        }

        selected.add(mapped);
    }

    return selected;
}

export function resolveCodexConfigPath(rawPath?: string): string {
    if (!rawPath) {
        return path.join(os.homedir(), '.codex', 'config.toml');
    }

    if (rawPath.startsWith('~/')) {
        return path.join(os.homedir(), rawPath.slice(2));
    }

    return path.resolve(rawPath);
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        if (!isRecord(parsed)) {
            throw new Error('JSON root must be an object');
        }
        return parsed;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

function ensureObject(root: JsonObject, key: string): JsonObject {
    const existing = root[key];
    if (isRecord(existing)) {
        return existing;
    }

    const next: JsonObject = {};
    root[key] = next;
    return next;
}

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKodusCaptureCommand(command: string): boolean {
    return command.includes(DECISIONS_CAPTURE_COMMAND_PREFIX);
}

function upsertHook(
    hooks: JsonObject,
    eventKey: string,
    matcherName: string,
    command: string,
): boolean {
    const existing = hooks[eventKey];
    const matchers: unknown[] = Array.isArray(existing) ? existing : [];

    if (!Array.isArray(existing)) {
        hooks[eventKey] = matchers;
    }

    for (const matcherValue of matchers) {
        if (!isRecord(matcherValue)) {
            continue;
        }

        const currentMatcher =
            typeof matcherValue.matcher === 'string'
                ? matcherValue.matcher
                : '';
        if (currentMatcher !== matcherName) {
            continue;
        }

        const hooksArray = Array.isArray(matcherValue.hooks)
            ? matcherValue.hooks
            : [];
        if (!Array.isArray(matcherValue.hooks)) {
            matcherValue.hooks = hooksArray;
        }

        const alreadyExists = hooksArray.some(
            (hookValue) =>
                isRecord(hookValue) &&
                hookValue.type === 'command' &&
                hookValue.command === command,
        );
        if (alreadyExists) {
            return false;
        }

        for (const hookValue of hooksArray) {
            if (
                !isRecord(hookValue) ||
                hookValue.type !== 'command' ||
                typeof hookValue.command !== 'string'
            ) {
                continue;
            }

            if (isKodusCaptureCommand(hookValue.command)) {
                hookValue.command = command;
                return true;
            }
        }

        hooksArray.push({ type: 'command', command });
        return true;
    }

    matchers.push({
        matcher: matcherName,
        hooks: [
            {
                type: 'command',
                command,
            },
        ],
    });

    return true;
}

// ---------------------------------------------------------------------------
// Install functions
// ---------------------------------------------------------------------------

export async function installClaudeCompatibleHooks(
    repoRoot: string,
): Promise<{ settingsPath: string; changed: boolean }> {
    const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
    const settings = await readJsonObject(settingsPath);

    const hooks = ensureObject(settings, 'hooks');

    let changed = false;
    changed =
        upsertHook(
            hooks,
            'UserPromptSubmit',
            '',
            CLAUDE_CAPTURE_COMMANDS.userPromptSubmit,
        ) || changed;
    changed =
        upsertHook(hooks, 'Stop', '', CLAUDE_CAPTURE_COMMANDS.stop) || changed;
    changed =
        upsertHook(
            hooks,
            'PostToolUse',
            'Write',
            CLAUDE_CAPTURE_COMMANDS.postToolUseWrite,
        ) || changed;
    changed =
        upsertHook(
            hooks,
            'PostToolUse',
            'Edit',
            CLAUDE_CAPTURE_COMMANDS.postToolUseEdit,
        ) || changed;

    if (changed) {
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(
            settingsPath,
            `${JSON.stringify(settings, null, 2)}\n`,
            'utf-8',
        );
    }

    return { settingsPath, changed };
}

export async function installCodexNotify(configPath: string): Promise<{
    configPath: string;
    changed: boolean;
    skipped: boolean;
    reason: string;
}> {
    let content = '';

    try {
        content = await fs.readFile(configPath, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const notifyLinePattern = /^notify\s*=\s*\[(?:[^\n]*)\]\s*$/m;

    if (content.includes(CODEX_NOTIFY_LINE)) {
        return { configPath, changed: false, skipped: false, reason: '' };
    }

    if (content.includes(CODEX_NOTIFY_LINE_LEGACY)) {
        const nextContent = content.replace(
            CODEX_NOTIFY_LINE_LEGACY,
            CODEX_NOTIFY_LINE,
        );
        await fs.writeFile(configPath, nextContent, 'utf-8');
        return { configPath, changed: true, skipped: false, reason: '' };
    }

    if (notifyLinePattern.test(content)) {
        return {
            configPath,
            changed: false,
            skipped: true,
            reason: 'Existing `notify` entry found. Merge manually if you want Kodus decision capture.',
        };
    }

    const nextContent =
        content.trim().length === 0
            ? `${CODEX_NOTIFY_LINE}\n`
            : `${content.replace(/\s*$/, '')}\n${CODEX_NOTIFY_LINE}\n`;

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextContent, 'utf-8');

    return { configPath, changed: true, skipped: false, reason: '' };
}

export async function installMergeHook(
    gitRoot: string,
): Promise<{ hookPath: string; alreadyInstalled: boolean }> {
    const hookPath = path.join(gitRoot, '.git', 'hooks', 'post-merge');

    let existing = '';
    try {
        existing = await fs.readFile(hookPath, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    if (existing.includes(MERGE_HOOK_MARKER)) {
        return { hookPath, alreadyInstalled: true };
    }

    let content: string;
    if (existing.trim().length === 0) {
        content = `#!/bin/sh\n${MERGE_HOOK_SCRIPT}`;
    } else {
        content = `${existing.replace(/\s*$/, '')}\n\n${MERGE_HOOK_SCRIPT}`;
    }

    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, content, { mode: 0o755 });

    return { hookPath, alreadyInstalled: false };
}

export async function detectModules(
    srcPath: string,
): Promise<
    Array<{ id: string; name: string; paths: string[]; memoryFile: string }>
> {
    try {
        const entries = await fs.readdir(srcPath, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

        return dirs.map((dir) => ({
            id: dir,
            name: dir.charAt(0).toUpperCase() + dir.slice(1),
            paths: [`src/${dir}/**`],
            memoryFile: `.kody/memory/${dir}.md`,
        }));
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Remove functions (for disable)
// ---------------------------------------------------------------------------

export async function removeClaudeCompatibleHooks(
    repoRoot: string,
): Promise<{ settingsPath: string; removed: boolean }> {
    const settingsPath = path.join(repoRoot, '.claude', 'settings.json');

    let settings: JsonObject;
    try {
        settings = await readJsonObject(settingsPath);
    } catch {
        return { settingsPath, removed: false };
    }

    const hooks = settings.hooks;
    if (!isRecord(hooks)) {
        return { settingsPath, removed: false };
    }

    let removed = false;

    for (const eventKey of Object.keys(hooks)) {
        const matchers = hooks[eventKey];
        if (!Array.isArray(matchers)) {
            continue;
        }

        for (const matcher of matchers) {
            if (!isRecord(matcher) || !Array.isArray(matcher.hooks)) {
                continue;
            }

            const originalLength = matcher.hooks.length;
            matcher.hooks = (matcher.hooks as unknown[]).filter((h) => {
                if (!isRecord(h)) {
                    return true;
                }
                return (
                    typeof h.command !== 'string' ||
                    !isKodusCaptureCommand(h.command)
                );
            });

            if ((matcher.hooks as unknown[]).length < originalLength) {
                removed = true;
            }
        }

        // Remove matchers with empty hooks arrays
        hooks[eventKey] = matchers.filter((m) => {
            if (!isRecord(m)) {
                return true;
            }
            return Array.isArray(m.hooks) && m.hooks.length > 0;
        });

        // Remove event key if no matchers left
        if ((hooks[eventKey] as unknown[]).length === 0) {
            delete hooks[eventKey];
        }
    }

    // Remove hooks key if empty
    if (Object.keys(hooks).length === 0) {
        delete settings.hooks;
    }

    if (removed) {
        if (Object.keys(settings).length === 0) {
            // If settings is now empty, write empty object
            await fs.writeFile(settingsPath, '{}\n', 'utf-8');
        } else {
            await fs.writeFile(
                settingsPath,
                `${JSON.stringify(settings, null, 2)}\n`,
                'utf-8',
            );
        }
    }

    return { settingsPath, removed };
}

export async function removeCodexNotify(
    configPath: string,
): Promise<{ configPath: string; removed: boolean }> {
    let content: string;
    try {
        content = await fs.readFile(configPath, 'utf-8');
    } catch {
        return { configPath, removed: false };
    }

    if (
        !content.includes(CODEX_NOTIFY_LINE) &&
        !content.includes(CODEX_NOTIFY_LINE_LEGACY)
    ) {
        return { configPath, removed: false };
    }

    const nextContent = content
        .split('\n')
        .filter(
            (line) =>
                line.trim() !== CODEX_NOTIFY_LINE &&
                line.trim() !== CODEX_NOTIFY_LINE_LEGACY,
        )
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n*$/, '\n');

    await fs.writeFile(
        configPath,
        nextContent === '\n' ? '' : nextContent,
        'utf-8',
    );

    return { configPath, removed: true };
}

export async function removeMergeHook(
    gitRoot: string,
): Promise<{ hookPath: string; removed: boolean }> {
    const hookPath = path.join(gitRoot, '.git', 'hooks', 'post-merge');

    let content: string;
    try {
        content = await fs.readFile(hookPath, 'utf-8');
    } catch {
        return { hookPath, removed: false };
    }

    if (!content.includes(MERGE_HOOK_MARKER)) {
        return { hookPath, removed: false };
    }

    // Remove kodus block:
    // - Preferred: marker -> end marker (current format)
    // - Legacy fallback: marker -> end-of-file (older format without end marker)
    const lines = content.split('\n');
    const startIdx = lines.findIndex(
        (line) => line.trim() === MERGE_HOOK_MARKER,
    );
    if (startIdx === -1) {
        return { hookPath, removed: false };
    }

    const endIdx = lines.findIndex(
        (line, idx) => idx > startIdx && line.trim() === MERGE_HOOK_END_MARKER,
    );

    const filtered =
        endIdx === -1
            ? lines.slice(0, startIdx)
            : [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];

    const remaining = filtered
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n*$/, '\n');

    // If only shebang (or empty) remains, delete the file
    if (remaining.trim() === '#!/bin/sh' || remaining.trim() === '') {
        await fs.unlink(hookPath);
    } else {
        await fs.writeFile(hookPath, remaining, { mode: 0o755 });
    }

    return { hookPath, removed: true };
}
