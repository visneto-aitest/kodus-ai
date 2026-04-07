import { createLogger } from '@kodus/flow';
import { Injectable } from '@nestjs/common';
import type { Sandbox } from 'e2b';
import type { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { AstGraphRepository } from '../repositories/astGraph.repository';

const REPO_DIR = '/home/user/repo';
const GRAPH_DIR = '.kodus-graph';
const GRAPH_PATH = `${GRAPH_DIR}/graph.json`;
const PROMPT_PATH = `${GRAPH_DIR}/prompt.txt`;

const TIMEOUTS = {
    INSTALL_MS: 120_000, // 2 min — download + install bun + kodus-graph
    PARSE_MS: 300_000, // 5 min — full repo parse (large repos)
    CONTEXT_MS: 60_000, // 1 min — context generation
};

const KODUS_GRAPH_VERSION = '0.2.3';

/** Skip test/fixture/static files to stay within parse timeout on large repos */
const DEFAULT_EXCLUDES = [
    '**/tests/**',
    '**/test/**',
    '**/__tests__/**',
    '**/test_*',
    '**/*.test.*',
    '**/*.spec.*',
    '**/fixtures/**',
    '**/static/**',
    '**/__mocks__/**',
];

@Injectable()
export class KodusGraphService {
    private readonly logger = createLogger(KodusGraphService.name);

    constructor(
        private readonly astGraphRepo: AstGraphRepository,
    ) {}

    /**
     * Generate context using DB graph as baseline (new flow).
     * Parses only changed files, exports base graph from DB, runs kodus-graph context.
     */
    async generateContext(
        sandboxHandle: unknown,
        changedFiles: FileChange[],
        repoId: string,
    ): Promise<string> {
        const sandbox = sandboxHandle as Sandbox;
        if (!sandbox?.commands) return '';

        const filePaths = changedFiles
            .map((f) => f.filename || f.previous_filename)
            .filter(Boolean) as string[];
        if (filePaths.length === 0) return '';

        try {
            // Step 1: Install kodus-graph
            await this.installKodusGraph(sandbox);

            // Step 2: Parse ONLY changed files (not --all)
            await this.parseChangedFiles(sandbox, filePaths);

            // Step 3: Export base graph from DB and write to sandbox
            await this.writeBaseGraphToSandbox(sandbox, repoId);

            // Step 4: Generate context with real diff
            const prompt = await this.generatePromptContext(
                sandbox,
                filePaths,
                `${GRAPH_DIR}/base-graph.json`, // base graph from DB (main branch)
            );

            this.logger.log({
                message: `[KODUS-GRAPH] Context generated with DB baseline: ${prompt.length} chars`,
                context: KodusGraphService.name,
                metadata: { changedFiles: filePaths.length, promptChars: prompt.length },
            });

            return prompt;
        } catch (error) {
            this.logger.warn({
                message: `[KODUS-GRAPH] Failed with DB baseline, falling back to legacy`,
                context: KodusGraphService.name,
                error,
            });
            return this.generateContextLegacy(sandboxHandle, changedFiles);
        }
    }

    /**
     * Legacy flow: parse --all in sandbox. Used as fallback when DB graph not available.
     */
    async generateContextLegacy(
        sandboxHandle: unknown,
        changedFiles: FileChange[],
    ): Promise<string> {
        this.logger.log({
            message: `[KODUS-GRAPH] generateContext called: changedFiles=${changedFiles?.length}, sandboxHandle type=${typeof sandboxHandle}`,
            context: KodusGraphService.name,
        });

        const sandbox = sandboxHandle as Sandbox;
        if (!sandbox?.commands) {
            this.logger.warn({
                message: `[KODUS-GRAPH] No sandbox handle available, skipping (has commands: ${!!sandbox?.commands}, keys: ${sandbox ? Object.keys(sandbox).slice(0, 5).join(',') : 'null'})`,
                context: KodusGraphService.name,
            });
            return '';
        }

        const filePaths = changedFiles
            .map((f) => f.filename || f.previous_filename)
            .filter(Boolean) as string[];

        if (filePaths.length === 0) {
            this.logger.warn({
                message: `[KODUS-GRAPH] No file paths extracted from ${changedFiles?.length} changed files, skipping`,
                context: KodusGraphService.name,
            });
            return '';
        }

        try {
            // Step 1: Install bun + kodus-graph
            await this.installKodusGraph(sandbox);

            // Step 2: Parse full repo
            await this.parseRepo(sandbox);

            // Step 3: Generate context for changed files
            const prompt = await this.generatePromptContext(
                sandbox,
                filePaths,
            );

            this.logger.log({
                message: `[KODUS-GRAPH] Context generated: ${prompt.length} chars for ${filePaths.length} changed files`,
                context: KodusGraphService.name,
                metadata: {
                    changedFiles: filePaths.length,
                    promptChars: prompt.length,
                    promptPreview: prompt.substring(0, 320),
                },
            });

            return prompt;
        } catch (error) {
            this.logger.warn({
                message: `[KODUS-GRAPH] Failed to generate context, proceeding without it`,
                context: KodusGraphService.name,
                error,
            });
            return '';
        }
    }

    private async installKodusGraph(sandbox: Sandbox): Promise<void> {
        this.logger.log({
            message: '[KODUS-GRAPH] Installing bun + kodus-graph...',
            context: KodusGraphService.name,
        });

        const result = await sandbox.commands.run(
            [
                // Install bun if not present
                'which bun > /dev/null 2>&1 || (curl -fsSL https://bun.sh/install | bash > /dev/null 2>&1)',
                'export PATH="$HOME/.bun/bin:$PATH"',
                // Install kodus-graph globally
                `bun install -g @kodus/kodus-graph@${KODUS_GRAPH_VERSION} 2>&1`,
            ].join(' && '),
            { timeoutMs: TIMEOUTS.INSTALL_MS },
        );

        if (result.exitCode !== 0) {
            throw new Error(
                `kodus-graph install failed (exit=${result.exitCode}): ${(result.stderr || result.stdout || '').slice(0, 500)}`,
            );
        }

        this.logger.log({
            message: `[KODUS-GRAPH] Installed successfully`,
            context: KodusGraphService.name,
        });
    }

    private async parseRepo(sandbox: Sandbox): Promise<void> {
        this.logger.log({
            message: '[KODUS-GRAPH] Parsing full repo...',
            context: KodusGraphService.name,
        });

        const result = await sandbox.commands.run(
            [
                'export PATH="$HOME/.bun/bin:$PATH"',
                `cd ${REPO_DIR}`,
                `mkdir -p ${GRAPH_DIR}`,
                `kodus-graph parse --all --repo-dir . --out ${GRAPH_PATH} ${DEFAULT_EXCLUDES.map(p => `--exclude "${p}"`).join(' ')}`,
            ].join(' && '),
            { timeoutMs: TIMEOUTS.PARSE_MS },
        );

        if (result.exitCode !== 0) {
            throw new Error(
                `kodus-graph parse failed (exit=${result.exitCode}): ${(result.stderr || '').slice(0, 500)}`,
            );
        }

        // Log parse stats from stderr (kodus-graph writes progress to stderr)
        if (result.stderr) {
            this.logger.log({
                message: `[KODUS-GRAPH] Parse output: ${result.stderr.slice(0, 300)}`,
                context: KodusGraphService.name,
            });
        }
    }

    private async parseChangedFiles(sandbox: Sandbox, filePaths: string[]): Promise<void> {
        const filesArg = filePaths.join(' ');
        const result = await sandbox.commands.run(
            [
                'export PATH="$HOME/.bun/bin:$PATH"',
                `cd ${REPO_DIR}`,
                `mkdir -p ${GRAPH_DIR}`,
                `kodus-graph parse --files ${filesArg} --repo-dir . --out ${GRAPH_PATH}`,
            ].join(' && '),
            { timeoutMs: TIMEOUTS.PARSE_MS },
        );

        if (result.exitCode !== 0) {
            throw new Error(
                `kodus-graph parse --files failed (exit=${result.exitCode}): ${(result.stderr || '').slice(0, 500)}`,
            );
        }
    }

    private async writeBaseGraphToSandbox(sandbox: Sandbox, repoId: string): Promise<void> {
        const graphJson = await this.astGraphRepo.exportAsGraphJson(repoId);
        const jsonStr = JSON.stringify(graphJson);

        const baseGraphPath = `${REPO_DIR}/${GRAPH_DIR}/base-graph.json`;
        const chunkSize = 500_000; // 500KB

        if (jsonStr.length <= chunkSize) {
            const escaped = jsonStr.replace(/'/g, "'\\''");
            await sandbox.commands.run(
                `printf '%s' '${escaped}' > ${baseGraphPath}`,
                { timeoutMs: 30_000 },
            );
        } else {
            // Large graph: use base64 to avoid shell escaping issues
            const b64 = Buffer.from(jsonStr).toString('base64');
            await sandbox.commands.run(
                `echo '${b64}' | base64 -d > ${baseGraphPath}`,
                { timeoutMs: 60_000 },
            );
        }
    }

    private async generatePromptContext(
        sandbox: Sandbox,
        filePaths: string[],
        graphPath: string = GRAPH_PATH,
    ): Promise<string> {
        const filesArg = filePaths.join(' ');

        const result = await sandbox.commands.run(
            [
                'export PATH="$HOME/.bun/bin:$PATH"',
                `cd ${REPO_DIR}`,
                `kodus-graph context --files ${filesArg} --graph ${graphPath} --repo-dir . --format prompt --out ${PROMPT_PATH}`,
            ].join(' && '),
            { timeoutMs: TIMEOUTS.CONTEXT_MS },
        );

        if (result.exitCode !== 0) {
            throw new Error(
                `kodus-graph context failed (exit=${result.exitCode}): ${(result.stderr || '').slice(0, 500)}`,
            );
        }

        // Read the prompt file
        const readResult = await sandbox.commands.run(
            `cat ${REPO_DIR}/${PROMPT_PATH}`,
            { timeoutMs: 10_000 },
        );

        return readResult.stdout || '';
    }
}
