import { jsonSchema } from 'ai';
import { RemoteCommands } from '../../adapters/services/collectCrossFileContexts.service';

export const MAX_GREP_MATCHES = 100;
export const MAX_READ_LENGTH = 12_000;
export const MAX_LIST_LENGTH = 8_000;
export const MAX_SHELL_OUTPUT = 10_000;

/**
 * Minimal interface for the documentation search capability.
 * Avoids importing DocumentationSearchExaService directly (which pulls in exa-js).
 */
export interface DocumentationSearchAdapter {
    searchByFilePlan(
        planByFile: Record<
            string,
            { queryTasks: Array<{ packageName: string; query: string }> }
        >,
        options?: Record<string, unknown>,
    ): Promise<
        Record<
            string,
            Array<{
                query: string;
                title: string;
                url: string;
                snippet: string;
                source: string;
            }>
        >
    >;
}

/**
 * Create a tool definition compatible with all AI SDK providers (including Anthropic).
 *
 * Uses `type: 'function'` + `inputSchema` with raw JSON Schema instead of Zod,
 * because Zod v4 + zod-to-json-schema is broken — it generates empty schemas
 * that Anthropic API rejects with "input_schema.type: Field required".
 */
function mkTool(
    desc: string,
    schema: Record<string, any>,
    exec: (args: any) => Promise<string>,
) {
    return {
        type: 'function' as const,
        description: desc,
        inputSchema: jsonSchema(schema),
        execute: exec,
    };
}

/**
 * Build the tool set for the agent from RemoteCommands.
 */
