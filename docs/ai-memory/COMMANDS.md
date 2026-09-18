# Commands

Updated: 2026-06-24

## Package Manager Detection

Confirmed manifests:

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `docker-compose.yml`

The repository contains both npm and pnpm lockfiles. `README.md` uses `npm`, so prefer `npm` unless the task or maintainer explicitly asks for `pnpm`.

## Primary Commands

- Install: `npm install`
- Build: `npm run build`
- Start compiled server: `npm start`
- Watch TypeScript: `npm run dev`

## Targeted Validation

- Compatibility regression: `npm run test:compat`
- Security regression: `npm run test:security`
- Usage regression: `npm run test:usage`

## Docker-Aware Files

- `Dockerfile`
- `docker-compose.yml`
- `docker-entrypoint.sh`

Use Docker-aware workflows when the task is about packaging or container runtime behavior. For ordinary TypeScript or docs work, local commands are enough.

## Validation Guidance

- Docs-only changes: no code tests required; say that explicitly.
- Routing/provider changes: run at least the most relevant regression script.
- Broad gateway changes: run `npm run build` first, then targeted regressions.
- SaaS/auth changes: no dedicated npm script is declared; inspect helper scripts under `scripts/` and state what was or was not verified.

## Command Evidence

- `package.json` scripts: `build`, `dev`, `start`, `test:compat`, `test:security`, `test:usage`
- `README.md` quick start uses `npm install`, `npm run build`, `npm start`
