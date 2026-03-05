import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { authService } from '../../services/auth.service.js';
import { api } from '../../services/api/index.js';
import { memoryService } from '../../services/memory.service.js';
import { transcriptParserService } from '../../services/transcript-parser.service.js';
import type {
    TranscriptSignals,
    MemoryCaptureApiRequest,
} from '../../types/memory.js';
import { cliError, cliInfo, isCliVerboseMode } from '../../utils/logger.js';

interface CaptureOptions {
    agent: string;
    event: string;
    summary?: string;
}

export async function captureAction(
    payloadArg: string | undefined,
    options: CaptureOptions,
): Promise<void> {
    try {
        const isRepo = await gitService.isGitRepository();
        if (!isRepo) {
            // Hook command must fail-open outside git repos.
            return;
        }

        const repoRoot = (await gitService.getGitRoot()).trim();
        const headSha = await gitService.getHeadSha();

        const payloadFromStdin = payloadArg
            ? undefined
            : await readStdinIfAvailable();
        const rawPayload = selectRawPayload(payloadFromStdin, payloadArg);

        const parsedPayload = parsePayload(rawPayload);
        const resolvedAgent = resolveAgent(options.agent);

        // Resolve branch for new structured storage
        let branch: string | undefined;
        try {
            branch = (await gitService.getCurrentBranch()).trim();
        } catch {
            // Detached HEAD or no branch - fall back to legacy
        }

        if (branch) {
            const signals = transcriptParserService.parse(parsedPayload);

            const filePath = await memoryService.saveBranchCapture(
                {
                    repoRoot,
                    headSha,
                    agent: resolvedAgent,
                    event: options.event,
                    branch,
                    payload: parsedPayload,
                    summary: options.summary,
                },
                signals,
            );

            if (isCliVerboseMode()) {
                cliInfo(
                    chalk.dim(`[memory] saved branch capture to ${filePath}`),
                );
            }

            if (options.event === 'stop') {
                submitCaptureToApi({
                    repoRoot,
                    headSha,
                    branch,
                    agent: resolvedAgent,
                    event: options.event,
                    signals,
                    summary: options.summary,
                }).catch(() => {}); // Intentionally swallowed — must not block hook
            }
        } else {
            // Legacy per-SHA fallback
            const filePath = await memoryService.saveCapture({
                repoRoot,
                headSha,
                agent: resolvedAgent,
                event: options.event,
                payload: parsedPayload,
                summary: options.summary,
            });

            if (isCliVerboseMode()) {
                cliInfo(chalk.dim(`[memory] saved capture to ${filePath}`));
            }
        }
    } catch (error) {
        // Hooks should not block development flow.
        if (isCliVerboseMode()) {
            const message =
                error instanceof Error ? error.message : String(error);
            cliError(chalk.yellow(`[memory] capture skipped: ${message}`));
        }
    }
}

function resolveAgent(rawAgent: string): string {
    if (rawAgent !== 'claude-compatible') {
        return rawAgent;
    }

    if (process.env.CURSOR_VERSION || process.env.CURSOR_PROJECT_DIR) {
        return 'cursor';
    }

    return 'claude-code';
}

async function readStdinIfAvailable(): Promise<string | undefined> {
    if (process.stdin.isTTY) {
        return undefined;
    }

    return new Promise<string>((resolve, reject) => {
        let data = '';
        let settled = false;
        const noDataTimer = setTimeout(() => {
            // Some hook runners keep stdin open forever without sending payload.
            // In that case, fail open and continue without stdin payload.
            finish(undefined);
        }, 750);
        const brokenStreamTimer = setTimeout(() => {
            // Safety net for broken streams that emit data but never close.
            finish(data.length > 0 ? data : undefined);
        }, 5000);

        const finish = (value: string | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(noDataTimer);
            clearTimeout(brokenStreamTimer);
            process.stdin.removeAllListeners('data');
            process.stdin.removeAllListeners('end');
            process.stdin.removeAllListeners('error');
            resolve(value ?? '');
        };

        process.stdin.setEncoding('utf-8');

        process.stdin.on('data', (chunk: string) => {
            data += chunk;
            clearTimeout(noDataTimer);
        });

        process.stdin.on('end', () => {
            finish(data);
        });

        process.stdin.on('error', (error) => {
            clearTimeout(noDataTimer);
            clearTimeout(brokenStreamTimer);
            reject(error);
        });

        process.stdin.resume();
    });
}

function parsePayload(rawPayload: string): unknown {
    if (!rawPayload) {
        return undefined;
    }

    try {
        return JSON.parse(rawPayload) as unknown;
    } catch {
        return { raw_payload: rawPayload };
    }
}

function selectRawPayload(
    payloadFromStdin: string | undefined,
    payloadArg: string | undefined,
): string {
    const stdinValue = payloadFromStdin?.trim() ?? '';
    if (stdinValue.length > 0) {
        return stdinValue;
    }

    return (payloadArg ?? '').trim();
}

const ASSISTANT_MESSAGE_MAX_CHARS = 10_000;

interface SubmitCaptureParams {
    repoRoot: string;
    headSha: string | null;
    branch: string;
    agent: string;
    event: string;
    signals: TranscriptSignals;
    summary?: string;
}

async function submitCaptureToApi(params: SubmitCaptureParams): Promise<void> {
    const isAuthed = await authService.isAuthenticated();
    if (!isAuthed) {
        return;
    }

    const token = await authService.getValidToken();

    const orgRepoResult = await gitService.extractOrgRepo();
    const orgRepo = orgRepoResult
        ? `${orgRepoResult.org}/${orgRepoResult.repo}`
        : null;

    const truncatedAssistantMessage = params.signals.assistantMessage
        ? params.signals.assistantMessage.slice(0, ASSISTANT_MESSAGE_MAX_CHARS)
        : undefined;

    const payload: MemoryCaptureApiRequest = {
        branch: params.branch,
        sha: params.headSha,
        orgRepo,
        agent: params.agent,
        event: params.event,
        signals: {
            sessionId: params.signals.sessionId,
            turnId: params.signals.turnId,
            prompt: params.signals.prompt,
            assistantMessage: truncatedAssistantMessage,
            modifiedFiles: params.signals.modifiedFiles,
            toolUses: params.signals.toolUses,
        },
        summary: params.summary,
        capturedAt: new Date().toISOString(),
    };

    const result = await api.memory.submitCapture(payload, token);

    if (isCliVerboseMode()) {
        cliInfo(
            chalk.dim(
                `[memory] submitted capture to API (id=${result.id}, accepted=${result.accepted})`,
            ),
        );
    }
}
