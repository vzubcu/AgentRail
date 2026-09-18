import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { createServer } from '../dist/server.js';
import { setAgentRailApiKey } from '../dist/config.js';
import {
  extractPdfTextFromBuffer,
  getAttachmentCacheDir,
} from '../dist/attachments.js';

setAgentRailApiKey('');

const provider = { name: 'mock-provider' };
const calls = [];
const root = process.cwd();
const cacheDir = getAttachmentCacheDir(root);

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
    response: jsonResponse({
      id: 'chatcmpl-attachments',
      object: 'chat.completion',
      created: 1,
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Attachments OK' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
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

function onePixelPngDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotkL8AAAAASUVORK5CYII=';
}

function buildPdfBuffer(text) {
  const streamBody = `BT\n/F1 24 Tf\n72 72 Td\n(${text}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, 'utf8'));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output, 'utf8');
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    output += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, 'utf8');
}

await rm(cacheDir, { recursive: true, force: true });
await mkdir(path.dirname(cacheDir), { recursive: true });

const samplePdf = buildPdfBuffer('Hello PDF');
const samplePdfText = await extractPdfTextFromBuffer(samplePdf);
assert.match(samplePdfText, /Hello PDF/);

const server = createServer({ routeChatCompletion: mockRouteChatCompletion });
const baseUrl = await listen(server);

try {
  const imageResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-4-scout',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: onePixelPngDataUrl() } },
        ],
      },
    ],
  });
  assert.equal(imageResponse.status, 200);
  const imageCall = calls.find((call) => call.model === 'llama-4-scout');
  assert(imageCall);
  assert.equal(Array.isArray(imageCall.messages[0].content), true);
  assert.equal(imageCall.messages[0].content[1].type, 'image_url');

  const noVisionResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: onePixelPngDataUrl() } },
        ],
      },
    ],
  });
  assert.equal(noVisionResponse.status, 400);
  const noVisionBody = await noVisionResponse.json();
  assert.match(noVisionBody.error.message, /vision/i);

  const pdfResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize this PDF' },
          {
            type: 'input_file',
            filename: 'sample.pdf',
            mime_type: 'application/pdf',
            data: `data:application/pdf;base64,${samplePdf.toString('base64')}`,
          },
          {
            type: 'attachment_metadata',
            filename: 'sample.pdf',
            mime_type: 'application/pdf',
            size_bytes: samplePdf.byteLength,
            source: 'dashboard',
          },
        ],
      },
    ],
  });
  assert.equal(pdfResponse.status, 200);
  const pdfCall = calls.find((call) => call.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && /Hello PDF/.test(part.text))));
  assert(pdfCall);
  assert.equal(pdfCall.messages[0].content.some((part) => part.type === 'attachment_metadata'), false);

  const responsesResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'llama-4-scout',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Review both attachments' },
          { type: 'input_image', image_url: onePixelPngDataUrl() },
          {
            type: 'input_file',
            filename: 'sample.pdf',
            mime_type: 'application/pdf',
            data: `data:application/pdf;base64,${samplePdf.toString('base64')}`,
          },
        ],
      },
    ],
  });
  assert.equal(responsesResponse.status, 200);
  const responsesCall = [...calls].reverse().find((call) => call.model === 'llama-4-scout' && call.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url') && message.content.some((part) => part.type === 'text' && /Hello PDF/.test(part.text))));
  assert(responsesCall);
  assert.equal(responsesCall.messages[0].content.some((part) => part.type === 'text' && /Hello PDF/.test(part.text)), true);

  const unsupportedResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: 'notes.docx',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data: 'data:application/octet-stream;base64,ZmFrZQ==',
          },
        ],
      },
    ],
  });
  assert.equal(unsupportedResponse.status, 400);
  const unsupportedBody = await unsupportedResponse.json();
  assert.match(unsupportedBody.error.message, /unsupported/i);

  const singletonContentResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'This singleton object should be normalized',
        },
      },
    ],
  });
  assert.equal(singletonContentResponse.status, 200);
  const singletonCall = [...calls].reverse().find((call) => call.messages.some((message) => message.content === 'This singleton object should be normalized' || (Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && part.text === 'This singleton object should be normalized'))));
  assert(singletonCall);

  const nestedContentResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: {
          content: [
            { type: 'text', text: 'This nested content object should be normalized' },
          ],
        },
      },
    ],
  });
  assert.equal(nestedContentResponse.status, 200);
  const nestedCall = [...calls].reverse().find((call) => call.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && part.text === 'This nested content object should be normalized')));
  assert(nestedCall);

  const plainTextObjectResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: {
          text: 'This typeless text object should be normalized',
        },
      },
    ],
  });
  assert.equal(plainTextObjectResponse.status, 200);
  const plainTextCall = [...calls].reverse().find((call) => call.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && part.text === 'This typeless text object should be normalized')));
  assert(plainTextCall);

  const assistantToolCallResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: 'Use a tool please',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'list_files',
              arguments: '{"path":"src"}',
            },
          },
        ],
      },
    ],
  });
  assert.equal(assistantToolCallResponse.status, 200);
  const assistantToolCall = [...calls].reverse().find((call) => call.messages.some((message) => message.role === 'assistant' && message.content === '' && Array.isArray(message.tool_calls) && message.tool_calls.length === 1));
  assert(assistantToolCall);

  const invalidContentResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'llama-3.3-70b',
    messages: [
      {
        role: 'user',
        content: {
          unexpected: true,
        },
      },
    ],
  });
  assert.equal(invalidContentResponse.status, 400);
  const invalidContentBody = await invalidContentResponse.json();
  assert.match(invalidContentBody.error.message, /messages\[0\]\.content must be a string or an array/i);

  console.log('attachment regression checks passed');
} finally {
  await close(server);
  await rm(cacheDir, { recursive: true, force: true });
}


