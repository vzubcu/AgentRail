import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const filesRoot = path.join(process.cwd(), '.agentrail', 'files-test', String(Date.now()));
process.env.AGENTRAIL_FILES_ROOT = filesRoot;

const { createServer } = await import('../dist/server.js');
const { setAgentRailApiKey } = await import('../dist/config.js');

setAgentRailApiKey('');

const provider = { name: 'mock-provider' };
const calls = [];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function mockRouteChatCompletion(request) {
  calls.push(request);
  return {
    provider,
    routeModel: request.model,
    response: jsonResponse({
      id: 'chatcmpl-v1-surface',
      object: 'chat.completion',
      created: 1,
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Legacy completions OK' },
          finish_reason: 'stop',
          text: 'Legacy completions OK',
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 3,
        total_tokens: 8,
      },
    }),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve(`http://127.0.0.1:${address.port}`);
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

async function postJson(baseUrl, pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const server = createServer({ routeChatCompletion: mockRouteChatCompletion });
const baseUrl = await listen(server);

try {
  await mkdir(path.dirname(filesRoot), { recursive: true });

  const completionsResponse = await postJson(baseUrl, '/v1/completions', {
    model: 'llama-3.3-70b',
    prompt: 'Say hello from completions',
    max_tokens: 32,
  });
  assert.equal(completionsResponse.status, 200);
  const completionsBody = await completionsResponse.json();
  assert.equal(completionsBody.object, 'text_completion');
  assert.equal(completionsBody.choices[0].text, 'Legacy completions OK');
  const completionsCall = calls.find((call) => call.model === 'llama-3.3-70b');
  assert(completionsCall);
  assert.equal(completionsCall.messages[0].role, 'user');
  assert.equal(completionsCall.messages[0].content, 'Say hello from completions');

  const uploadForm = new FormData();
  uploadForm.set('purpose', 'assistants');
  uploadForm.set(
    'file',
    new File([Buffer.from('alpha file contents', 'utf8')], 'alpha.txt', {
      type: 'text/plain',
    }),
  );

  const uploadResponse = await fetch(`${baseUrl}/v1/files`, {
    method: 'POST',
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 200);
  const uploadedFile = await uploadResponse.json();
  assert.equal(uploadedFile.object, 'file');
  assert.equal(uploadedFile.filename, 'alpha.txt');
  assert.equal(uploadedFile.bytes, Buffer.byteLength('alpha file contents'));

  const listResponse = await fetch(`${baseUrl}/v1/files`);
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.object, 'list');
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0].id, uploadedFile.id);

  const metadataResponse = await fetch(`${baseUrl}/v1/files/${uploadedFile.id}`);
  assert.equal(metadataResponse.status, 200);
  const metadataBody = await metadataResponse.json();
  assert.equal(metadataBody.id, uploadedFile.id);
  assert.equal(metadataBody.purpose, 'assistants');

  const contentResponse = await fetch(`${baseUrl}/v1/files/${uploadedFile.id}/content`);
  assert.equal(contentResponse.status, 200);
  assert.equal(await contentResponse.text(), 'alpha file contents');

  const deleteResponse = await fetch(`${baseUrl}/v1/files/${uploadedFile.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.status, 200);
  const deleteBody = await deleteResponse.json();
  assert.equal(deleteBody.deleted, true);

  const missingMetadataResponse = await fetch(`${baseUrl}/v1/files/${uploadedFile.id}`);
  assert.equal(missingMetadataResponse.status, 404);

  console.log('v1 surface regression checks passed');
} finally {
  await close(server);
}
