# HTTP Routing Layout

AgentRail backend routing is now composed under `src/http/`.

## Entry Points

- `src/server.ts`: thin wrapper that configures outbound HTTP once and re-exports `createServer()` / `startServer()`.
- `src/http/create-server.ts`: owns `http.createServer(...)`, preflight handling, central route registration, and top-level error handling.

## Shared Backend Utilities

- `src/http/config.ts`: runtime server config, web roots, route-path sets, allowed env vars.
- `src/http/types.ts`: shared route-handler interfaces.
- `src/http/request-context.ts`: normalized request URL/pathname, body readers, JSON parsing, and CORS helpers.
- `src/http/responses.ts`: JSON/text/stream/no-content response helpers.
- `src/http/access.ts`: gateway auth, catalog auth, management auth, SaaS admin-session checks, and capability-to-route mapping for scoped keys.
- `src/http/provider-sync.ts`: provider refresh helper used by config-key flows.
- `src/http/outbound-http.ts`: global undici/proxy/TLS setup.

## Route Modules

- `src/http/routes/static-ui.ts`: `/`, dashboard shells, and `/static/*` asset serving.
- `src/http/routes/saas.ts`: delegation for `/api/saas/*` into the existing SaaS route handler.
- `src/http/routes/management.ts`: `/api/catalog`, `/api/health/*`, `/api/usage`, `/api/agents/*`, `/api/compression`, `/api/skills`, `/api/memory`, `/api/quota`, and `/health`.
- `src/http/routes/models.ts`: `/api/models/*` and `GET /v1/models`.
- `src/http/routes/config-keys.ts`: `/api/config/keys*`.
- `src/http/routes/openai.ts`: `/v1/chat/completions`, `/v1/completions`, the stateless `/v1/responses` bridge, native `/v1/responses/*` passthrough, and scoped `/v1/files*`.
- `src/http/routes/specialty.ts`: `/v1/embeddings`, `/v1/images/*`, `/v1/audio/*`, `/v1/videos/generations`, `/v1/music/generations`, `/v1/search`, `/v1/rerank`, `/v1/moderations`, and scoped `/v1/batches*` lifecycle routes.
- `src/http/routes/anthropic.ts`: `/v1/messages*`.

## Diagnostics

Set `AGENTRAIL_DEBUG_TRACE=1` to print structured trace lines for agent-facing requests. Each request gets a `requestId`, and the logs include request entry/exit, status, duration, auth outcome, protocol bridge details, selected provider, route model, and upstream provider status or connection error.

Trace payloads intentionally avoid request bodies, prompts, uploaded file content, cookies, API-key values, and authorization headers. Auth logs report key type, length, SaaS user/key ids, scopes, and failure reason so rate-limit, missing-key, and capability-scope issues can be diagnosed without exposing secrets.

## Change Guidance

- Add new backend HTTP surfaces in `src/http/routes/*`, not in `src/server.ts`.
- Keep auth decisions in `src/http/access.ts` so route modules stay behavior-focused.
- Keep request/response helper behavior centralized in `request-context.ts` and `responses.ts`.
- The frontend runtime now lives under `src/web/app/`; keep backend route work decoupled from that frontend module tree and its bundled `/static/dist/*` assets.
