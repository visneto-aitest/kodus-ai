# Kody PR Conversation Flow - Directory Structure

**Analysis Date:** 2026-04-29

## Directory Layout (Conversation Flow)

```
/apps
├── webhooks/src/controllers/                  # HTTP entry points
│   ├── github.controller.ts                   # POST /github/webhook
│   ├── gitlab.controller.ts                   # POST /gitlab/webhook
│   ├── bitbucket.controller.ts                # POST /bitbucket/webhook
│   ├── azureRepos.controller.ts               # POST /azure/webhook
│   └── forgejo.controller.ts                  # POST /forgejo/webhook
│
└── api/src/                                   # Main API server (if needed)
    └── controllers/
        └── webhook-health.controller.ts       # Health check endpoint

/libs
├── platform/                                  # Platform integration layer
│   ├── application/use-cases/
│   │   ├── webhook/
│   │   │   └── enqueue-webhook.use-case.ts   # Queue dispatcher
│   │   │
│   │   ├── codeManagement/
│   │   │   ├── chatWithKodyFromGit.use-case.ts      # Main conversation routing
│   │   │   ├── chatWithKodyFromGit.use-case.spec.ts # Tests
│   │   │   ├── policies/
│   │   │   │   └── platform-response.policy.ts      # Acknowledgment strategies
│   │   │   │
│   │   │   ├── create-prs-code-review.use-case.ts   # Code review trigger
│   │   │   ├── trigger-business-validation.use-case.ts
│   │   │   └── [other code management use cases]
│   │   │
│   │   └── services/
│   │       └── webhook-context.service.ts    # Integration config retrieval
│   │
│   ├── infrastructure/
│   │   ├── webhooks/
│   │   │   ├── github/
│   │   │   │   └── githubPullRequest.handler.ts      # Event routing → conversation/review
│   │   │   ├── gitlab/
│   │   │   │   └── gitlabPullRequest.handler.ts
│   │   │   ├── bitbucket/
│   │   │   │   └── bitbucketPullRequest.handler.ts
│   │   │   ├── azure/
│   │   │   │   └── azureReposPullRequest.handler.ts
│   │   │   ├── forgejo/
│   │   │   │   └── forgejoPullRequest.handler.ts
│   │   │   └── [shared utilities]
│   │   │
│   │   └── adapters/services/
│   │       └── codeManagement.service.ts     # Platform-agnostic API abstraction
│   │
│   ├── domain/
│   │   ├── platformIntegrations/interfaces/
│   │   │   └── webhook-event-handler.interface.ts    # IWebhookEventHandler contract
│   │   └── [platform-specific domain models]
│   │
│   └── modules/
│       └── platform.module.ts                # NestJS module definitions
│
├── agents/                                   # Agent execution layer
│   ├── application/use-cases/
│   │   ├── conversation-agent.use-case.ts    # Thin wrapper
│   │   ├── business-rules-validation-agent.use-case.ts
│   │   └── [other agent use cases]
│   │
│   ├── infrastructure/services/
│   │   ├── kodus-flow/
│   │   │   ├── conversationAgent.ts          # Kodus Flow orchestration
│   │   │   ├── base-agent.provider.ts        # Common LLM setup
│   │   │   ├── business-rules-validation/
│   │   │   │   ├── businessRulesValidationAgent.ts
│   │   │   │   └── types.ts
│   │   │   └── [other agent providers]
│   │   │
│   │   └── [other services]
│   │
│   ├── skills/                               # MCP tool implementations
│   │   └── [skills referenced by orchestration]
│   │
│   └── modules/
│       └── agents.module.ts
│
├── core/
│   ├── workflow/
│   │   ├── infrastructure/
│   │   │   ├── job-processor-router.service.ts       # Job dispatcher (WEBHOOK_PROCESSING → WebhookProcessingJobProcessorService)
│   │   │   ├── workflow-job-queue.service.ts         # RabbitMQ abstraction
│   │   │   ├── workflow-job-consumer.service.ts      # Queue consumer
│   │   │   └── repositories/
│   │   │       └── workflow-job.repository.ts        # Job persistence
│   │   │
│   │   ├── domain/
│   │   │   ├── contracts/
│   │   │   │   ├── job-queue.service.contract.ts     # IJobQueueService interface
│   │   │   │   ├── job-processor.service.contract.ts # IJobProcessorService interface
│   │   │   │   └── job-processor-router.contract.ts
│   │   │   │
│   │   │   ├── enums/
│   │   │   │   ├── workflow-type.enum.ts             # WEBHOOK_PROCESSING, CODE_REVIEW, etc.
│   │   │   │   ├── handler-type.enum.ts              # WEBHOOK_RAW, PIPELINE_SYNC, etc.
│   │   │   │   ├── job-status.enum.ts                # PENDING, PROCESSING, COMPLETED, FAILED
│   │   │   │   └── error-classification.enum.ts      # RETRYABLE, PERMANENT
│   │   │   │
│   │   │   └── [other domain contracts]
│   │   │
│   │   └── application/use-cases/
│   │       └── enqueue-code-review-job.use-case.ts
│   │
│   ├── domain/
│   │   ├── enums/
│   │   │   ├── platform-type.enum.ts          # GITHUB, GITLAB, BITBUCKET, AZURE_REPOS, FORGEJO
│   │   │   └── [other enums]
│   │   │
│   │   ├── events/
│   │   │   └── pull-request-closed.event.ts
│   │   │
│   │   └── interfaces/
│   │       └── use-case.interface.ts          # IUseCase contract
│   │
│   └── infrastructure/
│       ├── config/types/
│       │   └── general/
│       │       └── organizationAndTeamData.ts # { organizationId, teamId }
│       │
│       └── services/
│           └── tokenTracking/
│               └── byokPromptRunner.service.ts
│
├── automation/                                # Webhook processor jobs
│   └── webhook-processing/
│       └── webhook-processing-job.processor.ts    # WEBHOOK_PROCESSING job handler
│
├── code-review/                               # Code review pipeline (shared infrastructure)
│   ├── domain/
│   │   ├── codeReviewFeedback/
│   │   │   └── enums/
│   │   │       └── codeReviewCommentReaction.enum.ts # GitHubReaction enum
│   │   │
│   │   ├── pullRequestMessages/
│   │   │   └── [domain models for PR messages]
│   │   │
│   │   └── [other code-review domain]
│   │
│   ├── pipeline/
│   │   ├── stages/
│   │   │   └── [code review pipeline stages - NOT used by conversation]
│   │   │
│   │   └── [code review pipeline services]
│   │
│   ├── application/use-cases/
│   │   ├── enqueue-code-review-job.use-case.ts      # Used by handlers to trigger review
│   │   ├── enqueue-implementation-check.use-case.ts
│   │   ├── enqueue-ast-graph-update-on-merged.use-case.ts
│   │   ├── generateIssuesFromPrClosed.use-case.ts
│   │   │
│   │   ├── codeReviewFeedback/
│   │   │   └── [feedback-related use cases]
│   │   │
│   │   └── pullRequestMessages/
│   │       └── [message-related use cases]
│   │
│   ├── workflow/
│   │   ├── code-review-job-processor.service.ts     # CODE_REVIEW job handler (separate from conversation)
│   │   └── [other workflow processors]
│   │
│   └── infrastructure/
│       └── services/
│           └── codeManagement.service.ts            # [Duplicate? References platform's codeManagement service]
│
├── platformData/
│   ├── application/use-cases/
│   │   └── pullRequests/
│   │       └── save.use-case.ts               # SavePullRequestUseCase
│   │
│   ├── domain/pullRequests/
│   │   └── [PR domain models]
│   │
│   └── infrastructure/
│       └── [PR data persistence]
│
├── integrations/
│   ├── domain/
│   │   └── integrationConfigs/entities/
│   │       └── integration-config.entity.ts   # Config for org/team/repo
│   │
│   └── [integration services]
│
├── common/
│   └── utils/
│       ├── codeManagement/
│       │   └── codeCommentMarkers.ts          # isReviewCommand(), hasReviewMarker(), isKodyMentionNonReview()
│       │
│       └── webhooks/
│           └── [shared webhook utilities]
│
├── identity/
│   └── infrastructure/
│       └── adapters/services/auth/
│           └── public.decorator.ts            # @Public() for unauthenticated webhook routes
│
├── organization/
│   └── domain/parameters/
│       └── contracts/
│           └── parameters.service.contract.ts # Language/config retrieval
│
├── ee/
│   └── shared/services/
│       ├── permissionValidation.service.ts    # BYOK config, permission checks
│       └── [EE features]
│
├── mcp-server/
│   └── services/
│       └── mcp-manager.service.ts             # MCP connections for org/team
│
└── core/log/
    └── observability.service.ts               # Tracing, span creation, LLM tracking
```

