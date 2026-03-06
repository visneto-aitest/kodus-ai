import { createLogger } from '@kodus/flow';
import {
    IPullRequestManagerService,
    PULL_REQUEST_MANAGER_SERVICE_TOKEN,
} from '@libs/code-review/domain/contracts/PullRequestManagerService.contract';
import {
    CodeReviewPipelineContext,
    RepositoryPackageReference,
} from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { Inject, Injectable } from '@nestjs/common';
import path from 'path';

const ROOT_MANIFEST_FILES = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'go.mod',
    'Cargo.toml',
    'Gemfile',
];

@Injectable()
export class DocumentationPackageDiscoveryService {
    private readonly logger = createLogger(
        DocumentationPackageDiscoveryService.name,
    );

    constructor(
        @Inject(PULL_REQUEST_MANAGER_SERVICE_TOKEN)
        private readonly pullRequestManager: IPullRequestManagerService,
    ) {}

    async discoverPackages(
        context: CodeReviewPipelineContext,
    ): Promise<{
        packages: RepositoryPackageReference[];
        manifestFiles: string[];
    }> {
        if (!context.changedFiles?.length) {
            return { packages: [], manifestFiles: [] };
        }

        const manifestsByPath = new Map<string, string>();
        for (const file of context.changedFiles) {
            if (
                this.isSupportedManifestFile(file.filename) &&
                file.fileContent
            ) {
                manifestsByPath.set(file.filename, file.fileContent);
            }
        }

        const candidatesToFetch = new Set<string>(ROOT_MANIFEST_FILES);

        for (const file of context.changedFiles) {
            if (this.isSupportedManifestFile(file.filename)) {
                candidatesToFetch.add(file.filename);
            }
        }

        const missingCandidates = [...candidatesToFetch].filter(
            (candidate) => !manifestsByPath.has(candidate),
        );

        if (missingCandidates.length > 0) {
            try {
                const filesToFetch = missingCandidates.map(
                    (filename) =>
                        ({
                            filename,
                            sha: '',
                            status: 'modified',
                            additions: 0,
                            deletions: 0,
                            changes: 0,
                            blob_url: '',
                            raw_url: '',
                            contents_url: '',
                            content: null,
                        }) as FileChange,
                );

                const fetched =
                    await this.pullRequestManager.enrichFilesWithContent(
                        context.organizationAndTeamData,
                        context.repository,
                        context.pullRequest,
                        filesToFetch,
                    );

                for (const file of fetched) {
                    if (
                        file.fileContent &&
                        this.isSupportedManifestFile(file.filename)
                    ) {
                        manifestsByPath.set(file.filename, file.fileContent);
                    }
                }
            } catch (error) {
                this.logger.warn({
                    message:
                        'Failed to fetch one or more manifest files, continuing with available files',
                    context: DocumentationPackageDiscoveryService.name,
                    error,
                    metadata: {
                        prNumber: context.pullRequest?.number,
                        repository: context.repository?.name,
                    },
                });
            }
        }

        const packageMap = new Map<string, RepositoryPackageReference>();

        for (const [manifestPath, content] of manifestsByPath.entries()) {
            const parsed = this.parseManifest(manifestPath, content);
            for (const pkg of parsed) {
                const key = `${pkg.ecosystem}:${pkg.name}`.toLowerCase();
                const current = packageMap.get(key);
                if (!current || (!current.version && pkg.version)) {
                    packageMap.set(key, pkg);
                }
            }
        }

        return {
            packages: [...packageMap.values()],
            manifestFiles: [...manifestsByPath.keys()],
        };
    }

    private isSupportedManifestFile(filePath: string): boolean {
        const baseName = path.posix.basename(filePath);
        return ROOT_MANIFEST_FILES.includes(baseName);
    }

    private parseManifest(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const baseName = path.posix.basename(filePath);

        switch (baseName) {
            case 'package.json':
                return this.parsePackageJson(filePath, content);
            case 'requirements.txt':
                return this.parseRequirementsTxt(filePath, content);
            case 'pyproject.toml':
                return this.parsePyprojectToml(filePath, content);
            case 'pom.xml':
                return this.parsePomXml(filePath, content);
            case 'build.gradle':
            case 'build.gradle.kts':
                return this.parseGradle(filePath, content);
            case 'go.mod':
                return this.parseGoMod(filePath, content);
            case 'Cargo.toml':
                return this.parseCargoToml(filePath, content);
            case 'Gemfile':
                return this.parseGemfile(filePath, content);
            default:
                return [];
        }
    }

    private parsePackageJson(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        try {
            const parsed = JSON.parse(content);
            const sections = [
                parsed.dependencies,
                parsed.devDependencies,
                parsed.peerDependencies,
                parsed.optionalDependencies,
            ];

            const packages: RepositoryPackageReference[] = [];
            for (const section of sections) {
                if (!section || typeof section !== 'object') {
                    continue;
                }

                for (const [name, version] of Object.entries(section)) {
                    packages.push({
                        name,
                        version: this.normalizeVersion(String(version ?? '')),
                        ecosystem: 'npm',
                        sourceFile: filePath,
                    });
                }
            }

            return packages;
        } catch {
            return [];
        }
    }

