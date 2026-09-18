## Cline Setup Guide

Follow these steps to connect Cline with AgentRail.

### 1. Generate the safe Cline scaffold

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or switch to the dedicated Quick Connect tab from the main dashboard, then click **Configure Cline**.

This writes:

- `~/.cline/data/globalState.json`

The generated scaffold stores:

- `openAiBaseUrl=http://localhost:42424`
- the selected AgentRail model id for both Act and Plan mode

It does **not** store the gateway key on disk.

### 2. Finish the manual key step in Cline

Open **Cline Settings → API** and paste your AgentRail gateway key into the OpenAI-compatible API key field.

Use these values:

- Base URL: `http://localhost:42424`
- Model: the primary model shown in the dashboard result

### 3. Optional shell reference

If AgentRail gateway auth is enabled, keep this value ready:

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 4. Notes

- The dashboard labels Cline as **Assisted** because the API key remains a manual step.
- Re-running the Cline setup action refreshes the non-secret scaffold in place.