## Directory Purposes

**`apps/webhooks/src/controllers/`:**
- Purpose: HTTP entry points for platform webhooks
- Contains: NestJS controller classes for each platform
- Key files: `github.controller.ts`, `gitlab.controller.ts`, `bitbucket.controller.ts`, `azureRepos.controller.ts`, `forgejo.controller.ts`
- Pattern: Each controller listens on POST `/platform/webhook`, validates event type, returns HTTP 200 immediately, then enqueues via `setImmediate()`
- Key decision: Fire-and-forget via `setImmediate()` rather than awaiting job queue

**`libs/platform/application/use-cases/webhook/`:**
- Purpose: Enqueue raw webhook to job queue
- Contains: `enqueue-webhook.use-case.ts` (normalizes platform type, generates correlation ID, persists to queue)
- Queue binding: Creates `WorkflowType.WEBHOOK_PROCESSING` job with `HandlerType.WEBHOOK_RAW`

**`libs/platform/application/use-cases/codeManagement/`:**
- Purpose: Main conversation routing and context assembly
- Key file: `chatWithKodyFromGit.use-case.ts` (650+ lines)
  - `isRelevantAction()` - filter by action (created, edited)
  - `detectCommandType()` - parse `@kody`, `@kody -v business-logic`, etc.
  - `handleConversationFlow()` - 3-way flow: acknowledgment → agent → response posting
  - `handleBusinessLogicFlow()` - business rules validation agent
  - `handleBusinessLogicInvalidContextFlow()` - error message
  - `prepareContext()` - assemble prompt context from PR, comments, thread
  - Platform-specific extraction methods: `getRepository()`, `getPullRequestNumber()`, `getCommentId()`, etc. (one per platform)
