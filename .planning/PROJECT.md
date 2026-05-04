# Kodus AI

## What This Is

Kodus AI is an AI-powered code review platform that runs automated reviews on pull requests across GitHub, GitLab, Bitbucket, Azure DevOps, and Forgejo. Beyond reviews, it exposes a conversational layer where developers interact with "Kody" via `@kody` mentions in PR comments to ask questions, request explanations, and persist team conventions as memories.

## Core Value

Every interaction with Kody — review or conversation — should have the same depth of context and reasoning as a senior engineer pair-reviewing the PR alongside the user.

## Requirements

### Validated

<!-- Existing capabilities inferred from `.planning/codebase/`. Locked unless explicit re-discussion. -->

- ✓ Code review pipeline (file-level + PR-level) running through the agent strategy in `agent-review.stage.ts` — existing
- ✓ Multi-provider Git platform support (GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo) — existing
- ✓ `@kody` PR-comment conversational layer via `ChatWithKodyFromGitUseCase` (legacy non-agent flow) — existing
- ✓ Memory creation via `@kody remember ...` (explicit and implicit) — existing
- ✓ Kody Rules system (file-level and PR-level rules) with directory/repo/global scopes — existing
- ✓ MCP tool integration available to the code-review pipeline — existing
- ✓ Multi-LLM provider support with BYOK (OpenAI, Anthropic, Google, Azure, Bedrock) — existing
- ✓ Self-hosted + Cloud deployment modes with `API_CLOUD_MODE` gating — existing

### Active

<!-- First GSD milestone — narrowly scoped to one initiative. -->

- [ ] Migrate `@kody` PR conversations from the legacy non-agent flow to the agent pipeline (issue #1025)
- [ ] Ship the migration behind a feature flag for safe enablement
- [ ] Preserve memory creation flow (explicit/implicit) with no observable regression
- [ ] Document latency impact and decide UX path if the agent path is materially slower (async-with-status-update vs fast fallback)

### Out of Scope

- Migration of the dedicated code review pipeline — already on the agent flow
- Conversational surfaces outside PR comments (web chat UI, CLI conversation) — separate milestone
- New conversation features (slash commands, multi-turn re-asking, file diffing across messages) — defer to v2

## Context

- The codebase has been mapped in `.planning/codebase/` (7 docs: STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS). Phase research will read these instead of re-discovering.
- Today, `@kody` PR-comment replies route through `ChatWithKodyFromGitUseCase`, which builds a slim prompt (immediate comment thread + minimal PR slice) and skips the agent pipeline.
- The agent variant (`agent-review.stage.ts`) gives the model full PR context: full diff, applicable rules, prior comments on the PR, MCP tools, file references. We want conversation to reach the same bar.
- Tracking issue: [kodustech/kodus-ai#1025](https://github.com/kodustech/kodus-ai/issues/1025).
- A separate hotfix for BSON circular-ref errors in the observability exporter is already in flight (PR #1024) and does not block this milestone.

## Constraints

- **Tech stack**: NestJS API + `@kodus/flow` for agent orchestration. The migration must reuse existing agent infrastructure, not introduce a parallel runtime.
- **Compatibility**: Self-hosted installs must keep working — no new mandatory cloud-only dependencies for the conversation path.
- **Observable contract**: The memory creation surface (`@kody remember ...`) is user-facing — its inputs/outputs/errors must not regress.
- **Latency**: Conversational replies have a tighter human-perceived latency budget than scheduled code reviews. If the agent pipeline is materially slower, async UX with a status update is acceptable; we must not silently leave users waiting.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Scope first GSD milestone narrowly to conversation migration | Ship one well-bounded change before formalizing the full product backlog | — Pending |
| Reuse `agent-review.stage.ts` pattern instead of building a parallel conversation agent | Single source of truth for agent runtime; avoids drift between review and conversation | — Pending |
| Roll out behind a feature flag (per-org and/or per-provider) | Safe enablement, quick rollback if latency or quality regresses | — Pending |

---
*Last updated: 2026-04-30 after initialization*
