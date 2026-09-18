# Local Endpoints and Remote Proxies

AgentRail is local-first. It runs on your computer and exposes local OpenAI- and Anthropic-compatible endpoints:

- OpenAI-compatible: `http://localhost:42424/v1`
- Anthropic-compatible: `http://localhost:42424`

OpenAI-compatible clients may call either `POST /v1/chat/completions` or `POST /v1/responses`, depending on the tool. Codex Desktop uses the Responses API route.

This works well when your AI client sends API requests directly from your machine to AgentRail. It may not work when the client first sends those requests to its own remote service and that remote service calls the configured API URL on your behalf.

## Why `localhost` can point to the wrong place

`localhost` always means "this machine" from the point of view of the process making the HTTP request.

When a local CLI, editor extension, or desktop app calls AgentRail directly, `localhost:42424` means your computer. The request reaches your local AgentRail server, and AgentRail can route it to the providers you have configured.

When a client proxies the request through a remote server first, the remote server becomes the process making the HTTP request. In that case, `localhost:42424` means the remote server's own environment, not your computer. Your AgentRail process is still running locally, but the remote service cannot see it at that address.

That distinction is the important part:

- Direct local request: `client on your machine -> localhost:42424 -> AgentRail`
- Remote-proxied request: `client -> remote service -> localhost:42424 on the remote service`

AgentRail cannot make a third-party remote service reach a private `localhost` address on your machine. For the local-first setup, the client needs to call the custom base URL directly from the same machine or environment where AgentRail is running.

## Cursor caveat

Cursor is a known example to check carefully. Some Cursor API flows may proxy requests through Cursor-controlled servers before calling the configured API endpoint. In those flows, `localhost:42424` refers to Cursor's remote environment, so a local AgentRail endpoint may not be reachable.

This does not mean every Cursor feature, version, or configuration behaves the same way. Treat Cursor as a caveat: verify the exact flow you are using before assuming a local AgentRail endpoint will work.

## What AgentRail supports

AgentRail supports clients that can call custom OpenAI- or Anthropic-compatible base URLs directly from your local machine, local shell, local editor process, or another environment that can actually reach the AgentRail server.

AgentRail does not claim support for clients that only call model APIs from a vendor-hosted backend and cannot directly reach your local endpoint.

You can expose a local service through a tunnel or public URL, but that changes the security model. AgentRail's default setup assumes local access, local provider keys, and a private `localhost` gateway.

## Quick compatibility checklist

Use this checklist when testing a new client:

- Can the client set a custom OpenAI or Anthropic base URL?
- Is the API request sent by a process running on your machine, rather than by the client's cloud service?
- Can the client use `http://localhost:42424/v1` for OpenAI-compatible calls or `http://localhost:42424` for Anthropic-compatible calls?
- If the client is Codex Desktop or another Responses API client, does `POST /v1/responses` work from the same environment?
- After sending a test prompt, does AgentRail show the request in its console or terminal logs?
- If the client fails, does a direct local command such as `curl http://localhost:42424/v1/models` still work from the same shell or environment?
- Does the client documentation mention server-side API calls, cloud execution, remote agents, hosted gateways, or provider-side proxying?

If `curl` works locally but the client never reaches AgentRail, the client may not be making the request from the same machine. It may be using a remote proxy, a hosted workspace, a container, WSL, or another isolated environment where `localhost` means something else.

## A simple test

Start AgentRail, then verify the local endpoint from your machine:

```bash
curl http://localhost:42424/v1/models
```

Then configure the client with the matching base URL:

- OpenAI-compatible clients: `http://localhost:42424/v1`
- Anthropic-compatible clients: `http://localhost:42424`

Send a small test prompt. If AgentRail records the request, the client can reach the local endpoint. If AgentRail records nothing, the request is likely not arriving at your local gateway, and the client may need a different networking setup or may not be compatible with a private localhost endpoint.
