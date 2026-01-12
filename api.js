// ============================================
// CONFIGURATION
// ============================================
const API_BASE = 'http://localhost:3737';
const VALID_CATEGORIES = ['artist', 'character', 'copyright', 'general', 'meta'];

// ============================================
// CONNECTION STATUS
// ============================================
let connectionStatus = {
    isConnected: false,
    lastChecked: null,
    error: null,
    serverVersion: null
};

async function initializeConnection() {
    await checkConnection();

    // Set up periodic connection checks (every minute) & when returning to tab
    setInterval(checkConnection, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkConnection();
      }
    });
}

async function checkConnection() {
    const statusEl = document.getElementById('status-indicator');
    try {
      statusEl.className = 'status-indicator connecting';
      
      // Try to connect to server
      const response = await fetch(`${API_BASE}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000 // This would need proper timeout handling
      });
      
      if (response.ok) {
        const data = await response.json();
        connectionStatus.isConnected = true;
        connectionStatus.lastChecked = new Date();
        connectionStatus.serverVersion = data.version;
        connectionStatus.error = null;
        
        statusEl.className = 'status-indicator connected';
        showConnectionAlert('Connected to server', 'success');
        
        return true;
      } else {
      // TODO
        return true;
        //throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      return true;
      //connectionStatus.isConnected = false;
      //connectionStatus.error = error.message;
      
      // Check if it's a connection error or server error
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        statusEl.className = 'status-indicator disconnected';
        showConnectionAlert('Cannot connect to server. Make sure the server is running at ' + API_BASE, 'error');
      } else {
        statusEl.className = 'status-indicator error';
        showConnectionAlert('Server error: ' + error.message, 'warning');
      }
      
      return false;
    }
}

function showConnectionAlert(message, type = 'info') {
    // Remove existing alert
    const existing = document.getElementById('connection-alert');
    if (existing) existing.remove();
    
    // Create new alert
    const alert = document.createElement('div');
    alert.id = 'connection-alert';
    alert.className = `connection-alert ${type}`;
    alert.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:500;margin-bottom:4px;">${type === 'success' ? '✅ Connected' : type === 'error' ? '❌ Connection Error' : '⚠️ Warning'}</div>
        <div style="font-size:12px;opacity:0.9;">${escapeHtml(message)}</div>
      </div>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;font-size:18px;">×</button>
    `;
    
    document.body.appendChild(alert);
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        if (alert.parentElement) {
          alert.remove();
        }
      }, 3000);
    }
}

// ============================================
// API HELPERS
// ============================================
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
        });
        if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`API call failed: ${endpoint}`, error);
        throw error;
    }
}

async function loadConfig() {
    try {
        config = await apiCall('/api/config');
        renderAliases();
        renderExclusions();
        renderHierarchy();
        renderSuggestions();
    } catch (error) {
        showToast('Failed to load config - is the server running?', 'error');
    }
}

async function loadStats() {
    try {
        const stats = await apiCall('/api/stats');
        document.getElementById('stat-images').textContent = stats.imageCount || 0;
        document.getElementById('stat-tags').textContent = stats.uniqueTags || 0;
    } catch (error) {
        // Stats endpoint may not exist
    }
}

async function saveAliases() {
    try {
        await apiCall('/api/config/aliases', {
        method: 'PUT',
        body: JSON.stringify(config.aliases)
        });
        showToast('Aliases saved');
        updateAllCounts();
    } catch (error) {
        showToast('Failed to save aliases', 'error');
    }
}

async function saveExclusions() {
    try {
        await apiCall('/api/config/exclusions', {
        method: 'PUT',
        body: JSON.stringify(config.exclusions)
        });
        showToast('Exclusions saved');
        updateAllCounts();
    } catch (error) {
        showToast('Failed to save exclusions', 'error');
    }
}

async function saveHierarchy() {
    try {
      await apiCall('/api/config/hierarchy', {
        method: 'PUT',
        body: JSON.stringify(config.hierarchy)
      });
      showToast('Hierarchy saved');
      updateAllCounts();
    } catch (error) {
      showToast('Failed to save hierarchy', 'error');
    }
}

async function runAnalyzer() {
    showToast('Running tag analyzer...', 'info');
    try {
      const result = await apiCall('/api/config/analyze', { method: 'POST' });
      showToast(`Found ${result.newSuggestions?.aliases || 0} alias and ${result.newSuggestions?.garbage || 0} garbage suggestions`);
      await loadConfig();
      updateAllCounts();
    } catch (error) {
      showToast('Analyzer failed', 'error');
    }
}

