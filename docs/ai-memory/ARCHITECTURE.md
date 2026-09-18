# Architecture

Updated: 2026-07-20

## Purpose

This document explains the current AgentRail runtime so a maintainer can quickly find the right integration point without relying on stale monolithic entrypoints.

## System Overview

AgentRail is a local HTTP gateway that exposes OpenAI-compatible and Anthropic-compatible APIs on one localhost server, routes them to configured upstream providers, and serves a bundled browser console for management and optional SaaS flows.

```text
Client or coding agent
  -> src/http/create-server.ts
  -> request normalization / auth / route dispatch
  -> provider routing or management/SaaS handler
  -> response normalization
  -> local usage and optional SaaS usage recording
  -> response back to client
```

The runtime also includes:

- a bundled browser console under `src/web/app/`
- management APIs for catalog, health, config, and usage
- optional SaaS auth, keys, tiers, and usage accounting
- SQL migration/bootstrap support for clean installs and legacy import

## Runtime Components

### 1. Server entry and route dispatch

Primary files:

- `src/index.ts`
- `src/server.ts`
- `src/http/create-server.ts`
- `src/http/routes/*`

Responsibilities:

- start the HTTP server
- configure proxy/TLS behavior for outbound provider requests
- serve the bundled UI and static assets
- apply CORS, gateway auth, and management auth checks
- dispatch requests into route modules for OpenAI, Anthropic, management, models, config keys, static UI, and SaaS delegation

`src/server.ts` is now a thin compatibility wrapper. New HTTP behavior belongs under `src/http/`.

### 2. Routing core

Primary file:

- `src/router.ts`

Responsibilities:

- choose a provider for a requested model
- retry across multiple providers if one fails
- support multiple selection strategies
- implement `agentrail/auto` by selecting from healthy providers

### 3. Protocol translation

Primary files:

- `src/anthropic-bridge.ts`
- `src/responses-bridge.ts`
- `src/completions-bridge.ts`

Responsibilities:

- translate compatibility routes into the internal routing flow
- normalize routed responses back into client-facing wire formats
- handle streaming adapters where the upstream surface differs

### 4. Provider abstraction

Primary files:

- `src/providers/index.ts`
- `src/providers/base.ts`
- `src/providers/cohere.ts`
- `src/providers/timeout.ts`

Responsibilities:

- define supported providers and allowlisted models
- resolve canonical model IDs to upstream provider model IDs
- transform requests when a provider needs custom behavior
- enforce outbound request timeouts

### 5. Catalog, model registry, and health

Primary files:

- `src/catalog.ts`
- `src/models/registry.ts`
- `src/models/sync.ts`
- `src/models/*-sync.ts`
- `src/health.ts`

Responsibilities:

- build unified provider/model summaries for UI and APIs
- sync and cache provider model lists where supported
- track health state and feed it back into routing and dashboard summaries

### 6. Config, usage, and persistence

Primary files:

- `src/config.ts`
- `src/config-store.ts`
- `src/usage.ts`
- `src/usage-tracker.ts`
- `src/persistence/*`

Responsibilities:

- resolve provider keys from runtime state, environment, and managed secret storage
- persist managed credentials in the encrypted Postgres secret store
- persist local usage into `.agentrail/usage.json`
- run migrations and first-boot compatibility import for SQL-backed startup

Managed-key precedence remains:

```text
runtime key -> environment variable -> managed encrypted secret store
```

### 6b. Context compression, skills, memory, and quota

Primary files:

- `src/compression/config.ts`
- `src/compression/compress.ts`
- `src/skills/catalog.ts`
- `src/memory/store.ts`
- `src/quota/engine.ts`

Responsibilities:

- `src/compression/*`: persist context-compression settings and apply the message-history compression transform before routing
- `src/skills/catalog.ts`: expose an agent-ready skills catalog with copy-ready integration URLs
- `src/memory/store.ts`: persist conversational memory with FTS5 full-text search and tag indexing
- `src/quota/engine.ts`: hold provider quota config and compute per-provider headroom for the dashboard

These surfaces are read/written through management routes in `src/http/routes/management.ts` and rendered by dedicated dashboard feature modules.

### 7. SaaS/account module

Primary files:

- `src/saas/db.ts`
- `src/saas/postgres-db.ts`
- `src/saas/legacy-db.ts`
- `src/saas/types.ts`
- `src/saas/routes.ts`
- `src/saas/auth.ts`
- `src/saas/tiers.ts`
- `src/saas/rates.ts`

Responsibilities:

- register and authenticate users
- create and revoke per-user API keys
- enforce request/token limits by tier
- expose user, admin, usage, and tier-management routes
- record usage through the selected persistence backend

`src/saas/db.ts` is the backend selector only. Storage-specific logic belongs in `postgres-db.ts` or legacy helpers.

### 8. Browser console

Primary files:

