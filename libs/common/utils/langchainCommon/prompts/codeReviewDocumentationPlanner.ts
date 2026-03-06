import z from 'zod';

export interface DocumentationPlannerFilePayload {
    filePath: string;
    fileContent: string;
    diff: string;
}

export interface DocumentationPlannerPayload {
    packages: Array<{
        name: string;
        version?: string;
        ecosystem: string;
        sourceFile: string;
    }>;
    file: DocumentationPlannerFilePayload;
}

export const DocumentationPlannerSchema = z.object({
    filePath: z.string().min(1),
    relevantPackages: z.array(z.string()).max(8),
    queries: z.array(z.string()).max(8),
});

export type DocumentationPlannerSchemaType = z.infer<
    typeof DocumentationPlannerSchema
>;

export const prompt_code_review_documentation_planner_system = () => {
    return `You are an expert software documentation planner. Given a source code file, a diff of changes, and a list of repository packages, you are able to pinpoint which packages are most relevant to the proposed code change and generate effective documentation search queries to find practical implementation guidance and API usage relevant to the change.

Your main goal is to prioritize complex, high-leverage dependencies (frameworks, platforms, runtimes, data access, messaging, auth, infra SDKs) over simple utility/tooling packages.

Always bias selections toward packages that define architecture or runtime behavior for the changed file, and deprioritize packages that are likely to be low-complexity or peripheral to the core logic (tiny utilities, lint/format tools, typings-only, test-only, build-only).

You always strive towards quality over quantity, and you are careful to only return relevant packages and queries that are likely to yield useful documentation for the code change at hand. You understand that the queries you generate will be used to search official documentation sources, so you focus on generating queries that are likely to lead to practical implementation guidance and API usage examples relevant to the file changes over generic tutorials or conceptual overviews.`;
};

export const prompt_code_review_documentation_planner_user = (
    payload: DocumentationPlannerPayload,
) => {
    const packagesPreview = payload.packages
        .slice(0, 120)
        .map(
            (pkg) =>
                `- ${pkg.name}${pkg.version ? `@${pkg.version}` : ''} (${pkg.ecosystem}) from ${pkg.sourceFile}`,
        )
        .join('\n');

    const fileContentPreview = (payload.file.fileContent || '').slice(0, 2500);
    const diffPreview = (payload.file.diff || '').slice(0, 2500);

    return `Analyze repository package dependencies and the changed file to propose documentation searches.

Rules:
- Return JSON only following the configured parser schema.
- Provide up to 8 relevantPackages and up to 8 queries for the changed file.
- Prioritize complex/runtime-defining packages first, including:
  frameworks, backend/frontend platforms, ORMs/data layers, queues/workers, auth/security libraries, cloud/infra SDKs, observability SDKs, and major architecture libraries.
- De-prioritize low-complexity dependencies unless clearly central to this file change:
  tiny utility libraries, lint/format tools, typings-only packages, test-only packages, and build-only packages.
- Queries should target official framework/package docs and API usage relevant to the file changes.
- Prioritize practical implementation guidance over generic tutorials.
- Use 'en-US' for query text.
- Prefer stable, official documentation sources.

Target file: ${payload.file.filePath}

Repository packages:
${packagesPreview || '- (no packages provided)'}

Target file content excerpt:
${fileContentPreview || '(empty)'}

Target diff excerpt:
${diffPreview || '(empty)'}

Output instructions: Return filePath, relevantPackages, and documentation-oriented queries for this target file. Queries should target official framework/package docs and API usage relevant to this file change.`;
};
