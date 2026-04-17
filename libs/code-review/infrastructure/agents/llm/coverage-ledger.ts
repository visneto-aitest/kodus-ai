import { FileChange } from '@libs/core/infrastructure/config/types/general/codeReview.type';

export interface CoverageTouch {
    tool: string;
    path: string;
    step: number;
}

export type CoverageTier = 'critical' | 'warm' | 'optional';

export interface CoverageTarget {
    id: string;
    file: string;
    changedRanges: Array<[number, number]>;
    status: 'pending' | 'touched';
    touchedBy: CoverageTouch[];
    /** Undefined when tiering is disabled (flat coverage mode). */
    tier?: CoverageTier;
}

export interface CoverageSummary {
    totalTargets: number;
    touchedTargets: number;
    pendingTargets: number;
    touchedFiles: string[];
    pendingFiles: string[];
    // Tier counters (0 when tiering disabled).
    criticalTotal: number;
    criticalTouched: number;
    criticalPending: number;
    warmTotal: number;
    warmTouched: number;
    warmPending: number;
    optionalTotal: number;
    optionalTouched: number;
    optionalPending: number;
}

export interface BuildCoverageLedgerOptions {
    /** Map of normalized filename to tier. When provided, every target
     *  receives the matching tier ('critical' | 'warm' | 'optional').
     *  Files absent from the map are treated as 'optional'. When this
     *  option is omitted, targets are untiered (flat coverage mode). */
    fileTiers?: Map<string, CoverageTier>;
}

/** Total coverage fraction required when tiering is active. */
export const TIERED_TOTAL_COVERAGE_THRESHOLD = 0.7;

interface CoverageObservation {
    path: string;
    startLine?: number;
    endLine?: number;
    pathMode: 'file' | 'directory';
}

export function normalizeRepoPath(path?: string): string {
    return String(path || '')
        .replace(/^\/+/, '')
        .replace(/\\/g, '/')
        .trim();
}

export function buildCoverageLedger(
    changedFiles?: FileChange[],
    opts?: BuildCoverageLedgerOptions,
): CoverageTarget[] {
    if (!changedFiles?.length) return [];
    const fileTiers = opts?.fileTiers;
    const tiered = !!fileTiers;

    return changedFiles
        .filter((file) => !!file?.filename)
        .map((file) => {
            const normalized = normalizeRepoPath(file.filename);
            const tier: CoverageTier | undefined = tiered
                ? (fileTiers!.get(normalized) ?? 'optional')
                : undefined;
            return {
                id: normalized,
                file: normalized,
                changedRanges: extractChangedLineRanges(file.patch),
                status: 'pending' as const,
                touchedBy: [],
                tier,
            };
        });
}

export function getCoverageSummary(targets: CoverageTarget[]): CoverageSummary {
    const touched = targets.filter((t) => t.status === 'touched');
    const pending = targets.filter((t) => t.status === 'pending');

    const critical = targets.filter((t) => t.tier === 'critical');
    const warm = targets.filter((t) => t.tier === 'warm');
    const optional = targets.filter((t) => t.tier === 'optional');

    return {
        totalTargets: targets.length,
        touchedTargets: touched.length,
        pendingTargets: pending.length,
        touchedFiles: touched.map((t) => t.file),
        pendingFiles: pending.map((t) => t.file),
        criticalTotal: critical.length,
        criticalTouched: critical.filter((t) => t.status === 'touched').length,
        criticalPending: critical.filter((t) => t.status === 'pending').length,
        warmTotal: warm.length,
        warmTouched: warm.filter((t) => t.status === 'touched').length,
        warmPending: warm.filter((t) => t.status === 'pending').length,
        optionalTotal: optional.length,
        optionalTouched: optional.filter((t) => t.status === 'touched').length,
        optionalPending: optional.filter((t) => t.status === 'pending').length,
    };
}

/**
 * Finalization gate. When tiering is active, the contract is:
 *   all critical files covered AND total coverage >= 70%.
 * Warm files count toward the 70% total but are not individually
 * required; optional files count toward total too but are strictly
 * best-effort. When tiering is disabled, falls back to the legacy
 * all-files-covered contract.
 */
export function isCoverageSatisfied(summary: CoverageSummary): boolean {
    if (summary.totalTargets === 0) return true;
    const tieringActive =
        summary.criticalTotal > 0 ||
        summary.warmTotal > 0 ||
        summary.optionalTotal > 0;
    if (!tieringActive) {
        return summary.pendingTargets === 0;
    }
    if (summary.criticalPending > 0) return false;
    const totalRatio = summary.touchedTargets / summary.totalTargets;
    return totalRatio >= TIERED_TOTAL_COVERAGE_THRESHOLD;
}

