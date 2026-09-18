# Structure

Updated: 2026-07-20

## Top-Level Layout

- `src/`: application source
- `scripts/`: regression and admin helper scripts
- `docs/`: product docs, integration guides, and AI memory
- `Assets/`: repository assets used by docs/readme
- `dist/`: compiled output after `npm run build`

## Source Map

### Entrypoints

- `src/index.ts`: CLI entrypoint, starts the server
- `src/server.ts`: thin compatibility wrapper around the extracted server runtime
- `src/http/create-server.ts`: active Node HTTP composition root
- `src/web/app/main.js`: active frontend entrypoint bundled into `/static/dist/app.js`

### Routing and protocol translation

- `src/http/routes/*`: backend route modules for static UI, management APIs, models, config keys, OpenAI-compatible routes, specialty v1 routes, Anthropic-compatible routes, and SaaS delegation
- `src/router.ts`: provider selection and retry logic
- `src/anthropic-bridge.ts`: Anthropic request/response transformation to internal OpenAI-style flow
- `src/responses-bridge.ts`: Responses API request/response/stream transformation to internal OpenAI-style flow
- `src/types.ts`: request/model typing shared across the gateway

### Providers and model catalogs

- `src/providers/index.ts`: provider registry and model allowlists
- `src/providers/base.ts`: base provider adapter for OpenAI-style upstreams
- `src/providers/cohere.ts`: provider-specific behavior for Cohere
- `src/providers/timeout.ts`: fetch timeout wrapper
- `src/models/registry.ts`: canonical model aggregation across providers
- `src/models/sync.ts`: provider model fetch/cache support
- `src/models/*-sync.ts`: provider-specific model sync implementations

### Config, health, usage, and persistence

- `src/config.ts`: runtime config, timeout, and gateway auth state
- `src/config-store.ts`: persisted config file IO and managed-key coordination
- `src/catalog.ts`: unified provider/model summary builder
- `src/health.ts`: provider health tracking and checks
- `src/usage.ts`: usage normalization and token estimation
- `src/usage-tracker.ts`: local usage persistence
- `src/batches-store.ts`: local batch metadata persistence for the OpenAI-style Batch API
- `src/persistence/`: migration/bootstrap helpers for SQL-backed startup

### Context compression, skills, memory, and quota

- `src/compression/config.ts`: persisted context-compression settings (drop-oldest / truncate strategy, token budget)
- `src/compression/compress.ts`: message-history compression transform applied before routing
- `src/skills/catalog.ts`: agent-ready skills catalog with copy-ready integration URLs
- `src/memory/store.ts`: persistent conversational memory with FTS5 full-text search and tag indexing
- `src/quota/engine.ts`: provider quota config and per-provider headroom calculation

### SaaS/account module

- `src/saas/db.ts`: backend selector for SaaS persistence
- `src/saas/postgres-db.ts`: Postgres-backed SaaS storage
- `src/saas/legacy-db.ts`: file-backed legacy SaaS storage helpers
- `src/saas/types.ts`: shared SaaS persistence types
- `src/saas/routes.ts`: SaaS/account HTTP routes
- `src/saas/auth.ts`: admin login, persisted sessions, CSRF validation, scoped API keys
- `src/saas/tiers.ts`: tier lookup and validation
- `src/saas/rates.ts`: quota calculations

### Web console

- `src/web/templates/index.html`: public shell template
- `src/web/templates/dashboard.html`: authenticated dashboard shell template
- `src/web/app/dashboard-app.js`: active frontend runtime composition root
- `src/web/app/dashboard-render.js`: render orchestration for full refreshes
- `src/web/app/dashboard-bindings.js`: global dashboard DOM/event bindings
- `src/web/app/features/`: dashboard feature modules
- `src/web/app/styles/main.css`: active stylesheet entry
- `src/web/static/app.js`: legacy marker only
- `src/web/static/style.css`: legacy marker only

## Scripts

- `scripts/http-route-parity-regression.mjs`: extracted backend route parity checks
- `scripts/migration-compat-regression.mjs`: migration compatibility regression
- `scripts/sql-first-boot-regression.mjs`: SQL first-boot import regression
- `scripts/startup-smoke-regression.mjs`: server startup smoke
- `scripts/docker-startup-contract-regression.mjs`: startup ownership regression for the Docker entrypoint and runtime bootstrap
- `scripts/frontend-dom-smoke-regression.mjs`: dashboard DOM/router regression
- `scripts/frontend-saas-smoke-regression.mjs`: SaaS shell/router regression
- `scripts/frontend-test-console-smoke-regression.mjs`: test-console regression
- `scripts/frontend-quick-connect-regression.mjs`: quick-connect regression
- `scripts/frontend-style-entry-regression.mjs`: active asset/style entry regression
- `scripts/frontend-bootstrap-parity-regression.mjs`: frontend composition/bootstrap regression
- `scripts/docs-architecture-truth-regression.mjs`: maintainer docs truth regression
- `scripts/v1-specialty-surface-regression.mjs`: specialty v1 route and batch lifecycle regression

## HTTP Surface Summary

Gateway/core routes:

- `GET /`
- `GET /health`
- `GET /api/catalog`
- `GET /api/models/active`
- `POST /api/config/keys`
- `POST /api/models/refresh`
- `POST /api/health/check/:provider`
- `POST /api/health/check-all`
- `GET|DELETE /api/usage`
- `GET|PUT /api/compression`
- `GET /api/skills`
- `GET /api/skills/:id`
- `GET|POST /api/memory`
- `GET|DELETE /api/memory/:id`
- `GET /api/quota`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/completions`
- `POST /v1/responses` (stateless bridge)
- `POST /v1/responses/*` (native provider passthrough)
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/translations`
- `POST /v1/audio/speech`
- `POST /v1/videos/generations`
- `POST /v1/music/generations`
- `POST /v1/search`
- `POST /v1/rerank`
- `POST /v1/moderations`
- `GET|POST /v1/batches`
- `GET /v1/batches/:id`
- `POST /v1/batches/:id/cancel`
- `DELETE /v1/batches/:id`
- `DELETE /v1/batches/delete-completed`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- `GET|POST /v1/files`

SaaS routes:

- `POST /api/saas/bootstrap`
- `POST /api/saas/auth/register`
- `POST /api/saas/auth/login`
- `POST /api/saas/auth/logout`
- `GET /api/saas/auth/me`
- `GET|POST /api/saas/keys`
- `DELETE /api/saas/keys/:id`
- `GET /api/saas/usage`
- `GET /api/saas/account`
- `GET|POST /api/saas/admin/users`
- `PATCH|DELETE /api/saas/admin/users/:id`
- `GET /api/saas/admin/keys/:userId`
- `GET /api/saas/admin/usage`
- `GET|POST /api/saas/admin/tiers`
- `PATCH|DELETE /api/saas/admin/tiers/:id`

## Persistence Files

- Managed provider credentials: encrypted Postgres secret store (legacy `.agentrail/config.json` is migration-only)
- `.agentrail/usage.json`: aggregated local usage stats
- `.agentrail/models/*.json`: cached provider model catalogs
- `.agentrail/batches/index.json`: local Batch API metadata store
- `.agentrail/saas/db.json`: legacy SaaS import source plus fallback metadata when SQL is not enabled
