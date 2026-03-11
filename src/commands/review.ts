import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { gitService } from '../services/git.service.js';
import { reviewService } from '../services/review.service.js';
import { authService } from '../services/auth.service.js';
import { contextService } from '../services/context.service.js';
import { terminalFormatter } from '../formatters/terminal.js';
import { jsonFormatter } from '../formatters/json.js';
import { markdownFormatter } from '../formatters/markdown.js';
import { promptFormatter } from '../formatters/prompt.js';
import { interactiveUI } from '../ui/interactive.js';
import { showTrialLimitPrompt, checkTrialStatus } from '../utils/rate-limit.js';
import { exitWithCode } from '../utils/cli-exit.js';
import { cliDebug, cliError, cliInfo } from '../utils/logger.js';
import { createCommandContext } from '../utils/command-context.js';
import {
    buildAgentErrorEnvelope,
    buildAgentSuccessEnvelope,
    emitAgentEnvelope,
} from '../utils/command-output.js';
import { normalizeCommandError } from '../utils/command-errors.js';
import {
    assertStructuredOutputForFields,
    parseFieldList,
} from '../utils/input-validation.js';
import { applyFieldMask } from '../utils/field-mask.js';
import type {
    GlobalOptions,
    OutputFormat,
    ReviewResult,
    TrialReviewResult,
} from '../types/index.js';
import fs from 'fs/promises';

