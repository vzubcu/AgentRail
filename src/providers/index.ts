import { BaseProvider, loadBlockedModelState, type ProviderConfig } from './base.js';
import { CohereProvider } from './cohere.js';
import { CloudflareProvider } from './cloudflare.js';
import { NvidiaProvider } from './nvidia.js';
import { getEffectiveCloudflareCredential } from '../config.js';
import { RekaProvider } from './reka.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { GeminiProvider } from './gemini.js';
import { GoogleProvider } from './google.js';
import { isGeminiChatModelId } from '../models/gemini-sync.js';

class GenericProvider extends BaseProvider {}

function p(config: ProviderConfig): BaseProvider {
  return new GenericProvider(config);
}

function nvidia(config: ProviderConfig): BaseProvider {
  return new NvidiaProvider(config);
}

function reka(config: ProviderConfig): BaseProvider {
  return new RekaProvider(config);
}

export const providers: BaseProvider[] = [
  p({
    name: 'kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnvVar: 'KIMI_API_KEY',
    website: 'https://platform.moonshot.cn',
    apiKeyInstructions: [
      'Sign in to Moonshot AI Platform: https://platform.moonshot.cn.',
      'Open the API Keys page in the console: https://platform.moonshot.cn/console/api-keys.',
      'Create a new API key and copy it into AgentRail.',
    ],
    models: [
      { id: 'kimi-k2', providerModelId: 'kimi-k2', context: 262000, maxOutput: 262000, modality: 'Text' },
      { id: 'kimi-k2.5', providerModelId: 'kimi-k2.5', context: 262000, maxOutput: 262000, modality: 'Text' },
      { id: 'kimi-k2.6', providerModelId: 'kimi-k2.6', context: 262000, maxOutput: 262000, modality: 'Text' },
      { id: 'kimi-k3', providerModelId: 'kimi-k3', context: 1000000, maxOutput: 262000, modality: 'Text' },
      { id: 'kimi-latest', providerModelId: 'kimi-latest', context: 262000, maxOutput: 262000, modality: 'Text' },
    ],
  }),
  p({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    website: 'https://openrouter.ai',
    apiKeyInstructions: [
      'Sign in to OpenRouter: https://openrouter.ai.',
      'Open the Keys page from your account dashboard: https://openrouter.ai/keys.',
      'Create a new API key and paste it into AgentRail.',
    ],
    models: [
      { id: 'deepseek-r1', providerModelId: 'deepseek/deepseek-r1-0528:free', context: 163000, maxOutput: 163000, modality: 'Text' },
      { id: 'deepseek-chat', providerModelId: 'deepseek/deepseek-chat-v3-0324:free', context: 163000, maxOutput: 163000, modality: 'Text' },
      { id: 'qwen3.6-plus', providerModelId: 'qwen/qwen3.6-plus:free', context: 1000000, maxOutput: 65000, modality: 'Text' },
      { id: 'llama-4-scout', providerModelId: 'meta-llama/llama-4-scout:free', context: 10000000, maxOutput: 16000, modality: 'Multimodal' },
      { id: 'llama-4-maverick', providerModelId: 'meta-llama/llama-4-maverick:free', context: 1000000, maxOutput: 16000, modality: 'Multimodal' },
      { id: 'llama-3.3-70b', providerModelId: 'meta-llama/llama-3.3-70b-instruct:free', context: 65000, maxOutput: 16000, modality: 'Text' },
      { id: 'gemma-4-31b', providerModelId: 'google/gemma-4-31b-it:free', context: 256000, maxOutput: 8000, modality: 'Multimodal' },
      { id: 'nemotron-3-super', providerModelId: 'nvidia/nemotron-3-super-120b-a12b:free', context: 1000000, maxOutput: 32000, modality: 'Text' },
      { id: 'gpt-oss-120b', providerModelId: 'openai/gpt-oss-120b:free', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'minimax-m2.5', providerModelId: 'minimax/minimax-m2.5:free', context: 196000, maxOutput: 8000, modality: 'Text' },
      { id: 'devstral', providerModelId: 'mistralai/devstral-2512:free', context: 256000, maxOutput: 32000, modality: 'Text' },
    ],
  }),
  p({
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    website: 'https://console.groq.com',
    apiKeyInstructions: [
      'Sign in to the Groq Console: https://console.groq.com.',
      'Open API Keys from the console menu: https://console.groq.com/keys.',
      'Generate a new key and copy it into AgentRail.',
    ],
    models: [
      { id: 'llama-3.3-70b', providerModelId: 'llama-3.3-70b-versatile', context: 131000, maxOutput: 32000, modality: 'Text' },
      { id: 'llama-3.1-8b', providerModelId: 'llama-3.1-8b-instant', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'llama-4-scout', providerModelId: 'llama-4-scout-17b-16e-instruct', context: 131000, maxOutput: 8000, modality: 'Text + Vision' },
      { id: 'llama-4-maverick', providerModelId: 'llama-4-maverick-17b-128e-instruct', context: 131000, maxOutput: 8000, modality: 'Text + Vision' },
      { id: 'qwen3-32b', providerModelId: 'qwen3-32b', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'gpt-oss-120b', providerModelId: 'gpt-oss-120b', context: 131000, maxOutput: 32000, modality: 'Text' },
      { id: 'kimi-k2', providerModelId: 'kimi-k2-instruct', context: 262000, maxOutput: 262000, modality: 'Text' },
      { id: 'deepseek-r1-distill-70b', providerModelId: 'deepseek-r1-distill-70b', context: 131000, maxOutput: 8000, modality: 'Text' },
      { id: 'whisper-large', providerModelId: 'whisper-large-v3', modality: 'Audio → Text' },
      { id: 'whisper-large-turbo', providerModelId: 'whisper-large-v3-turbo', modality: 'Audio → Text' },
    ],
  }),
  p({
    name: 'github',
    baseURL: 'https://models.inference.ai.azure.com',
    apiKeyEnvVar: 'GITHUB_TOKEN',
    website: 'https://github.com/marketplace/models',
    apiKeyInstructions: [
      'Sign in to GitHub: https://github.com.',
      'Open GitHub Models or Personal access tokens settings: https://github.com/marketplace/models and https://github.com/settings/personal-access-tokens.',
      'Create a token with the required access and paste it into AgentRail.',
    ],
    models: [
      { id: 'gpt-4o', providerModelId: 'gpt-4o', context: 128000, maxOutput: 16000, modality: 'Text + Vision' },
      { id: 'gpt-4o-mini', providerModelId: 'gpt-4o-mini', context: 128000, maxOutput: 16000, modality: 'Text + Vision' },
      { id: 'o1', providerModelId: 'o1', context: 200000, maxOutput: 100000, modality: 'Text' },
      { id: 'o1-mini', providerModelId: 'o1-mini', context: 128000, maxOutput: 65000, modality: 'Text' },
      { id: 'o3-mini', providerModelId: 'o3-mini', context: 200000, maxOutput: 100000, modality: 'Text' },
      { id: 'llama-3.3-70b', providerModelId: 'Meta-Llama-3.3-70B-Instruct', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'llama-3.1-405b', providerModelId: 'Meta-Llama-3.1-405B-Instruct', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'deepseek-r1', providerModelId: 'DeepSeek-R1', context: 64000, maxOutput: 8000, modality: 'Text' },
      { id: 'deepseek-v3', providerModelId: 'DeepSeek-V3-0324', context: 64000, maxOutput: 8000, modality: 'Text' },
      { id: 'phi-4', providerModelId: 'Phi-4', context: 16000, maxOutput: 4000, modality: 'Text' },
    ],
  }),
  reka({
    name: 'reka',
    baseURL: 'https://api.reka.ai/v1',
    apiKeyEnvVar: 'REKA_API_KEY',
    website: 'https://docs.reka.ai/chat/overview',
    apiKeyInstructions: [
      'Sign in to the Reka platform or docs portal: https://docs.reka.ai/chat/overview.',
      'Open the API key management page from the dashboard or docs link starting here: https://docs.reka.ai/chat/overview.',
      'Create a new key and copy it into AgentRail.',
    ],
    models: [
      { id: 'reka-flash-3', providerModelId: 'reka-flash-3', context: 128000, maxOutput: 16000, modality: 'Text + Vision' },
      { id: 'reka-core-3', providerModelId: 'reka-core-3', context: 128000, maxOutput: 16000, modality: 'Text' },
    ],
  }),
  new GoogleProvider({
    name: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    website: 'https://aistudio.google.com',
    apiKeyInstructions: [
      'Sign in to Google AI Studio: https://aistudio.google.com.',
      'Open Get API key or the API keys page: https://aistudio.google.com/app/apikey.',
      'Create a Gemini API key and paste it into AgentRail.',
    ],
    models: [
      { id: 'gemini-3.5-flash', providerModelId: 'gemini-3.5-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-3.1-flash-lite', providerModelId: 'gemini-3.1-flash-lite', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-pro', providerModelId: 'gemini-2.5-pro', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-flash', providerModelId: 'gemini-2.5-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-flash-lite', providerModelId: 'gemini-2.5-flash-lite', context: 1048576, modality: 'Text' },
      { id: 'gemini-2.0-flash', providerModelId: 'gemini-2.0-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.0-flash-lite', providerModelId: 'gemini-2.0-flash-lite', context: 1048576, modality: 'Text + Vision' },
    ],
  }),
  new CloudflareProvider({
    name: 'cloudflare',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts',
    apiKeyEnvVar: 'CLOUDFLARE_API_KEY',
    envVars: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
    website: 'https://ai.cloudflare.com',
    apiKeyInstructions: [
      'Sign in to the Cloudflare dashboard: https://dash.cloudflare.com and review Workers AI access at https://ai.cloudflare.com.',
      'Create an API token with Workers AI permissions from the token page: https://dash.cloudflare.com/profile/api-tokens.',
      'Copy both the API token and the target Account ID into AgentRail.',
    ],
    models: [
      { id: 'llama-3.3-70b', providerModelId: '@cf/meta/llama-3.3-70b-instruct-fp8', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'llama-4-scout', providerModelId: '@cf/meta/llama-4-scout-instruct', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'llama-3.1-8b', providerModelId: '@cf/meta/llama-3.1-8b-instruct-fp8', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'qwen3-30b', providerModelId: '@cf/qwen/qwen3-30b-a3b-fp8', context: 32000, maxOutput: 4000, modality: 'Text' },
      { id: 'gemma-3-12b', providerModelId: '@cf/google/gemma-3-12b-instruct', context: 8000, maxOutput: 4000, modality: 'Text' },
      { id: 'mistral-small-3.1', providerModelId: '@cf/mistral/mistral-small-3.1-24b-instruct', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'gpt-oss-120b', providerModelId: '@cf/openai/gpt-oss-120b', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'deepseek-r1-distill-qwen-32b', providerModelId: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', context: 64000, maxOutput: 8000, modality: 'Text' },
    ],
  }),
  p({
    name: 'siliconflow',
    baseURL: 'https://api.siliconflow.com/v1',
    apiKeyEnvVar: 'SILICONFLOW_API_KEY',
    website: 'https://siliconflow.com',
    apiKeyInstructions: [
      'Sign in to SiliconFlow: https://siliconflow.com.',
      'Open API Keys from the account console starting from: https://siliconflow.com.',
      'Create a new key and paste it into AgentRail.',
    ],
    models: [
      { id: 'qwen3-8b', providerModelId: 'Qwen/Qwen3-8B', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'deepseek-r1-qwen3-8b', providerModelId: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B', context: 33000, maxOutput: 16000, modality: 'Text' },
      { id: 'deepseek-r1-distill-qwen-7b', providerModelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', context: 131000, modality: 'Text' },
      { id: 'glm-4-9b', providerModelId: 'THUDM/glm-4-9b-chat', context: 32000, maxOutput: 32000, modality: 'Text' },
      { id: 'glm-4.1v-9b', providerModelId: 'THUDM/GLM-4.1V-9B-Thinking', context: 66000, maxOutput: 66000, modality: 'Vision + Text' },
      { id: 'deepseek-ocr', providerModelId: 'deepseek-ai/DeepSeek-OCR', maxOutput: 8000, modality: 'Vision (OCR)' },
    ],
  }),
  p({
    name: 'cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    website: 'https://cloud.cerebras.ai',
    apiKeyInstructions: [
      'Sign in to Cerebras Cloud: https://cloud.cerebras.ai.',
      'Open the API key section in your account from: https://cloud.cerebras.ai.',
      'Generate a key and copy it into AgentRail.',
    ],
    models: [
      { id: 'llama-3.1-8b', providerModelId: 'llama3.1-8b', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'gpt-oss-120b', providerModelId: 'gpt-oss-120b', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'qwen-3-235b', providerModelId: 'qwen-3-235b-a22b-instruct-2507', context: 131000, maxOutput: 8000, modality: 'Text' },
      { id: 'zai-glm-4.7', providerModelId: 'zai-glm-4.7', context: 128000, maxOutput: 8000, modality: 'Text' },
    ],
  }),
  p({
    name: 'mistral',
    baseURL: 'https://api.mistral.ai/v1',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    website: 'https://console.mistral.ai',
    apiKeyInstructions: [
      'Sign in to the Mistral console: https://console.mistral.ai.',
      'Open API Keys from your workspace settings in: https://console.mistral.ai.',
      'Create a new key and paste it into AgentRail.',
    ],
    models: [
      { id: 'mistral-small-4', providerModelId: 'mistral-small-4', context: 256000, maxOutput: 256000, modality: 'Text + Image + Code' },
      { id: 'mistral-medium-3', providerModelId: 'mistral-medium-3', context: 128000, maxOutput: 128000, modality: 'Text' },
      { id: 'mistral-large-3', providerModelId: 'mistral-large-3', context: 256000, maxOutput: 256000, modality: 'Text' },
      { id: 'mistral-nemo', providerModelId: 'mistral-nemo', context: 128000, maxOutput: 128000, modality: 'Text' },
      { id: 'codestral', providerModelId: 'codestral', context: 256000, maxOutput: 256000, modality: 'Code' },
      { id: 'pixtral-large', providerModelId: 'pixtral-large', context: 128000, maxOutput: 128000, modality: 'Text + Image' },
    ],
  }),
  p({
    name: 'nous-research',
    baseURL: 'https://inference-api.nousresearch.com/v1',
    apiKeyEnvVar: 'NOUS_RESEARCH_API_KEY',
    website: 'https://portal.nousresearch.com/help',
    apiKeyInstructions: [
      'Sign in to the Nous Research portal: https://portal.nousresearch.com/help.',
      'Open the API access or key management page starting from: https://portal.nousresearch.com/help.',
      'Create a key and copy it into AgentRail.',
    ],
    models: [
      { id: 'hermes-4-70b', providerModelId: 'Hermes-4-70B', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'hermes-3-llama-3.1-70b', providerModelId: 'NousResearch/Hermes-3-Llama-3.1-70B', context: 128000, maxOutput: 8000, modality: 'Text' },
    ],
  }),
  p({
    name: 'openadapter',
    baseURL: 'https://api.openadapter.in/v1',
    apiKeyEnvVar: 'OPENADAPTER_API_KEY',
    website: 'https://openadapter.dev',
    apiKeyInstructions: [
      'Sign in to OpenAdapter: https://openadapter.dev.',
      'Open your dashboard API key section from: https://openadapter.dev.',
      'Create a key and paste it into AgentRail.',
    ],
    models: [
      { id: 'deepseek-v3', providerModelId: 'deepseek-v3', context: 64000, maxOutput: 8000, modality: 'Text' },
      { id: 'qwen3-32b', providerModelId: 'qwen3-32b', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'llama-3.3-70b', providerModelId: 'llama-3.3-70b', context: 131000, maxOutput: 16000, modality: 'Text' },
    ],
  }),
  p({
    name: 'tokenrouter',
    baseURL: 'https://api.tokenrouter.com/v1',
    apiKeyEnvVar: 'TOKENROUTER_API_KEY',
    website: 'https://tokenrouter.com',
    apiKeyInstructions: [
      'Sign in to TokenRouter: https://tokenrouter.com.',
      'Open API keys from your account area starting from: https://tokenrouter.com.',
      'Generate a key and paste it into AgentRail.',
    ],
    models: [
      { id: 'deepseek-v4-flash', providerModelId: 'deepseek-v4-flash', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'deepseek-v4-pro', providerModelId: 'deepseek-v4-pro', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'minimax-m1', providerModelId: 'minimax-m1', context: 1000000, maxOutput: 8000, modality: 'Text' },
    ],
  }),
  p({
    name: 'bluesminds',
    baseURL: 'https://api.bluesminds.com/v1',
    apiKeyEnvVar: 'BLUESMINDS_API_KEY',
    website: 'https://www.bluesminds.com',
    apiKeyInstructions: [
      'Sign in to BlueSminds: https://www.bluesminds.com.',
      'Open the developer or API credentials area from: https://www.bluesminds.com.',
      'Create a key and copy it into AgentRail.',
    ],
    models: [
      { id: 'gpt-4o-mini', providerModelId: 'gpt-4o-mini', context: 128000, maxOutput: 16000, modality: 'Text + Vision' },
      { id: 'gemini-2.5-flash', providerModelId: 'gemini-2.5-flash', context: 1000000, maxOutput: 8000, modality: 'Text + Vision' },
      { id: 'deepseek-v3', providerModelId: 'deepseek-v3', context: 64000, maxOutput: 8000, modality: 'Text' },
    ],
  }),
  new CohereProvider({
    name: 'cohere',
    baseURL: 'https://api.cohere.com/v2',
    apiKeyEnvVar: 'COHERE_API_KEY',
    website: 'https://dashboard.cohere.com',
    apiKeyInstructions: [
      'Sign in to the Cohere dashboard: https://dashboard.cohere.com.',
      'Open API Keys from the dashboard navigation in: https://dashboard.cohere.com.',
      'Create a new key and paste it into AgentRail.',
    ],
    models: [
      { id: 'command-a', providerModelId: 'command-a', context: 256000, maxOutput: 4000, modality: 'Text' },
      { id: 'command-r-plus', providerModelId: 'command-r-plus', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'command-r', providerModelId: 'command-r', context: 128000, maxOutput: 4000, modality: 'Text' },
      { id: 'command-r7b', providerModelId: 'command-r7b', context: 128000, maxOutput: 4000, modality: 'Text' },
    ],
  }),
  nvidia({
    name: 'nvidia',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnvVar: 'NVIDIA_API_KEY',
    website: 'https://build.nvidia.com',
    apiKeyInstructions: [
      'Sign in to NVIDIA Build: https://build.nvidia.com.',
      'Open the API keys section for your account from: https://build.nvidia.com.',
      'Create a key and copy it into AgentRail.',
    ],
    models: [
      { id: 'glm-5.1', providerModelId: 'z-ai/glm-5.1', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'minimax-m2.7', providerModelId: 'minimaxai/minimax-m2.7', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'gemma-4-31b', providerModelId: 'google/gemma-4-31b-it', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'mistral-small-4', providerModelId: 'mistralai/mistral-small-4-119b-2603', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'mistral-large-3', providerModelId: 'mistralai/mistral-large-3-675b-instruct-2512', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'devstral-2', providerModelId: 'mistralai/devstral-2-123b-instruct-2512', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'qwen3.5-397b', providerModelId: 'qwen/qwen3.5-397b-a17b', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'qwen3.5-122b', providerModelId: 'qwen/qwen3.5-122b-a10b', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'step-3.5-flash', providerModelId: 'stepfun-ai/step-3.5-flash', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'deepseek-v4-pro', providerModelId: 'deepseek-ai/deepseek-v4-pro', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'gpt-oss-120b', providerModelId: 'openai/gpt-oss-120b', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'gpt-oss-20b', providerModelId: 'openai/gpt-oss-20b', context: 131000, maxOutput: 131000, modality: 'Text' },
      { id: 'nemotron-3-super', providerModelId: 'nvidia/nemotron-3-super-120b-a12b', context: 262000, maxOutput: 262000, modality: 'Text' },
    ],
  }),
  p({
    name: 'llm7',
    baseURL: 'https://api.llm7.io/v1',
    apiKeyEnvVar: 'LLM7_API_KEY',
    website: 'https://llm7.io',
    apiKeyInstructions: [
      'Sign in to LLM7: https://llm7.io.',
      'Open the token or API key page in your account from: https://llm7.io.',
      'Create a key and paste it into AgentRail.',
    ],
    models: [
      { id: 'deepseek-r1', providerModelId: 'deepseek-r1-0528', modality: 'Text' },
      { id: 'deepseek-chat', providerModelId: 'deepseek-v3-0324', modality: 'Text' },
      { id: 'gemini-2.5-flash-lite', providerModelId: 'gemini-2.5-flash-lite', modality: 'Text + Vision' },
      { id: 'gpt-4o-mini', providerModelId: 'gpt-4o-mini', modality: 'Text + Vision' },
      { id: 'mistral-small-3.1', providerModelId: 'mistral-small-3.1-24b', context: 32000, modality: 'Text' },
      { id: 'qwen2.5-coder-32b', providerModelId: 'qwen2.5-coder-32b', modality: 'Text' },
    ],
  }),
  p({
    name: 'kilo',
    baseURL: 'https://api.kilo.ai/api/gateway',
    apiKeyEnvVar: 'KILO_API_KEY',
    website: 'https://kilo.ai',
    apiKeyInstructions: [
      'Sign in to Kilo AI: https://kilo.ai.',
      'Open account settings or developer credentials from: https://kilo.ai.',
      'Generate an API key and copy it into AgentRail.',
    ],
    models: [
      { id: 'kilo-auto-free', providerModelId: 'kilo-auto/free', modality: 'Text' },
      { id: 'dola-seed-2-pro', providerModelId: 'bytedance-seed/dola-seed-2.0-pro:free', modality: 'Text' },
      { id: 'grok-code-fast', providerModelId: 'x-ai/grok-code-fast-1:optimized:free', modality: 'Text' },
      { id: 'nemotron-3-super', providerModelId: 'nvidia/nemotron-3-super-120b-a12b:free', modality: 'Text' },
      { id: 'trinity-large-thinking', providerModelId: 'arcee-ai/trinity-large-thinking:free', modality: 'Text' },
    ],
  }),
  p({
    name: 'zhipu',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnvVar: 'ZHIPU_API_KEY',
    website: 'https://open.bigmodel.cn',
    apiKeyInstructions: [
      'Sign in to Zhipu BigModel: https://open.bigmodel.cn.',
      'Open the API key management page from: https://open.bigmodel.cn.',
      'Create a new key and paste it into AgentRail.',
    ],
    models: [
      { id: 'glm-4.7-flash', providerModelId: 'glm-4.7-flash', context: 200000, maxOutput: 128000, modality: 'Text' },
      { id: 'glm-4.5-flash', providerModelId: 'glm-4.5-flash', context: 128000, maxOutput: 8000, modality: 'Text' },
      { id: 'glm-4.6v-flash', providerModelId: 'glm-4.6v-flash', context: 128000, maxOutput: 4000, modality: 'Text + Image' },
    ],
  }),
  p({
    name: 'opencode',
    baseURL: 'https://opencode.ai/zen/v1',
    apiKeyEnvVar: 'OPENCODE_API_KEY',
    website: 'https://opencode.ai',
    apiKeyInstructions: [
      'Sign in to OpenCode: https://opencode.ai.',
      'Open your API credentials page from: https://opencode.ai.',
      'Create a key and copy it into AgentRail.',
    ],
    models: [
      { id: 'minimax-m2.5-free', providerModelId: 'minimax-m2.5-free', modality: 'Text' },
      { id: 'ling-2.6-flash-free', providerModelId: 'ling-2.6-flash-free', modality: 'Text' },
      { id: 'trinity-large-preview-free', providerModelId: 'trinity-large-preview-free', modality: 'Text' },
      { id: 'nemotron-3-super-free', providerModelId: 'nemotron-3-super-free', modality: 'Text' },
    ],
  }),
  p({
    name: 'zenmux',
    baseURL: 'https://zenmux.ai/api/v1',
    apiKeyEnvVar: 'ZENMUX_API_KEY',
    website: 'https://zenmux.ai',
    apiKeyInstructions: [
      'Sign in to ZenMux: https://zenmux.ai.',
      'Open the API keys page from your dashboard: https://zenmux.ai.',
      'Generate a key and paste it into AgentRail.',
    ],
    models: [
      { id: 'deepseek-v4-flash-free', providerModelId: 'deepseek/deepseek-v4-flash-free', context: 1000000, modality: 'Text' },
      { id: 'deepseek-v4-pro-free', providerModelId: 'deepseek/deepseek-v4-pro-free', context: 1000000, modality: 'Text' },
      { id: 'glm-4.7-flash-free', providerModelId: 'z-ai/glm-4.7-flash-free', context: 200000, modality: 'Text' },
      { id: 'glm-4.6v-flash-free', providerModelId: 'z-ai/glm-4.6v-flash-free', context: 200000, modality: 'Text + Image' },
    ],
  }),
  new ClaudeProvider({
    name: 'claude',
    baseURL: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    website: 'https://claude.ai',
    envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_OAUTH_CLIENT_ID'],
    apiKeyInstructions: [
      'Sign in to the Anthropic Console: https://console.anthropic.com.',
      'Open API Keys from your account settings: https://console.anthropic.com/settings/keys.',
      'Create a new key and paste it into AgentRail, or use OAuth if preferred.',
    ],
    models: [
      { id: 'claude-fable-5', providerModelId: 'claude-fable-5', context: 1000000, maxOutput: 128000, modality: 'Text' },
      { id: 'claude-opus-4-8', providerModelId: 'claude-opus-4-8', context: 1000000, maxOutput: 128000, modality: 'Text' },
      { id: 'claude-opus-4-7', providerModelId: 'claude-opus-4-7', context: 1000000, maxOutput: 128000, modality: 'Text' },
      { id: 'claude-opus-4-6', providerModelId: 'claude-opus-4-6', context: 1000000, maxOutput: 128000, modality: 'Text' },
      { id: 'claude-sonnet-4-6', providerModelId: 'claude-sonnet-4-6', context: 200000, maxOutput: 64000, modality: 'Text' },
      { id: 'claude-sonnet-4-5', providerModelId: 'claude-sonnet-4-5', context: 200000, maxOutput: 64000, modality: 'Text' },
      { id: 'claude-haiku-4-5', providerModelId: 'claude-haiku-4-5', context: 200000, maxOutput: 64000, modality: 'Text' },
    ],
  }),
  new CodexProvider({
    name: 'codex',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    apiKeyEnvVar: 'CODEX_API_KEY',
    website: 'https://codex.ai',
    envVars: ['CODEX_API_KEY', 'CODEX_OAUTH_CLIENT_ID', 'CODEX_MODEL_CANDIDATES'],
    apiKeyInstructions: [
      'Sign in to Codex: https://codex.ai.',
      'Open developer settings or API access from: https://codex.ai.',
      'Create an API key and paste it into AgentRail, or use OAuth if available.',
      'Optionally set CODEX_MODEL_CANDIDATES to a comma- or newline-separated candidate list to probe models not present in the default catalog.',
    ],
    models: [
      { id: '5.4', providerModelId: '5.4', context: 200000, maxOutput: 100000, modality: 'Text' },
      { id: '5.5', providerModelId: '5.5', context: 200000, maxOutput: 100000, modality: 'Text' },
    ],
  }),
  new GeminiProvider({
    name: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    website: 'https://aistudio.google.com',
    envVars: ['GEMINI_API_KEY', 'GEMINI_CLI_OAUTH_CLIENT_ID'],
    apiKeyInstructions: [
      'Sign in to Google AI Studio: https://aistudio.google.com.',
      'Open Get API key or visit the API key manager: https://aistudio.google.com/app/apikey.',
      'Create a Gemini API key and paste it into AgentRail, or use OAuth if preferred.',
    ],
    models: [
      { id: 'gemini-3.5-flash', providerModelId: 'gemini-3.5-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-pro', providerModelId: 'gemini-2.5-pro', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-flash', providerModelId: 'gemini-2.5-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.5-flash-lite', providerModelId: 'gemini-2.5-flash-lite', context: 1048576, modality: 'Text' },
      { id: 'gemini-2.0-flash', providerModelId: 'gemini-2.0-flash', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-2.0-flash-lite', providerModelId: 'gemini-2.0-flash-lite', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-3-flash-preview', providerModelId: 'gemini-3-flash-preview', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-3.1-pro-preview', providerModelId: 'gemini-3.1-pro-preview', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-1.5-pro', providerModelId: 'gemini-1.5-pro', context: 1048576, modality: 'Text + Vision' },
      { id: 'gemini-1.5-flash', providerModelId: 'gemini-1.5-flash', context: 1048576, modality: 'Text + Vision' },
    ],
  }),
];

export function getProviderByName(providerName: string): BaseProvider | undefined {
  return providers.find((provider) => provider.name === providerName);
}

export function getAvailableProviders(): BaseProvider[] {
  return providers.filter(p => p.isAvailable);
}

export function findProvidersForModel(modelId: string): BaseProvider[] {
  const available = getAvailableProviders();

  // Explicit provider prefix: "provider/model"
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) {
    const prefix = modelId.slice(0, slashIdx);
    const bareModel = modelId.slice(slashIdx + 1);
    const provider = available.find(p => p.name === prefix);
    if (provider && provider.supportsModel(bareModel)) {
      return [provider];
    }
    return [];
  }

  return available.filter(p => p.supportsModel(modelId));
}

export function listAllModels(): { id: string; provider: string }[] {
  const result: { id: string; provider: string }[] = [];
  for (const p of getAvailableProviders()) {
    for (const m of p.listModels()) {
      result.push({ id: `${p.name}/${m.id}`, provider: p.name });
    }
  }
  return result;
}

/* ── Dynamic model sync for all providers ── */

import { fetchOpenRouterModels, loadOpenRouterCache, saveOpenRouterCache } from '../models/openrouter-sync.js';
import { loadProviderModelCache, saveProviderModelCache } from '../models/sync.js';
import { fetchCohereModels, mergeCohereWithAllowlist } from '../models/cohere-sync.js';
import { fetchGitHubModels, loadGitHubCache, mergeGitHubWithAllowlist, saveGitHubCache } from '../models/github-sync.js';
import { fetchCloudflareModels, loadCloudflareCache, mergeCloudflareWithAllowlist, saveCloudflareCache } from '../models/cloudflare-sync.js';
import { fetchNvidiaFreeChatModels } from '../models/nvidia-sync.js';
import { fetchOpenCodeModels, loadOpenCodeCache, saveOpenCodeCache } from '../models/opencode-sync.js';
import { fetchZenMuxModels, mergeZenMuxWithAllowlist } from '../models/zenmux-sync.js';
import { applyCodexVerifiedCatalog, getCodexValidationStatus, loadCodexVerifiedCatalogState, verifyCodexCatalog } from './codex-verified-catalog.js';

const syncMeta = new Map<string, { updatedAt: number; source: string; validation?: unknown }>();

type ProviderSyncStatus = 'refreshed' | 'skipped';

function filterProviderModelsForRuntime(provider: BaseProvider, models: ProviderConfig['models']): ProviderConfig['models'] {
  const unblocked = models.filter((model) => !provider.blockedModelIds.has(model.id));
  if (provider.name === 'google' || provider.name === 'gemini') {
    return unblocked.filter((model) => isGeminiChatModelId(model.providerModelId));
  }
  return unblocked;
}
export interface RefreshAllProviderModelsResult {
  refreshed: string[];
  failed: string[];
  skipped: string[];
}

export interface RefreshConfiguredProvidersResult {
  refreshed: string[];
  failed: string[];
  skipped: string[];
}

export function getProviderSyncMeta(providerName: string): { updatedAt: number; source: string; validation?: unknown } | undefined {
  return syncMeta.get(providerName);
}

export function getAllSyncMetas(): Map<string, { updatedAt: number; source: string; validation?: unknown }> {
  return new Map(syncMeta);
}

async function syncProviderModels(provider: BaseProvider): Promise<ProviderSyncStatus> {
  if (provider.name === 'codex') {
    const headers = await provider.getModelSyncAuthHeaders();
    if (!headers) return 'skipped';

    let candidates: ProviderConfig['models'] | null = null;
    try {
      candidates = await provider.syncModelsForCatalog();
    } catch (err) {
      console.warn(`[${provider.name}] Candidate sync failed before verification:`, err instanceof Error ? err.message : String(err));
    }

    await verifyCodexCatalog(provider, { candidates });
    syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'verified-api', validation: getCodexValidationStatus() });
    await saveProviderModelCache(provider.name, provider.models);
    console.log(`[${provider.name}] Verified ${provider.models.length} models`);
    return 'refreshed';
  }

  if (provider.name === 'openrouter') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const models = await fetchOpenRouterModels(apiKey);
      provider.updateModels(models);
      syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
      await saveOpenRouterCache(models);
      console.log(`[${provider.name}] Synced ${models.length} free models`);
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadOpenRouterCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${cached.models.length} models`);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'cohere') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const fetched = await fetchCohereModels(apiKey);
      const merged = mergeCohereWithAllowlist(fetched, provider.originalModels);
      if (merged.length > 0) {
        provider.updateModels(merged);
        syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
        await saveProviderModelCache(provider.name, merged);
        console.log(`[${provider.name}] Synced ${merged.length} models`);
      } else {
        console.warn(`[${provider.name}] API returned no matching models from allowlist`);
      }
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadProviderModelCache(provider.name);
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${cached.models.length} models`);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'github') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const fetched = await fetchGitHubModels(apiKey);
      const merged = mergeGitHubWithAllowlist(fetched, provider.originalModels);
      if (merged.length > 0) {
        provider.updateModels(merged);
        syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
        await saveGitHubCache(merged);
        console.log(`[${provider.name}] Synced ${merged.length} models`);
      } else {
        console.warn(`[${provider.name}] API returned no matching models from allowlist`);
      }
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadGitHubCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${cached.models.length} models`);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'cloudflare') {
    const credential = getEffectiveCloudflareCredential();
    if (!credential?.apiKey || !credential.accountId) {
      console.warn(`[${provider.name}] Missing Cloudflare credential set`);
      return 'skipped';
    }
    try {
      const fetched = await fetchCloudflareModels(credential.apiKey, credential.accountId);
      const merged = mergeCloudflareWithAllowlist(fetched, provider.originalModels);
      if (merged.length > 0) {
        provider.updateModels(merged);
        syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
        await saveCloudflareCache(merged);
        console.log(`[${provider.name}] Synced ${merged.length} models`);
      } else {
        console.warn(`[${provider.name}] API returned no matching models from allowlist`);
      }
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadCloudflareCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${cached.models.length} models`);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'opencode') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const fetched = await fetchOpenCodeModels();
      const filtered = filterProviderModelsForRuntime(provider, fetched);
      provider.updateModels(filtered);
      syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
      await saveOpenCodeCache(filtered);
      console.log(`[${provider.name}] Synced ${filtered.length} free models`);
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadOpenCodeCache();
      if (cached) {
        const filtered = filterProviderModelsForRuntime(provider, cached.models);
        provider.updateModels(filtered);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${filtered.length} models`);
      } else {
        provider.updateModels([]);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'zenmux') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const fetched = await fetchZenMuxModels(apiKey);
      const merged = mergeZenMuxWithAllowlist(fetched, provider.originalModels);
      if (merged.length > 0) {
        provider.updateModels(merged);
        syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
        await saveProviderModelCache(provider.name, merged);
        console.log(`[${provider.name}] Synced ${merged.length} free models`);
      } else {
        console.warn(`[${provider.name}] API returned no free models from allowlist`);
      }
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadProviderModelCache(provider.name);
      if (cached) {
        provider.updateModels(filterProviderModelsForRuntime(provider, cached.models));
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${cached.models.length} models`);
      }
    }
    return 'refreshed';
  }

  if (provider.name === 'nvidia') {
    const apiKey = provider.apiKey;
    if (!apiKey) return 'skipped';
    try {
      const fetched = await fetchNvidiaFreeChatModels(apiKey, provider.originalModels);
      const filtered = filterProviderModelsForRuntime(provider, fetched);
      if (filtered.length > 0) {
        provider.updateModels(filtered);
        syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
        await saveProviderModelCache(provider.name, filtered);
        console.log(`[${provider.name}] Synced ${filtered.length} free chat models`);
      } else {
        console.warn(`[${provider.name}] API returned no free chat models`);
      }
    } catch (err) {
      console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
      const cached = await loadProviderModelCache(provider.name);
      if (cached) {
        const filtered = filterProviderModelsForRuntime(provider, cached.models);
        provider.updateModels(filtered);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
        console.log(`[${provider.name}] Fell back to cached ${filtered.length} free chat models`);
      }
    }
    return 'refreshed';
  }

  try {
    const merged = await provider.syncModelsForCatalog();
    if (!merged) return 'skipped';

    const filtered = filterProviderModelsForRuntime(provider, merged);
    if (filtered.length > 0) {
      provider.updateModels(filtered);
      syncMeta.set(provider.name, { updatedAt: Date.now(), source: 'api' });
      await saveProviderModelCache(provider.name, filtered);
      console.log(`[${provider.name}] Synced ${filtered.length} models`);
    } else {
      console.warn(`[${provider.name}] API returned no matching models from allowlist`);
    }
  } catch (err) {
    console.warn(`[${provider.name}] API sync failed:`, err instanceof Error ? err.message : String(err));
    const cached = await loadProviderModelCache(provider.name);
    if (cached) {
      const filtered = filterProviderModelsForRuntime(provider, cached.models);
      provider.updateModels(filtered);
      syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      console.log(`[${provider.name}] Fell back to cached ${filtered.length} models`);
    }
  }
  return 'refreshed';
}

