# Technology Stack - Kody PR Conversation Flow

**Analysis Date:** 2026-04-29

## Languages

**Primary:**
- TypeScript - NestJS backend, conversation agents, webhook handlers, LLM integrations
- JavaScript/Node.js - Runtime for backend services and CLI utilities

## Runtime

**Environment:**
- Node.js (LTS compatible) - Powers API, Webhooks, Worker apps, and agents
- Docker Compose - Local development orchestration

**Package Manager:**
- Yarn - Monorepo management with workspaces
- Lockfile: `yarn.lock` (present)

## Frameworks & Core Services

**Backend Framework:**
- NestJS v11.1.19 - REST API, webhook handlers, dependency injection
  - `@nestjs/platform-express` - HTTP server
  - `@nestjs/config` - Configuration management
  - `@nestjs/event-emitter` - Event-driven architecture for webhook events

**Agent & LLM Framework:**
- `@kodus/flow` v0.1.50 - Custom agent orchestration framework for conversation flow
  - Provides `createOrchestration`, `createMCPAdapter`, thread management, planner (REACT pattern)
  - Used by `ConversationAgentProvider` in `libs/agents/infrastructure/services/kodus-flow/conversationAgent.ts`

**LLM Clients:**
- `@ai-sdk/*` family (multiple providers) - Unified AI SDK adapter
  - `@ai-sdk/anthropic` v3.0.71
  - `@ai-sdk/openai` v3.0.53
  - `@ai-sdk/google` - Gemini support
  - `@ai-sdk/google-vertex` - Google Vertex AI

- `@kodus/kodus-common` v1.3.18 - Internal LLM abstraction layer
  - `PromptRunnerService` - Unified prompt execution across providers
  - `LLMModelProvider` enum - Model selection (GEMINI_2_5_PRO default for conversation)
  - BYOK (Bring Your Own Key) support for customer LLM keys

- LangChain (legacy support, being phased out):
  - `@langchain/openai` 1.4.5
  - `@langchain/anthropic` 1.3.28
  - `@langchain/google-vertexai` 2.1.29
  - `@langchain/community` 1.1.27
  - `@langchain/core` 1.1.42

**MCP (Model Context Protocol):**
- `@modelcontextprotocol/sdk` v1.29.0 - Server implementations for tools
  - Managed by `MCPManagerService` for conversation agent
  - Allows LLM to call external tools via standard protocol

## Databases

**SQL (PostgreSQL):**
- `typeorm` v0.3.28 - ORM for relational data
- `@nestjs/typeorm` v11.0.1 - NestJS integration
- Stores: organization, team, integration configs, pull request metadata

**NoSQL (MongoDB):**
- `mongoose` v9.6.0 - MongoDB ODM
- `@nestjs/mongoose` v11.0.4 - NestJS integration
- `mongoose-paginate` v5.0.3 - Pagination utility
- Stores: PR messages, conversation history, code review feedback

## Message Queue & Async

**RabbitMQ:**
- `@golevelup/nestjs-rabbitmq` v9.0.0 - Event publishing/subscribing
- `amqplib` v1.0.3 - AMQP client library
- Used for: enqueuing code review jobs, webhook event distribution

**Cache:**
- `@nestjs/cache-manager` v3.1.2 - Cache abstraction
- `cache-manager` v7.2.8 - Backend-agnostic caching
- `keyv` v5.6.0 - Key-value storage

## Git Provider Integrations

**SDKs for PR comment APIs:**
- `@octokit/rest` v22.0.1 - GitHub REST API
  - Plugins: `retry`, `throttling`, `enterprise-server` support
  - `@octokit/auth-app` v8.1.2 - GitHub App authentication
  - `graphql` - GraphQL queries via `@octokit/graphql`

- `@gitbeaker/rest` v43.8.0 - GitLab REST API client

- `bitbucket` v2.12.0 - Bitbucket Cloud API client

- `azure-devops-node-api` v15.1.2 - Azure DevOps/Repos API

- `@llamaduck/forgejo-ts` v14.0.2-4 - Forgejo API client

## Observability & Logging

**Logging:**
- `@kodus/flow` - `createLogger` utility for structured logging
- Logs aggregated to Sentry and OpenTelemetry backends

**Error Tracking:**
- `@sentry/nestjs` v10.50.0 - Sentry integration
- `@sentry/node` v10.50.0
- `@sentry/opentelemetry` v10.50.0

