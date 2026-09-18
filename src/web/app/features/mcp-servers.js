export function createMcpServersFeature({ state, fetchJSON, escapeHtml, reportStatus, activateTab, formatTime }) {
  const MODAL_ID = 'mcp-server-modal';
  const DELETE_MODAL_ID = 'mcp-server-delete-modal';
  const FORM_ID = 'mcp-server-form';
  const LIST_ID = 'mcp-servers-list';

  let currentEditingServer = null;
  let servers = [];

  function getInitials(name) {
    return (name || 'MCP').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  async function loadMcpServers() {
    try {
      reportStatus('Loading MCP servers...', { type: 'loading' });
      const data = await fetchJSON('/api/mcp-servers');
      if (Array.isArray(data)) {
        servers = data;
      } else if (data && Array.isArray(data.servers)) {
        servers = data.servers;
      } else {
        servers = [];
      }
      renderMcpServersList();
      reportStatus('MCP servers loaded successfully', { type: 'success' });
    } catch (error) {
      reportStatus(`Failed to load MCP servers: ${error.message}`, { type: 'error' });
      console.error('Error loading MCP servers:', error);
    }
  }

  function renderMcpServersList() {
    const container = document.getElementById(LIST_ID);
    if (!container) return;

    container.innerHTML = '';

    if (servers.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No MCP servers configured. Add your first server to get started.</p>
          <button class="primary-button" id="add-mcp-server-btn">Add Server</button>
        </div>
      `;

      const addBtn = document.getElementById('add-mcp-server-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => openMcpServerModal());
      }

      return;
    }

    const grid = document.createElement('div');
    grid.className = 'mcp-servers-grid';

    servers.forEach(server => {
      const card = document.createElement('div');
      card.className = `mcp-server-card ${server.enabled ? 'enabled' : 'disabled'}`;
      card.innerHTML = `
        <div class="mcp-server-header">
          <div class="mcp-server-identity">
            <div class="mcp-server-icon ${server.enabled ? 'active' : 'inactive'}">${getInitials(server.name)}</div>
            <h4>${escapeHtml(server.name)}</h4>
          </div>
          <div class="mcp-server-status ${server.enabled ? 'active' : 'inactive'}">
            <span class="status-dot ${server.enabled ? 'active' : 'inactive'}"></span>
            <span>${server.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        <div class="mcp-server-endpoint">
          <span>Endpoint</span>
          <code>${escapeHtml(server.endpoint)}</code>
        </div>

        ${server.tools?.length ? `
          <div class="mcp-server-tools">
            <div class="mcp-server-section-label">Tools (${server.tools.length})</div>
            <div>
              ${server.tools.slice(0, 5).map(tool => `
                <span class="tool-tag">${escapeHtml(tool)}</span>
              `).join('')}
              ${server.tools.length > 5 ? `
                <span class="tool-tag more">+${server.tools.length - 5} more</span>
              ` : ''}
            </div>
          </div>
        ` : ''}

        ${server.resources?.length ? `
          <div class="mcp-server-resources">
            <div class="mcp-server-section-label">Resources (${server.resources.length})</div>
            <div>
              ${server.resources.slice(0, 3).map(resource => `
                <span class="resource-tag">${escapeHtml(resource)}</span>
              `).join('')}
              ${server.resources.length > 3 ? `
                <span class="resource-tag more">+${server.resources.length - 3} more</span>
              ` : ''}
            </div>
          </div>
        ` : ''}

        ${server.description ? `
          <div class="mcp-server-description">${escapeHtml(server.description)}</div>
        ` : ''}

        <div class="mcp-server-meta">
          <div><span>Created</span><strong>${formatTime(server.createdAt)}</strong></div>
          ${server.lastUsed ? `<div><span>Last Used</span><strong>${formatTime(server.lastUsed)}</strong></div>` : ''}
        </div>

        <div class="mcp-server-actions">
          <button class="secondary-button edit-btn" data-id="${server.id}">Edit</button>
          <button class="${server.enabled ? 'secondary-button' : 'primary-button'} toggle-btn" data-id="${server.id}" data-enabled="${server.enabled}">${server.enabled ? 'Disable' : 'Enable'}</button>
          <button class="danger-button delete-btn" data-id="${server.id}">Delete</button>
        </div>
      `;

      const editBtn = card.querySelector('.edit-btn');
      editBtn.addEventListener('click', () => openMcpServerModal(server.id));

      const deleteBtn = card.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', () => confirmDeleteServer(server.id));

      const toggleBtn = card.querySelector('.toggle-btn');
      toggleBtn.addEventListener('click', () => toggleServer(server.id, server.enabled));

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  function openMcpServerModal(serverId = null) {
    const modal = document.getElementById(MODAL_ID);
    const form = document.getElementById(FORM_ID);
    const title = document.getElementById('modal-title');

    if (serverId) {
      const server = servers.find(s => s.id === serverId);
      if (!server) return;

      currentEditingServer = server;
      title.textContent = 'Edit MCP Server';

      document.getElementById('server-id').value = server.id;
      document.getElementById('server-name').value = server.name;
      document.getElementById('server-endpoint').value = server.endpoint;
      document.getElementById('server-tools').value = server.tools?.join('\n') || '';
      document.getElementById('server-resources').value = server.resources?.join('\n') || '';
      document.getElementById('server-description').value = server.description || '';
      document.getElementById('server-enabled').checked = server.enabled;
    } else {
      currentEditingServer = null;
      title.textContent = 'Add MCP Server';
      form.reset();
      document.getElementById('server-id').value = '';
    }

    modal.style.display = 'flex';
  }

  function closeMcpServerModal() {
    document.getElementById(MODAL_ID).style.display = 'none';
    currentEditingServer = null;
    document.getElementById(FORM_ID).reset();
  }

  async function confirmDeleteServer(serverId) {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    const modal = document.getElementById(DELETE_MODAL_ID);
    modal.style.display = 'flex';

    const confirmDelete = document.getElementById('confirm-delete-btn');
    const cancelDelete = document.getElementById('cancel-delete-btn');

    const cleanup = () => {
      modal.style.display = 'none';
      confirmDelete.removeEventListener('click', handleDelete);
      cancelDelete.removeEventListener('click', cleanup);
    };

    const handleDelete = async () => {
      try {
        reportStatus('Deleting server...', { type: 'loading' });
        const response = await fetchJSON(`/api/mcp-servers/${serverId}`, {
          method: 'DELETE'
        });

        servers = servers.filter(s => s.id !== serverId);
        renderMcpServersList();
        reportStatus('Server deleted successfully', { type: 'success' });
        cleanup();
      } catch (error) {
        reportStatus(`Failed to delete server: ${error.message}`, { type: 'error' });
        console.error('Error deleting server:', error);
        cleanup();
      }
    };

    confirmDelete.addEventListener('click', handleDelete);
    cancelDelete.addEventListener('click', cleanup);
  }

  async function toggleServer(serverId, currentlyEnabled) {
    try {
      const response = await fetchJSON(`/api/mcp-servers/${serverId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentlyEnabled })
      });

      const index = servers.findIndex(s => s.id === serverId);
      if (index !== -1) {
        servers[index] = { ...servers[index], enabled: !currentlyEnabled };
        renderMcpServersList();
        reportStatus('Server status updated', { type: 'success' });
      }
    } catch (error) {
      reportStatus(`Failed to update server: ${error.message}`, { type: 'error' });
      console.error('Error updating server:', error);
    }
  }

  function setupFormHandlers() {
    const modal = document.getElementById(MODAL_ID);
    const form = document.getElementById(FORM_ID);
    const saveBtn = document.getElementById('save-server-btn');
    const cancelBtn = document.getElementById('cancel-server-btn');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const serverData = {
        name: formData.get('name') || '',
        endpoint: formData.get('endpoint') || '',
        tools: formData.get('tools') || '',
        resources: formData.get('resources') || '',
        description: formData.get('description') || '',
        enabled: formData.get('enabled') === 'on'
      };

      if (!serverData.name || !serverData.endpoint) {
        reportStatus('Name and endpoint are required', { type: 'error' });
        return;
      }

      serverData.tools = serverData.tools ? serverData.tools.split('\n').filter(t => t.trim()).map(t => t.trim()) : [];
      serverData.resources = serverData.resources ? serverData.resources.split('\n').filter(r => r.trim()).map(r => r.trim()) : [];

      try {
        reportStatus(currentEditingServer ? 'Updating server...' : 'Adding server...', { type: 'loading' });

        const method = currentEditingServer ? 'PUT' : 'POST';
        const url = currentEditingServer ? `/api/mcp-servers/${currentEditingServer.id}` : '/api/mcp-servers';

        const response = await fetchJSON(url, {
          method,
          body: JSON.stringify(serverData)
        });

        if (currentEditingServer) {
          const index = servers.findIndex(s => s.id === currentEditingServer.id);
          if (index !== -1) {
            servers[index] = { ...servers[index], ...serverData, id: currentEditingServer.id };
          }
        } else {
          servers.push(response.server);
        }

        renderMcpServersList();
        closeMcpServerModal();
        reportStatus(
          `Server ${currentEditingServer ? 'updated' : 'added'} successfully`,
          { type: 'success' }
        );
      } catch (error) {
        reportStatus(`Failed to save server: ${error.message}`, { type: 'error' });
        console.error('Error saving server:', error);
      }
    });

    saveBtn.addEventListener('click', () => form.requestSubmit?.());

    cancelBtn.addEventListener('click', closeMcpServerModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeMcpServerModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById(MODAL_ID)?.style.display === 'flex') {
        closeMcpServerModal();
      }
    });
  }

  function setupModalButtons() {
    const addBtn = document.getElementById('add-mcp-server-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openMcpServerModal());
    }

    const closeServerModalBtn = document.getElementById('close-server-modal-btn');
    if (closeServerModalBtn) {
      closeServerModalBtn.addEventListener('click', closeMcpServerModal);
    }

    const deleteModal = document.getElementById(DELETE_MODAL_ID);
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => {
        deleteModal.style.display = 'none';
      });
    }

    const closeDeleteModalBtn = document.getElementById('close-delete-modal-btn');
    if (closeDeleteModalBtn) {
      closeDeleteModalBtn.addEventListener('click', () => cancelDeleteBtn?.click());
    }

    if (deleteModal) {
      deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
          deleteModal.style.display = 'none';
        }
      });
    }
  }

  function bind() {
    setupFormHandlers();
    setupModalButtons();

    const quickConnectActions = document.querySelectorAll('[data-mcp-action]');
    quickConnectActions.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.mcpAction;
        if (action === 'add-server') {
          openMcpServerModal();
        }
      });
    });
  }

  function refresh() {
    return loadMcpServers();
  }

  return {
    bind,
    load: loadMcpServers,
    render: renderMcpServersList,
    refresh,
  };
}