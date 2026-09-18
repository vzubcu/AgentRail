# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

ESM TypeScript project (`"type": "module"`). No linter and no unit-test framework — the test suite is a set of Node integration/regression scripts that run against a freshly built server.

- `npm install` — install dependencies
- `npm run build` — `tsc` compile + Vite web bundle (required before `npm start`)
- `npm run dev` — TypeScript watch only (does not rebuild the web bundle)
- `npm start` — run compiled server (`dist/index.js`)
- `npm run go` — build + start
- `npm run web:build` — rebuild the web bundle only (`scripts/vite-build.mjs`)

### Tests

Every test is `npm run build && node scripts/<name>-regression.mjs` — no framework; they boot the built server and exercise HTTP endpoints. Run only the script relevant to your change, not the whole suite.

- `npm run test:product` — core routing/product regression
- `npm run test:compat` — OpenAI/Anthropic protocol compatibility
- `npm run test:security` — security regression
- `npm run test:usage` — usage tracking regression
- `npm run test:keys` — multi-provider key handling
- `npm run test:virtual-models` / `test:virtual-models-ui` — virtual-models backend + frontend
- `npm run test:frontend-*` — dashboard smoke regressions (bootstrap, dom, saas, usage, quick-connect, style-entry, test-console)
- `npm run test:mcp` — MCP server regression
- `npm run test:chat-surfaces`, `test:attachments`, `test:agent-config`, `test:provider-batch`, `test:tool-call-stream-guard` — feature regressions
- `npm run test:startup-*`, `test:http-routes`, `test:docs-architecture`, `test:docker-startup`, `test:migration-compat`, `test:sql-first-boot` — infra/meta regressions

### Migrations & graph

- `npm run migrate:latest` / `npm run migrate:rollback` — Knex Postgres migrations (`knexfile.cjs`, connection from `AGENTRAIL_SECRETS_DATABASE_URL`)
- `npm run graph:update` / `graph:check` / `graph:scope` — refresh / check / scope the Graphify knowledge graph

## Architecture beyond AGENTS.md

AGENTS.md covers the core request flow. Facts worth knowing that its snapshot predates:

- HTTP route modules live under `src/http/` (see `docs/HTTP_ROUTING.md`). Dashboard frontend boots from `src/web/app/main.js`, feature slices under `src/web/app/features/`, stylesheet entry `src/web/app/styles/main.css` (see `docs/FRONTEND_DASHBOARD.md`).
- The compatibility layer also exposes a stateless Responses API subset (`/v1/responses`, incl. a `agentrail/files` virtual model for native file input), local OpenAI-compatible file storage (`/v1/files`), scoped batch lifecycle (`/v1/batches*`), and audio translation passthrough (`/v1/audio/translations`).
- Extra API surfaces not in AGENTS.md: virtual models (`/api/virtual-models*`), context compression (`/api/compression`), agent skills catalog (`/api/skills`), persistent memory (`/api/memory`), provider quota headroom (`/api/quota`).
- State is file-backed unless Postgres is configured: `.agentrail/config.json` (provider keys), `.agentrail/usage.json`, `.agentrail/models/*.json` (model cache), `.agentrail/saas/db.json` (SaaS users/keys/tiers).
- Full HTTP endpoint table, environment variables, and per-tool setup guides are in `README.md` and `docs/agents/`.
