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
      resolve({ baseUrl: 'http://127.0.0.1:' + address.port });
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

function streamResponse(text) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({
        id: 'chatcmpl-tool-guard',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'coding',
        choices: [
          {
            index: 0,
            delta: { content: text },
            finish_reason: null,
          },
        ],
      }) + '\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-tool-call-guard-'));
process.chdir(tempRoot);
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_SAAS = '0';

const { createServer } = await import('../dist/server.js');
const { setAgentRailApiKey } = await import('../dist/config.js');
setAgentRailApiKey('');

async function assertTextualToolCallBlocked(text, leakedPattern) {
  const server = createServer({
    routeChatCompletion: async (request) => ({
      provider: { name: 'mock-provider' },
      routeModel: request.model,
      response: streamResponse(text),
    }),
  });

  const { baseUrl } = await listen(server);

  try {
  const response = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'coding',
      messages: [{ role: 'user', content: 'read the file' }],
      stream: true,
    }),
  });
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.match(body, /textual tool-call content/i);
  assert.doesNotMatch(body, leakedPattern);
  } finally {
    await close(server);
  }
}

try {
  await assertTextualToolCallBlocked(
    '<tool_call><function=read_file><parameter=path>src/index.ts</parameter></function></tool_call>',
    /<tool_call>|<function=|<parameter=/,
  );
  await assertTextualToolCallBlocked(
    '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="read_file">\n<｜｜DSML｜｜parameter name="path" string="true">TESTING.md</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
    /DSML|read_file|TESTING\.md/,
  );
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}

console.log('tool-call stream guard regression passed');