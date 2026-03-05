import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveSkillsCandidates(): string[] {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return [
        path.resolve(here, '../../skills'),
        path.resolve(here, '../skills'),
    ];
}

export async function listBundledSkills(): Promise<string[]> {
    for (const dir of resolveSkillsCandidates()) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const skills = await Promise.all(
                entries
                    .filter((entry) => entry.isDirectory())
                    .map(async (entry) => {
                        const skillFile = path.join(
                            dir,
                            entry.name,
                            'SKILL.md',
                        );
                        try {
                            await fs.access(skillFile);
                            return entry.name;
                        } catch {
                            return null;
                        }
                    }),
            );

            const normalized = skills
                .filter((name): name is string => !!name)
                .sort((a, b) => a.localeCompare(b));
            if (normalized.length > 0) {
                return normalized;
            }
        } catch {
            // Ignore missing candidate and continue.
        }
    }

    return [];
}
