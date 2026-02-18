import { api } from './api/index.js';
import { authService } from './auth.service.js';
import { gitService } from './git.service.js';
import { getTrialIdentifier } from '../utils/rate-limit.js';
import { loadConfig } from '../utils/config.js';
import { CLI_VERSION } from '../constants.js';
import chalk from 'chalk';
import { ApiError } from '../types/index.js';
import type { ReviewConfig, ReviewResult, TrialReviewResult, PullRequestSuggestionsResponse, ReviewIssue, ApiFileSuggestion, ApiPrLevelSuggestion, ApiSuggestionsObject, Severity, FileContent } from '../types/index.js';

const MAX_FILES = 100;
const MAX_DIFF_SIZE = 500 * 1024;       // 500KB
const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2MB

class ReviewService {
  private verbose: boolean = false;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  async analyze(
    diff: string,
    rulesOnly?: boolean,
    fast?: boolean,
    options?: { files?: string[]; staged?: boolean; commit?: string; branch?: string }
  ): Promise<ReviewResult> {
    const token = await authService.getValidToken();

    if (this.verbose) {
      console.log(chalk.dim(`[verbose] Review config: rulesOnly=${!!rulesOnly}, fast=${!!fast}`));
      console.log(chalk.dim(`[verbose] Diff size: ${diff.length} characters`));
    }

    const reviewConfig: ReviewConfig = {
      rulesOnly,
      fast,
    };

    if (!fast) {
      const allFiles = await gitService.getFullFileContents(
        options?.files,
        {
          staged: options?.staged,
          commit: options?.commit,
          branch: options?.branch,
        }
      );

      reviewConfig.files = this.filterFiles(allFiles);

      if (this.verbose) {
        console.log(chalk.dim(`[verbose] Full file contents: ${reviewConfig.files?.length || 0} file(s)`));
        if (reviewConfig.files && reviewConfig.files.length > 0) {
          reviewConfig.files.forEach(f => {
            console.log(chalk.dim(`[verbose]   - ${f.path}: ${f.content.length} chars, status=${f.status}`));
          });
        }
      }
    }

    const teamConfig = await loadConfig();
    const isTeamKey = token.startsWith('kodus_');

    if (isTeamKey && teamConfig) {
      const gitInfo = await gitService.getGitInfo();
      const inferredPlatform = gitInfo.remote
        ? gitService.inferPlatform(gitInfo.remote)
        : undefined;

      if (this.verbose) {
        console.log(chalk.dim('[verbose] Using team key with metrics'));
        console.log(chalk.dim(`[verbose] Git info: branch=${gitInfo.branch}, remote=${gitInfo.remote}`));
        console.log(chalk.dim('[verbose] Sending to API:'));
        console.log(chalk.dim(`[verbose]   - diff length: ${diff.length} chars`));
        console.log(chalk.dim(`[verbose]   - config: ${JSON.stringify(reviewConfig)}`));
      }

      const result = await api.review.analyzeWithMetrics(
        diff,
        token,
        reviewConfig,
        {
          userEmail: gitInfo.userEmail,
          gitRemote: gitInfo.remote || undefined,
          branch: gitInfo.branch,
          commitSha: gitInfo.commitSha,
          inferredPlatform,
          cliVersion: CLI_VERSION,
        }
      );

      if (this.verbose) {
        console.log(chalk.dim('[verbose] API response:'));
        console.log(chalk.dim(`[verbose]   - summary: ${result.summary}`));
        console.log(chalk.dim(`[verbose]   - issues: ${result.issues?.length ?? 0}`));
        console.log(chalk.dim(`[verbose]   - filesAnalyzed: ${result.filesAnalyzed}`));
      }

      return result;
    }

    if (this.verbose) {
      console.log(chalk.dim('[verbose] Using personal token (no metrics)'));
    }

    if (this.verbose) {
      console.log(chalk.dim('[verbose] Sending to API:'));
      console.log(chalk.dim(`[verbose]   - diff length: ${diff.length} chars`));
      console.log(chalk.dim(`[verbose]   - config: ${JSON.stringify(reviewConfig)}`));
    }

    const result = await api.review.analyze(diff, token, reviewConfig);

    if (this.verbose) {
      console.log(chalk.dim('[verbose] API response:'));
      console.log(chalk.dim(`[verbose]   - summary: ${result.summary}`));
      console.log(chalk.dim(`[verbose]   - issues: ${result.issues?.length ?? 0}`));
      console.log(chalk.dim(`[verbose]   - filesAnalyzed: ${result.filesAnalyzed}`));
    }

    return result;
  }

