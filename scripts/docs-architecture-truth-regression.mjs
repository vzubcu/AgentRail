import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const structure = await readFile(new URL('../docs/ai-memory/STRUCTURE.md', import.meta.url), 'utf8');
const architecture = await readFile(new URL('../docs/ai-memory/ARCHITECTURE.md', import.meta.url), 'utf8');
const projectIndex = await readFile(new URL('../docs/ai-memory/PROJECT_INDEX.md', import.meta.url), 'utf8');

assert.match(structure, /src\/http\//, 'STRUCTURE.md should describe src/http/ as the active backend composition area');
assert.match(structure, /src\/web\/app\/main\.js/, 'STRUCTURE.md should describe src/web/app/main.js as the active frontend entrypoint');
assert.doesNotMatch(structure, /src\/server\.ts`: main HTTP server and route dispatcher/, 'STRUCTURE.md should not describe src/server.ts as the main dispatcher');
assert.doesNotMatch(structure, /src\/web\/static\/app\.js`: client-side console logic/, 'STRUCTURE.md should not describe src/web/static/app.js as the active runtime');

assert.match(architecture, /src\/http\/create-server\.ts/, 'ARCHITECTURE.md should point to src/http/create-server.ts');
assert.match(architecture, /src\/web\/app\/dashboard-app\.js/, 'ARCHITECTURE.md should point to src/web/app/dashboard-app.js');
assert.doesNotMatch(architecture, /src\/server\.ts` is the central integration point/, 'ARCHITECTURE.md should not describe src/server.ts as the central integration point');
assert.doesNotMatch(architecture, /src\/web\/static\/app\.js`: client-side console logic/, 'ARCHITECTURE.md should not describe src/web/static/app.js as active client runtime logic');

assert.match(projectIndex, /src\/http\//, 'PROJECT_INDEX.md should describe src/http/ in the runtime schematic or subsystem map');
assert.match(projectIndex, /src\/web\/app\//, 'PROJECT_INDEX.md should describe src/web/app/ as the active frontend runtime');
assert.doesNotMatch(projectIndex, /The UI is not bundled; it is plain static assets under `src\/web\/static\/`/, 'PROJECT_INDEX.md should not describe the UI as unbundled static runtime assets');
assert.doesNotMatch(projectIndex, /Sessions in `src\/saas\/auth\.ts` are in-memory and reset on process restart\./, 'PROJECT_INDEX.md should not describe SaaS sessions as in-memory only');

console.log('docs architecture truth regression passed');
