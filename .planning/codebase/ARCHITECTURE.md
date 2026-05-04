# Kody PR Conversation Flow Architecture

**Analysis Date:** 2026-04-29

## Pattern Overview

**Overall:** Webhook-driven asynchronous conversation pipeline with multi-platform support and agent-based LLM dispatch.

**Key Characteristics:**
- Webhook ingestion from GitHub, GitLab, Bitbucket, Azure Repos, and Forgejo
- Asynchronous job queue processing (RabbitMQ-based, enqueued as WEBHOOK_PROCESSING jobs)
- Dual-flow dispatch: `ChatWithKodyFromGitUseCase` for `@kody` mentions and command detection
- Agent-based execution via `ConversationAgentUseCase` or `BusinessRulesValidationAgentUseCase`
- Platform-specific acknowledgment/response policies (reactions for GitHub/GitLab, comments for Bitbucket/Azure)
- Thread-based context tracking with `createThreadId()` for memory continuity

## Layers

**Controller/Entry Point (HTTP):**
- Purpose: Receive and validate platform webhooks
- Location: `apps/webhooks/src/controllers/{github,gitlab,bitbucket,azureRepos,forgejo}.controller.ts`
- Contains: HTTP POST handlers, event filtering, immediate ACK responses
- Depends on: `EnqueueWebhookUseCase`
- Used by: External webhook systems (GitHub Apps, GitLab webhooks, etc.)
- Example flow:
  ```typescript
  // GithubController.handleWebhook
  const event = req.headers['x-github-event']; // 'pull_request', 'issue_comment', 'pull_request_review_comment'
  if (!supportedEvents.includes(event)) return res.status(200).send('ignored');
  res.status(200).send('Webhook received'); // immediate return
  setImmediate(() => this.enqueueWebhookUseCase.execute({ platformType, event, payload }));
  ```

**Job Enqueue (Async Dispatcher):**
- Purpose: Persist webhook to job queue for asynchronous processing
- Location: `libs/platform/application/use-cases/webhook/enqueue-webhook.use-case.ts`
- Contains: Job queue abstraction, correlation ID generation
- Depends on: `IJobQueueService`, `PlatformType` enum
- Used by: Controllers via `EnqueueWebhookUseCase`
- Data: `{ platformType, event, payload, correlationId }`
- Queue binding: `WorkflowType.WEBHOOK_PROCESSING` → `HandlerType.WEBHOOK_RAW`

**Workflow Processor (Job Dispatcher):**
- Purpose: Route enqueued jobs to platform-specific handlers
- Location: `libs/automation/webhook-processing/webhook-processing-job.processor.ts`
- Contains: Platform handler map (GitHub → GitHubPullRequestHandler, etc.), error classification
- Depends on: Platform handlers via DI, `WorkflowJobRepository`
- Used by: `JobProcessorRouterService` when job consumer picks up WEBHOOK_PROCESSING jobs
- Timeout: 10 minutes
- Flow:
  ```typescript
  const handler = this.webhookHandlersMap.get(platformType); // returns GitHubPullRequestHandler, etc.
  if (handler.canHandle(webhookParams)) {
    await handler.execute(webhookParams); // platform-specific logic
  }
  ```

**Platform Handlers (Event Routing):**
- Purpose: Platform-specific logic for PR events and comment events
- Location: `libs/platform/infrastructure/webhooks/{github,gitlab,bitbucket,azure,forgejo}/pullRequest.handler.ts`
- Contains: 
  - `handlePullRequest()` - PR opened/synchronized/closed/ready_for_review
  - `handleComment()` - Issue comments and inline review comments
  - Detection logic for `@kody start-review` vs `@kody` mention vs `@kody -v business-logic`
- Depends on: `ChatWithKodyFromGitUseCase`, code-review pipeline use cases, `CodeManagementService`
- Used by: `WebhookProcessingJobProcessorService`
- Example (GitHub):
  ```typescript
  if (isStartCommand && !hasMarker) {
    // @kody start-review detected → enqueue CODE_REVIEW job
    await this.enqueueCodeReviewJobUseCase.execute(/* ... */);
  } else if (isKodyMentionNonReview(comment.body)) {
    // @kody or @kody -v detected → direct conversation flow
    this.chatWithKodyFromGitUseCase.execute(params); // fire-and-forget
  }
  ```

