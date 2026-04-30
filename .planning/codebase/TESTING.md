# Testing Patterns

**Analysis Date:** 2026-04-29

## Test Framework

**Runner:**
- Jest 29+ (via `ts-jest` preset)
- Config: `jest.config.ts`
- Test environment: `node` (server-side only)

**Assertion Library:**
- Jest's built-in `expect()` (no external assertion library)

**Run Commands:**
```bash
npm run test                  # Run all tests matching **/*.spec.ts
npm run test -- --watch      # Watch mode
npm run test -- --coverage   # Coverage report (generates in `coverage/`)
npm run test integration     # Run integration tests (matches **/*.integration.spec.ts)
npm run test e2e            # Run E2E tests (matches **/*.e2e-spec.ts)
```

**Setup:**
- `setupFiles: ['<rootDir>/test/jest.setup.ts']`—runs before test suite
- Module resolution includes both root `node_modules` and `apps/web/node_modules` (for web-only packages)
- SWC transformer enabled for TypeScript—faster than ts-jest

## Test File Organization

**Location:**
- **Unit tests:** Colocated next to source files (same directory as implementation)
  - `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.spec.ts` → next to `.use-case.ts`
- **Integration tests:** Centralized under `/test/integration/`
  - `test/integration/agents/chat-with-kody-business-logic.integration.spec.ts`
  - `test/integration/agents/business-rules-validation-flow.integration.spec.ts`
- **Webhook controller tests:** `/test/unit/webhooks/controllers/`
  - `test/unit/webhooks/controllers/github.controller.spec.ts`

**Naming:**
- `.spec.ts` suffix for unit tests (colocated)
- `.integration.spec.ts` suffix for integration tests
- `.e2e-spec.ts` suffix for end-to-end tests (currently minimal)

## Test Structure

**Suite Organization:**

```typescript
// Standard unit test pattern from chatWithKodyFromGit.use-case.spec.ts
jest.mock('@kodus/flow', () => ({
    createLogger: () => ({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
    }),
    createThreadId: jest.fn(() => ({
        id: 'TR-vbl-test',
        metadata: {},
    })),
}));

import { PlatformType } from '@libs/core/domain/enums/platform-type.enum';
import { ChatWithKodyFromGitUseCase } from './chatWithKodyFromGit.use-case';

describe('ChatWithKodyFromGitUseCase', () => {
    let useCase: ChatWithKodyFromGitUseCase;
    let codeManagementService: {
        findTeamAndOrganizationIdByConfigKey: jest.Mock;
        addReactionToComment: jest.Mock;
    };
    let conversationAgentUseCase: { execute: jest.Mock };
    let businessRulesValidationAgentUseCase: { execute: jest.Mock };

    beforeEach(() => {
        // Mock dependencies
        codeManagementService = { ... };
        conversationAgentUseCase = { execute: jest.fn() };
        businessRulesValidationAgentUseCase = { execute: jest.fn() };

        // Instantiate with mocks
        useCase = new ChatWithKodyFromGitUseCase(
            codeManagementService as any,
            conversationAgentUseCase as any,
            businessRulesValidationAgentUseCase as any,
        );
    });

    it('passes GitHub PR refs to business logic validation comments', async () => {
        await useCase.execute({
            event: 'issue_comment',
            platformType: PlatformType.GITHUB,
            payload: { /* webhook payload */ },
        } as any);

        expect(businessRulesValidationAgentUseCase.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationAndTeamData: { organizationId: 'org-1', teamId: 'team-1' },
                prepareContext: expect.objectContaining({
                    userQuestion: '@kody -v business-logic validate this change',
                }),
            }),
        );
    });
});
```

**Patterns:**
- `jest.mock('@kodus/flow')` at file top to stub logger and thread creation
- `beforeEach()` creates fresh mocks and useCase instance for test isolation
- `as any` used liberally for mock objects (TS strictness relaxed for testing)
- Tests use `expect(...).toHaveBeenCalledWith()` to verify call contracts

## Mocking

**Framework:** Jest built-in mocking via `jest.mock()` and `jest.fn()`

**What to Mock:**
- Logger (`@kodus/flow.createLogger`) → return object with empty jest functions
- Thread creation (`createThreadId`) → return stub with predictable `id`
- Platform clients (GitHub, GitLab, etc.) → mock `codeManagementService` methods
- External agents (ConversationAgent, BusinessRulesValidationAgent) → return Jest mocks
- LLM providers → mock via `BaseAgentProvider.createLLMAdapter` or `runLLMStep`

**What NOT to Mock:**
- Domain utilities like `isKodyMentionNonReview()`, `getRepository()` → call real implementations
- Platform-specific extractors → test with real webhook payloads and verify extraction logic
- Flow control (CommandManager, handlers) → test real handler delegation

**Integration test mock example (from business-logic integration spec):**
```typescript
const mockToolCaller: ToolCaller = {
    callTool: async (toolName: string) => {
        if (toolName === 'KODUS_GET_PULL_REQUEST') {
            return { result: { data: { body: 'PR body' } } };
        }
        if (toolName === 'KODUS_GET_PULL_REQUEST_DIFF') {
            return { result: { data: 'diff --git...' } };
        }
        return { result: {} };
    },
    getRegisteredTools: () => [{ name: 'KODUS_GET_PULL_REQUEST' }, ...],
    getToolsForLLM: () => [...],
};

jest.spyOn(provider as any, 'runLLMStep').mockImplementation(
    async (_step, ctx) => {
        const prompt = buildBusinessRulesAnalysisPrompt(ctx);
        expect(prompt).toContain('USER LANGUAGE: pt-BR');
        return {
            ...ctx,
            validationResult: { /* response */ },
        };
    },
);
```

## Fixtures and Factories

