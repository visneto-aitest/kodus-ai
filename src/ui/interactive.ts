import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import type { ReviewResult, ReviewIssue } from '../types/index.js';
import { fixService } from '../services/fix.service.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

/**
 * Interactive UI - Navigable interface for reviewing issues
 */
class InteractiveUI {
    private getSeverityColor(severity: string): (text: string) => string {
        switch (severity) {
            case 'critical':
                return chalk.red.bold;
            case 'error':
                return chalk.red;
            case 'warning':
                return chalk.yellow;
            case 'info':
                return chalk.cyan;
            default:
                return chalk.white;
        }
    }

    private getSeverityIcon(severity: string): string {
        switch (severity) {
            case 'critical':
                return '🔴';
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️ ';
            case 'info':
                return 'ℹ️ ';
            default:
                return '•';
        }
    }

    private formatIssueTitle(issue: ReviewIssue, _index: number): string {
        const icon = this.getSeverityIcon(issue.severity);
        const color = this.getSeverityColor(issue.severity);
        const location = chalk.cyan(`${issue.file}:${issue.line}`);
        const fixable = issue.fixable ? chalk.green(' [fixable]') : '';

        return `${icon} ${color(issue.severity.toUpperCase())} - ${location}${fixable} - ${issue.message}`;
    }

    private displayIssueDetails(issue: ReviewIssue): void {
        console.log('');
        console.log(
            chalk.bold(
                '┌─ Issue Details ─────────────────────────────────────────',
            ),
        );
        console.log(chalk.dim('│'));
        console.log(
            chalk.dim('│ ') + chalk.bold('File: ') + chalk.cyan(issue.file),
        );
        console.log(
            chalk.dim('│ ') +
                chalk.bold('Line: ') +
                chalk.yellow(issue.line.toString()),
        );
        console.log(
            chalk.dim('│ ') +
                chalk.bold('Severity: ') +
                this.getSeverityColor(issue.severity)(issue.severity),
        );

        if (issue.category) {
            console.log(
                chalk.dim('│ ') +
                    chalk.bold('Category: ') +
                    chalk.magenta(issue.category),
            );
        }

        if (issue.ruleId) {
            console.log(
                chalk.dim('│ ') +
                    chalk.bold('Rule: ') +
                    chalk.dim(issue.ruleId),
            );
        }

        console.log(chalk.dim('│'));
        console.log(chalk.dim('│ ') + chalk.bold('Message:'));
        console.log(chalk.dim('│   ') + issue.message);

        if (issue.suggestion) {
            console.log(chalk.dim('│'));
            console.log(chalk.dim('│ ') + chalk.bold('Suggestion:'));
            console.log(chalk.dim('│   ') + chalk.green(issue.suggestion));
        }

        if (issue.recommendation) {
            console.log(chalk.dim('│'));
            console.log(chalk.dim('│ ') + chalk.bold('Recommendation:'));
            console.log(chalk.dim('│   ') + chalk.cyan(issue.recommendation));
        }

        if (issue.fixable && issue.fix) {
            console.log(chalk.dim('│'));
            console.log(
                chalk.dim('│ ') + chalk.bold.green('✓ Auto-fix available'),
            );
        }

        console.log(
            chalk.bold(
                '└─────────────────────────────────────────────────────────',
            ),
        );
        console.log('');
    }

    private async showFixPreview(issue: ReviewIssue): Promise<void> {
        if (!issue.fixable || !issue.fix) {
            console.log(chalk.yellow('No fix available for this issue'));
            return;
        }

        console.log('');
        console.log(
            chalk.bold(
                '┌─ Fix Preview ───────────────────────────────────────────',
            ),
        );
        console.log(chalk.dim('│'));

        if (issue.fix.oldCode) {
            console.log(chalk.dim('│ ') + chalk.red('- Old code:'));
            issue.fix.oldCode.split('\n').forEach((line) => {
                console.log(chalk.dim('│   ') + chalk.red(line));
            });
            console.log(chalk.dim('│'));
        }

        console.log(chalk.dim('│ ') + chalk.green('+ New code:'));
        issue.fix.newCode.split('\n').forEach((line) => {
            console.log(chalk.dim('│   ') + chalk.green(line));
        });

        console.log(
            chalk.bold(
                '└─────────────────────────────────────────────────────────',
            ),
        );
        console.log('');
    }

    private groupIssuesByFile(
        issues: ReviewIssue[],
    ): Map<string, ReviewIssue[]> {
        const grouped = new Map<string, ReviewIssue[]>();

        for (const issue of issues) {
            if (!grouped.has(issue.file)) {
                grouped.set(issue.file, []);
            }
            grouped.get(issue.file)!.push(issue);
        }

        return grouped;
    }

    private getFileStats(issues: ReviewIssue[]): {
        critical: number;
        error: number;
        warning: number;
        info: number;
    } {
        return {
            critical: issues.filter((i) => i.severity === 'critical').length,
            error: issues.filter((i) => i.severity === 'error').length,
            warning: issues.filter((i) => i.severity === 'warning').length,
            info: issues.filter((i) => i.severity === 'info').length,
        };
    }