export const reviewCommand = new Command('review')
    .description('Analyze modified files for code review')
    .argument('[files...]', 'Specific files to analyze')
    .option('-s, --staged', 'Analyze only staged files')
    .option('-c, --commit <sha>', 'Analyze diff from a specific commit')
    .option(
        '-b, --branch <name>',
        'Compare current branch against specified branch (e.g., main)',
    )
    .option(
        '--rules-only',
        'Review using only configured rules (no general suggestions)',
    )
    .option('--fast', 'Fast mode: quicker analysis with lighter checks')
    .option('-i, --interactive', 'Interactive mode: navigate and apply fixes')
    .option('--fix', 'Automatically apply all fixable issues')
    .option(
        '--prompt-only',
        'Output optimized for AI agents (minimal, structured)',
    )
    .option(
        '--fail-on <severity>',
        'Exit with code 1 if issues meet or exceed severity (info, warning, error, critical)',
    )
    .option('--context <file>', 'Custom context file to include in review')
    .option(
        '--fields <csv>',
        'Select response fields (JSON/agent mode only), e.g. summary,issues.file',
    )
    .action(
        async (
            files: string[],
            options: {
                staged?: boolean;
                commit?: string;
                branch?: string;
                rulesOnly?: boolean;
                fast?: boolean;
                interactive?: boolean;
                fix?: boolean;
                promptOnly?: boolean;
                context?: string;
                failOn?: string;
                fields?: string;
            },
            cmd: Command,
        ) => {
            const globalOpts = cmd.optsWithGlobals() as GlobalOptions & {
                staged?: boolean;
                commit?: string;
            };
            const ctx = createCommandContext('review', globalOpts);
            const spinner = ora();
            const fields = parseFieldList(options.fields);

            try {
                assertStructuredOutputForFields({
                    fields: options.fields,
                    format: globalOpts.format,
                    isAgent: ctx.isAgent,
                });

                // Override format if --prompt-only is set
                if (options.promptOnly && !ctx.isAgent) {
                    globalOpts.format = 'prompt';
                }

                const isAuthenticated = await authService.isAuthenticated();

                if (!globalOpts.quiet && !ctx.isAgent) {
                    spinner.start(chalk.cyan('Checking authentication...'));
                }

                let result: ReviewResult | TrialReviewResult;

                if (isAuthenticated) {
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Getting file changes...');
                    }

                    let diff = await getDiff(
                        files,
                        options,
                        globalOpts.verbose,
                    );

                    if (!diff) {
                        if (ctx.isAgent) {
                            await emitAgentEnvelope(
                                buildAgentErrorEnvelope(
                                    ctx.command,
                                    {
                                        code: 'NO_CHANGES',
                                        message: 'No changes to review',
                                    },
                                    ctx.startedAt,
                                ),
                                ctx.outputFile,
                            );
                            return;
                        }

                        if (!globalOpts.quiet) {
                            spinner.fail(chalk.yellow('No changes to review'));
                        }
                        if (globalOpts.verbose) {
                            cliDebug(chalk.dim('[verbose] Checked scopes:'));
                            cliDebug(
                                chalk.dim(
                                    `  - Specific files: ${files && files.length > 0 ? files.join(', ') : 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Branch comparison: ${options.branch || 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Commit: ${options.commit || 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Staged only: ${options.staged ? 'yes' : 'no'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Default: ${!files?.length && !options.branch && !options.commit && !options.staged ? 'working tree (staged + unstaged)' : 'no'}`,
                                ),
                            );
                        }
                        return;
                    }

                    // Enrich with project context
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Reading project context...');
                    }

                    if (globalOpts.verbose) {
                        cliDebug(
                            chalk.dim(
                                '[verbose] Reading project context files...',
                            ),
                        );
                    }

                    diff = await contextService.enrichDiffWithContext(
                        diff,
                        options.context,
                        globalOpts.verbose,
                    );

                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Analyzing code...');
                    }

                    if (globalOpts.verbose) {
                        reviewService.setVerbose(true);
                    }

                    result = await reviewService.analyze(
                        diff,
                        options.rulesOnly,
                        options.fast,
                        {
                            files:
                                files && files.length > 0 ? files : undefined,
                            staged: options.staged,
                            commit: options.commit,
                            branch: options.branch,
                            quiet: globalOpts.quiet,
                        },
                    );
                    const modeLabel = options.fast ? ' (fast mode)' : '';
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.succeed(
                            chalk.green(`Review complete!${modeLabel}`),
                        );
                    }
                } else {
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Running in trial mode...');
                    }

                    const trialStatus = await checkTrialStatus();

                    if (trialStatus.isLimited) {
                        spinner.stop();
                        showTrialLimitPrompt(trialStatus);
                        return;
                    }

                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Getting file changes...');
                    }

                    let diff = await getDiff(
                        files,
                        options,
                        globalOpts.verbose,
                    );

                    if (!diff) {
                        if (ctx.isAgent) {
                            await emitAgentEnvelope(
                                buildAgentErrorEnvelope(
                                    ctx.command,
                                    {
                                        code: 'NO_CHANGES',
                                        message: 'No changes to review',
                                    },
                                    ctx.startedAt,
                                ),
                                ctx.outputFile,
                            );
                            return;
                        }

                        if (!globalOpts.quiet) {
                            spinner.fail(chalk.yellow('No changes to review'));
                        }
                        if (globalOpts.verbose) {
                            cliDebug(chalk.dim('[verbose] Checked scopes:'));
                            cliDebug(
                                chalk.dim(
                                    `  - Specific files: ${files && files.length > 0 ? files.join(', ') : 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Branch comparison: ${options.branch || 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Commit: ${options.commit || 'none'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Staged only: ${options.staged ? 'yes' : 'no'}`,
                                ),
                            );
                            cliDebug(
                                chalk.dim(
                                    `  - Default: ${!files?.length && !options.branch && !options.commit && !options.staged ? 'working tree (staged + unstaged)' : 'no'}`,
                                ),
                            );
                        }
                        return;
                    }

                    // Enrich with project context
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan('Reading project context...');
                    }

                    if (globalOpts.verbose) {
                        cliDebug(
                            chalk.dim(
                                '[verbose] Reading project context files...',
                            ),
                        );
                    }

                    diff = await contextService.enrichDiffWithContext(
                        diff,
                        options.context,
                        globalOpts.verbose,
                    );

                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.text = chalk.cyan(
                            'Analyzing code (trial mode)...',
                        );
                    }

                    if (globalOpts.verbose) {
                        reviewService.setVerbose(true);
                    }

                    const trialResult = await reviewService.trialAnalyze(diff);
                    result = trialResult;
                    if (!globalOpts.quiet && !ctx.isAgent) {
                        spinner.succeed(
                            chalk.green(
                                formatTrialCompletionMessage(trialResult),
                            ),
                        );
                    }
                }

                // Handle fix mode
                if (options.fix) {
                    await interactiveUI.runQuickFix(result);

                    if (ctx.isAgent) {
                        await emitAgentEnvelope(
                            buildAgentSuccessEnvelope(
                                ctx.command,
                                { fixedIssues: true },
                                ctx.startedAt,
                            ),
                            ctx.outputFile,
                        );
                    }
                    return;
                }

                const selectedResult = fields
                    ? applyFieldMask(result, fields)
                    : result;

                // Handle interactive mode (now default if no output format specified)
                const shouldUseInteractive =
                    (!ctx.isAgent && options.interactive) ||
                    (!ctx.isAgent &&
                        !globalOpts.output &&
                        globalOpts.format === 'terminal');

                if (shouldUseInteractive) {
                    await interactiveUI.run(result);
                    return;
                }

                if (ctx.isAgent) {
                    await emitAgentEnvelope(
                        buildAgentSuccessEnvelope(
                            ctx.command,
                            selectedResult,
                            ctx.startedAt,
                        ),
                        ctx.outputFile,
                    );
                } else {
                    // Regular output (only when --format or --output is specified)
                    const output = formatOutput(
                        selectedResult as ReviewResult,
                        globalOpts.format,
                    );

                    if (globalOpts.output) {
                        await fs.writeFile(globalOpts.output, output, 'utf-8');
                        cliInfo(
                            chalk.green(
                                `\nOutput saved to ${globalOpts.output}`,
                            ),
                        );
                    } else if (globalOpts.format === 'terminal') {
                        cliInfo(output);
                    } else {
                        cliInfo(output);
                    }
                }

                // Check --fail-on after output
                if (options.failOn) {
                    const severityOrder: Record<string, number> = {
                        info: 0,
                        warning: 1,
                        error: 2,
                        critical: 3,
                    };
                    const threshold = severityOrder[options.failOn] ?? 0;
                    const hasBlockingIssues = result.issues.some(
                        (i) => (severityOrder[i.severity] ?? 0) >= threshold,
                    );
                    if (hasBlockingIssues) {
                        exitWithCode(1);
                    }
                }
            } catch (error) {
                const normalized = normalizeCommandError(error);

                if (ctx.isAgent) {
                    await emitAgentEnvelope(
                        buildAgentErrorEnvelope(
                            ctx.command,
                            {
                                code: normalized.code,
                                message: normalized.message,
                                details: normalized.details,
                            },
                            ctx.startedAt,
                        ),
                        ctx.outputFile,
                    );

                    if (normalized.exitCode > 0) {
                        exitWithCode(normalized.exitCode);
                    }
                    return;
                }

                if (!globalOpts.quiet) {
                    spinner.fail(chalk.red('Review failed'));
                }

                if (error instanceof Error) {
                    cliError(chalk.red(error.message));
                    if (globalOpts.verbose) {
                        cliError(error.stack);
                    }
                } else {
                    cliError(chalk.red('An unexpected error occurred'));
                    if (globalOpts.verbose) {
                        cliError(error);
                    }
                }
                exitWithCode(normalized.exitCode);
            }
        },
    );

