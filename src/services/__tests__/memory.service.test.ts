import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    MemoryCaptureInput,
    TranscriptSignals,
} from '../../types/memory.js';

vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        appendFile: vi.fn(),
        mkdir: vi.fn(),
        access: vi.fn(),
    },
}));

vi.mock('../../utils/module-matcher.js', () => ({
    loadConfig: vi.fn(),
    matchFiles: vi.fn(),
}));

import fs from 'fs/promises';
import { memoryService } from '../memory.service.js';
import { loadConfig, matchFiles } from '../../utils/module-matcher.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.appendFile).mockResolvedValue(undefined);
});

describe('MemoryService', () => {
    describe('sanitizeBranchName', () => {
        it('preserves simple branch names', () => {
            expect(memoryService.sanitizeBranchName('main')).toBe('main');
            expect(memoryService.sanitizeBranchName('feat/auth')).toBe(
                'feat/auth',
            );
        });

        it('replaces special characters with hyphens', () => {
            expect(memoryService.sanitizeBranchName('feat/auth@v2')).toBe(
                'feat/auth-v2',
            );
        });

        it('strips leading/trailing special chars', () => {
            expect(memoryService.sanitizeBranchName('/leading')).toBe(
                'leading',
            );
            expect(memoryService.sanitizeBranchName('trailing/')).toBe(
                'trailing',
            );
        });

        it('collapses multiple slashes and dots', () => {
            expect(memoryService.sanitizeBranchName('a//b')).toBe('a/b');
            expect(memoryService.sanitizeBranchName('a..b')).toBe('a.b');
        });

        it('truncates long names', () => {
            const long = 'a'.repeat(300);
            expect(
                memoryService.sanitizeBranchName(long).length,
            ).toBeLessThanOrEqual(200);
        });

        it('returns unknown-branch for empty input', () => {
            expect(memoryService.sanitizeBranchName('')).toBe('unknown-branch');
        });
    });

    describe('getBranchMemoryPath', () => {
        it('returns correct path for branch', () => {
            const result = memoryService.getBranchMemoryPath(
                '/repo',
                'feat/auth',
            );
            expect(result).toBe('/repo/.kody/pr/feat/auth.md');
        });
    });

    describe('saveBranchCapture', () => {
        const baseInput: MemoryCaptureInput = {
            repoRoot: '/repo',
            headSha: 'abc1234',
            agent: 'claude-code',
            event: 'stop',
            branch: 'feat/auth',
        };

        const baseSignals: TranscriptSignals = {
            modifiedFiles: ['src/auth.ts'],
            toolUses: [{ tool: 'Write', filePath: 'src/auth.ts' }],
            prompt: 'Refactor auth',
            assistantMessage: 'I decided to use JWT because it scales better.',
        };

        it('creates new branch file with frontmatter', async () => {
            vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

            await memoryService.saveBranchCapture(baseInput, baseSignals);

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            expect(writeCall).toBeDefined();
            const written = writeCall[1] as string;
            expect(written).toContain('---');
            expect(written).toContain('branch: feat/auth');
            expect(written).toContain('last_sha: abc1234');
            expect(written).toContain('# PR Memory: feat/auth');
            expect(written).toContain('## Decisions');
            expect(written).toContain('## Captures');
        });

        it('appends capture and decision blocks', async () => {
            vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

            await memoryService.saveBranchCapture(baseInput, baseSignals);

            expect(fs.appendFile).toHaveBeenCalled();
            const appended = vi.mocked(fs.appendFile).mock
                .calls[0][1] as string;
            expect(appended).toContain('claude-code | stop');
            expect(appended).toContain('files_modified: src/auth.ts');
        });

        it('classifies decisions from assistant message', async () => {
            vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

            await memoryService.saveBranchCapture(baseInput, baseSignals);

            const appended = vi.mocked(fs.appendFile).mock
                .calls[0][1] as string;
            expect(appended).toContain('[architectural_decision]');
        });

        it('updates frontmatter for existing file', async () => {
            vi.mocked(fs.access).mockResolvedValue(undefined);
            vi.mocked(fs.readFile).mockResolvedValue(
                '---\nbranch: feat/auth\ncreated: 2025-01-01T00:00:00Z\nupdated: 2025-01-01T00:00:00Z\nlast_sha: old123\nagent: claude-code\nsessions: 2\n---\n\n# PR Memory\n',
            );

            await memoryService.saveBranchCapture(baseInput, baseSignals);

            // Find the writeFile call for frontmatter update (the file path containing .kody/pr/)
            const writeCalls = vi.mocked(fs.writeFile).mock.calls;
            const frontmatterCall = writeCalls.find((c) =>
                (c[0] as string).includes('.kody/pr/'),
            );
            expect(frontmatterCall).toBeDefined();
            const updated = frontmatterCall![1] as string;
            expect(updated).toContain('last_sha: abc1234');
            expect(updated).toContain('sessions: 3');
        });
    });

    describe('classifyDecisions', () => {
        const baseInput: MemoryCaptureInput = {
            repoRoot: '/repo',
            headSha: 'abc1234',
            agent: 'claude-code',
            event: 'stop',
            branch: 'feat/test',
        };

        it('classifies architectural decisions', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
                assistantMessage:
                    'I decided to use a singleton pattern for the database connection.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions.length).toBeGreaterThan(0);
            expect(decisions[0].type).toBe('architectural_decision');
        });

        it('classifies tradeoffs', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
                assistantMessage:
                    'This is a tradeoff between performance and code readability in the service layer.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions.length).toBeGreaterThan(0);
            expect(decisions[0].type).toBe('tradeoff');
        });

        it('classifies deferrals', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
                assistantMessage:
                    'We should defer the caching implementation to a later sprint for this component.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions.length).toBeGreaterThan(0);
            expect(decisions[0].type).toBe('deferral');
        });

        it('classifies conventions', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
                assistantMessage:
                    'The convention is to always use camelCase for variable names in this codebase.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions.length).toBeGreaterThan(0);
            expect(decisions[0].type).toBe('convention');
        });

        it('returns empty for no decision keywords', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
                assistantMessage:
                    'Here is the updated file with the changes applied.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions).toEqual([]);
        });

        it('returns empty for empty text', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: [],
                toolUses: [],
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions).toEqual([]);
        });

        it('includes modified files in scope', () => {
            const signals: TranscriptSignals = {
                modifiedFiles: ['src/auth.ts', 'src/config.ts'],
                toolUses: [],
                assistantMessage:
                    'I decided to split the config into separate files.',
            };

            const decisions = memoryService.classifyDecisions(
                signals,
                baseInput,
            );
            expect(decisions[0].scope.files).toEqual([
                'src/auth.ts',
                'src/config.ts',
            ]);
        });
    });

    describe('readPrMemory', () => {
        it('returns null when file does not exist', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            const result = await memoryService.readPrMemory(
                '/repo',
                'feat/auth',
            );
            expect(result).toBeNull();
        });

        it('parses frontmatter from existing file', async () => {
            vi.mocked(fs.readFile).mockResolvedValue(
                '---\nbranch: feat/auth\ncreated: 2025-01-01T00:00:00Z\nupdated: 2025-01-02T00:00:00Z\nlast_sha: abc1234\nagent: claude-code\nsessions: 3\n---\n\n# PR Memory\n',
            );

            const result = await memoryService.readPrMemory(
                '/repo',
                'feat/auth',
            );
            expect(result).not.toBeNull();
            expect(result!.meta).toEqual({
                branch: 'feat/auth',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-02T00:00:00Z',
                lastSha: 'abc1234',
                agent: 'claude-code',
                sessionCount: 3,
            });
        });
    });

    describe('promoteToModuleMemory', () => {
        it('returns zero when no PR memory exists', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            const result = await memoryService.promoteToModuleMemory(
                '/repo',
                'feat/auth',
            );
            expect(result).toEqual({ promoted: 0, modules: [] });
        });

        it('returns zero when no modules config exists', async () => {
            vi.mocked(fs.readFile).mockResolvedValue(
                '---\nbranch: feat/auth\n---\n# PR Memory\n',
            );
            vi.mocked(loadConfig).mockResolvedValue(null);

            const result = await memoryService.promoteToModuleMemory(
                '/repo',
                'feat/auth',
            );
            expect(result).toEqual({ promoted: 0, modules: [] });
        });

        it('promotes decisions to matched modules', async () => {
            const prContent = [
                '---',
                'branch: feat/auth',
                'created: 2025-01-01T00:00:00Z',
                'updated: 2025-01-01T00:00:00Z',
                'last_sha: abc1234',
                'agent: claude-code',
                'sessions: 1',
                '---',
                '',
                '# PR Memory: feat/auth',
                '',
                '## Decisions',
                '',
                '### [architectural_decision] Use JWT for auth',
                '- **Rationale:** Stateless auth scales better.',
                '- **Files:** src/auth/jwt.ts',
                '- **Source:** claude-code / stop / 2025-01-01T00:00:00Z',
                '',
            ].join('\n');

            // readPrMemory reads the PR file
            vi.mocked(fs.readFile)
                .mockResolvedValueOnce(prContent) // readPrMemory
                .mockRejectedValueOnce(new Error('ENOENT')); // ensureModuleMemoryHeader (new file)

            vi.mocked(loadConfig).mockResolvedValue({
                version: 1,
                modules: [
                    {
                        id: 'auth',
                        name: 'Authentication',
                        paths: ['src/auth/**'],
                        memoryFile: '.kody/memory/auth.md',
                    },
                ],
            });

            vi.mocked(matchFiles)
                .mockReturnValueOnce(['auth']) // allFiles match
                .mockReturnValueOnce(['auth']); // per-decision match

            const result = await memoryService.promoteToModuleMemory(
                '/repo',
                'feat/auth',
            );
            expect(result.promoted).toBe(1);
            expect(result.modules).toEqual(['auth']);

            // Find the writeFile call that writes module memory
            const writeCalls = vi.mocked(fs.writeFile).mock.calls;
            const moduleCall = writeCalls.find((c) =>
                (c[0] as string).includes('memory/auth.md'),
            );
            expect(moduleCall).toBeDefined();
            const moduleContent = moduleCall![1] as string;
            expect(moduleContent).toContain('Use JWT for auth');
        });
    });

    describe('legacy saveCapture', () => {
        it('creates file with header and entry', async () => {
            vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

            await memoryService.saveCapture({
                repoRoot: '/repo',
                headSha: 'abc1234',
                agent: 'claude-code',
                event: 'stop',
                payload: { prompt: 'hello' },
            });

            expect(fs.writeFile).toHaveBeenCalled();
            expect(fs.appendFile).toHaveBeenCalled();
            const appended = vi.mocked(fs.appendFile).mock
                .calls[0][1] as string;
            expect(appended).toContain('claude-code');
            expect(appended).toContain('stop');
        });
    });
});
