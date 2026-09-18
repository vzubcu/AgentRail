import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

const stateSource = await readFile(path.join(packageRoot, 'src', 'web', 'app', 'state.js'), 'utf8');
assert.match(stateSource, /'quick-connect': '\/quick-connect'/, 'dashboard routes should expose a dedicated quick-connect path');

const dashboardHtml = await readFile(path.join(packageRoot, 'src', 'web', 'templates', 'dashboard.html'), 'utf8');
assert.match(dashboardHtml, /data-tab="quick-connect"/, 'sidebar should include a Quick Connect entry');
assert.match(dashboardHtml, /id="quick-connect"/, 'dashboard should include a dedicated quick-connect tab panel');
assert.match(dashboardHtml, /quick-connect-entry-panel/, 'overview should keep a compact Quick Connect entry panel');
assert.match(dashboardHtml, /Open Quick Connect/, 'overview should keep a compact CTA into Quick Connect');
assert.equal((dashboardHtml.match(/control-room-panel quick-connect-panel/g) || []).length, 1, 'full Quick Connect panel should exist only once in the dedicated tab');

const codexGuide = await readFile(path.join(packageRoot, 'docs', 'agents', 'codex-cli.md'), 'utf8');
assert.match(codexGuide, /Quick Connect tab/i, 'Codex guide should send users to the dedicated Quick Connect tab');

const claudeGuide = await readFile(path.join(packageRoot, 'docs', 'agents', 'claude-code.md'), 'utf8');
assert.match(claudeGuide, /Quick Connect tab/i, 'Claude guide should send users to the dedicated Quick Connect tab');

console.log('quick connect route regression passed');