async function getDiff(
    files: string[],
    options: { staged?: boolean; commit?: string; branch?: string },
    verbose?: boolean,
): Promise<string> {
    let diff: string;

    gitService.setVerbose(!!verbose);

    if (files && files.length > 0) {
        if (verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Getting diff for specific files: ${files.join(', ')}`,
                ),
            );
        }
        diff = await gitService.getDiffForFiles(files);
    } else if (options.branch) {
        if (verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Getting diff for branch: ${options.branch}`,
                ),
            );
        }
        diff = await gitService.getDiffForBranch(options.branch);
    } else if (options.commit) {
        if (verbose) {
            cliDebug(
                chalk.dim(
                    `[verbose] Getting diff for commit: ${options.commit}`,
                ),
            );
        }
        diff = await gitService.getDiffForCommit(options.commit);
    } else if (options.staged) {
        if (verbose) {
            cliDebug(chalk.dim('[verbose] Getting staged diff only'));
        }
        diff = await gitService.getStagedDiff();
    } else {
        if (verbose) {
            cliDebug(
                chalk.dim(
                    '[verbose] Getting working tree diff (staged + unstaged)',
                ),
            );
        }
        diff = await gitService.getWorkingTreeDiff();
    }

    if (verbose) {
        cliDebug(
            chalk.dim(
                `[verbose] Diff result: ${diff ? `${diff.length} characters` : 'empty'}`,
            ),
        );
        if (!diff) {
            cliDebug(
                chalk.dim(
                    '[verbose] No changes detected in the requested scope',
                ),
            );
        } else {
            // Show first 500 chars of diff for debugging
            const preview = diff.substring(0, 500);
            cliDebug(
                chalk.dim(
                    `[verbose] Diff preview:\n${preview}${diff.length > 500 ? '\n... (truncated)' : ''}`,
                ),
            );
        }
    }

    return diff;
}

function formatOutput(result: ReviewResult, format: OutputFormat): string {
    switch (format) {
        case 'json':
            return jsonFormatter.format(result);
        case 'markdown':
            return markdownFormatter.format(result);
        case 'prompt':
            return promptFormatter.format(result);
        case 'terminal':
        default:
            return terminalFormatter.format(result);
    }
}

function formatTrialCompletionMessage(result: TrialReviewResult): string {
    if (result.trialInfo) {
        return `Review complete! (Trial: ${result.trialInfo.reviewsUsed}/${result.trialInfo.reviewsLimit} reviews today)`;
    }

    if (result.rateLimit) {
        const used = Math.max(
            0,
            result.rateLimit.limit - result.rateLimit.remaining,
        );
        return `Review complete! (Trial: ${used}/${result.rateLimit.limit} reviews today)`;
    }

    return 'Review complete! (Trial mode)';
}
