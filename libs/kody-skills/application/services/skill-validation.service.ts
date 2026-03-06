import yaml from 'js-yaml';
import { z } from 'zod';

// Slug rule: lowercase letters, digits, hyphens only; must start and end with alphanumeric
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const IngestFrontmatterSchema = z.object({
    name: z
        .string({ error: 'name: Required' })
        .min(1, 'name must not be empty')
        .max(64, 'name must be 64 characters or fewer')
        .regex(SLUG_REGEX, 'name must be lowercase-hyphenated (Agent Skills spec): only [a-z0-9-], must start and end with alphanumeric'),
    description: z
        .string({ error: 'description: Required' })
        .min(1, 'description must not be empty')
        .max(1024, 'description must be 1024 characters or fewer'),
    metadata: z.object({
        version: z
            .string({ error: 'metadata.version: Required' })
            .min(1, 'metadata.version must not be empty'),
    }).passthrough(),
}).passthrough(); // allow unknown frontmatter keys per spec

export interface SkillValidationResult {
    valid: boolean;
    errors: string[];
    slug?: string;
    version?: string;
    description?: string;
}

export function validateSkillMdForIngest(
    rawContent: string,
    submittedDirectoryName?: string,
): SkillValidationResult {
    const match = rawContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
        return { valid: false, errors: ['SKILL.md must have YAML frontmatter delimited by ---'] };
    }
    let frontmatter: unknown;
    try {
        frontmatter = yaml.load(match[1]) ?? {};
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { valid: false, errors: [`Invalid YAML frontmatter: ${msg}`] };
    }
    const parsed = IngestFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
        return {
            valid: false,
            errors: parsed.error.issues.map(i => {
                const path = i.path.join('.');
                return path ? `${path}: ${i.message}` : i.message;
            }),
        };
    }
    if (submittedDirectoryName && parsed.data.name !== submittedDirectoryName) {
        return {
            valid: false,
            errors: [
                `name field "${parsed.data.name}" must match directory name "${submittedDirectoryName}" (Agent Skills spec)`,
            ],
        };
    }
    return {
        valid: true,
        errors: [],
        slug: parsed.data.name,
        version: parsed.data.metadata.version,
        description: parsed.data.description,
    };
}