- `src/web/templates/index.html`
- `src/web/templates/dashboard.html`
- `src/web/app/main.js`
- `src/web/app/bootstrap.js`
- `src/web/app/dashboard-app.js`
- `src/web/app/dashboard-render.js`
- `src/web/app/dashboard-bindings.js`
- `src/web/app/features/*`
- `src/web/app/styles/main.css`

Responsibilities:

- render the public shell and authenticated dashboard
- call management and SaaS APIs
- display provider health, model catalog, key configuration, usage, and test-console flows
- keep runtime wiring, render orchestration, and feature logic separate

`src/web/static/app.js` and `src/web/static/style.css` are legacy markers, not active entrypoints.

## Request Flow

### OpenAI-compatible request

```text
Client
  -> src/http/routes/openai.ts
     -> request validation / auth
     -> src/router.ts
        -> provider selection and retry
        -> provider adapter call
     -> src/usage.ts + src/usage-tracker.ts
     -> optional SaaS usage recording via selected db backend
  -> response to client
```

### Anthropic-compatible request

```text
Client
  -> src/http/routes/anthropic.ts
     -> src/anthropic-bridge.ts
     -> src/router.ts
     -> response bridge back to Anthropic wire shape
  -> response to client
```

### Management request

```text
Browser console or local client
  -> src/http/routes/management.ts | models.ts | config-keys.ts
     -> catalog / health / config / usage subsystems
  -> JSON response
```

### SaaS request

```text
Browser console or client
  -> src/http/routes/saas.ts
     -> src/saas/routes.ts
        -> auth/session checks
        -> selected SaaS persistence backend
  -> response to client
```

## Frontend Runtime Flow

```text
/static/dist/app.js
  -> src/web/app/main.js
  -> src/web/app/bootstrap.js
  -> src/web/app/dashboard-app.js
     -> create shared state
     -> create router
     -> create features
     -> create render orchestration
     -> bind DOM events
     -> run SaaS auth/bootstrap flow
```

Large dashboard areas are split by responsibility:

- providers: actions plus list/detail rendering
- test console: attachments, thread UI, request/stream handling
- SaaS admin: plans, users, usage

## State Boundaries

### In-memory state

- provider health state in `src/health.ts`
- round-robin index in `src/router.ts`
- runtime API keys in `src/config.ts`
- frontend dashboard state in `src/web/app/state.js`

### Persisted state

- encrypted Postgres secret store for managed provider credentials and API-key material
- `.agentrail/usage.json`
- `.agentrail/models/*.json`
- SQL-backed SaaS tables when configured
- `.agentrail/saas/db.json` as legacy import/fallback data source

### Environment-driven state

- provider API keys such as `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN`, etc.
- `AGENTRAIL_API_KEY`
- `AGENTRAIL_PROVIDER_TIMEOUT_MS`
- `HTTP_PROXY`
- `HOST`
- `PORT`
- SQL connection settings used by migrations/bootstrap

## Change Hotspots

### Add or adjust backend HTTP behavior

- `src/http/routes/*`
- `src/http/access.ts`
- `src/http/request-context.ts`
- `src/http/responses.ts`

### Change routing or provider fallback logic

- `src/router.ts`
- `src/health.ts`

### Change SQL/bootstrap behavior

- `src/persistence/*`
- `src/saas/db.ts`
- `src/saas/postgres-db.ts`
- `migrations/*`

### Change dashboard behavior

- `src/web/app/dashboard-app.js`
- `src/web/app/dashboard-render.js`
- `src/web/app/dashboard-bindings.js`
- `src/web/app/features/*`

## Risk Areas

- Backend route behavior is now distributed across `src/http/routes/*`; auth and response semantics should stay centralized in shared helpers.
- Dashboard behavior still depends directly on management/SaaS JSON contracts; route changes should be checked against `src/web/app/features/*`.
- Managed-key precedence and SaaS self-tier restrictions are compatibility-sensitive and already covered by focused regressions.
- Clean-install SQL startup depends on migrations and legacy import staying aligned.

## Recommended Reading Order For Agents

For general orientation:

1. `README.md`
2. `AGENTS.md`
3. `docs/ai-memory/PROJECT_INDEX.md`
4. `docs/ai-memory/STRUCTURE.md`
5. `docs/ai-memory/ARCHITECTURE.md`

For backend HTTP work:

1. `src/server.ts`
2. `src/http/create-server.ts`
3. `src/http/routes/*`
4. `src/router.ts`
5. `src/providers/index.ts`

For dashboard work:

1. `src/web/app/bootstrap.js`
2. `src/web/app/dashboard-app.js`
3. `src/web/app/features/*`
4. `docs/FRONTEND_DASHBOARD.md`

For SaaS/account work:

1. `src/http/routes/saas.ts`
2. `src/saas/routes.ts`
3. `src/saas/auth.ts`
4. `src/saas/db.ts`
5. `src/saas/postgres-db.ts`