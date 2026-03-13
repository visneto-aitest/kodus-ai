import type {
    BusinessValidationResponse,
    PullRequestSuggestionsResponse,
    ReviewConfig,
    ReviewResult,
    TrialReviewResult,
} from '../../types/review.js';
import type { GitMetrics, IReviewApi } from './api.interface.js';
import { requestWithRetry } from './api-core.js';

type RequestWithRetry = <T>(
    endpoint: string,
    options?: RequestInit,
) => Promise<T>;

export class RealReviewApi implements IReviewApi {
    constructor(private readonly requester: RequestWithRetry = requestWithRetry) {}

    async analyze(
        diff: string,
        accessToken: string,
        config?: ReviewConfig,
    ): Promise<ReviewResult> {
        const isTeamKey = accessToken.startsWith('kodus_');

        if (isTeamKey) {
            return this.requester<ReviewResult>('/cli/review', {
                method: 'POST',
                headers: {
                    'X-Team-Key': accessToken,
                },
                body: JSON.stringify({ diff, config }),
            });
        }

        let teamId: string | undefined;
        try {
            const payload = JSON.parse(
                Buffer.from(accessToken.split('.')[1], 'base64').toString(),
            );
            teamId = payload.organizationId;
        } catch {
            // Ignore if cannot decode
        }

        const endpoint = teamId
            ? `/cli/review?teamId=${encodeURIComponent(teamId)}`
            : '/cli/review';

        return this.requester<ReviewResult>(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ diff, config }),
        });
    }

    async analyzeWithMetrics(
        diff: string,
        accessToken: string,
        config?: ReviewConfig,
        metrics?: GitMetrics,
    ): Promise<ReviewResult> {
        const isTeamKey = accessToken.startsWith('kodus_');

        if (isTeamKey) {
            return this.requester<ReviewResult>('/cli/review', {
                method: 'POST',
                headers: {
                    'X-Team-Key': accessToken,
                },
                body: JSON.stringify({
                    diff,
                    config,
                    ...metrics,
                }),
            });
        }

        return this.analyze(diff, accessToken, config);
    }

    async getPullRequestSuggestions(
        accessToken: string,
        params: {
            prUrl?: string;
            prNumber?: number;
            repositoryId?: string;
            format?: 'markdown';
            severity?: string;
            category?: string;
        },
    ): Promise<PullRequestSuggestionsResponse> {
        const query = new URLSearchParams();

        if (params.prUrl) {
            query.set('prUrl', params.prUrl);
        }

        if (params.prNumber !== undefined) {
            query.set('prNumber', params.prNumber.toString());
        }

        if (params.repositoryId) {
            query.set('repositoryId', params.repositoryId);
        }

        if (params.format) {
            query.set('format', params.format);
        }

        if (params.severity) {
            query.set('severity', params.severity);
        }

        if (params.category) {
            query.set('category', params.category);
        }

        const queryString = query.toString();
        const endpoint = `/pull-requests/suggestions${queryString ? `?${queryString}` : ''}`;
        const isTeamKey = accessToken.startsWith('kodus_');

        return this.requester<PullRequestSuggestionsResponse>(endpoint, {
            headers: {
                ...(isTeamKey
                    ? { 'X-Team-Key': accessToken }
                    : { Authorization: `Bearer ${accessToken}` }),
            },
        });
    }

    async triggerBusinessValidation(
        accessToken: string,
        params: {
            repository?: string;
            taskUrl?: string;
            taskId?: string;
            diff?: string;
        },
    ): Promise<BusinessValidationResponse> {
        const isTeamKey = accessToken.startsWith('kodus_');
        const body: Record<string, unknown> = {};

        if (params.repository) {
            body.repository = params.repository;
        }
        if (params.taskUrl) {
            body.taskUrl = params.taskUrl;
        }
        if (params.taskId) {
            body.taskId = params.taskId;
        }
        if (params.diff) {
            body.diff = params.diff;
        }

        return this.requester<BusinessValidationResponse>(
            '/cli/business-validation',
            {
                method: 'POST',
                headers: {
                    ...(isTeamKey
                        ? { 'X-Team-Key': accessToken }
                        : { Authorization: `Bearer ${accessToken}` }),
                },
                body: JSON.stringify(body),
            },
        );
    }

    async trialAnalyze(
        diff: string,
        fingerprint: string,
    ): Promise<TrialReviewResult> {
        return this.requester<TrialReviewResult>('/cli/trial/review', {
            method: 'POST',
            body: JSON.stringify({ diff, fingerprint }),
        });
    }
}
