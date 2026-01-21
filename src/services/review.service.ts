import { api } from './api/index.js';
import { authService } from './auth.service.js';
import { gitService } from './git.service.js';
import { getTrialIdentifier } from '../utils/rate-limit.js';
import { loadConfig } from '../utils/config.js';
import { CLI_VERSION } from '../constants.js';
import type { ReviewConfig, ReviewResult, TrialReviewResult, PullRequestSuggestionsResponse, ReviewIssue, ApiFileSuggestion, ApiPrLevelSuggestion, ApiSuggestionsObject, Severity } from '../types/index.js';

class ReviewService {
  async analyze(
    diff: string,
    rulesOnly?: boolean,
    fast?: boolean,
    options?: { files?: string[]; staged?: boolean; commit?: string; branch?: string }
  ): Promise<ReviewResult> {
    const token = await authService.getValidToken();

    const reviewConfig: ReviewConfig = {
      rulesOnly,
      fast,
    };

    if (!fast) {
      reviewConfig.files = await gitService.getFullFileContents(
        options?.files,
        {
          staged: options?.staged,
          commit: options?.commit,
          branch: options?.branch,
        }
      );
    }

    const teamConfig = await loadConfig();
    const isTeamKey = token.startsWith('kodus_');

    if (isTeamKey && teamConfig) {
      const gitInfo = await gitService.getGitInfo();
      const inferredPlatform = gitInfo.remote
        ? gitService.inferPlatform(gitInfo.remote)
        : undefined;

      return api.review.analyzeWithMetrics(
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
    }

    return api.review.analyze(diff, token, reviewConfig);
  }

  async getPullRequestSuggestions(params: { prUrl?: string; prNumber?: number; repositoryId?: string; format?: 'markdown'; severity?: string; category?: string }): Promise<{ result: ReviewResult; markdown?: string }> {
    if (!params.prUrl && !(params.prNumber && params.repositoryId)) {
      throw new Error('Provide prUrl or prNumber with repositoryId to fetch pull request suggestions.');
    }

    const token = await authService.getValidToken();
    const response = await api.review.getPullRequestSuggestions(token, params);
    return {
      result: this.normalizeSuggestionsResponse(response),
      markdown: response.markdown,
    };
  }

  async trialAnalyze(diff: string): Promise<TrialReviewResult> {
    const fingerprint = await getTrialIdentifier();
    return api.review.trialAnalyze(diff, fingerprint);
  }

  private normalizeSuggestionsResponse(response: PullRequestSuggestionsResponse): ReviewResult {
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

  private mapFileSuggestions(files: ApiFileSuggestion[]): ReviewIssue[] {
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

  private mapPrLevelSuggestions(prLevel: ApiPrLevelSuggestion[]): ReviewIssue[] {
    return prLevel.map((s) => ({
      file: 'PR',
      line: 0,
      severity: this.normalizeSeverity(s.severity),
      message: s.suggestionContent,
      suggestion: s.oneSentenceSummary,
      ruleId: s.label,
    }));
  }

  private normalizeSeverity(severity?: string): Severity {
    if (!severity) return 'info';
    const s = severity.toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'high' || s === 'error') return 'error';
    if (s === 'medium' || s === 'warning') return 'warning';
    return 'info';
  }
}

export const reviewService = new ReviewService();
