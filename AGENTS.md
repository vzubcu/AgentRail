# AgentRail Agent Guide

## Purpose

AgentRail is a local Node.js/TypeScript gateway that exposes OpenAI-compatible and Anthropic-compatible HTTP endpoints on `localhost`, then routes requests to configured third-party LLM providers.

This repository also includes:

- a local browser console under `src/web/`
- provider/model catalog and health checks
- local config and usage persistence under `.agentrail/`
- an in-repo SaaS/account module under `src/saas/`

## Start Here

Read these files first before changing behavior:

1. `README.md`
2. `package.json`
3. `src/server.ts`
4. `src/router.ts`
5. `src/providers/index.ts`
6. `docs/ai-memory/PROJECT_INDEX.md`
7. `docs/ai-memory/STRUCTURE.md`

## Working Agreements

- Prefer minimal, reversible changes.
- Respect existing TypeScript and file-organization conventions.
- Do not refactor provider definitions or routing behavior unless the task requires it.
- Treat uncommitted local changes as user work unless you created them yourself.
- Keep docs updates close to code changes when behavior or workflows change.

## Architecture Snapshot

High-level request flow:

```text
LLM client / browser
    -> src/server.ts
    -> auth / CORS / body parsing / static UI routing
    -> protocol branch:
       - /v1/chat/completions -> src/router.ts -> src/providers/*
       - /v1/messages         -> src/anthropic-bridge.ts -> src/router.ts -> src/providers/*
       - /api/*               -> catalog / health / config / usage / saas modules
    -> response normalization
    -> local usage tracking / optional SaaS usage recording
```

State and persistence:

- `.agentrail/config.json`: persisted provider keys configured from the UI/API
- `.agentrail/usage.json`: local usage aggregates
- `.agentrail/models/*.json`: provider model cache
- `.agentrail/saas/db.json`: file-backed SaaS users, keys, tiers, and daily usage

## Important Areas

- `src/server.ts`: main HTTP surface, static console serving, auth gates, OpenAI/Anthropic compatibility routes
- `src/router.ts`: provider selection, retries, `agentrail/auto` behavior
- `src/providers/`: provider registry and request adapters
- `src/models/`: provider model sync/cache registry
- `src/health.ts`: provider health state machine
- `src/config.ts` + `src/config-store.ts`: runtime vs persisted key handling and timeout config
- `src/usage.ts` + `src/usage-tracker.ts`: usage normalization and local persistence
- `src/saas/`: optional multi-user auth, API keys, tiers, and rate/usage tracking
- `src/web/`: static admin console

## Graphify Workflow

- Prefer `graphify query`, `graphify explain`, `graphify path`, and `graphify summary` before broad `rg` scans or opening many files.
- Use the graph first for codebase questions, architecture tracing, runtime-route discovery, and impact estimation.
- After relevant code, routing, provider, model, SaaS, or frontend changes, run `graphify update .` before finalizing the task.
- Git hooks help after commit and checkout, but they do not cover uncommitted local edits; manual `graphify update .` is still required before completion.
- Keep `.graphifyignore` focused on code and runtime surfaces so the graph stays high-signal and token-efficient.

## Commands

- Install: `npm install`
- Build: `npm run build`
- Run compiled server: `npm start`
- TypeScript watch: `npm run dev`
- Compatibility regression: `npm run test:compat`
- Security regression: `npm run test:security`
- Usage regression: `npm run test:usage`
- Graph refresh: `npm run graph:update`
- Graph freshness check: `npm run graph:check`
- Graph scope preview: `npm run graph:scope`

Use targeted validation first. For docs-only changes, code tests are usually not required; say so explicitly.

## Change Guidance

- When editing API behavior, inspect both `README.md` and `docs/agents/` for externally documented behavior.
- When editing provider routing, inspect `src/router.ts`, `src/providers/index.ts`, and model registry/sync code together.
- When editing UI state or console endpoints, verify the matching `/api/*` route in `src/server.ts` or `src/saas/routes.ts`.
- When editing SaaS behavior, remember that persistence is file-backed JSON, not a real database.

## Agent-Specific Notes

- `docs/agents/` contains end-user setup guides for external coding agents.
- `docs/ai-memory/` is the maintainer-oriented memory pack for future AI coding sessions in this repo.
- If your environment exposes Superpowers-style skills, the most relevant ones here are project orientation, systematic debugging, verification before completion, and code review workflows.