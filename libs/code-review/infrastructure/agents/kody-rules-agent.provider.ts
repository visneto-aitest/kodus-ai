import { Injectable } from '@nestjs/common';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    BaseCodeReviewAgentProvider,
    ReviewAgentIdentity,
    ReviewAgentInput,
    ReviewAgentOutput,
} from './base-code-review-agent.provider';
import {
    IKodyRule,
    KodyRulesScope,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

/**
 * Agent that validates code changes against Kody Rules (team-defined rules).
 *
 * Unlike the bug/security/performance agents that look for general issues,
 * this agent focuses exclusively on checking whether changed code violates
 * the team's custom rules (scope: FILE and PULL_REQUEST, type: STANDARD).
 *
 * Memory rules (type: MEMORY) are handled by the other agents via their
 * system prompts — this agent only handles formal STANDARD rules.
 */
@Injectable()
export class KodyRulesAgentProvider extends BaseCodeReviewAgentProvider {
    constructor(
        promptRunnerService: PromptRunnerService,
        permissionValidationService: PermissionValidationService,
        observabilityService: ObservabilityService,
    ) {
        super(
            promptRunnerService,
            permissionValidationService,
            observabilityService,
        );
    }

    protected getIdentity(): ReviewAgentIdentity {
        return {
            name: 'kodus-rules-review-agent',
            description:
                'Code review agent specialized in validating code changes against ' +
                'team-defined rules and conventions. Investigates code to check ' +
                'compliance with each rule before reporting violations.',
            goal: 'Check every applicable rule against the changed code. ' +
                'Only report violations you confirmed with evidence from the code.',
            expertise: [
                'Custom team rule validation',
                'Convention compliance checking',
                'Path-based rule filtering',
                'Code pattern matching against examples',
            ],
        };
    }

    protected getCategoryLabel(): string {
        return 'kody_rules';
    }

    protected getCategoryPrompt(): string {
        return `## Focus: Team Rules & Conventions

You validate code against the team's custom rules listed below. Your ONLY job is to check these rules — do not look for general bugs, security issues, or performance problems.

### How to analyze:
1. **Read each rule carefully**: Understand what the rule requires and what path patterns it applies to.
2. **Check applicability**: Only check a rule if the changed files match its path pattern (if specified).
3. **Investigate with tools**: Use readFile/grep to verify whether the changed code complies with each rule.
4. **Use examples**: If a rule has examples, compare the changed code against them.
5. **Report violations only**: Do NOT report code that correctly follows the rules.

### What to report:
- Code that violates a specific team rule
- Include which rule was violated (by title)
- Include evidence from the code showing the violation

### Skip:
- General bugs, security issues, performance problems (handled by other agents)
- Code that follows the rules correctly
- Rules whose path patterns don't match any changed file`;
    }

    /**
     * Override execute to inject rules into the prompt dynamically.
     */
    async execute(input: ReviewAgentInput & { kodyRules?: Partial<IKodyRule>[] }): Promise<ReviewAgentOutput> {
        const rules = (input.kodyRules || []).filter(
            (r) =>
                r.type !== KodyRulesType.MEMORY &&
                r.status === 'active',
        );

        if (rules.length === 0) {
            return {
                suggestions: [],
                agentName: this.getIdentity().name,
                turnsUsed: 0,
                durationMs: 0,
            };
        }

        // Inject rules into v2PromptOverrides so they appear in the system prompt
        const rulesSection = this.formatKodyRules(rules, input.changedFiles);

        const modifiedInput: ReviewAgentInput = {
            ...input,
            // Override the generation main to include rules
            generationMain: [
                input.generationMain || '',
                rulesSection,
            ].filter(Boolean).join('\n\n'),
        };

        return super.execute(modifiedInput);
    }

    /**
     * Format Kody Rules into a structured prompt section.
     * Filters rules by path applicability to changed files.
     */
    private formatKodyRules(
        rules: Partial<IKodyRule>[],
        changedFiles: { filename: string }[],
    ): string {
        const changedPaths = changedFiles.map((f) => f.filename);

        const applicableRules = rules.filter((rule) => {
            // If no path pattern, rule applies to all files
            if (!rule.path) return true;

            // Check if any changed file matches the path pattern
            return changedPaths.some((filePath) =>
                this.matchesPathPattern(filePath, rule.path!),
            );
        });

        if (applicableRules.length === 0) return '';

        const formatted = applicableRules.map((rule, i) => {
            const parts = [
                `### Rule ${i + 1}: ${rule.title}`,
                `**Description**: ${rule.rule}`,
            ];

            if (rule.severity) {
                parts.push(`**Severity**: ${rule.severity}`);
            }

            if (rule.path) {
                parts.push(`**Applies to**: files matching \`${rule.path}\``);
            }

            if (rule.scope) {
                parts.push(
                    `**Scope**: ${rule.scope === KodyRulesScope.FILE ? 'Per-file' : 'Pull request level'}`,
                );
            }

            if (rule.examples && rule.examples.length > 0) {
                parts.push('**Examples**:');
                for (const ex of rule.examples) {
                    const label = ex.isCorrect ? 'Correct' : 'Incorrect';
                    parts.push(`- ${label}:\n\`\`\`\n${ex.snippet}\n\`\`\``);
                }
            }

            return parts.join('\n');
        });

        return `## Team Rules to Validate (${applicableRules.length} rules)\n\nCheck EVERY rule below against the changed code. Report violations only.\n\n${formatted.join('\n\n---\n\n')}`;
    }

    /**
     * Simple path pattern matching.
     * Supports: exact match, glob-like patterns (* and **), directory prefix.
     */
    private matchesPathPattern(filePath: string, pattern: string): boolean {
        // Exact match
        if (filePath === pattern) return true;

        // Directory prefix (e.g., "src/controllers/")
        if (pattern.endsWith('/') && filePath.startsWith(pattern)) return true;

        // Simple glob: convert * to regex
        const regexStr = pattern
            .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<DOUBLESTAR>>>/g, '.*')
            .replace(/\./g, '\\.');

        try {
            return new RegExp(`^${regexStr}$`).test(filePath);
        } catch {
            // Invalid pattern — treat as prefix match
            return filePath.includes(pattern);
        }
    }
}
