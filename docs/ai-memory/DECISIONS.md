# Decisions

Updated: 2026-06-24

## Confirmed Decisions From Code

### 1. Local-first gateway

- The server binds to `127.0.0.1` by default.
- The product is designed around a localhost base URL instead of a hosted proxy.

### 2. Dual compatibility surface

- OpenAI-style and Anthropic-style routes are both supported.
- Anthropic requests are bridged into the internal routing flow instead of using a separate provider stack.

### 3. Provider abstraction is simple and explicit

- Providers are registered in code with allowlisted models.
- Most providers inherit the generic OpenAI-style base adapter.
- Special behavior is implemented only where needed, such as Cohere.

### 4. Persistence favors simple JSON files

- Runtime state that must survive restarts is stored under `.agentrail/`.
- No relational database is required for core gateway or SaaS mode.

### 5. SaaS mode is optional and file-backed

- SaaS/account routes live under `src/saas/`.
- Session tokens are held in memory.
- User records, tiers, sessions, usage, and API-key metadata are stored in `.agentrail/saas/db.json`, while SaaS API key material is stored hash-only in Postgres.

## Open Questions / Needs Verification

- Whether npm or pnpm is the intended maintainer default, because both lockfiles exist
- Whether SaaS mode is production-targeted or still experimental
- Whether all provider model allowlists are expected to be manually curated long term

## Update Rule

When changing architecture, add:

- date
- decision
- reason
- affected files
- follow-up verification required
