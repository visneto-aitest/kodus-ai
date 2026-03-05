import fs from 'fs/promises';
import path from 'path';
import type {
    MemoryCaptureInput,
    TranscriptSignals,
    DecisionEntry,
    DecisionType,
    PrMemoryMeta,
} from '../types/memory.js';
import { loadConfig, matchFiles } from '../utils/module-matcher.js';

/** @deprecated Use MemoryCaptureInput from types/memory.ts */
export interface LegacyMemoryCaptureInput {
    repoRoot: string;
    headSha: string | null;
    agent: string;
    event: string;
    payload?: unknown;
    summary?: string;
}

const MAX_JSON_CHARS = 4000;

const DECISION_KEYWORDS: { pattern: RegExp; type: DecisionType }[] = [
    {
        pattern: /\b(?:decided to|decision to|chose to|choosing)\b/i,
        type: 'architectural_decision',
    },
    {
        pattern: /\b(?:business rule|business requirement|stakeholder)\b/i,
        type: 'business_rule',
    },
    {
        pattern:
            /\b(?:tradeoff|trade-off|trade off|compromise|at the cost of)\b/i,
        type: 'tradeoff',
    },
    {
        pattern:
            /\b(?:defer|deferred|postpone|later|TODO|tech debt|revisit)\b/i,
        type: 'deferral',
    },
    {
        pattern: /\b(?:task|todo|need to|should also|follow[- ]up)\b/i,
        type: 'task',
    },
    {
        pattern:
            /\b(?:convention|standard|always use|never use|prefer|pattern)\b/i,
        type: 'convention',
    },
];

class MemoryService {
    // ─── Legacy per-SHA support ───────────────────────────────────────

    /** @deprecated Use saveBranchCapture instead */
    async saveCapture(input: LegacyMemoryCaptureInput): Promise<string> {
        const filePath = this.getLegacyMemoryFilePath(
            input.repoRoot,
            input.headSha,
        );
        const dirPath = path.dirname(filePath);

        await fs.mkdir(dirPath, { recursive: true });

        const fileExists = await this.exists(filePath);
        if (!fileExists) {
            const header = [
                '# Kody Decision Memory',
                '',
                'Staging memory captured from agent hooks for this HEAD sha.',
                '',
            ].join('\n');
            await fs.writeFile(filePath, header, 'utf-8');
        }

        const payloadObject = this.normalizePayload(input.payload);
        const signals = this.extractLegacySignals(payloadObject);
        const entry = this.formatLegacyEntry(input, payloadObject, signals);

        await fs.appendFile(filePath, entry, 'utf-8');

        return filePath;
    }

    private getLegacyMemoryFilePath(
        repoRoot: string,
        headSha: string | null,
    ): string {
        const safeSha = this.getSafeSha(headSha);
        return path.join(repoRoot, '.kody', 'pr', 'by-sha', `${safeSha}.md`);
    }

    // ─── Branch-based storage ─────────────────────────────────────────

    getBranchMemoryPath(repoRoot: string, branch: string): string {
        const safeBranch = this.sanitizeBranchName(branch);
        return path.join(repoRoot, '.kody', 'pr', `${safeBranch}.md`);
    }

