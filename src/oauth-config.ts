export interface OAuthProviderConfig {
  provider: string;
  label: string;
  clientIdEnv: string;
  clientIdDefault: string;
  tokenUrl: string;
  authorizeUrl: string;
  scopes: string[];
  redirectPath: string;
  codeChallengeMethod?: 'S256';
  extraParams?: Record<string, string>;
  /** If true, uses device authorization flow instead of redirect-based PKCE */
  deviceFlow?: boolean;
  /** Client secret for providers that require it (e.g. Google OAuth without PKCE) */
  clientSecretEnv?: string;
  clientSecretDefault?: string;
  /** URL where user enters the device code */
  verificationUri?: string;
  /** Base URL for device auth API endpoints */
  deviceAuthApiBase?: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  claude: {
    provider: 'claude',
    label: 'Claude (Anthropic)',
    clientIdEnv: 'CLAUDE_OAUTH_CLIENT_ID',
    clientIdDefault: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'],
    redirectPath: '/api/oauth/callback/claude',
    codeChallengeMethod: 'S256',
  },
  codex: {
    provider: 'codex',
    label: 'Codex (OpenAI)',
    clientIdEnv: 'CODEX_OAUTH_CLIENT_ID',
    clientIdDefault: 'app_EMoamEEZ73f0CkXaXp7hrann',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    redirectPath: '/api/oauth/callback/codex',
    deviceFlow: true,
    verificationUri: 'https://auth.openai.com/codex/device',
    deviceAuthApiBase: 'https://auth.openai.com/api/accounts',
  },
  gemini: {
    provider: 'gemini',
    label: 'Gemini (Google)',
    clientIdEnv: 'GEMINI_CLI_OAUTH_CLIENT_ID',
    clientIdDefault: '193619065524-9sp3tllct46ktm42o0r6ir0k3tv68pma.apps.googleusercontent.com',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    redirectPath: '/',
    codeChallengeMethod: 'S256',
  },
};

export function getClientId(provider: string): string {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`Unknown OAuth provider: ${provider}`);
  return process.env[config.clientIdEnv] || config.clientIdDefault;
}

export function getClientSecret(provider: string): string | undefined {
  const config = OAUTH_PROVIDERS[provider];
  if (!config || !config.clientSecretEnv) return undefined;
  return process.env[config.clientSecretEnv] || config.clientSecretDefault || undefined;
}