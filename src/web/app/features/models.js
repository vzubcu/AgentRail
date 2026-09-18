export function formatCapabilityLabel(capability) {
  const labels = {
    chat: 'Chat',
    vision: 'Vision',
    image_generation: 'Image Generation',
    image_edit: 'Image Editing',
    audio_transcription: 'Transcription',
    audio_generation: 'Audio Generation',
    video_generation: 'Video Generation',
    music_generation: 'Music Generation',
    embeddings: 'Embeddings',
  };
  return labels[capability] || capability;
}

const COMMERCIAL_TIER_ORDER = ['free', 'trial', 'paid', 'unknown'];

export function formatCommercialTierLabel(tier) {
  const labels = {
    free: 'Free',
    trial: 'Trial',
    paid: 'Paid',
    unknown: 'Unknown',
  };
  return labels[tier] || 'Unknown';
}

export function createModelsFeature({ state, escapeHtml, formatNumber, copyText }) {
  function getSortedProviderNames() {
    return state.providers
      .map(provider => provider.name)
      .slice()
      .sort((a, b) => a.localeCompare(b));
  }

  function renderModelProviderFilter() {
    const select = document.getElementById('model-provider-filter');
    if (!select) return;

    const previousValue = select.value || 'all';
    const options = ['all', ...getSortedProviderNames()];
    select.innerHTML = options.map(value => {
      const label = value === 'all' ? 'All providers' : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    select.value = options.includes(previousValue) ? previousValue : 'all';
  }

  function renderModelTierFilter() {
    const select = document.getElementById('model-tier-filter');
    if (!select) return;

    const previousValue = select.value || 'all';
    const options = ['all', ...COMMERCIAL_TIER_ORDER];
    select.innerHTML = options.map(value => {
      const label = value === 'all' ? 'All tiers' : formatCommercialTierLabel(value);
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    select.value = options.includes(previousValue) ? previousValue : 'all';
  }

  function sortModels(models, sortKey) {
    return models.slice().sort((a, b) => {
      if (sortKey === 'context') {
        return (b.context ?? 0) - (a.context ?? 0) || a.id.localeCompare(b.id);
      }
      if (sortKey === 'providers') {
        return b.providers.length - a.providers.length || a.id.localeCompare(b.id);
      }
      return a.id.localeCompare(b.id);
    });
  }

  function renderModels() {
    const list = document.getElementById('models-list');
    if (!list) return;

    if (!state.catalogLoaded) {
      list.innerHTML = '<div class="models-empty-state">Loading model catalog…</div>';
      return;
    }

    if (state.models.length === 0) {
      list.innerHTML = '<div class="models-empty-state">No active chat models found. Check provider health or refresh provider models.</div>';
      return;
    }

    const search = document.getElementById('model-search')?.value.trim().toLowerCase() || '';
    const providerFilter = document.getElementById('model-provider-filter')?.value || 'all';
    const tierFilter = document.getElementById('model-tier-filter')?.value || 'all';
    const sortKey = document.getElementById('model-sort')?.value || 'name';

    const filtered = state.models.filter(model => {
      const matchesSearch = !search || [
        model.id,
        model.modality || '',
        model.commercialTier || '',
        model.commercialNote || '',
        ...(model.capabilities || []),
        ...model.providers.map(p => p.name),
      ].some(value => value.toLowerCase().includes(search));
      const matchesProvider = providerFilter === 'all' || model.providers.some(provider => provider.name === providerFilter);
      const matchesTier = tierFilter === 'all' || (model.commercialTier || 'unknown') === tierFilter;
      return matchesSearch && matchesProvider && matchesTier;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="models-empty-state">No models match the current filters.</div>';
      return;
    }

    const grouped = new Map(COMMERCIAL_TIER_ORDER.map(tier => [tier, []]));
    for (const model of sortModels(filtered, sortKey)) {
      const tier = model.commercialTier || 'unknown';
      if (!grouped.has(tier)) {
        grouped.set(tier, []);
      }
      grouped.get(tier).push(model);
    }

    list.innerHTML = COMMERCIAL_TIER_ORDER
      .filter(tier => (grouped.get(tier) || []).length > 0)
      .map(tier => {
        const models = grouped.get(tier) || [];
        return `
          <section class="model-tier-group">
            <div class="model-tier-group-header">
              <div class="model-tier-group-kicker">Commercial Tier</div>
              <div class="model-tier-group-title-row">
                <strong>${escapeHtml(formatCommercialTierLabel(tier))}</strong>
                <span>${models.length} model${models.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div class="model-tier-group-grid">
              ${models.map(model => `
                <div class="model-item">
                  <div class="model-info">
                    <div>
                      <div class="model-id-row">
                        <div class="model-id">${model.id}</div>
                        <button class="copy-model-btn" type="button" data-copy-model-id="${model.id}">Copy</button>
                      </div>
                      <div class="provider-model-id">${model.providers.map(p => `${p.name}: ${p.providerModelId}`).join(' · ')}</div>
                    </div>
                    <div class="model-provider-stack">
                      <div class="model-provider">${model.providers.length} providers</div>
                      <div class="model-commercial-tier model-commercial-tier-${escapeHtml(model.commercialTier || 'unknown')}">${escapeHtml(formatCommercialTierLabel(model.commercialTier || 'unknown'))}</div>
                    </div>
                  </div>
                  ${model.commercialNote ? `<div class="model-commercial-note">${escapeHtml(model.commercialNote)}</div>` : ''}
                  <div class="model-capabilities">
                    ${(model.capabilities || []).map(capability => `<span class="model-capability">${escapeHtml(formatCapabilityLabel(capability))}</span>`).join('') || '<span class="model-capability muted">Unclassified</span>'}
                  </div>
                  <div class="model-specs">
                    <div class="model-spec">Context <span>${model.context ? formatNumber(model.context) : '—'}</span></div>
                    <div class="model-spec">Output <span>${model.maxOutput ? formatNumber(model.maxOutput) : '—'}</span></div>
                    <div class="model-spec">Mode <span>${model.modality || '—'}</span></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>
        `;
      })
      .join('');

    list.querySelectorAll('[data-copy-model-id]').forEach(button => {
      button.addEventListener('click', async () => {
        const modelId = button.getAttribute('data-copy-model-id');
        const originalText = button.textContent;
        button.disabled = true;
        try {
          await copyText(modelId);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Failed';
        }
        window.setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1200);
      });
    });
  }

  return {
    formatCapabilityLabel,
    formatCommercialTierLabel,
    getSortedProviderNames,
    renderModelProviderFilter,
    renderModelTierFilter,
    renderModels,
  };
}
