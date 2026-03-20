import { Injectable } from '@nestjs/common';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    BaseCodeReviewAgentProvider,
    ReviewAgentIdentity,
} from './base-code-review-agent.provider';

@Injectable()
export class PerformanceAgentProvider extends BaseCodeReviewAgentProvider {
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
            name: 'kodus-performance-review-agent',
            description:
                'Performance engineering expert specialized in finding N+1 queries, ' +
                'unnecessary loops, memory leaks, missing caching opportunities, ' +
                'and hot path allocations in code changes.',
            goal: 'Find real performance issues that would cause noticeable degradation ' +
                'in production. Verify impact by investigating the codebase context.',
            expertise: [
                'Database query optimization (N+1, missing indexes)',
                'Algorithm complexity analysis',
                'Memory leak detection',
                'Caching strategy evaluation',
                'I/O bottleneck identification',
                'Hot path optimization',
            ],
        };
    }

    protected getCategoryLabel(): string {
        return 'performance';
    }

    protected getCategoryPrompt(): string {
        return `## Focus: Performance Issues

You find performance issues by analyzing execution frequency and data volume at each code path.

### How to analyze:
1. **Identify hot paths**: Use grep to find how the changed code is called. Is it in a request handler? A loop? A batch job? How often does it run?
2. **Count operations**: Mentally simulate with N=1000 items. How many DB queries, API calls, allocations happen? Is it O(n²) when O(n) is possible?
3. **Check data flow volume**: Use readFile to understand data structures. Are large objects cloned unnecessarily? Are results cached?
4. **Trace async patterns**: Are operations sequential when they could be parallel? Is there blocking I/O in an async context?

### What to report:
- N+1 queries (DB calls inside loops)
- O(n²) algorithms where O(n) or O(n log n) is possible
- Memory leaks (event listeners not removed, growing caches without eviction)
- Missing caching for repeated expensive operations
- Hot path allocations (object creation inside tight loops)
- Blocking I/O in async contexts
- Unbounded growth (collections without size limits)
- Catastrophic regex backtracking

### Skip:
- Micro-optimizations that don't affect real-world performance
- Premature optimization of cold paths
- Negligible differences
- **Bugs that cause crashes, TypeErrors, or wrong results** — even if they happen in a hot path, if the code CRASHES or produces WRONG output, that is a bug, not a performance issue. Let the bug agent handle it.
- Race conditions, null pointer errors, type mismatches — these are correctness problems, not performance
- Security vulnerabilities (handled by security agent)`;
    }
}