**Command Detection & Dispatch (Use Case):**
- Purpose: Parse webhook for command type and route to appropriate agent
- Location: `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts`
- Contains:
  - `CommandManager` with handlers: `BusinessLogicValidationCommandHandler`, `ConversationCommandHandler`
  - Platform-specific comment extraction (GitHub: `payload.comment.body`, GitLab: `object_attributes.note`, etc.)
  - Context assembly: PR description, head/base refs, prior thread comments
- Depends on: `ConversationAgentUseCase`, `BusinessRulesValidationAgentUseCase`, `CodeManagementService`
- Used by: Platform handlers (called from `handleComment()`)
- Command types:
  ```typescript
  BUSINESS_LOGIC_VALIDATION = '@kody -v business-logic' → BusinessRulesValidationAgent
  CONVERSATION = '@kody' or '@kody' followed by question → ConversationAgent
  BUSINESS_LOGIC_INVALID_CONTEXT = '@kody -v business-logic' in inline comment → error message
  UNKNOWN = no match
  ```

**Agent Execution Layer (LLM Dispatch):**
- Purpose: Execute conversation or business-logic validation via Kodus Flow orchestration
- Location:
  - `libs/agents/application/use-cases/conversation-agent.use-case.ts`
  - `libs/agents/application/use-cases/business-rules-validation-agent.use-case.ts`
- Contains: Thin wrappers around provider implementations
- Depends on: `ConversationAgentProvider` / `BusinessRulesValidationAgentProvider`
- Used by: `ChatWithKodyFromGitUseCase`

**Agent Provider (Kodus Flow Orchestration):**
- Purpose: Initialize Kodus Flow orchestration, set up MCP adapter, build prompt with memory bootstrap
- Location:
  - `libs/agents/infrastructure/services/kodus-flow/conversationAgent.ts`
  - `libs/agents/infrastructure/services/kodus-flow/business-rules-validation/businessRulesValidationAgent.ts`
- Contains:
  - `createMCPAdapter()` - loads MCP connections for organization
  - `createOrchestration()` - initializes LLM adapter and orchestration
  - `buildPromptWithMemoryBootstrap()` - injects KODUS_FIND_MEMORIES tool call as first step
  - `execute()` - orchestrates agent with thread + userContext
- Depends on: `createMCPAdapter`, `createOrchestration` from Kodus Flow SDK, `MCPManagerService`, `BaseAgentProvider`
- Used by: Agent use cases
- Prompt building (memory bootstrap):
  ```typescript
  const memoryPayload = {
    organizationId,
    teamId,
    repositoryId: prepareContext?.repository?.id,
    limit: 20,
  };
  // Injected as first instruction to agent
  ```

**Response Assembly & Posting:**
- Purpose: Gather LLM response and post back to PR platform
- Location: `libs/platform/application/use-cases/codeManagement/chatWithKodyFromGit.use-case.ts` (lines 556-891)
- Contains:
  - Platform-specific response policies (GitHub: reactions + comment, GitLab: reactions + comment, Bitbucket/Azure: comment with acknowledgment)
  - Acknowledgment posting flow (reaction or inline acknowledgment comment)
  - Response update/replace logic (update acknowledgment comment with full response)
- Depends on: `CodeManagementService`, `PlatformResponsePolicyFactory`
- Used by: `handleConversationFlow()` and `handleBusinessLogicFlow()` in `ChatWithKodyFromGitUseCase`
- Policy examples:
  ```typescript
  // GitHub: use reaction
  await addReactionToComment({ reaction: 'rocket' }); // acknowledge
  // ... wait for LLM response ...
  await createResponseToComment({ body: response }); // full response
  await removeReactionsFromComment([reaction]); // remove reaction
  
  // Bitbucket/Azure: use acknowledgment comment
  const ackResponse = await createResponseToComment({ body: 'Analyzing...' });
  // ... wait for LLM response ...
  await updateResponseToComment({ commentId: ackResponse.id, body: response });
  ```

