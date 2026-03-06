import { createLogger } from '@kodus/flow';
import {
    LLMModelProvider,
    ParserType,
    PromptRole,
    PromptRunnerService,
} from '@kodus/kodus-common/llm';
import {
    DocumentationQueryPlanByFile,
    RepositoryPackageReference,
} from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { BYOKPromptRunnerService } from '@libs/core/infrastructure/services/tokenTracking/byokPromptRunner.service';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const FILE_CONTENT_LIMIT = 5000;
const PATCH_CONTENT_LIMIT = 4000;

const DocumentationPlannerSchema = z.object({
    files: z.array(
        z.object({
            filePath: z.string().min(1),
            relevantPackages: z.array(z.string()).max(8),
            queries: z.array(z.string()).max(8),
        }),
    ),
});

@Injectable()
export class DocumentationLLMPlannerService {
    private readonly logger = createLogger(DocumentationLLMPlannerService.name);

    constructor(private readonly promptRunnerService: PromptRunnerService) {}

    async planDocumentationByFile(params: {
        packages: RepositoryPackageReference[];
        changedFiles: FileChange[];
        language?: string;
        byokConfig?: any;
    }): Promise<Record<string, DocumentationQueryPlanByFile>> {
        const { packages, changedFiles, language, byokConfig } = params;

        if (!packages.length || !changedFiles.length) {
            return {};
        }

        const provider = LLMModelProvider.GEMINI_2_5_PRO;
        const fallbackProvider = LLMModelProvider.NOVITA_DEEPSEEK_V3;
        const runName = 'documentationPlanner';

        const promptRunner = new BYOKPromptRunnerService(
            this.promptRunnerService,
            provider,
            fallbackProvider,
            byokConfig,
        );

        const payload = {
            language: language || 'en-US',
            packages: packages.slice(0, 200),
            files: changedFiles.map((file) => ({
                filePath: file.filename,
                fileContent: (file.fileContent || '').slice(
                    0,
                    FILE_CONTENT_LIMIT,
                ),
                diff: (file.patchWithLinesStr || file.patch || '').slice(
                    0,
                    PATCH_CONTENT_LIMIT,
                ),
            })),
            outputInstructions:
                'For each file return relevantPackages and documentation-oriented queries. Queries should target official framework/package docs and API usage relevant to the file changes.',
        };

        try {
            const response = await promptRunner
                .builder()
                .setParser(ParserType.ZOD, DocumentationPlannerSchema, {
                    provider: LLMModelProvider.OPENAI_GPT_4O_MINI,
                    fallbackProvider: LLMModelProvider.OPENAI_GPT_4O,
                })
                .setLLMJsonMode(true)
                .setPayload(payload)
                .addPrompt({
                    role: PromptRole.SYSTEM,
                    prompt: () =>
                        'You are an expert software documentation planner. Given repository packages and changed files, decide which packages/frameworks are relevant per file and generate practical documentation search queries. Prefer concise, implementation-focused queries.',
                })
                .addPrompt({
                    role: PromptRole.USER,
                    prompt: () =>
                        'Analyze the provided files and package list. Return JSON only in the requested schema. Keep each file with up to 8 relevantPackages and 8 queries.',
                })
                .setTemperature(0)
                .setRunName(runName)
                .execute();

            const result = (response as z.infer<
                typeof DocumentationPlannerSchema
            >) || {
                files: [],
            };

            const mapped = this.mapResultByFile(result, changedFiles);
            if (Object.keys(mapped).length > 0) {
                return mapped;
            }

            return this.buildFallbackPlan(changedFiles, packages);
        } catch (error) {
            this.logger.warn({
                message:
                    'Documentation planner LLM failed, using fallback query plan',
                context: DocumentationLLMPlannerService.name,
                error,
            });

            return this.buildFallbackPlan(changedFiles, packages);
        }
    }

    private mapResultByFile(
        result: z.infer<typeof DocumentationPlannerSchema>,
        changedFiles: FileChange[],
    ): Record<string, DocumentationQueryPlanByFile> {
        const validFiles = new Set(changedFiles.map((file) => file.filename));
        const mapped: Record<string, DocumentationQueryPlanByFile> = {};

        for (const filePlan of result.files || []) {
            if (!validFiles.has(filePlan.filePath)) {
                continue;
            }

            const queries = this.uniqueStrings(filePlan.queries).slice(0, 8);
            const relevantPackages = this.uniqueStrings(
                filePlan.relevantPackages,
            ).slice(0, 8);

            mapped[filePlan.filePath] = {
                relevantPackages,
                queries,
            };
        }

        return mapped;
    }

    private buildFallbackPlan(
        changedFiles: FileChange[],
        packages: RepositoryPackageReference[],
    ): Record<string, DocumentationQueryPlanByFile> {
        const topPackages = this.uniqueStrings(
            packages.map((pkg) => pkg.name),
        ).slice(0, 5);

        const plan: Record<string, DocumentationQueryPlanByFile> = {};

        for (const file of changedFiles) {
            const fileText =
                `${file.fileContent || ''}\n${file.patch || ''}`.toLowerCase();
            const matched = topPackages.filter(
                (pkg) =>
                    fileText.includes(pkg.toLowerCase().replace('/', '')) ||
                    fileText.includes(pkg.toLowerCase()),
            );

            const relevantPackages = (
                matched.length > 0 ? matched : topPackages
            ).slice(0, 3);

            const queries = relevantPackages.map(
                (pkg) =>
                    `Find official documentation and best practices for ${pkg} used in ${file.filename}`,
            );

            plan[file.filename] = {
                relevantPackages,
                queries,
            };
        }

        return plan;
    }

    private uniqueStrings(items: string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];

        for (const item of items || []) {
            const normalized = (item || '').trim();
            if (!normalized) {
                continue;
            }
            if (seen.has(normalized.toLowerCase())) {
                continue;
            }
            seen.add(normalized.toLowerCase());
            result.push(normalized);
        }

        return result;
    }
}
