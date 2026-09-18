export function getQuickConnectModelEntries(state) {
  const entries = state.models
    .filter(model => model.id !== 'agentrail/files')
    .map(model => ({
      id: model.id,
      providers: model.isVirtual
        ? ['agentrail']
        : (model.providers || []).map(provider => provider.name).filter(Boolean),
      isVirtual: model.isVirtual === true,
    }));

  if (!entries.some(entry => entry.id === 'agentrail/auto') && entries.length > 0) {
    const providerNames = [...new Set(entries.flatMap(entry => entry.providers))];
    return [{ id: 'agentrail/auto', providers: providerNames }, ...entries];
  }

  return entries;
}

export function getRecommendedAgentModelId(entries) {
  return entries.find(entry => entry.id === 'agentrail/auto')?.id ?? entries[0]?.id ?? '';
}

export function getFilterKey(target, role) {
  return `${target}:${role}`;
}

export function getFilter(state, target, role) {
  return state.quickConnectFilters[getFilterKey(target, role)] || 'auto';
}

export function getProviderOptions(entries) {
  return [...new Set(entries.flatMap(entry => entry.providers))].sort((left, right) => left.localeCompare(right));
}

export function getFilterOptions(entries) {
  return [
    { kind: 'auto', label: 'Auto' },
    { kind: 'all', label: 'All active' },
    ...getProviderOptions(entries).map(name => ({ kind: name, label: name })),
  ];
}

export function getFilteredEntries(state, target, role) {
  const entries = getQuickConnectModelEntries(state);
  const filter = getFilter(state, target, role);
  if (filter === 'all') return entries;
  if (filter === 'auto') {
    const autoEntries = entries.filter(entry => entry.id === 'agentrail/auto');
    return autoEntries.length > 0 ? autoEntries : entries.slice(0, 1);
  }
  return entries.filter(entry => entry.providers.includes(filter));
}

export function syncSelection(state, target, role, values, root = document) {
  const key = getFilterKey(target, role);
  const entries = getFilteredEntries(state, target, role);
  const allowed = new Set(entries.map(entry => entry.id));
  const next = [];

  for (const value of values || []) {
    if (!allowed.has(value) || next.includes(value)) continue;
    next.push(value);
    if (role === 'launch') break;
  }

  if (next.length === 0 && role === 'launch') {
    const setupSelection = state.quickConnectSelections[getFilterKey(target, 'setup')] || [];
    const inherited = setupSelection.find(value => allowed.has(value));
    if (inherited) next.push(inherited);
  }

  if (next.length === 0) {
    const recommended = getRecommendedAgentModelId(entries);
    if (recommended) next.push(recommended);
  }

  state.quickConnectSelections[key] = role === 'launch' ? next.slice(0, 1) : next;

  root.querySelectorAll(`[data-agent-model-target="${target}"][data-agent-model-role="${role}"]`).forEach(select => {
    const selectedValues = new Set(state.quickConnectSelections[key]);
    Array.from(select.options).forEach(option => {
      option.selected = selectedValues.has(option.value);
    });
    if (role === 'launch') {
      select.value = state.quickConnectSelections[key][0] || '';
    }
  });

  return state.quickConnectSelections[key];
}

export function getSelectedAgentModelIds(state, target, role, root = document) {
  const select = root.querySelector(`[data-agent-model-target="${target}"][data-agent-model-role="${role}"]`);
  const values = select
    ? Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean)
    : (state.quickConnectSelections[getFilterKey(target, role)] || []);
  return syncSelection(state, target, role, values, root);
}

export function getStoredAgentProfileName(state, target, modelId) {
  const result = state.lastAgentResults[target];
  if (!result) return null;
  if (Array.isArray(result.profiles)) {
    const profile = result.profiles.find(entry => entry.modelId === modelId);
    if (profile?.profileName) return profile.profileName;
  }
  if (result.defaultProfile) return result.defaultProfile;
  if (result.primarySelection?.kind === 'profile') return result.primarySelection.name;
  return null;
}

export function buildPowerShellEnvSnippet(env) {
  return Object.entries(env || {})
    .map(([key, value]) => `$env:${key}="${String(value ?? '').replaceAll('"', '`"')}"`)
    .join('\n');
}
