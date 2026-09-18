<h1 align="center">AgentRail</h1>

<p align="center">
  <strong>One local gateway for Claude Code, Codex, Cline, Continue, and other AI tools, powered by your own provider keys.</strong>
</p>

<p align="center">
  Bring your own keys. Keep them local. Expose one stable OpenAI- and Anthropic-compatible endpoint on <code>http://localhost:42424</code>.
</p>

<p align="center">
  <strong>Star us&nbsp;→</strong>
  <a href="https://github.com/vzubcu/AgentRail" title="Star AgentRail on GitHub">
    <img src="https://img.shields.io/github/stars/vzubcu/AgentRail?style=for-the-badge&logo=github&label=Star&color=4ade80&labelColor=0b0f0d" alt="Star AgentRail on GitHub" height="28" align="absmiddle" />
  </a>
  &nbsp;·&nbsp;
  <a href="#quick-start" title="Jump to Quick Start">
    <img src="https://img.shields.io/badge/Quick%20Start-5%20Steps-60a5fa?style=for-the-badge&labelColor=0b0f0d" alt="Quick Start in 5 steps" height="28" align="absmiddle" />
  </a>
  &nbsp;·&nbsp;
  <a href="./docs/agents/" title="Read AgentRail agent setup guides">
    <img src="https://img.shields.io/badge/Agent%20Guides-Docs-60a5fa?style=for-the-badge&labelColor=0b0f0d" alt="AgentRail agent setup guides" height="28" align="absmiddle" />
  </a>
  &nbsp;·&nbsp;
  <a href="https://vzubcu.github.io/AgentRail/" title="Open the AgentRail project page">
    <img src="https://img.shields.io/badge/Homepage-AgentRail-4ade80?style=for-the-badge&labelColor=0b0f0d" alt="AgentRail homepage" height="28" align="absmiddle" />
  </a>
  &nbsp;·&nbsp;
  <a href="./LICENSE" title="AgentRail is MIT licensed">
    <img src="https://img.shields.io/badge/License-MIT-f0a500?style=for-the-badge&labelColor=0b0f0d" alt="MIT License" height="28" align="absmiddle" />
  </a>
</p>

<p align="center">
  <img src="./Assets/Head.png" alt="AgentRail current public page showing the local AI gateway entry and dashboard access" width="900" />
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a>
  ·
  <a href="./CONTRIBUTING.md">Contributing</a>
  ·
  <a href="./contribution.md">中文贡献指南</a>
</p>

## Why Star AgentRail

- **One local endpoint for AI tools** across OpenAI- and Anthropic-compatible workflows.
- **BYOK and local-first** with no hosted proxy and no shared key pool.
- **Fallback routing** when a provider or route is unavailable or rate-limited.
- **Works with popular coding tools** like Claude Code, Codex, Continue, Cline, Roo Code, Kilo Code, and OpenCode.
- **Real dashboard included** for provider keys, model catalogs, health checks, routing tests, and a dedicated Quick Connect tab.
- **Built for the moving free-tier ecosystem** without pretending AgentRail itself is a hosted free API.

> AgentRail does not provide free API access. It helps you operate the provider keys you already have through one local API surface.

## Quick Start

### 1. Run from source today

```bash
git clone https://github.com/vzubcu/AgentRail.git
cd AgentRail
npm install
npm run build
npm start
```

### 2. Open the dashboard

- `http://localhost:42424/`

### 3. Add provider keys

Configure one or more supported provider keys from the **Providers** tab. AgentRail can rotate multiple keys for the same provider across outbound chat requests.

### 4. Point your tool at AgentRail

- OpenAI-compatible clients: `http://localhost:42424/v1`
- Anthropic-compatible clients: `http://localhost:42424`

Detailed setup guides live in [`docs/agents/`](./docs/agents/).

## Works With

AgentRail is designed for tools that can call local custom OpenAI- or Anthropic-compatible endpoints directly:

- Claude Code
- Codex CLI / Codex Desktop
- Continue
- Cline
- Roo Code
- Kilo Code
- OpenCode
- Aider and other local-capable OpenAI-compatible clients

## Why It Matters

The free-model ecosystem changes fast: providers, quotas, compatibility, and route availability shift constantly. AgentRail gives local tools one stable base URL while keeping your keys local and letting the gateway absorb provider churn for you.

## What AgentRail Provides

