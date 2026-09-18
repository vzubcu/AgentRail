export function filterModels({ candidates, providerFilter = '', capabilitiesFilter = [], contextFilter = 0, tierFilter = 'all' }) {
  return (candidates || []).flatMap(group => group.models || []).filter(model => {
    const providerMatch = !providerFilter || model.provider === providerFilter;
    const capabilitiesMatch = capabilitiesFilter.length === 0 ||
      (model.capabilities || []).some(cap => capabilitiesFilter.includes(cap));
    const contextMatch = !contextFilter || (model.context && model.context >= contextFilter);
    const tierMatch = tierFilter === 'all' || model.commercialTier === tierFilter;
    return providerMatch && capabilitiesMatch && contextMatch && tierMatch;
  });
}

export function filterModelsByProvider({ candidates, provider }) {
  return (candidates || []).flatMap(group => group.models || []).filter(model => model.provider === provider);
}

export function groupCandidatesByProvider(candidates) {
  const grouped = {};
  for (const candidate of candidates || []) {
    const provider = candidate.provider || candidate.providerName || 'Unknown';
    if (!grouped[provider]) grouped[provider] = [];
    const models = Array.isArray(candidate.models) ? candidate.models : [candidate];
    for (const model of models) {
      grouped[provider].push(model);
    }
  }
  return grouped;
}
