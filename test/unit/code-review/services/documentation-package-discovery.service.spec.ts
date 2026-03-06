import { IPullRequestManagerService } from '@libs/code-review/domain/contracts/PullRequestManagerService.contract';
import { DocumentationPackageDiscoveryService } from '@libs/code-review/infrastructure/adapters/services/documentation-package-discovery.service';
import { CodeReviewPipelineContext } from '@libs/code-review/pipeline/context/code-review-pipeline.context';

describe('DocumentationPackageDiscoveryService', () => {
    let service: DocumentationPackageDiscoveryService;
    let pullRequestManager: jest.Mocked<IPullRequestManagerService>;

    beforeEach(() => {
        pullRequestManager = {
            enrichFilesWithContent: jest.fn(),
        } as unknown as jest.Mocked<IPullRequestManagerService>;

        service = new DocumentationPackageDiscoveryService(pullRequestManager);
    });

    it('should discover packages from changed manifest files', async () => {
        const context = {
            organizationAndTeamData: { organizationId: 'o1', teamId: 't1' },
            repository: { id: 'r1', name: 'repo' },
            pullRequest: { number: 10 },
            changedFiles: [
                {
                    filename: 'package.json',
                    fileContent: JSON.stringify({
                        dependencies: {
                            '@nestjs/common': '^10.0.0',
                            'react': '^18.0.0',
                        },
                        devDependencies: {
                            jest: '^29.0.0',
                        },
                    }),
                },
                {
                    filename: 'requirements.txt',
                    fileContent: 'fastapi==0.115.0\nuvicorn>=0.30.0\n',
                },
            ],
        } as unknown as CodeReviewPipelineContext;

        pullRequestManager.enrichFilesWithContent.mockResolvedValue([] as any);

        const result = await service.discoverPackages(context);

        expect(result.packages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: '@nestjs/common',
                    ecosystem: 'npm',
                }),
                expect.objectContaining({
                    name: 'fastapi',
                    ecosystem: 'pip',
                }),
            ]),
        );
    });

    it('should fetch missing root manifest candidates and parse them', async () => {
        const context = {
            organizationAndTeamData: { organizationId: 'o1', teamId: 't1' },
            repository: { id: 'r1', name: 'repo' },
            pullRequest: { number: 11 },
            changedFiles: [
                {
                    filename: 'src/app.service.ts',
                    fileContent: 'export class AppService {}',
                },
            ],
        } as unknown as CodeReviewPipelineContext;

        pullRequestManager.enrichFilesWithContent.mockResolvedValue([
            {
                filename: 'go.mod',
                fileContent:
                    'module example.com/demo\n\nrequire (\n  github.com/gin-gonic/gin v1.10.0\n)\n',
            },
            {
                filename: 'Gemfile',
                fileContent: "gem 'rails', '~> 7.1.0'\n",
            },
        ] as any);

        const result = await service.discoverPackages(context);

        expect(pullRequestManager.enrichFilesWithContent).toHaveBeenCalled();
        expect(result.packages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'github.com/gin-gonic/gin',
                    ecosystem: 'go',
                }),
                expect.objectContaining({
                    name: 'rails',
                    ecosystem: 'ruby',
                }),
            ]),
        );
    });
});