  async getPullRequestSuggestions(params: { prUrl?: string; prNumber?: number; repositoryId?: string; format?: 'markdown'; severity?: string; category?: string }): Promise<{ result: ReviewResult; markdown?: string }> {
    if (!params.prUrl && !(params.prNumber && params.repositoryId)) {
      throw new Error('Provide prUrl or prNumber with repositoryId to fetch pull request suggestions.');
    }

    const token = await authService.getValidToken();

    let response: PullRequestSuggestionsResponse;
    try {
      response = await api.review.getPullRequestSuggestions(token, params);
    } catch (error) {
      const canFallbackToTeamKey = error instanceof ApiError && error.statusCode === 401 && !token.startsWith('kodus_');
      if (!canFallbackToTeamKey) {
        throw error;
      }

      const config = await loadConfig();
      if (!config?.teamKey) {
        throw error;
      }

      try {
        response = await api.review.getPullRequestSuggestions(config.teamKey, params);
      } catch {
        // Preserve the primary auth failure from the original token attempt.
        throw error;
      }
    }

    return {
      result: this.normalizeSuggestionsResponse(response),
      markdown: response.markdown,
    };
  }

  async trialAnalyze(diff: string): Promise<TrialReviewResult> {
    const fingerprint = await getTrialIdentifier();

    if (this.verbose) {
      console.log(chalk.dim('[verbose] Running trial analyze'));
      console.log(chalk.dim(`[verbose] Diff size: ${diff.length} characters`));
      // Show diff preview
      const preview = diff.substring(0, 300);
      console.log(chalk.dim(`[verbose] Diff preview:\n${preview}${diff.length > 300 ? '\n... (truncated)' : ''}`));
    }

    const result = await api.review.trialAnalyze(diff, fingerprint);

    if (this.verbose) {
      console.log(chalk.dim('[verbose] Trial API response:'));
      console.log(chalk.dim(`[verbose]   - summary: ${result.summary}`));
      console.log(chalk.dim(`[verbose]   - issues: ${result.issues?.length ?? 0}`));
      console.log(chalk.dim(`[verbose]   - filesAnalyzed: ${result.filesAnalyzed}`));
    }

    return result;
  }

  normalizeSuggestionsResponse(response: PullRequestSuggestionsResponse): ReviewResult {
    let issues: ReviewIssue[] = [];

    if (Array.isArray(response.issues)) {
      issues = response.issues;
    } else if (Array.isArray(response.suggestions)) {
      issues = response.suggestions;
    } else if (response.suggestions && typeof response.suggestions === 'object') {
      const suggestionsObj = response.suggestions as ApiSuggestionsObject;
      issues = [
        ...this.mapFileSuggestions(suggestionsObj.files ?? []),
        ...this.mapPrLevelSuggestions(suggestionsObj.prLevel ?? []),
      ];
    }

    return {
      summary: response.summary ?? 'Pull request suggestions',
      issues,
      filesAnalyzed: response.filesAnalyzed ?? new Set(issues.map(i => i.file)).size,
      duration: response.duration ?? 0,
    };
  }

  mapFileSuggestions(files: ApiFileSuggestion[]): ReviewIssue[] {
    return files.map((s) => ({
      file: s.filePath ?? s.relevantFile,
      line: s.relevantLinesStart ?? 1,
      endLine: s.relevantLinesEnd,
      severity: this.normalizeSeverity(s.severity),
      message: s.suggestionContent,
      suggestion: s.oneSentenceSummary,
      ruleId: s.label,
    }));
  }

  mapPrLevelSuggestions(prLevel: ApiPrLevelSuggestion[]): ReviewIssue[] {
    return prLevel.map((s) => ({
      file: 'PR',
      line: 0,
      severity: this.normalizeSeverity(s.severity),
      message: s.suggestionContent,
      suggestion: s.oneSentenceSummary,
      ruleId: s.label,
    }));
  }

  private filterFiles(files: FileContent[]): FileContent[] {
    const skipped: string[] = [];
    const filtered = files.filter(f => {
      const diffBytes = Buffer.byteLength(f.diff, 'utf8');
      const contentBytes = Buffer.byteLength(f.content, 'utf8');
      if (diffBytes > MAX_DIFF_SIZE) {
        const sizeKB = Math.round(diffBytes / 1024);
        skipped.push(`  - ${f.path} (diff: ${sizeKB}KB, max: ${MAX_DIFF_SIZE / 1024}KB)`);
        return false;
      }
      if (contentBytes > MAX_CONTENT_SIZE) {
        const sizeMB = (contentBytes / (1024 * 1024)).toFixed(1);
        skipped.push(`  - ${f.path} (content: ${sizeMB}MB, max: ${MAX_CONTENT_SIZE / (1024 * 1024)}MB)`);
        return false;
      }
      return true;
    });

    if (skipped.length > 0) {
      console.log(chalk.yellow(`⚠ Skipped ${skipped.length} file(s) exceeding size limits:`));
      skipped.forEach(msg => console.log(chalk.yellow(msg)));
    }

    if (filtered.length > MAX_FILES) {
      console.log(chalk.yellow(`⚠ Too many files (${filtered.length}), sending first ${MAX_FILES}`));
      return filtered.slice(0, MAX_FILES);
    }

    return filtered;
  }

  normalizeSeverity(severity?: string): Severity {
    if (!severity) return 'info';
    const s = severity.toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'high' || s === 'error') return 'error';
    if (s === 'medium' || s === 'warning') return 'warning';
    return 'info';
  }
}

export const reviewService = new ReviewService();
