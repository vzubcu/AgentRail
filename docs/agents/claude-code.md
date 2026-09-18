## Claude Code Setup Guide

Follow these steps to connect Claude Code with AgentRail.

### 1. Generate a persistent profile

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or open the dedicated Quick Connect tab from the main dashboard, choose one or more models, then click **Configure Claude Code**.

This writes one profile per available AgentRail model under:

- `~/.claude/profiles/agentrail-*/settings.json`

The generated profile stores:

- `ANTHROPIC_BASE_URL=http://localhost:42424`
- `ANTHROPIC_MODEL=<agentrail model id>`
- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`

It does **not** store `ANTHROPIC_AUTH_TOKEN` on disk.
The dashboard result also shows the PowerShell env values you still need at runtime. If AgentRail is running directly on your Windows host and `claude` is in `PATH`, you can also click **Launch Claude Code** for the currently selected model.

### 2. Export the runtime env values

If AgentRail gateway auth is enabled, export your token before launching Claude Code.
If gateway auth is disabled, any non-empty value is sufficient.

On Windows (PowerShell):

```powershell
$env:CLAUDE_CONFIG_DIR="$HOME/.claude/profiles/agentrail-auto"
$env:ANTHROPIC_AUTH_TOKEN="your_agentrail_api_key"
$env:ANTHROPIC_BASE_URL="http://localhost:42424"
```

### 3. Launch caveat

The dashboard launch button opens a new PowerShell window on the same machine as the AgentRail process. If AgentRail is running inside Docker or on a remote host, use the copied env snippet instead of the launch button.

### 4. Switch profiles

Each generated profile name starts with `agentrail-`.
Point `CLAUDE_CONFIG_DIR` at a different generated directory to switch models.

### 5. Verify setup

Run a simple prompt and confirm the request appears in AgentRail.

### 6. Notes

- AgentRail keeps the Claude profile persistent, but the token remains shell-managed.
- Re-running the Claude Code setup action updates existing `agentrail-*` profiles in place.
- Ensure AgentRail is running before launching Claude Code.



