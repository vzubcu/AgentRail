# Aider Integration Guide for AgentRail

> AgentRail exposes an OpenAI-compatible local endpoint at `http://localhost:42424/v1`, so Aider works using standard OpenAI-compatible configuration.
> Depending on your setup, Aider may use `OPENAI_API_BASE` / `--openai-api-base`, while some other OpenAI-compatible tools may instead reference `OPENAI_BASE_URL`.


## 📋 Quick Start

```bash
# 1. Install Aider
pip install aider-chat

# 2. Set your base URL
export OPENAI_API_BASE="http://localhost:42424/v1"

# 3. Run Aider
aider --openai-api-base http://localhost:42424/v1 --openai-api-key <your_AGENTRAIL_API_KEY> --model llama-3.3-70b
```

Under 2 minutes. Done.

---

## Why Use Aider with AgentRail?

- **Unified local endpoint** - Single interface for multiple providers
- **Provider routing** - Smart request distribution
- **Fallbacks** - Automatic provider switching on failure

---

## Common Endpoint

```bash
http://localhost:42424/v1
```

## Prerequisites

- AgentRail installed and running locally
- Python installed
- Aider installed

```bash
pip install aider-chat
```

## Step 1: API Key Configuration

If `AGENTRAIL_API_KEY` authentication is enabled, use your configured key. If authentication is disabled, any non-empty placeholder value is typically sufficient.

```bash
export OPENAI_API_KEY="<your_AGENTRAIL_API_KEY>"
```

## Step 2: Connect Aider to AgentRail

### Method 1: Command Line (Recommended)

```bash
aider --openai-api-base http://localhost:42424/v1 \
      --openai-api-key <your_AGENTRAIL_API_KEY> \
      --model llama-3.3-70b
```

### Method 2: Environment Variables

**Linux / macOS**

```bash
export OPENAI_API_BASE="http://localhost:42424/v1"
export OPENAI_API_KEY="<your_AGENTRAIL_API_KEY>"
export AIDER_MODEL="llama-3.3-70b"

aider
```

**Windows (Command Prompt)**

```cmd
set OPENAI_API_BASE=http://localhost:42424/v1
set OPENAI_API_KEY=<your_AGENTRAIL_API_KEY>
set AIDER_MODEL=llama-3.3-70b

aider
```

**Windows (PowerShell)**

```powershell
$env:OPENAI_API_BASE="http://localhost:42424/v1"
$env:OPENAI_API_KEY="<your_AGENTRAIL_API_KEY>"
$env:AIDER_MODEL="llama-3.3-70b"

aider
```

## Step 3: Model Selection

> Note: The model IDs below are examples only. Use the model IDs returned by your local AgentRail `/v1/models` endpoint or shown in the AgentRail console for the most accurate list.

Use any AgentRail-supported model ID with the `--model` flag:

```bash
# Groq models
--model groq/llama-3.3-70b
--model groq/llama-3.1-8b

# AgentRail-supported models
--model llama-3.3-70b
--model llama-3.2-3b
--model mistral-7b
```

## Step 4: Verification

```bash
curl http://localhost:42424/v1/models
```

**Expected output:** A JSON list of available models from your local AgentRail instance.

## Step 5: Test with a Real File

```bash
echo "print('Hello from Aider + AgentRail')" > test.py

aider --openai-api-base http://localhost:42424/v1 \
      --openai-api-key <your_AGENTRAIL_API_KEY> \
      --model llama-3.3-70b \
      test.py
```

## ✅ Verification Checklist

- [ ] Aider runs without connection errors
- [ ] Aider shows the loaded file
- [ ] Aider responds to your requests

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| Connection refused | Ensure AgentRail is running on port 42424 |
| Invalid API key | Check your AgentRail config |
| Model not found | Use AgentRail-supported model ID |
| Aider: command not found | `pip install aider-chat` |

## 📚 Next Steps

- Try different AgentRail-supported models
- Configure routing and fallbacks in AgentRail

## 🆘 Support

- **AgentRail Issues:** AgentRail documentation
- **Aider Issues:** Aider official documentation
