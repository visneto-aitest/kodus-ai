import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliExitError } from '../../utils/cli-exit.js';

vi.mock('../../services/repo-config.service.js', () => ({
    repoConfigService: {
        addRepository: vi.fn(),
    },
}));

import { repoConfigService } from '../../services/repo-config.service.js';
import {
    configRepoAction,
    configRepoAddAction,
    configRepoListAction,
} from '../config.js';

const mockRepoConfigService = vi.mocked(repoConfigService);

describe('config repo command', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints success when the repository is added', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockRepoConfigService.addRepository.mockResolvedValue({
            status: 'added',
            repositoryFullName: 'kodustech/cli',
        });

        await configRepoAction('.');

        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toContain(
            "Repository 'kodustech/cli' was added to Kodus successfully.",
        );
    });

    it('supports the explicit add subcommand', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockRepoConfigService.addRepository.mockResolvedValue({
            status: 'added',
            repositoryFullName: 'kodustech/cli',
        });

        await configRepoAddAction('kodustech/cli');

        expect(mockRepoConfigService.addRepository).toHaveBeenCalledWith(
            'kodustech/cli',
        );

        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toContain(
            "Repository 'kodustech/cli' was added to Kodus successfully.",
        );
    });

    it('prints already-added when the repository is already configured', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockRepoConfigService.addRepository.mockResolvedValue({
            status: 'already-added',
            repositoryFullName: 'kodustech/cli',
        });

        await configRepoAction('.');

        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toContain(
            "Repository 'kodustech/cli' is already added to Kodus.",
        );
    });

    it('exits with code 1 when repo config fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRepoConfigService.addRepository.mockRejectedValue(
            new Error('Repository not found'),
        );

        await expect(configRepoAction('.')).rejects.toMatchObject({
            name: 'CliExitError',
            exitCode: 1,
        } satisfies Partial<CliExitError>);

        const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toContain('Repository not found');
    });

    it('prints selected repositories when listing config repos', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockRepoConfigService.listRepositories = vi.fn().mockResolvedValue([
            { id: 'repo-1', fullName: 'kodustech/cli' },
            { id: 'repo-2', fullName: 'kodustech/website' },
        ]);

        await configRepoListAction();

        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toContain('Configured repositories:');
        expect(output).toContain('kodustech/cli');
        expect(output).toContain('kodustech/website');
    });
});
