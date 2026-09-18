import { getRecommendedAgentModelId } from './state.js';

export function buildGuide(guideId, state, origin) {
  const entries = state.models
    .filter(model => model.id !== 'agentrail/files')
    .map(model => ({
      id: model.id,
      providers: model.isVirtual
        ? ['agentrail']
        : (model.providers || []).map(provider => provider.name).filter(Boolean),
      isVirtual: model.isVirtual === true,
    }));
  const primaryModel = getRecommendedAgentModelId(entries);
  const openAiBase = `${origin}/v1`;
  const responsesBase = `${origin}/v1/responses`;

  if (guideId === 'opencode') {
    return {
      title: 'OpenCode setup guide',
      env: { OPENAI_BASE_URL: openAiBase, OPENAI_API_KEY: 'AGENTRAIL_API_KEY' },
      settings: [['Endpoint', openAiBase], ['Suggested model', primaryModel]],
      steps: [
        'Point OpenCode to the local OpenAI-compatible AgentRail endpoint.',
        'Use your AgentRail API key as the OpenAI-compatible key at runtime.',
        'Choose agentrail/auto or one of the provider-filtered active models shown above.',
      ],
    };
  }

  if (guideId === 'aider') {
    return {
      title: 'Aider setup guide',
      env: { OPENAI_API_BASE: openAiBase, OPENAI_API_KEY: 'AGENTRAIL_API_KEY' },
      settings: [['Endpoint', openAiBase], ['Suggested model', primaryModel]],
      steps: [
        'Set OPENAI_API_BASE to AgentRail and reuse your AgentRail API key as OPENAI_API_KEY.',
        'Start with agentrail/auto, or pick one active provider-specific model if you need a fixed route.',
      ],
    };
  }

  if (guideId === 'codex-desktop') {
    return {
      title: 'Codex Desktop setup guide',
      env: { AGENTRAIL_API_KEY: 'your AgentRail API key' },
      settings: [['Responses endpoint', responsesBase], ['OpenAI endpoint', openAiBase], ['Suggested model', primaryModel]],
      steps: [
        'In Codex Desktop, use AgentRail as the local provider endpoint and supply your AgentRail API key.',
        'If the desktop flow asks for a Responses-compatible endpoint, use /v1/responses.',
        'Keep model selection on agentrail/auto unless you need a fixed provider-specific route.',
      ],
    };
  }

  if (guideId === 'cursor') {
    return {
      title: 'Cursor setup guide',
      env: { OPENAI_API_KEY: 'AGENTRAIL_API_KEY' },
      settings: [['OpenAI endpoint', openAiBase], ['Suggested model', primaryModel], ['Provider mode', 'OpenAI-compatible / custom endpoint']],
      steps: [
        'Open Cursor settings for custom AI providers and point the OpenAI-compatible endpoint to AgentRail.',
        'Use your AgentRail API key as the OpenAI-compatible key at runtime.',
        'Start with agentrail/auto, or switch to a fixed virtual/provider model only when you need deterministic routing.',
      ],
    };
  }

  if (guideId === 'antigravity') {
    return {
      title: 'Antigravity setup guide',
      env: { AGENTRAIL_API_KEY: 'your AgentRail API key' },
      settings: [['OpenAI endpoint', openAiBase], ['Suggested model', primaryModel], ['Integration mode', 'Guide-only / custom proxy flow']],
      steps: [
        'Use AgentRail as the upstream OpenAI-compatible endpoint only if your Antigravity build supports a custom provider or proxy entry.',
        'Paste your AgentRail API key where the tool expects the upstream provider token or custom endpoint credential.',
        'If your local Antigravity install only supports its native transport, keep this as a manual reference rather than expecting one-click launch from AgentRail.',
      ],
    };
  }

  return {
    title: 'Junie setup guide',
    env: { AGENTRAIL_API_KEY: 'your AgentRail API key' },
    settings: [['OpenAI endpoint', openAiBase], ['Suggested model', primaryModel], ['Provider', 'OpenAI-compatible / custom endpoint']],
    steps: [
      'In JetBrains Rider, open the Junie provider settings and choose the custom OpenAI-compatible option if available.',
      'Set the base URL to the local AgentRail endpoint and paste your AgentRail API key at runtime.',
      'Use agentrail/auto first, then switch to a provider-specific model only if you need deterministic routing.',
    ],
  };
}