export function buildAgentTools(
    remoteCommands: RemoteCommands,
    docSearchService?: DocumentationSearchAdapter,
    docSearchOptions?: Record<string, unknown>,
    gitHubToken?: string,
): Record<string, any> {
    const tools: Record<string, any> = {
        grep: mkTool(
            'Search the repository for a regex pattern. Returns results as "file:lineNumber:content" with context lines around each match. ' +
                'Primary use: find callers of a changed function — search for the method name followed by "(" (e.g. grep("processItem\\(") finds every call site). ' +
                'The returned lineNumber is the exact line to use in readFile — call readFile(file, startLine=N-15, endLine=N+30) to read caller context. Do NOT read the whole file. ' +
                'Also use to find implementations of a changed interface or all usages of a changed constant. ' +
                'Use namesOnly=true to get only file paths. ' +
                'Use excludeTests=true to skip test/spec files and focus on production code.',
            {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description:
                            'Regex pattern to search for. To find callers of a method, use "methodName\\(" (escaping the parenthesis). To find usages of a constant, use the constant name.',
                    },
                    glob: {
                        type: 'string',
                        description:
                            'Optional glob to filter files (e.g. "*.ts", "*.java")',
                    },
                    path: {
                        type: 'string',
                        description: 'Optional directory to scope the search',
                    },
                    namesOnly: {
                        type: 'boolean',
                        description:
                            'Return only file paths instead of matching lines. Useful for blast-radius checks.',
                    },
                    excludeTests: {
                        type: 'boolean',
                        description:
                            'Exclude test and spec files from results. Use this when tracing production callers to avoid noise from test fixtures.',
                    },
                },
                required: ['pattern'],
            },
            async (args: any) => {
                const pattern = args.pattern || args.regex || '';
                const glob = args.glob || args.include || undefined;
                const searchPath =
                    (args.path || args.directory || args.dir || '.').replace(
                        /^\/+/,
                        '',
                    ) || '.';
                const namesOnly = args.namesOnly ?? false;
                const excludeTests = args.excludeTests ?? false;
                if (!pattern) return 'Error: pattern is required';

                // Use rg directly in sandbox for richer output (-n, -C 5)
                if (remoteCommands.exec) {
                    try {
                        const safePattern = pattern.replace(/'/g, "'\\''");
                        const safePath = searchPath.replace(/'/g, "'\\''");
                        const globArg = glob ? ` --glob '${glob}'` : '';
                        const excludeTestsArgs = excludeTests
                            ? ` --glob '!*test*' --glob '!*Test*' --glob '!*spec*' --glob '!*Spec*' --glob '!*__tests__*'`
                            : '';
                        const modeArg = namesOnly ? ' -l' : ' -n -C 5';
                        const cmd = `rg '${safePattern}'${globArg}${excludeTestsArgs}${modeArg} '${safePath}'`;
                        const { stdout, exitCode } =
                            await remoteCommands.exec(cmd);
                        // exit code 1 = no matches (not an error)
                        if (exitCode === 1 || !stdout.trim())
                            return 'No matches found.';
                        if (exitCode === 0) {
                            const lines = stdout.trim().split('\n');
                            if (lines.length > MAX_GREP_MATCHES) {
                                return (
                                    lines
                                        .slice(0, MAX_GREP_MATCHES)
                                        .join('\n') +
                                    `\n... (${lines.length - MAX_GREP_MATCHES} more lines)`
                                );
                            }
                            return stdout.trim();
                        }
                    } catch {
                        // rg not available, fall through to remoteCommands.grep
                    }
                }

                // Fallback: remoteCommands.grep (no context lines)
                let result: string;
                try {
                    result = await remoteCommands.grep(
                        pattern,
                        searchPath,
                        glob,
                    );
                } catch (err) {
                    return `Error searching for "${pattern}": ${err instanceof Error ? err.message : String(err)}`;
                }
                if (namesOnly) {
                    const files = [
                        ...new Set(
                            result
                                .split('\n')
                                .map((line) => line.split(':')[0])
                                .filter(Boolean),
                        ),
                    ];
                    return files.slice(0, MAX_GREP_MATCHES).join('\n');
                }
                const lines = result.split('\n');
                if (lines.length > MAX_GREP_MATCHES) {
                    result =
                        lines.slice(0, MAX_GREP_MATCHES).join('\n') +
                        `\n... (${lines.length - MAX_GREP_MATCHES} more matches)`;
                }
                return result;
            },
        ),

        readFile: mkTool(
            'Read file contents with injected line numbers. Always use startLine/endLine from grep results or diff @@ markers. ' +
                'Rule of thumb: readFile(file, startLine=grepLine-20, endLine=grepLine+30) gives enough context to understand a caller. ' +
                'Only read the full file when it is small (<150 lines). Never read a whole file to find a method — grep first.',
            {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to repo root',
                    },
                    startLine: {
                        type: 'number',
                        description:
                            'Start line (1-based). Use this to read around the changed lines (e.g. 50 lines before/after the diff)',
                    },
                    endLine: {
                        type: 'number',
                        description: 'End line (1-based)',
                    },
                },
                required: ['path'],
            },
            async (args: any) => {
                // Tolerate models sending file/filePath instead of path
                let filePath: string =
                    args.path || args.filePath || args.file || '';
                const startLine = args.startLine || args.start_line || 0;
                const endLine = args.endLine || args.end_line || 0;
                // Strip leading slash — paths are relative to repo root
                filePath = filePath.replace(/^\/+/, '');
                if (!filePath) return 'Error: path is required';
                let result: string;
                try {
                    result = await remoteCommands.read(
                        filePath,
                        startLine,
                        endLine,
                    );
                } catch (err) {
                    return `Error reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
                }
                if (!result && result !== '') {
                    return `Error: readFile returned ${typeof result} for ${filePath}`;
                }
                // Inject line numbers — LLMs need visual anchors to reference lines accurately
                const baseLineNumber = startLine > 0 ? startLine : 1;
                result = result
                    .split('\n')
                    .map((line, i) => `${baseLineNumber + i}: ${line}`)
                    .join('\n');
                if (result.length > MAX_READ_LENGTH) {
                    const lines = result.split('\n');
                    result =
                        result.substring(0, MAX_READ_LENGTH) +
                        `\n... (truncated — file has ~${lines.length} lines, call readFile again with startLine/endLine to read the rest)`;
                }
                return result;
            },
        ),

        listDir: mkTool(
            'List files and directories. Use maxDepth to control recursion (default 2).',
            {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path (default: ".")',
                    },
                    maxDepth: {
                        type: 'number',
                        description: 'Max recursion depth (default: 2, max: 4)',
                    },
                },
            },
            async (args: any) => {
                const dirPath =
                    (args.path || args.directory || args.dir || '.').replace(
                        /^\/+/,
                        '',
                    ) || '.';
                const depth = Math.min(args.maxDepth || args.max_depth || 2, 4);
                let result = await remoteCommands.listDir(dirPath, depth);
                // Filter out common noise directories
                const IGNORE_DIRS = [
                    'node_modules',
                    '.git',
                    'dist',
                    'build',
                    '.next',
                    '__pycache__',
                    'coverage',
                    '.turbo',
                    'vendor',
                    '.cache',
                ];
                result = result
                    .split('\n')
                    .filter(
                        (line) =>
                            !IGNORE_DIRS.some((dir) => line.includes(dir)),
                    )
                    .join('\n');
                if (result.length > MAX_LIST_LENGTH) {
                    result =
                        result.substring(0, MAX_LIST_LENGTH) +
                        `\n... (truncated)`;
                }
                return result;
            },
        ),

        findFile: mkTool(
            'Find files by name or glob pattern. Use this to locate files before reading them.',
            {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description:
                            'File name or glob pattern (e.g. "config.ts", "*.test.go", "schema")',
                    },
                    path: {
                        type: 'string',
                        description: 'Directory to search in (default: ".")',
                    },
                    extension: {
                        type: 'string',
                        description:
                            'Filter by extension (e.g. "ts", "go", "rb")',
                    },
                },
                required: ['pattern'],
            },
            async (args: any) => {
                const pattern = args.pattern || '';
                if (!pattern) return 'Error: pattern is required';
                const searchPath =
                    (args.path || '.').replace(/^\/+/, '') || '.';
                const ext = args.extension || args.ext || '';
                const safePattern = pattern.replace(/'/g, "'\\''");
                const safePath = searchPath.replace(/'/g, "'\\''");
                const extArg = ext ? ` -e '${ext}'` : '';

                try {
                    // Try fd first (fast, .gitignore aware), then find as fallback
                    if (remoteCommands.exec) {
                        // Try fd with --glob for precise matching
                        try {
                            const globPattern =
                                safePattern.includes('*') ||
                                safePattern.includes('?')
                                    ? safePattern
                                    : `*${safePattern}*`;
                            const fdCmd = `fd --glob '${globPattern}'${extArg} '${safePath}' --type f --max-results 30`;
                            const { stdout } = await remoteCommands.exec(fdCmd);
                            if (stdout && stdout.trim()) return stdout.trim();
                        } catch {
                            // fd not available, try find
                        }
                        // Fallback to find
                        try {
                            const cleanPattern = safePattern.replace(
                                /[*?[\]]/g,
                                '',
                            );
                            const findCmd = `find ${safePath} -type f -iname *${cleanPattern}*`;
                            const { stdout } =
                                await remoteCommands.exec(findCmd);
                            if (stdout && stdout.trim()) {
                                const lines = stdout.trim().split('\n');
                                return lines.slice(0, 30).join('\n');
                            }
                        } catch {
                            // find also failed, fall through to listDir
                        }
                    }

                    // Fallback: listDir + filter (slower, no .gitignore)
                    const allFiles = await remoteCommands.listDir(
                        searchPath,
                        4,
                    );
                    const matching = allFiles
                        .split('\n')
                        .filter(
                            (f: string) =>
                                f.trim() &&
                                f
                                    .toLowerCase()
                                    .includes(pattern.toLowerCase()) &&
                                (!ext || f.endsWith(`.${ext}`)),
                        );
                    if (matching.length === 0)
                        return `No files matching "${pattern}" in ${searchPath}`;
                    if (matching.length > 30) {
                        return (
                            matching.slice(0, 30).join('\n') +
                            `\n... (${matching.length - 30} more files)`
                        );
                    }
                    return matching.join('\n');
                } catch (err) {
                    return `Error finding files: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        ),
    };

    // Add exec-based tools if available
    if (remoteCommands.exec) {
        const exec = remoteCommands.exec;

        tools.shell = mkTool(
            'Execute a read-only shell command. Allowed: tsc, eslint, npx, python, go vet, cargo check.',
            {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description:
                            'Command to run (e.g. "npx tsc --noEmit src/file.ts")',
                    },
                },
                required: ['command'],
            },
            async ({ command }: any) => {
                const ALLOWED = [
                    'tsc ',
                    'npx ',
                    'eslint ',
                    'python ',
                    'python3 ',
                    'go ',
                    'cargo ',
                    'cat ',
                    'wc ',
                    'head ',
                    'tail ',
                    'file ',
                    'sg ',
                ];
                const isAllowed = ALLOWED.some((p) =>
                    command.trimStart().startsWith(p),
                );
                if (!isAllowed) {
                    return `Command not allowed. Allowed prefixes: ${ALLOWED.join(', ')}`;
                }
                if (/[;&|`$>]|\brm\b|\bsudo\b/.test(command)) {
                    return 'Command contains blocked patterns.';
                }
                const { stdout } = await exec(command);
                return stdout.length > MAX_SHELL_OUTPUT
                    ? stdout.substring(0, MAX_SHELL_OUTPUT) +
                          '\n... (truncated)'
                    : stdout;
            },
        );

        tools.astGrep = mkTool(
            'Structural code search using ast-grep. Finds code patterns based on AST structure, not just text. More precise than regex grep for code patterns.',
            {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description:
                            "ast-grep pattern (e.g. 'if ($COND) { return false }', 'function $NAME($ARGS) { $$$ }')",
                    },
                    lang: {
                        type: 'string',
                        description:
                            "Language hint (e.g. 'java', 'typescript', 'python', 'go', 'ruby')",
                    },
                    path: {
                        type: 'string',
                        description: "Directory to search in (default: '.')",
                    },
                },
                required: ['pattern'],
            },
            async (args: any) => {
                const pattern = args.pattern || '';
                if (!pattern) return 'Error: pattern is required';

                const EXT_MAP: Record<string, string> = {
                    typescript: 'ts',
                    javascript: 'js',
                    python: 'py',
                    go: 'go',
                    rust: 'rs',
                    java: 'java',
                    ruby: 'rb',
                    cpp: 'cpp',
                    c: 'c',
                    csharp: 'cs',
                    kotlin: 'kt',
                    swift: 'swift',
                    php: 'php',
                };

                // Sanitize pattern to prevent command injection
                const safePattern = pattern.replace(/'/g, "'\\''");
                const searchPath =
                    (args.path || '.').replace(/^\/+/, '') || '.';
                const safePath = searchPath.replace(/'/g, "'\\''");

                let cmd = `sg --pattern '${safePattern}' --json`;
                if (args.lang) {
                    const safeLang = String(args.lang).replace(
                        /[^a-zA-Z0-9_-]/g,
                        '',
                    );
                    cmd += ` --lang ${safeLang}`;
                }
                cmd += ` '${safePath}'`;

                try {
                    const { stdout, exitCode } = await exec(cmd);
                    if (
                        exitCode !== 0 &&
                        (stdout.includes('command not found') ||
                            stdout.includes('not found') ||
                            stdout.includes('ENOENT'))
                    ) {
                        // ast-grep not installed — fallback to regex grep
                        const lang = args.lang || '';
                        const ext = EXT_MAP[lang.toLowerCase()] || lang;
                        const fallbackPattern = pattern
                            .replace(/\$[A-Z_]+/g, '.*')
                            .replace(/[{}()]/g, '\\$&');
                        const glob = ext ? `*.${ext}` : undefined;
                        return remoteCommands
                            .grep(fallbackPattern, searchPath, glob)
                            .then(
                                (r) =>
                                    `[ast-grep not available, used regex fallback]\n${r}`,
                            );
                    }
                    const output = stdout || 'No matches found.';
                    return output.length > MAX_SHELL_OUTPUT
                        ? output.substring(0, MAX_SHELL_OUTPUT) +
                              '\n... (truncated)'
                        : output;
                } catch (err) {
                    const msg =
                        err instanceof Error ? err.message : String(err);
                    if (
                        msg.includes('not found') ||
                        msg.includes('No such file') ||
                        msg.includes('command not found') ||
                        msg.includes('ENOENT')
                    ) {
                        return 'ast-grep not available in this sandbox. Use the grep tool with regex patterns instead.';
                    }
                    return `ast-grep error: ${msg}`;
                }
            },
        );

        tools.checkTypes = mkTool(
            'Run type checker or linter on changed files. Auto-detects language and runs the appropriate tool ' +
            '(mypy/py_compile for Python, go vet/go build for Go, tsc for TypeScript, dart analyze, cargo check, ' +
            'php -l, ruby -c, javac, etc.). Use this early to find type errors, compile errors, and import issues.',
            {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description:
                            'File or directory to check (default: entire repo). Example: "src/api/paginator.py"',
                    },
                },
            },
            async (args: any) => {
                const target =
                    (args.path || '.').replace(/^\/+/, '') || '.';

                const checks: Array<{
                    lang: string;
                    ext: string;
                    cmds: string[];
                }> = [
                    {
                        lang: 'Python',
                        ext: '.py',
                        cmds: [
                            `python3 -m py_compile ${target.endsWith('.py') ? target : `$(find ${target} -name "*.py" -maxdepth 3 | head -10 | tr '\\n' ' ')`} 2>&1`,
                            `mypy ${target} --no-error-summary --no-color 2>&1 | head -30`,
                        ],
                    },
                    {
                        lang: 'Go',
                        ext: '.go',
                        cmds: [
                            `go vet ${target === '.' ? './...' : target} 2>&1 | head -30`,
                            `go build -o /dev/null ${target === '.' ? './...' : target} 2>&1 | head -30`,
                        ],
                    },
                    {
                        lang: 'TypeScript',
                        ext: '.ts',
                        cmds: [
                            `npx tsc --noEmit 2>&1 | head -40`,
                        ],
                    },
                    {
                        lang: 'Ruby',
                        ext: '.rb',
                        cmds: [
                            `ruby -c ${target.endsWith('.rb') ? target : `$(find ${target} -name "*.rb" -maxdepth 3 | head -10 | tr '\\n' ' ')`} 2>&1 | grep -v "Syntax OK" | head -20`,
                        ],
                    },
                    {
                        lang: 'PHP',
                        ext: '.php',
                        cmds: [
                            `php -l ${target.endsWith('.php') ? target : `$(find ${target} -name "*.php" -maxdepth 3 | head -10 | tr '\\n' ' ')`} 2>&1 | grep -v "No syntax errors" | head -20`,
                        ],
                    },
                    {
                        lang: 'Dart',
                        ext: '.dart',
                        cmds: [`dart analyze ${target} 2>&1 | head -30`],
                    },
                    {
                        lang: 'Rust',
                        ext: '.rs',
                        cmds: [`cargo check 2>&1 | head -30`],
                    },
                    {
                        lang: 'C#',
                        ext: '.cs',
                        cmds: [
                            `dotnet build --no-restore 2>&1 | grep -E "error|warning" | head -30`,
                        ],
                    },
                    {
                        lang: 'Java',
                        ext: '.java',
                        cmds: [
                            `javac -d /tmp/javaout ${target.endsWith('.java') ? target : `$(find ${target} -name "*.java" -maxdepth 3 | head -5 | tr '\\n' ' ')`} 2>&1 | head -30`,
                        ],
                    },
                    {
                        lang: 'Kotlin',
                        ext: '.kt',
                        cmds: [
                            `kotlinc -script ${target} 2>&1 | head -20`,
                        ],
                    },
                    {
                        lang: 'Swift',
                        ext: '.swift',
                        cmds: [
                            `swiftc -typecheck ${target.endsWith('.swift') ? target : `$(find ${target} -name "*.swift" -maxdepth 3 | head -5 | tr '\\n' ' ')`} 2>&1 | head -20`,
                        ],
                    },
                ];

                // Detect which languages exist
                let fileList = '';
                try {
                    const { stdout } = await exec(
                        `find ${target} -maxdepth 3 -type f 2>/dev/null | head -50`,
                    );
                    fileList = stdout;
                } catch {
                    return 'Could not scan files in target path.';
                }

                const results: string[] = [];
                for (const check of checks) {
                    if (!fileList.includes(check.ext)) continue;
                    for (const cmd of check.cmds) {
                        try {
                            const { stdout } = await exec(cmd);
                            const output = stdout?.trim();
                            if (
                                output &&
                                !output.includes('command not found') &&
                                !output.includes('not found')
                            ) {
                                results.push(
                                    `[${check.lang}]\n${output}`,
                                );
                            }
                        } catch {
                            // Linter not available, skip
                        }
                    }
                }

                if (results.length === 0) {
                    return 'No type errors or linter issues found (or no supported linter available).';
                }

                let result = results.join('\n\n');
                if (result.length > MAX_SHELL_OUTPUT) {
                    result =
                        result.substring(0, MAX_SHELL_OUTPUT) +
                        '\n... (truncated)';
                }
                return result;
            },
        );
    }

    // Add searchDocs if available
    if (docSearchService) {
        tools.searchDocs = mkTool(
            'Search external documentation for a package/library.',
            {
                type: 'object',
                properties: {
                    packageName: {
                        type: 'string',
                        description: 'Package name (e.g. "express")',
                    },
                    query: {
                        type: 'string',
                        description: 'What to search for in docs',
                    },
                },
                required: ['packageName', 'query'],
            },
            async ({ packageName, query }: any) => {
                if (!packageName || !query)
                    return 'Both packageName and query are required.';
                try {
                    const results = await docSearchService.searchByFilePlan(
                        { agent: { queryTasks: [{ packageName, query }] } },
                        docSearchOptions,
                    );
                    const docs = results['agent'] || [];
                    if (docs.length === 0)
                        return `No docs found for "${packageName}": ${query}`;
                    return docs
                        .map(
                            (d: any) =>
                                `### ${d.title}\n${d.url}\n${d.snippet}`,
                        )
                        .join('\n---\n');
                } catch (e) {
                    return `Doc search error: ${e instanceof Error ? e.message : String(e)}`;
                }
            },
        );
    }

    // Add readReference tool if GitHub token is available
    // Fetches files from any repo the user has access to (for cross-repo rule references)
    if (gitHubToken) {
        tools.readReference = mkTool(
            'Read a file from another repository. Use this to fetch reference files mentioned in rules (e.g., coding standards, patterns from other repos).',
            {
                type: 'object',
                properties: {
                    repo: {
                        type: 'string',
                        description:
                            'Full repository name (e.g. "my-org/design-system")',
                    },
                    path: {
                        type: 'string',
                        description:
                            'File path within the repository (e.g. "docs/standards.md")',
                    },
                    branch: {
                        type: 'string',
                        description: 'Branch name (default: main)',
                    },
                },
                required: ['repo', 'path'],
            },
            async ({ repo, path, branch }: any) => {
                if (!repo || !path) return 'Error: repo and path are required';
                const ref = branch || 'main';
                const safePath = encodeURIComponent(path);
                try {
                    const response = await fetch(
                        `https://api.github.com/repos/${repo}/contents/${safePath}?ref=${ref}`,
                        {
                            headers: {
                                Authorization: `Bearer ${gitHubToken}`,
                                Accept: 'application/vnd.github.v3.raw',
                            },
                        },
                    );
                    if (!response.ok) {
                        return `Error: Could not read ${path} from ${repo} (${response.status} ${response.statusText})`;
                    }
                    const content = await response.text();
                    if (content.length > MAX_READ_LENGTH) {
                        return (
                            content.substring(0, MAX_READ_LENGTH) +
                            `\n... (truncated — ${content.length} chars total)`
                        );
                    }
                    return content;
                } catch (err) {
                    return `Error reading ${path} from ${repo}: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        );
    }

    return tools;
}
