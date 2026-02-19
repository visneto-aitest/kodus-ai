import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../types/index.js';

const mocks = vi.hoisted(() => ({
  getPullRequestSuggestions: vi.fn(),
  getValidToken: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('../api/index.js', () => ({
  api: {
    review: {
      getPullRequestSuggestions: mocks.getPullRequestSuggestions,
    },
  },
}));

vi.mock('../auth.service.js', () => ({
  authService: {
    getValidToken: mocks.getValidToken,
  },
}));

vi.mock('../../utils/config.js', () => ({
  loadConfig: mocks.loadConfig,
}));

import { reviewService } from '../review.service.js';

describe('ReviewService getPullRequestSuggestions auth fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to team key on 401 from personal token', async () => {
    mocks.getValidToken.mockResolvedValue('personal-token');
    mocks.loadConfig.mockResolvedValue({ teamKey: 'kodus_team_key' });
    mocks.getPullRequestSuggestions
      .mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
      .mockResolvedValueOnce({ summary: 'ok', issues: [] });

    const response = await reviewService.getPullRequestSuggestions({
      prUrl: 'https://github.com/org/repo/pull/1',
    });

    expect(mocks.getPullRequestSuggestions).toHaveBeenCalledTimes(2);
    expect(mocks.getPullRequestSuggestions).toHaveBeenNthCalledWith(
      1,
      'personal-token',
      expect.objectContaining({ prUrl: 'https://github.com/org/repo/pull/1' }),
    );
    expect(mocks.getPullRequestSuggestions).toHaveBeenNthCalledWith(
      2,
      'kodus_team_key',
      expect.objectContaining({ prUrl: 'https://github.com/org/repo/pull/1' }),
    );
    expect(response.result.summary).toBe('ok');
  });

  it('rethrows the original error if team-key fallback also fails', async () => {
    const originalError = new ApiError(401, 'Primary auth failed');
    mocks.getValidToken.mockResolvedValue('personal-token');
    mocks.loadConfig.mockResolvedValue({ teamKey: 'kodus_team_key' });
    mocks.getPullRequestSuggestions
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(new ApiError(401, 'Fallback failed'));

    await expect(
      reviewService.getPullRequestSuggestions({
        prUrl: 'https://github.com/org/repo/pull/1',
      }),
    ).rejects.toBe(originalError);
  });

  it('does not fallback for non-401 errors', async () => {
    const error = new ApiError(500, 'Server error');
    mocks.getValidToken.mockResolvedValue('personal-token');
    mocks.getPullRequestSuggestions.mockRejectedValue(error);

    await expect(
      reviewService.getPullRequestSuggestions({
        prUrl: 'https://github.com/org/repo/pull/1',
      }),
    ).rejects.toBe(error);
    expect(mocks.loadConfig).not.toHaveBeenCalled();
  });
});
