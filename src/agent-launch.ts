import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AgentLaunchTarget = 'claude' | 'codex';

export interface LaunchAgentOptions {
  target: AgentLaunchTarget;
  baseUrl: string;
  gatewayKey?: string;
  profileName?: string;
  modelId?: string;
}

export interface LaunchAgentResult {
  ok: boolean;
  target: AgentLaunchTarget;
  launched: boolean;
  profileName: string | null;
  env: Record<string, string>;
  commandPreview: string;
  warnings: string[];
  errors: string[];
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeRootBaseUrl(baseUrl: string): string {
  return stripTrailingSlash(baseUrl).replace(/\/v1$/, '');
}

function ensureOpenAiBaseUrl(baseUrl: string): string {
  return `${normalizeRootBaseUrl(baseUrl)}/v1`;
}

function escapePowerShellSingleQuoted(value: string): string {
  return String(value).replaceAll("'", "''");
}

function buildPowerShellEnvAssignments(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `$env:${key}='${escapePowerShellSingleQuoted(value)}'`)
    .join('; ');
}

function buildClaudeLaunchEnv(baseUrl: string, gatewayKey: string, profileName?: string, modelId?: string): Record<string, string> {
  const rootPath = path.join(os.homedir(), '.claude', 'profiles');
  const env: Record<string, string> = {
    CLAUDE_CONFIG_DIR: profileName ? path.join(rootPath, profileName) : rootPath,
    ANTHROPIC_AUTH_TOKEN: gatewayKey,
    ANTHROPIC_BASE_URL: normalizeRootBaseUrl(baseUrl),
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
  };
  if (modelId) {
    env.ANTHROPIC_MODEL = modelId;
  }
  return env;
}

function buildCodexLaunchEnv(gatewayKey: string): Record<string, string> {
  return {
    AGENTRAIL_API_KEY: gatewayKey,
  };
}

function buildCommandPreview(target: AgentLaunchTarget, profileName: string | undefined, modelId: string | undefined): string {
  if (target === 'claude') {
    return modelId ? `claude # model=${modelId}` : 'claude';
  }
  if (profileName) return `codex --profile ${profileName}`;
  return modelId ? `codex # model=${modelId}` : 'codex';
}

function buildCodexInlineArgs(baseUrl: string, modelId?: string): string[] {
  const args = [
    '-c', 'model_provider="agentrail"',
    '-c', 'model_providers.agentrail.name="AgentRail"',
    '-c', `model_providers.agentrail.base_url=${JSON.stringify(ensureOpenAiBaseUrl(baseUrl))}`,
    '-c', 'model_providers.agentrail.env_key="AGENTRAIL_API_KEY"',
    '-c', 'model_providers.agentrail.wire_api="responses"',
    '-c', 'model_providers.agentrail.requires_openai_auth=false',
  ];
  if (modelId) {
    args.push('-c', `model=${JSON.stringify(modelId)}`);
  }
  return args;
}

export function buildAgentLaunchPlan(options: LaunchAgentOptions): LaunchAgentResult {
  const gatewayKey = options.gatewayKey?.trim() || 'agentrail-no-auth';
  const profileName = options.profileName?.trim() || null;
  const env = options.target === 'claude'
    ? buildClaudeLaunchEnv(options.baseUrl, gatewayKey, profileName ?? undefined, options.modelId)
    : buildCodexLaunchEnv(gatewayKey);

  return {
    ok: true,
    target: options.target,
    launched: false,
    profileName,
    env,
    commandPreview: buildCommandPreview(options.target, profileName ?? undefined, options.modelId),
    warnings: [],
    errors: [],
  };
}

export interface ResolveExecutableOptions {
  platform?: NodeJS.Platform;
  pathValue?: string;
  spawnSyncImpl?: typeof spawnSync;
  existsSyncImpl?: typeof existsSync;
}

function splitPathEntries(pathValue: string): string[] {
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildWindowsExecutableCandidates(binary: string, directory: string): string[] {
  const trimmed = binary.trim();
  const hasExtension = /\.[a-z0-9]+$/i.test(trimmed);
  const names = hasExtension ? [trimmed] : [trimmed, `${trimmed}.exe`, `${trimmed}.cmd`, `${trimmed}.bat`];
  return names.map((name) => path.join(directory, name));
}

function resolveFromPathFallback(binary: string, platform: NodeJS.Platform, pathValue: string, existsSyncImpl: typeof existsSync): string | null {
  const entries = splitPathEntries(pathValue);
  if (platform === 'win32') {
    for (const entry of entries) {
      for (const candidate of buildWindowsExecutableCandidates(binary, entry)) {
        if (existsSyncImpl(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  for (const entry of entries) {
    const candidate = path.join(entry, binary);
    if (existsSyncImpl(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveExecutable(binary: string, options: ResolveExecutableOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const pathValue = options.pathValue ?? process.env.PATH ?? '';
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;

  if (platform === 'win32') {
    try {
      const result = spawnSyncImpl('where.exe', [binary], { encoding: 'utf8' } as Parameters<typeof spawnSync>[2]);
      if (result.status === 0) {
        const first = String(result.stdout ?? '').split(/\r?\n/).find((line) => line.trim().length > 0);
        if (first?.trim()) {
          return first.trim();
        }
      }
    } catch {
      // Fall back to PATH scanning below.
    }
    return resolveFromPathFallback(binary, platform, pathValue, existsSyncImpl);
  }

  try {
    const result = spawnSyncImpl('which', [binary], { encoding: 'utf8' } as Parameters<typeof spawnSync>[2]);
    if (result.status === 0) {
      const first = String(result.stdout ?? '').split(/\r?\n/).find((line) => line.trim().length > 0);
      if (first?.trim()) {
        return first.trim();
      }
    }
  } catch {
    // Fall back to PATH scanning below.
  }
  return resolveFromPathFallback(binary, platform, pathValue, existsSyncImpl);
}

export async function launchAgentTool(options: LaunchAgentOptions): Promise<LaunchAgentResult> {
  const plan = buildAgentLaunchPlan(options);
  const binary = options.target === 'claude' ? 'claude' : 'codex';
  const executable = resolveExecutable(binary);

  if (!executable) {
    return {
      ...plan,
      ok: false,
      errors: [`${binary} was not found in PATH on this machine.`],
    };
  }

  const args = options.target === 'codex'
    ? (plan.profileName ? ['--profile', plan.profileName] : buildCodexInlineArgs(options.baseUrl, options.modelId))
    : [];

  if (process.platform === 'win32') {
    const command = `${buildPowerShellEnvAssignments(plan.env)}; & '${escapePowerShellSingleQuoted(executable)}'${args.length ? ` ${args.map((value) => `'${escapePowerShellSingleQuoted(value)}'`).join(' ')}` : ''}`;
    const child = spawn('powershell.exe', ['-NoExit', '-Command', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    return {
      ...plan,
      launched: true,
    };
  }

  const child = spawn(executable, args, {
    env: {
      ...process.env,
      ...plan.env,
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return {
    ...plan,
    launched: true,
    warnings: [
      'Dashboard launch opens the tool detached from AgentRail. Use the copied env snippet if you need a custom shell session.',
    ],
  };
}