**Test Data:**
- Webhook payloads hardcoded in test files (no separate fixture files)
- Platform-specific payloads created inline with required fields for platform extraction
- Example GitHub issue_comment payload:
  ```typescript
  const params = {
      event: 'issue_comment',
      platformType: PlatformType.GITHUB,
      payload: {
          action: 'created',
          repository: { id: 'repo-1', name: 'kodus-extension' },
          issue: {
              id: 456,
              body: 'PR description body',
              pull_request: { url: 'https://api.github.com/repos/kodus/kodus-extension/pulls/132' },
          },
          comment: { id: 123, body: '@kody -v business-logic ...' },
          sender: { id: 'user-1', login: 'alice' },
      },
  };
  ```

**Location:**
- Factories and test data builders: None currently used; payloads are inline
- Stub objects for mocks: Defined in `beforeEach()` with conditional logic via jest.fn implementations

## Coverage

**Requirements:** No explicit coverage target enforced by CI; coverage reports generated on demand

**View Coverage:**
```bash
npm run test -- --coverage
# Generates coverage/ directory with HTML report
# Open coverage/lcov-report/index.html in browser
```

**Coverage gaps identified:**
- No coverage for response posting idempotency (update vs create re-trigger scenarios)
- Limited end-to-end tests for duplicate webhook delivery handling
- No tests for timeout/retry behavior on LLM failures
- Minimal coverage for comment parsing edge cases (Bitbucket vs GitHub vs GitLab variations)

## Test Types

**Unit Tests:**
- Scope: Single use case or handler in isolation
- Mocks: All dependencies (agents, services, platform clients)
- Speed: Fast (< 100ms per test)
- Location: Colocated `.spec.ts` files
- Example: `chatWithKodyFromGit.use-case.spec.ts` tests command dispatch and context preparation

**Integration Tests:**
- Scope: Full flow from webhook handler through agent to response
- Mocks: LLM calls mocked via `runLLMStep`, but real agent orchestration
- Speed: Moderate (1-5s per test)
- Location: `/test/integration/agents/`, `/test/integration/platformData/`
- Example: `chat-with-kody-business-logic.integration.spec.ts` tests full business logic validation flow including real provider execution

**E2E Tests:**
- Scope: None currently implemented for conversation flow
- Status: Not applicable to this async webhook-driven system
- Known issue: Full end-to-end testing of response posting requires mock Git platform API

## Common Patterns

**Async Testing:**
```typescript
it('handles webhook execution', async () => {
    await useCase.execute(params);
    expect(mockService.execute).toHaveBeenCalled();
});

// Or with explicit done callback (older Jest pattern, not recommended):
it('old pattern', (done) => {
    useCase.execute(params).then(() => {
        expect(...).toBe(...);
        done();
    });
});
```

**Error Testing:**
```typescript
it('logs and handles missing integration config gracefully', async () => {
    codeManagementService.findTeamAndOrganizationIdByConfigKey.mockResolvedValue(null);

    await useCase.execute(params);

    // No error thrown, no response posted
    expect(conversationAgentUseCase.execute).not.toHaveBeenCalled();
});

// Explicit error expectation:
it('throws on LLM failure', async () => {
    conversationAgentUseCase.execute.mockRejectedValue(new Error('LLM timeout'));

    await expect(useCase.execute(params)).rejects.toThrow('LLM timeout');
});
```

**Mock spy on real method:**
```typescript
const spy = jest.spyOn(BaseAgentProvider.prototype as any, 'createLLMAdapter')
    .mockReturnValue({ call: jest.fn() });

// After test:
spy.mockRestore();
// Or in beforeEach/afterEach:
jest.restoreAllMocks();
```

## Webhook Controller Tests

**Pattern (from github.controller.spec.ts):**
- Test that handler is called with correct platform type
- Verify supported events are recognized
- Test action filtering (e.g., only `created` and `edited` actions for comments)
- Verify mention detection via `isKodyMentionNonReview()`
- Test branching logic (review commands vs conversation mentions)

**Example coverage:**
- ✅ Comment handling branches to `chatWithKodyFromGitUseCase.execute()`
- ✅ Start-review commands branch to code review job enqueueing
- ✅ Review marker detection prevents duplicate processing
- ⚠️ Duplicate webhook delivery handling not explicitly tested

## Known Test Gaps

**Coverage gaps in conversation flow:**

| Scenario | Status | Impact |
|----------|--------|--------|
| Duplicate webhook deliveries (same commentId redelivered) | ❌ No test | Could cause duplicate responses posted |
| LLM timeout with retry logic | ❌ No test | Timeout handling unclear if agent silently fails |
| Response posting fails after LLM succeeds | ⚠️ Partial | Some platform branching untested (Azure Repos edge cases) |
| Comment parsing for edge cases (deleted comments, empty replies) | ⚠️ Partial | Bitbucket replies parsing has minimal coverage |
| Memory bootstrap failure (KODUS_FIND_MEMORIES tool unavailable) | ✅ Covered | ConversationAgentProvider has try/catch with continue behavior |
| Custom instructions extraction from various payload locations | ⚠️ Partial | Only tested for standard locations, not all fallbacks |
| Thread ID generation collision (same user, same repo, multiple issues) | ✅ By design | Thread includes `issueId`, preventing collision |
| Reaction removal failure (platform API error) | ⚠️ Partial | Logged but silently continues (could hide real issues) |

**Recommendations for test expansion:**
1. Add parameterized tests for webhook delivery idempotency with comment ID tracking
2. Mock LLM provider timeouts and test fallback agent behavior
3. Implement stub Git API endpoints for integration tests to verify response posting contract
4. Add tests for all custom instruction extraction fallback paths
5. Test Bitbucket reply thread traversal with nested comment structures

---

*Testing analysis: 2026-04-29*
