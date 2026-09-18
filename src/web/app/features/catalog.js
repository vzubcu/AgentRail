export function createCatalogFeature({ state, fetchJSON, getProviderFromPath, keysFeature, renderAll }) {
  let loadCatalogPromise = null;

  async function loadCatalog() {
    loadCatalogPromise ??= (async () => {
      const data = await fetchJSON('/api/catalog');
      state.providers = Array.isArray(data.providers) ? data.providers : [];
      state.models = Array.isArray(data.models) ? data.models : [];
      state.healthSummary = data.healthSummary ?? null;
      state.syncMetas = data.syncMetas ?? {};
      state.catalogLoaded = true;
      state.selectedProviderName = getProviderFromPath() ?? state.selectedProviderName;
      await keysFeature.loadKeySummaries();
      await loadOAuthStatus(state, fetchJSON);
      renderAll();
    })().finally(() => {
      loadCatalogPromise = null;
    });

    await loadCatalogPromise;
  }

  return {
    loadCatalog,
  };
}

async function loadOAuthStatus(state, fetchJSON) {
  try {
    const data = await fetchJSON('/api/oauth/status');
    state.oauthStatus = data.providers || {};
  } catch {
    state.oauthStatus = {};
  }
}
