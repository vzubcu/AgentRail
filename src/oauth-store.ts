import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export interface OAuthTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  provider: string;
}

interface OAuthStoreData {
  tokens: Record<string, OAuthTokenData>;
}

const STORE_PATH = path.resolve(process.cwd(), '.agentrail', 'oauth.json');

let cachedStore: OAuthStoreData | null = null;

async function loadStore(): Promise<OAuthStoreData> {
  if (cachedStore) return cachedStore;
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    cachedStore = JSON.parse(raw) as OAuthStoreData;
    if (!cachedStore.tokens) cachedStore.tokens = {};
    return cachedStore!;
  } catch {
    cachedStore = { tokens: {} };
    return cachedStore;
  }
}

async function saveStore(): Promise<void> {
  if (!cachedStore) return;
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(cachedStore, null, 2));
}

export async function getOAuthToken(provider: string): Promise<OAuthTokenData | undefined> {
  const store = await loadStore();
  return store.tokens[provider];
}

export async function setOAuthToken(provider: string, token: OAuthTokenData): Promise<void> {
  const store = await loadStore();
  store.tokens[provider] = token;
  await saveStore();
}

export async function clearOAuthToken(provider: string): Promise<void> {
  const store = await loadStore();
  delete store.tokens[provider];
  await saveStore();
}

export function isTokenExpired(token: OAuthTokenData): boolean {
  return Date.now() >= token.expiresAt;
}

export async function getValidOAuthToken(provider: string): Promise<string | undefined> {
  const token = await getOAuthToken(provider);
  if (!token) return undefined;
  if (isTokenExpired(token) && token.refreshToken) {
    const refreshed = await refreshOAuthToken(provider, token);
    return refreshed?.accessToken;
  }
  if (isTokenExpired(token)) return undefined;
  return token.accessToken;
}

export async function refreshOAuthToken(
  provider: string,
  token: OAuthTokenData,
): Promise<OAuthTokenData | undefined> {
  if (!token.refreshToken) return undefined;

  const clientId = getClientIdForRefresh(provider);
  const configs: Record<string, { tokenUrl: string; clientIdEnv: string; clientIdDefault: string }> = {
    claude: {
      tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
      clientIdEnv: 'CLAUDE_OAUTH_CLIENT_ID',
      clientIdDefault: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    },
    codex: {
      tokenUrl: 'https://auth.openai.com/oauth/token',
      clientIdEnv: 'CODEX_OAUTH_CLIENT_ID',
      clientIdDefault: 'app_EMoamEEZ73f0CkXaXp7hrann',
    },
  };

  const config = configs[provider];
  if (!config) return undefined;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: clientId,
    });

    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      console.warn(`[oauth] Token refresh failed for ${provider}: HTTP ${resp.status}`);
      return undefined;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const newToken: OAuthTokenData = {
      accessToken: String(data.access_token || ''),
      refreshToken: String(data.refresh_token || token.refreshToken),
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
      provider,
    };
    await setOAuthToken(provider, newToken);
    return newToken;
  } catch (err) {
    console.warn(`[oauth] Token refresh failed for ${provider}:`, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

function getClientIdForRefresh(provider: string): string {
  const configs: Record<string, { clientIdEnv: string; clientIdDefault: string }> = {
    claude: { clientIdEnv: 'CLAUDE_OAUTH_CLIENT_ID', clientIdDefault: '9d1c250a-e61b-44d9-88ed-5944d1962f5e' },
    codex: { clientIdEnv: 'CODEX_OAUTH_CLIENT_ID', clientIdDefault: 'app_EMoamEEZ73f0CkXaXp7hrann' },
  };
  const config = configs[provider];
  if (!config) return '';
  return process.env[config.clientIdEnv] || config.clientIdDefault;
}
