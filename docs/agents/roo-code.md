## Roo Code Setup Guide

Follow these steps to connect Roo Code with AgentRail.

### 1. Generate the Roo scaffold

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or switch to the dedicated Quick Connect tab from the main dashboard, then click **Configure Roo Code**.

This writes:

- `~/.agentrail/roo-settings.json`
- your VS Code `settings.json` with `roo-cline.autoImportSettingsPath`

The generated import file stores:

- `openAiBaseUrl=http://localhost:42424/v1`
- the selected AgentRail model id

It does **not** store the gateway key on disk.

### 2. Load the Roo settings

Restart VS Code or use Roo Code's **Import Settings** flow so Roo reads the generated import file.

### 3. Finish the manual key step

When Roo prompts for the OpenAI-compatible provider key, paste your AgentRail gateway key.

Optional PowerShell reference:

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 4. Notes

- The dashboard labels Roo Code as **Assisted** because the key remains out of disk-backed config.
- Re-running the setup action refreshes the import scaffold and the VS Code auto-import pointer.