**Tracing & Metrics:**
- `@opentelemetry/*` v0.215.0+ - OpenTelemetry instrumentation
  - `@opentelemetry/sdk-trace-node` - Node.js tracing
  - `@opentelemetry/instrumentation-nestjs-core` - NestJS tracing
  - `@opentelemetry/exporter-trace-otlp-http` - Export traces to OTLP collector

- `@pyroscope/nodejs` v0.4.11 - Continuous profiling
- `@langfuse/langchain` v5.2.0 - LLM observability for LangChain (legacy)
- `@langfuse/client` - Direct Langfuse instrumentation for new agents

## Utilities

**Core:**
- `class-validator` v0.15.1 - DTO validation
- `class-transformer` v0.5.1 - DTO transformation
- `joi` v18.1.2 - Schema validation

**HTTP:**
- `axios` v1.15.2 - HTTP client (used by Git provider services)
- `@nestjs/axios` v4.0.1 - Axios integration
- `express-rate-limit` v8.4.1 - Rate limiting middleware
- `helmet` v8.1.0 - Security headers

**Data Processing:**
- `diff` v9.0.0 - Diff generation for code changes
- `fast-xml-parser` v5.7.2 - XML parsing (for Git webhooks)
- `js-yaml` v4.1.1 - YAML parsing

**Time & Date:**
- `date-fns` v4.1.0 - Date utilities
- `moment-timezone` v0.6.2 - Timezone handling
- `moment` v2.30.1 - Datetime parsing

**IDs & Crypto:**
- `uuid` - UUID generation
- `nanoid` v5.1.9 - Unique ID generation
- `bcryptjs` v3.0.3 - Password hashing (if used for auth)

## Build & Development

**TypeScript:**
- `typescript` - Strict mode enabled
- `ts-node` - TS execution

**Linting & Formatting:**
- ESLint with TypeScript support
- Prettier v3.x (configured via `.prettierrc` - user disabled Agent(Explore); use grep/Read)

**Testing:**
- Jest - Unit/integration tests
- `jest.config.ts` - Test configuration

## Configuration

**Environment:**
- `.env` files (git-ignored) contain:
  - LLM API keys (OpenAI, Anthropic, Google, Azure, etc.)
  - Git provider auth tokens (GitHub, GitLab, Bitbucket, Azure)
  - Database credentials (PostgreSQL, MongoDB)
  - RabbitMQ connection strings
  - Sentry DSN
  - OpenTelemetry endpoints

**Workspace Configuration:**
- NestJS monorepo: `nest-cli.json` controls build targets
  - Apps: `api`, `webhooks`, `worker`, `analytics-cli`
  - Libs: Code shared across apps

**Key Config Files:**
- `tsconfig.json` - TypeScript config for entire monorepo
- `tsconfig.migrations.json` - Separate TS config for database migrations
- `docker-compose.dev.yml` - Local development environment (PostgreSQL, MongoDB, RabbitMQ)

## Key Packages in Conversation Flow

**Webhook Processing:**
- `ChatWithKodyFromGitUseCase` in `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts`
  - Detects `@kody` mentions via `mentionsKody()` and `CommandManager`
  - Routes to `ConversationAgentUseCase` for general conversation
  - Routes to `BusinessRulesValidationAgentUseCase` for `@kody -v business-logic` command

**Git Provider Adapters:**
- `CodeManagementService` in `libs/platform/infrastructure/adapters/services/codeManagement.service.ts`
  - Dispatches to platform-specific implementations
  - Platform factories delegate to `GithubService`, `GitlabService`, `BitbucketService`, `AzureReposService`

- `GithubService` in `libs/platform/infrastructure/adapters/services/github/github.service.ts`
  - Uses Octokit with retry + throttling plugins
  - Methods: `createIssueComment()`, `updateIssueComment()`, `createResponseToComment()`, `addReactionToComment()`

**Webhook Handlers:**
- `GitHubPullRequestHandler` in `libs/platform/infrastructure/webhooks/github/githubPullRequest.handler.ts`
  - Registers handlers for `pull_request`, `issue_comment`, `pull_request_review_comment` events
  - Invokes `ChatWithKodyFromGitUseCase.execute()` for comment events

**Agent Providers:**
- `ConversationAgentProvider` in `libs/agents/infrastructure/services/kodus-flow/conversationAgent.ts`
  - Uses `@kodus/flow` orchestration engine
  - Default model: `LLMModelProvider.GEMINI_2_5_PRO`
  - Supports MCP tools via `createMCPAdapter()`
  - Planner type: `REACT`

---

*Stack analysis: 2026-04-29*
