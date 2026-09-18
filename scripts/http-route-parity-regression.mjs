import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve({ baseUrl: 'http://127.0.0.1:' + address.port, port: address.port });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-http-parity-'));
process.chdir(tempRoot);
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_SAAS = '0';

const { createServer } = await import('../dist/server.js');
const { setAgentRailApiKey } = await import('../dist/config.js');
setAgentRailApiKey('');

const calls = [];
const server = createServer({
  routeChatCompletion: async (request) => {
    calls.push(request);
    return {
      provider: { name: 'mock-provider' },
      routeModel: request.model,
      response: jsonResponse({
        id: 'chatcmpl-route-parity',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'route parity ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }),
    };
  },
});

const { baseUrl } = await listen(server);

try {
  const keysSummary = await fetch(baseUrl + '/api/config/keys/summary');
  assert.equal(keysSummary.status, 200);
  const keysSummaryBody = await keysSummary.json();
  assert.equal(typeof keysSummaryBody.keys, 'object');

  const activeModels = await fetch(baseUrl + '/api/models/active');
  assert.equal(activeModels.status, 200);
  const activeModelsBody = await activeModels.json();
  assert.ok(Array.isArray(activeModelsBody.models));

  for (const dashboardPath of ['/virtual-models/new', '/virtual-models/edit/custom%2Frouter']) {
    const dashboardRoute = await fetch(baseUrl + dashboardPath);
    assert.equal(dashboardRoute.status, 200);
    assert.match(await dashboardRoute.text(), /id="virtual-models"/);
  }

  const refreshModels = await fetch(baseUrl + '/api/models/refresh', { method: 'POST' });
  assert.equal(refreshModels.status, 200);
  const refreshBody = await refreshModels.json();
  assert.equal(refreshBody.ok, true);

  const chat = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    }),
  });
  assert.equal(chat.status, 200);
  const chatBody = await chat.json();
  assert.equal(chatBody.choices[0].message.content, 'route parity ok');

  const responses = await fetch(baseUrl + '/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      input: 'hello from responses',
    }),
  });
  assert.equal(responses.status, 200);
  const responsesBody = await responses.json();
  assert.equal(responsesBody.output[0].content[0].text, 'route parity ok');

  const anthropic = await fetch(baseUrl + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hello anthropic' }],
    }),
  });
  assert.equal(anthropic.status, 200);
  const anthropicBody = await anthropic.json();
  assert.equal(anthropicBody.content[0].text, 'route parity ok');
  assert.ok(calls.length >= 3);
} finally {
  await close(server);
}

process.env.AGENTRAIL_SAAS = '1';
const saasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-http-parity-saas-'));
process.chdir(saasRoot);

const saasServer = createServer({
  routeChatCompletion: async () => {
    throw new Error('chat should not be reached in saas auth parity check');
  },
});
const saasListen = await listen(saasServer);

try {
  const authMe = await fetch(saasListen.baseUrl + '/api/saas/auth/me');
  assert.equal(authMe.status, 200);
  const authMeBody = await authMe.json();
  assert.equal(authMeBody.user, null);
} finally {
  await close(saasServer);
  try { fs.rmSync(saasRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}

console.log('http route parity regression passed');
