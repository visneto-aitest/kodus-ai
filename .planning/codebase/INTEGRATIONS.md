# External Integrations - Kody PR Conversation Flow

**Analysis Date:** 2026-04-29

## Git Platform APIs & Webhooks

**GitHub:**
- **Webhook Events:** `pull_request`, `issue_comment`, `pull_request_review_comment`
  - Webhook handler: `GitHubPullRequestHandler` in `libs/platform/infrastructure/webhooks/github/githubPullRequest.handler.ts`
  - Action filter: created, edited (for comment events)
- **Comment API:**
  - POST: Create comment on PR via `GithubService.createIssueComment()`
  - PATCH: Update existing comment via `GithubService.updateIssueComment()`
  - POST: Create threaded reply via `createResponseToComment()`
  - POST: Add reactions (e.g., loading indicator) via `addReactionToComment()`
- **Auth:** GitHub App with OAuth or personal access token
  - Client: `@octokit/rest` with `@octokit/auth-app` for app-based auth
  - Retry + throttling plugins built-in

**GitLab:**
- **Webhook Events:** `note`, `note_edited` (for comment events on MRs)
  - Webhook handler: `gitlabPullRequest.handler.ts`
- **Comment API:**
  - POST: Create comment via `createIssueComment()`
  - PUT: Update comment via `updateIssueComment()`
- **Auth:** Personal access token or OAuth
  - Client: `@gitbeaker/rest`

**Bitbucket:**
- **Webhook Events:** `pullrequest:comment_created`, `pullrequest:comment_updated`
  - Webhook handler: `bitbucketPullRequest.handler.ts`
- **Comment API:**
  - POST: Create comment with parent_id for replies
  - PUT: Update comment
  - Supports inline (diff) comments and general comments
- **Auth:** OAuth app credentials
  - Client: `bitbucket` v2.12.0

**Azure DevOps (Repos):**
- **Webhook Events:** Thread creation/update in pull request discussions
  - Webhook handler: `azureReposPullRequest.handler.ts`
  - Comment payload: `resource.comment` with `threadId` and `parentCommentId`
- **Comment API:**
  - POST: Create comment (thread or reply)
  - PATCH: Update comment in thread
- **Auth:** PAT (Personal Access Token)
  - Client: `azure-devops-node-api`

**Forgejo:**
- **Webhook Events:** Similar to GitHub (Gitea-compatible)
  - Webhook handler: `forgejoPullRequest.handler.ts`
  - Auth: Personal access token
  - Client: `@llamaduck/forgejo-ts`

## Command Parsing

**Mention Detection:**
- Patterns defined in `libs/common/utils/codeManagement/codeCommentMarkers.ts`
- `KODY_START_REVIEW` regex: `/^\s*@kody\s+(start-review|review)(?=\s|$)/i`
- `KODY_MENTION_NON_REVIEW` regex: `/^\s*@kody\b(?!\s+(start-review|review)(?=\s|$))/i`
- Command types:
  - `@kody start-review` → triggers code review (not conversation)
  - `@kody -v business-logic` → business rules validation command
  - `@kody <anything else>` → general conversation

**Command Routing:**
- `ChatWithKodyFromGitUseCase` in `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts`
  - `CommandManager` routes to handlers based on message content
  - `BusinessLogicValidationCommandHandler` or `ConversationCommandHandler`

## LLM Providers

**Primary Conversation Model:**
- **Google Gemini 2.5 Pro** (default)
  - Model ID: `LLMModelProvider.GEMINI_2_5_PRO`
  - Client: `@ai-sdk/google`
  - Config: temperature=0, maxTokens=20000, maxReasoningTokens=800
  - Used by: `ConversationAgentProvider` in `libs/agents/infrastructure/services/kodus-flow/conversationAgent.ts`

**Fallback LLM Providers (BYOK support):**
- OpenAI GPT-4O (fallback provider)
- Anthropic Claude variants (via `@ai-sdk/anthropic`)
- Azure OpenAI (via `@ai-sdk/openai-compatible`)
- Google Vertex AI (via `@ai-sdk/google-vertex`)
- Amazon Bedrock (via `@ai-sdk/amazon-bedrock`)

**BYOK Configuration:**
- Fetched by `BaseAgentProvider.fetchBYOKConfig()` from `PermissionValidationService`
- Allows customers to use their own LLM API keys
- If BYOK configured, uses customer's provider + fallback provider

**LLM Abstraction Layer:**
- `PromptRunnerService` in `@kodus/kodus-common/llm` - unified interface for all providers
- Supports model switching via `LLMModelProvider` enum
- Token tracking via `BYOKPromptRunnerService` for billing

## Data Storage

**PostgreSQL (RelationalDB via TypeORM):**
- Migrations: `libs/core/infrastructure/database/typeorm/migrations/`
- Stores:
  - Organization & team metadata
  - Integration configurations (Git provider access tokens)
  - Team automation settings
  - User permissions & roles
- Connection string: `API_PG_DB_*` environment variables

**MongoDB (NoSQL via Mongoose):**
- Collections:
  - `pullRequestMessages` - PR message templates, conversation history
  - `codeReviewFeedback` - Comment reactions, feedback markers
  - Conversation memory/context for agents (via `@kodus/flow` storage)
- Connection string: `API_MONGODB_URL` or `API_DB_MONGODB_URL`

**Cache (in-memory or Redis):**
- `@nestjs/cache-manager` with Keyv backends
- Caches: repository data, integration configs, API responses
- TTL: 50 minutes for GitHub data (per `GithubService`)