- **Protocol normalization** for OpenAI-compatible and Anthropic-compatible clients.
- **Fallback routing** when one provider or route fails.
- **Model discovery** across supported providers with a unified chat-capable surface. Gemini and Google catalog sync only expose models that support `generateContent`; Interactions-only and media-generation models stay out of chat selectors.
- **Runtime key management** through the dashboard or REST API, without restarts.
- **Health checks and remembered state** so provider status and model availability recover more gracefully after restarts.
- **Quick Connect setup flows** for popular coding tools without storing gateway secrets on disk.
- **Virtual models** with preview, dry-run testing, clone, templates, traces, sticky routing, weighted pools, fallback-only members, and cooldown-aware pruning.
- **Context compression** to keep long chat histories within provider limits by dropping oldest messages or truncating oversized parts.
- **Agent skills catalog** with one-click copy URLs for wiring local skills into AI clients.
- **Persistent memory** with full-text (FTS5) search and tag indexing for conversational recall across sessions.
- **Provider quota headroom** so you can see remaining request/token budget per provider at a glance.

## Development Modes

### Mode A: Full Docker (recommended)

```bash
git clone https://github.com/vzubcu/AgentRail.git
cd AgentRail
docker compose up -d
```

### Mode B: Hybrid (Postgres in Docker, app on host)

```bash
git clone https://github.com/vzubcu/AgentRail.git
cd AgentRail
docker compose -f docker-compose.db.yml up -d
set AGENTRAIL_SECRETS_DATABASE_URL=<your_postgres_connection_string>
set AGENTRAIL_SECRET_ENCRYPTION_KEY=<your_local_encryption_key>
set AGENTRAIL_SAAS=1
npm install
npm run build
npm start
```

### Mode C: Completely local (no Docker, no Postgres)

```bash
git clone https://github.com/vzubcu/AgentRail.git
cd AgentRail
npm install
set AGENTRAIL_SAAS=1
npm run build
npm start
```

> When Postgres is not configured, local state is persisted in `.agentrail/*.json` files.

## Supported Providers

Currently wired through `src/providers/index.ts`:

`openrouter`, `groq`, `github`, `reka`, `google`, `cloudflare`, `siliconflow`, `cerebras`, `mistral`, `nous-research`, `openadapter`, `tokenrouter`, `bluesminds`, `cohere`, `nvidia`, `llm7`, `kilo`, `zhipu`, `opencode`, `zenmux`

## Current Capabilities

### Compatibility layer

- OpenAI-compatible chat completions
- OpenAI-compatible legacy completions endpoint (`/v1/completions`)
- OpenAI Responses API compatibility subset for Codex Desktop, including multimodal image input, PDF-to-text attachment preprocessing, and the `agentrail/files` virtual model for native file-input routes
- Local OpenAI-compatible file storage surface for upload, list, download, and delete (`/v1/files`)
- OpenAI-compatible model listing for chat-capable routes only
- Active-model capability catalog for dashboard/internal use
- Anthropic-compatible messages API bridging
- Stable non-stream usage normalization across OpenAI-compatible and Anthropic-compatible responses
- Conservative Anthropic streaming behavior without fake zero-usage placeholders

### Gateway operations

- Provider health checks and status summaries
- Model catalog refresh and cache fallback
- Local runtime key management
- Optional gateway auth with `AGENTRAIL_API_KEY`
- Scoped SaaS API keys for capability-restricted access such as `chat`, `vision`, or `embeddings`
- Optional outbound proxy support with `HTTP_PROXY`

### Local console

- Browse providers and models
- Check provider health and latency
- Configure provider keys
- Refresh model catalogs
- Build and operate virtual models with preview, dry-run test, templates, clone, stats, traces, prune, and auto-protection cooldown visibility
- Test local requests from the browser, including image attachments and PDF extraction on `/test`

## Configure Your Agent

AgentRail exposes both OpenAI-compatible and Anthropic-compatible local endpoints. Detailed setup guides are available in [`docs/agents/`](./docs/agents/).

- [OpenRouter Provider Setup](./docs/providers/openrouter.md)
- [Local endpoint and remote proxy limitations](./docs/agents/local-endpoints-and-remote-proxies.md)
- [Claude Code setup guide](./docs/agents/claude-code.md)
- [Codex CLI setup guide](./docs/agents/codex-cli.md)
- [OpenCode setup guide](./docs/agents/opencode.md)
- [Continue setup guide](./docs/agents/continue.md)
- [Cline setup guide](./docs/agents/cline.md)
- [Roo Code setup guide](./docs/agents/roo-code.md)
- [Kilo Code setup guide](./docs/agents/kilo-code.md)
- [Codex Desktop setup guide](./docs/agents/codex-desktop.md)
- [Aider integration guide](./docs/agents/aider.md)
- [Rider / Junie guide](./docs/agents/rider-junie.md)

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:42424
export ANTHROPIC_API_KEY=<your AGENTRAIL_API_KEY or any non-empty string>
```

### Codex CLI

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
codex --profile agentrail-auto
```

### OpenAI-compatible tools

Use:

- Base URL: `http://localhost:42424/v1`
- API key: your `AGENTRAIL_API_KEY`, or any non-empty value if gateway auth is disabled

### Anthropic-compatible tools