**Code Management Service (Platform Adapter):**
- Purpose: Abstract platform API calls (create comment, update comment, get PR details, add reactions)
- Location: `libs/platform/infrastructure/adapters/services/codeManagement.service.ts`
- Contains: Delegating methods that route to platform-specific implementations
- Depends on: `platformIntegrationFactory.getCodeManagementService(type)`
- Used by: `ChatWithKodyFromGitUseCase`
- Methods used in conversation flow:
  - `getPullRequestReviewComment()` - fetch thread comments
  - `createIssueComment()` - post top-level comment
  - `updateIssueComment()` - edit comment
  - `createResponseToComment()` - create reply in thread
  - `updateResponseToComment()` - update reply
  - `addReactionToComment()` - add emoji reaction
  - `removeReactionsFromComment()` - remove emoji reaction

## Data Flow

**Step 1: Webhook Ingestion → Queue**

```
GitHub webhook (issue_comment event)
  ↓
GithubController.handleWebhook()
  ├─ Parse event header ('issue_comment')
  ├─ Parse payload (comment.body = '@kody help me')
  ├─ Return HTTP 200 immediately
  └─ setImmediate(() => EnqueueWebhookUseCase.execute({
       platformType: GITHUB,
       event: 'issue_comment',
       payload: {...full GitHub payload...},
       correlationId: auto-generated
     }))
       └─ JobQueueService.enqueue({
            workflowType: WEBHOOK_PROCESSING,
            handlerType: WEBHOOK_RAW,
            payload: {...},
            metadata: { platformType, event }
          })
```

**Step 2: Queue → Handler**

```
Job Consumer reads from queue
  ↓
JobProcessorRouterService.process(jobId)
  ├─ Fetch job from WorkflowJobRepository
  ├─ Get processor: WorkflowType.WEBHOOK_PROCESSING → WebhookProcessingJobProcessorService
  └─ processor.process(jobId)
       └─ Get handler from map: PlatformType.GITHUB → GitHubPullRequestHandler
            └─ handler.canHandle(webhookParams) → true if event in [pull_request, issue_comment, pull_request_review_comment]
                 └─ handler.execute(webhookParams)
```

**Step 3: Handler → Conversation Use Case**

```
GitHubPullRequestHandler.handleComment()
  ├─ Extract comment body = '@kody help me'
  ├─ Parse platform-specific fields
  ├─ Check isReviewCommand? → no
  ├─ Check isKodyMentionNonReview? → yes
  └─ ChatWithKodyFromGitUseCase.execute(params)
       // fire-and-forget, no await
```

**Step 4: Command Detection → Agent Selection**

```
ChatWithKodyFromGitUseCase.execute(params)
  ├─ this.isRelevantAction(params) → true if action in [created, edited]
  ├─ Extract repository, integration config, org/team data
  ├─ detectCommandType(params)
  │   └─ CommandManager.getCommandType(commentBody)
  │        ├─ Check startsWith('@kody -v business-logic') → BUSINESS_LOGIC_VALIDATION
  │        ├─ Check startsWith('@kody') and no ' -v ' → CONVERSATION
  │        └─ Check if inline comment → adjust type if needed
  │
  ├─ Fetch all PR comments (to find original Kody comment, other replies)
  ├─ Create thread ID: createThreadId({ organizationId, teamId, repositoryId, userId, issueId }, { prefix: 'cmc' })
  │
  └─ if (commandType === CONVERSATION)
       └─ handleConversationFlow()
```

**Step 5: Context Gathering & Prompt Building**

```
ChatWithKodyFromGitUseCase.handleConversationFlow()
  ├─ this.prepareContext({
  │    comment: { body: '@kody help me analyze this logic' },
  │    originalKodyComment: {...prior Kody response if this is a follow-up...},
  │    gitUser: { id, username },
  │    othersReplies: [...comments from other users in thread...],
  │    pullRequestNumber: 123,
  │    repository: { name, id, owner },
  │    pullRequestDescription: '...',
  │    platformType: GITHUB,
  │    headRef: 'feature/my-feature',
  │    baseRef: 'main',
  │    defaultBranch: 'main',
  │    customInstructions: undefined,
  │  })
  │   └─ returns prepareContext object with:
  │       ├─ userQuestion: '@kody help me analyze this logic'
  │       ├─ repository: { name, id, owner, defaultBranch }
  │       ├─ pullRequestDescription, platformType
  │       ├─ pullRequest: { pullRequestNumber, headRef, baseRef }
  │       └─ codeManagementContext: { originalComment, othersReplies }
  │
  ├─ ResponsePolicy.create(platformType) → GitHubResponsePolicy
  ├─ if (requiresAcknowledgment()) → false for GitHub
  ├─ else if (usesReaction()) → true
  │   └─ addReactionToComment(commentId, 'rocket') // emoji acknowledgment
  │
  ├─ processCommand(commandType, { prepareContext, organizationAndTeamData, thread })
  │   └─ handleConversation()
  │        └─ ConversationAgentUseCase.execute({
  │             prompt: prepareContext.userQuestion,
  │             organizationAndTeamData,
  │             prepareContext,
  │             thread
  │           })
```

