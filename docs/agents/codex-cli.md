## Codex CLI Setup Guide

Follow these steps to connect Codex CLI with AgentRail.

### 1. Generate persistent Codex profiles

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or open the dedicated Quick Connect tab from the main dashboard, choose one or more models, then click **Configure Codex**.

This writes:

- `~/.codex/config.toml` with a reusable `[model_providers.agentrail]` block pointing at `http://localhost:42424/v1`
- `~/.codex/agentrail-*.config.toml` per-model profiles

The generated files do **not** store `AGENTRAIL_API_KEY`.
The dashboard result also shows the PowerShell env value you still need plus the default profile name. If AgentRail is running directly on your Windows host and `codex` is in `PATH`, you can also click **Launch Codex** for the currently selected model.

### 2. Export the runtime env value

If AgentRail gateway auth is enabled, export the key in your shell before starting Codex CLI.
If gateway auth is disabled, any non-empty value is sufficient.

On Windows (PowerShell):

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 3. Launch caveat

The dashboard launch button opens a new PowerShell window on the same machine as the AgentRail process. If AgentRail is running inside Docker or on a remote host, use the copied env snippet and start Codex manually.

### 4. Switch models

Use the default profile shown by the dashboard result, for example `agentrail-auto`, or another generated profile name such as `agentrail-foo-bar`.

### 5. Notes

- Re-running the Codex setup action overwrites only `agentrail-*` profiles and preserves unrelated Codex config.
- AgentRail uses the OpenAI Responses-compatible surface for Codex.
- Ensure AgentRail is running before launching Codex CLI.


