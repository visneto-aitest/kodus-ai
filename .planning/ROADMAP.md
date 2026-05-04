# Roadmap: Kodus AI — Conversation Migration Milestone

## Overview

This milestone migrates the `@kody` PR-comment conversation flow from the legacy non-agent path to the agent pipeline (the same runtime used by `agent-review.stage.ts`). Phase 1 delivers the migration itself behind a feature flag. Phase 2 closes the loop with latency instrumentation and a documented UX decision. Three phases total — no padding.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work

- [ ] **Phase 1: Agent Migration** - Reroute `@kody` PR conversations through the agent pipeline with full PR context and feature-flag gating
- [ ] **Phase 2: Observability & UX Decision** - Instrument end-to-end latency and make a data-backed decision on synchronous vs async UX

## Phase Details

### Phase 1: Agent Migration
**Goal**: `@kody` PR-comment conversations reach the agent pipeline with full PR context, memory creation is preserved, and the rollout is flag-gated so the legacy path remains the safe fallback
**Depends on**: Nothing (first phase)
**Requirements**: CONV-01, CONV-02, CONV-03, RLLT-01, RLLT-02
**Success Criteria** (what must be TRUE):
  1. A developer posting `@kody why is this file excluded from review?` in a PR comment receives a reply that references the actual diff, applicable Kody Rules, and prior PR comments — depth that the legacy path could not provide
  2. A developer posting `@kody remember always prefer named exports` sees the same confirmation message and memory persisted that they would have seen on the legacy path
  3. An operator flipping the feature flag off for an org reverts all `@kody` replies for that org to the legacy non-agent path immediately, without redeploy
  4. No new agent runtime, prompt wiring, or tool registration is introduced beyond what `agent-review.stage.ts` already exposes
**Plans**: TBD

Plans:
- [ ] 01-01: TBD

### Phase 2: Observability & UX Decision
**Goal**: End-to-end latency of the agent conversation path is measured in production (or staging under realistic load), and a documented decision selects synchronous or async UX based on that data
**Depends on**: Phase 1
**Requirements**: OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. A metric for webhook-in to reply-posted latency is emitted per provider (GitHub, GitLab, etc.) and per command type (question, remember, other), queryable in the existing observability stack
  2. A written decision (in PROJECT.md Key Decisions or a linked doc) records the measured p50/p95 latency delta vs the legacy path and states whether the system will stay synchronous or implement async UX (status placeholder + edit-in-place)
  3. If async UX is chosen, a developer triggering a slow `@kody` reply sees a placeholder comment appear immediately and then update in place when the agent finishes — with no silent wait
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Agent Migration | 0/TBD | Not started | - |
| 2. Observability & UX Decision | 0/TBD | Not started | - |
