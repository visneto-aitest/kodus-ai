import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type {
    FileDiff,
    FileContent,
    GitInfo,
    PlatformType,
} from '../types/index.js';
import { cliDebug } from '../utils/logger.js';

class GitService {
    private git: SimpleGit;
    private verbose: boolean = false;

    constructor() {
        this.git = simpleGit();
    }

    setVerbose(verbose: boolean): void {
        this.verbose = verbose;
    }

    private async ensureRepo(): Promise<void> {
        const isRepo = await this.isGitRepository();
        if (!isRepo) {
            throw new Error(
                'Not a git repository. Run inside a Git repo or initialize one with "git init".',
            );
        }
    }

    async isGitRepository(): Promise<boolean> {
        try {
            await this.git.revparse(['--git-dir']);
            return true;
        } catch {
            return false;
        }
    }

    async getGitRoot(): Promise<string> {
        await this.ensureRepo();
        return this.git.revparse(['--show-toplevel']);
    }

    async getHeadSha(): Promise<string | null> {
        await this.ensureRepo();

        try {
            return (await this.git.revparse(['HEAD'])).trim();
        } catch {
            return null;
        }
    }

    async getRemoteUrl(remote = 'origin'): Promise<string | null> {
        try {
            const remotes = await this.git.getRemotes(true);
            const found = remotes.find((r) => r.name === remote);
            return found?.refs?.fetch || null;
        } catch {
            return null;
        }
    }

    async extractOrgRepo(): Promise<{ org: string; repo: string } | null> {
        const remoteUrl = await this.getRemoteUrl();
        if (!remoteUrl) {
            return null;
        }

        const patterns = [
            /github\.com[:/]([^/]+)\/([^/.]+)/,
            /gitlab\.com[:/]([^/]+)\/([^/.]+)/,
            /bitbucket\.org[:/]([^/]+)\/([^/.]+)/,
        ];

        for (const pattern of patterns) {
            const match = remoteUrl.match(pattern);
            if (match) {
                return { org: match[1], repo: match[2] };
            }
        }

        return null;
    }