export function formatCoverageTargetsForPrompt(
    changedFiles?: FileChange[],
    maxItems = 20,
    opts?: BuildCoverageLedgerOptions,
): string {
    const targets = buildCoverageLedger(changedFiles, opts);
    if (!targets.length) return '';

    const hasTiers = targets.some((t) => t.tier);
    if (!hasTiers) {
        const lines = targets
            .slice(0, maxItems)
            .map((t) => `- ${describeCoverageTarget(t)}`);
        if (targets.length > maxItems) {
            lines.push(
                `- ... (${targets.length - maxItems} more changed files)`,
            );
        }
        return lines.join('\n');
    }

    const critical = targets.filter((t) => t.tier === 'critical');
    const warm = targets.filter((t) => t.tier === 'warm');
    const optional = targets.filter((t) => t.tier === 'optional');
    const blocks: string[] = [];

    const appendTier = (
        label: string,
        group: CoverageTarget[],
        hint: string,
    ) => {
        if (!group.length) return;
        if (blocks.length) blocks.push('');
        blocks.push(`${label} files (${group.length}) — ${hint}:`);
        const lines = group
            .slice(0, maxItems)
            .map((t) => `- ${describeCoverageTarget(t)}`);
        if (group.length > maxItems) {
            lines.push(
                `- ... (${group.length - maxItems} more ${label.toLowerCase()} files)`,
            );
        }
        blocks.push(...lines);
    };

    appendTier(
        'CRITICAL',
        critical,
        'MUST be inspected (full diff above, readFile before finalizing)',
    );
    appendTier(
        'WARM',
        warm,
        'full diff above; inspect if step budget allows, contributes to coverage',
    );
    appendTier(
        'OPTIONAL',
        optional,
        'hunk headers only; readFile only if a concrete hypothesis points to them',
    );
    blocks.push(
        '',
        `Finalization rule: ALL critical files must be inspected, AND total coverage must reach >= ${Math.round(TIERED_TOTAL_COVERAGE_THRESHOLD * 100)}%. Warm/optional contribute to the total.`,
    );
    return blocks.join('\n');
}

export function formatCoverageDebt(
    targets: CoverageTarget[],
    maxItems = 8,
): string {
    const pending = targets.filter((t) => t.status === 'pending');
    if (!pending.length) return '';

    const hasTiers = targets.some((t) => t.tier);

    if (!hasTiers) {
        const lines = pending
            .slice(0, maxItems)
            .map((t) => `- ${describeCoverageTarget(t)}`);
        if (pending.length > maxItems) {
            lines.push(
                `- ... (${pending.length - maxItems} more changed files)`,
            );
        }
        return [
            'Coverage debt remains for these changed files:',
            ...lines,
            'Do not finalize until each remaining changed file has been inspected with readFile.',
            'grep or listDir alone do not count as coverage.',
        ].join('\n');
    }

    const summary = getCoverageSummary(targets);
    const criticalPending = pending.filter((t) => t.tier === 'critical');
    const warmPending = pending.filter((t) => t.tier === 'warm');
    const optionalPending = pending.filter((t) => t.tier === 'optional');
    const pct =
        summary.totalTargets > 0
            ? Math.round(
                  (summary.touchedTargets / summary.totalTargets) * 100,
              )
            : 0;

    const blocks: string[] = ['Coverage status:'];

    if (criticalPending.length) {
        const lines = criticalPending
            .slice(0, maxItems)
            .map((t) => `  - ${describeCoverageTarget(t)}`);
        if (criticalPending.length > maxItems) {
            lines.push(
                `  - ... (${criticalPending.length - maxItems} more)`,
            );
        }
        blocks.push(
            `CRITICAL pending (${criticalPending.length}/${summary.criticalTotal}) — MUST be inspected before finalizing:`,
            ...lines,
        );
    } else if (summary.criticalTotal > 0) {
        blocks.push(
            `CRITICAL pending: 0/${summary.criticalTotal} — all critical files covered.`,
        );
    }

    if (warmPending.length) {
        const lines = warmPending
            .slice(0, Math.min(maxItems, 5))
            .map((t) => `  - ${describeCoverageTarget(t)}`);
        if (warmPending.length > 5) {
            lines.push(`  - ... (${warmPending.length - 5} more)`);
        }
        blocks.push(
            `WARM pending (${warmPending.length}/${summary.warmTotal}) — inspect if step budget allows, contributes to coverage:`,
            ...lines,
        );
    }

    if (optionalPending.length) {
        blocks.push(
            `OPTIONAL pending: ${optionalPending.length}/${summary.optionalTotal} (diffs shown as hunk headers only; readFile only if a concrete hypothesis points to one of them).`,
        );
    }

    blocks.push(
        `Total coverage: ${summary.touchedTargets}/${summary.totalTargets} (${pct}%).`,
        `You may finalize once ALL critical files are covered AND total coverage >= ${Math.round(TIERED_TOTAL_COVERAGE_THRESHOLD * 100)}%.`,
        'readFile counts as coverage; grep/listDir do not.',
    );

    return blocks.join('\n');
}

