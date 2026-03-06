---
name: kodus-pr-suggestions-resolver
description: Use when the user asks to apply Kodus PR suggestions before merge/push using `kodus pr suggestions` with a PR URL or PR number plus repo id. Run one pass by default and rerun only when the developer explicitly asks.
license: MIT
compatibility: Requires Kodus CLI, repository access for the target PR, and a local git workspace where changes can be applied and validated.
metadata:
    author: Kodus
    version: '1.0'
---

# Kodus PR Suggestions Resolver

## Goal

Fetch PR suggestions via Kodus CLI, triage each item against PR intent, apply safe fixes, validate locally, and report exactly what was applied or skipped.

## Trigger Hints

- Treat mentions of `pr suggestions`, `autofix`, `fix review comments`, `resolve kody comments`, `ready to merge`, or `clean this PR` as triggers.
- If the user asks to merge/push a PR and suggestions are pending, ask whether to run this skill first.

## Required Inputs

- Required:
    - `--pr-url <url>`
    - or `--pr-number <number>` with `--repo-id <id>`
- Optional:
    - explicit PR intent (if missing, infer from PR context and ask only when ambiguous)
    - permission to auto-commit/auto-push (default is no auto-commit/push unless requested)
    - explicit permission to run an additional suggestions pass (default is no rerun)

## Workflow

### 0) Preflight checks

- Ensure inside a git repository.
- Ensure local branch is appropriate for PR fixes.
- If working tree has unrelated changes, ask user whether to continue, stash, or stop.
- Ensure Kodus CLI is available with `kodus --help`; stop if missing.

### 1) Resolve the PR target

- If the user did not provide a target, ask for one of:
    - `--pr-url <url>`
    - `--pr-number <number>` with `--repo-id <id>`
- If multiple are provided, prefer `--pr-url`.

### 2) Run one suggestions pass (default)

- Use:
    - `kodus pr suggestions --pr-url <url>`
    - or `kodus pr suggestions --pr-number <number> --repo-id <id>`

### 3) Build context before deciding what to apply

- Understand PR intent before touching code:
    - Read PR title and description (or ask user for intent if unavailable).
    - Inspect changed files and nearby code to understand local architecture and conventions.
    - Check linked task/issue context when available.
    - Identify risk to behavior, public APIs, and test expectations.
- Do not apply suggestions blindly just because they were returned.

### 4) Triage suggestions against intent and context

- For each suggestion:
    - Verify alignment with PR goal, ticket scope, and current code patterns.
    - Prefer low-risk, scoped, testable changes.
    - Skip irrelevant, risky, or scope-expanding items and record reasons.
    - If uncertain, ask the user before implementing.

### 5) Apply accepted fixes

- Make changes per accepted suggestion.
- Keep edits minimal and focused.
- If a suggestion is unclear, ask a clarifying question before changing code.

### 6) Validate

- Run the most relevant build or tests for the edited area.
- If validation fails, stop and report failure clearly.
- If no tests are available or cannot run, state that explicitly.

### 7) Rerun policy (explicit opt-in only)

- Default behavior is a single pass.
- Only run a second/third pass if the developer explicitly asks to rerun.
- If rerun is requested, repeat from step 2.

### 8) Optional commit/push behavior

- Do not auto-commit or auto-push unless the user explicitly requests it.
- If requested, commit in small logical chunks and push after successful validation.

### 9) Report results

Provide a concise report covering:

- Passes executed (default 1).
- Suggestions applied (count + short rationale).
- Suggestions skipped (count + reasons).
- Validation commands and outcomes.
- Remaining blockers or follow-ups.