- Contains: `CommandManager`, command handlers, platform-specific parsers
- Policy file: `platform-response.policy.ts` (acknowledgment strategies)

**`libs/platform/infrastructure/webhooks/{platform}/`:**
- Purpose: Platform-specific event handling
- Key file: `pullRequest.handler.ts` per platform
  - `canHandle()` - filter supported events
  - `execute()` - dispatch to `handlePullRequest()` or `handleComment()`
  - `handlePullRequest()` - save PR, enqueue code-review jobs, emit events
  - `handleComment()` - detect start-review vs. conversation vs. non-relevant; route to appropriate flow
- Pattern: Each handler implements `IWebhookEventHandler` interface
- Fire-and-forget: `ChatWithKodyFromGitUseCase.execute(params)` is called without await

**`libs/platform/infrastructure/adapters/services/codeManagement.service.ts`:**
- Purpose: Platform-agnostic API for PR operations
- Contains: Delegating methods that route to platform-specific implementations
- Methods used in conversation flow:
  - `getPullRequestReviewComment()` - fetch comments
  - `createIssueComment()` - post comment
  - `updateIssueComment()` - edit comment
  - `createResponseToComment()` - reply in thread
  - `updateResponseToComment()` - update reply
  - `addReactionToComment()` / `removeReactionsFromComment()` - emoji reactions
- Uses: `platformIntegrationFactory.getCodeManagementService(type)` to delegate

**`libs/agents/application/use-cases/`:**
- Purpose: Thin wrappers around agent providers
- Key files:
  - `conversation-agent.use-case.ts` - delegates to `ConversationAgentProvider`
  - `business-rules-validation-agent.use-case.ts` - delegates to `BusinessRulesValidationAgentProvider`
- Pattern: Error handling, contract consistency

**`libs/agents/infrastructure/services/kodus-flow/`:**
- Purpose: Kodus Flow orchestration setup and execution
- Key files:
  - `conversationAgent.ts` - orchestrates conversation agent
    - `createMCPAdapter()` - loads MCP servers from org config
    - `initialize()` - sets up orchestration, registers tools
    - `execute()` - calls agent with memory bootstrap
    - `buildPromptWithMemoryBootstrap()` - injects KODUS_FIND_MEMORIES tool call
  - `base-agent.provider.ts` - common LLM setup
    - `fetchBYOKConfig()` - retrieves custom LLM keys
    - `createLLMAdapter()` - wraps LLM with observability, BYOK support
