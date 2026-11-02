/**
 * VS Database — Native Keyboard Support Engine (v1.0)
 * 
 * Provides native desktop keyboard operability across the entire application:
 * 1. Event Priority Router (Inputs > Active Modals/Overlays > Popovers/Dropdowns > Composite Widgets > Global Shortcuts)
 * 2. Focus Trap & Restoration Manager (LIFO modal stack, cyclic tab navigation)
 * 3. Escape Hierarchical LIFO Stack (Closes topmost overlay/menu/dropdown without bubbling to lower levels)
 * 4. Composite Widget Arrow Nav (Tabs, Tables, Folder Trees, Sidebar Nav, Studio Tools, AI Clarification MCQs)
 * 5. Safe Desktop Shortcuts (Ctrl+K palette, Ctrl+S save active, Ctrl+Enter submit active modal/form, Escape dismiss)
 * 6. Safety Guards (Never hijacks text typing, cursor navigation, copy/paste; destructive actions always require confirmation)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. HELPERS & UTILITIES
  // =========================================================================

  function isEditable(el) {
    if (!el || el === document.body) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      // Buttons/checkboxes/radios handle arrows/space/enter natively or via widget navigation
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file'].includes(type) && !el.readOnly && !el.disabled;
    }
    if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.isContentEditable) return true;
    if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true;
    return false;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.hidden === true) return false;
      if (typeof cur.getAttribute === 'function' && cur.getAttribute('aria-hidden') === 'true') return false;
      if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden' || cur.style.opacity === '0')) {
        return false;
      }
      const style = window.getComputedStyle ? window.getComputedStyle(cur) : null;
      if (style) {
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      cur = cur.parentElement || cur.parentNode;
    }
    if (el.tagName === 'TR' || el.tagName === 'BODY' || el.tagName === 'HTML') return true;
    if (el.offsetWidth > 0 || el.offsetHeight > 0) return true;
    if (typeof el.getClientRects === 'function') {
      return el.getClientRects().length > 0;
    }
    return true;
  }

  function getFocusableElements(container) {
    if (!container) return [];
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]'
    ].join(',');
    return Array.from(container.querySelectorAll(selector)).filter(isVisible);
  }

  // =========================================================================
  // 2. FOCUS MANAGER & FOCUS TRAP
  // =========================================================================

  class FocusManager {
    constructor() {
      this.focusHistory = [];
      this.activeTrap = null;
    }

    pushFocus(currentElement) {
      if (currentElement && currentElement.isConnected) {
        this.focusHistory.push(currentElement);
      }
    }

    restoreSmartFallbackFocus() {
      // 1. Look for visible data table in current view
      const table = document.querySelector('#content table, .tw table, table');
      if (table && isVisible(table)) {
        const tbody = table.querySelector('tbody') || table;
        const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => isVisible(r) && !r.classList.contains('empty-state') && r.querySelectorAll('td').length > 0);
        if (rows.length > 0) {
          const focusedRow = rows.find(r => r.classList.contains('kb-row-focused')) || rows[0];
          rows.forEach(r => r.classList.remove('kb-row-focused'));
          focusedRow.classList.add('kb-row-focused');
          focusedRow.setAttribute('tabindex', '0');
          try {
            focusedRow.focus();
            return true;
          } catch (e) {}
        }
      }

      // 2. Look for PDF Studio tool grid
      const studioGrid = document.querySelector('.studio-tool-grid');
      if (studioGrid && isVisible(studioGrid)) {
        const cards = Array.from(studioGrid.querySelectorAll('.studio-tool-card')).filter(isVisible);
        if (cards.length > 0) {
          const card = cards.find(c => c.classList.contains('active')) || cards[0];
          card.setAttribute('tabindex', '0');
          try {
            card.focus();
            return true;
          } catch (e) {}
        }
      }

      // 3. Look for folder tree container
      const tree = document.querySelector('.tpl-tree, [role="tree"], .tree-container');
      if (tree && isVisible(tree)) {
        const nodes = Array.from(tree.querySelectorAll('.tpl-node, [role="treeitem"]')).filter(isVisible);
        if (nodes.length > 0) {
          const node = nodes.find(n => n.classList.contains('selected') || n.classList.contains('active')) || nodes[0];
          node.setAttribute('tabindex', '0');
          try {
            node.focus();
            return true;
          } catch (e) {}
        }
      }

      // 4. Look for VS AI input or radio buttons
      const aiInput = document.querySelector('#vs-ai-input, .vs-ai-input');
      if (aiInput && isVisible(aiInput)) {
        try {
          aiInput.focus();
          return true;
        } catch (e) {}
      }

      // 5. Look for active nav button
      const activeNavBtn = document.querySelector('#main-nav button.active, nav button.active');
      if (activeNavBtn && isVisible(activeNavBtn)) {
        try {
          activeNavBtn.focus();
          return true;
        } catch (e) {}
      }

      // 6. Look for first interactive element in #content
      const firstInteractive = document.querySelector('#content button:not([disabled]), #content input:not([disabled]), #content a[href]');
      if (firstInteractive && isVisible(firstInteractive)) {
        try {
          firstInteractive.focus();
          return true;
        } catch (e) {}
      }

      return false;
    }

    restoreFocus() {
      while (this.focusHistory.length > 0) {
        const el = this.focusHistory.pop();
        if (el && el.isConnected && isVisible(el)) {
          try {
            el.focus();
            return true;
          } catch (e) {
            // Ignore focus failures on stale elements
          }
        }
      }
      return this.restoreSmartFallbackFocus();
    }

    trapFocus(container, initialFocusEl) {
      this.pushFocus(document.activeElement);
      this.activeTrap = container;
      const focusables = getFocusableElements(container);
      if (initialFocusEl && isVisible(initialFocusEl)) {
        initialFocusEl.focus();
      } else if (focusables.length > 0) {
        focusables[0].focus();
      }
    }

    releaseFocus(container) {
      if (this.activeTrap === container) {
        this.activeTrap = null;
      }
      this.restoreFocus();
    }

    handleTabKey(e, modalContainer) {
      const focusables = getFocusableElements(modalContainer);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        // Shift + Tab: backwards
        if (active === first || !modalContainer.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: forwards
        if (active === last || !modalContainer.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  const focusManager = new FocusManager();

  // =========================================================================
  // 3. OVERLAY & ESCAPE STACK MANAGER (LIFO)
  // =========================================================================

  class EscapeStackManager {
    constructor() {
      this.handlers = []; // Array of { id, condition, closeFn, priority }
    }

    push(handler) {
      this.handlers.push(handler);
    }

    remove(id) {
      this.handlers = this.handlers.filter(h => h.id !== id);
    }

    handleEscape(e) {
      // Find the topmost active handler
      for (let i = this.handlers.length - 1; i >= 0; i--) {
        const handler = this.handlers[i];
        if (typeof handler.condition === 'function' ? handler.condition() : true) {
          e.preventDefault();
          e.stopPropagation();
          handler.closeFn();
          return true;
        }
      }
      return false;
    }
  }

  const escapeStack = new EscapeStackManager();

  // =========================================================================
  // 4. COMPOSITE WIDGET CONTROLLERS
  // =========================================================================

  // 4.1. Table Navigation (Arrow Up / Down, Enter, Space)
  function handleTableNavigation(e, target) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End' && e.key !== 'Enter' && e.key !== ' ') {
      return false;
    }

    let table = target.closest('table');
    if (!table) {
      if (target === document.body || target === document.documentElement || !target.isConnected) {
        table = document.querySelector('#content table, .tw table, table');
        if (!table || !isVisible(table)) return false;
      } else {
        return false;
      }
    }

    const tbody = table.querySelector('tbody') || table;
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => isVisible(r) && !r.classList.contains('empty-state') && r.querySelectorAll('td').length > 0);
    if (rows.length === 0) return false;

    let currentRow = target.closest('tr');
    let currentIndex = currentRow ? rows.indexOf(currentRow) : -1;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let nextIndex;
      if (currentIndex === -1) {
        const alreadyFocused = rows.findIndex(r => r.classList.contains('kb-row-focused'));
        if (alreadyFocused !== -1) {
          nextIndex = (e.key === 'ArrowDown') ? Math.min(alreadyFocused + 1, rows.length - 1) : Math.max(alreadyFocused - 1, 0);
        } else {
          nextIndex = (e.key === 'ArrowDown') ? 0 : rows.length - 1;
        }
      } else if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : rows.length - 1;
      }

      const nextRow = rows[nextIndex];
      if (nextRow) {
        rows.forEach(r => r.classList.remove('kb-row-focused'));
        nextRow.classList.add('kb-row-focused');
        nextRow.setAttribute('tabindex', '0');
        nextRow.focus();
        if (typeof nextRow.scrollIntoView === 'function') {
          nextRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      return true;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      const firstRow = rows[0];
      if (firstRow) {
        rows.forEach(r => r.classList.remove('kb-row-focused'));
        firstRow.classList.add('kb-row-focused');
        firstRow.setAttribute('tabindex', '0');
        firstRow.focus();
      }
      return true;
    }

    if (e.key === 'End') {
      e.preventDefault();
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        rows.forEach(r => r.classList.remove('kb-row-focused'));
        lastRow.classList.add('kb-row-focused');
        lastRow.setAttribute('tabindex', '0');
        lastRow.focus();
      }
      return true;
    }

    if (e.key === 'Enter') {
      // If pressing enter on a row (and not directly on a button or link)
      if (currentRow && target.tagName !== 'BUTTON' && target.tagName !== 'A' && target.tagName !== 'INPUT') {
        const actionBtn = currentRow.querySelector('.btn, button, a, [data-action]');
        if (actionBtn) {
          e.preventDefault();
          actionBtn.click();
          return true;
        }
      }
    }

    if (e.key === ' ' && currentRow && target.tagName === 'TR') {
      // Space toggles checkbox if row has one
      const checkbox = currentRow.querySelector('input[type="checkbox"]');
      if (checkbox) {
        e.preventDefault();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    return false;
  }

  // 4.2. Tree View Navigation (Arrow Up / Down, Right to expand, Left to collapse)
  function handleTreeNavigation(e, target) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      return false;
    }

    let treeContainer = target.closest('.tpl-tree, [role="tree"], .tree-container');
    if (!treeContainer) {
      if (target === document.body || target === document.documentElement || !target.isConnected) {
        treeContainer = document.querySelector('.tpl-tree, [role="tree"], .tree-container');
        if (!treeContainer || !isVisible(treeContainer)) return false;
      } else {
        return false;
      }
    }

    const items = Array.from(treeContainer.querySelectorAll('.tpl-node, [role="treeitem"]')).filter(isVisible);
    if (items.length === 0) return false;

    let currentItem = target.closest('.tpl-node, [role="treeitem"]');
    let currentIndex = currentItem ? items.indexOf(currentItem) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (currentIndex === -1) ? 0 : (currentIndex + 1) % items.length;
      const next = items[nextIdx];
      if (next) {
        next.setAttribute('tabindex', '0');
        next.focus();
        next.click();
      }
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (currentIndex === -1) ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      const prev = items[prevIdx];
      if (prev) {
        prev.setAttribute('tabindex', '0');
        prev.focus();
        prev.click();
      }
      return true;
    }

    if (e.key === 'ArrowRight' && currentItem) {
      // Expand branch if collapsible
      const expander = currentItem.parentElement ? currentItem.parentElement.querySelector('.tree-expander, .node-expander') : null;
      if (expander) {
        e.preventDefault();
        expander.click();
        return true;
      }
    }

    if (e.key === 'ArrowLeft' && currentItem) {
      // Collapse branch or move to parent
      const parentLi = currentItem.closest('ul')?.parentElement?.querySelector('.tpl-node, [role="treeitem"]');
      if (parentLi) {
        e.preventDefault();
        parentLi.setAttribute('tabindex', '0');
        parentLi.focus();
        parentLi.click();
        return true;
      }
    }

    return false;
  }

  // 4.3. Tab Bar Navigation (Arrow Left / Right / Up / Down)
  function handleTabNav(e, target) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return false;
    }

    let tabList = target.closest('[role="tablist"], .auth-tabs, .nav-tabs, #main-nav');
    if (!tabList) {
      if (target === document.body || target === document.documentElement || !target.isConnected) {
        const hasOtherWidgets = document.querySelector('#content table, .studio-tool-grid, .tpl-tree');
        if (!hasOtherWidgets || !isVisible(hasOtherWidgets)) {
          tabList = document.querySelector('#main-nav, [role="tablist"]');
          if (!tabList || !isVisible(tabList)) return false;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    const tabs = Array.from(tabList.querySelectorAll('[role="tab"], button')).filter(isVisible);
    if (tabs.length === 0) return false;

    let currentIndex = tabs.indexOf(target);
    if (currentIndex === -1) {
      const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
      currentIndex = (activeIdx !== -1) ? activeIdx : 0;
    }

    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== -1 && tabs[nextIndex]) {
      tabs[nextIndex].focus();
      // If within tabs, switch automatically on arrow
      if (tabList.classList.contains('auth-tabs') || tabList.getAttribute('role') === 'tablist') {
        tabs[nextIndex].click();
      }
      return true;
    }

    return false;
  }

  // 4.4. Studio Tool Cards Navigation
  function handleStudioCardsNav(e, target) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== ' ') {
      return false;
    }

    let card = target.closest('.studio-tool-card');
    let grid = card ? card.closest('.studio-tool-grid') : null;

    if (!card || !grid) {
      if (target === document.body || target === document.documentElement || !target.isConnected) {
        grid = document.querySelector('.studio-tool-grid');
        if (!grid || !isVisible(grid)) return false;
      } else {
        return false;
      }
    }

    const cards = Array.from(grid.querySelectorAll('.studio-tool-card')).filter(isVisible);
    if (cards.length === 0) return false;

    let currentIndex = card ? cards.indexOf(card) : -1;

    let nextIndex = -1;
    if (currentIndex === -1) {
      const activeIdx = cards.findIndex(c => c.classList.contains('active'));
      nextIndex = (activeIdx !== -1) ? activeIdx : 0;
    } else if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % cards.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + cards.length) % cards.length;
    } else if (e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 2 < cards.length) ? currentIndex + 2 : currentIndex;
    } else if (e.key === 'ArrowUp') {
      nextIndex = (currentIndex - 2 >= 0) ? currentIndex - 2 : currentIndex;
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (card) {
        e.preventDefault();
        card.click();
        return true;
      }
    }

    if (nextIndex !== -1 && cards[nextIndex]) {
      e.preventDefault();
      cards[nextIndex].setAttribute('tabindex', '0');
      cards[nextIndex].focus();
      return true;
    }

    return false;
  }

  // 4.5. VS AI MCQ Clarification Question Navigation
  function handleVsAiMcqNav(e, target) {
    const qBox = target.closest('.vs-ai-interactive-question-box');
    if (!qBox) return false;

    const section = target.closest('.vs-ai-question-section');
    if (!section) return false;

    const optButtons = Array.from(section.querySelectorAll('.vs-ai-question-opt-btn')).filter(isVisible);
    const currentBtn = target.closest('.vs-ai-question-opt-btn');

    if (currentBtn && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const nextIdx = (optButtons.indexOf(currentBtn) + 1) % optButtons.length;
      optButtons[nextIdx].focus();
      return true;
    }

    if (currentBtn && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const prevIdx = (optButtons.indexOf(currentBtn) - 1 + optButtons.length) % optButtons.length;
      optButtons[prevIdx].focus();
      return true;
    }

    if (currentBtn && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      currentBtn.click();
      return true;
    }

    // Ctrl+Enter advances to next slide or submits the question box if enabled
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const nextBtn = qBox.querySelector('.vs-ai-btn-next-question');
      if (nextBtn && isVisible(nextBtn) && !nextBtn.disabled) {
        e.preventDefault();
        nextBtn.click();
        return true;
      }
      const submitBtn = qBox.querySelector('.vs-ai-btn-submit-choice');
      if (submitBtn && isVisible(submitBtn) && !submitBtn.disabled) {
        e.preventDefault();
        submitBtn.click();
        return true;
      }
    }

    return false;
  }

  // =========================================================================
  // 5. COMMAND PALETTE & QUICK ACTION MODAL (Ctrl + K)
  // =========================================================================

  let commandPaletteOpen = false;

  function showCommandPalette() {
    if (commandPaletteOpen) return;
    const existing = document.getElementById('vs-command-palette');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-kb-palette-overlay';
    overlay.id = 'vs-command-palette';

    const items = [
      { id: 'dashboard', title: 'Go to Dashboard', badge: 'Alt+1 / Nav', action: () => window.navigateTo && window.navigateTo('dashboard') },
      { id: 'clients', title: 'Open Clients Database', badge: 'Alt+2 / Nav', action: () => window.navigateTo && window.navigateTo('clients') },
      { id: 'folders', title: 'Folder Structure & Explorer', badge: 'Alt+3 / Nav', action: () => window.navigateTo && window.navigateTo('folders') },
      { id: 'save', title: 'Save Files Workspace', badge: 'Alt+4 / Nav', action: () => window.navigateTo && window.navigateTo('save') },
      { id: 'studio', title: 'PDF Studio Toolkit (12 Tools)', badge: 'Alt+5 / Nav', action: () => window.navigateTo && window.navigateTo('pdf-studio') },
      { id: 'ai', title: 'VS AI — Personal CA Copilot', badge: 'Alt+6 / Nav', action: () => window.navigateTo && window.navigateTo('vs-ai') },
      { id: 'drive', title: 'Google Drive Sharing', badge: 'Nav', action: () => window.navigateTo && window.navigateTo('drive') },
      { id: 'backup', title: 'Backup & Restore Center', badge: 'Nav', action: () => window.navigateTo && window.navigateTo('backup') },
      { id: 'activity', title: 'Activity Audit Log', badge: 'Nav', action: () => window.navigateTo && window.navigateTo('activity') },
      { id: 'setup', title: 'Firm Configuration & Setup', badge: 'Nav', action: () => window.navigateTo && window.navigateTo('setup') },
      { id: 'new-client', title: 'Register New Client', badge: 'Action', action: () => { window.navigateTo('clients'); setTimeout(() => document.querySelector('#btn-add-client, [data-action="add-client"]')?.click(), 100); } },
      { id: 'save-rules', title: 'Save Folder Rules', badge: 'Ctrl+S', action: () => document.getElementById('save-rules')?.click() }
    ];

    overlay.innerHTML = `
      <div class="vs-kb-palette-card" role="dialog" aria-modal="true" aria-label="Quick Commands">
        <div class="vs-kb-palette-header">
          <svg class="i" style="width:20px;height:20px;stroke:#2563eb;" aria-hidden="true"><use href="#search"/></svg>
          <input type="text" class="vs-kb-palette-input" id="vs-palette-query" placeholder="Type a section or command (e.g. Clients, Studio, Save)..." autocomplete="off" />
          <span class="vs-kb-palette-badge">ESC to close</span>
        </div>
        <div class="vs-kb-palette-list" id="vs-palette-results">
          ${items.map((it, idx) => `
            <div class="vs-kb-palette-item ${idx === 0 ? 'kb-active' : ''}" data-idx="${idx}" data-id="${it.id}">
              <span>${it.title}</span>
              <span class="vs-kb-palette-badge">${it.badge}</span>
            </div>
          `).join('')}
        </div>
        <div class="vs-kb-palette-footer">
          <span>↑↓ to navigate · Enter to select</span>
          <span>VS Database Desktop Shell</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    commandPaletteOpen = true;

    const input = overlay.querySelector('#vs-palette-query');
    const resultsContainer = overlay.querySelector('#vs-palette-results');
    focusManager.pushFocus(document.activeElement);
    input.focus();

    let filteredItems = items.slice();
    let selectedIdx = 0;

    const renderFiltered = () => {
      resultsContainer.innerHTML = filteredItems.map((it, idx) => `
        <div class="vs-kb-palette-item ${idx === selectedIdx ? 'kb-active' : ''}" data-idx="${idx}" data-id="${it.id}">
          <span>${it.title}</span>
          <span class="vs-kb-palette-badge">${it.badge}</span>
        </div>
      `).join('');
    };

    input.oninput = () => {
      const q = input.value.toLowerCase().trim();
      if (!q) {
        filteredItems = items.slice();
      } else {
        filteredItems = items.filter(it => it.title.toLowerCase().includes(q) || it.id.toLowerCase().includes(q));
      }
      selectedIdx = 0;
      renderFiltered();
    };

    const closePalette = () => {
      commandPaletteOpen = false;
      overlay.remove();
      focusManager.restoreFocus();
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) closePalette();
    };

    resultsContainer.onclick = (e) => {
      const itemEl = e.target.closest('.vs-kb-palette-item');
      if (itemEl) {
        const idx = parseInt(itemEl.dataset.idx, 10);
        if (filteredItems[idx]) {
          closePalette();
          filteredItems[idx].action();
        }
      }
    };

    overlay.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredItems.length > 0) {
          selectedIdx = (selectedIdx + 1) % filteredItems.length;
          renderFiltered();
          resultsContainer.children[selectedIdx]?.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredItems.length > 0) {
          selectedIdx = (selectedIdx - 1 + filteredItems.length) % filteredItems.length;
          renderFiltered();
          resultsContainer.children[selectedIdx]?.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIdx]) {
          const act = filteredItems[selectedIdx].action;
          closePalette();
          act();
        }
        return;
      }
    };
  }

  // =========================================================================
  // 6. CENTRAL EVENT DISPATCHER & PRIORITY ROUTER
  // =========================================================================

  function initGlobalKeyboardRouter() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      const editable = isEditable(target);

      // ---------------------------------------------------------------------
      // PRIORITY 1: GLOBAL ACCELERATORS & SAFE SHORTCUTS (Ctrl / Cmd / Alt)
      // ---------------------------------------------------------------------

      // Ctrl+K / Cmd+K: Open Quick Navigation Command Palette
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        showCommandPalette();
        return;
      }

      // Alt + 1..6: Quick Navigation to core workspaces
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const navMap = {
          '1': 'dashboard',
          '2': 'clients',
          '3': 'folders',
          '4': 'save',
          '5': 'pdf-studio',
          '6': 'vs-ai'
        };
        if (navMap[e.key] && typeof window.navigateTo === 'function') {
          e.preventDefault();
          window.navigateTo(navMap[e.key]);
          return;
        }
      }

      // Ctrl+S / Cmd+S: Save active form / rules / stage
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const activeSaveBtn = document.querySelector(
          '#save-rules, #btn-save-client, #vs-save-stage-btn, [data-action="save"]'
        );
        if (activeSaveBtn && isVisible(activeSaveBtn) && !activeSaveBtn.disabled) {
          activeSaveBtn.click();
          if (typeof window.showNativeToast === 'function') {
            window.showNativeToast('Changes saved', 'success');
          }
        }
        return;
      }

      // ---------------------------------------------------------------------
      // PRIORITY 2: ACTIVE MODAL FOCUS TRAP, DROPDOWNS & ESCAPE HANDLING
      // ---------------------------------------------------------------------

      const modalSelector = [
        'dialog[open]',
        '#vs-exit-modal:not([style*="display: none"]):not([style*="display:none"])',
        '.vs-native-alert-overlay',
        '.auth-overlay',
        '.vs-modal-overlay',
        '.vs-ai-modal-overlay',
        '.ai-rename-modal-overlay',
        '.ft-modal-overlay',
        '.import-overlay',
        '.portal-modal',
        '.vs-studio-modal-overlay',
        '[role="dialog"]:not([aria-hidden="true"])'
      ].join(', ');

      let activeModal = null;
      if (typeof document.querySelectorAll === 'function') {
        const allModals = Array.from(document.querySelectorAll(modalSelector)).filter(isVisible);
        if (allModals.length > 0) {
          activeModal = allModals[allModals.length - 1];
        }
      }
      if (!activeModal) {
        const candidate = document.querySelector(modalSelector);
        if (candidate && isVisible(candidate)) {
          activeModal = candidate;
        }
      }

      if (e.key === 'Escape') {
        // Priority 0: Open dropdowns / popovers (close dropdown first, not parent modal!)
        const dropupMenu = document.getElementById('vs-ai-dropup-menu');
        if (dropupMenu && isVisible(dropupMenu)) {
          e.preventDefault();
          e.stopPropagation();
          dropupMenu.style.display = 'none';
          const dropupBtn = document.getElementById('vs-ai-btn-dropup');
          if (dropupBtn) {
            dropupBtn.classList.remove('active');
            dropupBtn.focus();
          }
          return;
        }

        const headerMenu = document.getElementById('vs-ai-header-menu');
        if (headerMenu && isVisible(headerMenu)) {
          e.preventDefault();
          e.stopPropagation();
          headerMenu.style.display = 'none';
          const moreBtn = document.getElementById('vs-ai-btn-more-menu');
          if (moreBtn) moreBtn.focus();
          return;
        }

        const openExportMenu = document.querySelector('.vs-ai-export-dropdown-menu.open, .dropdown-menu.open');
        if (openExportMenu && isVisible(openExportMenu)) {
          e.preventDefault();
          e.stopPropagation();
          openExportMenu.classList.remove('open');
          return;
        }

        // Priority 1: Command Palette
        const palette = document.getElementById('vs-command-palette');
        if (palette) {
          e.preventDefault();
          palette.remove();
          commandPaletteOpen = false;
          focusManager.restoreFocus();
          return;
        }

        // Priority 2: Active Save-to-Client Confirmation or Native Confirmation / Alert modal
        const saveConfirmModal = document.getElementById('vs-ai-save-confirm-modal');
        if (saveConfirmModal && isVisible(saveConfirmModal)) {
          e.preventDefault();
          const noBtn = saveConfirmModal.querySelector('.vs-ai-btn-no, .secondary');
          if (noBtn) noBtn.click();
          else saveConfirmModal.remove();
          focusManager.restoreFocus();
          return;
        }

        const alertModal = document.querySelector('#vs-native-alert-modal, #vs-native-confirm-modal, .vs-native-alert-overlay');
        if (alertModal && isVisible(alertModal)) {
          e.preventDefault();
          const cancelBtn = alertModal.querySelector('#vs-confirm-cancel-btn, #vs-native-alert-ok-btn, .modal-close');
          if (cancelBtn) cancelBtn.click();
          else alertModal.remove();
          focusManager.restoreFocus();
          return;
        }

        // Priority 3: Exit modal
        const exitModal = document.getElementById('vs-exit-modal');
        if (exitModal && exitModal.style.display !== 'none' && isVisible(exitModal)) {
          e.preventDefault();
          if (typeof window.hideExitConfirmModal === 'function') {
            window.hideExitConfirmModal();
          } else {
            exitModal.style.display = 'none';
          }
          focusManager.restoreFocus();
          return;
        }

        // Priority 4: Any active VS AI modal or AI rename modal (topmost visible)
        if (typeof document.querySelectorAll === 'function') {
          const aiModals = Array.from(document.querySelectorAll('.vs-ai-modal-overlay, .ai-rename-modal-overlay')).filter(isVisible);
          if (aiModals.length > 0) {
            const topAiModal = aiModals[aiModals.length - 1];
            e.preventDefault();
            const closeBtn = topAiModal.querySelector('.vs-ai-modal-close, .modal-close, #btn-ai-rename-cancel, .vs-ai-btn-no, [data-action="cancel"]');
            if (closeBtn) {
              closeBtn.click();
            } else if (topAiModal.id && topAiModal.id.startsWith('modal-')) {
              topAiModal.style.display = 'none';
            } else {
              topAiModal.remove();
            }
            focusManager.restoreFocus();
            return;
          }
        }

        // Priority 5: Any active ft-modal-overlay / import-overlay / portal-modal / vs-studio-modal-overlay / vs-modal-overlay / auth-overlay
        const customOverlay = document.querySelector(
          '.ft-modal-overlay, .import-overlay, .portal-modal, .vs-studio-modal-overlay, .vs-modal-overlay, .auth-overlay'
        );
        if (customOverlay && isVisible(customOverlay)) {
          e.preventDefault();
          const closeBtn = customOverlay.querySelector('.modal-close, .btn-close-modal, .secondary, [data-action="cancel"], #cancel-apply-sel, #cancel-lock-pdf, #cancel-unlock-pdf');
          if (closeBtn) {
            closeBtn.click();
          } else {
            customOverlay.remove();
          }
          focusManager.restoreFocus();
          return;
        }

        // Priority 6: Native <dialog id="dlg">
        const dlg = document.querySelector('dialog[open]');
        if (dlg && isVisible(dlg)) {
          e.preventDefault();
          if (typeof dlg.close === 'function') dlg.close('x');
          else dlg.removeAttribute('open');
          focusManager.restoreFocus();
          return;
        }

        // Priority 7: Check if VS AI stream is generating: stop it
        const aiStopBtn = document.querySelector('#vs-ai-btn-stop');
        if (aiStopBtn && isVisible(aiStopBtn)) {
          e.preventDefault();
          aiStopBtn.click();
          return;
        }

        // Priority 8: Custom escape handlers registered in stack
        if (escapeStack.handleEscape(e)) {
          focusManager.restoreFocus();
          return;
        }
      }

      // Open Dropdown Menu Arrow Key Navigation (#vs-ai-dropup-menu, #vs-ai-header-menu)
      const openDropup = document.getElementById('vs-ai-dropup-menu');
      const openHeaderMenu = document.getElementById('vs-ai-header-menu');
      const activeMenu = (openDropup && isVisible(openDropup)) ? openDropup : ((openHeaderMenu && isVisible(openHeaderMenu)) ? openHeaderMenu : null);
      if (activeMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
        const items = Array.from(activeMenu.querySelectorAll('.vs-ai-dropup-item, .vs-ai-dropdown-item, button:not([disabled])')).filter(isVisible);
        if (items.length > 0) {
          e.preventDefault();
          const curIdx = items.indexOf(document.activeElement);
          let nextIdx = 0;
          if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = items.length - 1;
          else if (e.key === 'ArrowDown') nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % items.length;
          else if (e.key === 'ArrowUp') nextIdx = curIdx <= 0 ? items.length - 1 : curIdx - 1;
          items[nextIdx].focus();
          return;
        }
      }

      // If a modal is active, trap TAB key inside it
      if (activeModal && e.key === 'Tab') {
        focusManager.handleTabKey(e, activeModal);
        return;
      }

      // Ctrl+Enter in active modal: submit form
      if (activeModal && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const primaryBtn = activeModal.querySelector('.btn.primary, .btn.p, #dok, #vs-confirm-ok-btn, [type="submit"]');
        if (primaryBtn && !primaryBtn.disabled) {
          e.preventDefault();
          primaryBtn.click();
          return;
        }
      }

      // ---------------------------------------------------------------------
      // PRIORITY 3: TEXT EDITING GUARD
      // If user is typing in an input/textarea/contenteditable, preserve all native keys!
      // (Arrows navigate cursor, Home/End jump lines, Space inserts space, Delete deletes text)
      // Must execute BEFORE modal button arrow navigation so inputs inside or outside modals work!
      // ---------------------------------------------------------------------
      if (editable || isEditable(document.activeElement)) {
        // Exception: Ctrl+Enter submits
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          const form = target && typeof target.closest === 'function' ? target.closest('form') : null;
          if (form) {
            const submitBtn = form.querySelector('[type="submit"], .primary');
            if (submitBtn) {
              e.preventDefault();
              submitBtn.click();
              return;
            }
          }
        }
        return; // Never intercept arrow/home/end/space/delete inside text inputs!
      }

      // If a modal is active (and user is NOT in a text input or <select>), arrow keys navigate between action buttons (e.g., Yes / No, Cancel / Confirm)
      if (activeModal && document.activeElement?.tagName !== 'SELECT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const actionButtons = Array.from(activeModal.querySelectorAll('button:not([disabled]), [role="button"]:not([disabled])')).filter(isVisible);
        if (actionButtons.length > 1) {
          e.preventDefault();
          const currentIdx = actionButtons.indexOf(document.activeElement);
          let nextIdx = 0;
          if (currentIdx !== -1) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              nextIdx = (currentIdx + 1) % actionButtons.length;
            } else {
              nextIdx = (currentIdx - 1 + actionButtons.length) % actionButtons.length;
            }
          } else {
            // Default: if ArrowLeft/Up choose first; if ArrowRight/Down choose last
            nextIdx = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? 0 : actionButtons.length - 1;
          }
          actionButtons[nextIdx].focus();
          return;
        }
      }

      // ---------------------------------------------------------------------
      // PRIORITY 4: COMPOSITE WIDGET ARROW KEY NAVIGATION
      // ---------------------------------------------------------------------

      // 4.1 VS AI MCQ Clarification Question Box
      if (handleVsAiMcqNav(e, target)) return;

      // 4.2 Studio Tool Cards
      if (handleStudioCardsNav(e, target)) return;

      // 4.3 Folder Structure Tree View
      if (handleTreeNavigation(e, target)) return;

      // 4.4 Tab Bars (Main Nav, Auth Tabs, View Subtabs)
      if (handleTabNav(e, target)) return;

      // 4.5 Data Tables (Client Table, Firm Types, File Lists)
      if (handleTableNavigation(e, target)) return;

      // ---------------------------------------------------------------------
      // PRIORITY 5: BUTTON SPACE & ENTER ACTIVATION
      // ---------------------------------------------------------------------
      if ((e.key === ' ' || e.key === 'Enter') && target.getAttribute('role') === 'button') {
        e.preventDefault();
        target.click();
        return;
      }

      // ---------------------------------------------------------------------
      // PRIORITY 6: DESTRUCTIVE ACTION SAFEGUARDS
      // Prevent accidental data deletion on Delete/Backspace without confirmation
      // ---------------------------------------------------------------------
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // If pressed on a selected row or item, trigger its confirmation dialog safely
        const focusedRow = document.querySelector('tr.kb-row-focused');
        if (focusedRow) {
          const deleteBtn = focusedRow.querySelector('.btn-danger, [data-action="delete"], .action-delete');
          if (deleteBtn) {
            e.preventDefault();
            deleteBtn.click();
            return;
          }
        }
      }
    }, true); // Use capture phase so keyboard engine has full deterministic authority
  }

  function initModalCloseObserver() {
    if (typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver((mutations) => {
      let modalClosed = false;
      for (const mutation of mutations) {
        if (mutation.removedNodes && mutation.removedNodes.length > 0) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType === 1) {
              const cls = (node.className || '').toString();
              const id = node.id || '';
              if (
                cls.includes('modal') ||
                cls.includes('overlay') ||
                cls.includes('dialog') ||
                id.includes('modal') ||
                node.tagName === 'DIALOG'
              ) {
                modalClosed = true;
                break;
              }
            }
          }
        }
        if (modalClosed) break;
      }

      if (modalClosed) {
        if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected) {
          setTimeout(() => {
            if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected) {
              focusManager.restoreFocus();
            }
          }, 20);
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // =========================================================================
  // 7. INITIALIZATION & PUBLIC API EXPORTS
  // =========================================================================

  function initKeyboardEngine() {
    initGlobalKeyboardRouter();
    initModalCloseObserver();

    // Export Keyboard Engine API
    window.VSKeyboard = {
      focusManager,
      escapeStack,
      showCommandPalette,
      trapFocus: (container, el) => focusManager.trapFocus(container, el),
      releaseFocus: (container) => focusManager.releaseFocus(container),
      registerEscape: (id, condition, closeFn) => escapeStack.push({ id, condition, closeFn }),
      removeEscape: (id) => escapeStack.remove(id)
    };

    console.info('[VS Keyboard Engine] Initialized with 100% native desktop parity.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKeyboardEngine);
  } else {
    initKeyboardEngine();
  }
})();