    private parseRequirementsTxt(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        return content
            .split('\n')
            .map((line) => line.trim())
            .filter(
                (line) =>
                    line && !line.startsWith('#') && !line.startsWith('-'),
            )
            .map((line) => {
                const match = line.match(
                    /^([A-Za-z0-9._\-[\]]+)(?:\s*(?:==|>=|<=|~=|>|<)\s*([^\s;]+))?/,
                );
                if (!match) {
                    return null;
                }
                return {
                    name: match[1],
                    version: this.normalizeVersion(match[2]),
                    ecosystem: 'pip' as const,
                    sourceFile: filePath,
                };
            })
            .filter(Boolean) as RepositoryPackageReference[];
    }

    private parsePyprojectToml(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const packages: RepositoryPackageReference[] = [];

        const poetrySection = content.match(
            /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/,
        )?.[1];

        if (poetrySection) {
            const lines = poetrySection
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'));

            for (const line of lines) {
                const match = line.match(
                    /^([A-Za-z0-9._-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)"[^}]*\})/,
                );
                if (!match) {
                    continue;
                }
                if (match[1].toLowerCase() === 'python') {
                    continue;
                }

                packages.push({
                    name: match[1],
                    version: this.normalizeVersion(match[2] || match[3]),
                    ecosystem: 'pip',
                    sourceFile: filePath,
                });
            }
        }

        const projectDepsMatch = content.match(
            /dependencies\s*=\s*\[([\s\S]*?)\]/,
        );
        if (projectDepsMatch?.[1]) {
            const items = projectDepsMatch[1]
                .split(',')
                .map((item) => item.trim().replace(/^"|"$/g, ''))
                .filter(Boolean);

            for (const dep of items) {
                const match = dep.match(
                    /^([A-Za-z0-9._-]+)(?:\s*(?:==|>=|<=|~=|>|<)\s*([^\s;]+))?/,
                );
                if (!match) {
                    continue;
                }

                packages.push({
                    name: match[1],
                    version: this.normalizeVersion(match[2]),
                    ecosystem: 'pip',
                    sourceFile: filePath,
                });
            }
        }

        return packages;
    }

    private parsePomXml(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const dependencyBlocks =
            content.match(/<dependency>[\s\S]*?<\/dependency>/g) || [];

        return dependencyBlocks
            .map((block) => {
                const groupId = block
                    .match(/<groupId>([^<]+)<\/groupId>/)?.[1]
                    ?.trim();
                const artifactId = block
                    .match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]
                    ?.trim();
                const version = block
                    .match(/<version>([^<]+)<\/version>/)?.[1]
                    ?.trim();

                if (!groupId || !artifactId) {
                    return null;
                }

                return {
                    name: `${groupId}:${artifactId}`,
                    version: this.normalizeVersion(version),
                    ecosystem: 'maven' as const,
                    sourceFile: filePath,
                };
            })
            .filter(Boolean) as RepositoryPackageReference[];
    }

    private parseGradle(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const regex =
            /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt)\s*\(?\s*['"]([^:'"]+):([^:'"]+):([^'"]+)['"]/g;
        const packages: RepositoryPackageReference[] = [];

        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            packages.push({
                name: `${match[1]}:${match[2]}`,
                version: this.normalizeVersion(match[3]),
                ecosystem: 'gradle',
                sourceFile: filePath,
            });
        }

        return packages;
    }

    private parseGoMod(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const packages: RepositoryPackageReference[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (
                !trimmed ||
                trimmed.startsWith('//') ||
                trimmed === 'require ('
            ) {
                continue;
            }

            const match = trimmed.match(/^([\w./-]+)\s+([\w.+\-/]+)$/);
            if (!match) {
                continue;
            }

            if (
                match[1] === 'module' ||
                match[1] === 'go' ||
                match[1] === ')'
            ) {
                continue;
            }

            packages.push({
                name: match[1],
                version: this.normalizeVersion(match[2]),
                ecosystem: 'go',
                sourceFile: filePath,
            });
        }

        return packages;
    }

    private parseCargoToml(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const dependenciesSection = content.match(
            /\[dependencies\]([\s\S]*?)(?:\n\[|$)/,
        )?.[1];

        if (!dependenciesSection) {
            return [];
        }

        return dependenciesSection
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => {
                const match = line.match(
                    /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)"[^}]*\})/,
                );
                if (!match) {
                    return null;
                }

                return {
                    name: match[1],
                    version: this.normalizeVersion(match[2] || match[3]),
                    ecosystem: 'cargo' as const,
                    sourceFile: filePath,
                };
            })
            .filter(Boolean) as RepositoryPackageReference[];
    }

    private parseGemfile(
        filePath: string,
        content: string,
    ): RepositoryPackageReference[] {
        const regex = /gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/g;
        const packages: RepositoryPackageReference[] = [];

        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            packages.push({
                name: match[1],
                version: this.normalizeVersion(match[2]),
                ecosystem: 'ruby',
                sourceFile: filePath,
            });
        }

        return packages;
    }

    private normalizeVersion(version?: string): string | undefined {
        if (!version) {
            return undefined;
        }

        const normalized = version.trim();
        return normalized.length > 0 ? normalized : undefined;
    }
}