- Pattern: Each agent provider extends `BaseAgentProvider`

**`libs/core/workflow/`:**
- Purpose: Job queue and processor routing
- Key files:
  - `job-processor-router.service.ts` - routes jobs by workflow type
    - Maps `WorkflowType.WEBHOOK_PROCESSING` → `WebhookProcessingJobProcessorService`
    - Applies timeout (10 minutes for webhook processing)
  - `workflow-job-queue.service.ts` - RabbitMQ abstraction
  - `workflow-job-consumer.service.ts` - consumer loop that picks up jobs
- Contracts: `IJobQueueService`, `IJobProcessorService`, `IWorkflowJobRepository`

**`libs/automation/webhook-processing/`:**
- Purpose: Process WEBHOOK_PROCESSING jobs
- Key file: `webhook-processing-job.processor.ts`
  - Fetches job from repository
  - Gets handler from map: `PlatformType` → platform handler
  - Calls `handler.execute()` (which dispatches to conversation/review flows)
  - Marks job COMPLETED or FAILED

**`libs/core/domain/enums/`:**
- Purpose: Enum definitions
- Key files:
  - `platform-type.enum.ts` - GITHUB, GITLAB, BITBUCKET, AZURE_REPOS, FORGEJO
  - Other files in `core/workflow/domain/enums/`:
    - `workflow-type.enum.ts` - WEBHOOK_PROCESSING, CODE_REVIEW, etc.
    - `handler-type.enum.ts` - WEBHOOK_RAW, PIPELINE_SYNC, etc.
    - `job-status.enum.ts` - PENDING, PROCESSING, COMPLETED, FAILED
    - `error-classification.enum.ts` - RETRYABLE, PERMANENT

**`libs/core/infrastructure/config/types/`:**
- Purpose: Type definitions for configuration
- Key file: `organizationAndTeamData.ts` - `{ organizationId, teamId }`
- Used throughout: passed to agent, integration lookup, etc.

**`libs/common/utils/codeManagement/`:**
- Purpose: Shared utilities for comment parsing
- Key file: `codeCommentMarkers.ts`
  - `isReviewCommand()` - detects `@kody start-review`
  - `hasReviewMarker()` - checks for `<!-- kody-codereview -->`
  - `isKodyMentionNonReview()` - detects `@kody` mention without review marker

## Key File Locations

**Entry Points:**
- `apps/webhooks/src/controllers/{github,gitlab,bitbucket,azureRepos,forgejo}.controller.ts` - HTTP POST handlers
- `apps/api/src/controllers/webhook-health.controller.ts` - health check

**Configuration:**
- `libs/platform/modules/platform.module.ts` - NestJS provider/service registration
- `libs/agents/modules/agents.module.ts` - agent provider registration
- `libs/core/workflow/domain/contracts/` - service contracts (interfaces)

**Core Logic:**
- `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts` - main conversation orchestration
- `libs/platform/infrastructure/webhooks/{platform}/pullRequest.handler.ts` - event routing
- `libs/agents/infrastructure/services/kodus-flow/conversationAgent.ts` - agent execution

**Testing:**
- `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.spec.ts`
- Integration tests in `test/integration/agents/chat-with-kody-business-logic.integration.spec.ts`
- Unit tests in `test/unit/web/mcp-mentions.spec.ts`

## Naming Conventions

**Files:**
- Controllers: `{platform}.controller.ts` (e.g., `github.controller.ts`)
- Handlers: `{platform}PullRequest.handler.ts` (e.g., `githubPullRequest.handler.ts`)
- Use Cases: `{feature}-{action}.use-case.ts` (e.g., `chatWithKodyFromGit.use-case.ts`, `enqueue-webhook.use-case.ts`)
- Services: `{name}.service.ts` (e.g., `codeManagement.service.ts`, `webhook-context.service.ts`)
- Providers: `{name}.provider.ts` (e.g., `conversationAgent.ts` is a provider but named without "provider" suffix)
- Policies: `{name}.policy.ts` (e.g., `platform-response.policy.ts`)
- Tests: `{name}.spec.ts` (e.g., `chatWithKodyFromGit.use-case.spec.ts`)
- Enums: `{name}.enum.ts` (e.g., `platform-type.enum.ts`)
- Interfaces: `{name}.interface.ts` (e.g., `webhook-event-handler.interface.ts`)
- Entities: `{name}.entity.ts` (e.g., `integration-config.entity.ts`)

