import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [indexTemplate, dashboardTemplate, mainCss] = await Promise.all([
  readFile(new URL('../src/web/templates/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/web/templates/dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/web/app/styles/main.css', import.meta.url), 'utf8'),
]);

for (const [name, template] of [
  ['index', indexTemplate],
  ['dashboard', dashboardTemplate],
]) {
  assert.doesNotMatch(
    template,
    /href="\/static\/style\.css"/,
    `${name} template should not link legacy /static/style.css directly`,
  );
  assert.match(
    template,
    /href="\/static\/dist\/app\.css"/,
    `${name} template should load bundled /static/dist/app.css`,
  );
  assert.match(
    template,
    /src="\/static\/dist\/app\.js"/,
    `${name} template should load bundled /static/dist/app.js`,
  );
}

assert.match(indexTemplate, /id="public-shell"/, 'public shell marker should remain in index template');
assert.match(dashboardTemplate, /id="dashboard-shell"/, 'dashboard shell marker should remain in dashboard template');

for (const importPath of [
  './tokens.css',
  './base.css',
  './public-shell.css',
  './dashboard-shell.css',
  './features/overview.css',
  './features/providers.css',
  './features/models.css',
  './features/usage.css',
  './features/test-console.css',
  './features/quick-connect.css',
  './features/saas.css',
]) {
  const escapedImportPath = importPath.replace('.', '\\.');
  assert.match(mainCss, new RegExp(`@import\\s+['"]${escapedImportPath}['"];?`));
}

console.log('frontend style entry regression passed');
