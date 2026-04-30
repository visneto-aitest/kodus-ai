# Coding Conventions

**Analysis Date:** 2026-04-29

## Naming Patterns

**Files:**
- PascalCase for service/provider classes: `ConversationAgentProvider.ts`, `ChatWithKodyFromGitUseCase.ts`
- camelCase for utility functions and filenames: `codeCommentMarkers.ts`, `webhook-context.service.ts`
- `.spec.ts` suffix for unit/integration tests colocated next to source
- `.integration.spec.ts` suffix for full integration tests in `/test/integration/`

**Functions:**
- Handlers prefixed with `handle`: `handleComment()`, `handleConversationFlow()`, `handleBusinessLogicFlow()`
- Private methods prefixed with `_` or kept private with access modifiers
- Boolean returns prefixed with `is` or `has`: `isRelevantAction()`, `hasKodyMarker()`, `mentionsKody()`
- Extraction/getter methods prefixed with `get`: `getRepository()`, `getCommentId()`, `getAcknowledgmentIds()`
- Detection methods prefixed with `detect`: `detectCommandType()`

**Variables:**
- camelCase for constants and variables: `organizationAndTeamData`, `pullRequestNumber`, `commentId`
- SCREAMING_SNAKE_CASE for true constants: `KODY_COMMANDS`, `ACKNOWLEDGMENT_MESSAGES`, `MAX_RETRY_ATTEMPTS`
- Enum keys in PascalCase with semantic names: `CommandType.BUSINESS_LOGIC_VALIDATION`, `CommandType.CONVERSATION`

**Types:**
- PascalCase for interfaces, types, entities: `IWebhookEventHandler`, `OrganizationAndTeamData`, `WebhookParams`
- Entity and DTO classes use PascalCase: `IntegrationConfigEntity`, `Comment`
- Type unions for payloads: `payload: any` (permissive in webhook handlers due to platform diversity)

## Code Style

**Formatting:**
- Prettier configuration: `tabWidth: 4`, `singleQuote: true`, `trailingComma: all`, `semi: true`
- Lines auto-formatted by Prettier—no manual style concerns needed
- Import statements organized with default Prettier grouping

**Linting:**
- ESLint config: `typescript-eslint` recommended rules, `eslint-config-prettier` for Prettier integration
- `eslint-plugin-unused-imports` enforces removing unused imports (set to `error`)
- `varsIgnorePattern: '^_'` allows unused variables/parameters prefixed with `_`
- No `@typescript-eslint/no-explicit-any` rule (set to `off`)—`any` is permissible in webhook handlers and service adapters

## Import Organization

**Order:**
1. External packages (`@kodus/flow`, `@nestjs/common`, third-party libraries)
2. Relative imports from `@libs/` (monorepo shared libraries)
3. Domain layer imports (contracts, entities, interfaces)
4. Infrastructure/adapter imports (services, repositories)
5. Application layer imports (use cases, DTOs)
6. Relative local imports (`./`)

**Path Aliases:**
- `@libs/` → Monorepo library roots (e.g., `@libs/agents/`, `@libs/platform/`)
- `@/` → Fallback mapping for domain imports in some modules (deprecated in favor of `@libs/`)
- No direct relative paths like `../../` in service files—use alias imports

**Example from webhook handler:**
```typescript
import { createLogger } from '@kodus/flow';                          // External
import { EnqueueAstGraphUpdateOnMergedUseCase } from '@libs/code-review/application/use-cases/...';  // @libs
import { ChatWithKodyFromGitUseCase } from '@libs/platform/application/use-cases/...';
import { IWebhookEventHandler, ... } from '@libs/platform/domain/...';
import { SavePullRequestUseCase } from '@libs/platformData/application/use-cases/...';
import { Injectable, Optional } from '@nestjs/common';              // Decorators last
```

## Error Handling

**Patterns:**
- Top-level try-catch in use cases with typed error messages
- Use `error instanceof Error ? error.message : String(error)` pattern for error coercion
- Catch blocks log error + metadata using structured logger, then re-throw or return gracefully
- No silent failures—all errors logged with context (`organization`, `repository`, `prNumber`, etc.)