    async getWorkingTreeDiff(): Promise<string> {
        await this.ensureRepo();

        if (this.verbose) {
            // Show git status first for context
            const status = await this.git.status();
            cliDebug(chalk.dim('[verbose] Git status before diff:'));
            cliDebug(
                chalk.dim(
                    `[verbose]   - staged: ${status.staged.length} file(s) - ${status.staged.join(', ') || 'none'}`,
                ),
            );
            cliDebug(
                chalk.dim(
                    `[verbose]   - modified: ${status.modified.length} file(s) - ${status.modified.join(', ') || 'none'}`,
                ),
            );
            cliDebug(
                chalk.dim(
                    `[verbose]   - not_added: ${status.not_added.length} file(s) - ${status.not_added.join(', ') || 'none'}`,
                ),
            );
            cliDebug(
                chalk.dim(
                    `[verbose]   - deleted: ${status.deleted.length} file(s) - ${status.deleted.join(', ') || 'none'}`,
                ),
            );
        }

        const staged = await this.git.diff(['--cached']);
        const unstaged = await this.git.diff();
        const result = `${staged}\n${unstaged}`.trim();

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Staged diff: ${staged ? `${staged.length} chars` : 'empty'}`,
                ),
            );
            cliDebug(
                chalk.dim(
                    `[verbose] Unstaged diff: ${unstaged ? `${unstaged.length} chars` : 'empty'}`,
                ),
            );
            cliDebug(
                chalk.dim(
                    `[verbose] Combined diff: ${result ? `${result.length} chars` : 'empty'}`,
                ),
            );
        }

        return result;
    }

    async getStagedDiff(): Promise<string> {
        await this.ensureRepo();
        const diff = await this.git.diff(['--cached']);

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Staged diff: ${diff ? `${diff.length} chars` : 'empty'}`,
                ),
            );
        }

        return diff;
    }

    async getDiffForCommit(commitSha: string): Promise<string> {
        await this.ensureRepo();
        const diff = await this.git.diff([`${commitSha}^`, commitSha]);

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Commit ${commitSha} diff: ${diff ? `${diff.length} chars` : 'empty'}`,
                ),
            );
        }

        return diff;
    }

    async getDiffForBranch(branchName: string): Promise<string> {
        await this.ensureRepo();
        const diff = await this.git.diff([`${branchName}...HEAD`]);

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Branch ${branchName}...HEAD diff: ${diff ? `${diff.length} chars` : 'empty'}`,
                ),
            );
        }

        return diff;
    }

    async getDiffForFiles(files: string[]): Promise<string> {
        await this.ensureRepo();
        const diffs: string[] = [];

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Getting diff for ${files.length} file(s): ${files.join(', ')}`,
                ),
            );
        }

        for (const file of files) {
            const stagedDiff = await this.git.diff(['--cached', '--', file]);
            const unstagedDiff = await this.git.diff(['--', file]);

            if (this.verbose) {
                cliDebug(
                    chalk.dim(
                        `[verbose]   ${file}: staged=${stagedDiff ? `${stagedDiff.length} chars` : 'empty'}, unstaged=${unstagedDiff ? `${unstagedDiff.length} chars` : 'empty'}`,
                    ),
                );
            }

            if (stagedDiff) {
                diffs.push(stagedDiff);
            }
            if (unstagedDiff) {
                diffs.push(unstagedDiff);
            }
        }

        const result = diffs.join('\n').trim();

        if (this.verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Combined file diff: ${result ? `${result.length} chars` : 'empty'}`,
                ),
            );
        }

        return result;
    }

    async getModifiedFiles(): Promise<FileDiff[]> {
        await this.ensureRepo();
        const status = await this.git.status();
        const files: FileDiff[] = [];

        const processFile = async (
            file: string,
            gitStatus: string,
        ): Promise<FileDiff> => {
            let status: FileDiff['status'] = 'modified';

            if (gitStatus === 'A' || gitStatus === '?') {
                status = 'added';
            } else if (gitStatus === 'D') {
                status = 'deleted';
            } else if (gitStatus === 'R') {
                status = 'renamed';
            }

            const diff = await this.git.diff(['--', file]);
            const lines = diff.split('\n');

            let additions = 0;
            let deletions = 0;

            for (const line of lines) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    additions++;
                }
                if (line.startsWith('-') && !line.startsWith('---')) {
                    deletions++;
                }
            }

            return { file, status, additions, deletions, diff };
        };

        for (const file of status.staged) {
            files.push(await processFile(file, 'M'));
        }

        for (const file of status.modified) {
            if (!files.find((f) => f.file === file)) {
                files.push(await processFile(file, 'M'));
            }
        }

        for (const file of status.not_added) {
            files.push(await processFile(file, 'A'));
        }

        return files;
    }

    async getFullFileContents(
        explicitFiles?: string[],
        options?: {
            staged?: boolean;
            commit?: string;
            branch?: string;
        },
    ): Promise<FileContent[]> {
        await this.ensureRepo();
        // 1. Identify files to process
        let filesToRead: string[];

        // Map to track file statuses (A=added, M=modified, D=deleted, R=renamed)
        const fileStatusMap = new Map<string, FileDiff['status']>();

        if (explicitFiles && explicitFiles.length > 0) {
            // Explicit files provided by the caller
            filesToRead = explicitFiles;
        } else if (options?.branch) {
            // Branch comparison: get files changed between branch and HEAD with status
            const nameStatus = await this.git.diff([
                '--name-status',
                `${options.branch}...HEAD`,
            ]);
            filesToRead = [];
            for (const line of nameStatus.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                const parts = trimmed.split('\t');
                const statusChar = parts[0];
                // For renames (R) or copies (C), the new file is the last part.
                const fileName = statusChar.startsWith('R') || statusChar.startsWith('C') ? parts[parts.length - 1] : parts[1];
                if (fileName) {
                    filesToRead.push(fileName);
                    fileStatusMap.set(
                        fileName,
                        this.parseGitStatus(statusChar),
                    );
                }
            }
        } else if (options?.commit) {
            // Commit diff: get files changed in that commit with status
            const nameStatus = await this.git.diff([
                '--name-status',
                `${options.commit}^`,
                options.commit,
            ]);
            filesToRead = [];
            for (const line of nameStatus.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                const parts = trimmed.split('\t');
                const statusChar = parts[0];
                // For renames (R) or copies (C), the new file is the last part.
                const fileName = statusChar.startsWith('R') || statusChar.startsWith('C') ? parts[parts.length - 1] : parts[1];
                if (fileName) {
                    filesToRead.push(fileName);
                    fileStatusMap.set(
                        fileName,
                        this.parseGitStatus(statusChar),
                    );
                }
            }
        } else {
            // Working tree: use getModifiedFiles()
            const allModifiedFiles = await this.getModifiedFiles();
            filesToRead = allModifiedFiles.map((f) => f.file);
            for (const f of allModifiedFiles) {
                fileStatusMap.set(f.file, f.status);
            }
        }

        // 2. For each file, read content and diff
        const fileContents: FileContent[] = [];

        for (const filePath of filesToRead) {
            try {
                // Resolve file status
                const status = fileStatusMap.get(filePath) || 'modified';

                // Skip deleted files (no content to read)
                if (status === 'deleted') {
                    continue;
                }

                // Read diff for this specific file
                let fileDiff: string;
                if (options?.branch) {
                    // Diff between target branch and HEAD
                    fileDiff = await this.git.diff([
                        `${options.branch}...HEAD`,
                        '--',
                        filePath,
                    ]);
                } else if (options?.commit) {
                    // Diff for the selected commit
                    fileDiff = await this.git.diff([
                        `${options.commit}^`,
                        options.commit,
                        '--',
                        filePath,
                    ]);
                } else if (options?.staged) {
                    // Staged-only diff
                    fileDiff = await this.git.diff([
                        '--cached',
                        '--',
                        filePath,
                    ]);
                } else {
                    // Full working-tree diff (staged + unstaged)
                    const stagedDiff = await this.git.diff([
                        '--cached',
                        '--',
                        filePath,
                    ]);
                    const unstagedDiff = await this.git.diff(['--', filePath]);
                    fileDiff = `${stagedDiff}\n${unstagedDiff}`.trim();
                }

                // Read file content
                let content: string;

                if (options?.commit) {
                    // Read file content from the selected commit
                    content = await this.git.show([
                        `${options.commit}:${filePath}`,
                    ]);
                } else if (options?.branch) {
                    // Read file content from HEAD to match the branch comparison diff target.
                    content = await this.git.show([`HEAD:${filePath}`]);
                } else {
                    // Read from working tree (fs.readFile)
                    const fullPath = path.resolve(filePath);
                    content = await fs.readFile(fullPath, 'utf-8');
                }

                fileContents.push({
                    path: filePath,
                    content,
                    status,
                    diff: fileDiff,
                });
            } catch {
                // File may be binary or inaccessible; skip silently.
                continue;
            }
        }

        return fileContents;
    }

    parseGitStatus(statusChar: string): FileDiff['status'] {
        const char = statusChar.charAt(0).toUpperCase();
        switch (char) {
            case 'A':
                return 'added';
            case 'D':
                return 'deleted';
            case 'R':
                return 'renamed';
            default:
                return 'modified';
        }
    }

    async getCurrentBranch(): Promise<string> {
        return this.git.revparse(['--abbrev-ref', 'HEAD']);
    }

    async getHeadCommit(): Promise<string> {
        return this.git.revparse(['HEAD']);
    }

    async getUserEmail(): Promise<string | undefined> {
        try {
            const email = await this.git.raw(['config', 'user.email']);
            return email.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async getGitInfo(): Promise<GitInfo> {
        const info: GitInfo = {
            userEmail: undefined,
            remote: undefined,
            branch: undefined,
            commitSha: undefined,
        };

        try {
            info.userEmail = await this.getUserEmail();
        } catch {
            // Git config not set
        }

        try {
            info.remote = await this.getRemoteUrl();
        } catch {
            // No remote configured
        }

        try {
            info.branch = await this.getCurrentBranch();
        } catch {
            // Not on a branch (detached HEAD)
        }

        try {
            info.commitSha = await this.getHeadCommit();
        } catch {
            // No commits yet
        }

        return info;
    }

    inferPlatform(remote: string | null | undefined): PlatformType {
        if (!remote) {
            return undefined;
        }

        const host = this.extractRemoteHost(remote);
        if (!host) {
            return undefined;
        }

        if (host === 'github.com') {
            return 'GITHUB';
        }
        if (host === 'gitlab.com') {
            return 'GITLAB';
        }
        if (host === 'bitbucket.org') {
            return 'BITBUCKET';
        }
        if (
            host === 'dev.azure.com' ||
            host === 'ssh.dev.azure.com' ||
            host === 'visualstudio.com' ||
            host.endsWith('.visualstudio.com')
        ) {
            return 'AZURE_REPOS';
        }

        return undefined;
    }

    private extractRemoteHost(remote: string): string | undefined {
        const value = remote.trim().toLowerCase();
        if (!value) {
            return undefined;
        }

        // Handles URLs like https://github.com/org/repo.git and ssh://git@github.com/org/repo.git
        try {
            const url = new URL(value);
            if (url.hostname) {
                return url.hostname.toLowerCase();
            }
        } catch {
            // Fallback below for SCP-like syntax.
        }

        // Handles SCP-like Git remotes like git@github.com:org/repo.git
        const scpLike = value.match(/^(?:[^@/]+@)?([^:/]+):.+$/);
        return scpLike?.[1];
    }
}

export const gitService = new GitService();