    async saveBranchCapture(
        input: MemoryCaptureInput,
        signals: TranscriptSignals,
    ): Promise<string> {
        const filePath = this.getBranchMemoryPath(input.repoRoot, input.branch);
        const dirPath = path.dirname(filePath);

        await fs.mkdir(dirPath, { recursive: true });

        const now = new Date().toISOString();
        const fileExists = await this.exists(filePath);

        if (!fileExists) {
            const meta: PrMemoryMeta = {
                branch: input.branch,
                createdAt: now,
                updatedAt: now,
                lastSha: input.headSha ?? 'unknown',
                agent: input.agent,
                sessionCount: 1,
            };
            const content = this.buildNewBranchFile(meta);
            await fs.writeFile(filePath, content, 'utf-8');
        } else {
            await this.updateFrontmatter(filePath, {
                updatedAt: now,
                lastSha: input.headSha ?? 'unknown',
            });
        }

        const decisions = this.classifyDecisions(signals, input);
        const captureBlock = this.formatCaptureBlock(input, signals, now);
        const decisionBlocks = decisions.map((d) =>
            this.formatDecisionBlock(d),
        );

        let appendContent = '';

        if (decisionBlocks.length > 0) {
            appendContent += this.insertDecisions(decisionBlocks);
        }

        appendContent += captureBlock;

        await fs.appendFile(filePath, appendContent, 'utf-8');

        return filePath;
    }

