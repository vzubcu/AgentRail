## Rider / Junie Setup Guide

AgentRail currently exposes **Junie** as a **Guide** card in the dashboard instead of an auto-config action.

### 1. Open the Junie guide

Open the AgentRail dashboard at `http://localhost:42424/quick-connect` or switch to the dedicated Quick Connect tab from the main dashboard, then under **JetBrains / Rider** click **Show setup** on **Junie**.

The dashboard shows the current local values to use as a manual reference:

- OpenAI-compatible base URL: `http://localhost:42424/v1`
- Suggested model: the current primary AgentRail model
- Gateway key reference: `AGENTRAIL_API_KEY`

### 2. Keep the gateway key out of disk-backed config

If your Rider / Junie build exposes custom OpenAI-compatible provider settings, prefer entering the key through a secure UI or secret store rather than a plain-text file.

Optional PowerShell reference:

```powershell
$env:AGENTRAIL_API_KEY="your_agentrail_api_key"
```

### 3. Notes

- AgentRail does not yet claim a stable local write contract for Junie.
- The dashboard intentionally labels Junie as **Guide** so it does not overstate readiness.



