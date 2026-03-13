# Repository Config CLI Manual QA Checklist

## Goal

Validate the repository-config experience from a real terminal session, covering:

- repository add flow
- guided setup UX
- direct setting updates
- pattern mutations with glob input
- JSON output for scripts and agents
- web handoff for advanced settings

## Preconditions

1. Build the CLI:

```bash
yarn build
```

2. Export a valid team key:

```bash
export KODUS_TEAM_KEY=your-team-key
```

3. Run commands from a real git repository with a configured remote.

4. Use the compiled entrypoint for smoke tests:

```bash
node dist/index.js
```

## Priority 1: Core Happy Path

### 1. Command discovery

Run:

```bash
node dist/index.js config --help
node dist/index.js config remote --help
node dist/index.js config remote set --help
```

Validate:

- help is readable and easy to scan
- `remote` commands are discoverable from `config --help`
- wording says the CLI updates the repository's current state directly
- no mention of reset/default semantics

### 2. Add current repository without setup

Run:

```bash
node dist/index.js config --remote . --no-prompt
```

Validate:

- repository is added successfully
- command exits cleanly
- no interactive prompt appears

### 3. Inspect repository settings

Run:

```bash
node dist/index.js config remote show .
```

Validate:

- repository name is correct
- booleans are easy to read
- severity is visible
- pattern lists are shown clearly
- output is usable without reading docs

### 4. Run guided setup

Run:

```bash
node dist/index.js config remote setup .
```

Validate:

- prompts are short and clear
- sections are understandable
- glob helper text helps instead of confusing
- preview matches the chosen answers
- apply step is explicit before persisting

Suggested inputs:

- automated review: `yes`
- auto approve: `no`
- request changes severity: `critical`
- ignored files: `**/*.lock`, `dist/**`
- base branches: `main`, `release/*`
- ignored titles: `wip*`, `draft*`

### 5. Confirm persisted state

Run:

```bash
node dist/index.js config remote show .
```

Validate:

- values match the setup choices exactly
- glob patterns are preserved as typed

## Priority 2: Direct Mutation Flow

### 6. Set scalar values directly

Run:

```bash
node dist/index.js config remote set . review.enabled true
node dist/index.js config remote set . review.autoApprove false
node dist/index.js config remote set . review.requestChanges.minSeverity critical
```

Validate:

- command naming feels predictable
- success output is obvious
- follow-up `show` reflects the updated values

### 7. Add and remove patterns with human aliases

Run:

```bash
node dist/index.js config remote add-ignore-file . "coverage/**"
node dist/index.js config remote add-base-branch . "develop"
node dist/index.js config remote add-ignore-title . "chore(release)*"
node dist/index.js config remote remove-ignore-file . "coverage/**"
node dist/index.js config remote remove-base-branch . "develop"
node dist/index.js config remote remove-ignore-title . "chore(release)*"
```

Validate:

- aliases feel better than generic field names
- add does not duplicate existing patterns
- remove only removes the chosen pattern
- patterns remain untouched otherwise

### 8. Add and remove patterns with generic commands

Run:

```bash
node dist/index.js config remote add-pattern . ignore-files "tmp/**"
node dist/index.js config remote remove-pattern . ignore-files "tmp/**"
```

Validate:

- generic commands still work for scripts
- supported field names are understandable from help and error messages

## Priority 3: JSON and Agent Flow

### 9. Validate JSON output

Run:

```bash
node dist/index.js config --remote . --json
node dist/index.js config remote list --json
node dist/index.js config remote show . --json
node dist/index.js config remote set . review.enabled true --json
node dist/index.js config remote add-ignore-file . "dist/**" --json
node dist/index.js config remote open . --section suggestion-control --json
```

Validate:

- output is valid JSON
- no human-oriented text is mixed into stdout
- payload shape is stable enough for automation
- command result contains enough context to chain the next step

### 10. Validate structured setup preview

Run:

```bash
node dist/index.js config remote setup . --json
```

Validate:

- payload includes current settings and next settings
- cancellation returns a non-applied result cleanly
- apply returns the saved settings

## Priority 4: Browser Handoff

### 11. Open advanced settings

Run:

```bash
node dist/index.js config remote open . --section suggestion-control
node dist/index.js config remote open . --section general
```

Validate:

- browser opens successfully
- CLI prints the repository and section path clearly
- unsupported sections fail with a helpful error
- behavior is still useful even without deep-link support

## Priority 5: Error Handling

### 12. Invalid key

Run:

```bash
node dist/index.js config remote set . invalid.key true
```

Validate:

- command fails fast
- error tells the user the key is invalid
- message nudges the user toward valid usage

### 13. Invalid repository context

Run outside a git repository:

```bash
node dist/index.js config --remote .
```

Validate:

- error is direct and actionable
- no stack trace leaks to the user

### 14. Missing authentication

Unset the team key and retry:

```bash
unset KODUS_TEAM_KEY
node dist/index.js config remote list
```

Validate:

- auth failure is clear
- message points the user to the correct auth/setup path

## Sign-off Questions

Before shipping broadly, answer these with a clear yes or no:

- Can a first-time user add and configure a repository without reading source code?
- Do the commands feel predictable between guided and direct modes?
- Are glob-based fields explained clearly enough for real users?
- Is the JSON output clean enough for scripts and agents?
- Is the web handoff good enough until deep-link URLs exist?

## Known Product Limitation

`kodus config remote open` does not deep-link to a repository section yet. It opens the Kodus app and prints the navigation path. This is acceptable for smoke testing, but should be upgraded once the app route is defined.
