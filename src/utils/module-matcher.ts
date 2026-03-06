import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ModulesYml, ModuleConfig } from '../types/memory.js';

export { stringifyYaml };

const CONFIG_PATH = '.kody/modules.yml';

export async function loadConfig(repoRoot: string): Promise<ModulesYml | null> {
    try {
        const filePath = path.join(repoRoot, CONFIG_PATH);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseYaml(content) as unknown;

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }

        const obj = parsed as Record<string, unknown>;
        if (obj['version'] !== 1 || !Array.isArray(obj['modules'])) {
            return null;
        }

        const modules: ModuleConfig[] = [];
        for (const item of obj['modules'] as unknown[]) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const entry = item as Record<string, unknown>;

            const id =
                typeof entry['id'] === 'string' ? entry['id'] : undefined;
            const name = typeof entry['name'] === 'string' ? entry['name'] : id;
            const paths = Array.isArray(entry['paths'])
                ? (entry['paths'] as unknown[]).filter(
                      (p): p is string => typeof p === 'string',
                  )
                : [];
            const memoryFile =
                typeof entry['memoryFile'] === 'string'
                    ? entry['memoryFile']
                    : `.kody/memory/${id}.md`;

            if (!id || paths.length === 0) {
                continue;
            }

            modules.push({ id, name: name ?? id, paths, memoryFile });
        }

        return { version: 1, modules };
    } catch {
        return null;
    }
}

export function matchFiles(files: string[], modules: ModuleConfig[]): string[] {
    const matched = new Set<string>();

    for (const file of files) {
        for (const mod of modules) {
            if (fileMatchesModule(file, mod.paths)) {
                matched.add(mod.id);
            }
        }
    }

    return [...matched];
}

function fileMatchesModule(filePath: string, patterns: string[]): boolean {
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of patterns) {
        const normalizedPattern = pattern.replace(/\\/g, '/');

        if (normalizedPattern.endsWith('/**')) {
            const prefix = normalizedPattern.slice(0, -3);
            if (normalized.startsWith(prefix + '/') || normalized === prefix) {
                return true;
            }
        } else if (normalizedPattern.endsWith('/*')) {
            const prefix = normalizedPattern.slice(0, -2);
            if (
                normalized.startsWith(prefix + '/') &&
                !normalized.slice(prefix.length + 1).includes('/')
            ) {
                return true;
            }
        } else if (normalizedPattern.includes('*')) {
            const regex = patternToRegex(normalizedPattern);
            if (regex.test(normalized)) {
                return true;
            }
        } else {
            // Exact prefix match (directory or file path)
            if (
                normalized.startsWith(normalizedPattern + '/') ||
                normalized === normalizedPattern
            ) {
                return true;
            }
        }
    }

    return false;
}

function patternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/\*\*/g, '§GLOBSTAR§')
        .replace(/\*/g, '§GLOB§')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        // Preserve globstar "zero or more directories" semantics when used mid-path.
        // Example: a/**/b must match both a/b and a/x/y/b.
        .replace(/\/§GLOBSTAR§\//g, '(?:/[^/]+)*/')
        .replace(/§GLOBSTAR§/g, '.*')
        .replace(/§GLOB§/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}
