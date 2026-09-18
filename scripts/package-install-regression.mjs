import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(packageJson.name, '@vzubcu/agentrail', 'npm package name should match the documented install command');
assert.equal(packageJson.bin?.agentrail, 'dist/index.js', 'global install should expose the agentrail bin from dist/index.js');

const runtimeDeps = packageJson.dependencies ?? {};
const devDeps = packageJson.devDependencies ?? {};
const packagedFiles = new Set(packageJson.files ?? []);

assert.ok(!('vite' in runtimeDeps), 'vite must not be a runtime dependency because it pulls install-time build tooling');
assert.ok('vite' in devDeps, 'vite must stay available for local web asset builds');
assert.ok(packagedFiles.has('dist'), 'published package must include dist/');
assert.ok(packagedFiles.has('src/web/static'), 'published package must include web static assets');
assert.ok(packagedFiles.has('src/web/templates'), 'published package must include web templates');

console.log('package install regression passed');
