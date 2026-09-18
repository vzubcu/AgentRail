# AgentRail MCP Server

 AgentRail poate fi folosit ca **MCP server** pentru clienți precum Antigravity, Cline, Claude Desktop etc., printr-un adaptor stdio care traduce JSON-RPC în HTTP către gateway-ul local AgentRail.

## Cerințe

- AgentRail gateway rulează deja pe `http://localhost:42424` (sau altă adresă configurată).
- Node.js 18+.
- Pacakage-ul MCP este inclus în repo (`src/mcp/`) și se publică împreună cu AgentRail.

## Configurare

### Variabile de mediu

| Variabilă | Descriere | Implicit |
|---|---|---|
| `AGENTRAIL_URL` | URL-ul gateway-ului AgentRail | `http://localhost:42424` |
| `AGENTRAIL_API_KEY` | Cheie de auth pentru gateway (opțional) | — |
| `AGENTRAIL_TIMEOUT_MS` | Timeout pentru request-uri către gateway | `30000` |

### Antigravity / Cline / Claude Desktop

Adaugă în fișierul de configurare MCP:

```json
{
  "mcpServers": {
    "agentrail": {
      "command": "npx",
      "args": ["-y", "@vzubcu/agentrail-mcp"],
      "env": {
        "AGENTRAIL_URL": "http://localhost:42424",
        "AGENTRAIL_API_KEY": "cheia-ta-opțională"
      }
    }
  }
}
```

## Tool-uri disponibile

### `list_models`

Listează modelele active expuse de gateway.

**Exemplu răspuns:**

```json
{
  "models": [
    "llama-3.3-70b",
    "deepseek-chat",
    "gemini-2.5-flash"
  ]
}
```

### `chat_completions`

Trimite un request de chat completion prin AgentRail.

**Parametri:**

- `model` (string, required) — identificatorul modelului.
- `messages` (array, required) — mesaje chat.
- `temperature` (number, optional)
- `max_tokens` (number, optional)
- `top_p` (number, optional)
- `stream` (boolean, optional)
- `provider` (string, optional) — hint de provider (ex: `openrouter`).

**Exemplu:**

```json
{
  "model": "llama-3.3-70b",
  "messages": [
    { "role": "user", "content": "Salut!" }
  ],
  "temperature": 0.7
}
```

### `check_health`

Verifică starea de sănătate a gateway-ului AgentRail.

### `check_provider`

Declanșează un health check pentru un provider specific.

**Parametri:**

- `provider` (string, required) — nume provider (ex: `openrouter`, `groq`).

## Testare locală

```bash
# 1. Pornește AgentRail gateway
npm run build && npm start

# 2. În alt terminal, rulează MCP server-ul în modul test
node dist/mcp/index.js
```

Server-ul va rula pe stdio și va aștepta request-uri MCP de la client.

## Note

- MCP server-ul este un **adaptor subțire** — toată logica de routing, fallback, modele virtuale și health checks rămân în gateway-ul AgentRail.
- Pentru a publica pe npm, se rulează `npm publish` din repo (necesită autentificare npm cu drepturi de publish pe scope-ul `@vzubcu`).