Use:

- Base URL: `http://localhost:42424`
- API key: your `AGENTRAIL_API_KEY`, or any non-empty value if gateway auth is disabled

## Local Security Model

AgentRail binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you intentionally want LAN access.

Browser CORS is limited to same-machine localhost origins. Management endpoints such as key configuration, model refresh, provider health checks, and usage clearing reject non-local browser origins. If `AGENTRAIL_API_KEY` is configured, management endpoints and `/v1/*` API calls must include `Authorization: Bearer <AGENTRAIL_API_KEY>` or `x-api-key: <AGENTRAIL_API_KEY>`.

In SaaS mode, browser sessions use `HttpOnly` cookies with `SameSite=Strict`, persistent server-side session records, CSRF protection on mutating SaaS routes, and login throttling. SaaS API keys are stored hash-only and their plaintext value is shown only once at creation time.

## Common Environment Variables

| Variable | Purpose |
|---|---|
| `AGENTRAIL_API_KEY` | Optional gateway auth key for clients calling AgentRail |
| `AGENTRAIL_PROVIDER_TIMEOUT_MS` | Optional outbound provider request timeout in milliseconds (default: `30000`) |
| `AGENTRAIL_DEBUG_TRACE` | Set to `1` to print request, auth, route, and upstream provider diagnostic logs with per-request IDs and redacted secrets |
| `AGENTRAIL_SECRETS_DATABASE_URL` | Postgres connection string for encrypted managed secrets |
| `AGENTRAIL_SECRET_ENCRYPTION_KEY` | Symmetric encryption key source for provider credentials at rest |
| `AGENTRAIL_FILES_ROOT` | Optional override for the local file store root directory (`.agentrail/files` by default) |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `GROQ_API_KEY` | Groq key |
| `GITHUB_TOKEN` | GitHub Models token |
| `REKA_API_KEY` | Reka API key |
| `GEMINI_API_KEY` | Google AI Studio Gemini API key |
| `CLOUDFLARE_API_KEY` | Cloudflare API key |
| `CLOUDFLARE_ACCOUNT_ID` | Required for Cloudflare model sync |
| `SILICONFLOW_API_KEY` | SiliconFlow key |
| `CEREBRAS_API_KEY` | Cerebras key |
| `MISTRAL_API_KEY` | Mistral key |
| `NOUS_RESEARCH_API_KEY` | Nous Research API key |
| `OPENADAPTER_API_KEY` | OpenAdapter API key |
| `TOKENROUTER_API_KEY` | TokenRouter API key |
| `BLUESMINDS_API_KEY` | BluesMinds API key |
| `COHERE_API_KEY` | Cohere key |
| `NVIDIA_API_KEY` | NVIDIA NIM key |
| `LLM7_API_KEY` | LLM7 key |
| `KILO_API_KEY` | Kilo key |
| `ZHIPU_API_KEY` | Zhipu / BigModel key |
| `OPENCODE_API_KEY` | OpenCode key |
| `HTTP_PROXY` | Optional global HTTP proxy for outbound provider calls |

## API Examples

### OpenAI-compatible chat completion

```bash
curl http://localhost:42424/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENTRAIL_API_KEY" \
  -d '{
    "model": "llama-3.3-70b",
    "messages": [{"role": "user", "content": "Say hello from AgentRail"}],
    "stream": false
  }'
```

### OpenAI Responses-compatible request

```bash
curl http://localhost:42424/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENTRAIL_API_KEY" \
  -d '{
    "model": "llama-3.3-70b",
    "input": "Say hello from AgentRail"
  }'
```

### Anthropic-compatible messages request

