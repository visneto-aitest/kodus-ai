import { AzureReposService } from './azureRepos.service';

/**
 * Regression test for issue #1045 / Bug B — Azure DevOps' API uses
 * `description` for the PR body field while every other platform (and
 * Kodus' domain) uses `body`. Without normalization at the adapter
 * boundary, consumers like CommentManagerService.generateSummaryPR
 * read `updatedPR?.body`, get `undefined`, and the CONCATENATE branch
 * silently drops the user's existing description (we replace instead
 * of concatenate).
 *
 * The fix in `getPullRequestByNumber` spreads `{ ...pr, body: pr.description ?? '' }`
 * so callers never have to know about Azure's quirk.
 */
describe('AzureReposService.getPullRequestByNumber — body/description normalization (issue #1045)', () => {
    let service: AzureReposService;
    let azureReposRequestHelper: { getPullRequestDetails: jest.Mock };

    const stubRepository = {
        id: 'repo-uuid-123',
        name: 'sample-repo',
        project: { id: 'project-uuid-456' },
    };

    const stubOrg = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    beforeEach(() => {
        azureReposRequestHelper = {
            getPullRequestDetails: jest.fn(),
        };

        service = new AzureReposService(
            {} as any, // integrationService
            {} as any, // integrationConfigService
            {} as any, // authIntegrationService
            azureReposRequestHelper as any,
            {} as any, // configService
            undefined, // mcpManagerService (optional)
        );

        // The two helpers run before the SDK call. Stub them so we can
        // exercise the field-mapping code path directly.
        jest.spyOn(service as any, 'getAuthDetails').mockResolvedValue({
            orgName: 'fake-org',
            token: 'fake-token',
        });
        jest.spyOn(service as any, 'getProjectIdFromRepository').mockResolvedValue(
            stubRepository.project.id,
        );
    });

    it('maps Azure `description` onto `body` while preserving the original `description` field', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockResolvedValue({
            id: 42,
            description: 'PR body text from the user',
            title: 'feat: add SSO',
            status: 'active',
            repository: stubRepository,
        });

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 42,
        });

        expect(result?.body).toBe('PR body text from the user');
        // Spread keeps `description` reachable for any caller still on
        // the Azure-shaped contract.
        expect(result?.description).toBe('PR body text from the user');
        // And the rest of the object survives intact.
        expect(result?.id).toBe(42);
        expect(result?.title).toBe('feat: add SSO');
        expect(result?.repository).toEqual(stubRepository);
    });

    it('coerces a null description into an empty string body', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockResolvedValue({
            id: 100,
            description: null,
            title: 'chore: empty description',
        });

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 100,
        });

        expect(result?.body).toBe('');
        expect(result?.description).toBeNull();
    });

    it('coerces an undefined description into an empty string body', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockResolvedValue({
            id: 101,
            // No `description` field at all on this Azure response.
            title: 'chore: missing description field',
        });

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 101,
        });

        expect(result?.body).toBe('');
    });

    it('returns null when the upstream helper returns null (no PR found)', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockResolvedValue(null);

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 999,
        });

        expect(result).toBeNull();
    });

    it('returns null when the upstream helper throws (mirrors the catch in the implementation)', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockRejectedValue(
            new Error('Azure DevOps unreachable'),
        );

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 42,
        });

        expect(result).toBeNull();
    });

    /**
     * Anti-regression — the bug shape this test guards against is:
     * the method returning the raw Azure object without mapping
     * description→body, leaving downstream consumers with
     * `pr.body === undefined`. If anyone refactors and forgets the
     * spread, this assertion fails immediately.
     */
    it('does NOT regress to returning the raw Azure object (anti-regression)', async () => {
        azureReposRequestHelper.getPullRequestDetails.mockResolvedValue({
            id: 1,
            description: 'something',
        });

        const result = await service.getPullRequestByNumber({
            organizationAndTeamData: stubOrg,
            repository: stubRepository,
            prNumber: 1,
        });

        expect(result).toHaveProperty('body');
        expect(result?.body).not.toBeUndefined();
    });
});
