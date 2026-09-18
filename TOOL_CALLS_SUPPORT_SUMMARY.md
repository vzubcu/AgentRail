# OpenAI-Compatible Tool Calls Support in agentrail

## Overview
This document summarizes the current state of OpenAI-compatible `tool_calls` (function calling) support in the agentrail gateway's `/v1/chat/completions` endpoint, based on an examination of the source code.

## Request Handling
**File:** `agentrail/src/http/routes/openai.ts`
- **Lines ~640-670**: The endpoint parses and validates the incoming `ChatCompletionRequest`, including the `tools`, `tool_choice`, and `parallel_tool_calls` fields.
- **Lines ~666-669**: Attachments are normalized and model capabilities are asserted via `normalizeChatRequestAttachments` and `assertRequestModelCapabilities`.

## Provider Routing and Tool Call Support
**File:** `agentrail/src/router.ts`
- **Function `providerSupportsToolCalls` (lines ~130-134)**: Returns `true` for providers known to support tool calls based on a hardcoded list: `['openai', 'azure', 'anthropic', 'groq', 'cohere', 'replicate']`.
- **Functions `getAutoRouteCandidates` and `getAutoRouteCandidatesWithToolCalls` (lines ~140-160)**: Used to select providers. The latter filters providers by those that support tool calls when the request includes tools.

## Response Handling (Non-Streaming)
**File:** `agentrail/src/http/routes/openai.ts`
- **Lines ~694-799 (streaming) and ~610-626 (non-streaming)**:
  - For non-streaming responses, the raw provider response is passed through to the client after adding custom headers (`X-AgentRail-Provider`, etc.).
  - **No transformation** is applied to convert non-OpenAI tool call formats (e.g., Anthropic's `tool_use`) into OpenAI's `tool_calls` format.

## Response Handling (Streaming)
**File:** `agentrail/src/http/routes/openai.ts`
- **Lines ~722-799 (streaming response loop)**:
  - The stream is proxied byte-for-byte from the provider to the client.
  - **Tool call detection**: The code includes logic to summarize tool call chunks (`summarizeToolCallsForTrace`) and detect when the finish reason is `"tool_calls"`.
  - **Textual tool call signal rejection**: If the request includes tools but the provider returns textual tool call signals (e.g., `<function=...>`) without structured `tool_calls`, the stream is aborted with a `ToolCallContractError` (see `shouldRejectTextualToolCallText` and lines ~744-754).
  - **Textual tool call stripping**: Textual tool call markers (e.g., ````tool_call````) are stripped from the stream content when tools are not present in the request (see `stripTextualToolCalls` and its usage in lines ~741, ~783).
  - **No transformation**: The stream is not transformed to convert non-OpenAI tool call formats into OpenAI format.

## Identified Gaps
1. **Upstream Response Transformation**: The chat/completions endpoint does not transform the provider's response to ensure OpenAI-compatible `tool_calls` format. If a non-OpenAI provider (e.g., Anthropic) is selected via the OpenAI-compatible endpoint, the tool calls will be returned in the provider's native format, breaking OpenAI compatibility.
2. **Static Tool Capability Detection**: The `providerSupportsToolCalls` function uses a hardcoded list of providers, which may not align with the actual capabilities defined in the model catalog.
3. **Streaming Transformation Gap**: Similar to non-streaming, the streaming path does not transform non-OpenAI tool call formats.

## Recommended Next Steps
1. **Add Response Transformation Layer**:
   - For non-OpenAI providers that support tool calls (e.g., Anthropic), translate the response to OpenAI chat completion format before sending to the client.
   - Reuse existing bridges (e.g., `anthropic-bridge.ts`) or create new ones for other providers.
   - Apply this transformation in both streaming and non-streaming paths.

2. **Dynamic Capability Detection**:
   - Replace the hardcoded list in `providerSupportsToolCalls` with a lookup in the model catalog (if available) to determine if the selected model/provider truly supports tool calls.

3. **Streaming Transformation**:
   - Implement a streaming transformer that can convert non-OpenAI tool call events (e.g., Anthropic's `tool_use` chunk) into OpenAI `tool_calls` chunk format.

4. **Testing**:
   - Add end-to-end tests for tool calls with various providers (OpenAI, Anthropic, etc.) to ensure OpenAI-compatible responses.
   - Verify that textual tool call signals are properly handled and stripped when appropriate.

## Files Referenced
- `agentrail/src/http/routes/openai.ts`
- `agentrail/src/router.ts`
- `agentrail/src/anthropic-bridge.ts` (for reference on Anthropic-to-OpenAI translation)
- `agentrail/src/completions-bridge.ts` (for reference on completions translation, though not directly used in chat/completions)