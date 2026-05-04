# Requirements: Kodus AI — Conversation Migration Milestone

**Defined:** 2026-04-30
**Core Value:** Every interaction with Kody — review or conversation — should have the same depth of context and reasoning as a senior engineer pair-reviewing the PR alongside the user.
**Tracking issue:** [kodustech/kodus-ai#1025](https://github.com/kodustech/kodus-ai/issues/1025)

## v1 Requirements

This milestone is narrowly scoped to migrating the `@kody` PR-comment conversation flow from the legacy non-agent path to the agent pipeline.

### Conversation Routing

- [ ] **CONV-01**: PR-comment `@kody` mentions and replies route through the agent pipeline (the same runtime used by `agent-review.stage.ts`), with full PR context (diff, applicable rules, prior comments on the PR, MCP tools, file references)
- [ ] **CONV-02**: Reuse the existing agent runtime — no parallel agent code path or duplicated prompt/tool wiring is introduced for conversations
- [ ] **CONV-03**: Memory creation via `@kody remember` (explicit and implicit intent) keeps its observable behavior — same triggers, same confirmations, same in-PR responses

### Rollout

- [ ] **RLLT-01**: The new conversation path is gated behind a feature flag (granularity at minimum at the org level; per-provider granularity is desirable if cheap to add)
- [ ] **RLLT-02**: Disabling the flag fully reverts to the legacy non-agent path for that scope, in real time, without redeploy

### Observability & UX

- [ ] **OBS-01**: End-to-end latency of the conversation agent path (webhook in → reply posted) is instrumented and emitted as a metric, segmented by provider and command type
- [ ] **OBS-02**: A latency-impact decision is documented with data: either keep synchronous if delta is small, or implement async UX (status placeholder reply, then edit-in-place when the agent finishes) — pick one based on measured numbers

## v2 Requirements

Deferred to a future milestone. Tracked here so we don't lose them.

### Conversation Surface Expansion

- **CONV-V2-01**: Conversational surface beyond PR comments (web chat UI, CLI conversation) routed through the same agent path
- **CONV-V2-02**: Multi-turn conversations with persistent thread context across multiple PR comments

### Conversation Features

- **CMD-V2-01**: Slash commands inside `@kody` messages (e.g., `/test`, `/explain`)
- **CMD-V2-02**: Cross-message file diffing ("compare this with my previous reply")

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migrating the dedicated code review pipeline | Already runs through the agent flow — nothing to migrate |
| Web chat / CLI conversation parity | Different surface; separate milestone after PR-comment path is stable |
| New conversational features (slash commands, multi-turn re-ask) | Out of scope for a migration; capture as v2 |
| Replacing `@kodus/flow` with another agent runtime | The migration is *to* `@kodus/flow`, not away from it |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONV-01 | Phase 1 | Pending |
| CONV-02 | Phase 1 | Pending |
| CONV-03 | Phase 1 | Pending |
| RLLT-01 | Phase 1 | Pending |
| RLLT-02 | Phase 1 | Pending |
| OBS-01 | Phase 2 | Pending |
| OBS-02 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0

---
*Requirements defined: 2026-04-30*
*Last updated: 2026-04-29 after roadmap creation*