```bash
curl http://localhost:42424/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENTRAIL_API_KEY" \
  -d '{
    "model": "llama-3.3-70b",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Web console |
| `GET` | `/health` | Service health |
| `GET` | `/api/catalog` | Provider / model / health summary |
| `GET` | `/api/models/active` | Active models with capability metadata |
| `POST` | `/api/health/check/:provider` | Check one provider |
| `POST` | `/api/health/check-all` | Check all providers synchronously |
| `POST` | `/api/health/check-all?async=1` | Start all-provider health checks in the background |
| `GET` | `/api/health/check-all/status` | Read all-provider health check job status |
| `POST` | `/api/models/refresh` | Refresh provider model lists |
| `POST` | `/api/models/refresh/:provider` | Refresh one provider model list |
| `POST` | `/api/config/keys` | Save runtime / persisted keys |
| `GET` | `/api/config/keys/summary` | Masked provider key summaries |
| `POST` | `/api/config/keys/:envVar` | Add one provider key |
| `DELETE` | `/api/config/keys/:envVar` | Remove all managed provider keys |
| `DELETE` | `/api/config/keys/:envVar/:fingerprint` | Remove one managed provider key |
| `GET` | `/api/virtual-models` | List saved virtual models |
| `GET` | `/api/virtual-models/candidates` | List backing-model candidates for the editor |
| `GET` | `/api/virtual-models/templates` | List starter templates for virtual models |
| `POST` | `/api/virtual-models` | Create a virtual model |
| `POST` | `/api/virtual-models/preview` | Preview candidate eligibility and suggested routing |
| `POST` | `/api/virtual-models/test` | Dry-run or test a virtual model route |
| `PUT` | `/api/virtual-models/:id` | Update a virtual model |
| `DELETE` | `/api/virtual-models/:id` | Delete a virtual model |
| `POST` | `/api/virtual-models/:id/clone` | Clone a saved virtual model |
| `GET` | `/api/virtual-models/:id/stats` | Read usage and health-aware member stats |
| `POST` | `/api/virtual-models/:id/prune-unhealthy` | Preview or apply removal of currently unhealthy members |
| `GET` | `/api/virtual-models/:id/trace` | List recent route traces for one virtual model |
| `GET` | `/api/virtual-models/:id/trace/:traceId` | Read one virtual-model route trace |
| `GET` | `/api/compression` | Current context-compression settings |
| `PUT` | `/api/compression` | Update context-compression settings |
| `GET` | `/api/skills` | Agent-ready skills catalog |
| `GET` | `/api/skills/:id` | One skill entry with copy-ready URL |
| `GET` | `/api/memory` | List persistent memory entries |
| `POST` | `/api/memory` | Add a memory entry (content + tags) |
| `GET` | `/api/memory/:id` | Read one memory entry |
| `DELETE` | `/api/memory/:id` | Delete a memory entry |
| `GET` | `/api/quota` | Provider quota config and per-provider headroom |
| `GET` | `/v1` and `/v1/models` | Active OpenAI-compatible model discovery across all capabilities |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |
| `POST` | `/v1/completions` | Legacy OpenAI completions compatibility |
| `POST` | `/v1/files` | Upload a local file record |
| `GET` | `/v1/files` | List uploaded local files |
| `GET` | `/v1/files/:id` | Fetch file metadata |
| `GET` | `/v1/files/:id/content` | Download file content |
| `DELETE` | `/v1/files/:id` | Delete scoped file metadata and physical content |
| `POST` | `/v1/responses` | Stateless OpenAI Responses-compatible text and function-tool subset |
| `POST` | `/v1/responses/*` | Native provider passthrough for Responses subpaths |
| `POST` | `/v1/audio/translations` | Multipart audio translation proxy |
| `GET, POST, DELETE` | `/v1/batches*` | Scoped OpenAI-compatible batch lifecycle |
| `POST` | `/v1/messages` | Anthropic-compatible messages |

Successful routed chat responses also include `X-AgentRail-Provider` and `X-AgentRail-Route-Model` headers so local tools can see which concrete route answered the request.

## Project Structure

```text
src/
  index.ts                # Entry point
  server.ts               # Thin wrapper that configures outbound HTTP and re-exports the HTTP server
  http/                   # Request context, auth/access checks, route modules, and server composition
  router.ts               # Provider routing and retry logic
  providers/              # Provider definitions and model sync orchestration
  models/                 # Canonical model registry + sync/cache adapters
  web/                    # Console UI (HTML/CSS/JS)
  config*.ts              # Runtime + persisted key config
  health.ts               # Provider health checks and summary
  anthropic-bridge.ts     # Anthropic <-> OpenAI request/response bridge
  responses-bridge.ts     # Responses API <-> internal chat compatibility bridge
  usage.ts                # Gateway-level usage normalization helpers
```

## Development

```bash
npm run dev
npm run web:build
npm run migrate:latest
npm run build
npm start
npm run test:virtual-models-ui
npm run test:virtual-models
npm run test:usage
```

For Docker and other clean installs backed by Postgres, AgentRail runs migrations before startup. On an existing workspace, the first SQL-backed boot imports legacy SaaS data from `.agentrail/saas/db.json` if the SQL tables are still empty. Provider health restores the last persisted snapshot from `.agentrail/provider-health.json` during boot, marks those entries stale, and revalidates configured providers in the background so healthy providers and active-model surfaces repopulate automatically after a restart.

Backend routing lives under `src/http/`. Dashboard frontend code boots from `src/web/app/main.js`, with feature slices under `src/web/app/features/` and the stylesheet entry at `src/web/app/styles/main.css`.

## Maintainer Notes

- Backend HTTP composition guide: [docs/HTTP_ROUTING.md](./docs/HTTP_ROUTING.md)
- Frontend dashboard structure: [docs/FRONTEND_DASHBOARD.md](./docs/FRONTEND_DASHBOARD.md)

## Contributing

- English: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 中文: [contribution.md](./contribution.md)

## License

MIT