**Step 6: Agent Execution**

```
ConversationAgentUseCase.execute()
  └─ ConversationAgentProvider.execute(prompt, context)
       ├─ Fetch BYOK config (if org has custom LLM keys)
       ├─ createMCPAdapter(organizationAndTeamData)
       │   └─ MCPManagerService.getConnections(org/team) → list of registered MCP servers
       ├─ createOrchestration()
       │   └─ createOrchestration({ llmAdapter, mcpAdapter, observability, storage })
       ├─ orchestration.connectMCP() & registerMCPTools()
       ├─ orchestration.createAgent({ name: 'kodus-conversational-agent', plannerOptions: { type: REACT } })
       ├─ buildPromptWithMemoryBootstrap(prompt, prepareContext, organizationAndTeamData)
       │   └─ Injects:
       │       CRITICAL FIRST ACTION:
       │       - invoke KODUS_FIND_MEMORIES with { organizationId, teamId, repositoryId, limit: 20 }
       │       - if matches found, treat as high-priority context constraints
       │       USER PROMPT: [original prompt]
       │
       └─ orchestration.callAgent('kodus-conversational-agent', builtPrompt, {
             thread,
             userContext: { organizationAndTeamData, additional_information: prepareContext }
           })
            └─ Returns: { result: "...", context: { correlationId, threadId, sessionId } }
```

**Step 7: Response Post-Back**

```
ChatWithKodyFromGitUseCase.handleConversationFlow() [continued from acknowledgment]
  ├─ Receive response string from ConversationAgentUseCase
  ├─ if (responsePolicy.usesReaction()) → true for GitHub
  │   ├─ createResponseToComment({ inReplyToId, body: response })
  │   │   └─ CodeManagementService.createResponseToComment()
  │   │        └─ platformIntegrationFactory.getCodeManagementService(GITHUB)
  │   │             └─ GitHub API: POST /repos/:owner/:repo/issues/:issue_number/comments with @-mention threading
  │   │
  │   └─ removeReactionsFromComment([{commentId, reactions: ['rocket']}])
  │        └─ Remove acknowledgment reaction
  │
  └─ Log success and complete

// For Bitbucket/Azure (requiresAcknowledgment() = true):
  ├─ updateResponseToComment({
  │    commentId: ackResponse.id,
  │    body: response,
  │    parentId: ...
  │  })
  │   └─ Update the acknowledgment comment with full response
```

## State Management

**Thread-based Continuity:**
- Each `@kody` mention in a PR creates a unique thread ID via `createThreadId()` with prefix `'cmc'` (conversation message context)
- Thread ID includes: `organizationId`, `teamId`, `repositoryId`, `userId`, `suggestionCommentId` (or `issueId` for business-logic flow)
- Passed to agent as `thread` context in `orchestration.callAgent()`
- Enables multi-turn conversations within same PR thread without losing context
- Memory lookup via `KODUS_FIND_MEMORIES` uses same org/team/repo IDs to surface prior context

**Asynchronous Non-blocking:**
- Webhook controller returns HTTP 200 immediately via `setImmediate()`
- Job queue handles actual processing asynchronously
- If agent execution fails, job is marked FAILED and logged; no retry to webhook caller
- User sees acknowledgment reaction (GitHub/GitLab) or acknowledgment comment (Bitbucket/Azure) within seconds

## Key Abstractions

**CommandManager & CommandHandler:**
- Purpose: Strategy pattern for detecting command type from comment body
- Examples: `BusinessLogicValidationCommandHandler`, `ConversationCommandHandler`
- Pattern: Each handler implements `canHandle(userQuestion): boolean` and `getCommandType(): CommandType`
- Used in: `detectCommandType()` method