export async function loadAllModelCaches(): Promise<void> {
  for (const provider of providers) {
    if (provider.name === 'codex') {
      const verifiedState = await loadCodexVerifiedCatalogState();
      applyCodexVerifiedCatalog(provider, verifiedState);
      syncMeta.set(provider.name, { updatedAt: verifiedState.savedAt, source: 'verified-cache', validation: getCodexValidationStatus() });
      continue;
    }

    if (provider.name === 'openrouter') {
      const cached = await loadOpenRouterCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    if (provider.name === 'github') {
      const cached = await loadGitHubCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    if (provider.name === 'cloudflare') {
      const cached = await loadCloudflareCache();
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    if (provider.name === 'opencode') {
      const cached = await loadOpenCodeCache();
      if (cached) {
        provider.updateModels(filterProviderModelsForRuntime(provider, cached.models));
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    if (provider.name === 'zenmux') {
      const cached = await loadProviderModelCache(provider.name);
      if (cached) {
        provider.updateModels(cached.models);
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    if (provider.name === 'nvidia') {
      const cached = await loadProviderModelCache(provider.name);
      if (cached) {
        provider.updateModels(filterProviderModelsForRuntime(provider, cached.models));
        syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
      }
      continue;
    }
    const cached = await loadProviderModelCache(provider.name);
    if (cached) {
      provider.updateModels(filterProviderModelsForRuntime(provider, cached.models));
      syncMeta.set(provider.name, { updatedAt: cached.updatedAt, source: 'cache' });
    }
  }

  // Load persisted blocked model IDs for every provider
  await Promise.all(providers.map(async (provider) => {
    const blockedState = await loadBlockedModelState(provider.name);
    provider.blockedModelIds = blockedState.ids;
    provider.timeoutModelStreaks = blockedState.timeoutStreaks;
    if (provider.usesVerifiedModelCatalog) {
      const verifiedState = provider.name === 'codex' ? await loadCodexVerifiedCatalogState() : null;
      if (verifiedState) {
        applyCodexVerifiedCatalog(provider, verifiedState);
        syncMeta.set(provider.name, { updatedAt: verifiedState.savedAt, source: 'verified-cache', validation: getCodexValidationStatus() });
      } else {
        provider.updateModels([]);
      }
    } else {
      provider.updateModels(filterProviderModelsForRuntime(provider, provider.models));
      provider.recoverEmptyCatalogFromOriginalModels();
    }
  }));
}

export async function refreshProviderModels(providerName: string): Promise<ProviderSyncStatus> {
  const provider = getProviderByName(providerName);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  return syncProviderModels(provider);
}

export async function refreshConfiguredProviders(): Promise<RefreshConfiguredProvidersResult> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const provider of providers) {
    if (!provider.isAvailable) {
      skipped.push(provider.name);
      continue;
    }

    try {
      const status = await syncProviderModels(provider);
      if (status === 'skipped') {
        skipped.push(provider.name);
      } else {
        refreshed.push(provider.name);
      }
    } catch {
      failed.push(provider.name);
    }
  }

  return { refreshed, failed, skipped };
}

export async function refreshAllProviderModels(): Promise<RefreshAllProviderModelsResult> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const provider of providers) {
    try {
      const status = await syncProviderModels(provider);
      if (status === 'skipped') {
        skipped.push(provider.name);
      } else {
        refreshed.push(provider.name);
      }
    } catch {
      failed.push(provider.name);
    }
  }

  return { refreshed, failed, skipped };
}







