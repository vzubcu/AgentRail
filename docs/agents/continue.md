## Continue Setup Guide

Follow these steps to connect Continue with AgentRail in VS Code or JetBrains / Rider.

### 1. Generate the Continue config

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or switch to the dedicated Quick Connect tab from the main dashboard, then click **Configure Continue** from either the **VS Code** or **JetBrains / Rider** group.

This writes:

- `~/.continue/config.yaml`

The generated config is based on the live AgentRail model surface and uses the AgentRail OpenAI-compatible endpoint:

- `http://localhost:42424/v1`

The file does **not** store `AGENTRAIL_API_KEY` on disk.

### 2. Export the runtime env value

If AgentRail gateway auth is enabled, export the key in your shell before using Continue.
If gateway auth is disabled, any non-empty value is sufficient.

On Windows (PowerShell):

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 3. Restart Continue

Restart Continue so it reloads `~/.continue/config.yaml`.
The generated config works for both VS Code and JetBrains / Rider.

### 4. Notes

- Re-running the Continue setup action refreshes the AgentRail model entries and preserves unrelated Continue config.
- The generated Continue models are named `AgentRail: <model-id>`.
- AgentRail keeps the gateway key shell-managed instead of writing it into the Continue config.