## File Operations

**Git Clone & Local Checkout:**
- `git-clone` utility via params in `ChatWithKodyFromGitUseCase`
- Temporary local workspace for parsing PR diffs and context
- Parameters: `headRef`, `baseRef`, `repository.id`

**File Content API:**
- GitHub: `getContents()` via Octokit to fetch file diffs/content
- GitLab: `RepositoriesApi.getFile()` to fetch file content
- Used for context enrichment in agent prompts

## Conversation Context & Memory

**Thread Management:**
- `createThreadId()` from `@kodus/flow` - generates unique thread IDs
  - Format: `vbl_<orgId>_<teamId>_<repoId>_<userId>_<issueId>` for business logic validation
  - Format: `cmc_<orgId>_<teamId>_<repoId>_<userId>_<commentId>` for conversation
- Thread persists conversation state across multiple agent invocations

**Memory Bootstrap:**
- `conversationAgent.buildPromptWithMemoryBootstrap()` embeds org/team/repo context in initial prompt
- Payload includes organization ID, team ID, repository ID for memory lookups
- Agent can recall previous PR conversations via thread context

## External Tools via MCP (Model Context Protocol)

**MCP Manager:**
- `MCPManagerService` in `libs/mcp-server/services/mcp-manager.service.ts`
- Fetches available MCP server connections for organization/team
- `ConversationAgentProvider.createMCPAdapter()` wires tools to agent
- Timeout: 60 seconds per tool call, max 1 retry

**Tool Types Available (if configured):**
- Code search tools
- Repository query tools
- External API integrations (Jira, etc.)
- Custom business logic tools

## Authentication & Secrets Management

**Git Provider Tokens:**
- Stored encrypted in database (PostgreSQL)
- Encryption: `libs/common/utils/crypto` - encrypt/decrypt utilities
- Retrieved by `IntegrationService` and passed to platform-specific services
- Environment variable for private key (if used): in `.env` (git-ignored)

**LLM API Keys:**
- For BYOK: Stored per organization, encrypted
- For Kodus-managed: Configured via environment variables
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GOOGLE_API_KEY`
  - `AZURE_OPENAI_KEY`, `AZURE_OPENAI_ENDPOINT`
  - etc.

**GitHub App:**
- App ID, Private Key configured in `@octokit/auth-app`
- Installation tokens requested per organization
- Scope: Pull request comments, PR content read

## Webhooks & Event Flow

**Incoming Webhooks:**
- **GitHub:** POST `/webhooks/github` - receives push, PR, comment events
- **GitLab:** POST `/webhooks/gitlab` - receives MR, note events
- **Bitbucket:** POST `/webhooks/bitbucket` - receives PR, comment events
- **Azure:** POST `/webhooks/azure` - receives PR thread events
- **Forgejo:** POST `/webhooks/forgejo` - receives PR, comment events

**Webhook Dispatch Flow:**
1. Webhook enters `apps/webhooks` app (Express-based NestJS)
2. Validated by `IWebhookEventHandler.canHandle()` for platform/event type
3. Routed to platform-specific handler (e.g., `GitHubPullRequestHandler`)
4. If comment mentions `@kody`: `ChatWithKodyFromGitUseCase.execute()` queued
5. Agent processes comment → generates response
6. Response posted back via `CodeManagementService.createResponseToComment()`

**Outgoing Webhooks:**
- Post comment responses back to PR (GitHub, GitLab, Bitbucket, Azure)
- Add reactions (e.g., "eyes" for acknowledgment) where supported
- Update acknowledgment comment with final response

## Message Queue (RabbitMQ)

**Job Types Enqueued:**
- `enqueueCodeReviewJob()` - Async code review pipeline (not conversation, but related)
- `enqueueImplementationCheckUseCase()` - Implementation check on PR push
- `EnqueueAstGraphUpdateOnMergedUseCase()` - Update AST graph when PR merged

**For Conversation Flow:**
- Webhook events published to queue for async processing
- Worker app (`apps/worker`) consumes events
- Allows webhook responses to return immediately without blocking

## Observability & Telemetry

**Error Tracking (Sentry):**
- DSN: `SENTRY_DSN` environment variable
- Captures exceptions, logs structured metadata
- Sample rate: Configurable per environment

**Distributed Tracing (OpenTelemetry):**
- Exporter: OTLP HTTP endpoint
- Instruments: NestJS core, Pino logging, database queries
- Helps trace request flow from webhook to agent to Git API response

**LLM Observability (Langfuse):**
- `@langfuse/client` for new agents
- Tracks LLM calls, costs, latency
- Configured via `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY`

## Dry Run / Test Modes

**Dry Run Execution:**
- `CodeReviewPipelineContext['dryRun']` flag passed through agent execution
- When enabled: Agents generate responses but **do not post to Git**
- Used for testing webhook payloads without spamming PRs

## Rate Limiting & Throttling

**GitHub (Octokit):**
- Built-in retry plugin: exponential backoff up to 2 attempts
- Built-in throttling plugin: respects GitHub rate limits
- Secondary rate limit (abuse prevention): automatic backoff

**API Rate Limits per Platform:**
- GitHub: 60 req/hr (unauthenticated), 5000 req/hr (authenticated)
- GitLab: 600 req/min
- Bitbucket: Rate limits per IP/auth token
- Azure DevOps: 20000 req/hr (paid), 100 req/min (free)

---

*Integration audit: 2026-04-29*