**Directories:**
- Handlers: `infrastructure/webhooks/{platform}/` (lowercase platform name)
- Use Cases: `application/use-cases/{feature}/` (feature grouped by domain)
- Services: `infrastructure/adapters/services/` or `infrastructure/services/`
- Providers: `infrastructure/services/kodus-flow/` (agent providers)
- Policies: alongside use cases in same directory or `policies/` subdirectory

## Where to Add New Code

**New Conversation Command (e.g., `@kody -v custom-check`):**
1. Add enum variant: `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts` line ~35 in `CommandType`
2. Create handler class: inherit `CommandHandler` interface, implement `canHandle()` and `getCommandType()`
3. Register handler: add to `CommandManager.handlers` array (~line 88)
4. Add dispatch case: in `processCommand()` method (~line 1782)
5. Create agent use case (if new): `libs/agents/application/use-cases/{name}-agent.use-case.ts`
6. Create agent provider: `libs/agents/infrastructure/services/kodus-flow/{name}Agent.ts`
7. Add tests: `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.spec.ts`

**New Platform Support (e.g., Gitea):**
1. Add enum: `libs/core/domain/enums/platform-type.enum.ts`
2. Create controller: `apps/webhooks/src/controllers/gitea.controller.ts` (follows GitHub pattern)
3. Create handler: `libs/platform/infrastructure/webhooks/gitea/giteaPullRequest.handler.ts` (implements `IWebhookEventHandler`)
4. Create platform service: implement comment/PR mapping via `platformIntegrationFactory`
5. Register handler: `libs/automation/webhook-processing/webhook-processing-job.processor.ts` (add to `webhookHandlersMap`)
6. Add response policy: `libs/platform/application/use-cases/codeManagement/policies/platform-response.policy.ts` (add case)
7. Add comment markers: `libs/common/utils/codeManagement/codeCommentMarkers.ts` if custom logic needed

**New Agent (e.g., Code Quality Agent):**
1. Create use case: `libs/agents/application/use-cases/code-quality-agent.use-case.ts`
2. Create provider: `libs/agents/infrastructure/services/kodus-flow/codeQualityAgent.ts` (extends `BaseAgentProvider`)
3. Register in NestJS module: `libs/agents/modules/agents.module.ts`
4. Add command handler: `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts` (new `CommandHandler` class)
5. Add dispatch case: `processCommand()` method in same file
6. Add tests: same pattern as conversation agent tests

**Utility Functions:**
- Platform-agnostic utilities: `libs/common/utils/` (e.g., comment parsing, webhook utilities)
- Platform-specific utilities: `libs/platform/infrastructure/adapters/` or `libs/platform/domain/`
- Agent-related utilities: `libs/agents/infrastructure/services/` or `libs/agents/skills/`

## Special Directories

**`libs/core/workflow/`:**
- Purpose: Job queue abstraction and workflow orchestration
- Generated: No
- Committed: Yes
- Used by: Multiple workflows (webhook processing, code review, implementation check, AST graph)
- Conversation flow dependency: Job enqueue and processor routing (WEBHOOK_PROCESSING jobs)

**`libs/platform/infrastructure/webhooks/`:**
- Purpose: Platform-specific webhook handlers
- Generated: No
- Committed: Yes
- Pattern: One handler per platform (GitHub, GitLab, Bitbucket, Azure, Forgejo)
- Fires-and-forgets conversation use case: `this.chatWithKodyFromGitUseCase.execute(params);` (no await)

**`libs/agents/skills/`:**
- Purpose: MCP tool implementations
- Generated: Partially (some may be auto-registered)
- Committed: Yes
- Used by: Kodus Flow orchestration when agent calls tools (e.g., code search, memory lookup)

---

*Structure analysis: 2026-04-29*