**From `ChatWithKodyFromGitUseCase.execute()`:**
```typescript
try {
    if (!this.isRelevantAction(params)) {
        return;  // Early return for non-relevant actions (not an error)
    }
    // Process flow
} catch (error) {
    this.logger.error({
        message: 'Error while executing the git comment response agent',
        context: ChatWithKodyFromGitUseCase.name,
        serviceName: ChatWithKodyFromGitUseCase.name,
        error,  // Full error object
    });
    // Silently complete webhook (do NOT throw—webhooks should not fail loudly)
}
```

**Failure modes in conversation flow:**
- Missing integration config → log warning, return early (no comment posted)
- Failed acknowledgment comment creation → log warning, return early (stops response flow)
- LLM execution timeout/failure → caught in agent provider, error logged and re-thrown

## Logging

**Framework:** `@kodus/flow` `createLogger(ClassName.name)`

**Structured logging pattern:**
```typescript
this.logger.log({
    message: 'Human-readable action description',
    context: ClassName.name,                    // Required: service/class name
    serviceName: ClassName.name,                // Duplicate context for backwards compat
    metadata: {
        // Platform-specific IDs
        prNumber,
        repositoryId: repository.id,
        repositoryName: repository.name,
        organizationId,
        teamId,
        // Execution tracking
        commentId,
        responseId,
        // Platform variant tracking
        platformType,
    },
});
```

**Log levels:**
- `log()` for successful operations and flow transitions
- `warn()` for degraded paths (e.g., no integration config, missing comment)
- `error()` for exceptions; always include `error` field
- `debug()` for event parsing/skip conditions (less commonly used)

**When NOT to log:**
- Successful webhook skip conditions (use early return without logging—too noisy)
- Deleted comments or irrelevant events (single `debug` statement if needed)

**Observability metadata:**
- Correlation IDs passed through thread IDs: `createThreadId({ organizationId, teamId, repositoryId, userId, issueId }, { prefix: 'vbl' })`
- Thread prefixes: `'vbl'` for business logic validation, `'cmc'` for conversation mentions
- All LLM calls tracked via `ObservabilityService.runLLMInSpan()` with span names like `ConversationalAgent::conversationAgent`

## Comments

**When to Comment:**
- Complex platform-specific payload extraction (e.g., Azure Repos threadId parsing)
- Non-obvious domain rules (e.g., business logic validation only works in general conversation, not inline comments)
- TODO/FIXME for known limitations
- Do NOT comment obvious code (e.g., `// Get the comment ID`)

**JSDoc/TSDoc:**
- Used on public methods and exported functions
- Required for use case `.execute()` methods to document context parameter shape
- Example from webhook handler:
  ```typescript
  /**
   * Handler for GitHub webhook events.
   * Processes both pull request and comment events.
   */
  @Injectable()
  export class GitHubPullRequestHandler implements IWebhookEventHandler { ... }
  ```

## Function Design

**Size:** Aim for functions under 30 lines; break into private helpers for platform branching logic

**Parameters:**
- Webhook handlers accept `IWebhookEventParams` (platform-agnostic interface)
- Use cases accept a context object with named fields (not destructured in signature)
- Platform-specific extraction methods take `WebhookParams` and `PlatformType` as parameters

**Return Values:**
- Webhook handlers return `Promise<void>` (fire-and-forget)
- Use cases return typed objects (strings for agent responses, entities for queries)
- Platform extractors return specific types (e.g., `Repository`, `Comment`, `Sender`)
- Guard clauses return early with no value to indicate non-processing

**From command pattern in `ChatWithKodyFromGitUseCase`:**
```typescript
private async processCommand(
    commandType: CommandType,
    context: { prepareContext: any; organizationAndTeamData: OrganizationAndTeamData; thread: any },
): Promise<string> {
    switch (commandType) {
        case CommandType.BUSINESS_LOGIC_VALIDATION:
            return await this.handleBusinessLogicValidation(context);
        case CommandType.CONVERSATION:
            return await this.handleConversation(context);
        default:
            return await this.handleConversation(context);  // Fallback to conversation
    }
}
```