    private formatCategoryBadge(category: string): string {
        const categoryMap: Record<string, string> = {
            security_vulnerability: 'security',
            performance: 'perf',
            code_quality: 'quality',
            best_practices: 'practices',
            style: 'style',
            bug: 'bug',
            complexity: 'complex',
            maintainability: 'maintain',
        };
        return categoryMap[category] || category;
    }

    private formatFileChoice(file: string, issues: ReviewIssue[]): string {
        const stats = this.getFileStats(issues);
        const badges: string[] = [];

        if (stats.critical > 0) {
            badges.push(chalk.red.bold(`${stats.critical} critical`));
        }
        if (stats.error > 0) {
            badges.push(chalk.red(`${stats.error} error`));
        }
        if (stats.warning > 0) {
            badges.push(chalk.yellow(`${stats.warning} warning`));
        }
        if (stats.info > 0) {
            badges.push(chalk.cyan(`${stats.info} info`));
        }

        // Get unique categories
        const categories = [
            ...new Set(issues.map((i) => i.category).filter(Boolean)),
        ];
        const categoryBadge =
            categories.length > 0
                ? chalk.magenta(
                      ` [${categories.map((c) => this.formatCategoryBadge(c!)).join(', ')}]`,
                  )
                : '';

        const fixable = issues.filter((i) => i.fixable).length;
        const fixableBadge =
            fixable > 0 ? chalk.green(` [${fixable} fixable]`) : '';

        return `${chalk.cyan(file)} ${chalk.dim('─')} ${badges.join(', ')}${categoryBadge}${fixableBadge}`;
    }

    async run(result: ReviewResult): Promise<void> {
        console.log('');
        console.log(
            chalk.bold.cyan(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            ),
        );
        console.log(chalk.bold.cyan('  Kodus Code Review - Interactive Mode'));
        console.log(
            chalk.bold.cyan(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            ),
        );
        console.log('');

        const summary = result.summary?.trim();
        if (summary) {
            console.log(chalk.dim('Summary: ') + chalk.white(summary));
        }
        console.log(
            chalk.dim('Files analyzed: ') +
                chalk.white(result.filesAnalyzed.toString()),
        );
        console.log(
            chalk.dim('Issues found: ') +
                chalk.white(result.issues.length.toString()),
        );
        console.log(
            chalk.dim('Duration: ') + chalk.white(`${result.duration}ms`),
        );
        console.log('');

        if (result.issues.length === 0) {
            if (!summary) {
                console.log(
                    chalk.green.bold(
                        '✓ No issues found! Your code looks great.',
                    ),
                );
            }
            console.log('');
            return;
        }

        const fixableCount = result.issues.filter((i) => i.fixable).length;
        if (fixableCount > 0) {
            console.log(
                chalk.green(
                    `${fixableCount} issue${fixableCount > 1 ? 's' : ''} can be auto-fixed`,
                ),
            );
            console.log('');
        }

        // Group issues by file
        const issuesByFile = this.groupIssuesByFile(result.issues);
        const fixedIssues: ReviewIssue[] = [];
        while (true) {
            // Show file selection menu
            console.log(chalk.bold('\n📁 Select a file to review:\n'));

            const fileChoices = Array.from(issuesByFile.entries()).map(
                ([file, issues]) => ({
                    name: this.formatFileChoice(file, issues),
                    value: file,
                }),
            );

            fileChoices.push({
                name: chalk.dim('Exit review'),
                value: '__EXIT__',
            });

            const selectedFile = await select({
                message: 'Choose a file:',
                choices: fileChoices,
                pageSize: 15,
            });

            if (selectedFile === '__EXIT__') {
                break;
            }

            // Show issues for selected file
            const fileIssues = issuesByFile.get(selectedFile)!;
            await this.reviewFileIssues(selectedFile, fileIssues, fixedIssues);

            // Remove file from list if all issues are fixed
            if (fileIssues.every((issue) => fixedIssues.includes(issue))) {
                issuesByFile.delete(selectedFile);

                if (issuesByFile.size === 0) {
                    console.log(
                        chalk.green.bold('\n✓ All issues have been fixed!'),
                    );
                    break;
                }
            }
        }

        console.log('');
        console.log(
            chalk.bold.cyan(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            ),
        );
        console.log(chalk.bold('Review Summary'));
        console.log(
            chalk.bold.cyan(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            ),
        );
        console.log('');
        console.log(
            chalk.dim('Total issues: ') +
                chalk.white(result.issues.length.toString()),
        );
        console.log(
            chalk.dim('Fixed: ') + chalk.green(fixedIssues.length.toString()),
        );
        console.log(
            chalk.dim('Remaining: ') +
                chalk.yellow(
                    (result.issues.length - fixedIssues.length).toString(),
                ),
        );
        console.log('');
    }

