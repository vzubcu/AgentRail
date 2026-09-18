# Dashboard Frontend Layout

AgentRail dashboard frontend code enters through `src/web/app/main.js` and composes the runtime from `src/web/app/dashboard-app.js`.

## Structure

- `src/web/app/main.js`: Vite entrypoint for dashboard assets.
- `src/web/app/bootstrap.js`: startup wrapper with top-level error handling.
- `src/web/app/dashboard-app.js`: runtime composition root that wires state, router, features, and SaaS auth flows.
- `src/web/app/dashboard-render.js`: shared render orchestration for catalog-driven refreshes.
- `src/web/app/dashboard-bindings.js`: global dashboard DOM/event bindings.
- `src/web/app/lib/`: shared browser helpers such as HTTP, DOM, routing, and stream parsing.
- `src/web/app/features/`: extracted feature modules for overview, providers, models, usage, keys, test console, quick connect, skills, memory, compression, quota, and SaaS screens.
- `src/web/app/features/providers/`: provider actions plus list/detail rendering.
- `src/web/app/features/test-console/`: attachment, thread, and request/stream handling.
- `src/web/app/features/saas-admin/`: plan, user, and usage admin modules.
- `src/web/app/features/virtual-models.js`: dashboard editor for create/edit/delete plus preview, test, templates, clone, stats, prune, trace, and cooldown-aware member visibility.
- `src/web/app/styles/main.css`: stylesheet entry imported by the Vite bundle.
- `src/web/app/styles/`: shared tokens, shell styles, and feature-scoped stylesheets.
- `src/web/static/quick-connect.js`: legacy placeholder kept only to document that the active runtime moved into `src/web/app/`.
- `src/web/static/style.css`: legacy marker kept out of the active template path.

## Current Split

- Tabs and history routing go through `src/web/app/lib/router.js`, including the dedicated `/quick-connect` dashboard surface.
- The active dashboard bootstrap no longer initializes directly through `legacy-app.js`.
- `legacy-app.js` is now a compatibility shim that delegates to `dashboard-app.js`.
- Large dashboard surfaces are split by responsibility instead of one-file orchestration:
  - providers: actions, list rendering, detail rendering
  - test console: attachments, thread UI, request/stream flow
  - SaaS admin: plans, users, usage
  - virtual models: editor state, candidate selection, preview/test, stats/prune, and route trace views
- Active styles build from `src/web/app/styles/main.css`, with public-shell, dashboard-shell, and feature CSS modules.
- Public and dashboard templates load only `/static/dist/app.css` and `/static/dist/app.js`.

## Virtual Models Surface

- The virtual-models tab is owned by `src/web/app/features/virtual-models.js` and talks to `/api/virtual-models*` routes for runtime-backed operations.
- The editor currently exposes create/edit/delete, starter templates, clone, routing preview, dry-run test, stats, prune-unhealthy, and recent trace inspection.
- Member rows now use authoring-first controls: provider/model add flow, drag-plus-arrow reorder, collapsed advanced controls, and live state chips for cooldown, fallback, and disablement.
- Keep new virtual-model dashboard work in this feature module unless the change is genuinely cross-feature runtime wiring.

## Change Guidance

- Add new dashboard behavior under `src/web/app/`, not `src/web/static/app.js`.
- Put cross-feature runtime wiring in `dashboard-app.js`, `dashboard-render.js`, or `dashboard-bindings.js` instead of rebuilding a large compatibility hub.
- Extend feature behavior inside the nearest feature subdirectory before growing wrapper files.
- Add new styles under `src/web/app/styles/`, not back into `src/web/static/style.css`.
- Keep DOM IDs and route paths stable unless the matching runtime wiring is updated in the same change.
- Prefer focused regression scripts for dashboard behavior instead of relying only on manual smoke.
- Frontend runtime regressions now include `node scripts/frontend-bootstrap-parity-regression.mjs` in addition to the existing dashboard smoke scripts.
- Virtual-model dashboard verification should use `npm run test:virtual-models-ui`; the script intentionally logs a duplicate-alias save failure while still passing when the regression expectations hold.

