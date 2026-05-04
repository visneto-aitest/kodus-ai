# Docs

This repository contains the Mintlify documentation for Kodus. The site is configured via `docs.json` and content is written in `.mdx` files.

## Development

Install the Mintlify CLI to preview changes locally:

```
npm i -g mintlify
```

From the repo root (where `docs.json` is), run:

```
mintlify dev
```

## Publishing Changes

Push to the default branch. If the GitHub App/integration is installed, the site auto-deploys from the default branch.

## Structure

- `docs.json` — site configuration and navigation
- `how_to_use/` — product usage guides (English)
- `how_to_deploy/` — deployment guides
- `cookbook/` — example setups and recipes

## Troubleshooting

- `mintlify dev` not running → Run `mintlify install` to re-install dependencies.
- 404 on load → Ensure you're in the folder with `docs.json`.