**PlatformResponsePolicy:**
- Purpose: Strategy pattern for platform-specific acknowledgment/response mechanics
- Location: `libs/platform/application/use-cases/codeManagement/policies/platform-response.policy.ts`
- Implementations:
  - `GitHubResponsePolicy`: uses reactions (no acknowledgment comment)
  - `GitLabResponsePolicy`: uses reactions
  - `BitbucketResponsePolicy`: requires acknowledgment comment
  - `AzureReposResponsePolicy`: requires acknowledgment comment with markdown suffix
  - `ForgejoResponsePolicy`: uses reactions
- Methods: `requiresAcknowledgment()`, `usesReaction()`, `getAcknowledgmentReaction()`, `getAcknowledgmentBody()`

**Comment Mapping & Detection:**
- `getMappedPlatform()` - returns platform-specific mappers for comment/PR extraction
- `isReviewCommand()` - detects `@kody start-review` command
- `isKodyMentionNonReview()` - detects `@kody` mention without review marker
- `hasReviewMarker()` - checks for `<!-- kody-codereview -->` to skip processing

**Integration Context:**
- `WebhookContextService.getContext()` - retrieves `organizationAndTeamData` and `teamAutomationId` from integration config
- Used to determine if automation is enabled for repository

## Entry Points

**HTTP Entry:**
- Location: `apps/webhooks/src/controllers/{github,gitlab,bitbucket,azureRepos,forgejo}.controller.ts`
- Route: `POST /github/webhook`, `POST /gitlab/webhook`, etc.
- Triggers: `EnqueueWebhookUseCase`

**Queue Consumer Entry:**
- Location: Workflow consumer service (RabbitMQ listener)
- Reads: `WorkflowType.WEBHOOK_PROCESSING` jobs
- Invokes: `JobProcessorRouterService.process(jobId)`

## Error Handling

**Strategy:** Async fail-safe with logging

**Patterns:**
1. Webhook controller: returns HTTP 200 regardless; `setImmediate()` handles errors silently with logs
2. Handler: catches errors, logs with metadata, marks job FAILED
3. Agent execution: errors bubble up to handler, classified as RETRYABLE (timeout) or PERMANENT (other)
4. Response posting: if fails, logs warning but doesn't retry webhook caller (user already saw acknowledgment)

**Error Classification:**
- `ErrorClassification.RETRYABLE` - timeout errors (10 min timeout for webhook processor)
- `ErrorClassification.PERMANENT` - all other errors (invalid org/team, missing integration, etc.)

## Cross-Cutting Concerns

**Logging:** `createLogger()` from `@kodus/flow`
- Structured logs with context, metadata, error details
- Key fields: `correlationId`, `organizationAndTeamData`, `thread`, `platformType`, `event`, `prNumber`

**Validation:** 
- Platform type enum validation
- Supported event filtering at controller level
- Action filtering (only created/edited comments)
- Integration config presence check

**Observability:**
- `ObservabilityService.runInSpan()` for distributed tracing
- `observability.runLLMInSpan()` for LLM call tracking
- Metadata: org/team IDs, model provider, token usage (via BYOK)

## Relationship to Code-Review Pipeline

**Shared Services (conversation-only vs review-shared):**
- Conversation-only: `ChatWithKodyFromGitUseCase`, `ConversationAgentUseCase`, `ConversationAgentProvider`
- Shared with review:
  - `CodeManagementService` - used for posting responses to PR
  - `SavePullRequestUseCase` - saves PR metadata (conversation flow triggers indirectly via handler)
  - `WebhookContextService` - retrieves integration config
  - `PlatformResponsePolicyFactory` - response posting mechanics (also used in review pipeline for suggestions)
  - Platform handlers - GitHub/GitLab/etc handlers dispatch to both conversation flow AND code-review pipeline

**Separation of Concern:**
- Review pipeline: triggered by `@kody start-review` command or PR open/synchronize → `EnqueueCodeReviewJobUseCase` → separate CODE_REVIEW job
- Conversation flow: triggered by `@kody mention` → direct `ChatWithKodyFromGitUseCase` → inline agent execution with no separate job
- Both can coexist: PR with active code review can still accept `@kody` mentions for conversation

**Changes to Shared Services Impact:**
- `CodeManagementService` changes affect both flows (response posting)
- `PlatformResponsePolicyFactory` changes affect both flows (acknowledgment strategy)
- Platform handler changes: if routing logic changes, both flows affected

---

*Architecture analysis: 2026-04-29*