## Module Design

**Exports:**
- Use named exports for services, use cases, handlers
- Barrel files (`index.ts`) export public API of a domain folder
- Avoid default exports—use named exports for tree-shaking clarity

**Barrel Files:**
- Located at domain/module root: `libs/agents/application/use-cases/index.ts`
- Export all public use cases by name
- Pattern:
  ```typescript
  export { ConversationAgentUseCase } from './conversation-agent.use-case';
  export { BusinessRulesValidationAgentUseCase } from './business-rules-validation-agent.use-case';
  ```

## Mention/Command Parsing

**Markers and Constants:**
- Command constants in `KODY_COMMANDS` object: `'@kody'`, `'@kody -v business-logic'`, `'@kodus'`
- Login identifiers in `KODY_IDENTIFIERS.LOGIN_KEYWORDS`: `['kody', 'kodus']`
- Markdown markers in `KODY_IDENTIFIERS.MARKDOWN_IDENTIFIERS`: `'kody-codereview'` (GitHub/GitLab), `'kody|code-review'` (Bitbucket)
- Utility functions in `codeCommentMarkers.ts`: `isKodyMentionNonReview()`, `isReviewCommand()`, `hasReviewMarker()`

**Pattern matching:**
- `KODY_MENTION_NON_REVIEW_PATTERN = /^\s*@kody\b(?!\s+(start-review|review)(?=\s|$))/i` — matches `@kody` without review commands
- Case-insensitive matching throughout
- Lookahead assertions prevent matching substrings (e.g., "review-code" is not a review command)

**Command dispatch:**
- `CommandManager` class encapsulates handler chain pattern
- Three handlers: `BusinessLogicValidationCommandHandler`, `ConversationCommandHandler`, `UnknownHandler`
- Highest-priority validation happens first (business logic with `-v` flag)
- Context-aware validation: business logic only valid in general PR conversation, not inline comments

## Conversation Context Preparation

**Pattern (from `prepareContext()`):**
- User question extracted from comment body
- If user only typed `@kody`, replace with prompt asking what they want to know
- Bundle together:
  - `userQuestion`: the actual request
  - `repository`: {name, id, defaultBranch}
  - `pullRequest`: {pullRequestNumber, headRef, baseRef}
  - `pullRequestDescription`: PR body for context
  - `codeManagementContext`: {originalComment, othersReplies, suggestionFilePath, diffHunk}
  - `platformType`: for response formatting
  - `customInstructions`: extracted from webhook payload

**Memory bootstrap in `ConversationAgentProvider`:**
- Before LLM call, inject mandatory `KODUS_FIND_MEMORIES` tool call
- Memory payload includes: `organizationId`, `teamId`, optional `repositoryId`, limit of 20
- Memories treated as high-priority constraints in LLM reasoning
- If tool fails, agent continues normally

## Response Posting

**Acknowledgment strategy:**
- Some platforms (GitHub) support emoji reactions—add reaction immediately, remove after response posted
- Other platforms (GitLab, Azure Repos) post acknowledgment comment first
- Bitbucket uses `createResponseToComment` with `inReplyToId` for threading
- All responses wrapped with markdown identifier to detect future Kody responses

**Platform response policies:**
- `PlatformResponsePolicyFactory.create(PlatformType)` returns platform-specific behavior
- Encapsulates: reaction emoji, acknowledgment message, whether to use reactions vs comments
- Used in both business logic and conversation flows

## Thread ID Generation

**Pattern:**
```typescript
const thread = createThreadId(
    {
        organizationId: organizationAndTeamData.organizationId,
        teamId: organizationAndTeamData.teamId,
        repositoryId: repository.id,
        userId: sender.id,
        issueId,  // For business logic
        suggestionCommentId: originalKodyComment?.id || comment?.id,  // For conversation
    },
    { prefix: 'vbl' }  // or 'cmc' for conversation
);
```

- Uniqueness guarantees conversation continuity across replies
- Prefix enables conversation type discrimination in observability
- Used as kodus-flow `thread` parameter for multi-turn context preservation

---

*Convention analysis: 2026-04-29*
