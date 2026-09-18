import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

const bootstrapSource = await readFile(path.join(packageRoot, 'src', 'web', 'app', 'bootstrap.js'), 'utf8');

assert.doesNotMatch(
  bootstrapSource,
  /legacy-app\.js/,
  'bootstrap.js should initialize the dashboard through the extracted composition root instead of legacy-app.js',
);

assert.match(
  bootstrapSource,
  /initDashboardApp|createDashboardApp/,
  'bootstrap.js should call the extracted dashboard app composition entrypoint',
);

const compositionCandidates = [
  path.join(packageRoot, 'src', 'web', 'app', 'dashboard-app.js'),
  path.join(packageRoot, 'src', 'web', 'app', 'app-runtime.js'),
];

let compositionSource = '';
for (const candidate of compositionCandidates) {
  try {
    compositionSource = await readFile(candidate, 'utf8');
    break;
  } catch {}
}

assert.notEqual(
  compositionSource,
  '',
  'frontend runtime should expose a dedicated dashboard app composition module',
);

assert.match(
  compositionSource,
  /createTabRouter/,
  'dashboard app composition should own router wiring',
);

assert.match(
  compositionSource,
  /createProvidersFeature/,
  'dashboard app composition should still wire provider behavior through the extracted runtime surface',
);

console.log('frontend bootstrap parity regression passed');
