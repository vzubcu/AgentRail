export function createDashboardRenderer({
  dashboardOverviewFeature,
  getOpenProviderDetail,
  getProvidersFeature,
  usageFeature,
  modelsFeature,
  keysFeature,
  testConsoleFeature,
  quickConnectFeature,
}) {
  function renderKeys() {
    keysFeature.renderKeys();
    document.getElementById('keys-form')?.querySelectorAll('[data-manage-provider-keys]').forEach(button => {
      button.addEventListener('click', () => {
        const providerName = button.getAttribute('data-manage-provider-keys');
        if (providerName) {
          getOpenProviderDetail()?.(providerName);
        }
      });
    });
  }

  function renderAll() {
    dashboardOverviewFeature.renderControlRoomStatus();
    getProvidersFeature()?.renderProviders();
    usageFeature.renderSyncMeta();
    usageFeature.renderUsage();
    modelsFeature.renderModelProviderFilter();
    modelsFeature.renderModelTierFilter();
    modelsFeature.renderModels();
    renderKeys();
    testConsoleFeature.renderProviderFilter();
    testConsoleFeature.renderModelOptions();
    quickConnectFeature.renderAgentModelSelectors();
  }

  return {
    renderAll,
    renderKeys,
  };
}