async function saveCurrentImage() {
    if (!currentImageId || !currentImageData) return;

    try {
      await apiCall(`/api/staging/images/${encodeURIComponent(currentImageId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: currentImageData.tags,
          sourceUrl: document.getElementById('sidebar-source-url').value,
          poolId: document.getElementById('sidebar-pool-id').value || null,
          poolIndex: parseInt(document.getElementById('sidebar-pool-index').value) || null
        })
      });
      showToast('Image saved');
      
      const card = document.querySelector(`.image-card[data-id="${currentImageId}"]`);
      if (card) {
        const badge = card.querySelector('.tag-count-badge');
        if (badge) badge.textContent = `${currentImageData.tags.length} tags`;
      }
    } catch (error) {
      showToast('Failed to save image', 'error');
    }
}

async function deleteCurrentImage() {
    if (!currentImageId) return;
    if (!confirm('Delete this image from staging?')) return;

    try {
      await apiCall(`/api/staging/images/${encodeURIComponent(currentImageId)}`, {
        method: 'DELETE'
      });
      showToast('Image deleted');

      const card = document.querySelector(`.image-card[data-id="${currentImageId}"]`);
      if (card) card.remove();

      stagingImages = stagingImages.filter(img => img.id !== currentImageId);
      closeSidebar();
      updateAllCounts();
    } catch (error) {
      showToast('Failed to delete image', 'error');
    }
}

function generatePoolId() {
    const id = 'pool_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    document.getElementById('sidebar-pool-id').value = id;
}

async function showAutocompleteResults(input, dropdown, onSelect) {
    const query = input.value.trim();

    if (query.length < 2) {
      dropdown.classList.remove('visible');
      return;
    }

    try {
      const results = await apiCall(`/api/tags/search?q=${encodeURIComponent(query)}&limit=15`);

      if (!results || results.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-item" style="color:var(--text-muted);">No matches found</div>';
      } else {
        dropdown.innerHTML = results.map((tag, idx) => {
          const tagStr = tag.tag || tag;
          const { category, name } = parseTag(tagStr);
          return `
            <div class="autocomplete-item" data-tag="${escapeAttr(tagStr)}" data-index="${idx}">
              <span class="tag-name">${escapeHtml(name)}</span>
              <span class="category-badge category-${category}">${category}</span>
            </div>
          `;
        }).join('');

        dropdown.querySelectorAll('.autocomplete-item[data-tag]').forEach(item => {
          item.onclick = () => {
            const selectedTag = item.dataset.tag;
            if (onSelect) {
              onSelect(selectedTag);
            } else {
              input.value = selectedTag;
            }
            dropdown.classList.remove('visible');
          };
        });
      }

      dropdown.classList.add('visible');
      autocompleteSelectedIndex = -1;
    } catch (error) {
      console.error('Autocomplete error:', error);
    }
}

async function loadImages(reset = false) {
    if (imagesLoading) return;
    if (!imagesHasMore && !reset) return;

    if (reset) {
      imagesOffset = 0;
      stagingImages = [];
      imagesHasMore = true;
      document.getElementById('images-grid').innerHTML = '';
    }

    imagesLoading = true;
    document.getElementById('load-more-trigger').style.display = 'flex';

    try {
      const result = await apiCall(`/api/staging/images?limit=50&offset=${imagesOffset}`);
      stagingImages = stagingImages.concat(result.images || []);
      imagesHasMore = result.hasMore ?? false;
      imagesOffset += (result.images || []).length;
      renderImages(result.images || []);
      updateAllCounts();
    } catch (error) {
      showToast('Failed to load images', 'error');
    } finally {
      imagesLoading = false;
      document.getElementById('load-more-trigger').style.display = imagesHasMore ? 'flex' : 'none';
    }
}

async function selectImage(id) {
    document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.image-card[data-id="${id}"]`);
    if (card) card.classList.add('selected');

    try {
      currentImageId = id;
      currentImageData = await apiCall(`/api/staging/images/${encodeURIComponent(id)}`);

      document.getElementById('sidebar-image').src = 
        `${API_BASE}/api/staging/image/${encodeURIComponent(id)}`;
      document.getElementById('sidebar-source-url').value = currentImageData.sourceUrl || '';
      document.getElementById('sidebar-pool-id').value = currentImageData.poolId || '';
      document.getElementById('sidebar-pool-index').value = currentImageData.poolIndex ?? '';
      document.getElementById('sidebar-phash').value = currentImageData.phash || '';

      renderSidebarTags();
      document.getElementById('image-sidebar').classList.remove('hidden');
    } catch (error) {
      showToast('Failed to load image details', 'error');
    }
}