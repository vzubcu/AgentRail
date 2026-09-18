## Codex Desktop Setup Guide

Follow these steps to connect Codex Desktop to AgentRail through the OpenAI-compatible local endpoint.

### 1. Start AgentRail

AgentRail must be reachable from the same machine where Codex Desktop sends model requests:

```bash
agentrail
```

For local development:

```bash
npm run build
npm start
```

### 2. Configure Codex Desktop

Use these provider settings:

- Base URL: `http://localhost:42424/v1`
- API key: your `AGENTRAIL_API_KEY`, or any non-empty value if gateway auth is disabled
- Model: one of the IDs returned by `GET http://localhost:42424/v1/models`

Codex Desktop calls `POST /v1/responses`. AgentRail implements a focused Responses API compatibility subset for text and function-tool requests, then routes them through the same provider path used by `/v1/chat/completions`.

### 3. Verify the Responses endpoint

Run a direct local request from the same environment:

```bash
curl http://localhost:42424/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENTRAIL_API_KEY" \
  -d '{
    "model": "agentrail/auto",
    "input": "Say hello from AgentRail"
  }'
```

A successful response has `"object":"response"` and an `output_text` value.

### 4. Current compatibility limits

AgentRail's `POST /v1/responses` support is stateless. It does not store or retrieve prior response objects, so `previous_response_id` is rejected. Send the full conversation context in each request.

The supported subset covers text input/output and function tools. Non-text multimodal blocks and hosted OpenAI tool types are not supported in this compatibility layer yet.