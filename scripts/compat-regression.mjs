import assert from 'node:assert/strict';
import {
  createAnthropicStreamTransformer,
  fromAnthropicRequest,
  toAnthropicResponse,
} from '../dist/anthropic-bridge.js';
import { createServer } from '../dist/server.js';
import { setAgentRailApiKey } from '../dist/config.js';
import { usageTracker } from '../dist/usage-tracker.js';

setAgentRailApiKey('');

const provider = { name: 'mock-provider' };
const calls = [];
const recordUsage = usageTracker.record.bind(usageTracker);
usageTracker.record = () => {};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

async function mockRouteChatCompletion(request) {
  calls.push(request);

  if (request.model === 'openai-non-stream') {
    return {
      provider,
      response: jsonResponse({
        id: 'chatcmpl-openai-non-stream',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OpenAI compatibility OK' },
            finish_reason: 'stop',
          },
        ],
      }),
    };
  }

  if (request.model === 'openai-stream') {
    return {
      provider,
      response: sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"OpenAI "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"stream OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":3,"total_tokens":9}}\n\n',
        'data: [DONE]\n\n',
      ]),
    };
  }

  if (request.model === 'responses-tool-stream') {
    return {
      provider,
      response: sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather_stream","type":"function","function":{"name":"lookup_weather","arguments":"{\\"city\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"type":"function","function":{"arguments":":\\"Paris\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\n',
        'data: [DONE]\n\n',
      ]),
    };
  }

  if (request.model === 'anthropic-non-stream' || request.model === 'responses-tool') {
    return {
      provider,
      response: jsonResponse({
        id: 'chatcmpl-anthropic-tool',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_weather',
                  type: 'function',
                  function: {
                    name: 'lookup_weather',
                    arguments: '{"city":"Paris"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
        },
      }),
    };
  }

  if (request.model === 'anthropic-stream') {
    return {
      provider,
      response: sseResponse([
        'data: {"choices":[{"delta":{"content":"Anthropic "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"stream OK"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    };
  }

  if (request.model === 'pseudo-tool-non-stream') {
    return {
      provider,
      response: jsonResponse({
        id: 'chatcmpl-pseudo-tool',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="read_file"> <｜｜DSML｜｜parameter name="path" string="true">agentrail/src/http/routes/virtual-models.ts</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
          total_tokens: 10,
        },
      }),
    };
  }

  if (request.model === 'pseudo-tool-stream') {
    return {
      provider,
      response: sseResponse([
        'data: {"choices":[{"delta":{"content":"<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name=\\"read_file\\"> <｜｜DSML｜｜parameter name=\\"path\\" string=\\"true\\">agentrail/src/router.ts</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>"},"finish_reason":null}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}\n\n',
        'data: [DONE]\n\n',
      ]),
    };
  }

  if (request.model === 'provider-401') {
    return {
      provider,
      response: jsonResponse({ error: { message: 'bad key', type: 'authentication_error' } }, 401),
    };
  }

  if (request.model === 'provider-429') {
    return {
      provider,
      response: jsonResponse({ error: { message: 'rate limited', type: 'rate_limit_error' } }, 429),
    };
  }

  if (request.model === 'provider-500') {
    return {
      provider,
      response: jsonResponse({ error: { message: 'upstream failed', type: 'server_error' } }, 500),
    };
  }

  if (request.model === 'provider-non-json') {
    return {
      provider,
      response: new Response('upstream temporarily unavailable', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    };
  }

  throw new Error(`Unexpected mock model: ${request.model}`);
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

function parseAnthropicSse(body) {
  return body
    .split(/\r?\n\r?\n/)
    .flatMap((segment) => segment.split(/\r?\n/).filter((line) => line.startsWith('data: ')))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}

function assertAnthropicBridgeConversions() {
  const bridgedToolResult = fromAnthropicRequest({
    model: 'anthropic-bridge',
    stream: true,
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking weather' },
          {
            type: 'tool_use',
            id: 'toolu_weather',
            name: 'lookup_weather',
            input: { city: 'Paris' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_weather',
            content: [{ type: 'text', text: 'sunny' }],
          },
        ],
      },
    ],
    tools: [
      {
        name: 'lookup_weather',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    ],
    tool_choice: { type: 'any' },
  });

  assert.equal(bridgedToolResult.stream, true);
  assert.equal(bridgedToolResult.messages[0].role, 'assistant');
  assert.equal(bridgedToolResult.messages[0].content, 'Checking weather');
  assert.equal(bridgedToolResult.messages[0].tool_calls[0].id, 'toolu_weather');
  assert.equal(bridgedToolResult.messages[0].tool_calls[0].function.name, 'lookup_weather');
  assert.equal(bridgedToolResult.messages[0].tool_calls[0].function.arguments, '{"city":"Paris"}');
  assert.equal(bridgedToolResult.messages[1].role, 'tool');
  assert.equal(bridgedToolResult.messages[1].tool_call_id, 'toolu_weather');
  assert.equal(bridgedToolResult.messages[1].content, 'sunny');
  assert.equal(bridgedToolResult.tool_choice, 'required');
  assert.equal(bridgedToolResult.tools[0].function.parameters.properties.city.type, 'string');

  const autoToolChoice = fromAnthropicRequest({
    model: 'anthropic-bridge',
    messages: [{ role: 'user', content: 'hello' }],
    tool_choice: { type: 'auto' },
  });
  assert.equal(autoToolChoice.tool_choice, 'auto');

  const textResponse = toAnthropicResponse(
    {
      id: 'chatcmpl-text',
      choices: [
        {
          message: { role: 'assistant', content: 'Done' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    },
    'anthropic-bridge',
  );
  assert.equal(textResponse.stop_reason, 'end_turn');
  assert.deepEqual(textResponse.content, [{ type: 'text', text: 'Done' }]);
  assert.equal(textResponse.usage.input_tokens, 4);
  assert.equal(textResponse.usage.output_tokens, 2);

  const lengthResponse = toAnthropicResponse(
    {
      id: 'chatcmpl-length',
      choices: [
        {
          message: { role: 'assistant', content: 'Partial' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
    },
    'anthropic-bridge',
  );
  assert.equal(lengthResponse.stop_reason, 'max_tokens');

  const invalidToolArgsResponse = toAnthropicResponse(
    {
      id: 'chatcmpl-invalid-tool-args',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_invalid',
                type: 'function',
                function: {
                  name: 'lookup_weather',
                  arguments: 'not json',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    'anthropic-bridge',
  );
  assert.equal(invalidToolArgsResponse.stop_reason, 'tool_use');
  assert.deepEqual(invalidToolArgsResponse.content[0].input, {});

  const transformer = createAnthropicStreamTransformer();
  const toolStart = transformer.transform({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_stream_weather',
              type: 'function',
              function: { name: 'lookup_weather', arguments: '{"city"' },
            },
          ],
        },
      },
    ],
  });
  const toolDelta = transformer.transform({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              type: 'function',
              function: { arguments: ':"Paris"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  });
  const toolEnd = transformer.end();
  const streamToolEvents = parseAnthropicSse(toolStart + toolDelta + toolEnd);
  assert.deepEqual(
    streamToolEvents.map((event) => event.type),
    [
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
  assert.equal(streamToolEvents[0].content_block.type, 'tool_use');
  assert.equal(streamToolEvents[0].content_block.id, 'call_stream_weather');
  assert.equal(streamToolEvents[0].content_block.name, 'lookup_weather');
  assert.equal(
    streamToolEvents
      .filter((event) => event.type === 'content_block_delta')
      .map((event) => event.delta.partial_json)
      .join(''),
    '{"city":"Paris"}',
  );
  assert.equal(streamToolEvents[4].delta.stop_reason, 'tool_use');
}

const server = createServer({ routeChatCompletion: mockRouteChatCompletion });
const baseUrl = await listen(server);

try {
  assertAnthropicBridgeConversions();

  const openAIResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'openai-non-stream',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(openAIResponse.status, 200);
  assert.equal(openAIResponse.headers.get('x-agentrail-provider'), provider.name);
  const openAIBody = await openAIResponse.json();
  assert.equal(openAIBody.choices[0].message.content, 'OpenAI compatibility OK');
  assert.equal(typeof openAIBody.usage.prompt_tokens, 'number');
  assert.equal(typeof openAIBody.usage.completion_tokens, 'number');
  assert.equal(openAIBody.usage.total_tokens, openAIBody.usage.prompt_tokens + openAIBody.usage.completion_tokens);

  const openAIToolResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'responses-tool',
    messages: [{ role: 'user', content: 'Look up Paris weather' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup_weather',
          description: 'Return weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ],
  });
  assert.equal(openAIToolResponse.status, 200);
  const openAIToolBody = await openAIToolResponse.json();
  assert.equal(openAIToolBody.choices[0].finish_reason, 'tool_calls');
  assert.equal(openAIToolBody.choices[0].message.role, 'assistant');
  assert.equal(openAIToolBody.choices[0].message.content, '');
  assert.equal(Array.isArray(openAIToolBody.choices[0].message.tool_calls), true);
  assert.equal(openAIToolBody.choices[0].message.tool_calls.length, 1);
  assert.equal(typeof openAIToolBody.choices[0].message.tool_calls[0].id, 'string');
  assert.equal(openAIToolBody.choices[0].message.tool_calls[0].type, 'function');
  assert.equal(openAIToolBody.choices[0].message.tool_calls[0].function.name, 'lookup_weather');
  assert.doesNotThrow(() => JSON.parse(openAIToolBody.choices[0].message.tool_calls[0].function.arguments));
  assert.deepEqual(
    JSON.parse(openAIToolBody.choices[0].message.tool_calls[0].function.arguments),
    { city: 'Paris' },
  );

  const openAIStreamResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'openai-stream',
    stream: true,
    messages: [{ role: 'user', content: 'stream please' }],
  });
  assert.equal(openAIStreamResponse.status, 200);
  assert.match(openAIStreamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  const openAIStreamBody = await openAIStreamResponse.text();
  assert.match(openAIStreamBody, /data: \[DONE\]/);
  assert.match(openAIStreamBody, /OpenAI /);
  assert.match(openAIStreamBody, /stream OK/);

  const responsesTextResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'openai-non-stream',
    input: 'ping from Codex Desktop',
  });
  assert.equal(responsesTextResponse.status, 200);
  assert.equal(responsesTextResponse.headers.get('x-agentrail-provider'), provider.name);
  const responsesTextBody = await responsesTextResponse.json();
  assert.equal(responsesTextBody.object, 'response');
  assert.equal(responsesTextBody.model, 'openai-non-stream');
  assert.equal(responsesTextBody.output_text, 'OpenAI compatibility OK');
  assert.equal(responsesTextBody.output[0].type, 'message');
  assert.equal(responsesTextBody.output[0].content[0].type, 'output_text');
  assert.equal(responsesTextBody.output[0].content[0].text, 'OpenAI compatibility OK');
  assert.equal(typeof responsesTextBody.usage.input_tokens, 'number');
  assert.equal(typeof responsesTextBody.usage.output_tokens, 'number');

  const responsesToolResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'responses-tool',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Look up Paris weather' }],
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'lookup_weather',
        description: 'Return weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
  });
  assert.equal(responsesToolResponse.status, 200);
  const responsesToolBody = await responsesToolResponse.json();
  assert.equal(responsesToolBody.output[0].type, 'function_call');
  assert.equal(responsesToolBody.output[0].name, 'lookup_weather');
  assert.equal(responsesToolBody.output[0].arguments, '{"city":"Paris"}');
  const responsesToolCall = calls.find((call) => call.model === 'responses-tool' && call.messages[0]?.content === 'Look up Paris weather');
  assert(responsesToolCall);
  assert.equal(responsesToolCall.tools[0].type, 'function');
  assert.equal(responsesToolCall.tools[0].function.name, 'lookup_weather');
  assert.equal(responsesToolCall.tools[0].function.parameters.properties.city.type, 'string');

  const responsesStreamResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'openai-stream',
    stream: true,
    input: 'stream from Codex Desktop',
  });
  assert.equal(responsesStreamResponse.status, 200);
  assert.match(responsesStreamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  const responsesStreamBody = await responsesStreamResponse.text();
  assert.match(responsesStreamBody, /event: response\.created/);
  assert.match(responsesStreamBody, /event: response\.output_text\.delta/);
  assert.match(responsesStreamBody, /OpenAI /);
  assert.match(responsesStreamBody, /stream OK/);
  assert.match(responsesStreamBody, /event: response\.completed/);

  const responsesToolStreamResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'responses-tool-stream',
    stream: true,
    input: 'stream a weather tool call',
    tools: [
      {
        type: 'function',
        name: 'lookup_weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ],
  });
  assert.equal(responsesToolStreamResponse.status, 200);
  const responsesToolStreamBody = await responsesToolStreamResponse.text();
  assert.match(responsesToolStreamBody, /event: response\.output_item\.added/);
  assert.match(responsesToolStreamBody, /"type":"function_call"/);
  assert.match(responsesToolStreamBody, /event: response\.function_call_arguments\.delta/);
  assert.match(responsesToolStreamBody, /"delta":"\{\\"city\\""/);
  assert.match(responsesToolStreamBody, /event: response\.function_call_arguments\.done/);
  assert.match(responsesToolStreamBody, /"arguments":"\{\\"city\\":\\"Paris\\"\}"/);

  const responsesProviderError = await postJson(baseUrl, '/v1/responses', {
    model: 'provider-429',
    input: 'trigger provider error',
  });
  assert.equal(responsesProviderError.status, 429);
  const responsesProviderErrorBody = await responsesProviderError.json();
  assert.equal(responsesProviderErrorBody.error.message, 'rate limited');

  const unsupportedResponsesResponse = await postJson(baseUrl, '/v1/responses', {
    model: 'openai-non-stream',
    previous_response_id: 'resp_previous',
    input: 'unsupported stateful request',
  });
  assert.equal(unsupportedResponsesResponse.status, 400);
  const unsupportedResponsesBody = await unsupportedResponsesResponse.json();
  assert.equal(unsupportedResponsesBody.error.type, 'invalid_request_error');
  assert.match(unsupportedResponsesBody.error.message, /previous_response_id/);

  const anthropicResponse = await postJson(baseUrl, '/v1/messages', {
    model: 'anthropic-non-stream',
    max_tokens: 64,
    system: 'Use tools when needed',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Look up Paris weather' }],
      },
    ],
    tools: [
      {
        name: 'lookup_weather',
        description: 'Return weather for a city',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'lookup_weather' },
  });
  assert.equal(anthropicResponse.status, 200);
  assert.equal(anthropicResponse.headers.get('x-agentrail-provider'), provider.name);
  const anthropicBody = await anthropicResponse.json();
  assert.equal(anthropicBody.type, 'message');
  assert.equal(anthropicBody.role, 'assistant');
  assert.equal(anthropicBody.stop_reason, 'tool_use');
  assert.equal(anthropicBody.usage.input_tokens, 12);
  assert.equal(anthropicBody.usage.output_tokens, 5);
  assert.equal(anthropicBody.content[0].type, 'tool_use');
  assert.equal(anthropicBody.content[0].name, 'lookup_weather');
  assert.deepEqual(anthropicBody.content[0].input, { city: 'Paris' });

  const pseudoToolResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'pseudo-tool-non-stream',
    messages: [{ role: 'user', content: 'Read the virtual model file' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'read_file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ],
  });
  assert.equal(pseudoToolResponse.status, 200);
  const pseudoToolBody = await pseudoToolResponse.json();
  assert.equal(pseudoToolBody.choices[0].finish_reason, 'tool_calls');
  assert.equal(pseudoToolBody.choices[0].message.content, null);
  assert.equal(pseudoToolBody.choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.equal(
    pseudoToolBody.choices[0].message.tool_calls[0].function.arguments,
    '{"path":"agentrail/src/http/routes/virtual-models.ts"}',
  );

  const pseudoToolStreamResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'pseudo-tool-stream',
    stream: true,
    messages: [{ role: 'user', content: 'Read the router file' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'read_file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ],
  });
  assert.equal(pseudoToolStreamResponse.status, 200);
  const pseudoToolStreamBody = await pseudoToolStreamResponse.text();
  assert.match(pseudoToolStreamBody, /"tool_calls":\[\{/);
  assert.match(pseudoToolStreamBody, /"name":"read_file"/);
  assert.match(pseudoToolStreamBody, /agentrail\/src\/router\.ts/);
  assert.match(pseudoToolStreamBody, /"finish_reason":"tool_calls"/);
  assert.doesNotMatch(pseudoToolStreamBody, /DSML/);

  const anthropicCall = calls.find((call) => call.model === 'anthropic-non-stream');
  assert(anthropicCall);
  assert.equal(anthropicCall.messages[0].role, 'system');
  assert.equal(anthropicCall.messages[0].content, 'Use tools when needed');
  assert.equal(anthropicCall.tools[0].type, 'function');
  assert.equal(anthropicCall.tools[0].function.name, 'lookup_weather');
  assert.equal(anthropicCall.tools[0].function.parameters.properties.city.type, 'string');
  assert.deepEqual(anthropicCall.tool_choice, {
    type: 'function',
    function: { name: 'lookup_weather' },
  });

  const anthropicStreamResponse = await postJson(baseUrl, '/v1/messages', {
    model: 'anthropic-stream',
    max_tokens: 64,
    stream: true,
    messages: [{ role: 'user', content: 'stream please' }],
  });
  assert.equal(anthropicStreamResponse.status, 200);
  assert.match(anthropicStreamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  const anthropicStreamBody = await anthropicStreamResponse.text();
  const anthropicEvents = parseAnthropicSse(anthropicStreamBody);
  assert.deepEqual(
    anthropicEvents.map((event) => event.type),
    [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
  assert.equal(
    anthropicEvents
      .filter((event) => event.type === 'content_block_delta')
      .map((event) => event.delta.text)
      .join(''),
    'Anthropic stream OK',
  );

  for (const [model, status, message] of [
    ['provider-401', 401, 'bad key'],
    ['provider-429', 429, 'rate limited'],
    ['provider-500', 500, 'upstream failed'],
  ]) {
    const providerErrorResponse = await postJson(baseUrl, '/v1/chat/completions', {
      model,
      messages: [{ role: 'user', content: 'trigger provider error' }],
    });
    assert.equal(providerErrorResponse.status, status);
    const providerErrorBody = await providerErrorResponse.json();
    assert.equal(providerErrorBody.error.message, message);
  }

  const nonJsonErrorResponse = await postJson(baseUrl, '/v1/chat/completions', {
    model: 'provider-non-json',
    messages: [{ role: 'user', content: 'trigger non-json error' }],
  });
  assert.equal(nonJsonErrorResponse.status, 500);
  const nonJsonErrorBody = await nonJsonErrorResponse.json();
  assert.equal(nonJsonErrorBody.error.type, 'internal_error');

  console.log('compat regression checks passed');
} finally {
  usageTracker.record = recordUsage;
  await close(server);
}
