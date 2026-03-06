import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { DocumentationLLMPlannerService } from '@libs/code-review/infrastructure/adapters/services/documentation-llm-planner.service';
import { RepositoryPackageReference } from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';

describe('DocumentationLLMPlannerService', () => {
    function buildPromptRunnerMock(payloads: any[]): PromptRunnerService {
        const service = {
            builder: jest.fn(() => {
                const state: { payload?: any } = {};

                return {
                    setProviders: jest.fn().mockReturnThis(),
                    setBYOKConfig: jest.fn().mockReturnThis(),
                    setBYOKFallbackConfig: jest.fn().mockReturnThis(),
                    setParser: jest.fn().mockReturnThis(),
                    setLLMJsonMode: jest.fn().mockReturnThis(),
                    setPayload: jest.fn(function (payload: any) {
                        state.payload = payload;
                        payloads.push(payload);
                        return this;
                    }),
                    addPrompt: jest.fn().mockReturnThis(),
                    setTemperature: jest.fn().mockReturnThis(),
                    setRunName: jest.fn().mockReturnThis(),
                    execute: jest.fn(async () => ({
                        filePath: state.payload?.file?.filePath || '',
                        relevantPackages: (state.payload?.packages || []).map(
                            (pkg: { name: string }) => pkg.name,
                        ),
                        queries: ['official documentation'],
                    })),
                };
            }),
        };

        return service as unknown as PromptRunnerService;
    }

    it('should only send ecosystem-compatible packages for each code file', async () => {
        const payloads: any[] = [];
        const service = new DocumentationLLMPlannerService(
            buildPromptRunnerMock(payloads),
        );

        const packages: RepositoryPackageReference[] = [
            {
                name: '@nestjs/common',
                ecosystem: 'npm',
                sourceFile: 'package.json',
            },
            {
                name: 'rails',
                ecosystem: 'ruby',
                sourceFile: 'Gemfile',
            },
        ];

        const changedFiles: FileChange[] = [
            {
                filename: 'apps/web/src/app.ts',
                patch: '@@',
                fileContent: 'import { Controller } from "@nestjs/common"',
            } as FileChange,
            {
                filename: 'apps/api/lib/service.rb',
                patch: '@@',
                fileContent: "require 'rails'",
            } as FileChange,
            {
                filename: 'README.md',
                patch: '@@',
                fileContent: '# docs',
            } as FileChange,
        ];

        const result = await service.planDocumentationByFile({
            packages,
            changedFiles,
        });

        expect(Object.keys(result)).toEqual(
            expect.arrayContaining([
                'apps/web/src/app.ts',
                'apps/api/lib/service.rb',
            ]),
        );
        expect(result['README.md']).toBeUndefined();

        const tsPayload = payloads.find(
            (payload) => payload.file.filePath === 'apps/web/src/app.ts',
        );
        const rubyPayload = payloads.find(
            (payload) => payload.file.filePath === 'apps/api/lib/service.rb',
        );

        expect(tsPayload.packages).toEqual([
            expect.objectContaining({
                name: '@nestjs/common',
                ecosystem: 'npm',
            }),
        ]);
        expect(rubyPayload.packages).toEqual([
            expect.objectContaining({ name: 'rails', ecosystem: 'ruby' }),
        ]);
    });
});
