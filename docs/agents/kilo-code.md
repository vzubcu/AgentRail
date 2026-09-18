## Kilo Code Setup Guide

Follow these steps to connect Kilo Code with AgentRail.

### 1. Generate the VS Code provider settings

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or switch to the dedicated Quick Connect tab from the main dashboard, then click **Configure Kilo Code**.

This writes your VS Code `settings.json` with AgentRail values for:

- `kilocode.customProvider`
- `kilocode.defaultModel`

The generated settings point Kilo Code at:

- `http://localhost:42424/v1`

They do **not** store the gateway key on disk.

### 2. Finish the manual key step in Kilo Code

Open Kilo Code settings and paste your AgentRail gateway key into the custom provider API key field.

Optional PowerShell reference:

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 3. Notes

- The dashboard labels Kilo Code as **Assisted** because the key remains a manual step.
- Re-running the setup action refreshes the safe VS Code settings in place.



