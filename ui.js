  // ============================================
  // STATE
  // ============================================
  let config = {
    aliases: {},        // { canonical: { category, variants: [fullTags] } }
    exclusions: { 
      blacklist: [],    // [fullTags with category prefix]
      whitelist: [] 
    },
    hierarchy: {},      // { tag: { category, implies: [] } }
    suggestions: { 
      aliases: [],
      garbage: [],
      lastRun: null 
    }
  };

  let stagingImages = [];
  let currentImageId = null;
  let currentImageData = null;
  let imagesOffset = 0;
  let imagesLoading = false;
  let imagesHasMore = true;

  let collapsedNodes = new Set();
  let autocompleteSelectedIndex = -1;
  let hierarchyFilter = '';
  let aliasesFilter = '';
  let blacklistFilter = '';
  let whitelistFilter = '';

  // ============================================
  // INITIALIZATION
  // ============================================
  document.addEventListener('DOMContentLoaded', async () => {
    // Initialize connection status
    await initializeConnection();
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Infinite scroll
    const scrollContainer = document.getElementById('images-scroll-container');
    scrollContainer.addEventListener('scroll', handleImageScroll);

    // Setup all autocomplete inputs
    setupAutocomplete('sidebar-tag-input', 'sidebar-tag-dropdown', handleSidebarTagSelect);
    setupAutocomplete('add-blacklist-input', 'blacklist-dropdown', addToBlacklistDirect);
    setupAutocomplete('add-whitelist-input', 'whitelist-dropdown', addToWhitelistDirect);
    setupAutocomplete('new-hierarchy-tag', 'hierarchy-tag-dropdown');
    setupAutocomplete('add-alias-input', 'add-alias-dropdown');
    setupAutocomplete('hierarchy-modal-tag', 'hierarchy-modal-dropdown');
    setupAutocomplete('global-search', 'global-search-dropdown', handleGlobalSearchSelect);

    // Add Enter key handlers for exclusion inputs
    document.getElementById('add-blacklist-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && autocompleteSelectedIndex < 0) {
        e.preventDefault();
        addToBlacklist();
      }
    });
    document.getElementById('add-whitelist-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && autocompleteSelectedIndex < 0) {
        e.preventDefault();
        addToWhitelist();
      }
    });
    
    // Add Enter key handler for hierarchy input
    document.getElementById('new-hierarchy-tag').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && autocompleteSelectedIndex < 0) {
        e.preventDefault();
        addRootTag();
      }
    });
    
    // Add Enter key handler for alias input
    document.getElementById('add-alias-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && autocompleteSelectedIndex < 0) {
        e.preventDefault();
        addAliasFromInput();
      }
    });

    // Load data
    await loadConfig();
    await loadImages();
    await loadStats();

    updateAllCounts();
  });



  function exportConfig() {
    const exportData = {
      aliases: config.aliases,
      exclusions: config.exclusions,
      hierarchy: config.hierarchy,
      exportedAt: new Date().toISOString()
    };
    downloadJSON(exportData, 'kyabooru-config.json');
    showToast('Config exported');
  }

  function toggleDropdown(id) {
    const dropdown = document.getElementById(id);
    const wasHidden = dropdown.classList.contains('hidden');
    
    document.querySelectorAll('.header-dropdown').forEach(d => d.classList.add('hidden'));
    
    if (wasHidden) {
      dropdown.classList.remove('hidden');
      setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
          if (!e.target.closest('.dropdown-container')) {
            dropdown.classList.add('hidden');
            document.removeEventListener('click', closeDropdown);
          }
        });
      }, 0);
    }
  }

  function importFullConfig() {
    pickJSONFile(async (data) => {
      if (data.aliases) config.aliases = data.aliases;
      if (data.exclusions) config.exclusions = data.exclusions;
      if (data.hierarchy) config.hierarchy = data.hierarchy;
      
      await Promise.all([
        saveAliases(),
        saveExclusions(), 
        saveHierarchy()
      ]);
      
      renderAliases();
      renderExclusions();
      renderHierarchy();
      updateAllCounts();
      showToast('Full config imported');
    });
  }

  function importHierarchyOnly() {
    pickJSONFile(async (data) => {
      const hierarchyData = data.hierarchy || data;
      const firstValue = Object.values(hierarchyData)[0];
      if (firstValue && typeof firstValue === 'object' && 
          (firstValue.hasOwnProperty('category') || firstValue.hasOwnProperty('implies'))) {
        config.hierarchy = hierarchyData;
        await saveHierarchy();
        renderHierarchy();
        updateAllCounts();
        showToast(`Imported ${Object.keys(hierarchyData).length} hierarchy entries`);
      } else {
        showToast('Invalid hierarchy format', 'error');
      }
    });
  }

  function importAliasesOnly() {
    pickJSONFile(async (data) => {
      const aliasData = data.aliases || data;
      config.aliases = aliasData;
      await saveAliases();
      renderAliases();
      updateAllCounts();
      showToast(`Imported ${Object.keys(aliasData).length} alias groups`);
    });
  }

  function importExclusionsOnly() {
    pickJSONFile(async (data) => {
      const exclusionData = data.exclusions || data;
      if (exclusionData.blacklist || exclusionData.whitelist) {
        config.exclusions = exclusionData;
        await saveExclusions();
        renderExclusions();
        updateAllCounts();
        showToast('Exclusions imported');
      } else {
        showToast('Invalid exclusions format', 'error');
      }
    });
  }

  function pickJSONFile(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          callback(data);
        } catch (err) {
          showToast('Invalid JSON file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ============================================
  // TAB MANAGEMENT
  // ============================================
  function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  }

  function updateAllCounts() {
    document.getElementById('tab-images-count').textContent = stagingImages.length || '...';
    document.getElementById('tab-aliases-count').textContent = Object.keys(config.aliases).length;
    document.getElementById('tab-exclusions-count').textContent = 
      (config.exclusions?.blacklist?.length || 0) + (config.exclusions?.whitelist?.length || 0);
    document.getElementById('tab-hierarchy-count').textContent = Object.keys(config.hierarchy).length;

    document.getElementById('stat-aliases').textContent = Object.keys(config.aliases).length;
    document.getElementById('stat-blacklist').textContent = config.exclusions?.blacklist?.length || 0;
    
    const suggestionCount = (config.suggestions?.aliases?.length || 0) + 
                            (config.suggestions?.garbage?.length || 0);
    document.getElementById('stat-suggestions').textContent = suggestionCount;
  }

  // ============================================
  // IMAGES TAB
  // ============================================
  function renderImages(newImages) {
    const grid = document.getElementById('images-grid');
    
    newImages.forEach(img => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.dataset.id = img.id;
      card.onclick = () => selectImage(img.id);

      card.innerHTML = `
        <img src="${API_BASE}/api/staging/thumbnail/${encodeURIComponent(img.id)}?size=200" 
              alt="${escapeHtml(img.filename || '')}" loading="lazy"
              onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231a1a2e%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2212%22>No Image</text></svg>'">
        <span class="tag-count-badge">${img.tagCount || 0} tags</span>
        ${img.poolId ? '<span class="pool-badge">Pool</span>' : ''}
      `;

      grid.appendChild(card);
    });
  }

  function handleImageScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      loadImages();
    }
  }

  function closeSidebar() {
    document.getElementById('image-sidebar').classList.add('hidden');
    document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    currentImageId = null;
    currentImageData = null;
  }

  function renderSidebarTags() {
    const container = document.getElementById('sidebar-tags');
    container.innerHTML = '';

    (currentImageData?.tags || []).forEach(tag => {
      const { category, name } = parseTag(tag);
      const pill = createTagPill(tag, category, name, {
        onRemove: () => removeTagFromCurrent(tag),
        onCategoryChange: (newCat) => changeImageTagCategory(tag, name, newCat)
      });
      container.appendChild(pill);
    });
  }

  function handleSidebarTagSelect(tag) {
    if (!currentImageData) return;
    if (!currentImageData.tags.includes(tag)) {
      currentImageData.tags.push(tag);
      renderSidebarTags();
    }
    document.getElementById('sidebar-tag-input').value = '';
  }

  function removeTagFromCurrent(tag) {
    if (!currentImageData) return;
    currentImageData.tags = currentImageData.tags.filter(t => t !== tag);
    renderSidebarTags();
  }

  function changeImageTagCategory(oldTag, name, newCategory) {
    if (!currentImageData) return;
    const newTag = newCategory === 'general' ? name : `${newCategory}:${name}`;
    const idx = currentImageData.tags.indexOf(oldTag);
    if (idx !== -1) {
      currentImageData.tags[idx] = newTag;
    }
    renderSidebarTags();
  }

  // ============================================
  // ALIASES TAB
  // ============================================
  function renderAliases() {
    const container = document.getElementById('aliases-list');
    const emptyState = document.getElementById('aliases-empty');
    container.innerHTML = '';

    let aliases = Object.entries(config.aliases || {});
    
    // Apply filter
    if (aliasesFilter) {
      const filter = aliasesFilter.toLowerCase();
      aliases = aliases.filter(([canonical, data]) => {
        if (canonical.toLowerCase().includes(filter)) return true;
        if (data.variants?.some(v => v.toLowerCase().includes(filter))) return true;
        return false;
      });
    }

    if (aliases.length === 0 && !aliasesFilter) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    aliases.forEach(([canonicalKey, data]) => {
      const { category: canonicalCat, name: canonicalName } = parseTag(canonicalKey);
      const effectiveCategory = data.category || canonicalCat || 'general';
      
      const card = document.createElement('div');
      card.className = 'alias-card';
      card.dataset.canonical = canonicalKey;
      
      // Canonical section
      const canonicalSection = document.createElement('div');
      canonicalSection.className = 'alias-canonical';
      canonicalSection.innerHTML = `<div class="alias-canonical-label">Canonical</div>`;
      
      const canonicalPill = createTagPill(canonicalKey, effectiveCategory, canonicalName, {
        onRemove: () => removeAliasGroup(canonicalKey),
        onCategoryChange: (newCat) => changeAliasCanonicalCategory(canonicalKey, newCat),
        onEdit: (newFullTag) => renameAliasCanonical(canonicalKey, newFullTag),
        showEdit: true
      });
      canonicalSection.appendChild(canonicalPill);
      card.appendChild(canonicalSection);

      // Variants section
      const variantsSection = document.createElement('div');
      variantsSection.className = 'alias-variants';
      variantsSection.innerHTML = `<div class="alias-variants-label">Variants (${(data.variants || []).length})</div>`;
      
      const variantsList = document.createElement('div');
      variantsList.className = 'alias-variants-list';
      
      // Add variant input at the start of the list
      const variantInputWrapper = document.createElement('div');
      variantInputWrapper.className = 'autocomplete-wrapper variant-input-inline';
      variantInputWrapper.innerHTML = `
        <input type="text" id="add-var-${escapeAttr(canonicalKey)}" placeholder="Add variant...">
        <div class="autocomplete-dropdown" id="add-var-dropdown-${escapeAttr(canonicalKey)}"></div>
      `;
      variantsList.appendChild(variantInputWrapper);
      
      (data.variants || []).forEach(v => {
        const { category: vCat, name: vName } = parseTag(v);
        const pill = createTagPill(v, vCat || 'general', vName, {
          onRemove: () => removeVariant(canonicalKey, v),
          onCategoryChange: (newCat) => changeVariantCategory(canonicalKey, v, newCat)
        });
        variantsList.appendChild(pill);
      });
      
      variantsSection.appendChild(variantsList);
      card.appendChild(variantsSection);

      container.appendChild(card);

      // Setup autocomplete for this card's variant input
      const variantInputId = `add-var-${canonicalKey}`;
      setupAutocomplete(
        variantInputId, 
        `add-var-dropdown-${canonicalKey}`,
        (tag) => addVariantToAliasDirect(canonicalKey, tag)
      );
      
      // Add Enter key handler for variant input
      const variantInput = document.getElementById(variantInputId);
      if (variantInput) {
        variantInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && autocompleteSelectedIndex < 0) {
            e.preventDefault();
            addVariantToAlias(canonicalKey);
          }
        });
      }
    });
  }

  function filterAliases() {
    aliasesFilter = document.getElementById('aliases-filter').value;
    renderAliases();
  }

  function renderSuggestions() {
    // Alias suggestions
    const aliasSection = document.getElementById('alias-suggestions-section');
    const aliasSuggestions = config.suggestions?.aliases || [];
    
    if (aliasSuggestions.length > 0) {
      aliasSection.style.display = 'block';
      document.getElementById('alias-suggestions').innerHTML = aliasSuggestions.map((s, idx) => `
        <div class="card suggestion">
          <div class="card-header">
            <div>
              <div class="card-title">${escapeHtml(s.canonical)}</div>
              <div class="card-meta">${s.variants?.length || 0} variants · ${Math.round((s.confidence || 0) * 100)}% confidence</div>
            </div>
            <div class="card-actions">
              <button class="btn btn-small btn-success" onclick="acceptAliasSuggestion(${idx})">Accept</button>
              <button class="btn btn-small btn-ghost" onclick="dismissAliasSuggestion(${idx})">Dismiss</button>
            </div>
          </div>
          <div class="alias-variants-list">
            ${(s.variants || []).map(v => {
              const { category, name } = parseTag(v);
              return `<span class="tag-pill tag-${category}">${escapeHtml(name)}</span>`;
            }).join('')}
          </div>
        </div>
      `).join('');
    } else {
      aliasSection.style.display = 'none';
    }

    // Garbage suggestions
    const garbageSection = document.getElementById('garbage-suggestions-section');
    const garbageSuggestions = config.suggestions?.garbage || [];

    if (garbageSuggestions.length > 0) {
      garbageSection.style.display = 'block';
      document.getElementById('garbage-suggestions').innerHTML = garbageSuggestions.map((s, idx) => {
        const { category, name } = parseTag(s.tag);
        return `
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span class="tag-pill tag-${category}">${escapeHtml(name)}</span>
            <span style="color:var(--text-muted); font-size:11px;">${escapeHtml(s.reason || '')}</span>
            <div style="margin-left:auto; display:flex; gap:6px;">
              <button class="btn btn-small btn-danger" onclick="acceptGarbageSuggestion(${idx})">Blacklist</button>
              <button class="btn btn-small btn-ghost" onclick="dismissGarbageSuggestion(${idx})">Dismiss</button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      garbageSection.style.display = 'none';
    }
  }

  function acceptAliasSuggestion(idx) {
    const suggestion = config.suggestions.aliases[idx];
    if (!suggestion) return;

    const { category } = parseTag(suggestion.canonical);
    config.aliases[suggestion.canonical] = {
      category: suggestion.category || category || 'general',
      variants: suggestion.variants || []
    };
    config.suggestions.aliases.splice(idx, 1);

    saveAliases();
    renderAliases();
    renderSuggestions();
  }

  function dismissAliasSuggestion(idx) {
    config.suggestions.aliases.splice(idx, 1);
    renderSuggestions();
    updateAllCounts();
  }

  function acceptGarbageSuggestion(idx) {
    const suggestion = config.suggestions.garbage[idx];
    if (!suggestion) return;

    if (!config.exclusions.blacklist.includes(suggestion.tag)) {
      config.exclusions.blacklist.push(suggestion.tag);
    }
    config.suggestions.garbage.splice(idx, 1);

    saveExclusions();
    renderExclusions();
    renderSuggestions();
  }

  function dismissGarbageSuggestion(idx) {
    config.suggestions.garbage.splice(idx, 1);
    renderSuggestions();
    updateAllCounts();
  }

  function addAliasFromInput() {
    const rawInput = document.getElementById('add-alias-input').value.trim();

    if (!rawInput) {
      return;
    }

    const { category, name } = parseTag(rawInput);
    const canonicalKey = normalizeTagName(name);

    if (!canonicalKey) {
      showToast('Enter a valid tag name', 'error');
      return;
    }

    if (config.aliases[canonicalKey]) {
      showToast('Alias group already exists', 'error');
      return;
    }

    config.aliases[canonicalKey] = {
      category,
      variants: []
    };

    saveAliases();
    renderAliases();
    document.getElementById('add-alias-input').value = '';
  }

  function removeAliasGroup(canonical) {
    if (!confirm(`Remove alias group "${canonical}"?`)) return;
    delete config.aliases[canonical];
    saveAliases();
    renderAliases();
  }

  function changeAliasCanonicalCategory(canonical, newCategory) {
    if (!config.aliases[canonical]) return;
    
    const { name } = parseTag(canonical);
    const newKey = newCategory === 'general' ? name : `${newCategory}:${name}`;
    
    if (newKey !== canonical) {
      config.aliases[newKey] = { ...config.aliases[canonical], category: newCategory };
      delete config.aliases[canonical];
    } else {
      config.aliases[canonical].category = newCategory;
    }
    
    saveAliases();
    renderAliases();
  }

  function renameAliasCanonical(oldCanonical, newFullTag) {
    if (!config.aliases[oldCanonical]) return;
    
    const { category, name } = parseTag(newFullTag);
    const normalizedNew = normalizeTagName(newFullTag);
    
    if (normalizedNew === oldCanonical) return;
    
    config.aliases[normalizedNew] = {
      ...config.aliases[oldCanonical],
      category: VALID_CATEGORIES.includes(category) ? category : config.aliases[oldCanonical].category
    };
    delete config.aliases[oldCanonical];
    
    saveAliases();
    renderAliases();
  }

  function addVariantToAlias(canonical) {
    const input = document.getElementById(`add-var-${canonical}`);
    if (!input) return;
    addVariantToAliasDirect(canonical, input.value);
    input.value = '';
    input.focus();
  }

  function addVariantToAliasDirect(canonical, tag) {
    if (!config.aliases[canonical]) return;
    
    const normalizedTag = normalizeTagName(tag);
    if (!normalizedTag) return;
    
    if (!config.aliases[canonical].variants.includes(normalizedTag)) {
      config.aliases[canonical].variants.push(normalizedTag);
      saveAliases();
      renderAliases();
    }
    
    const input = document.getElementById(`add-var-${canonical}`);
    if (input) {
        input.value = '';
        input.focus();
    }
  }

  function removeVariant(canonical, variant) {
    if (!config.aliases[canonical]) return;
    config.aliases[canonical].variants = config.aliases[canonical].variants.filter(v => v !== variant);
    saveAliases();
    renderAliases();
  }

  function changeVariantCategory(canonical, oldVariant, newCategory) {
    if (!config.aliases[canonical]) return;
    
    const { name } = parseTag(oldVariant);
    const newVariant = newCategory === 'general' ? name : `${newCategory}:${name}`;
    
    const idx = config.aliases[canonical].variants.indexOf(oldVariant);
    if (idx !== -1) {
      config.aliases[canonical].variants[idx] = newVariant;
      saveAliases();
      renderAliases();
    }
  }

  // ============================================
  // EXCLUSIONS TAB
  // ============================================
  function renderExclusions() {
    renderBlacklist();
    renderWhitelist();
  }

  function renderBlacklist() {
    const container = document.getElementById('blacklist-items');
    let items = config.exclusions?.blacklist || [];
    
    if (blacklistFilter) {
      const filter = blacklistFilter.toLowerCase();
      items = items.filter(t => t.toLowerCase().includes(filter));
    }
    
    if (items.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;width:100%;">No blacklisted tags</div>';
      return;
    }
    
    container.innerHTML = '';
    items.forEach(tag => {
      const { category, name } = parseTag(tag);
      const pill = createTagPill(tag, category, name, {
        onRemove: () => removeFromBlacklist(tag),
        onCategoryChange: (newCat) => changeBlacklistCategory(tag, newCat),
        onSwap: () => moveToWhitelist(tag),
        swapDirection: 'right'
      });
      container.appendChild(pill);
    });
  }

  function renderWhitelist() {
    const container = document.getElementById('whitelist-items');
    let items = config.exclusions?.whitelist || [];
    
    if (whitelistFilter) {
      const filter = whitelistFilter.toLowerCase();
      items = items.filter(t => t.toLowerCase().includes(filter));
    }
    
    if (items.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;width:100%;">No whitelisted tags</div>';
      return;
    }
    
    container.innerHTML = '';
    items.forEach(tag => {
      const { category, name } = parseTag(tag);
      const pill = createTagPill(tag, category, name, {
        onRemove: () => removeFromWhitelist(tag),
        onCategoryChange: (newCat) => changeWhitelistCategory(tag, newCat),
        onSwap: () => moveToBlacklist(tag),
        swapDirection: 'left'
      });
      container.appendChild(pill);
    });
  }

  function filterBlacklist() {
    blacklistFilter = document.getElementById('blacklist-filter').value;
    renderBlacklist();
  }

  function filterWhitelist() {
    whitelistFilter = document.getElementById('whitelist-filter').value;
    renderWhitelist();
  }

  function addToBlacklist() {
    const input = document.getElementById('add-blacklist-input');
    addToBlacklistDirect(input.value);
    input.value = '';
  }

  function addToBlacklistDirect(tag) {
    const normalizedTag = normalizeTagName(tag);
    if (!normalizedTag) return;

    if (!config.exclusions.blacklist) config.exclusions.blacklist = [];
    if (!config.exclusions.blacklist.includes(normalizedTag)) {
      config.exclusions.blacklist.push(normalizedTag);
      saveExclusions();
      renderExclusions();
    }
    document.getElementById('add-blacklist-input').value = '';
  }

  function removeFromBlacklist(tag) {
    config.exclusions.blacklist = config.exclusions.blacklist.filter(t => t !== tag);
    saveExclusions();
    renderExclusions();
  }

  function changeBlacklistCategory(oldTag, newCategory) {
    const { name } = parseTag(oldTag);
    const newTag = newCategory === 'general' ? name : `${newCategory}:${name}`;
    
    const idx = config.exclusions.blacklist.indexOf(oldTag);
    if (idx !== -1) {
      config.exclusions.blacklist[idx] = newTag;
      saveExclusions();
      renderExclusions();
    }
  }

  function addToWhitelist() {
    const input = document.getElementById('add-whitelist-input');
    addToWhitelistDirect(input.value);
    input.value = '';
  }

  function addToWhitelistDirect(tag) {
    const normalizedTag = normalizeTagName(tag);
    if (!normalizedTag) return;

    if (!config.exclusions.whitelist) config.exclusions.whitelist = [];
    if (!config.exclusions.whitelist.includes(normalizedTag)) {
      config.exclusions.whitelist.push(normalizedTag);
      saveExclusions();
      renderExclusions();
    }
    document.getElementById('add-whitelist-input').value = '';
  }

  function removeFromWhitelist(tag) {
    config.exclusions.whitelist = config.exclusions.whitelist.filter(t => t !== tag);
    saveExclusions();
    renderExclusions();
  }

  function changeWhitelistCategory(oldTag, newCategory) {
    const { name } = parseTag(oldTag);
    const newTag = newCategory === 'general' ? name : `${newCategory}:${name}`;
    
    const idx = config.exclusions.whitelist.indexOf(oldTag);
    if (idx !== -1) {
      config.exclusions.whitelist[idx] = newTag;
      saveExclusions();
      renderExclusions();
    }
  }

  function moveToWhitelist(tag) {
    // Remove from blacklist
    config.exclusions.blacklist = config.exclusions.blacklist.filter(t => t !== tag);
    // Add to whitelist if not already there
    if (!config.exclusions.whitelist) config.exclusions.whitelist = [];
    if (!config.exclusions.whitelist.includes(tag)) {
      config.exclusions.whitelist.push(tag);
    }
    saveExclusions();
    renderExclusions();
  }

  function moveToBlacklist(tag) {
    // Remove from whitelist
    config.exclusions.whitelist = config.exclusions.whitelist.filter(t => t !== tag);
    // Add to blacklist if not already there
    if (!config.exclusions.blacklist) config.exclusions.blacklist = [];
    if (!config.exclusions.blacklist.includes(tag)) {
      config.exclusions.blacklist.push(tag);
    }
    saveExclusions();
    renderExclusions();
  }

  // ============================================
  // HIERARCHY TAB
  // ============================================
  function renderHierarchy() {
    const container = document.getElementById('hierarchy-tree');
    const emptyState = document.getElementById('hierarchy-empty');
    container.innerHTML = '';

    const hierarchyEntries = Object.entries(config.hierarchy || {});

    if (hierarchyEntries.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    // Build tree structure
    const rootTags = [];
    const childrenMap = {};

    hierarchyEntries.forEach(([tag, data]) => {
      const implies = data.implies || [];
      if (implies.length === 0) {
        rootTags.push(tag);
      } else {
        implies.forEach(parent => {
          if (!childrenMap[parent]) childrenMap[parent] = [];
          childrenMap[parent].push(tag);
        });
      }
    });

    // Filter check
    const matchesFilter = (tag) => {
      if (!hierarchyFilter) return true;
      return tag.toLowerCase().includes(hierarchyFilter.toLowerCase());
    };

    const hasMatchingDescendant = (tag) => {
      if (matchesFilter(tag)) return true;
      const children = childrenMap[tag] || [];
      return children.some(child => hasMatchingDescendant(child));
    };

    // Render tree recursively
    function renderNode(tag, depth = 0) {
      const data = config.hierarchy[tag] || {};
      const children = (childrenMap[tag] || []).filter(c => hasMatchingDescendant(c));
      const hasChildren = children.length > 0;
      const isCollapsed = collapsedNodes.has(tag);
      const matches = matchesFilter(tag);

      const nodeEl = document.createElement('div');
      nodeEl.style.opacity = matches ? '1' : '0.5';
      
      nodeEl.innerHTML = `
        <div class="hierarchy-node" 
              draggable="true"
              ondragstart="handleDragStart(event, '${escapeAttr(tag)}')"
              ondragover="handleDragOver(event)"
              ondragleave="handleDragLeave(event)"
              ondrop="handleDrop(event, '${escapeAttr(tag)}')">
          <span class="hierarchy-toggle ${isCollapsed ? 'collapsed' : ''} ${!hasChildren ? 'no-children' : ''}"
                onclick="toggleHierarchyNode('${escapeAttr(tag)}')">▼</span>
          <span class="category-badge category-${data.category || 'general'}" 
                onclick="showHierarchyCategoryDropdown(event, '${escapeAttr(tag)}')">${data.category || 'general'}</span>
          <span class="hierarchy-node-name" onclick="startHierarchyTagEdit(event, '${escapeAttr(tag)}')">${escapeHtml(tag)}</span>
          <div class="hierarchy-node-actions">
            <button onclick="addHierarchyChild('${escapeAttr(tag)}')">+ Child</button>
            <button onclick="addHierarchyParent('${escapeAttr(tag)}')">+ Parent</button>
            <button onclick="removeHierarchyNode('${escapeAttr(tag)}')">×</button>
          </div>
        </div>
        <div class="hierarchy-children ${isCollapsed ? 'collapsed' : ''}" id="children-${escapeAttr(tag)}"></div>
      `;

      if (hasChildren) {
        const childrenContainer = nodeEl.querySelector('.hierarchy-children');
        children.sort().forEach(child => {
          childrenContainer.appendChild(renderNode(child, depth + 1));
        });
      }

      return nodeEl;
    }

    const visibleRoots = rootTags.filter(tag => hasMatchingDescendant(tag));
    visibleRoots.sort().forEach(tag => {
      container.appendChild(renderNode(tag));
    });
  }

  function filterHierarchy() {
    hierarchyFilter = document.getElementById('hierarchy-filter').value;
    renderHierarchy();
  }

  function startHierarchyTagEdit(event, tag) {
    event.stopPropagation();
    const nameSpan = event.target;
    const originalTag = tag;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = tag;
    input.className = 'hierarchy-edit-input';
    
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishHierarchyTagEdit(originalTag, input.value);
      } else if (e.key === 'Escape') {
        renderHierarchy();
      }
    };
    
    input.onblur = () => {
      finishHierarchyTagEdit(originalTag, input.value);
    };
    
    nameSpan.innerHTML = '';
    nameSpan.appendChild(input);
    input.focus();
    input.select();
  }

  function finishHierarchyTagEdit(oldTag, newTag) {
    newTag = normalizeTagName(newTag);
    
    if (!newTag || newTag === oldTag) {
      renderHierarchy();
      return;
    }
    
    if (config.hierarchy[newTag] && newTag !== oldTag) {
      showToast('Tag already exists in hierarchy', 'error');
      renderHierarchy();
      return;
    }
    
    // Update the tag
    config.hierarchy[newTag] = config.hierarchy[oldTag];
    delete config.hierarchy[oldTag];
    
    // Update any children that reference this tag
    Object.values(config.hierarchy).forEach(data => {
      if (data.implies) {
        data.implies = data.implies.map(i => i === oldTag ? newTag : i);
      }
    });
    
    saveHierarchy();
    renderHierarchy();
  }

  function showHierarchyCategoryDropdown(event, tag) {
    event.stopPropagation();
    showCategoryDropdown(event.target, (newCategory) => {
      config.hierarchy[tag].category = newCategory;
      saveHierarchy();
      renderHierarchy();
    });
  }

  function toggleHierarchyNode(tag) {
    if (collapsedNodes.has(tag)) {
      collapsedNodes.delete(tag);
    } else {
      collapsedNodes.add(tag);
    }
    renderHierarchy();
  }

  function expandAllHierarchy() {
    collapsedNodes.clear();
    renderHierarchy();
  }

  function collapseAllHierarchy() {
    Object.keys(config.hierarchy).forEach(tag => collapsedNodes.add(tag));
    renderHierarchy();
  }

  function addRootTag() {
    const rawInput = document.getElementById('new-hierarchy-tag').value.trim();
    
    if (!rawInput) {
      showToast('Enter a tag name', 'error');
      return;
    }
    
    // Parse category:tag format
    const { category, name } = parseTag(rawInput);
    const tag = normalizeTagName(name);
    
    if (!tag) {
      showToast('Enter a valid tag name', 'error');
      return;
    }

    if (config.hierarchy[tag]) {
      showToast('Tag already in hierarchy', 'error');
      return;
    }

    config.hierarchy[tag] = { category, implies: [] };
    saveHierarchy();
    renderHierarchy();
    document.getElementById('new-hierarchy-tag').value = '';
  }

  function addHierarchyChild(parentTag) {
    document.getElementById('hierarchy-modal-title').textContent = `Add Child Under "${parentTag}"`;
    document.getElementById('hierarchy-modal-tag').value = '';
    
    // Pre-fill with parent's category as hint
    const parentCategory = config.hierarchy[parentTag]?.category || 'general';
    document.getElementById('hierarchy-modal-tag').placeholder = `e.g. ${parentCategory}:tag_name`;

    const submitBtn = document.getElementById('hierarchy-modal-submit');
    submitBtn.textContent = 'Add Child';
    submitBtn.onclick = () => {
      const rawInput = document.getElementById('hierarchy-modal-tag').value.trim();

      if (!rawInput) {
        showToast('Enter a tag name', 'error');
        return;
      }
      
      // Parse category:tag format, default to parent's category if not specified
      let { category, name } = parseTag(rawInput);
      const tag = normalizeTagName(name);
      
      // If no category was specified (parseTag returns 'general' for no prefix), 
      // inherit from parent
      if (!rawInput.includes(':')) {
        category = parentCategory;
      }

      if (!tag) {
        showToast('Enter a valid tag name', 'error');
        return;
      }

      config.hierarchy[tag] = { category, implies: [parentTag] };
      collapsedNodes.delete(parentTag);

      saveHierarchy();
      renderHierarchy();
      closeModal('hierarchy-modal');
    };

    document.getElementById('hierarchy-modal').classList.remove('hidden');
  }

  function addHierarchyParent(childTag) {
    document.getElementById('hierarchy-modal-title').textContent = `Add Parent Above "${childTag}"`;
    document.getElementById('hierarchy-modal-tag').value = '';
    
    // Pre-fill with child's category as hint
    const childCategory = config.hierarchy[childTag]?.category || 'general';
    document.getElementById('hierarchy-modal-tag').placeholder = `e.g. ${childCategory}:tag_name`;

    const submitBtn = document.getElementById('hierarchy-modal-submit');
    submitBtn.textContent = 'Add Parent';
    submitBtn.onclick = () => {
      const rawInput = document.getElementById('hierarchy-modal-tag').value.trim();

      if (!rawInput) {
        showToast('Enter a tag name', 'error');
        return;
      }
      
      // Parse category:tag format, default to child's category if not specified
      let { category, name } = parseTag(rawInput);
      const newParentTag = normalizeTagName(name);
      
      // If no category was specified, inherit from child
      if (!rawInput.includes(':')) {
        category = childCategory;
      }

      if (!newParentTag) {
        showToast('Enter a valid tag name', 'error');
        return;
      }

      const childData = config.hierarchy[childTag];
      const oldParents = childData?.implies || [];

      config.hierarchy[newParentTag] = { category, implies: [...oldParents] };
      config.hierarchy[childTag].implies = [newParentTag];

      saveHierarchy();
      renderHierarchy();
      closeModal('hierarchy-modal');
    };

    document.getElementById('hierarchy-modal').classList.remove('hidden');
  }

  function removeHierarchyNode(tag) {
    if (!confirm(`Remove "${tag}" from hierarchy?`)) return;

    const data = config.hierarchy[tag];
    const parents = data?.implies || [];

    Object.entries(config.hierarchy).forEach(([t, d]) => {
      if (d.implies && d.implies.includes(tag)) {
        d.implies = [...new Set(d.implies.filter(i => i !== tag).concat(parents))];
      }
    });

    delete config.hierarchy[tag];
    saveHierarchy();
    renderHierarchy();
  }

  // Drag and drop
  let draggedTag = null;

  function handleDragStart(event, tag) {
    draggedTag = tag;
    event.dataTransfer.effectAllowed = 'move';
    event.target.style.opacity = '0.5';
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }

  function handleDrop(event, targetTag) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    event.currentTarget.style.opacity = '1';

    if (!draggedTag || draggedTag === targetTag) return;

    if (isAncestor(draggedTag, targetTag)) {
      showToast('Cannot drop parent onto its child', 'error');
      return;
    }

    config.hierarchy[draggedTag].implies = [targetTag];
    saveHierarchy();
    renderHierarchy();

    draggedTag = null;
  }

  function isAncestor(potentialAncestor, tag) {
    const data = config.hierarchy[tag];
    if (!data?.implies) return false;

    for (const parent of data.implies) {
      if (parent === potentialAncestor) return true;
      if (isAncestor(potentialAncestor, parent)) return true;
    }
    return false;
  }

  // ============================================
  // TAG PILL COMPONENT
  // ============================================
  function createTagPill(fullTag, category, name, options = {}) {
    const { onRemove, onCategoryChange, onEdit, showEdit = false, onSwap, swapDirection } = options;
    
    const pill = document.createElement('span');
    pill.className = `tag-pill tag-${category}`;
    pill.dataset.tag = fullTag;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-name';
    nameSpan.textContent = name;
    nameSpan.onclick = (e) => {
      e.stopPropagation();
      if (onCategoryChange) {
        showCategoryDropdown(pill, onCategoryChange);
      }
    };
    
    // Double-click to edit (replaces pencil icon)
    if (showEdit && onEdit) {
      nameSpan.ondblclick = (e) => {
        e.stopPropagation();
        startPillEdit(pill, fullTag, onEdit);
      };
      nameSpan.title = 'Double-click to edit';
      nameSpan.style.cursor = 'text';
    }
    
    pill.appendChild(nameSpan);
    
    // For blacklist (right arrow): swap then X
    // For whitelist (left arrow): X then swap
    
    const swapBtn = onSwap ? document.createElement('span') : null;
    if (swapBtn) {
      swapBtn.className = 'tag-swap';
      swapBtn.textContent = '⇆';
      swapBtn.title = swapDirection === 'right' ? 'Move to whitelist' : 'Move to blacklist';
      swapBtn.onclick = (e) => {
        e.stopPropagation();
        onSwap();
      };
    }
    
    const removeBtn = onRemove ? document.createElement('span') : null;
    if (removeBtn) {
      removeBtn.className = 'tag-remove';
      removeBtn.textContent = '×';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        onRemove();
      };
    }
    if (swapBtn || removeBtn) {
      const buttonContainer = document.createElement('span');
      buttonContainer.style.display = 'flex';
      buttonContainer.style.alignItems = 'center';
      buttonContainer.style.marginLeft = '10px'; // Small space between tag name and buttons
      
      // Add swap button first (to the left)
      if (swapBtn) {
        buttonContainer.appendChild(swapBtn);
        // Add a small margin between arrow and X when both exist
        if (removeBtn) {
          swapBtn.style.marginRight = '10px';
        }
      }
      
      // Add remove button second (to the right)
      if (removeBtn) {
        buttonContainer.appendChild(removeBtn);
      }
      
      pill.appendChild(buttonContainer);
    }
    return pill;
  }

  function startPillEdit(pill, currentFullTag, onSave) {
    const nameSpan = pill.querySelector('.tag-name');
    const removeBtn = pill.querySelector('.tag-remove');
    
    if (removeBtn) removeBtn.style.display = 'none';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-inline-edit';
    input.value = currentFullTag;
    
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSave(input.value);
      } else if (e.key === 'Escape') {
        // Restore original
        nameSpan.textContent = parseTag(currentFullTag).name;
        nameSpan.style.display = '';
        input.remove();
        if (removeBtn) removeBtn.style.display = '';
      }
    };
    
    input.onblur = () => {
      onSave(input.value);
    };
    
    nameSpan.style.display = 'none';
    pill.insertBefore(input, nameSpan.nextSibling);
    input.focus();
    input.select();
  }

  let currentDropdownTarget = null;
  
  function showCategoryDropdown(targetEl, onSelect) {
    // Remove existing dropdown
    const existing = document.querySelector('.category-dropdown');
    if (existing) {
      const wasOpen = currentDropdownTarget === targetEl;
      existing.remove();
      currentDropdownTarget = null;
      // If clicking same element, just close (toggle off)
      if (wasOpen) return;
    }
    
    const rect = targetEl.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'category-dropdown';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    VALID_CATEGORIES.forEach(cat => {
      const item = document.createElement('div');
      item.className = 'category-dropdown-item';
      item.innerHTML = `<span class="category-badge category-${cat}">${cat}</span>`;
      item.onclick = (e) => {
        e.stopPropagation();
        onSelect(cat);
        dropdown.remove();
        currentDropdownTarget = null;
      };
      dropdown.appendChild(item);
    });
    
    document.body.appendChild(dropdown);
    currentDropdownTarget = targetEl;
    
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && e.target !== targetEl) {
          dropdown.remove();
          currentDropdownTarget = null;
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 0);
  }

  // ============================================
  // AUTOCOMPLETE
  // ============================================
  function setupAutocomplete(inputId, dropdownId, onSelect = null) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    if (!input || !dropdown) return;

    input.addEventListener('input', debounce(() => {
      showAutocompleteResults(input, dropdown, onSelect);
    }, 200));

    input.addEventListener('keydown', (e) => {
      handleAutocompleteKeydown(e, input, dropdown, onSelect);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('visible');
      }
    });
  }



  function handleAutocompleteKeydown(e, input, dropdown, onSelect) {
    if (!dropdown.classList.contains('visible')) return;

    const items = dropdown.querySelectorAll('.autocomplete-item[data-tag]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, items.length - 1);
      updateAutocompleteSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, 0);
      updateAutocompleteSelection(items);
    } else if (e.key === 'Enter' && autocompleteSelectedIndex >= 0) {
      e.preventDefault();
      const selected = items[autocompleteSelectedIndex];
      if (selected) {
        const selectedTag = selected.dataset.tag;
        if (onSelect) {
          onSelect(selectedTag);
        } else {
          input.value = selectedTag;
        }
        dropdown.classList.remove('visible');
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('visible');
    }
  }

  function updateAutocompleteSelection(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('selected', idx === autocompleteSelectedIndex);
    });

    if (autocompleteSelectedIndex >= 0 && items[autocompleteSelectedIndex]) {
      items[autocompleteSelectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function handleGlobalSearchSelect(tag) {
    switchTab('images');
    document.getElementById('images-filter').value = tag;
    showToast(`Filtering by: ${tag}`, 'info');
  }

  // ============================================
  // UTILITIES
  // ============================================
  function parseTag(tag) {
    if (tag && tag.includes(':')) {
      const [category, ...rest] = tag.split(':');
      const validCategory = VALID_CATEGORIES.includes(category) ? category : 'general';
      return { category: validCategory, name: rest.join(':') };
    }
    return { category: 'general', name: tag || '' };
  }

  function normalizeTagName(name) {
    return (name || '').toLowerCase().trim().replace(/\s+/g, '_');
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"');
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }