import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-v1-specialty-'));
process.chdir(tempRoot);
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_SAAS = '0';
process.env.AGENTRAIL_FILES_ROOT = path.join(tempRoot, 'files');
process.env.AGENTRAIL_BATCHES_ROOT = path.join(tempRoot, 'batches');

const upstreamCalls = [];
const originalFetch = globalThis.fetch;
let localBaseUrl = null;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (localBaseUrl && url.startsWith(localBaseUrl)) {
    return originalFetch(input, init);
  }
  const method = init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  let bodyText = null;
  let formData = null;

  if (init.body instanceof FormData) {
    formData = init.body;
  } else if (typeof init.body === 'string') {
    bodyText = init.body;
  } else if (init.body instanceof Uint8Array || init.body instanceof ArrayBuffer) {
    bodyText = Buffer.from(init.body).toString('utf8');
  }

  upstreamCalls.push({ url, method, headers: init.headers, bodyText, formData });

  if (url.endsWith('/responses/compact')) {
    const payload = JSON.parse(bodyText ?? '{}');
    if (payload.scenario === 'sse') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: response.created\n'));
          setTimeout(() => { controller.enqueue(encoder.encode('data: {"ok":true}\n\n')); controller.close(); }, 25);
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Request-Id': 'req_sse' } });
    }
    if (payload.scenario === 'error') {
      return new Response(JSON.stringify({ error: { message: 'upstream rejected' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_error' },
      });
    }
  }
  if (url.endsWith('/audio/speech')) {
    return new Response(Buffer.from('FAKEAUDIO', 'utf8'), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  }

  return new Response(JSON.stringify({
    object: 'ok',
    url,
    method,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const { createServer } = await import('../dist/server.js');
const { readBodyBuffer } = await import('../dist/http/request-context.js');
const { createStoredFile, deleteStoredFile, getStoredFile } = await import('../dist/files-store.js');
await assert.rejects(() => readBodyBuffer(Readable.from([Buffer.alloc(4), Buffer.alloc(4)]), 6), /size limit/);
const unlinkFailureFile = await createStoredFile({ filename: 'unlink-failure.txt', purpose: 'assistants', mimeType: 'text/plain', content: Buffer.from('sensitive') });
fs.rmSync(unlinkFailureFile.content_path);
fs.mkdirSync(unlinkFailureFile.content_path);
await assert.rejects(() => deleteStoredFile(unlinkFailureFile.id));
assert(await getStoredFile(unlinkFailureFile.id));
fs.rmdirSync(unlinkFailureFile.content_path);
assert.equal(await deleteStoredFile(unlinkFailureFile.id), true);
const { buildCloudflareCredentialValue, getRuntimeApiKey, setAgentRailApiKey, setRuntimeApiKey } = await import('../dist/config.js');
const { getProviderHealth } = await import('../dist/health.js');
const { providers } = await import('../dist/providers/index.js');

await setAgentRailApiKey('');
setRuntimeApiKey('OPENROUTER_API_KEY', 'or-test-key');

const openRouter = providers.find((provider) => provider.name === 'openrouter');
assert(openRouter, 'expected openrouter provider to exist');
const cloudflare = providers.find((provider) => provider.name === 'cloudflare');
assert(cloudflare, 'expected cloudflare provider to exist');

const originalModels = [...openRouter.models];
const originalHealth = { ...getProviderHealth('openrouter', false) };
const originalCloudflareRuntimeKey = getRuntimeApiKey('CLOUDFLARE_API_KEY');

openRouter.models = [
  ...openRouter.models,
  { id: 'embed-test', providerModelId: 'openai/text-embedding-3-small', capabilities: ['embeddings'] },
  { id: 'image-test', providerModelId: 'openai/gpt-image-1', capabilities: ['image_generation'] },
  { id: 'image-edit-test', providerModelId: 'openai/gpt-image-1', capabilities: ['image_edit'] },
  { id: 'transcription-test', providerModelId: 'openai/whisper-1', capabilities: ['audio_transcription'] },  { id: 'translation-test', providerModelId: 'openai/whisper-1' },
  { id: 'generic-asr-test', providerModelId: 'generic-asr' },
  { id: 'responses-passthrough-test', providerModelId: 'openai/gpt-4.1', capabilities: ['chat'] },
  { id: 'speech-test', providerModelId: 'openai/tts-1', capabilities: ['audio_generation'] },
  { id: 'video-test', providerModelId: 'openai/sora-2', capabilities: ['video_generation'] },
  { id: 'music-test', providerModelId: 'openai/music-gen', capabilities: ['music_generation'] },
  { id: 'search-test', providerModelId: 'openai/web-search', capabilities: ['search'] },
  { id: 'rerank-test', providerModelId: 'openai/rerank-1', capabilities: ['rerank'] },
  { id: 'moderation-test', providerModelId: 'openai/moderation-1', capabilities: ['moderation'] },
];

Object.assign(getProviderHealth('openrouter', true), {
  state: 'healthy',
  message: 'test healthy',
  checkedAt: Date.now(),
  isStale: false,
});

setRuntimeApiKey('CLOUDFLARE_API_KEY', buildCloudflareCredentialValue('cf-test-key', 'cf-account'));
assert.equal(
  cloudflare.getEndpointUrl('/v1/embeddings'),
  'https://api.cloudflare.com/client/v4/accounts/cf-account/ai/v1/embeddings',
);

function findLastUpstreamCall(suffix) {
  const matching = upstreamCalls.filter((call) => call.url.endsWith(suffix));
  assert(matching.length > 0, `expected upstream call ending with ${suffix}`);
  return matching.at(-1);
}

async function postJson(baseUrl, pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    response,
    body: await response.json(),
  };
}

const server = createServer();
const baseUrl = await listen(server);
localBaseUrl = baseUrl;

try {
  const publicModelsResponse = await getJson(baseUrl, '/v1/models');
  assert.equal(publicModelsResponse.response.status, 200);
  assert.equal(publicModelsResponse.body.object, 'list');
  const publicEmbeddingModel = publicModelsResponse.body.data.find((entry) => entry.id === 'embed-test');
  assert(publicEmbeddingModel, 'expected /v1/models to include non-chat models');
  assert.equal(publicEmbeddingModel.type, 'embedding');
  assert(publicModelsResponse.body.data.some((entry) => entry.id === 'speech-test'));

  const rootModelsResponse = await getJson(baseUrl, '/v1');
  assert.equal(rootModelsResponse.response.status, 200);
  assert.deepEqual(rootModelsResponse.body, publicModelsResponse.body);

  for (const pathname of ['/v1', '/v1/models']) {
    const headResponse = await fetch(`${baseUrl}${pathname}`, { method: 'HEAD' });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.headers.get('content-type'), 'application/json');
    assert.equal(await headResponse.text(), '');
  }

  const modelLookupResponse = await getJson(baseUrl, '/v1/models/embed-test');
  assert.equal(modelLookupResponse.response.status, 200);
  assert.equal(modelLookupResponse.body.id, 'embed-test');
  assert.equal(modelLookupResponse.body.type, 'embedding');

  const modelLookupHead = await fetch(`${baseUrl}/v1/models/embed-test`, { method: 'HEAD' });
  assert.equal(modelLookupHead.status, 200);
  assert.equal(await modelLookupHead.text(), '');

  const missingModelResponse = await getJson(baseUrl, '/v1/models/not-a-real-model');
  assert.equal(missingModelResponse.response.status, 404);
  assert.equal(missingModelResponse.body.error.type, 'invalid_request_error');

  const missingModelHead = await fetch(`${baseUrl}/v1/models/not-a-real-model`, { method: 'HEAD' });
  assert.equal(missingModelHead.status, 404);
  assert.equal(missingModelHead.headers.get('content-type'), 'application/json');
  assert.equal(missingModelHead.headers.get('content-length'), null);
  assert.equal(await missingModelHead.text(), '');

  const specialtyModelLists = [
    ['/v1/embeddings', 'embed-test', 'embedding'],
    ['/v1/images/generations', 'image-test', 'image'],
    ['/v1/music/generations', 'music-test', 'music'],
    ['/v1/videos/generations', 'video-test', 'video'],
  ];
  for (const [pathname, modelId, expectedType] of specialtyModelLists) {
    const { response, body } = await getJson(baseUrl, pathname);
    assert.equal(response.status, 200);
    assert.equal(body.object, 'list');
    const model = body.data.find((entry) => entry.id === modelId);
    assert(model, `expected ${pathname} to list ${modelId}`);
    assert.equal(model.object, 'model');
    assert.equal(model.type, expectedType);
    assert.equal(model.commercial_tier, 'free');
    assert(Array.isArray(model.capabilities));
    assert.equal(body.data.some((entry) => entry.id === 'speech-test'), false);

    const headResponse = await fetch(`${baseUrl}${pathname}`, { method: 'HEAD' });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.headers.get('content-type'), 'application/json');
    assert.equal(headResponse.headers.get('allow'), 'GET, POST, HEAD, OPTIONS');
    assert.equal(await headResponse.text(), '');
  }

  const speechHeadResponse = await fetch(`${baseUrl}/v1/audio/speech`, { method: 'HEAD' });
  assert.equal(speechHeadResponse.status, 204);
  assert.equal(speechHeadResponse.headers.get('allow'), 'POST, HEAD, OPTIONS');

  const searchListResponse = await getJson(baseUrl, '/v1/search');
  assert.equal(searchListResponse.response.status, 200);
  assert.equal(searchListResponse.body.object, 'list');
  assert.deepEqual(searchListResponse.body.data, [{
    id: 'openrouter',
    object: 'search_provider',
    created: 0,
    name: 'openrouter',
    search_types: ['web'],
  }]);

  const embeddingsResponse = await postJson(baseUrl, '/v1/embeddings', {
    model: 'embed-test',
    input: 'hello embeddings',
  });
  assert.equal(embeddingsResponse.status, 200);
  const embeddingsCall = findLastUpstreamCall('/embeddings');
  assert.equal(embeddingsCall.url, 'https://openrouter.ai/api/v1/embeddings');
  assert.equal(JSON.parse(embeddingsCall.bodyText).model, 'openai/text-embedding-3-small');

  const imageResponse = await postJson(baseUrl, '/v1/images/generations', {
    model: 'image-test',
    prompt: 'draw a gateway',
  });
  assert.equal(imageResponse.status, 200);
  const imageCall = findLastUpstreamCall('/images/generations');
  assert.equal(JSON.parse(imageCall.bodyText).model, 'openai/gpt-image-1');

  const imageEditForm = new FormData();
  imageEditForm.set('model', 'image-edit-test');
  imageEditForm.set('prompt', 'edit this');
  imageEditForm.set('image', new File([Buffer.from('img')], 'edit.png', { type: 'image/png' }));
  const imageEditResponse = await fetch(`${baseUrl}/v1/images/edits`, {
    method: 'POST',
    body: imageEditForm,
  });
  assert.equal(imageEditResponse.status, 200);
  const imageEditCall = findLastUpstreamCall('/images/edits');
  assert.equal(imageEditCall.formData.get('model'), 'openai/gpt-image-1');

  const transcriptionForm = new FormData();
  transcriptionForm.set('model', 'transcription-test');
  transcriptionForm.set('file', new File([Buffer.from('audio')], 'voice.mp3', { type: 'audio/mpeg' }));
  const transcriptionResponse = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: transcriptionForm,
  });
  assert.equal(transcriptionResponse.status, 200);
  const transcriptionCall = findLastUpstreamCall('/audio/transcriptions');
  assert.equal(transcriptionCall.formData.get('model'), 'openai/whisper-1');
  const missingTranslationForm = new FormData();
  missingTranslationForm.set('file', new File([Buffer.from('audio')], 'voice.mp3', { type: 'audio/mpeg' }));
  assert.equal((await fetch(`${baseUrl}/v1/audio/translations`, { method: 'POST', body: missingTranslationForm })).status, 400);

  const unsupportedTranslationForm = new FormData();
  unsupportedTranslationForm.set('model', 'generic-asr-test');
  unsupportedTranslationForm.set('file', new File([Buffer.from('audio')], 'voice.mp3', { type: 'audio/mpeg' }));
  assert.equal((await fetch(`${baseUrl}/v1/audio/translations`, { method: 'POST', body: unsupportedTranslationForm })).status, 400);

  const translationForm = new FormData();
  translationForm.set('model', 'translation-test');
  translationForm.set('prompt', 'translate precisely');
  translationForm.set('response_format', 'json');
  translationForm.set('file', new File([Buffer.from([0, 1, 2, 255])], 'voice.mp3', { type: 'audio/mpeg' }));
  const translationResponse = await fetch(`${baseUrl}/v1/audio/translations`, { method: 'POST', body: translationForm });
  assert.equal(translationResponse.status, 200);
  assert.equal((await translationResponse.json()).object, 'ok');
  const translationCall = findLastUpstreamCall('/audio/translations');
  assert.equal(translationCall.url, 'https://openrouter.ai/api/v1/audio/translations');
  assert.equal(translationCall.formData.get('model'), 'openai/whisper-1');
  assert.equal(translationCall.formData.get('prompt'), 'translate precisely');
  assert.deepEqual(Buffer.from(await translationCall.formData.get('file').arrayBuffer()), Buffer.from([0, 1, 2, 255]));

  const responsesJson = await postJson(baseUrl, '/v1/responses/compact', {
    model: 'responses-passthrough-test', input: 'compact this', scenario: 'json',
  });
  assert.equal(responsesJson.status, 200);
  const responsesJsonCall = findLastUpstreamCall('/responses/compact');
  assert.equal(responsesJsonCall.url, 'https://openrouter.ai/api/v1/responses/compact');
  assert.equal(JSON.parse(responsesJsonCall.bodyText).model, 'openai/gpt-4.1');
  assert.equal(new Headers(responsesJsonCall.headers).get('authorization'), 'Bearer or-test-key');

  const responsesSse = await fetch(`${baseUrl}/v1/responses/compact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer gateway-secret', 'OpenAI-Beta': 'responses=v1' },
    body: JSON.stringify({ model: 'responses-passthrough-test', scenario: 'sse' }),
  });
  assert.equal(responsesSse.status, 200);
  assert.equal(responsesSse.headers.get('content-type'), 'text/event-stream');
  assert.equal(responsesSse.headers.get('cache-control'), 'no-cache');
  assert.equal(responsesSse.headers.get('x-request-id'), 'req_sse');
  const sseReader = responsesSse.body.getReader();
  const firstSseChunk = await sseReader.read();
  assert.equal(new TextDecoder().decode(firstSseChunk.value), 'event: response.created\n');
  const secondSseChunk = await sseReader.read();
  assert.equal(new TextDecoder().decode(secondSseChunk.value), 'data: {"ok":true}\n\n');
  const responsesSseCall = findLastUpstreamCall('/responses/compact');
  assert.equal(new Headers(responsesSseCall.headers).get('authorization'), 'Bearer or-test-key');
  assert.equal(new Headers(responsesSseCall.headers).get('openai-beta'), 'responses=v1');

  const invalidResponsesCalls = upstreamCalls.length;
  assert.equal((await postJson(baseUrl, '/v1/responses/%E0%A4%A', { model: 'responses-passthrough-test' })).status, 400);
  assert.equal((await postJson(baseUrl, '/v1/responses/%2Fescape', { model: 'responses-passthrough-test' })).status, 400);
  assert.equal(upstreamCalls.length, invalidResponsesCalls);

  const responsesError = await postJson(baseUrl, '/v1/responses/compact', { model: 'responses-passthrough-test', scenario: 'error' });
  assert.equal(responsesError.status, 429);
  assert.equal(responsesError.headers.get('x-request-id'), 'req_error');
  assert.equal((await responsesError.json()).error.message, 'upstream rejected');

  const speechResponse = await postJson(baseUrl, '/v1/audio/speech', {
    model: 'speech-test',
    input: 'say this',
    voice: 'alloy',
  });
  assert.equal(speechResponse.status, 200);
  assert.equal(speechResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await speechResponse.text(), 'FAKEAUDIO');
  const speechCall = findLastUpstreamCall('/audio/speech');
  assert.equal(JSON.parse(speechCall.bodyText).model, 'openai/tts-1');

  const videoResponse = await postJson(baseUrl, '/v1/videos/generations', {
    model: 'video-test',
    prompt: 'video prompt',
  });
  assert.equal(videoResponse.status, 200);
  const videoCall = findLastUpstreamCall('/videos/generations');
  assert.equal(JSON.parse(videoCall.bodyText).model, 'openai/sora-2');

  const musicResponse = await postJson(baseUrl, '/v1/music/generations', {
    model: 'music-test',
    prompt: 'music prompt',
  });
  assert.equal(musicResponse.status, 200);
  const musicCall = findLastUpstreamCall('/music/generations');
  assert.equal(JSON.parse(musicCall.bodyText).model, 'openai/music-gen');

  const searchResponse = await postJson(baseUrl, '/v1/search', {
    model: 'search-test',
    query: 'agentrail',
  });
  assert.equal(searchResponse.status, 200);
  const searchCall = findLastUpstreamCall('/search');
  assert.equal(JSON.parse(searchCall.bodyText).model, 'openai/web-search');

  const rerankResponse = await postJson(baseUrl, '/v1/rerank', {
    model: 'rerank-test',
    query: 'gateway',
    documents: ['one', 'two'],
  });
  assert.equal(rerankResponse.status, 200);
  const rerankCall = findLastUpstreamCall('/rerank');
  assert.equal(JSON.parse(rerankCall.bodyText).model, 'openai/rerank-1');

  const moderationResponse = await postJson(baseUrl, '/v1/moderations', {
    model: 'moderation-test',
    input: 'text',
  });
  assert.equal(moderationResponse.status, 200);
  const moderationCall = findLastUpstreamCall('/moderations');
  assert.equal(JSON.parse(moderationCall.bodyText).model, 'openai/moderation-1');

  const uploadForm = new FormData();
  uploadForm.set('purpose', 'batch');
  uploadForm.set('file', new File([Buffer.from('{"custom_id":"1"}\n')], 'input.jsonl', { type: 'application/jsonl' }));
  const fileUploadResponse = await fetch(`${baseUrl}/v1/files`, {
    method: 'POST',
    body: uploadForm,
  });
  assert.equal(fileUploadResponse.status, 200);
  const uploadedFile = await fileUploadResponse.json();

  const expiringUpload = new FormData();
  expiringUpload.set('purpose', 'assistants');
  expiringUpload.set('expires_after[anchor]', 'created_at');
  expiringUpload.set('expires_after[seconds]', '60');
  expiringUpload.set('file', new File([Buffer.from('temporary')], 'temporary.txt', { type: 'text/plain' }));
  const expiringUploadResponse = await fetch(`${baseUrl}/v1/files`, { method: 'POST', body: expiringUpload });
  assert.equal(expiringUploadResponse.status, 200);
  const expiringFile = await expiringUploadResponse.json();
  assert.equal(typeof expiringFile.expires_at, 'number');
  const filteredFilesResponse = await fetch(`${baseUrl}/v1/files?purpose=assistants&limit=1&order=asc`);
  assert.equal(filteredFilesResponse.status, 200);
  const filteredFiles = await filteredFilesResponse.json();
  assert.equal(filteredFiles.total_count, 1);
  assert.equal(filteredFiles.data[0].id, expiringFile.id);
  assert.equal((await fetch(`${baseUrl}/v1/files?limit=0`)).status, 400);
  const filesIndex = JSON.parse(fs.readFileSync(path.join(process.env.AGENTRAIL_FILES_ROOT, 'index.json'), 'utf8'));
  const expiringRecord = filesIndex.find((entry) => entry.id === expiringFile.id);
  assert(fs.existsSync(expiringRecord.content_path));
  expiringRecord.expires_at = Math.floor(Date.now() / 1000) - 1;
  fs.writeFileSync(path.join(process.env.AGENTRAIL_FILES_ROOT, 'index.json'), JSON.stringify(filesIndex));
  assert.equal((await fetch(`${baseUrl}/v1/files/${expiringFile.id}`)).status, 404);
  assert.equal(fs.existsSync(expiringRecord.content_path), false);

  assert.equal((await postJson(baseUrl, '/v1/batches', { input_file_id: uploadedFile.id, endpoint: '/v1/audio/translations', completion_window: '1h' })).status, 400);
  assert.equal((await postJson(baseUrl, '/v1/batches', { input_file_id: uploadedFile.id, endpoint: '/v1/audio/translations', metadata: { invalid: 1 } })).status, 400);
  const batchCreateResponse = await postJson(baseUrl, '/v1/batches', {
    input_file_id: uploadedFile.id,
    endpoint: '/v1/audio/translations',
    completion_window: '24h',
    metadata: { source: 'test' },
  });
  assert.equal(batchCreateResponse.status, 200);
  const createdBatch = await batchCreateResponse.json();
  assert.equal(createdBatch.object, 'batch');
  assert.equal(createdBatch.status, 'validating');

  const batchListResponse = await fetch(`${baseUrl}/v1/batches`);
  assert.equal(batchListResponse.status, 200);
  const batchList = await batchListResponse.json();
  assert.equal(batchList.object, 'list');
  assert.equal(batchList.data.length, 1);

  const batchGetResponse = await fetch(`${baseUrl}/v1/batches/${createdBatch.id}`);
  assert.equal(batchGetResponse.status, 200);
  const batchDetails = await batchGetResponse.json();
  assert.equal(batchDetails.id, createdBatch.id);

  const batchCancelResponse = await fetch(`${baseUrl}/v1/batches/${createdBatch.id}/cancel`, {
    method: 'POST',
  });
  assert.equal(batchCancelResponse.status, 200);
  const canceledBatch = await batchCancelResponse.json();
  assert.equal(canceledBatch.status, 'cancelled');  assert.equal((await fetch(`${baseUrl}/v1/batches/${createdBatch.id}/cancel`, { method: 'POST' })).status, 400);
  assert.equal((await fetch(`${baseUrl}/v1/batches/${createdBatch.id}`, { method: 'DELETE' })).status, 200);
  const deleteCompletedResponse = await fetch(`${baseUrl}/v1/batches/delete-completed`, { method: 'DELETE' });
  assert.equal(deleteCompletedResponse.status, 200);
  assert.equal((await deleteCompletedResponse.json()).deleted_batches, 0);

  console.log('v1 specialty surface regression checks passed');
} finally {
  openRouter.models = originalModels;
  Object.assign(getProviderHealth('openrouter', false), originalHealth);
  setRuntimeApiKey('CLOUDFLARE_API_KEY', originalCloudflareRuntimeKey ?? '');
  globalThis.fetch = originalFetch;
  await close(server);
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
