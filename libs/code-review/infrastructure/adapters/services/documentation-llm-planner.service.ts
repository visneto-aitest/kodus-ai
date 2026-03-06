import { createLogger } from '@kodus/flow';
import {
    BYOKConfig,
    LLMModelProvider,
    ParserType,
    PromptRole,
    PromptRunnerService,
} from '@kodus/kodus-common/llm';
import { SUPPORTED_LANGUAGES } from '@libs/code-review/domain/contracts/SupportedLanguages';
import {
    DocumentationQueryPlanByFile,
    RepositoryPackageReference,
} from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import {
    DocumentationPlannerPayload,
    DocumentationPlannerSchema,
    DocumentationPlannerSchemaType,
    prompt_code_review_documentation_planner_system,
    prompt_code_review_documentation_planner_user,
} from '@libs/common/utils/langchainCommon/prompts/codeReviewDocumentationPlanner';
import { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { BYOKPromptRunnerService } from '@libs/core/infrastructure/services/tokenTracking/byokPromptRunner.service';
import { Injectable } from '@nestjs/common';
import path from 'path';

const FILE_CONTENT_LIMIT = 5000;
const PATCH_CONTENT_LIMIT = 4000;

@Injectable()
export class DocumentationLLMPlannerService {
    private readonly logger = createLogger(DocumentationLLMPlannerService.name);

    constructor(private readonly promptRunnerService: PromptRunnerService) {}

    async planDocumentationByFile(params: {
        packages: RepositoryPackageReference[];
        changedFiles: FileChange[];
        byokConfig?: BYOKConfig;
    }): Promise<Record<string, DocumentationQueryPlanByFile>> {
        const { packages, changedFiles, byokConfig } = params;

        const codeFiles = changedFiles.filter((file) =>
            this.isCodeFile(file.filename),
        );

        if (!codeFiles.length) {
            return {};
        }

        const provider = LLMModelProvider.GROQ_GPT_OSS_120B;
        const fallbackProvider = LLMModelProvider.GROQ_MOONSHOTAI_KIMI_K2_;
        const runName = 'documentationPlanner';

        const promptRunner = new BYOKPromptRunnerService(
            this.promptRunnerService,
            provider,
            fallbackProvider,
            byokConfig,
        );

        const packageSlice = packages.slice(0, 200);
        const plans: Record<string, DocumentationQueryPlanByFile> = {};

        try {
            const settled = await Promise.allSettled(
                codeFiles.map(async (file) => {
                    const filePackages = this.filterPackagesForFile(
                        packageSlice,
                        file.filename,
                    );

                    const payload: DocumentationPlannerPayload = {
                        packages: filePackages,
                        file: {
                            filePath: file.filename,
                            fileContent: (file.fileContent || '').slice(
                                0,
                                FILE_CONTENT_LIMIT,
                            ),
                            diff: (
                                file.patchWithLinesStr ||
                                file.patch ||
                                ''
                            ).slice(0, PATCH_CONTENT_LIMIT),
                        },
                    };

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
                            prompt: prompt_code_review_documentation_planner_system,
                        })
                        .addPrompt({
                            role: PromptRole.USER,
                            prompt: prompt_code_review_documentation_planner_user,
                        })
                        .setTemperature(0)
                        .setRunName(`${runName}:${file.filename}`)
                        .execute();

                    return {
                        file,
                        result: response as DocumentationPlannerSchemaType,
                    };
                }),
            );

            for (const [index, settledResult] of settled.entries()) {
                if (settledResult.status === 'fulfilled') {
                    const mapped = this.mapResultByFile(
                        settledResult.value.result,
                        settledResult.value.file,
                        this.getAllowedPackageNamesByFile(
                            packageSlice,
                            settledResult.value.file.filename,
                        ),
                    );

                    if (mapped) {
                        plans[settledResult.value.file.filename] = mapped;
                        continue;
                    }

                    plans[settledResult.value.file.filename] =
                        this.buildFallbackPlanForFile(
                            settledResult.value.file,
                            packages,
                        );
                    continue;
                }

                this.logger.warn({
                    message:
                        'Documentation planner LLM failed for one file, using fallback for that file',
                    context: DocumentationLLMPlannerService.name,
                    metadata: {
                        fileName: codeFiles[index]?.filename,
                    },
                    error: settledResult.reason,
                });

                const fallbackFile = codeFiles[index];
                if (fallbackFile) {
                    plans[fallbackFile.filename] =
                        this.buildFallbackPlanForFile(fallbackFile, packages);
                }
            }

            if (Object.keys(plans).length > 0) {
                return plans;
            }

            return this.buildFallbackPlan(codeFiles, packages);
        } catch (error) {
            this.logger.warn({
                message:
                    'Documentation planner LLM failed, using fallback query plan',
                context: DocumentationLLMPlannerService.name,
                error,
            });

            return this.buildFallbackPlan(codeFiles, packages);
        }
    }

    private mapResultByFile(
        result: DocumentationPlannerSchemaType,
        file: FileChange,
        allowedPackageNames: Set<string>,
    ): DocumentationQueryPlanByFile | null {
        if (!result?.filePath || result.filePath !== file.filename) {
            return null;
        }

        const queries = this.uniqueStrings(result.queries).slice(0, 8);
        const relevantPackages = this.uniqueStrings(result.relevantPackages)
            .filter((pkgName) => allowedPackageNames.has(pkgName.toLowerCase()))
            .slice(0, 8);

        if (!queries.length || !relevantPackages.length) {
            return null;
        }

        return {
            relevantPackages,
            queries,
        };
    }

    private buildFallbackPlan(
        changedFiles: FileChange[],
        packages: RepositoryPackageReference[],
    ): Record<string, DocumentationQueryPlanByFile> {
        const plan: Record<string, DocumentationQueryPlanByFile> = {};

        for (const file of changedFiles) {
            const filePackages = this.filterPackagesForFile(
                packages,
                file.filename,
            );
            const topPackages = this.uniqueStrings(
                filePackages.map((pkg) => pkg.name),
            ).slice(0, 5);

            if (!topPackages.length) {
                plan[file.filename] = {
                    relevantPackages: [],
                    queries: [],
                };
                continue;
            }

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

    private buildFallbackPlanForFile(
        file: FileChange,
        packages: RepositoryPackageReference[],
    ): DocumentationQueryPlanByFile {
        const fileScopedPackages = this.filterPackagesForFile(
            packages,
            file.filename,
        );

        return (
            this.buildFallbackPlan([file], fileScopedPackages)[
                file.filename
            ] || {
                relevantPackages: [],
                queries: [],
            }
        );
    }

    private filterPackagesForFile(
        packages: RepositoryPackageReference[],
        filePath: string,
    ): RepositoryPackageReference[] {
        const ecosystems = this.getAllowedEcosystemsForFile(filePath);

        if (!ecosystems.length) {
            return [];
        }

        return packages.filter((pkg) => ecosystems.includes(pkg.ecosystem));
    }

    private getAllowedPackageNamesByFile(
        packages: RepositoryPackageReference[],
        filePath: string,
    ): Set<string> {
        return new Set(
            this.filterPackagesForFile(packages, filePath).map((pkg) =>
                pkg.name.toLowerCase(),
            ),
        );
    }

    private getAllowedEcosystemsForFile(
        filePath: string,
    ): RepositoryPackageReference['ecosystem'][] {
        const extension = path.posix.extname(filePath).toLowerCase();

        if (!extension) {
            return [];
        }

        const language = Object.values(SUPPORTED_LANGUAGES).find((lang) =>
            lang.extensions.includes(extension),
        )?.name;

        switch (language) {
            case 'typescript':
            case 'javascript':
                return ['npm'];
            case 'python':
                return ['pip'];
            case 'java':
                return ['maven', 'gradle'];
            case 'go':
                return ['go'];
            case 'ruby':
                return ['ruby'];
            case 'rust':
                return ['cargo'];
            default:
                return [];
        }
    }

    private isCodeFile(filePath: string): boolean {
        const extension = path.posix.extname(filePath).toLowerCase();

        if (!extension) {
            return false;
        }

        return Object.values(SUPPORTED_LANGUAGES).some((lang) =>
            lang.extensions.includes(extension),
        );
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