    async readPrMemory(
        repoRoot: string,
        branch: string,
    ): Promise<{ meta: PrMemoryMeta | null; content: string } | null> {
        const filePath = this.getBranchMemoryPath(repoRoot, branch);
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const meta = this.parseFrontmatter(raw);
            return { meta, content: raw };
        } catch {
            return null;
        }
    }

    classifyDecisions(
        signals: TranscriptSignals,
        input: MemoryCaptureInput,
    ): DecisionEntry[] {
        const decisions: DecisionEntry[] = [];
        const text = [
            signals.prompt ?? '',
            signals.assistantMessage ?? '',
        ].join(' ');

        if (!text.trim()) {
            return decisions;
        }

        // Extract sentences that contain decision signals
        const sentences = text
            .split(/[.!?\n]+/)
            .filter((s) => s.trim().length > 10);

        for (const sentence of sentences) {
            for (const { pattern, type } of DECISION_KEYWORDS) {
                if (pattern.test(sentence)) {
                    const title = sentence.trim().slice(0, 120);
                    const id = this.generateDecisionId(type, title);

                    // Avoid duplicates within same batch
                    if (decisions.some((d) => d.id === id)) {
                        continue;
                    }

                    const config = { loadConfig };
                    void config; // module matching happens at promote time

                    decisions.push({
                        id,
                        type,
                        title,
                        rationale: sentence.trim(),
                        scope: {
                            files: signals.modifiedFiles,
                            modules: [], // filled at promote time via matchFiles
                        },
                        source: {
                            agent: input.agent,
                            event: input.event,
                            session: signals.sessionId,
                            sha: input.headSha ?? undefined,
                            branch: input.branch,
                        },
                        createdAt: new Date().toISOString(),
                    });

                    break; // one decision type per sentence
                }
            }
        }

        return decisions;
    }

    async promoteToModuleMemory(
        repoRoot: string,
        branch: string,
        filterModuleIds?: string[],
    ): Promise<{ promoted: number; modules: string[] }> {
        const prMemory = await this.readPrMemory(repoRoot, branch);
        if (!prMemory) {
            return { promoted: 0, modules: [] };
        }

        const config = await loadConfig(repoRoot);
        if (!config || config.modules.length === 0) {
            return { promoted: 0, modules: [] };
        }

        // Extract decisions from the PR memory content
        const decisions = this.extractDecisionsFromContent(prMemory.content);
        if (decisions.length === 0) {
            return { promoted: 0, modules: [] };
        }

        // Match files to modules
        const allFiles = decisions.flatMap((d) => d.files);
        const matchedModuleIds = matchFiles(allFiles, config.modules);

        const targetModuleIds = filterModuleIds
            ? matchedModuleIds.filter((id) => filterModuleIds.includes(id))
            : matchedModuleIds;

        if (targetModuleIds.length === 0) {
            return { promoted: 0, modules: [] };
        }

        let promoted = 0;

        for (const moduleId of targetModuleIds) {
            const mod = config.modules.find((m) => m.id === moduleId);
            if (!mod) {
                continue;
            }

            const memoryFilePath = path.join(repoRoot, mod.memoryFile);
            await fs.mkdir(path.dirname(memoryFilePath), { recursive: true });

            const header = await this.ensureModuleMemoryHeader(
                memoryFilePath,
                mod.name,
            );
            let content = header;

            for (const decision of decisions) {
                const decisionFiles = decision.files;
                const decisionModules = matchFiles(
                    decisionFiles,
                    config.modules,
                );
                if (!decisionModules.includes(moduleId)) {
                    continue;
                }

                content += `\n### ${decision.title}\n`;
                content += `- **Type:** ${decision.type}\n`;
                content += `- **Rationale:** ${decision.rationale}\n`;
                if (decisionFiles.length > 0) {
                    content += `- **Files:** ${decisionFiles.join(', ')}\n`;
                }
                content += `- **Source:** ${branch} / ${decision.source}\n`;
                promoted++;
            }

            await fs.writeFile(memoryFilePath, content, 'utf-8');
        }

        return { promoted, modules: targetModuleIds };
    }

    async readModuleMemory(
        repoRoot: string,
        moduleId: string,
    ): Promise<string | null> {
        const config = await loadConfig(repoRoot);
        if (!config) {
            return null;
        }

        const mod = config.modules.find((m) => m.id === moduleId);
        if (!mod) {
            return null;
        }

        try {
            return await fs.readFile(
                path.join(repoRoot, mod.memoryFile),
                'utf-8',
            );
        } catch {
            return null;
        }
    }

    // ─── Private helpers ──────────────────────────────────────────────

    sanitizeBranchName(branch: string): string {
        return (
            branch
                .replace(/[^a-zA-Z0-9_\-./]/g, '-')
                .replace(/\/{2,}/g, '/')
                .replace(/\.{2,}/g, '.')
                .replace(/^[.\-/]+|[.\-/]+$/g, '')
                .slice(0, 200) || 'unknown-branch'
        );
    }

    private getSafeSha(headSha: string | null): string {
        if (!headSha) {
            return 'no-head';
        }
        const trimmed = headSha.trim();
        if (/^[a-f0-9]{7,40}$/i.test(trimmed)) {
            return trimmed;
        }
        return 'no-head';
    }

    private normalizePayload(payload: unknown): Record<string, unknown> | null {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
        }
        return payload as Record<string, unknown>;
    }

    private extractLegacySignals(payload: Record<string, unknown> | null): {
        sessionId?: string;
        turnId?: string;
        prompt?: string;
        inputMessage?: string;
        assistantMessage?: string;
    } {
        if (!payload) {
            return {};
        }

        const sessionId = this.pickString(payload, [
            'session_id',
            'sessionId',
            'thread-id',
            'thread_id',
        ]);
        const turnId = this.pickString(payload, [
            'turn_id',
            'turnId',
            'call_id',
            'callId',
        ]);
        const prompt = this.pickString(payload, ['prompt', 'user_message']);
        const assistantMessage = this.pickString(payload, [
            'last_assistant_message',
            'last-assistant-message',
            'assistant_message',
            'assistant-message',
        ]);

        let inputMessage: string | undefined;
        const inputMessages = this.pickStringArray(payload, [
            'input_messages',
            'input-messages',
        ]);
        if (inputMessages && inputMessages.length > 0) {
            inputMessage = inputMessages[0];
        }

        return { sessionId, turnId, prompt, inputMessage, assistantMessage };
    }

    private pickString(
        payload: Record<string, unknown>,
        keys: string[],
    ): string | undefined {
        for (const key of keys) {
            const value = payload[key];
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed) {
                    return this.sanitizeLine(trimmed);
                }
            }
        }
        return undefined;
    }

    private pickStringArray(
        payload: Record<string, unknown>,
        keys: string[],
    ): string[] | undefined {
        for (const key of keys) {
            const value = payload[key];
            if (Array.isArray(value)) {
                const strings = value
                    .filter((item) => typeof item === 'string')
                    .map((item) => this.sanitizeLine(item as string))
                    .filter((item) => item.length > 0);
                if (strings.length > 0) {
                    return strings;
                }
            }
        }
        return undefined;
    }

    private sanitizeLine(value: string): string {
        return value.replace(/\s+/g, ' ').trim();
    }

    private formatLegacyEntry(
        input: LegacyMemoryCaptureInput,
        payload: Record<string, unknown> | null,
        signals: {
            sessionId?: string;
            turnId?: string;
            prompt?: string;
            inputMessage?: string;
            assistantMessage?: string;
        },
    ): string {
        const timestamp = new Date().toISOString();
        const lines: string[] = [];

        lines.push(`## ${timestamp} | ${input.agent} | ${input.event}`);
        lines.push('');
        lines.push(`- agent: \`${input.agent}\``);
        lines.push(`- event: \`${input.event}\``);
        if (input.headSha) {
            lines.push(`- head_sha: \`${input.headSha}\``);
        }
        if (signals.sessionId) {
            lines.push(`- session_id: \`${signals.sessionId}\``);
        }
        if (signals.turnId) {
            lines.push(`- turn_id: \`${signals.turnId}\``);
        }
        lines.push('');

        const signalsLines: string[] = [];
        if (input.summary) {
            signalsLines.push(`- summary: ${this.sanitizeLine(input.summary)}`);
        }
        if (signals.prompt) {
            signalsLines.push(`- prompt: ${signals.prompt}`);
        }
        if (signals.inputMessage) {
            signalsLines.push(`- input_message: ${signals.inputMessage}`);
        }
        if (signals.assistantMessage) {
            signalsLines.push(
                `- assistant_message: ${signals.assistantMessage}`,
            );
        }

        if (signalsLines.length > 0) {
            lines.push('### Signals');
            lines.push('');
            lines.push(...signalsLines);
            lines.push('');
        }

        if (payload) {
            lines.push('### Payload');
            lines.push('');
            lines.push('```json');
            lines.push(this.formatJson(payload));
            lines.push('```');
            lines.push('');
        }

        return `${lines.join('\n')}\n`;
    }

    private formatJson(payload: Record<string, unknown>): string {
        const json = JSON.stringify(payload, null, 2);
        if (json.length <= MAX_JSON_CHARS) {
            return json;
        }
        return `${json.slice(0, MAX_JSON_CHARS)}\n... (truncated)`;
    }

    private buildNewBranchFile(meta: PrMemoryMeta): string {
        const frontmatter = [
            '---',
            `branch: ${meta.branch}`,
            `created: ${meta.createdAt}`,
            `updated: ${meta.updatedAt}`,
            `last_sha: ${meta.lastSha}`,
            `agent: ${meta.agent}`,
            `sessions: ${meta.sessionCount}`,
            '---',
        ].join('\n');

        return `${frontmatter}\n\n# PR Memory: ${meta.branch}\n\n## Decisions\n\n## Captures\n\n`;
    }

    private async updateFrontmatter(
        filePath: string,
        updates: { updatedAt: string; lastSha: string },
    ): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            let updated = content
                .replace(/^updated:.*$/m, `updated: ${updates.updatedAt}`)
                .replace(/^last_sha:.*$/m, `last_sha: ${updates.lastSha}`);

            // Increment session count
            const sessionsMatch = updated.match(/^sessions:\s*(\d+)/m);
            if (sessionsMatch) {
                const count = parseInt(sessionsMatch[1], 10) + 1;
                updated = updated.replace(
                    /^sessions:\s*\d+/m,
                    `sessions: ${count}`,
                );
            }

            await fs.writeFile(filePath, updated, 'utf-8');
        } catch {
            // Fail-open: don't crash if frontmatter update fails
        }
    }

    private parseFrontmatter(content: string): PrMemoryMeta | null {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) {
            return null;
        }

        const lines = match[1].split('\n');
        const data: Record<string, string> = {};
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) {
                continue;
            }
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            data[key] = value;
        }

        return {
            branch: data['branch'] ?? '',
            createdAt: data['created'] ?? '',
            updatedAt: data['updated'] ?? '',
            lastSha: data['last_sha'] ?? '',
            agent: data['agent'] ?? '',
            sessionCount: parseInt(data['sessions'] ?? '0', 10),
        };
    }

    private formatCaptureBlock(
        input: MemoryCaptureInput,
        signals: TranscriptSignals,
        timestamp: string,
    ): string {
        const lines: string[] = [];

        lines.push(`### ${timestamp} | ${input.agent} | ${input.event}`);
        if (signals.modifiedFiles.length > 0) {
            lines.push(`- files_modified: ${signals.modifiedFiles.join(', ')}`);
        }
        if (signals.prompt) {
            lines.push(`- prompt: ${signals.prompt}`);
        }
        if (signals.assistantMessage) {
            const truncated =
                signals.assistantMessage.length > 300
                    ? signals.assistantMessage.slice(0, 300) + '...'
                    : signals.assistantMessage;
            lines.push(`- assistant_message: ${truncated}`);
        }
        lines.push('');

        return `${lines.join('\n')}\n`;
    }

    private formatDecisionBlock(decision: DecisionEntry): string {
        const lines: string[] = [];
        lines.push(`### [${decision.type}] ${decision.title}`);
        lines.push(`- **Rationale:** ${decision.rationale}`);
        if (decision.scope.files.length > 0) {
            lines.push(`- **Files:** ${decision.scope.files.join(', ')}`);
        }
        if (decision.scope.modules.length > 0) {
            lines.push(`- **Modules:** ${decision.scope.modules.join(', ')}`);
        }
        lines.push(
            `- **Source:** ${decision.source.agent} / ${decision.source.event} / ${decision.createdAt}`,
        );
        lines.push('');
        return lines.join('\n');
    }

    private insertDecisions(decisionBlocks: string[]): string {
        return decisionBlocks.join('\n') + '\n';
    }

    private generateDecisionId(type: string, title: string): string {
        const hash = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 40);
        return `${type}:${hash}`;
    }

    private extractDecisionsFromContent(content: string): Array<{
        type: string;
        title: string;
        rationale: string;
        files: string[];
        source: string;
    }> {
        const decisions: Array<{
            type: string;
            title: string;
            rationale: string;
            files: string[];
            source: string;
        }> = [];

        const decisionPattern = /^### \[(\w+)\] (.+)$/gm;
        let match: RegExpExecArray | null;

        while ((match = decisionPattern.exec(content)) !== null) {
            const type = match[1];
            const title = match[2];

            // Extract metadata following this heading
            const startIdx = match.index + match[0].length;
            const nextHeading = content.indexOf('\n###', startIdx);
            const block = content.slice(
                startIdx,
                nextHeading === -1 ? undefined : nextHeading,
            );

            const rationaleMatch = block.match(/\*\*Rationale:\*\*\s*(.+)/);
            const filesMatch = block.match(/\*\*Files:\*\*\s*(.+)/);
            const sourceMatch = block.match(/\*\*Source:\*\*\s*(.+)/);

            decisions.push({
                type,
                title,
                rationale: rationaleMatch?.[1] ?? '',
                files: filesMatch?.[1]?.split(',').map((f) => f.trim()) ?? [],
                source: sourceMatch?.[1] ?? '',
            });
        }

        return decisions;
    }

    private async ensureModuleMemoryHeader(
        filePath: string,
        moduleName: string,
    ): Promise<string> {
        try {
            const existing = await fs.readFile(filePath, 'utf-8');
            return existing;
        } catch {
            return `# Module Memory: ${moduleName}\n\n## Decisions\n`;
        }
    }

    private async exists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

export const memoryService = new MemoryService();
