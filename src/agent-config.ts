import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as yaml from 'js-yaml';

export interface AgentModelEntry {
  id: string;
}

export interface AgentProfileRecord {
  modelId: string;
  profileName: string;
  path: string;
}

export interface AgentConfigFileRecord {
  kind: string;
  path: string;
}

export interface AgentPrimarySelection {
  type: 'profile' | 'model';
  name: string;
  modelId: string;
  path?: string;
}

export type AgentSetupTarget = 'claude' | 'codex' | 'continue' | 'cline' | 'roo' | 'kilo';
export type AgentSetupMode = 'configured' | 'assisted';

export interface ConfigureAgentResult {
  ok: boolean;
  target: AgentSetupTarget;
  mode: AgentSetupMode;
  baseUrl: string;
  rootPath: string;
  written: number;
  files: AgentConfigFileRecord[];
  primarySelection: AgentPrimarySelection | null;
  env: Record<string, string>;
  steps: string[];
  warnings: string[];
  errors: string[];
  providerConfig?: 'created' | 'updated' | 'unchanged';
  profiles?: AgentProfileRecord[];
  defaultProfile?: string | null;
}

export interface ConfigureClaudeAgentProfilesOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
}

export interface ConfigureCodexAgentProfilesOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
  existingCodexConfig?: string;
}

export interface ConfigureContinueAgentOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
  existingConfig?: string;
}

export interface ConfigureClineAgentOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
}

export interface ConfigureRooAgentOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
}

export interface ConfigureKiloAgentOptions {
  baseUrl: string;
  homeDir?: string;
  models: AgentModelEntry[];
}

interface PreparedProfile {
  modelId: string;
  profileName: string;
}

interface ContinueModelConfig {
  name: string;
  provider: 'openai';
  model: string;
  apiBase: string;
  apiKey: string;
  roles: string[];
}

interface ContinueConfig {
  name?: string;
  version?: string;
  schema?: string;
  models?: ContinueModelConfig[];
  [key: string]: unknown;
}

const CONTINUE_SECRET_REF = '${{ secrets.AGENTRAIL_API_KEY }}';
const DEFAULT_GATEWAY_KEY_HINT = '<your AGENTRAIL_API_KEY or any non-empty value if gateway auth is disabled>';
const VSCODE_SETTINGS_WINDOWS_SEGMENTS = ['AppData', 'Roaming', 'Code', 'User', 'settings.json'];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBaseUrl(baseUrl: string): string {
  return stripTrailingSlash(baseUrl).replace(/\/v1$/, '');
}

function ensureOpenAiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/v1`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function buildProfileName(slug: string): string {
  return `agentrail-${slug}`;
}

function getAgentHomeDir(homeDir?: string): string {
  return homeDir ?? process.env.AGENTRAIL_AGENT_CONFIG_HOME ?? os.homedir();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildResult(params: Omit<ConfigureAgentResult, 'ok'>): ConfigureAgentResult {
  return {
    ...params,
    ok: params.errors.length === 0,
  };
}

function buildEnvValueHints(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key]) => key);
}

function choosePrimaryModel(models: AgentModelEntry[]): AgentModelEntry | null {
  if (models.length === 0) return null;
  return models.find((entry) => entry.id === 'agentrail/auto') ?? models[0];
}

function resolveVscodeSettingsPath(homeDir: string): string {
  if (process.platform === 'win32') {
    return path.join(homeDir, ...VSCODE_SETTINGS_WINDOWS_SEGMENTS);
  }
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  return path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
}

function makePrimarySelection(type: 'profile' | 'model', name: string, modelId: string, filePath?: string): AgentPrimarySelection {
  return filePath ? { type, name, modelId, path: filePath } : { type, name, modelId };
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readOptionalFile(filePath);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function slugifyAgentProfileName(modelId: string): string {
  const trimmed = String(modelId || '').trim().toLowerCase();
  const withoutNamespace = trimmed.startsWith('agentrail/') ? trimmed.slice('agentrail/'.length) : trimmed;
  const slug = withoutNamespace
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'model';
}

function prepareProfiles(models: AgentModelEntry[], warnings: string[]): PreparedProfile[] {
  const seen = new Map<string, number>();

  return models.map(({ id }) => {
    const slug = slugifyAgentProfileName(id);
    const nextIndex = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, nextIndex);
    if (nextIndex > 1) {
      warnings.push(`Multiple model IDs mapped to '${buildProfileName(slug)}'; wrote '${buildProfileName(`${slug}-${nextIndex}`)}' for '${id}'.`);
    }
    const dedupedSlug = nextIndex > 1 ? `${slug}-${nextIndex}` : slug;
    return {
      modelId: id,
      profileName: buildProfileName(dedupedSlug),
    };
  });
}

export function buildClaudeProfileSettings(modelId: string, baseUrl: string): string {
  const settings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    model: modelId,
    env: {
      ANTHROPIC_BASE_URL: normalizeBaseUrl(baseUrl),
      ANTHROPIC_MODEL: modelId,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function buildCodexProfileToml(modelId: string): string {
  return [
    `model = ${JSON.stringify(modelId)}`,
    'model_provider = "agentrail"',
  ].join('\n') + '\n';
}

function buildCodexProviderBlock(baseUrl: string): string {
  const lines = [
    '[model_providers.agentrail]',
    'name = "AgentRail"',
    `base_url = ${JSON.stringify(ensureOpenAiBaseUrl(baseUrl))}`,
    'env_key = "AGENTRAIL_API_KEY"',
    'requires_openai_auth = false',
    'wire_api = "responses"',
  ];
  return `${lines.join('\n')}\n`;
}

function upsertCodexProviderConfig(existingContent: string, baseUrl: string): { content: string; state: 'created' | 'updated' | 'unchanged' } {
  const normalized = existingContent.replace(/\r\n/g, '\n');
  const block = buildCodexProviderBlock(baseUrl).trimEnd();
  const header = '[model_providers.agentrail]';
  const lines = normalized ? normalized.split('\n') : [];
  const start = lines.findIndex((line) => line.trim() === header);

  if (start === -1) {
    const prefix = normalized.trim().length > 0 ? `${normalized.trimEnd()}\n\n` : '';
    return {
      content: ensureTrailingNewline(`${prefix}${block}`),
      state: normalized.trim().length > 0 ? 'updated' : 'created',
    };
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const currentBlock = lines.slice(start, end).join('\n').trimEnd();
  if (currentBlock === block) {
    return { content: ensureTrailingNewline(normalized), state: 'unchanged' };
  }

  const nextLines = [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)];
  return {
    content: ensureTrailingNewline(nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()),
    state: 'updated',
  };
}

export function mergeCodexProviderConfig(existingContent: string, baseUrl: string): string {
  return upsertCodexProviderConfig(existingContent, baseUrl).content;
}

export function buildContinueModels(modelIds: string[], apiBase: string): ContinueModelConfig[] {
  return modelIds.map((id) => ({
    name: `AgentRail: ${id}`,
    provider: 'openai',
    model: id,
    apiBase,
    apiKey: CONTINUE_SECRET_REF,
    roles: ['chat', 'edit', 'apply'],
  }));
}

export function mergeContinueConfig(existing: ContinueConfig, newModels: ContinueModelConfig[], apiBase: string): ContinueConfig {
  const base = isRecord(existing) ? { ...existing } : {};
  const previousModels = Array.isArray(base.models) ? base.models.filter(isRecord) as ContinueModelConfig[] : [];
  const keptModels = previousModels.filter((entry) => {
    if (entry.apiBase !== apiBase) return true;
    return !String(entry.name ?? '').startsWith('AgentRail: ');
  });
  return {
    ...base,
    name: typeof base.name === 'string' ? base.name : 'AgentRail Config',
    version: typeof base.version === 'string' ? base.version : '1.0.0',
    schema: typeof base.schema === 'string' ? base.schema : 'v1',
    models: [...keptModels, ...newModels],
  };
}

export function buildClineGlobalState(existing: Record<string, unknown>, params: { baseUrl: string; model: string }): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    actModeApiProvider: 'openai',
    planModeApiProvider: 'openai',
    openAiBaseUrl: normalizeBaseUrl(params.baseUrl),
    openAiModelId: params.model,
    planModeOpenAiModelId: params.model,
  };
}

export function buildRooImport(params: { baseUrl: string; model: string }): Record<string, unknown> {
  return {
    providerProfiles: {
      currentApiConfigName: 'AgentRail',
      apiConfigs: {
        AgentRail: {
          apiProvider: 'openai',
          openAiBaseUrl: ensureOpenAiBaseUrl(params.baseUrl),
          openAiModelId: params.model,
          openAiCustomModelInfo: {
            supportsImages: false,
            supportsPromptCache: false,
          },
        },
      },
    },
  };
}

export function buildRooVscodeSettings(existing: Record<string, unknown>, importPath: string): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    'roo-cline.autoImportSettingsPath': importPath,
  };
}

export function buildKiloVscodeSettings(existing: Record<string, unknown>, params: { baseUrl: string; model: string }): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    'kilocode.customProvider': {
      name: 'AgentRail',
      baseURL: ensureOpenAiBaseUrl(params.baseUrl),
    },
    'kilocode.defaultModel': params.model,
  };
}

export async function configureClaudeAgentProfiles(options: ConfigureClaudeAgentProfilesOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.join(homeDir, '.claude', 'profiles');
  const warnings: string[] = [];
  const errors: string[] = [];
  const profiles = prepareProfiles(options.models, warnings);
  const records: AgentProfileRecord[] = [];
  const files: AgentConfigFileRecord[] = [];
  let written = 0;

  try {
    await mkdir(rootPath, { recursive: true });
    for (const profile of profiles) {
      const targetDir = path.join(rootPath, profile.profileName);
      const targetPath = path.join(targetDir, 'settings.json');
      await mkdir(targetDir, { recursive: true });
      await writeFile(targetPath, buildClaudeProfileSettings(profile.modelId, baseUrl), 'utf8');
      records.push({ modelId: profile.modelId, profileName: profile.profileName, path: targetPath });
      files.push({ kind: 'claude-profile', path: targetPath });
      written += 1;
    }
  } catch (error) {
    errors.push(`Claude Code configuration failed: ${(error as Error).message}`);
  }

  const defaultProfile = records[0]?.profileName ?? null;
  const primarySelection = records[0]
    ? makePrimarySelection('profile', records[0].profileName, records[0].modelId, records[0].path)
    : null;

  return buildResult({
    target: 'claude',
    mode: 'configured',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection,
    env: {
      CLAUDE_CONFIG_DIR: defaultProfile ? path.join(rootPath, defaultProfile) : rootPath,
      ANTHROPIC_AUTH_TOKEN: DEFAULT_GATEWAY_KEY_HINT,
      ANTHROPIC_BASE_URL: baseUrl,
    },
    steps: [
      'Set ANTHROPIC_AUTH_TOKEN in your PowerShell session before launching Claude Code.',
      defaultProfile ? `Launch Claude Code with CLAUDE_CONFIG_DIR set to the '${defaultProfile}' profile directory.` : 'Select one generated Claude profile.',
    ],
    warnings,
    errors,
    profiles: records,
    defaultProfile,
  });
}

export async function configureCodexAgentProfiles(options: ConfigureCodexAgentProfilesOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.join(homeDir, '.codex');
  const warnings: string[] = [];
  const errors: string[] = [];
  const profiles = prepareProfiles(options.models, warnings);
  const records: AgentProfileRecord[] = [];
  const files: AgentConfigFileRecord[] = [];
  let written = 0;
  let providerConfig: 'created' | 'updated' | 'unchanged' = 'unchanged';

  try {
    await mkdir(rootPath, { recursive: true });
    const codexConfigPath = path.join(rootPath, 'config.toml');
    const existingConfig = options.existingCodexConfig ?? await readOptionalFile(codexConfigPath) ?? '';
    const mergedConfig = upsertCodexProviderConfig(existingConfig, baseUrl);
    providerConfig = mergedConfig.state;
    if (providerConfig !== 'unchanged' || options.existingCodexConfig !== undefined || existingConfig.length === 0) {
      await writeFile(codexConfigPath, mergedConfig.content, 'utf8');
    }
    files.push({ kind: 'codex-provider-config', path: codexConfigPath });

    for (const profile of profiles) {
      const targetPath = path.join(rootPath, `${profile.profileName}.config.toml`);
      await writeFile(targetPath, buildCodexProfileToml(profile.modelId), 'utf8');
      records.push({ modelId: profile.modelId, profileName: profile.profileName, path: targetPath });
      files.push({ kind: 'codex-profile', path: targetPath });
      written += 1;
    }
  } catch (error) {
    errors.push(`Codex configuration failed: ${(error as Error).message}`);
  }

  const defaultProfile = records[0]?.profileName ?? null;
  const primarySelection = records[0]
    ? makePrimarySelection('profile', records[0].profileName, records[0].modelId, records[0].path)
    : null;

  return buildResult({
    target: 'codex',
    mode: 'configured',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection,
    env: {
      AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT,
    },
    steps: [
      'Set AGENTRAIL_API_KEY in your PowerShell session before launching Codex.',
      defaultProfile ? `Launch Codex with the '${defaultProfile}' profile.` : 'Select one generated Codex profile.',
    ],
    warnings,
    errors,
    providerConfig,
    profiles: records,
    defaultProfile,
  });
}

export async function configureContinueAgent(options: ConfigureContinueAgentOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.join(homeDir, '.continue');
  const warnings: string[] = [];
  const errors: string[] = [];
  const files: AgentConfigFileRecord[] = [];
  const configPath = path.join(rootPath, 'config.yaml');
  const apiBase = ensureOpenAiBaseUrl(baseUrl);
  const models = buildContinueModels(options.models.map((entry) => entry.id), apiBase);
  let written = 0;

  try {
    await mkdir(rootPath, { recursive: true });
    const existingContent = options.existingConfig ?? await readOptionalFile(configPath) ?? '';
    let existingConfig: ContinueConfig = {};
    if (existingContent.trim()) {
      try {
        const parsed = yaml.load(existingContent);
        existingConfig = isRecord(parsed) ? parsed as ContinueConfig : {};
      } catch (error) {
        warnings.push(`Existing Continue config could not be parsed and was replaced: ${(error as Error).message}`);
      }
    }
    const mergedConfig = mergeContinueConfig(existingConfig, models, apiBase);
    const output = yaml.dump(mergedConfig, { lineWidth: -1, noRefs: true, sortKeys: false });
    await writeFile(configPath, ensureTrailingNewline(output), 'utf8');
    files.push({ kind: 'continue-config', path: configPath });
    written = 1;
  } catch (error) {
    errors.push(`Continue configuration failed: ${(error as Error).message}`);
  }

  const primary = choosePrimaryModel(options.models);
  return buildResult({
    target: 'continue',
    mode: 'configured',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection: primary ? makePrimarySelection('model', `AgentRail: ${primary.id}`, primary.id, configPath) : null,
    env: {
      AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT,
    },
    steps: [
      'Set AGENTRAIL_API_KEY in your PowerShell session before using Continue.',
      'Restart Continue so it reloads ~/.continue/config.yaml.',
    ],
    warnings,
    errors,
  });
}

export async function configureClineAgent(options: ConfigureClineAgentOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.join(homeDir, '.cline', 'data');
  const warnings: string[] = [];
  const errors: string[] = [];
  const files: AgentConfigFileRecord[] = [];
  const primary = choosePrimaryModel(options.models);
  let written = 0;

  if (!primary) {
    return buildResult({
      target: 'cline',
      mode: 'assisted',
      baseUrl,
      rootPath,
      written,
      files,
      primarySelection: null,
      env: { AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT },
      steps: ['No active AgentRail model was available to prefill Cline.'],
      warnings,
      errors: ['Cline configuration failed: no active model available.'],
    });
  }

  try {
    await mkdir(rootPath, { recursive: true });
    const globalStatePath = path.join(rootPath, 'globalState.json');
    const existingState = await readOptionalJson(globalStatePath);
    const nextState = buildClineGlobalState(existingState, { baseUrl, model: primary.id });
    await writeFile(globalStatePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
    files.push({ kind: 'cline-global-state', path: globalStatePath });
    written = 1;
  } catch (error) {
    errors.push(`Cline configuration failed: ${(error as Error).message}`);
  }

  return buildResult({
    target: 'cline',
    mode: 'assisted',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection: makePrimarySelection('model', primary.id, primary.id),
    env: {
      AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT,
    },
    steps: [
      'Open Cline Settings → API and paste AGENTRAIL_API_KEY into the OpenAI-compatible API key field.',
      `Confirm the Base URL is '${baseUrl}' and the model is '${primary.id}'.`,
    ],
    warnings,
    errors,
  });
}

export async function configureRooAgent(options: ConfigureRooAgentOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.join(homeDir, '.agentrail');
  const warnings: string[] = [];
  const errors: string[] = [];
  const files: AgentConfigFileRecord[] = [];
  const primary = choosePrimaryModel(options.models);
  let written = 0;

  if (!primary) {
    return buildResult({
      target: 'roo',
      mode: 'assisted',
      baseUrl,
      rootPath,
      written,
      files,
      primarySelection: null,
      env: { AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT },
      steps: ['No active AgentRail model was available to prefill Roo Code.'],
      warnings,
      errors: ['Roo Code configuration failed: no active model available.'],
    });
  }

  try {
    await mkdir(rootPath, { recursive: true });
    const importPath = path.join(rootPath, 'roo-settings.json');
    const importDoc = buildRooImport({ baseUrl, model: primary.id });
    await writeFile(importPath, `${JSON.stringify(importDoc, null, 2)}\n`, 'utf8');
    files.push({ kind: 'roo-import', path: importPath });
    written += 1;

    const vscodeSettingsPath = resolveVscodeSettingsPath(homeDir);
    await mkdir(path.dirname(vscodeSettingsPath), { recursive: true });
    const existingSettings = await readOptionalJson(vscodeSettingsPath);
    const mergedSettings = buildRooVscodeSettings(existingSettings, importPath);
    await writeFile(vscodeSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, 'utf8');
    files.push({ kind: 'vscode-settings', path: vscodeSettingsPath });
    written += 1;
  } catch (error) {
    errors.push(`Roo Code configuration failed: ${(error as Error).message}`);
  }

  return buildResult({
    target: 'roo',
    mode: 'assisted',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection: makePrimarySelection('model', primary.id, primary.id),
    env: {
      AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT,
    },
    steps: [
      'Restart VS Code or use Roo → Import Settings to load the generated AgentRail import file.',
      'Paste AGENTRAIL_API_KEY into Roo Code when it prompts for the OpenAI-compatible provider key.',
    ],
    warnings,
    errors,
  });
}

export async function configureKiloAgent(options: ConfigureKiloAgentOptions): Promise<ConfigureAgentResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const homeDir = getAgentHomeDir(options.homeDir);
  const rootPath = path.dirname(resolveVscodeSettingsPath(homeDir));
  const warnings: string[] = [];
  const errors: string[] = [];
  const files: AgentConfigFileRecord[] = [];
  const primary = choosePrimaryModel(options.models);
  let written = 0;

  if (!primary) {
    return buildResult({
      target: 'kilo',
      mode: 'assisted',
      baseUrl,
      rootPath,
      written,
      files,
      primarySelection: null,
      env: { AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT },
      steps: ['No active AgentRail model was available to prefill Kilo Code.'],
      warnings,
      errors: ['Kilo Code configuration failed: no active model available.'],
    });
  }

  try {
    const vscodeSettingsPath = resolveVscodeSettingsPath(homeDir);
    await mkdir(path.dirname(vscodeSettingsPath), { recursive: true });
    const existingSettings = await readOptionalJson(vscodeSettingsPath);
    const mergedSettings = buildKiloVscodeSettings(existingSettings, { baseUrl, model: primary.id });
    await writeFile(vscodeSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, 'utf8');
    files.push({ kind: 'vscode-settings', path: vscodeSettingsPath });
    written = 1;
  } catch (error) {
    errors.push(`Kilo Code configuration failed: ${(error as Error).message}`);
  }

  return buildResult({
    target: 'kilo',
    mode: 'assisted',
    baseUrl,
    rootPath,
    written,
    files,
    primarySelection: makePrimarySelection('model', primary.id, primary.id),
    env: {
      AGENTRAIL_API_KEY: DEFAULT_GATEWAY_KEY_HINT,
    },
    steps: [
      'Open Kilo Code Settings and paste AGENTRAIL_API_KEY into the custom provider API key field.',
      `Confirm the Base URL is '${ensureOpenAiBaseUrl(baseUrl)}' and the model is '${primary.id}'.`,
    ],
    warnings,
    errors,
  });
}