    private generateFixPrompt(file: string, issues: ReviewIssue[]): string {
        const unfixedIssues = issues.filter((issue) => issue);

        let prompt = `Fix the following issues in ${file}:\n\n`;

        unfixedIssues.forEach((issue, index) => {
            prompt += `${index + 1}. ${issue.severity.toUpperCase()} at line ${issue.line}\n`;
            prompt += `   ${issue.message}\n`;

            if (issue.suggestion) {
                prompt += `   Suggestion: ${issue.suggestion}\n`;
            }

            if (issue.recommendation) {
                prompt += `   Recommendation: ${issue.recommendation}\n`;
            }

            prompt += '\n';
        });

        prompt += `Please fix these ${unfixedIssues.length} issue${unfixedIssues.length > 1 ? 's' : ''} in ${file}.`;

        return prompt;
    }

    private async copyToClipboard(text: string): Promise<boolean> {
        return copyTextToClipboard(text);
    }

    private async reviewFileIssues(
        file: string,
        issues: ReviewIssue[],
        fixedIssues: ReviewIssue[],
    ): Promise<void> {
        console.log('\n');
        console.log(
            chalk.bold.cyan(
                `┌─ ${file} ────────────────────────────────────────────────`,
            ),
        );
        console.log(
            chalk.dim(
                `│ ${issues.length} issue${issues.length > 1 ? 's' : ''} in this file`,
            ),
        );
        console.log(
            chalk.bold.cyan(
                '└────────────────────────────────────────────────────────────',
            ),
        );

        // File-level menu
        const fileAction = await select({
            message: 'What would you like to do with this file?',
            choices: [
                { name: 'Review issues one by one', value: 'review' },
                { name: 'Copy fix prompt for AI agent', value: 'copy' },
                { name: 'Back to file list', value: 'back' },
            ],
        });

        if (fileAction === 'back') {
            return;
        }

        if (fileAction === 'copy') {
            const prompt = this.generateFixPrompt(file, issues);
            const copied = await this.copyToClipboard(prompt);

            if (copied) {
                console.log(chalk.green('\n✓ Fix prompt copied to clipboard!'));
                console.log(
                    chalk.dim(
                        'Paste it into Claude Code, Cursor, or any AI coding assistant.\n',
                    ),
                );
            } else {
                console.log(
                    chalk.yellow(
                        "\n⚠ Could not copy to clipboard. Here's the prompt:\n",
                    ),
                );
                console.log(chalk.cyan('─'.repeat(60)));
                console.log(prompt);
                console.log(chalk.cyan('─'.repeat(60)));
                console.log('');
            }

            // Show menu again
            await this.reviewFileIssues(file, issues, fixedIssues);
            return;
        }

        // Review issues one by one
        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];

            // Skip if already fixed
            if (fixedIssues.includes(issue)) {
                continue;
            }

            console.log(
                chalk.bold(`\n[${i + 1}/${issues.length}] Issue in ${file}`),
            );
            this.displayIssueDetails(issue);

            const choices = [];

            if (issue.fixable) {
                choices.push(
                    { name: 'View fix preview', value: 'preview' },
                    { name: 'Apply fix', value: 'fix' },
                );
            }

            choices.push(
                { name: 'Skip this issue', value: 'skip' },
                { name: 'Back to file list', value: 'back' },
            );

            const action = await select({
                message: 'What would you like to do?',
                choices,
            });

            if (action === 'preview') {
                await this.showFixPreview(issue);
                i--; // Repeat this issue
                continue;
            }

            if (action === 'fix') {
                try {
                    await fixService.applyFix(issue);
                    console.log(chalk.green('✓ Fix applied successfully!'));
                    fixedIssues.push(issue);
                } catch (error) {
                    console.log(chalk.red('✗ Failed to apply fix'));
                    if (error instanceof Error) {
                        console.log(chalk.red(`  ${error.message}`));
                    }
                }
            }

            if (action === 'back') {
                return;
            }
        }
    }

    /**
     * Quick fix mode - applies all fixable issues automatically
     */
    async runQuickFix(result: ReviewResult): Promise<void> {
        const fixableIssues = result.issues.filter((i) => i.fixable);

        if (fixableIssues.length === 0) {
            console.log(chalk.yellow('No auto-fixable issues found'));
            return;
        }

        console.log('');
        console.log(
            chalk.bold(
                `Found ${fixableIssues.length} fixable issue${fixableIssues.length > 1 ? 's' : ''}`,
            ),
        );
        console.log('');

        const confirmApply = await confirm({
            message: `Apply all ${fixableIssues.length} fixes?`,
            default: false,
        });

        if (!confirmApply) {
            console.log(chalk.yellow('Fixes cancelled'));
            return;
        }

        console.log('');
        const { applied, failed } = await fixService.applyFixes(fixableIssues);

        console.log('');
        console.log(
            chalk.green(`✓ Applied ${applied} fix${applied > 1 ? 'es' : ''}`),
        );

        if (failed > 0) {
            console.log(
                chalk.red(
                    `✗ Failed to apply ${failed} fix${failed > 1 ? 'es' : ''}`,
                ),
            );
        }

        console.log('');
    }
}

export const interactiveUI = new InteractiveUI();
