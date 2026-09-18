# Project Index

Updated: 2026-07-20

## One-Sentence Summary

AgentRail is a localhost LLM gateway that normalizes OpenAI-style and Anthropic-style requests, routes them across configured providers, and exposes a bundled local browser console for keys, models, health, usage, and optional SaaS-style account management.

## Confirmed Stack

- Runtime: Node.js
- Language: TypeScript with `module: NodeNext`
- Transport: built-in HTTP server, `fetch`, `undici`
- Frontend: bundled dashboard assets built from `src/web/app/` and served through the static UI routes
- Persistence: encrypted Postgres for managed secrets and SQL-backed SaaS when configured, plus local JSON for non-secret runtime state

## What Is Functional Today

Confirmed from `README.md` and `src/`:

- OpenAI-compatible `POST /v1/chat/completions`
- OpenAI-compatible `POST /v1/completions`
- OpenAI Responses-compatible `POST /v1/responses` subset for Codex Desktop text and function-tool flows
- OpenAI-compatible `GET /v1/models`
- OpenAI-compatible `GET|POST /v1/files`
- Active-model capability inventory at `GET /api/models/active`
- Anthropic-compatible `POST /v1/messages`
- Anthropic-compatible `POST /v1/messages/count_tokens`
- Local web console served from `/` and `/dashboard`
- Provider API key management through env vars and runtime UI/API writes
- Provider catalog aggregation and model registry
- Provider health checks and health summary reporting
- Request routing with retries and provider selection strategies
- `agentrail/auto` model alias that selects from healthy providers
- Local usage normalization and persistence
- Optional gateway auth via `AGENTRAIL_API_KEY`
- Optional SaaS/account routes under `/api/saas/*`
- Context-compression settings and message-history compression transform
- Agent-ready skills catalog with copy-ready integration URLs
- Persistent conversational memory with FTS5 full-text search and tag indexing
- Provider quota config and per-provider headroom reporting

## System Schematic

```text
External client
  -> http://localhost:42424
  -> src/http/create-server.ts
     -> static UI routes (/ and dashboard shells)
     -> management API (/api/catalog, /api/config/keys, /api/health/*, /api/usage)
     -> compatibility API
        -> OpenAI path: /v1/chat/completions, /v1/completions, /v1/responses, /v1/models, /v1/files
        -> Anthropic path: /v1/messages, /v1/messages/count_tokens
     -> optional SaaS path: /api/saas/*

Compatibility API
  -> protocol bridges such as src/responses-bridge.ts and src/completions-bridge.ts
  -> src/router.ts
  -> provider discovery from src/providers/index.ts
  -> provider request transform in src/providers/base.ts or specialized provider classes
  -> outbound fetch to provider endpoint
  -> usage normalization in src/usage.ts
  -> optional local usage persistence in src/usage-tracker.ts
  -> optional SaaS usage record in the selected src/saas/db.ts backend
```

## Major Subsystems

- HTTP composition: request parsing, auth, CORS, static assets, route dispatch under `src/http/`
- Routing core: provider selection, retries, `agentrail/auto`, health-aware routing
- Provider registry: hardcoded allowlists plus optional synced model caches
- Catalog and health: unified provider/model summaries for the console
- Usage: normalized usage objects even when upstream providers differ
- SaaS mode: session auth, user tiers, per-user API keys, quota tracking
- Frontend runtime: `src/web/app/` composition, feature modules, and bundled assets

## Notable Implementation Characteristics

- Managed secrets live in encrypted Postgres when configured; non-secret runtime state still remains under `.agentrail/`.
- Provider definitions are mostly hardcoded in `src/providers/index.ts`.
- The active UI runtime is bundled from `src/web/app/`; `src/web/static/app.js` and `src/web/static/style.css` are legacy markers only.
- Health state is stored in-memory and refreshed by explicit checks.
- SaaS sessions are persisted through the active DB backend and are not in-memory only.

## Current Documentation Map

- `README.md`: user-facing product overview and setup
- `docs/agents/`: client-specific integration guides
- `docs/providers/`: provider-specific setup notes
- `docs/ai-memory/`: maintainer/agent orientation files
- `docs/ai-memory/PROJECT_INDEX.md`: top-down runtime map and reading order
- `docs/ai-memory/STRUCTURE.md`: subsystem and route map
- `docs/ai-memory/ARCHITECTURE.md`: request flows, subsystem boundaries, persistence map, and change hotspots