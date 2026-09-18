// Virtual Model Edit Page Script
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const form = document.getElementById('vm-edit-form');
  const modelList = document.getElementById('vm-model-list');
  const providerSelect = document.getElementById('vm-filter-provider');
  const capabilitiesSelect = document.getElementById('vm-filter-capabilities');
  const contextSelect = document.getElementById('vm-filter-context');
  const addModelSelect = document.getElementById('vm-model-add-provider');
  const tagList = document.getElementById('vm-tag-list');
  const formFeedback = document.getElementById('vm-form-feedback');
  const backBtn = document.getElementById('vm-back-btn');
  const capabilitiesGrid = document.getElementById('vm-capabilities-grid');
  
  // State
  let editingId = null;
  let selectedModels = [];
  let allModels = [];
  let capabilities = [];
  let contextLengths = [];
  
  // Initialize page
  initPage();
  
  // Event Listeners
  form.addEventListener('submit', handleFormSubmit);
  backBtn.addEventListener('click', () => {
    window.location.href = '/virtual-models';
  });
  
  // Filter event listeners
  providerSelect.addEventListener('change', () => {
    updateModelList();
    renderModelOptions();
  });

  capabilitiesSelect.addEventListener('change', () => {
    updateModelList();
    renderModelOptions();
  });

  contextSelect.addEventListener('change', () => {
    updateModelList();
    renderModelOptions();
  });
  
  // Add model from dropdown
  addModelSelect.addEventListener('change', () => {
    if (addModelSelect.value) {
      const modelId = addModelSelect.value;
      const model = allModels.find(m => m.id === modelId);
      if (model) {
        addSelectedModel(model);
        addModelSelect.selectedIndex = 0;
      }
    }
  });
  
  // Tag management
  tagList.addEventListener('click', (e) => {
    if (e.target.classList.contains('vm-tag-remove')) {
      const tagValue = e.target.getAttribute('data-tag');
      removeTag(tagValue);
    }
  });
  
  // Initialize form state
  function initPage() {
    // Load all models
    loadAllModels();
    
    // Load capabilities
    loadCapabilities();
    
    // Load context lengths
    loadContextLengths();
    
    // Load existing selected models
    loadSelectedModels();
    
    // Update model list with current filters
    updateModelList();
  }
  
  // Load all virtual models from API
  async function loadAllModels() {
    try {
      const response = await fetchJSON('/api/virtual-models');
      allModels = response;
      renderModelOptions();
    } catch (err) {
      showFormFeedback(`Failed to load models: ${err.message}`, 'error');
    }
  }
  
  // Load capabilities from API
  async function loadCapabilities() {
    try {
      const response = await fetchJSON('/api/virtual-models/capabilities');
      capabilities = response;
      renderCapabilityOptions();
    } catch (err) {
      showFormFeedback(`Failed to load capabilities: ${err.message}`, 'error');
    }
  }
  
    // Load context lengths from API
    async function loadContextLengths() {
      try {
        const response = await fetchJSON('/api/virtual-models/context-lengths');
        contextLengths = response;
        renderContextLengthOptions();
      } catch (err) {
        showFormFeedback(`Failed to load context lengths: ${err.message}`, 'error');
      }
    }
  
  // Load currently selected models
  async function loadSelectedModels() {
    try {
      if (editingId) {
        const response = await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}`);
        selectedModels = response.selectedModels || [];
        renderSelectedModelList();
      }
    } catch (err) {
      showFormFeedback(`Failed to load selected models: ${err.message}`, 'error');
    }
  }
  
  // Get filtered models based on current filter criteria
  function getFilteredModels() {
    const providerFilter = providerSelect.value;
    const contextFilter = contextSelect.value;

    // Get selected capabilities from checkboxes
    const capabilityCheckboxes = document.querySelectorAll('.capability-item input[type="checkbox"]:checked');
    const capabilitiesFilter = Array.from(capabilityCheckboxes).map(cb => cb.value);

    return allModels.filter(model => {
      // Provider filter
      if (providerFilter && model.provider !== providerFilter) return false;

      // Capabilities filter - show models that have ALL selected capabilities
      if (capabilitiesFilter.length > 0) {
        const hasAllCapabilities = capabilitiesFilter.every(cap =>
          (model.capabilities || []).includes(cap)
        );
        if (!hasAllCapabilities) return false;
      }

      // Context length filter
      if (contextFilter && contextFilter !== 'All Context Lengths') {
        const contextValue = parseInt(contextFilter, 10);
        if (isNaN(contextValue) || !(model.context && model.context >= contextValue)) {
          return false;
        }
      }

      return true;
    });
  }

  // Render model options in the add dropdown
  function renderModelOptions() {
    const filteredModels = getFilteredModels();
    addModelSelect.innerHTML = '<option value="">— Select model —</option>';
    filteredModels.forEach(model => {
      addModelSelect.innerHTML += `
        <option value="${model.id}">${model.name} (${model.provider})</option>
      `;
    });
  }
  
  // Render capability checkboxes
  function renderCapabilityOptions() {
    capabilitiesGrid.innerHTML = '';
    capabilities.forEach(cap => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `cap-${cap.id}`;
      checkbox.value = cap.id;
      checkbox.checked = selectedModels.some(sm => sm.capabilities.includes(cap.id));
      
      const label = document.createElement('label');
      label.htmlFor = `cap-${cap.id}`;
      label.textContent = cap.name;
      
      const wrapper = document.createElement('div');
      wrapper.className = 'capability-item';
      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      
      capabilitiesGrid.appendChild(wrapper);
    });
  }
  
  // Render context length options
  function renderContextLengthOptions() {
    contextSelect.innerHTML = '<option value="">All Context Lengths</option>';
    contextLengths.forEach(length => {
      contextSelect.innerHTML += `
        <option value="${length}">${length} tokens</option>
      `;
    });
  }
  
  // Render selected models list
  function renderSelectedModelList() {
    modelList.innerHTML = selectedModels.map((model, index) => `
      <div class="model-item" data-index="${index}">
        <div class="model-info">
          <span>${model.name}</span>
          <span class="model-provider">${model.provider}</span>
        </div>
        <div class="model-actions">
          <button class="btn-secondary" data-index="${index}">Remove</button>
        </div>
      </div>
    `).join('');
    
    // Add event listeners to model actions
    modelList.querySelectorAll('.btn-secondary').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        removeSelectedModel(index);
      });
    });
  }
  
  // Add a selected model
  function addSelectedModel(model) {
    if (!selectedModels.some(sm => sm.provider === model.provider && sm.providerModelId === model.id)) {
      selectedModels.push({
        ...model,
        priority: selectedModels.length + 1,
        enabled: true,
        weight: 1,
        fallbackOnly: false,
        capabilities: model.capabilities || []
      });
      expandedMemberRows = new Set([selectedModels.length - 1]);
      updateModelList();
    } else {
      showFormFeedback('This model is already selected.', 'info');
    }
  }
  
  // Remove a selected model
  function removeSelectedModel(index) {
    selectedModels.splice(index, 1);
    expandedMemberRows = new Set(Array.from(expandedMemberRows).filter(value => value !== index).map(value => (value > index ? value - 1 : value)));
    updateModelList();
  }
  
  // Update the model list based on current filters
  function updateModelList() {
    modelList.innerHTML = '';

    // Filter models based on criteria
    const filteredModels = getFilteredModels();
    
    // Render filtered models
    filteredModels.forEach(model => {
      const isSelected = selectedModels.some(sm => 
        sm.provider === model.provider && 
        sm.providerModelId === model.id
      );
      
      modelList.innerHTML += `
        <div class="model-item" data-index="${model.id}">
          <div class="model-info">
            <span>${model.name}</span>
            <span class="model-provider">${model.provider}</span>
          </div>
          <div class="model-actions">
            <button class="btn-secondary" data-model-id="${model.id}">Add</button>
          </div>
        </div>
      `;
    });
    
    // Add event listeners to add buttons
    modelList.querySelectorAll('.btn-secondary[data-model-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelId = e.target.getAttribute('data-model-id');
        const model = allModels.find(m => m.id === modelId);
        if (model) {
          addSelectedModel(model);
        }
      });
    });
    
    // Update selected models list display
    renderSelectedModelList();
  }
  
  // Handle form submission
  async function handleFormSubmit(e) {
    e.preventDefault();
    
    const payload = collectFormPayload();
    if (!payload) return;
    
    try {
      if (editingId) {
        // Update existing model
        await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Create new model
        await fetchJSON('/api/virtual-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      
      showFormFeedback('Model saved successfully.', 'info');
      // Reset form and go back to list
      editingId = null;
      resetFormState();
      window.location.href = '/virtual-models';
    } catch (err) {
      showFormFeedback(`Failed to save: ${err.message}`, 'error');
    }
  }
  
  // Collect form data
  function collectFormPayload() {
    const container = document.getElementById('virtual-models-content');
    if (!container) return null;
    
    const id = document.getElementById('vm-field-id')?.value.trim() || '';
    const name = document.getElementById('vm-field-name')?.value.trim() || '';
    const description = document.getElementById('vm-field-description')?.value.trim() || '';
    const systemPrompt = document.getElementById('vm-field-system-prompt')?.value.trim() || '';
    const strategy = document.getElementById('vm-field-strategy')?.value || 'priority';
    const stickyMode = document.getElementById('vm-field-sticky-mode')?.value || 'none';
    
    const autoProtectionEnabled = document.getElementById('vm-field-auto-protection-enabled')?.checked === true;
    const failureThreshold = parseInt(document.getElementById('vm-field-failure-threshold')?.value || '3', 10);
    const cooldownMs = parseInt(document.getElementById('vm-field-cooldown-ms')?.value || '600000', 10);
    
    const autoProtection = {
      enabled: autoProtectionEnabled,
      failureThreshold,
      cooldownMs
    };
    
    const autoAliases = getTags();
    
    return {
      ...(id ? { id } : {}),
      name,
      description,
      systemPrompt: systemPrompt || null,
      routingStrategy: strategy,
      stickyMode: stickyMode === 'request-key' ? 'request-key' : 'none',
      autoProtection,
      autoAliases,
      selectedModels: selectedModels.map(sm => ({
        provider: sm.providerName,
        modelId: sm.providerModelId,
        priority: sm.priority,
        enabled: sm.enabled !== false,
        weight: Number.isFinite(sm.weight) && sm.weight > 0 ? sm.weight : 1,
        fallbackOnly: sm.fallbackOnly === true,
        capabilities: Array.isArray(sm.capabilities) ? sm.capabilities : [],
        memberState: sm.memberState || {
          consecutiveFailures: 0,
          lastFailureAt: null,
          autoDisabledUntil: null,
          lastAutoDisabledAt: null,
          lastRecoveredAt: null,
          lastSuccessAt: null,
        },
      })),
    };
  }
  
  // Reset form state
  function resetFormState() {
    document.getElementById('vm-field-id')?.value = '';
    document.getElementById('vm-field-name')?.value = '';
    document.getElementById('vm-field-description')?.value = '';
    document.getElementById('vm-field-system-prompt')?.value = '';
    document.getElementById('vm-field-strategy')?.value = 'priority';
    document.getElementById('vm-field-sticky-mode')?.value = 'none';
    document.getElementById('vm-field-auto-protection-enabled')?.checked = true;
    document.getElementById('vm-field-failure-threshold')?.value = '3';
    document.getElementById('vm-field-cooldown-ms')?.value = '600000';
    
    // Reset tags
    tagList.innerHTML = '';
    
    // Reset model list
    modelList.innerHTML = '';
    selectedModels = [];
    updateModelList();
  }
  
  // Show form feedback
  function showFormFeedback(message, type = 'info') {
    formFeedback.textContent = message;
    formFeedback.className = `vm-form-feedback vm-form-feedback-${type}`;
  }
  
  // Initialize the page when DOM is ready
  function initPage() {
    // Load all data
    loadAllModels();
    loadCapabilities();
    loadContextLengths();
    loadSelectedModels();
    
    // Initial render
    updateModelList();
  }
  
  // Expose functions for external use
  window.virtualModels = {
    init: initPage,
    loadAllModels,
    loadCapabilities,
    loadContextLengths,
    loadSelectedModels,
    updateModelList,
    collectFormPayload
  };
});