export function markCoverageFromToolCall(
    targets: CoverageTarget[],
    toolName: string,
    args: Record<string, unknown>,
    step: number,
): CoverageTarget[] {
    if (!targets.length) return [];

    const observation = extractCoverageObservation(toolName, args);
    if (!observation) return [];

    const normalizedPath = normalizeRepoPath(observation.path);
    if (!normalizedPath) return [];

    const newlyTouched: CoverageTarget[] = [];

    for (const target of targets) {
        if (!targetMatchesObservation(target, observation, normalizedPath)) {
            continue;
        }

        if (
            !target.touchedBy.some(
                (touch) =>
                    touch.tool === toolName && touch.path === normalizedPath,
            )
        ) {
            target.touchedBy.push({
                tool: toolName,
                path: normalizedPath,
                step,
            });
        }

        if (target.status === 'pending') {
            target.status = 'touched';
            newlyTouched.push(target);
        }
    }

    return newlyTouched;
}

function extractCoverageObservation(
    toolName: string,
    args: Record<string, unknown>,
): CoverageObservation | null {
    if (toolName === 'readFile') {
        const path = String(args.path || args.filePath || args.file || '');
        if (!path) return null;

        return {
            path,
            startLine: toPositiveNumber(args.startLine || args.start_line),
            endLine: toPositiveNumber(args.endLine || args.end_line),
            pathMode: 'file',
        };
    }

    return null;
}

function targetMatchesObservation(
    target: CoverageTarget,
    observation: CoverageObservation,
    normalizedPath: string,
): boolean {
    if (observation.pathMode === 'directory') {
        return (
            target.file === normalizedPath ||
            target.file.startsWith(`${normalizedPath}/`)
        );
    }

    if (!pathsMatch(target.file, normalizedPath)) {
        return false;
    }

    if (!observation.startLine && !observation.endLine) {
        return true;
    }

    if (!target.changedRanges.length) {
        return true;
    }

    const readStart = observation.startLine || 1;
    const readEnd = observation.endLine || observation.startLine || readStart;

    return target.changedRanges.some(([start, end]) =>
        rangesOverlap(start, end, readStart, readEnd),
    );
}

function describeCoverageTarget(target: CoverageTarget): string {
    const ranges = formatRanges(target.changedRanges);
    return ranges ? `${target.file} (${ranges})` : target.file;
}

function formatRanges(ranges: Array<[number, number]>): string {
    if (!ranges.length) return '';

    return `changed lines ${ranges
        .slice(0, 3)
        .map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
        .join(', ')}${ranges.length > 3 ? ', ...' : ''}`;
}

function pathsMatch(targetFile: string, observedPath: string): boolean {
    if (targetFile === observedPath) return true;
    if (observedPath.endsWith(`/${targetFile}`)) return true;
    if (targetFile.endsWith(`/${observedPath}`)) return true;

    const targetBase = targetFile.split('/').pop();
    const observedBase = observedPath.split('/').pop();

    return !!targetBase && targetBase === observedBase && observedBase !== '';
}

function extractChangedLineRanges(patch?: string): Array<[number, number]> {
    if (!patch) return [];

    const ranges: Array<[number, number]> = [];

    for (const line of patch.split('\n')) {
        const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (!match) continue;

        const start = parseInt(match[1], 10);
        const count = parseInt(match[2] || '1', 10);
        const end = count > 0 ? start + count - 1 : start;
        ranges.push([start, end]);
    }

    return ranges;
}

function rangesOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
): boolean {
    return aStart <= bEnd && bStart <= aEnd;
}

function toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
