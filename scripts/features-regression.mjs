import assert from 'node:assert/strict';
import { createServer } from '../dist/server.js';
import { prepareRuntimeForStartup } from '../dist/server-runtime.js';
import { loadCompressionConfig, saveCompressionConfig } from '../dist/compression/config.js';
import { applyCompression } from '../dist/compression/compress.js';
import { listSkills, getSkillUrl } from '../dist/skills/catalog.js';
import { addMemory, searchMemory, listMemory, deleteMemory } from '../dist/memory/store.js';
import { computeHeadroom } from '../dist/quota/engine.js';

// ---------------------------------------------------------------------------
// Unit checks: Compression
// ---------------------------------------------------------------------------
const defaultConfig = await loadCompressionConfig();
assert.equal(typeof defaultConfig.mode, 'string');
assert.ok(['none', 'drop_oldest', 'truncate'].includes(defaultConfig.mode));

const saved = await saveCompressionConfig({ mode: 'drop_oldest', keepLastN: 5, maxCharsPerPart: 2000, preserveSystem: true });
assert.equal(saved.mode, 'drop_oldest');
assert.equal(saved.keepLastN, 5);
// restore default for determinism
await saveCompressionConfig(defaultConfig);

// drop_oldest keeps only the most recent N non-system messages + system
const dropped = applyCompression(
  {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'keep-1' },
      { role: 'assistant', content: 'keep-2' },
    ],
  },
  { mode: 'drop_oldest', keepLastN: 2, maxCharsPerPart: 4000, preserveSystem: true },
);
assert.equal(dropped.messages[0].role, 'system'); // system preserved
assert.equal(dropped.messages.length, 3); // system + 2 kept
assert.ok(dropped.messages.some((m) => m.content === 'keep-1'));
assert.ok(!dropped.messages.some((m) => m.content === 'old-1'));

// truncate reduces oversized content
const truncated = applyCompression(
  {
    messages: [
      { role: 'user', content: 'a'.repeat(5000) },
    ],
  },
  { mode: 'truncate', keepLastN: 10, maxCharsPerPart: 100, preserveSystem: true },
);
assert.ok(truncated.messages[0].content.length <= 100 + 20);

// none returns original unchanged
const none = applyCompression(
  { messages: [{ role: 'user', content: 'x' }] },
  { mode: 'none', keepLastN: 10, maxCharsPerPart: 4000, preserveSystem: true },
);
assert.equal(none.messages[0].content, 'x');

// ---------------------------------------------------------------------------
// Unit checks: Skills
// ---------------------------------------------------------------------------
const skills = listSkills();
assert.ok(Array.isArray(skills));
assert.ok(skills.length >= 1);
for (const s of skills) {
  assert.equal(typeof s.id, 'string');
  assert.equal(typeof s.name, 'string');
  assert.equal(typeof s.url, 'string');
  assert.ok(Array.isArray(s.clients));
}
const url = getSkillUrl(skills[0].id);
assert.equal(url, skills[0].url);
assert.equal(getSkillUrl('does-not-exist'), undefined);

// ---------------------------------------------------------------------------
// Unit checks: Memory
// ---------------------------------------------------------------------------
const created = await addMemory({ content: 'regression test memory', tags: ['test', 'regression'] });
assert.equal(typeof created.id, 'string');
assert.equal(created.content, 'regression test memory');
assert.deepEqual(created.tags, ['test', 'regression']);

const listed = await listMemory();
assert.ok(listed.some((m) => m.id === created.id));

const byText = await searchMemory('regression');
assert.ok(byText.some((m) => m.id === created.id));

// empty query returns no matches (tokenizer guards against non-string)
const emptySearch = await searchMemory('');
assert.ok(Array.isArray(emptySearch));

await deleteMemory(created.id);
const afterDelete = await listMemory();
assert.ok(!afterDelete.some((m) => m.id === created.id));

// ---------------------------------------------------------------------------
// Unit checks: Quota / Headroom
// ---------------------------------------------------------------------------
const headroom = await computeHeadroom();
assert.ok(Array.isArray(headroom));
for (const h of headroom) {
  assert.equal(typeof h.provider, 'string');
  assert.equal(typeof h.usedRequests, 'number');
  assert.equal(typeof h.usedTokens, 'number');
  assert.equal(typeof h.quotaRequests, 'number');
  assert.equal(typeof h.quotaTokens, 'number');
  assert.equal(typeof h.remainingPct, 'number');
}

// ---------------------------------------------------------------------------
// Integration checks: live HTTP endpoints
// ---------------------------------------------------------------------------
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_SAAS = '0';

const { setPersistencePoolForTests } = await import('../dist/persistence/postgres-pool.js');
setPersistencePoolForTests({
  async query() { return { rows: [], rowCount: 0 }; },
  async connect() { throw new Error('connect should not be called in features regression'); },
  async end() {},
});

await prepareRuntimeForStartup({ allowedEnvVars: new Set(), saasMode: false });

const server = createServer({
  routeChatCompletion: async () => { throw new Error('chat routing should not be reached'); },
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  assert.equal(res.status, 200, `GET ${path} should be 200`);
  return res.json();
}

async function postJson(path, body, okStatus = 200) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, okStatus, `POST ${path} should be ${okStatus}`);
  return res.json();
}

const quotaRes = await getJson('/api/quota');
assert.ok(Array.isArray(quotaRes.headroom));

const skillsRes = await getJson('/api/skills');
assert.ok(Array.isArray(skillsRes.skills));
assert.ok(skillsRes.skills.length >= 1);

const memPost = await postJson('/api/memory', { content: 'http integration note', tags: ['http'] }, 201);
assert.equal(typeof memPost.entry.id, 'string');
const createdId = memPost.entry.id;
const memGet = await getJson('/api/memory');
assert.ok(memGet.entries.some((m) => m.id === createdId));
const memDel = await fetch(`${base}/api/memory/${encodeURIComponent(createdId)}`, { method: 'DELETE' });
assert.equal(memDel.status, 200);

const compGet = await getJson('/api/compression');
assert.equal(typeof compGet.config.mode, 'string');

await new Promise((resolve, reject) => {
  server.close((err) => (err ? reject(err) : resolve()));
});
setPersistencePoolForTests(null);

console.log('features regression passed');
