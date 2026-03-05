---
name: business-rules-validation
description: Use when the user asks to validate a pull request against ticket/task requirements, acceptance criteria, or business rules using `@kody -v business-logic`. Trigger on terms like business validation, acceptance criteria, PR-vs-task check, or merge readiness with task compliance.
license: MIT
compatibility: Requires a pull request target plus access to the PR platform CLI or API to post a comment in the main PR discussion. Useful validation also requires Kodus task-management integration such as Jira or Linear.
metadata:
    author: Kodus
    version: '1.0'
---

# Business Rules Validation

## Goal

Trigger Kodus business-rules validation for a specific pull request, using task context already linked in the PR or an explicit task reference when needed, then report the result back to the user.

## Required Inputs

- Required: a PR target
    - `pr-url`
    - or `pr-number` plus repository context
- Conditionally required: a task reference
    - not needed when the PR already links the task or issue key
    - required when the PR does not already expose enough task context
    - accepted forms: `task-url` or `task-id` / issue key such as `KC-1441`

## When to Use

- The user asks for business-validation, business validation, business rules validation, or acceptance-criteria validation
- The user wants to check whether a PR matches a linked task or ticket
- The user mentions `@kody -v business-logic`

Do not use this skill as a substitute for `kodus review`. Local review and business-rules validation are different flows.

## Workflow

1. Collect the required context.

- PR target:
    - Prefer a PR URL
    - Or use a PR number with enough repository context to post the comment
- Task context is required for a useful validation, but it does not need to be passed explicitly if the PR already links the task or ticket.
- Explicit task target is needed when the PR does not already contain enough task context:
    - Prefer a task URL
    - Or use a task ID / issue key such as `KC-1441`
- If the user did not provide a PR target, ask for it before proceeding.
- If the PR does not already expose task context and the user did not provide a task reference, ask for the missing task URL or ID.

2. Check the prerequisites.

- The repository must already be connected to Kodus.
- Business-rules validation needs a task-management integration such as Jira, Linear, Notion, or ClickUp.
- The trigger must be posted in the main PR conversation, not in an inline review thread or code-suggestion reply.

3. Build the trigger comment.

- Base command: `@kody -v business-logic`
- If the PR already contains a task link or issue key, the base command is usually enough.
- If task context is not already linked in the PR, append the task reference so Kodus can resolve the requirement source:
    - URL form: `@kody -v business-logic <task-url>`
    - ID form: `@kody -v business-logic <task-id>`

4. Post the comment in the main PR discussion.

- On GitHub, prefer:

```bash
gh pr comment <pr-url-or-number> --body '@kody -v business-logic'
```

- If you need to pass a task URL explicitly:

```bash
gh pr comment <pr-url-or-number> --body '@kody -v business-logic <task-url>'
```

- If using a task ID:

```bash
gh pr comment <pr-url-or-number> --body '@kody -v business-logic KC-1441'
```

- If the PR target is a number and the repo context is required:

```bash
gh pr comment <pr-number> --repo <owner/repo> --body '@kody -v business-logic <task-url-or-id>'
```

- On other providers, use the provider's native CLI or API to post the same body in the main PR discussion.

5. Wait for Kody's response and inspect the new PR comment.

- Summarize findings, missing requirements, or compliance status.
- If Kody says task context is missing or weak, report that directly instead of guessing.

6. If the trigger cannot be posted automatically, stop cleanly.

- Ask the user to post `@kody -v business-logic <task-url-or-id>` manually in the main PR conversation.
- Explain any blocker such as missing platform CLI access, missing task integration, or wrong PR context.

## Notes

- `kodus review` does not trigger this flow.
- The command body should stay exact; only append a task URL or task ID when the PR itself does not already provide enough task context.
- The backend runtime can resolve task links and issue keys, so `KC-1441`-style IDs are valid inputs.
- If the user asks for the underlying skill metadata or instructions, use the Kodus API endpoints `/skills/business-rules-validation/meta` and `/skills/business-rules-validation/instructions`.
