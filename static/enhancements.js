// Production enhancements layered over the stable application API and page hooks.
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  const originalSetup = setup;


  const originalFolders = folders;
  folders = function () {
    content.innerHTML = `
      <div class="card">
        <h1>Folder Structure & Templates</h1>
        <p class="muted">Unified folder-generation engine for VS Database. Folder hierarchy is defined by the Base/Firm-Type Template, with dimensions organized by Period and Folder Order.</p>

        <!-- Dimension & Order Bar -->
        <div class="grid" style="margin-top:14px;margin-bottom:18px;background:rgba(255,255,255,.45);padding:16px;border-radius:16px;border:1px solid var(--line);">
          <div>
            <label for="folder-order" style="font-weight:700;">Folder Order</label>
            <select id="folder-order">
              <option value="service-period" ${rules.order_name === 'service-period' ? 'selected' : ''}>Client / Service / Period (e.g. Client / Income Tax / AY 2025-26 / ITR)</option>
              <option value="period-service" ${rules.order_name === 'period-service' ? 'selected' : ''}>Client / Period / Service (e.g. Client / AY 2025-26 / Income Tax / ITR)</option>
            </select>
          </div>
          <div>
            <label for="folder-periods" style="font-weight:700;">Periods (comma separated)</label>
            <input id="folder-periods" value="${escapeHtml(rules.periods.join(', '))}" placeholder="e.g. AY 2024-25, AY 2025-26">
          </div>
        </div>

        <div class="actions" style="margin-top:0;margin-bottom:18px;">
          <button class="primary" id="save-rules-btn"><svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#check"/></svg>Save Rules & Order</button>
          <button class="secondary" id="create-all-btn"><svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#folder"/></svg>Create Missing Folders</button>
          <button class="btn-reconcile" id="global-reconcile-btn" style="border-radius:13px;padding:0 17px;min-height:42px;font:700 12px inherit;cursor:pointer;"><svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#refresh"/></svg>Scan & Reconcile All Clients</button>
        </div>
        <div id="rules-result" style="margin-bottom:16px;"></div>

        <!-- Client File Explorer & PDF Tools Quick Access -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:14px 16px;margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#166534;">
              <svg class="i" style="width:16px;height:16px;stroke:#166534;"><use href="#folder"/></svg> Client File Explorer & PDF Security Tools
            </div>
            <span style="font-size:11px;color:#15803d;">Browse folders, upload files, and Lock/Unlock client PDFs</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="folders-quick-client-select" style="min-width:220px;flex:1;padding:8px 12px;border-radius:10px;border:1px solid #86efac;background:#fff;font-size:12px;">
              <option value="">Select client to open folders...</option>
              ${clients.map(c => `<option value="${escapeHtml(c.file_no)}">${escapeHtml(c.name)} (${escapeHtml(c.file_no)})</option>`).join('')}
            </select>
            <button type="button" class="primary" id="btn-quick-open-tree" style="min-height:36px;font-size:12px;padding:0 14px;"><svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#folder"/></svg>Open Folder Explorer</button>
            <button type="button" class="secondary" id="btn-quick-client-pdf-pwd" style="min-height:36px;font-size:12px;padding:0 14px;background:#fef3c7;border-color:#fde68a;color:#92400e;"><svg class="i" style="width:14px;height:14px;margin-right:6px;stroke:#92400e;"><use href="#setup"/></svg>PDF Passwords</button>
          </div>
        </div>

        <!-- Firm Type Tabs -->
        <div style="border-top:1px solid var(--line);padding-top:18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <label style="font-size:13px;font-weight:700;margin:0;">Folder Structure For:</label>
              <button type="button" class="secondary" id="btn-manage-ft-folders" style="min-height:30px;font-size:11.5px;padding:3px 12px;display:inline-flex;align-items:center;gap:5px;border-radius:10px;"><svg class="i" style="width:13px;height:13px;"><use href="#setup"/></svg>Manage Firm Types</button>
            </div>
            <div id="tpl-status-badge"></div>
          </div>
          <div class="tpl-ft-tabs" id="tpl-tabs"></div>
        </div>

        <!-- 2-Column: Tree Editor on Left, Live Preview on Right -->
        <div class="tpl-columns">
          <!-- Left: Editor -->
          <div class="tpl-editor-pane">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 id="tpl-current-title" style="margin:0;font-size:13px;font-weight:700;color:var(--text)">Template Structure</h4>
              <span class="muted" style="font-size:11px;" id="tpl-node-count">0 items</span>
            </div>
            <div class="tpl-tree-box" id="tpl-tree-container" style="min-height:280px;max-height:48vh;">
              <ul class="tpl-tree" id="tpl-tree-list"></ul>
            </div>
            <div class="tpl-toolbar" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
              <button class="tpl-btn primary" id="tpl-add-root"><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#plus"/></svg>Add Root Folder</button>
              <button class="tpl-btn" id="tpl-add-sub" disabled><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#plus"/></svg>Add Subfolder</button>
              <button class="tpl-btn" id="tpl-rename" disabled><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#edit"/></svg>Rename</button>
              <button class="tpl-btn danger" id="tpl-delete" disabled><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#trash"/></svg>Delete</button>
              <button class="tpl-btn" id="tpl-move-up" disabled>Move Up</button>
              <button class="tpl-btn" id="tpl-move-down" disabled>Move Down</button>
              <div style="flex:1"></div>
              <button class="tpl-btn" id="tpl-reset-btn" style="display:none;color:#b45309;border-color:#fde047;background:#fefce8;"><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#refresh"/></svg>Reset to Base</button>
              <button class="tpl-btn primary" id="tpl-save" style="background:var(--blue);color:#fff;padding:6px 14px;"><svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#check"/></svg>Save for this Type</button>
              <button class="tpl-btn" id="tpl-apply-all" style="background:#4338ca;color:#fff;padding:6px 14px;">Apply to ALL Types</button>
              <button class="tpl-btn" id="tpl-apply-selected" style="background:#4f46e5;color:#fff;padding:6px 14px;">Apply to Selected Types...</button>
            </div>
            <div id="tpl-result" style="margin-top:8px;"></div>
          </div>

          <!-- Right: Live Effective Structure Preview -->
          <div class="tpl-preview-pane">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="margin:0;font-size:13px;font-weight:700;color:var(--text)">Live Effective Disk Preview</h4>
              <span class="file-meta-badge" id="tpl-preview-order-badge" style="font-size:10px;">Order: Service / Period</span>
            </div>
            <div class="tpl-tree-box" id="tpl-preview-box" style="min-height:280px;max-height:48vh;background:rgba(246,248,255,.8);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-x:auto;">
              <div id="tpl-preview-content"></div>
            </div>
            <p class="muted" style="font-size:11px;margin-top:8px;line-height:1.4;">
              💡 <strong>Deterministic Generation:</strong> Clients of this Firm Type receive this exact folder tree on Local and Drive G storage locations.
            </p>
          </div>
        </div>
      </div>

      <div class="glass card">
        <h2>Configured Destinations</h2>
        <p class="path"><svg class="i" style="width:14px;height:14px;margin-right:6px;stroke:var(--pri);"><use href="#folder"/></svg>Local Storage: <strong>${settings.local_root || 'No local storage configured'}</strong></p>
        <p class="path"><svg class="i" style="width:14px;height:14px;margin-right:6px;stroke:var(--pri);"><use href="#drive"/></svg>Google Drive: <strong>${settings.drive_root || 'No Google Drive storage configured'}</strong></p>
      </div>
    `;

    // State & Logic
    let allTemplates = [];
    let activeCategory = 'Individual';
    let currentTree = [];
    let selectedPath = null;

    const getNodeByPath = (tree, path) => {
      let curr = null, arr = tree;
      for (const idx of path) {
        if (!arr || !arr[idx]) return null;
        curr = arr[idx];
        arr = curr.children;
      }
      return curr;
    };

    const getParentArrayByPath = (tree, path) => {
      if (path.length === 1) return tree;
      let curr = null, arr = tree;
      for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i];
        if (!arr || !arr[idx]) return null;
        curr = arr[idx];
        arr = curr.children;
      }
      return arr;
    };

    const updateToolbarButtons = () => {
      const hasSel = selectedPath !== null;
      const subBtn = document.querySelector('#tpl-add-sub');
      const renBtn = document.querySelector('#tpl-rename');
      const delBtn = document.querySelector('#tpl-delete');
      const upBtn = document.querySelector('#tpl-move-up');
      const downBtn = document.querySelector('#tpl-move-down');
      if (!subBtn) return;
      subBtn.disabled = !hasSel;
      renBtn.disabled = !hasSel;
      delBtn.disabled = !hasSel;
      if (hasSel) {
        const parentArr = getParentArrayByPath(currentTree, selectedPath);
        const idx = selectedPath[selectedPath.length - 1];
        upBtn.disabled = idx <= 0;
        downBtn.disabled = !parentArr || idx >= parentArr.length - 1;
      } else {
        upBtn.disabled = true;
        downBtn.disabled = true;
      }
    };

    const renderTreeNodes = (nodes, parentPath = []) => {
      if (!nodes || !nodes.length) return '';
      return nodes.map((node, index) => {
        const path = [...parentPath, index];
        const isSelected = selectedPath && selectedPath.join(',') === path.join(',');
        const depth = path.length - 1;
        const indentPx = depth * 20;
        const hasChildren = node.children && node.children.length > 0;
        return `
          <li>
            <div class="tpl-node ${isSelected ? 'selected' : ''}" style="padding-left:${10 + indentPx}px" data-path="${path.join(',')}">
              <span class="node-label">📁 <strong>${escapeHtml(node.name)}</strong></span>
              ${hasChildren ? `<span class="muted" style="font-size:10px;">${node.children.length} subfolder(s)</span>` : ''}
            </div>
            ${hasChildren ? `<ul class="tpl-tree">${renderTreeNodes(node.children, path)}</ul>` : ''}
          </li>
        `;
      }).join('');
    };

    const countNodes = (nodes) => {
      if (!nodes) return 0;
      let c = 0;
      for (const n of nodes) c += 1 + countNodes(n.children);
      return c;
    };

    const renderTree = () => {
      const listEl = document.querySelector('#tpl-tree-list');
      const countEl = document.querySelector('#tpl-node-count');
      const titleEl = document.querySelector('#tpl-current-title');
      const statusBadge = document.querySelector('#tpl-status-badge');
      const resetBtn = document.querySelector('#tpl-reset-btn');

      const isBase = activeCategory.toLowerCase() === 'all clients';
      const tplObj = allTemplates.find(t => t.category.toLowerCase() === activeCategory.toLowerCase());
      const isInherited = tplObj ? tplObj.is_inherited : false;

      if (titleEl) titleEl.textContent = `Structure: ${activeCategory}`;
      if (countEl) countEl.textContent = `${countNodes(currentTree)} folder(s)`;

      if (statusBadge) {
        if (isBase) {
          statusBadge.innerHTML = `<span class="summary-badge new" style="font-size:11px;">🌐 Base Template (Applied to All Clients)</span>`;
          if (resetBtn) resetBtn.style.display = 'none';
        } else if (isInherited) {
          statusBadge.innerHTML = `<span class="summary-badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:11px;">↳ Inheriting from ALL CLIENTS</span>`;
          if (resetBtn) resetBtn.style.display = 'none';
        } else {
          statusBadge.innerHTML = `<span class="summary-badge conflict" style="font-size:11px;">⚙ Firm Type Override</span>`;
          if (resetBtn) resetBtn.style.display = 'inline-flex';
        }
      }

      if (listEl) {
        if (!currentTree.length) {
          listEl.innerHTML = '<li style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">This template is empty. Click <strong>+ Add Root Folder</strong> below to begin.</li>';
        } else {
          listEl.innerHTML = renderTreeNodes(currentTree);
        }

        listEl.querySelectorAll('.tpl-node').forEach(nodeEl => {
          nodeEl.onclick = (e) => {
            e.stopPropagation();
            const pathStr = nodeEl.dataset.path;
            const newPath = pathStr.split(',').map(Number);
            selectedPath = (selectedPath && selectedPath.join(',') === pathStr) ? null : newPath;
            renderTree();
            updateToolbarButtons();
          };
        });
      }
      updateToolbarButtons();
      updatePreview();
    };

    const updatePreview = () => {
      const previewContent = document.querySelector('#tpl-preview-content');
      const orderBadge = document.querySelector('#tpl-preview-order-badge');
      if (!previewContent) return;

      try {
        const orderName = document.querySelector('#folder-order') ? document.querySelector('#folder-order').value : 'service-period';
        const periodsInput = document.querySelector('#folder-periods');
        const periodsStr = periodsInput ? periodsInput.value : 'AY 2025-26';
        const periodsList = periodsStr.split(',').map(x => x.trim()).filter(Boolean);
        if (!periodsList.length) periodsList.push('AY 2025-26');

        if (orderBadge) {
          orderBadge.textContent = orderName === 'period-service' ? 'Order: Period / Service' : 'Order: Service / Period';
        }

        let lines = [];
        lines.push(`<div class="tpl-preview-line root">📁 [Client Storage Folder]</div>`);

        if (orderName === 'period-service') {
          for (const p of periodsList) {
            lines.push(`<div class="tpl-preview-line dim" style="margin-left:14px;">├── 📁 ${escapeHtml(p)}</div>`);
            const renderSub = (nodes, depth) => {
              for (const n of nodes) {
                const ind = 14 + depth * 14;
                lines.push(`<div class="tpl-preview-line leaf" style="margin-left:${ind}px;">│   ├── 📁 ${escapeHtml(n.name)}</div>`);
                if (n.children && n.children.length) {
                  renderSub(n.children, depth + 1);
                }
              }
            };
            renderSub(currentTree, 1);
            lines.push(`<div class="tpl-preview-line leaf" style="margin-left:28px;">│   └── 📁 Client Shared Folder / ${escapeHtml(p)}</div>`);
          }
        } else {
          // Service / Period
          for (const n of currentTree) {
            lines.push(`<div class="tpl-preview-line dim" style="margin-left:14px;">├── 📁 ${escapeHtml(n.name)}</div>`);
            for (const p of periodsList) {
              lines.push(`<div class="tpl-preview-line leaf" style="margin-left:28px;">│   ├── 📁 ${escapeHtml(p)}</div>`);
              const renderSub = (children, depth) => {
                for (const ch of children) {
                  const ind = 28 + depth * 14;
                  lines.push(`<div class="tpl-preview-line leaf" style="margin-left:${ind}px;">│   │   └── 📁 ${escapeHtml(ch.name)}</div>`);
                  if (ch.children && ch.children.length) renderSub(ch.children, depth + 1);
                }
              };
              if (n.children && n.children.length) renderSub(n.children, 1);
            }
          }
          for (const p of periodsList) {
            lines.push(`<div class="tpl-preview-line leaf" style="margin-left:14px;">├── 📁 Client Shared Folder / ${escapeHtml(p)}</div>`);
          }
        }
        previewContent.innerHTML = lines.join('');
      } catch (err) {
        previewContent.innerHTML = `<div style="color:var(--muted);padding:10px;">Preview unavailable: ${escapeHtml(err.message)}</div>`;
      }
    };

    const syncCurrentTree = () => {
      const match = allTemplates.find(t => t.category.toLowerCase() === activeCategory.toLowerCase());
      if (match && Array.isArray(match.structure) && match.structure.length) {
        currentTree = JSON.parse(JSON.stringify(match.structure));
      } else if (match && Array.isArray(match.services) && match.services.length) {
        currentTree = match.services.map(s => ({ name: s, children: [] }));
      } else {
        const baseMatch = allTemplates.find(t => t.category.toLowerCase() === 'all clients' || t.category.toLowerCase() === 'individual');
        currentTree = (baseMatch && Array.isArray(baseMatch.structure)) ? JSON.parse(JSON.stringify(baseMatch.structure)) : [];
      }
    };

    const loadDesigner = async () => {
      try {
        allTemplates = await api('/api/category-templates');
        
        // Remove ALL CLIENTS tab from UI - show only individual Firm Types
        const visibleTemplates = allTemplates.filter(t => t.category.toLowerCase() !== 'all clients');
        if (!activeCategory || activeCategory.toLowerCase() === 'all clients' || !visibleTemplates.some(t => t.category.toLowerCase() === activeCategory.toLowerCase())) {
          activeCategory = visibleTemplates[0]?.category || 'Individual';
        }

        const tabsContainer = document.querySelector('#tpl-tabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = visibleTemplates.map(t => {
          const isAct = t.category.toLowerCase() === activeCategory.toLowerCase();
          return `
            <button class="tpl-ft-tab ${isAct ? 'active' : ''}" data-cat="${escapeHtml(t.category)}">
              ${escapeHtml(t.category)}
            </button>
          `;
        }).join('');

        tabsContainer.querySelectorAll('.tpl-ft-tab').forEach(tab => {
          tab.onclick = () => {
            activeCategory = tab.dataset.cat;
            selectedPath = null;
            tabsContainer.querySelectorAll('.tpl-ft-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === activeCategory));
            syncCurrentTree();
            renderTree();
          };
        });

        syncCurrentTree();
        renderTree();
      } catch (err) {
        const resEl = document.querySelector('#tpl-result');
        if (resEl) resEl.innerHTML = message(err.message, true);
      }
    };

    const btnManageFt = document.querySelector('#btn-manage-ft-folders');
    if (btnManageFt) {
      btnManageFt.onclick = () => {
        if (typeof showFirmTypeManagementModal === 'function') {
          showFirmTypeManagementModal();
        }
      };
    }

    let lastRenamedNode = null;

    // Tree actions
    document.querySelector('#tpl-add-root').onclick = () => {
      const name = window.prompt('Enter new Root Folder name:');
      if (!name || !name.trim()) return;
      currentTree.push({ name: name.trim(), children: [] });
      selectedPath = [currentTree.length - 1];
      renderTree();
    };

    document.querySelector('#tpl-add-sub').onclick = () => {
      if (!selectedPath) return;
      const target = getNodeByPath(currentTree, selectedPath);
      if (!target) return;
      const name = window.prompt(`Enter subfolder under "${target.name}":`);
      if (!name || !name.trim()) return;
      if (!target.children) target.children = [];
      target.children.push({ name: name.trim(), children: [] });
      selectedPath = [...selectedPath, target.children.length - 1];
      renderTree();
    };

    document.querySelector('#tpl-rename').onclick = () => {
      if (!selectedPath) return;
      const target = getNodeByPath(currentTree, selectedPath);
      if (!target) return;
      const oldName = target.name;
      const name = window.prompt('Enter new folder name:', target.name);
      if (!name || !name.trim() || name.trim() === oldName) return;
      target.name = name.trim();
      lastRenamedNode = { old_name: oldName, new_name: name.trim() };
      renderTree();
    };

    document.querySelector('#tpl-delete').onclick = () => {
      if (!selectedPath) return;
      const target = getNodeByPath(currentTree, selectedPath);
      if (!target) return;
      if (!window.confirm(`Delete folder "${target.name}" and any subfolders?`)) return;
      const parentArr = getParentArrayByPath(currentTree, selectedPath);
      const idx = selectedPath[selectedPath.length - 1];
      parentArr.splice(idx, 1);
      selectedPath = null;
      renderTree();
    };

    document.querySelector('#tpl-move-up').onclick = () => {
      if (!selectedPath) return;
      const parentArr = getParentArrayByPath(currentTree, selectedPath);
      const idx = selectedPath[selectedPath.length - 1];
      if (idx <= 0) return;
      const item = parentArr.splice(idx, 1)[0];
      parentArr.splice(idx - 1, 0, item);
      selectedPath[selectedPath.length - 1] = idx - 1;
      renderTree();
    };

    document.querySelector('#tpl-move-down').onclick = () => {
      if (!selectedPath) return;
      const parentArr = getParentArrayByPath(currentTree, selectedPath);
      const idx = selectedPath[selectedPath.length - 1];
      if (idx >= parentArr.length - 1) return;
      const item = parentArr.splice(idx, 1)[0];
      parentArr.splice(idx + 1, 0, item);
      selectedPath[selectedPath.length - 1] = idx + 1;
      renderTree();
    };

    document.querySelector('#tpl-save').onclick = async () => {
      const resEl = document.querySelector('#tpl-result');
      const saveBtn = document.querySelector('#tpl-save');
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        const pb = showGlassProgressBar({ title: 'Saving Template Structure', subtitle: `Updating folder hierarchy for "${activeCategory}"...` });
        pb.simulate(750);
        await api('/api/category-templates', {
          method: 'POST',
          body: JSON.stringify({
            category: activeCategory,
            structure: currentTree,
            renamed_node: lastRenamedNode
          })
        });
        lastRenamedNode = null;
        await pb.finish(`Template Structure Saved for "${activeCategory}"`);
        resEl.innerHTML = message(`Folder template for "${activeCategory}" saved successfully!`);
        await loadDesigner();
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        resEl.innerHTML = message(err.message, true);
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#check"/></svg>Save for this Type';
      }
    };

    const applyAllBtn = document.querySelector('#tpl-apply-all');
    if (applyAllBtn) {
      applyAllBtn.onclick = async () => {
        if (!window.confirm(`Apply this current folder structure to ALL firm types?\n\nThis will update folder generation for all entity types across the entire system.`)) return;
        const resEl = document.querySelector('#tpl-result');
        try {
          applyAllBtn.disabled = true;
          const pb = showGlassProgressBar({ title: 'Applying to All Firm Types', subtitle: 'Updating folder templates across all firm types...' });
          pb.simulate(1000);
          await api('/api/category-templates', {
            method: 'POST',
            body: JSON.stringify({
              apply_to_all: true,
              structure: currentTree,
              renamed_node: lastRenamedNode
            })
          });
          lastRenamedNode = null;
          await pb.finish('Applied to All Firm Types');
          resEl.innerHTML = message('Successfully applied folder structure to all firm types!');
          await loadDesigner();
        } catch (err) {
          const existingPb = document.querySelector('.vs-progress-backdrop');
          if (existingPb) existingPb.remove();
          resEl.innerHTML = message(err.message, true);
        } finally {
          applyAllBtn.disabled = false;
        }
      };
    }

    const applySelectedBtn = document.querySelector('#tpl-apply-selected');
    if (applySelectedBtn) {
      applySelectedBtn.onclick = () => {
        const visibleTemplates = allTemplates.filter(t => t.category.toLowerCase() !== 'all clients');
        showApplyToSelectedModal(visibleTemplates, currentTree, lastRenamedNode, async () => {
          lastRenamedNode = null;
          await loadDesigner();
        });
      };
    }

    function showApplyToSelectedModal(templates, treeStructure, renamedNode, onDone) {
      const esc = escapeHtml;
      const overlay = document.createElement('div');
      overlay.className = 'ft-modal-overlay';
      overlay.innerHTML = `
        <div class="ft-modal-dialog" style="width:min(480px,94vw);">
          <button class="modal-close" aria-label="Close">×</button>
          <p class="eyebrow">BATCH TEMPLATE UPDATE</p>
          <h2>Apply Structure to Selected Firm Types</h2>
          <p class="muted" style="font-size:12.5px;">Choose which firm types should receive this folder structure:</p>
          <div style="max-height:40vh;overflow-y:auto;margin:16px 0;background:rgba(255,255,255,0.7);border:1px solid var(--line);border-radius:14px;padding:12px 16px;">
            <div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:12px;font-weight:700;">Select Firm Types:</span>
              <button type="button" class="alt btn-sm" id="btn-toggle-all-sel" style="font-size:11px;padding:2px 8px;">Select All</button>
            </div>
            ${templates.map(t => `
              <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;font-size:13px;font-weight:600;">
                <input type="checkbox" class="ft-select-cb" value="${esc(t.category)}" ${t.category.toLowerCase() === activeCategory.toLowerCase() ? 'checked' : ''} style="width:16px;height:16px;">
                <span>${esc(t.category)}</span>
              </label>
            `).join('')}
          </div>
          <div id="apply-sel-msg"></div>
          <div class="actions" style="margin-top:20px;justify-content:flex-end;gap:8px;">
            <button class="secondary" id="cancel-apply-sel">Cancel</button>
            <button class="primary" id="confirm-apply-sel">Apply to Selected</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('.modal-close').onclick = close;
      overlay.querySelector('#cancel-apply-sel').onclick = close;

      const toggleBtn = overlay.querySelector('#btn-toggle-all-sel');
      let allChecked = false;
      toggleBtn.onclick = () => {
        allChecked = !allChecked;
        overlay.querySelectorAll('.ft-select-cb').forEach(cb => cb.checked = allChecked);
        toggleBtn.textContent = allChecked ? 'Deselect All' : 'Select All';
      };

      overlay.querySelector('#confirm-apply-sel').onclick = async () => {
        const selected = Array.from(overlay.querySelectorAll('.ft-select-cb:checked')).map(cb => cb.value);
        const msgDiv = overlay.querySelector('#apply-sel-msg');
        if (!selected.length) {
          msgDiv.innerHTML = message('Please select at least one firm type.', true);
          return;
        }
        try {
          const pb = showGlassProgressBar({ title: 'Applying to Selected Types', subtitle: `Updating ${selected.length} firm type(s)...` });
          pb.simulate(1000);
          await api('/api/category-templates', {
            method: 'POST',
            body: JSON.stringify({
              apply_to_targets: selected,
              structure: treeStructure,
              renamed_node: renamedNode
            })
          });
          await pb.finish(`Structure Applied to ${selected.length} Types`);
          close();
          if (onDone) onDone();
        } catch (err) {
          msgDiv.innerHTML = message(err.message, true);
        }
      };
    }

    document.querySelector('#tpl-reset-btn').onclick = async () => {
      if (!window.confirm(`Reset template for "${activeCategory}" to default base template?`)) return;
      const resEl = document.querySelector('#tpl-result');
      try {
        const pb = showGlassProgressBar({ title: 'Resetting Template', subtitle: `Restoring base template for "${activeCategory}"...` });
        pb.simulate(600);
        await api('/api/category-templates', {
          method: 'POST',
          body: JSON.stringify({ category: activeCategory, reset_to_base: true })
        });
        await pb.finish('Template Reset Successfully');
        resEl.innerHTML = message(`Template for "${activeCategory}" reset to default.`);
        await loadDesigner();
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        resEl.innerHTML = message(err.message, true);
      }
    };

    // Save Rules & Order button
    document.querySelector('#save-rules-btn').onclick = async () => {
      const resEl = document.querySelector('#rules-result');
      const btn = document.querySelector('#save-rules-btn');
      try {
        btn.disabled = true;
        btn.textContent = 'Saving...';
        const pb = showGlassProgressBar({ title: 'Saving Rules & Dimensions', subtitle: 'Updating folder hierarchy configuration...' });
        pb.simulate(750);
        const periods = document.querySelector('#folder-periods').value.split(',').map(x => x.trim()).filter(Boolean);
        const order_name = document.querySelector('#folder-order').value;
        const flat_services = currentTree.map(n => n.name).filter(Boolean);
        rules = await api('/api/rules', {
          method: 'POST',
          body: JSON.stringify({ services: flat_services.length ? flat_services : ['Income Tax', 'GST'], periods, order_name })
        });
        await pb.finish('Folder Rules Saved Successfully');
        resEl.innerHTML = message('Folder rules and dimension order saved successfully.');
        updatePreview();
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        resEl.innerHTML = message(err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#check"/></svg>Save Rules & Order';
      }
    };

    const orderSel = document.querySelector('#folder-order');
    const periodsInp = document.querySelector('#folder-periods');
    if (orderSel) orderSel.onchange = () => updatePreview();
    if (periodsInp) periodsInp.oninput = () => updatePreview();

    // Create Missing Folders button
    document.querySelector('#create-all-btn').onclick = async () => {
      const resEl = document.querySelector('#rules-result');
      const btn = document.querySelector('#create-all-btn');
      try {
        btn.disabled = true;
        btn.textContent = 'Creating folders...';
        const pb = showGlassProgressBar({ title: 'Creating Folders', subtitle: 'Generating folder hierarchy on Local & Drive for all clients...' });
        pb.simulate(1400);
        const response = await api('/api/create-folders', { method: 'POST', body: '{}' });
        await pb.finish(`Created ${response.folders_created || 0} Folders Successfully`);
        resEl.innerHTML = message(`Folder creation complete: ${response.folders_created} new folders created for ${response.clients} client(s).`);
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        resEl.innerHTML = message(err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#folder"/></svg>Create Missing Folders';
      }
    };

    // Global Scan & Reconcile All Clients button
    document.querySelector('#global-reconcile-btn').onclick = async () => {
      const resEl = document.querySelector('#rules-result');
      const btn = document.querySelector('#global-reconcile-btn');
      try {
        btn.disabled = true;
        btn.textContent = 'Scanning...';
        const pb = showGlassProgressBar({ title: 'Scanning & Reconciling', subtitle: 'Synchronizing client storage with disk...' });
        pb.simulate(1500);
        const r = await api('/api/folders/reconcile', { method: 'POST', body: '{}' });
        await pb.finish(`Reconciled ${r.clients_scanned} Clients Successfully`);
        let summaryMsg = `Reconciliation complete for ${r.clients_scanned} client(s). Total active items: ${r.folders} folder(s), ${r.files} file(s).`;
        if (r.new_folders > 0 || r.new_files > 0) {
          summaryMsg += ` Discovered ${r.new_folders} new folder(s) and ${r.new_files} new file(s).`;
        }
        if (r.missing_folders > 0 || r.missing_files > 0) {
          summaryMsg += ` (${r.missing_folders} folder(s), ${r.missing_files} file(s) missing on disk — retained safely in DB).`;
        }
        resEl.innerHTML = message(summaryMsg);
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        resEl.innerHTML = message(err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#refresh"/></svg>Scan & Reconcile All Clients';
      }
    };

    const qcSelect = content.querySelector('#folders-quick-client-select');
    const btnOpenTree = content.querySelector('#btn-quick-open-tree');
    const btnQuickPdf = content.querySelector('#btn-quick-client-pdf-pwd');

    if (btnOpenTree && qcSelect) {
      btnOpenTree.onclick = () => {
        if (!qcSelect.value) { alert('Please select a client first.'); return; }
        showFolderTree(qcSelect.value);
      };
    }
    if (btnQuickPdf && qcSelect) {
      btnQuickPdf.onclick = () => {
        if (!qcSelect.value) { alert('Please select a client first.'); return; }
        const client = clients.find(c => c.file_no === qcSelect.value);
        if (client) showClientPdfPasswordsModal(client);
      };
    }

    loadDesigner();
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + (units[i] || 'B');
  };

  const formatModifiedTime = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  };

  function showEditClientModal(client) {
    const overlay = document.createElement('div');
    overlay.className = 'portal-modal';
    const activeTypes = firmTypes.filter(ft => ft.status === 'active');
    if (client.client_type && !activeTypes.some(ft => ft.name.toLowerCase() === client.client_type.toLowerCase())) {
      activeTypes.push({ name: client.client_type, status: 'disabled' });
    }
    overlay.innerHTML = `
      <div class="portal-dialog" style="width:min(540px, 94vw);">
        <button class="modal-close" aria-label="Close">×</button>
        <p class="eyebrow">CLIENT MANAGEMENT</p>
        <h2>Edit Client & Rename Storage Folder</h2>
        <p class="muted">Changing the client name will automatically and safely rename their physical storage folder on Local and Google Drive.</p>
        
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px;">
          <div>
            <label style="font-weight:700;">Client Name *</label>
            <input id="edit-client-name" value="${escapeHtml(client.name)}" required>
          </div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-weight:700;">File Number</label>
              <input id="edit-client-fno" value="${escapeHtml(client.file_no)}">
            </div>
            <div>
              <label style="font-weight:700;">Mobile Number *</label>
              <input id="edit-client-mobile" value="${escapeHtml(client.mobile || '')}" required>
            </div>
          </div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-weight:700;">Firm Type *</label>
              <select id="edit-client-type">
                ${activeTypes.map(ft => `<option value="${escapeHtml(ft.name)}" ${ft.name.toLowerCase() === (client.client_type || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(ft.name)}${ft.status === 'disabled' ? ' (Disabled)' : ''}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-weight:700;">Client Group</label>
              <input id="edit-client-group" value="${escapeHtml(client.client_group || '')}">
            </div>
          </div>
          <div>
            <label style="font-weight:700;">Status</label>
            <select id="edit-client-status">
              <option value="Active" ${client.status === 'Active' ? 'selected' : ''}>Active</option>
              <option value="Inactive" ${client.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
        
        <div id="edit-client-msg" style="margin-top:12px;"></div>
        
        <div class="actions" style="margin-top:18px;justify-content:flex-end;gap:8px;">
          <button class="secondary" id="cancel-edit-client">Cancel</button>
          <button class="primary" id="save-edit-client"><svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#check"/></svg>Save & Rename Folders</button>
        </div>
      </div>
    `;
    document.body.append(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('#cancel-edit-client').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    
    overlay.querySelector('#save-edit-client').onclick = async () => {
      const btn = overlay.querySelector('#save-edit-client');
      const msgEl = overlay.querySelector('#edit-client-msg');
      try {
        const newName = overlay.querySelector('#edit-client-name').value.trim();
        const newFno = overlay.querySelector('#edit-client-fno').value.trim();
        const newMobile = overlay.querySelector('#edit-client-mobile').value.trim();
        const newType = overlay.querySelector('#edit-client-type').value.trim();
        const newGroup = overlay.querySelector('#edit-client-group').value.trim();
        const newStatus = overlay.querySelector('#edit-client-status').value;
        
        if (!newName || !newMobile || !newType) {
          throw new Error('Name, mobile, and firm type are required.');
        }
        
        btn.disabled = true;
        btn.textContent = 'Saving...';
        msgEl.innerHTML = message('Updating client and renaming physical folders on disk...');
        
        await api('/api/clients', {
          method: 'POST',
          body: JSON.stringify({
            old_file_no: client.file_no,
            file_no: newFno,
            name: newName,
            mobile: newMobile,
            client_type: newType,
            client_group: newGroup,
            status: newStatus
          })
        });
        
        clients = await api('/api/clients');
        close();
        if (current === 'clients') clientsPage();
      } catch (err) {
        msgEl.innerHTML = message(err.message, true);
        btn.disabled = false;
        btn.innerHTML = '<svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#check"/></svg>Save & Rename Folders';
      }
    };
  }

  // ========================================================
  // PDF SECURITY & PASSWORD MEMORY MODALS
  // ========================================================

  async function showLockPdfModal(client, filePath, storageKind = 'local', onDone = null) {
    const filename = filePath.split('/').pop() || 'document.pdf';
    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    overlay.innerHTML = `
      <div class="pdf-sec-dialog">
        <button class="modal-close" aria-label="Close">×</button>
        <div class="pdf-sec-header">
          <span style="font-size:24px;">🔒</span>
          <div>
            <h3 style="margin:0;">Lock PDF File</h3>
            <p class="muted" style="margin:2px 0 0 0;font-size:12px;">Encrypt PDF with password protection</p>
          </div>
        </div>

        <div class="pdf-meta-box">
          <div><strong>Client:</strong> ${escapeHtml(client.name)} <code>(${escapeHtml(client.file_no)})</code></div>
          <div><strong>File:</strong> <code>${escapeHtml(filename)}</code></div>
          <div id="lock-detect-status" style="font-size:11px;color:var(--muted);margin-top:2px;">Checking PDF encryption status...</div>
        </div>

        <div id="lock-err-box"></div>

        <div>
          <label style="font-weight:600;font-size:12px;">Enter Password *</label>
          <input type="password" id="pdf-lock-pw" placeholder="Enter secure PDF password" style="width:100%;margin-top:4px;">
        </div>

        <div>
          <label style="font-weight:600;font-size:12px;">Confirm Password *</label>
          <input type="password" id="pdf-lock-confirm-pw" placeholder="Re-enter password to confirm" style="width:100%;margin-top:4px;">
        </div>

        <div style="background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" id="pdf-lock-remember" checked>
            <span>Remember password for ${escapeHtml(client.name)}</span>
          </label>
          <div id="pdf-lock-label-wrap">
            <label style="font-size:11px;color:var(--muted);">Password Label / Category (e.g. GST, Income Tax, Bank Statement)</label>
            <input type="text" id="pdf-lock-label" value="GST Password" placeholder="Label for this password" style="width:100%;font-size:11px;margin-top:2px;">
          </div>
        </div>

        <div style="font-size:12px;display:flex;flex-direction:column;gap:6px;">
          <label style="font-weight:600;margin:0;">Output File Option:</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
            <input type="radio" name="lock_output_mode" value="new" checked>
            <span>Save as new locked file (<code>${escapeHtml(filename.replace(/\.pdf$/i, ''))}_locked.pdf</code>)</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
            <input type="radio" name="lock_output_mode" value="replace">
            <span>Replace original file</span>
          </label>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
          <button class="tpl-btn" id="btn-cancel-lock">Cancel</button>
          <button class="tpl-btn primary" id="btn-submit-lock" style="background:#dc2626;border-color:#b91c1c;color:#fff;">🔒 Lock PDF</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('#btn-cancel-lock').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    const statusEl = overlay.querySelector('#lock-detect-status');
    const errBox = overlay.querySelector('#lock-err-box');
    const rememberCb = overlay.querySelector('#pdf-lock-remember');
    const labelWrap = overlay.querySelector('#pdf-lock-label-wrap');
    const submitBtn = overlay.querySelector('#btn-submit-lock');

    rememberCb.onchange = () => { labelWrap.style.display = rememberCb.checked ? 'block' : 'none'; };

    // Inspect file
    try {
      const detect = await api('/api/pdf/detect', {
        method: 'POST',
        body: JSON.stringify({ client_file_no: client.file_no, relative_path: filePath, storage_kind: storageKind })
      });
      if (detect.is_encrypted) {
        statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700;">⚠️ PDF is already password-locked.</span> Locking will update its password.`;
        submitBtn.textContent = '🔒 Update Password & Lock';
      } else {
        statusEl.innerHTML = `<span style="color:#16a34a;font-weight:700;">✓ PDF is currently unencrypted.</span> ${detect.page_count} page(s), ${formatFileSize(detect.file_size)}.`;
      }
    } catch (e) {
      statusEl.textContent = 'Ready to lock.';
    }

    submitBtn.onclick = async () => {
      const pw = overlay.querySelector('#pdf-lock-pw').value;
      const confirmPw = overlay.querySelector('#pdf-lock-confirm-pw').value;
      const remember = rememberCb.checked;
      const label = overlay.querySelector('#pdf-lock-label').value.trim() || 'General Password';
      const replaceOriginal = overlay.querySelector('input[name="lock_output_mode"]:checked').value === 'replace';

      if (!pw) {
        errBox.innerHTML = message('Please enter a password to lock this PDF.', true);
        return;
      }
      if (pw !== confirmPw) {
        errBox.innerHTML = message('Passwords do not match. Please re-enter.', true);
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Encrypting PDF...';
        errBox.innerHTML = '';
        await api('/api/pdf/lock', {
          method: 'POST',
          body: JSON.stringify({
            client_file_no: client.file_no,
            relative_path: filePath,
            storage_kind: storageKind,
            password: pw,
            confirm_password: confirmPw,
            remember_password: remember,
            label: label,
            replace_original: replaceOriginal
          })
        });
        close();
        if (onDone) onDone();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔒 Lock PDF';
        errBox.innerHTML = message(err.message, true);
      }
    };
  }

  async function showUnlockPdfModal(client, filePath, storageKind = 'local', onDone = null) {
    const filename = filePath.split('/').pop() || 'document.pdf';
    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    overlay.innerHTML = `
      <div class="pdf-sec-dialog">
        <button class="modal-close" aria-label="Close">×</button>
        <div class="pdf-sec-header">
          <span style="font-size:24px;">🔓</span>
          <div>
            <h3 style="margin:0;">Unlock PDF File</h3>
            <p class="muted" style="margin:2px 0 0 0;font-size:12px;">Open or permanently decrypt password-protected PDF</p>
          </div>
        </div>

        <div class="pdf-meta-box">
          <div><strong>Client:</strong> ${escapeHtml(client.name)} <code>(${escapeHtml(client.file_no)})</code></div>
          <div><strong>File:</strong> <code>${escapeHtml(filename)}</code></div>
          <div id="unlock-detect-status" style="font-size:11px;color:var(--muted);margin-top:2px;">Checking password status...</div>
        </div>

        <div id="unlock-err-box"></div>

        <div id="saved-cred-container" style="display:none;">
          <label style="font-weight:600;font-size:12px;">Saved Passwords for this Client:</label>
          <div class="pdf-cred-list" id="saved-cred-list"></div>
        </div>

        <div id="manual-pw-section">
          <label style="font-weight:600;font-size:12px;">Enter Password *</label>
          <input type="password" id="pdf-unlock-pw" placeholder="Enter PDF password" style="width:100%;margin-top:4px;">
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin:0;">
              <input type="checkbox" id="pdf-unlock-remember">
              <span>Remember password for ${escapeHtml(client.name)}</span>
            </label>
            <input type="text" id="pdf-unlock-label" placeholder="Label (e.g. GST)" style="flex:1;font-size:11px;padding:3px 8px;display:none;">
          </div>
        </div>

        <div style="background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" id="pdf-unlock-permanent" checked>
            <span>Remove password protection permanently</span>
          </label>
          <div id="perm-options" style="font-size:11px;display:flex;flex-direction:column;gap:4px;padding-left:22px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
              <input type="radio" name="unlock_output_mode" value="new" checked>
              <span>Save as new unencrypted file (<code>${escapeHtml(filename.replace(/\.pdf$/i, ''))}_unlocked.pdf</code>)</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
              <input type="radio" name="unlock_output_mode" value="replace">
              <span>Replace original file (unlocked version replaces locked file)</span>
            </label>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <button class="tpl-btn" id="btn-try-auto-unlock" style="display:none;background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;font-size:11px;">⚡ Try All Saved Passwords</button>
          <div style="display:flex;gap:8px;margin-left:auto;">
            <button class="tpl-btn" id="btn-cancel-unlock">Cancel</button>
            <button class="tpl-btn primary" id="btn-submit-unlock" style="background:#16a34a;border-color:#15803d;color:#fff;">🔓 Unlock PDF</button>
          </div>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('#btn-cancel-unlock').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    const statusEl = overlay.querySelector('#unlock-detect-status');
    const errBox = overlay.querySelector('#unlock-err-box');
    const savedContainer = overlay.querySelector('#saved-cred-container');
    const savedList = overlay.querySelector('#saved-cred-list');
    const manualPwSec = overlay.querySelector('#manual-pw-section');
    const autoBtn = overlay.querySelector('#btn-try-auto-unlock');
    const rememberCb = overlay.querySelector('#pdf-unlock-remember');
    const labelInput = overlay.querySelector('#pdf-unlock-label');
    const permCb = overlay.querySelector('#pdf-unlock-permanent');
    const permOptions = overlay.querySelector('#perm-options');
    const submitBtn = overlay.querySelector('#btn-submit-unlock');

    rememberCb.onchange = () => { labelInput.style.display = rememberCb.checked ? 'block' : 'none'; };
    permCb.onchange = () => { permOptions.style.display = permCb.checked ? 'flex' : 'none'; };

    let selectedCredId = null;
    let savedCreds = [];

    try {
      const detect = await api('/api/pdf/detect', {
        method: 'POST',
        body: JSON.stringify({ client_file_no: client.file_no, relative_path: filePath, storage_kind: storageKind })
      });
      savedCreds = detect.saved_passwords || [];
      if (!detect.is_encrypted) {
        statusEl.innerHTML = `<span style="color:#16a34a;font-weight:700;">✓ This PDF is already unencrypted.</span>`;
      } else {
        statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700;">🔒 Password Protected PDF.</span>`;
      }

      if (savedCreds.length > 0) {
        savedContainer.style.display = 'block';
        autoBtn.style.display = 'inline-flex';
        let credsHtml = '';
        savedCreds.forEach((cred, i) => {
          const isSelected = i === 0;
          if (isSelected) selectedCredId = cred.id;
          credsHtml += `
            <div class="pdf-cred-option ${isSelected ? 'selected' : ''}" data-id="${cred.id}">
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="radio" name="chosen_cred" value="${cred.id}" ${isSelected ? 'checked' : ''}>
                <strong>🔑 ${escapeHtml(cred.label || 'Saved Password')}</strong>
              </div>
              <span class="pdf-cred-badge">${cred.last_used_at ? 'Recently Used' : 'Saved'}</span>
            </div>
          `;
        });
        credsHtml += `
          <div class="pdf-cred-option" data-id="manual">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="radio" name="chosen_cred" value="manual">
              <span>✏ Enter a different password</span>
            </div>
          </div>
        `;
        savedList.innerHTML = credsHtml;

        const updateSelection = (id) => {
          selectedCredId = (id === 'manual') ? null : id;
          savedList.querySelectorAll('.pdf-cred-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.id === String(id));
            const radio = el.querySelector('input[type="radio"]');
            if (radio) radio.checked = (el.dataset.id === String(id));
          });
          manualPwSec.style.display = (id === 'manual') ? 'block' : 'none';
        };

        savedList.querySelectorAll('.pdf-cred-option').forEach(el => {
          el.onclick = () => updateSelection(el.dataset.id);
        });

        manualPwSec.style.display = 'none';
      }
    } catch (e) {
      statusEl.textContent = 'Ready to unlock.';
    }

    autoBtn.onclick = async () => {
      try {
        autoBtn.disabled = true;
        autoBtn.textContent = 'Testing passwords...';
        errBox.innerHTML = '';
        await api('/api/pdf/unlock', {
          method: 'POST',
          body: JSON.stringify({
            client_file_no: client.file_no,
            relative_path: filePath,
            storage_kind: storageKind,
            auto_try_saved: true,
            permanent: permCb.checked,
            replace_original: overlay.querySelector('input[name="unlock_output_mode"]:checked')?.value === 'replace'
          })
        });
        close();
        if (onDone) onDone();
      } catch (err) {
        autoBtn.disabled = false;
        autoBtn.textContent = '⚡ Try All Saved Passwords';
        errBox.innerHTML = message(err.message, true);
      }
    };

    submitBtn.onclick = async () => {
      const isManual = selectedCredId === null;
      const pw = isManual ? overlay.querySelector('#pdf-unlock-pw').value : '';
      const remember = rememberCb.checked;
      const label = overlay.querySelector('#pdf-unlock-label').value.trim() || 'General Password';
      const permanent = permCb.checked;
      const replaceOriginal = overlay.querySelector('input[name="unlock_output_mode"]:checked')?.value === 'replace';

      if (isManual && !pw) {
        errBox.innerHTML = message('Please enter a password to unlock.', true);
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Decrypting PDF...';
        errBox.innerHTML = '';
        await api('/api/pdf/unlock', {
          method: 'POST',
          body: JSON.stringify({
            client_file_no: client.file_no,
            relative_path: filePath,
            storage_kind: storageKind,
            credential_id: selectedCredId,
            password: pw,
            remember_password: remember,
            label: label,
            permanent: permanent,
            replace_original: replaceOriginal
          })
        });
        close();
        if (onDone) onDone();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔓 Unlock PDF';
        errBox.innerHTML = message(err.message, true);
      }
    };
  }

  async function showClientPdfPasswordsModal(client) {
    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    overlay.innerHTML = `
      <div class="pdf-sec-dialog" style="width:min(600px,96vw);">
        <button class="modal-close" aria-label="Close">×</button>
        <div class="pdf-sec-header">
          <span style="font-size:24px;">🔑</span>
          <div>
            <h3 style="margin:0;">PDF Passwords — ${escapeHtml(client.name)}</h3>
            <p class="muted" style="margin:2px 0 0 0;font-size:12px;">Saved passwords for <code>${escapeHtml(client.file_no)}</code> (Encrypted with AES-256-GCM)</p>
          </div>
        </div>

        <div id="pwd-notif-box"></div>

        <div id="pwd-list-box" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">
          <div class="muted" style="font-size:12px;text-align:center;padding:20px;">Loading saved credentials...</div>
        </div>

        <div style="background:rgba(255,255,255,.8);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;margin-top:6px;">
          <strong style="font-size:13px;color:var(--text);">+ Add New PDF Password</strong>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="font-size:11px;font-weight:600;">Label / Type *</label>
              <input type="text" id="new-cred-label" placeholder="e.g. GST, Income Tax, Bank" style="width:100%;font-size:11px;margin-top:2px;">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;">Password *</label>
              <input type="password" id="new-cred-pw" placeholder="Enter password" style="width:100%;font-size:11px;margin-top:2px;">
            </div>
          </div>
          <button class="tpl-btn primary" id="btn-add-new-cred" style="align-self:flex-end;font-size:11px;padding:5px 12px;">+ Save Credential</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    const notifBox = overlay.querySelector('#pwd-notif-box');
    const listBox = overlay.querySelector('#pwd-list-box');

    const loadCreds = async () => {
      try {
        const creds = await api(`/api/clients/${encodeURIComponent(client.file_no)}/pdf-passwords`);
        if (!creds || creds.length === 0) {
          listBox.innerHTML = `
            <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
              <span style="font-size:28px;display:block;margin-bottom:6px;">🔐</span>
              No saved PDF passwords for this client yet. Add one below to enable 1-click automatic unlocking!
            </div>
          `;
          return;
        }

        let html = '';
        creds.forEach(c => {
          html += `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:10px;">
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <strong style="font-size:13px;">🔑 ${escapeHtml(c.label || 'Saved Password')}</strong>
                  <span style="font-family:monospace;color:var(--muted);letter-spacing:2px;font-size:12px;">••••••••</span>
                </div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">
                  Added: ${formatModifiedTime(c.created_at)} ${c.last_used_at ? ' • Last used: ' + formatModifiedTime(c.last_used_at) : ''}
                </div>
              </div>
              <div style="display:flex;gap:4px;">
                <button class="item-act-btn btn-ren-cred" data-id="${c.id}" data-label="${escapeHtml(c.label || '')}" title="Rename Label">✏ Rename</button>
                <button class="item-act-btn btn-chg-cred" data-id="${c.id}" data-label="${escapeHtml(c.label || '')}" title="Change Password">🔑 Change</button>
                <button class="item-act-btn danger btn-del-cred" data-id="${c.id}" data-label="${escapeHtml(c.label || '')}" title="Delete">🗑</button>
              </div>
            </div>
          `;
        });
        listBox.innerHTML = html;

        // Bind Actions
        listBox.querySelectorAll('.btn-ren-cred').forEach(btn => {
          btn.onclick = async () => {
            const oldLabel = btn.dataset.label;
            const newLabel = window.prompt(`Enter new label for "${oldLabel}":`, oldLabel);
            if (!newLabel || !newLabel.trim() || newLabel.trim() === oldLabel) return;
            try {
              notifBox.innerHTML = message('Updating label...');
              await api(`/api/clients/${encodeURIComponent(client.file_no)}/pdf-passwords/update`, {
                method: 'POST',
                body: JSON.stringify({ id: Number(btn.dataset.id), label: newLabel.trim() })
              });
              notifBox.innerHTML = message('Password label updated.');
              await loadCreds();
            } catch (err) {
              notifBox.innerHTML = message(err.message, true);
            }
          };
        });

        listBox.querySelectorAll('.btn-chg-cred').forEach(btn => {
          btn.onclick = async () => {
            const newPw = window.prompt(`Enter new password for "${btn.dataset.label}":`);
            if (!newPw || !newPw.trim()) return;
            try {
              notifBox.innerHTML = message('Updating password...');
              await api(`/api/clients/${encodeURIComponent(client.file_no)}/pdf-passwords/update`, {
                method: 'POST',
                body: JSON.stringify({ id: Number(btn.dataset.id), password: newPw.trim() })
              });
              notifBox.innerHTML = message('Password updated securely.');
              await loadCreds();
            } catch (err) {
              notifBox.innerHTML = message(err.message, true);
            }
          };
        });

        listBox.querySelectorAll('.btn-del-cred').forEach(btn => {
          btn.onclick = async () => {
            if (!window.confirm(`Are you sure you want to delete the saved password for "${btn.dataset.label}"?`)) return;
            try {
              notifBox.innerHTML = message('Deleting credential...');
              await api(`/api/clients/${encodeURIComponent(client.file_no)}/pdf-passwords/delete`, {
                method: 'POST',
                body: JSON.stringify({ id: Number(btn.dataset.id) })
              });
              notifBox.innerHTML = message('Password deleted.');
              await loadCreds();
            } catch (err) {
              notifBox.innerHTML = message(err.message, true);
            }
          };
        });

      } catch (err) {
        listBox.innerHTML = `<div style="color:#dc2626;padding:12px;font-size:12px;">Failed to load passwords: ${err.message}</div>`;
      }
    };

    await loadCreds();

    overlay.querySelector('#btn-add-new-cred').onclick = async () => {
      const label = overlay.querySelector('#new-cred-label').value.trim();
      const pw = overlay.querySelector('#new-cred-pw').value.trim();
      if (!label || !pw) {
        notifBox.innerHTML = message('Label and password are required.', true);
        return;
      }
      try {
        notifBox.innerHTML = message('Saving password securely...');
        await api(`/api/clients/${encodeURIComponent(client.file_no)}/pdf-passwords`, {
          method: 'POST',
          body: JSON.stringify({ label: label, password: pw })
        });
        overlay.querySelector('#new-cred-label').value = '';
        overlay.querySelector('#new-cred-pw').value = '';
        notifBox.innerHTML = message('Password saved successfully.');
        await loadCreds();
      } catch (err) {
        notifBox.innerHTML = message(err.message, true);
      }
    };
  }

  async function showFolderTree(fileNo) {
    const client = clients.find(item => item.file_no === fileNo);
    if (!client) return;

    let currentPath = '';
    let historyStack = [];
    let forwardStack = [];
    let searchQuery = '';
    let storageKind = 'local';
    let canonicalTree = null;
    let overrideInfo = null;

    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    overlay.innerHTML = `
      <div class="explorer-modal-dialog">
        <button class="modal-close" aria-label="Close">×</button>
        
        <!-- HEADER -->
        <div class="explorer-header">
          <div class="explorer-title-group">
            <span style="font-size:22px;">📁</span>
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <h2 style="margin:0;font-size:18px;">${escapeHtml(client.name)}</h2>
                <span class="ft-status-badge active" style="font-size:11px;">${escapeHtml(client.client_type || 'General')}</span>
                <span id="override-pill" class="inherited-badge">Inherited Template</span>
              </div>
              <p class="muted" style="margin:2px 0 0 0;font-size:12px;">File No: <code>${escapeHtml(client.file_no)}</code></p>
            </div>
          </div>

          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <button class="tpl-btn" id="btn-client-pdf-passwords" style="display:flex;align-items:center;gap:4px;background:#fef3c7;border-color:#fde68a;color:#92400e;">🔑 PDF Passwords</button>
            <button class="tpl-btn" id="btn-customize-override" style="display:flex;align-items:center;gap:4px;background:#f0fdf4;border-color:#bbf7d0;color:#166534;">⚙ Customize Structure</button>
            <button class="tpl-btn" id="btn-open-in-explorer" style="display:flex;align-items:center;gap:4px;">🗁 Open Local Folder</button>
            <button class="tpl-btn" id="btn-reconcile-this" style="display:flex;align-items:center;gap:4px;">🔄 Scan & Reconcile</button>
          </div>
        </div>

        <!-- NAVIGATION & SEARCH BAR -->
        <div class="explorer-nav-bar">
          <div class="explorer-nav-btns">
            <button class="nav-icon-btn" id="nav-back" title="Back">⮜</button>
            <button class="nav-icon-btn" id="nav-forward" title="Forward">⮞</button>
            <button class="nav-icon-btn" id="nav-root" title="Client Root">🏠</button>
            <button class="nav-icon-btn" id="nav-refresh" title="Refresh">🔄</button>
          </div>

          <div class="explorer-breadcrumbs" id="crumb-trail"></div>

          <div class="explorer-search-box">
            <input type="text" class="explorer-search-input" id="search-explorer" placeholder="Search within client...">
          </div>
        </div>

        <!-- ACTION TOOLBAR -->
        <div class="explorer-action-bar">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <button class="tpl-btn primary" id="btn-new-subfolder" style="font-size:11px;padding:4px 10px;min-height:28px;">+ New Folder</button>
            <button class="tpl-btn" id="btn-upload-file" style="font-size:11px;padding:4px 10px;min-height:28px;">⬆ Upload File</button>
            <button class="tpl-btn" id="btn-create-missing" style="font-size:11px;padding:4px 10px;min-height:28px;">📁 Create Missing Folders</button>
            <input type="file" id="explorer-file-input" style="display:none;" multiple>
          </div>

          <div style="display:flex;gap:8px;align-items:center;font-size:12px;">
            <label style="margin:0;font-weight:600;color:var(--muted);">Storage:</label>
            <select id="storage-kind-select" style="font-size:11px;padding:2px 8px;border-radius:6px;min-height:28px;border:1px solid var(--line);background:#fff;">
              <option value="local">Local Storage (Office Files)</option>
              ${(window.settings && (window.settings.google_drive_mode === 'only_backup' || window.settings.google_drive_mode === 'disabled')) ? '' : `<option value="drive">Google Drive (${window.settings && window.settings.google_drive_mode === 'only_client' ? 'Client Portal' : 'Cloud Mirror'})</option>`}
            </select>
          </div>
        </div>

        <div id="explorer-notification" style="margin-bottom:8px;"></div>

        <!-- EXPLORER GRID & TABLE CONTAINER -->
        <div class="explorer-grid-container" id="explorer-body">
          <div class="empty-explorer-state">Loading client workspace...</div>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = event => { if (event.target === overlay) close(); };

    const bodyEl = overlay.querySelector('#explorer-body');
    const crumbEl = overlay.querySelector('#crumb-trail');
    const notifEl = overlay.querySelector('#explorer-notification');
    const overridePill = overlay.querySelector('#override-pill');
    const searchInput = overlay.querySelector('#search-explorer');
    const fileInput = overlay.querySelector('#explorer-file-input');
    const storageSelect = overlay.querySelector('#storage-kind-select');
    const pwdBtn = overlay.querySelector('#btn-client-pdf-passwords');
    if (pwdBtn) pwdBtn.onclick = () => showClientPdfPasswordsModal(client);

    const showNotif = (msg, isErr = false) => {
      notifEl.innerHTML = `<div style="margin-bottom:6px;">${message(msg, isErr)}</div>`;
      setTimeout(() => { notifEl.innerHTML = ''; }, 6000);
    };

    // Find node in recursive canonical tree given relative path
    const findNodeByPath = (nodes, targetPath) => {
      if (!targetPath) return { children: nodes, isRoot: true };
      const parts = targetPath.split('/');
      let currList = nodes;
      let currNode = null;
      for (const part of parts) {
        if (!currList) return null;
        currNode = currList.find(n => n.name === part && n.type === 'folder');
        if (!currNode) return null;
        currList = currNode.children;
      }
      return currNode;
    };

    // Recursively collect all items for search
    const collectAllItems = (nodes, parentPath = '') => {
      let list = [];
      for (const n of nodes) {
        const fullRel = parentPath ? `${parentPath}/${n.name}` : n.name;
        list.push({ ...n, full_relative_path: fullRel, parent_path: parentPath });
        if (n.type === 'folder' && n.children && n.children.length > 0) {
          list = list.concat(collectAllItems(n.children, fullRel));
        }
      }
      return list;
    };

    const navigateTo = (newPath, recordHistory = true) => {
      if (recordHistory && newPath !== currentPath) {
        historyStack.push(currentPath);
        forwardStack = [];
      }
      currentPath = newPath.replace(/^\/+|\/+$/g, '');
      render();
    };

    const loadData = async () => {
      try {
        const [treeRes, ovRes] = await Promise.all([
          api(`/api/client-folders/${encodeURIComponent(fileNo)}/tree?storage_kind=${storageKind}`),
          api(`/api/client-folders/${encodeURIComponent(fileNo)}/override`)
        ]);
        canonicalTree = treeRes.tree || [];
        overrideInfo = ovRes;

        if (overrideInfo && overrideInfo.has_override) {
          overridePill.className = 'override-badge';
          overridePill.textContent = 'Custom Override Active';
        } else {
          overridePill.className = 'inherited-badge';
          overridePill.textContent = `Inherited: ${client.client_type || 'Default'}`;
        }
        render();
      } catch (err) {
        bodyEl.innerHTML = `<div class="empty-explorer-state">${message(err.message, true)}</div>`;
      }
    };

    const render = () => {
      // 1. Update Back/Forward Buttons
      overlay.querySelector('#nav-back').disabled = historyStack.length === 0;
      overlay.querySelector('#nav-forward').disabled = forwardStack.length === 0;

      // 2. Render Breadcrumbs
      const pathParts = currentPath ? currentPath.split('/') : [];
      let crumbsHtml = `<span class="crumb-item ${pathParts.length === 0 ? 'active' : ''}" data-path="">🏠 Home</span>`;
      let accumulated = '';
      for (let i = 0; i < pathParts.length; i++) {
        accumulated = accumulated ? `${accumulated}/${pathParts[i]}` : pathParts[i];
        const isLast = i === pathParts.length - 1;
        crumbsHtml += `<span class="crumb-sep">›</span><span class="crumb-item ${isLast ? 'active' : ''}" data-path="${escapeHtml(accumulated)}">${escapeHtml(pathParts[i])}</span>`;
      }
      crumbEl.innerHTML = crumbsHtml;

      crumbEl.querySelectorAll('.crumb-item').forEach(c => {
        c.onclick = () => {
          const target = c.dataset.path;
          if (target !== currentPath) navigateTo(target);
        };
      });

      // 3. Render Search or Directory
      const query = searchQuery.trim().toLowerCase();
      if (query) {
        renderSearch(query);
        return;
      }

      const currentNode = findNodeByPath(canonicalTree, currentPath);
      const rawItems = (currentNode && currentNode.children) ? currentNode.children : [];
      const items = rawItems.filter(n => !(n.name || '').toLowerCase().includes('client shared folder') && !(n.relative_path || '').toLowerCase().includes('client shared folder'));

      if (!items || items.length === 0) {
        bodyEl.innerHTML = `
          <div class="empty-explorer-state">
            <span style="font-size:36px;margin-bottom:8px;">📂</span>
            <strong style="font-size:14px;color:var(--text);">This folder is empty</strong>
            <p class="muted" style="margin:4px 0 12px 0;">No files or subfolders inside <code>${escapeHtml(currentPath || 'Root')}</code></p>
            <div style="display:flex;gap:8px;">
              <button class="tpl-btn primary" id="btn-empty-new-folder">+ Create Folder</button>
              <button class="tpl-btn" id="btn-empty-upload">⬆ Upload File</button>
            </div>
            <div class="dropzone-inline" id="empty-dropzone">
              📄 Drag & Drop PDF files here to upload directly into this folder
            </div>
          </div>
        `;

        bodyEl.querySelector('#btn-empty-new-folder').onclick = promptNewFolder;
        bodyEl.querySelector('#btn-empty-upload').onclick = () => fileInput.click();
        bindDropzone(bodyEl.querySelector('#empty-dropzone'));
        return;
      }

      let rowsHtml = `
        <table class="explorer-table">
          <thead>
            <tr>
              <th style="width:40%;">Name</th>
              <th style="width:16%;">Source / Type</th>
              <th style="width:14%;">Size</th>
              <th style="width:16%;">Modified</th>
              <th style="width:14%;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const item of items) {
        const isFolder = item.type === 'folder';
        const isMissing = item.present === false;
        const itemRel = currentPath ? `${currentPath}/${item.name}` : item.name;

        if (isFolder) {
          const count = item.children ? item.children.length : 0;
          rowsHtml += `
            <tr class="explorer-item-row" data-name="${escapeHtml(item.name)}" data-type="folder" data-path="${escapeHtml(itemRel)}">
              <td>
                <div class="item-name-cell row-open-folder" data-path="${escapeHtml(itemRel)}">
                  <span class="item-icon">📁</span>
                  <span>${escapeHtml(item.name)}</span>
                  ${isMissing ? '<span style="color:#e65100;font-size:10px;font-weight:700;">(missing)</span>' : ''}
                </div>
              </td>
              <td>
                <span class="folder-source ${item.source || 'system'}">${item.source === 'manual' ? 'Manual' : 'System'}</span>
                <span class="file-meta-badge" style="margin-left:4px;">${count} item${count === 1 ? '' : 's'}</span>
              </td>
              <td><span class="muted">—</span></td>
              <td><span class="muted">—</span></td>
              <td style="text-align:right;">
                <div class="item-actions" style="justify-content:flex-end;">
                  <button class="item-act-btn row-open-folder" data-path="${escapeHtml(itemRel)}" title="Open Folder">📂 Open</button>
                  <button class="item-act-btn btn-ren-folder" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Rename">✏</button>
                  <button class="item-act-btn btn-mv-folder" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Move">⤹</button>
                  <button class="item-act-btn danger btn-del-folder" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Delete">🗑</button>
                </div>
              </td>
            </tr>
          `;
        } else {
          rowsHtml += `
            <tr class="explorer-item-row" data-name="${escapeHtml(item.name)}" data-type="file" data-path="${escapeHtml(itemRel)}">
              <td>
                <div class="item-name-cell">
                  <span class="item-icon">${item.name.toLowerCase().endsWith('.pdf') ? '📑' : '📄'}</span>
                  <span>${escapeHtml(item.name)}</span>
                  ${isMissing ? '<span style="color:#e65100;font-size:10px;font-weight:700;">(missing)</span>' : ''}
                </div>
              </td>
              <td><span class="file-meta-badge">File</span></td>
              <td><span class="file-meta-badge">${formatFileSize(item.size_bytes)}</span></td>
              <td><span style="font-size:11px;color:var(--muted);">${formatModifiedTime(item.modified_at)}</span></td>
              <td style="text-align:right;">
                <div class="item-actions" style="justify-content:flex-end;">
                  <a class="item-act-btn" href="/api/client-files/download?client_file_no=${encodeURIComponent(fileNo)}&path=${encodeURIComponent(itemRel)}&storage_kind=${storageKind}" target="_blank" title="View / Download">👁 View</a>
                  ${item.name.toLowerCase().endsWith('.pdf') ? `
                    <button class="item-act-btn btn-lock-pdf" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Lock PDF with Password">🔒 Lock</button>
                    <button class="item-act-btn btn-unlock-pdf" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Unlock PDF">🔓 Unlock</button>
                  ` : ''}
                  <button class="item-act-btn btn-ren-file" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Rename">✏</button>
                  <button class="item-act-btn btn-mv-file" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Move">⤹</button>
                  <button class="item-act-btn btn-cp-file" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Copy">📋</button>
                  <button class="item-act-btn danger btn-del-file" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(itemRel)}" title="Delete">🗑</button>
                </div>
              </td>
            </tr>
          `;
        }
      }

      rowsHtml += `</tbody></table>`;
      bodyEl.innerHTML = rowsHtml;

      // Bind Row Navigation (Double-click or Open button)
      bodyEl.querySelectorAll('.row-open-folder').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          navigateTo(el.dataset.path);
        };
      });

      // Bind PDF Security Actions
      bodyEl.querySelectorAll('.btn-lock-pdf').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          showLockPdfModal(client, btn.dataset.path, storageKind, loadData);
        };
      });

      bodyEl.querySelectorAll('.btn-unlock-pdf').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          showUnlockPdfModal(client, btn.dataset.path, storageKind, loadData);
        };
      });

      // Bind Folder Actions
      bodyEl.querySelectorAll('.btn-ren-folder').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const oldName = btn.dataset.name;
          const oldPath = btn.dataset.path;
          const newName = window.prompt(`Enter new name for folder "${oldName}":`, oldName);
          if (!newName || !newName.trim() || newName.trim() === oldName) return;
          try {
            showNotif('Renaming folder...');
            await api(`/api/client-folders/${encodeURIComponent(fileNo)}/folders/rename`, {
              method: 'POST',
              body: JSON.stringify({ old_relative_path: oldPath, new_name: newName.trim() })
            });
            showNotif(`Folder renamed to "${newName.trim()}" successfully.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      bodyEl.querySelectorAll('.btn-mv-folder').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const oldPath = btn.dataset.path;
          const oldName = btn.dataset.name;
          const targetParent = window.prompt(`Enter destination parent path for folder "${oldName}" (leave empty for Client Root):`, currentPath);
          if (targetParent === null) return;
          try {
            showNotif('Moving folder...');
            await api(`/api/client-folders/${encodeURIComponent(fileNo)}/folders/move`, {
              method: 'POST',
              body: JSON.stringify({ source_relative_path: oldPath, target_parent_path: targetParent.trim(), storage_kind: storageKind })
            });
            showNotif(`Folder moved successfully.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      bodyEl.querySelectorAll('.btn-del-folder').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const fPath = btn.dataset.path;
          const fName = btn.dataset.name;
          if (!window.confirm(`Are you sure you want to delete folder "${fName}" and its contents?`)) return;
          try {
            showNotif('Deleting folder...');
            await api(`/api/client-folders/${encodeURIComponent(fileNo)}/folders/delete`, {
              method: 'POST',
              body: JSON.stringify({ relative_path: fPath, force: true, storage_kind: storageKind })
            });
            showNotif(`Folder "${fName}" deleted.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      // Bind File Actions
      bodyEl.querySelectorAll('.btn-ren-file').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const oldPath = btn.dataset.path;
          const oldName = btn.dataset.name;
          const newName = window.prompt(`Enter new filename:`, oldName);
          if (!newName || !newName.trim() || newName.trim() === oldName) return;
          try {
            showNotif('Renaming file...');
            await api(`/api/client-files/rename`, {
              method: 'POST',
              body: JSON.stringify({ client_file_no: fileNo, relative_path: oldPath, new_filename: newName.trim(), storage_kind: storageKind })
            });
            showNotif(`File renamed.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      bodyEl.querySelectorAll('.btn-mv-file').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const oldPath = btn.dataset.path;
          const oldName = btn.dataset.name;
          const destParent = window.prompt(`Enter destination folder path for "${oldName}" (leave empty for Client Root):`, currentPath);
          if (destParent === null) return;
          try {
            showNotif('Moving file...');
            await api(`/api/client-files/move`, {
              method: 'POST',
              body: JSON.stringify({ client_file_no: fileNo, source_relative_path: oldPath, target_parent_path: destParent.trim(), storage_kind: storageKind })
            });
            showNotif(`File moved.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      bodyEl.querySelectorAll('.btn-cp-file').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const oldPath = btn.dataset.path;
          const oldName = btn.dataset.name;
          const destParent = window.prompt(`Copy "${oldName}" to folder (leave empty for Current Folder):`, currentPath);
          if (destParent === null) return;
          const newName = window.prompt(`Filename for copy:`, `Copy of ${oldName}`);
          if (!newName || !newName.trim()) return;
          try {
            showNotif('Copying file...');
            await api(`/api/client-files/copy`, {
              method: 'POST',
              body: JSON.stringify({ client_file_no: fileNo, source_relative_path: oldPath, target_parent_path: destParent.trim(), new_filename: newName.trim(), storage_kind: storageKind })
            });
            showNotif(`File copied.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });

      bodyEl.querySelectorAll('.btn-del-file').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const fPath = btn.dataset.path;
          const fName = btn.dataset.name;
          if (!window.confirm(`Are you sure you want to delete file "${fName}"?`)) return;
          try {
            showNotif('Deleting file...');
            await api(`/api/client-files/delete`, {
              method: 'POST',
              body: JSON.stringify({ client_file_no: fileNo, relative_path: fPath, storage_kind: storageKind })
            });
            showNotif(`File "${fName}" deleted.`);
            await loadData();
          } catch (err) {
            showNotif(err.message, true);
          }
        };
      });
    };

    const renderSearch = (query) => {
      const allItems = collectAllItems(canonicalTree);
      const matches = allItems.filter(item => item.name.toLowerCase().includes(query) || item.full_relative_path.toLowerCase().includes(query));

      if (matches.length === 0) {
        bodyEl.innerHTML = `
          <div class="empty-explorer-state">
            <span style="font-size:32px;margin-bottom:8px;">🔍</span>
            <strong>No results matching "${escapeHtml(query)}"</strong>
            <p class="muted" style="margin-top:4px;">Try searching for a different folder name or file extension.</p>
          </div>
        `;
        return;
      }

      let html = `
        <div style="padding:10px 14px;background:rgba(238,242,255,.5);border-bottom:1px solid var(--line);font-size:12px;font-weight:700;color:var(--blue);">
          Search Results: ${matches.length} item(s) found
        </div>
        <table class="explorer-table">
          <thead>
            <tr>
              <th style="width:40%;">Name</th>
              <th style="width:40%;">Location / Path</th>
              <th style="width:20%;text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const item of matches) {
        const isFolder = item.type === 'folder';
        html += `
          <tr>
            <td>
              <div class="item-name-cell">
                <span class="item-icon">${isFolder ? '📁' : (item.name.toLowerCase().endsWith('.pdf') ? '📑' : '📄')}</span>
                <strong>${escapeHtml(item.name)}</strong>
              </div>
            </td>
            <td>
              <span style="font-size:11px;color:var(--muted);">${escapeHtml(item.parent_path || 'Root')}</span>
            </td>
            <td style="text-align:right;">
              <div class="item-actions" style="justify-content:flex-end;">
                ${isFolder ? `
                  <button class="item-act-btn btn-jump-folder" data-path="${escapeHtml(item.full_relative_path)}">📂 Jump to Folder</button>
                ` : `
                  <a class="item-act-btn" href="/api/client-files/download?client_file_no=${encodeURIComponent(fileNo)}&path=${encodeURIComponent(item.full_relative_path)}&storage_kind=${storageKind}" target="_blank">👁 View</a>
                  <button class="item-act-btn btn-jump-folder" data-path="${escapeHtml(item.parent_path)}">📂 Open Folder</button>
                `}
              </div>
            </td>
          </tr>
        `;
      }

      html += `</tbody></table>`;
      bodyEl.innerHTML = html;

      bodyEl.querySelectorAll('.btn-jump-folder').forEach(btn => {
        btn.onclick = () => {
          searchInput.value = '';
          searchQuery = '';
          navigateTo(btn.dataset.path);
        };
      });
    };

    const promptNewFolder = async () => {
      const name = window.prompt(`Create new folder inside "${currentPath || 'Client Root'}":`);
      if (!name || !name.trim()) return;
      const targetRel = currentPath ? `${currentPath}/${name.trim()}` : name.trim();
      try {
        const pb = showGlassProgressBar({ title: 'Creating Folder', subtitle: `Creating "${name.trim()}"...` });
        pb.simulate(600);
        await api(`/api/client-folders/${encodeURIComponent(fileNo)}/folders`, {
          method: 'POST',
          body: JSON.stringify({ relative_path: targetRel, storage_kind: storageKind })
        });
        await pb.finish('Folder Created Successfully');
        showNotif(`Folder "${name.trim()}" created successfully.`);
        await loadData();
      } catch (err) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        showNotif(err.message, true);
      }
    };

    const bindDropzone = (zone) => {
      if (!zone) return;
      ['dragenter', 'dragover'].forEach(type => {
        zone.addEventListener(type, e => { e.preventDefault(); zone.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(type => {
        zone.addEventListener(type, e => { e.preventDefault(); zone.classList.remove('drag'); });
      });
      zone.addEventListener('drop', e => {
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          uploadFiles(e.dataTransfer.files);
        }
      });
      zone.onclick = () => fileInput.click();
    };

    const uploadFiles = async (files) => {
      if (!files || !files.length) return;
      const total = files.length;

      const isQueued = (total > 5) || (window.fileSaveQueue && (window.fileSaveQueue.isProcessing() || window.fileSaveQueue.getPendingCount() > 0));
      if (isQueued && window.fileSaveQueue) {
        const fileList = Array.from(files).map(f => ({
          name: f.name,
          fileObj: f
        }));
        window.fileSaveQueue.enqueue({
          client_file_no: fileNo,
          client_name: client.name || fileNo,
          target_folder: currentPath,
          period: 'AY 2025-26',
          save_local: storageKind === 'local' || storageKind === 'both' || (window.settings && window.settings.google_drive_mode === 'only_client'),
          save_drive: (storageKind === 'drive' || storageKind === 'both') && (!window.settings || window.settings.google_drive_mode !== 'only_client'),
          client_visibility: false,
          upload_practive: false,
          files: fileList
        });
        showGlassmorphicSuccessAnimation("Files will be saved shortly");
        showNotif(`📋 ${total} file(s) queued for background saving into /${currentPath || 'Root'}.`);
        return;
      }

      const pb = showGlassProgressBar({ title: 'Uploading Files', subtitle: `Processing ${total} file(s)...`, initialPercent: 5 });
      for (let i = 0; i < total; i++) {
        const f = files[i];
        const pct = Math.round((i / total) * 85) + 5;
        pb.update(pct, `Uploading (${i + 1}/${total}): "${f.name}"...`);
        try {
          const reader = new FileReader();
          const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
          });
          reader.readAsDataURL(f);
          let b64 = await base64Promise;
          let wasAutoDecrypted = false;

          if (f.name.toLowerCase().endsWith('.pdf')) {
            try {
              const detect = await api('/api/pdf/detect', {
                method: 'POST',
                body: JSON.stringify({ client_file_no: fileNo, file_base64: b64 })
              });
              if (detect.is_encrypted) {
                try {
                  const unlockRes = await api('/api/pdf/unlock', {
                    method: 'POST',
                    body: JSON.stringify({ client_file_no: fileNo, file_base64: b64, auto_try_saved: true })
                  });
                  if (unlockRes.output_base64) {
                    b64 = unlockRes.output_base64;
                    wasAutoDecrypted = true;
                  }
                } catch (e) {
                  // Keep as encrypted
                }
              }
            } catch (e) {}
          }

          await api(`/api/client-files/upload`, {
            method: 'POST',
            body: JSON.stringify({
              client_file_no: fileNo,
              relative_path: currentPath,
              filename: f.name,
              file_base64: b64,
              storage_kind: storageKind
            })
          });

          if (wasAutoDecrypted) {
            showNotif(`✓ File "${f.name}" auto-unlocked with saved password and uploaded.`);
          } else {
            showNotif(`File "${f.name}" uploaded successfully.`);
          }
        } catch (err) {
          showNotif(`Failed to upload "${f.name}": ${err.message}`, true);
        }
      }
      await pb.finish(total === 1 ? 'File Uploaded Successfully' : `${total} Files Uploaded Successfully`);
      await loadData();
    };

    // Event Bindings
    overlay.querySelector('#nav-back').onclick = () => {
      if (historyStack.length > 0) {
        forwardStack.push(currentPath);
        const prev = historyStack.pop();
        navigateTo(prev, false);
      }
    };

    overlay.querySelector('#nav-forward').onclick = () => {
      if (forwardStack.length > 0) {
        historyStack.push(currentPath);
        const next = forwardStack.pop();
        navigateTo(next, false);
      }
    };

    overlay.querySelector('#nav-root').onclick = () => navigateTo('');
    overlay.querySelector('#nav-refresh').onclick = () => loadData();

    searchInput.oninput = () => {
      searchQuery = searchInput.value;
      render();
    };

    overlay.querySelector('#btn-new-subfolder').onclick = promptNewFolder;
    overlay.querySelector('#btn-upload-file').onclick = () => fileInput.click();
    fileInput.onchange = e => uploadFiles(e.target.files);

    storageSelect.onchange = () => {
      storageKind = storageSelect.value;
      loadData();
    };

    overlay.querySelector('#btn-open-in-explorer').onclick = async () => {
      try {
        showNotif('Opening local folder in Windows File Explorer...');
        const res = await api(`/api/client-folders/${encodeURIComponent(fileNo)}/open-in-explorer`, {
          method: 'POST',
          body: JSON.stringify({ relative_path: currentPath })
        });
        showNotif(`📂 Opened in Explorer: ${res.opened_path || 'Local Folder'}`);
      } catch (err) {
        showNotif(err.message, true);
      }
    };

    overlay.querySelector('#btn-reconcile-this').onclick = async () => {
      const scanBtn = overlay.querySelector('#btn-reconcile-this');
      try {
        scanBtn.disabled = true;
        scanBtn.textContent = 'Scanning...';
        showNotif('Scanning local disk and updating inventories...');
        const r = await api(`/api/client-folders/${encodeURIComponent(fileNo)}/reconcile`, { method: 'POST', body: '{}' });
        await loadData();
        let notice = `Scan complete: ${r.folders} folder(s), ${r.files} file(s) active.`;
        if (r.new_folders > 0 || r.new_files > 0) {
          notice += ` Discovered ${r.new_folders} new folder(s) and ${r.new_files} new file(s).`;
        }
        showNotif(notice);
      } catch (error) {
        showNotif(error.message, true);
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = '🔄 Scan & Reconcile';
      }
    };

    overlay.querySelector('#btn-create-missing').onclick = async () => {
      const createBtn = overlay.querySelector('#btn-create-missing');
      try {
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        showNotif('Creating template folder structure on disk...');
        const r = await api(`/api/client-folders/${encodeURIComponent(fileNo)}/create`, { method: 'POST', body: '{}' });
        await loadData();
        showNotif(`Folder structure created (${r.folders_created} new folders).`);
      } catch (error) {
        showNotif(error.message, true);
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = '📁 Create Missing Folders';
      }
    };

    overlay.querySelector('#btn-customize-override').onclick = () => {
      showClientOverrideModal(client, () => loadData());
    };

    await loadData();
  }

  // ==========================================
  // CLIENT-SPECIFIC FOLDER OVERRIDE MODAL
  // ==========================================
  async function showClientOverrideModal(client, onSaved) {
    let overrideData = await api(`/api/client-folders/${encodeURIComponent(client.file_no)}/override`);
    let treeState = JSON.parse(JSON.stringify(overrideData.effective_structure || []));
    let selectedPath = null;

    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    overlay.innerHTML = `
      <div class="ft-modal-dialog" style="width:min(880px,94vw);max-height:88vh;">
        <button class="modal-close" aria-label="Close">×</button>
        <p class="eyebrow">CLIENT FOLDER CUSTOMIZATION</p>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap;">
          <h2 style="margin:0;">${escapeHtml(client.name)}</h2>
          <span id="co-status-badge" class="${overrideData.has_override ? 'override-badge' : 'inherited-badge'}">
            ${overrideData.has_override ? 'Custom Override Active' : 'Inherited from ' + (client.client_type || 'Default')}
          </span>
        </div>
        <p class="muted" style="margin-top:0;font-size:12px;">Customize folders specifically for this client without affecting the master Firm Type template.</p>
        
        <div id="co-msg" style="margin-bottom:10px;"></div>

        <div class="tpl-columns" style="margin-top:10px;">
          <!-- LEFT: TREE EDITOR -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);">Client Folder Structure</label>
              <button class="tpl-btn" id="co-add-root" style="font-size:10px;padding:3px 8px;min-height:24px;">+ Add Root Folder</button>
            </div>
            
            <div class="tpl-tree-box" id="co-tree-container" style="max-height:42vh;"></div>
            
            <div class="tpl-toolbar" style="margin-top:10px;">
              <button class="tpl-btn" id="co-btn-subfolder" disabled>+ Subfolder</button>
              <button class="tpl-btn" id="co-btn-rename" disabled>✏ Rename</button>
              <button class="tpl-btn" id="co-btn-up" disabled>▲ Up</button>
              <button class="tpl-btn" id="co-btn-down" disabled>▼ Down</button>
              <button class="tpl-btn danger" id="co-btn-delete" disabled>🗑 Delete</button>
            </div>
          </div>

          <!-- RIGHT: LIVE PREVIEW & INHERITANCE ACTIONS -->
          <div>
            <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px;">Generated Folder Preview</label>
            <div class="tpl-tree-box" id="co-preview-container" style="max-height:42vh;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;"></div>
            
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
              <button class="tpl-btn danger" id="co-btn-reset" style="width:100%;">↺ Reset to Firm Type Default</button>
              <button class="tpl-btn primary" id="co-btn-save" style="width:100%;min-height:36px;font-size:12px;">💾 Save Client Override</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    const treeContainer = overlay.querySelector('#co-tree-container');
    const previewContainer = overlay.querySelector('#co-preview-container');
    const msgEl = overlay.querySelector('#co-msg');

    const updateToolbars = () => {
      const hasSel = selectedPath !== null;
      overlay.querySelector('#co-btn-subfolder').disabled = !hasSel;
      overlay.querySelector('#co-btn-rename').disabled = !hasSel;
      overlay.querySelector('#co-btn-up').disabled = !hasSel;
      overlay.querySelector('#co-btn-down').disabled = !hasSel;
      overlay.querySelector('#co-btn-delete').disabled = !hasSel;
    };

    const renderTree = () => {
      if (!treeState || treeState.length === 0) {
        treeContainer.innerHTML = '<div style="padding:14px;color:var(--muted);font-size:12px;text-align:center;">No folders configured. Click "+ Add Root Folder" to start.</div>';
        updateToolbars();
        renderPreview();
        return;
      }

      const buildHtml = (nodes, currentPathPrefix = '') => {
        let html = '<ul class="tpl-tree">';
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const nodePath = currentPathPrefix ? `${currentPathPrefix}.${i}` : `${i}`;
          const isSelected = selectedPath === nodePath;
          const hasChildren = node.children && node.children.length > 0;

          html += `
            <li>
              <div class="tpl-node ${isSelected ? 'selected' : ''}" data-path="${nodePath}">
                <div class="node-label">
                  <span>${hasChildren ? '📁' : '📂'}</span>
                  <span>${escapeHtml(node.name)}</span>
                </div>
              </div>
              ${hasChildren ? buildHtml(node.children, nodePath) : ''}
            </li>
          `;
        }
        html += '</ul>';
        return html;
      };

      treeContainer.innerHTML = buildHtml(treeState);

      treeContainer.querySelectorAll('.tpl-node').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          selectedPath = el.dataset.path;
          renderTree();
        };
      });

      updateToolbars();
      renderPreview();
    };

    const renderPreview = () => {
      if (!treeState || treeState.length === 0) {
        previewContainer.innerHTML = '<div style="padding:10px;color:var(--muted);">No folders configured.</div>';
        return;
      }
      const renderNodePreview = (nodes, indent = 0) => {
        let html = '';
        for (const n of nodes) {
          const pad = '&nbsp;'.repeat(indent * 4);
          html += `<div class="tpl-preview-line leaf">${pad}📁 ${escapeHtml(n.name)}</div>`;
          if (n.children && n.children.length > 0) {
            html += renderNodePreview(n.children, indent + 1);
          }
        }
        return html;
      };
      previewContainer.innerHTML = `
        <div class="tpl-preview-line root" style="font-weight:700;color:var(--blue);margin-bottom:4px;">
          📁 ${escapeHtml(client.name)} [${escapeHtml(client.file_no)}]
        </div>
        ${renderNodePreview(treeState, 1)}
      `;
    };

    const getNodeByPath = (pathStr) => {
      if (!pathStr) return null;
      const indexes = pathStr.split('.').map(Number);
      let curr = treeState;
      let parent = null;
      let target = null;
      for (const idx of indexes) {
        if (!curr || !curr[idx]) return null;
        parent = curr;
        target = curr[idx];
        curr = target.children;
      }
      return { node: target, parentArray: parent, index: indexes[indexes.length - 1] };
    };

    // Actions
    overlay.querySelector('#co-add-root').onclick = () => {
      const name = window.prompt('Enter new root folder name (e.g. "GST", "Income Tax", "Bank"):');
      if (!name || !name.trim()) return;
      treeState.push({ name: name.trim(), children: [] });
      selectedPath = `${treeState.length - 1}`;
      renderTree();
    };

    overlay.querySelector('#co-btn-subfolder').onclick = () => {
      const found = getNodeByPath(selectedPath);
      if (!found) return;
      const name = window.prompt(`Enter subfolder name inside "${found.node.name}":`);
      if (!name || !name.trim()) return;
      if (!found.node.children) found.node.children = [];
      found.node.children.push({ name: name.trim(), children: [] });
      selectedPath = `${selectedPath}.${found.node.children.length - 1}`;
      renderTree();
    };

    overlay.querySelector('#co-btn-rename').onclick = () => {
      const found = getNodeByPath(selectedPath);
      if (!found) return;
      const newName = window.prompt(`Rename "${found.node.name}" to:`, found.node.name);
      if (!newName || !newName.trim() || newName.trim() === found.node.name) return;
      found.node.name = newName.trim();
      renderTree();
    };

    overlay.querySelector('#co-btn-delete').onclick = () => {
      const found = getNodeByPath(selectedPath);
      if (!found) return;
      if (!window.confirm(`Delete folder "${found.node.name}" from client override?`)) return;
      found.parentArray.splice(found.index, 1);
      selectedPath = null;
      renderTree();
    };

    overlay.querySelector('#co-btn-up').onclick = () => {
      const found = getNodeByPath(selectedPath);
      if (!found || found.index === 0) return;
      const arr = found.parentArray;
      const temp = arr[found.index];
      arr[found.index] = arr[found.index - 1];
      arr[found.index - 1] = temp;
      const parts = selectedPath.split('.');
      parts[parts.length - 1] = String(found.index - 1);
      selectedPath = parts.join('.');
      renderTree();
    };

    overlay.querySelector('#co-btn-down').onclick = () => {
      const found = getNodeByPath(selectedPath);
      if (!found || found.index >= found.parentArray.length - 1) return;
      const arr = found.parentArray;
      const temp = arr[found.index];
      arr[found.index] = arr[found.index + 1];
      arr[found.index + 1] = temp;
      const parts = selectedPath.split('.');
      parts[parts.length - 1] = String(found.index + 1);
      selectedPath = parts.join('.');
      renderTree();
    };

    overlay.querySelector('#co-btn-reset').onclick = async () => {
      if (!window.confirm(`Reset folder structure for ${client.name} back to the "${client.client_type || 'General'}" master template default?`)) return;
      try {
        const btn = overlay.querySelector('#co-btn-reset');
        btn.disabled = true;
        btn.textContent = 'Resetting...';
        await api(`/api/client-folders/${encodeURIComponent(client.file_no)}/override/reset`, { method: 'POST', body: '{}' });
        msgEl.innerHTML = message('Folder structure reset to Firm Type default.');
        close();
        if (onSaved) onSaved();
      } catch (err) {
        msgEl.innerHTML = message(err.message, true);
        overlay.querySelector('#co-btn-reset').disabled = false;
        overlay.querySelector('#co-btn-reset').textContent = '↺ Reset to Firm Type Default';
      }
    };

    overlay.querySelector('#co-btn-save').onclick = async () => {
      try {
        const btn = overlay.querySelector('#co-btn-save');
        btn.disabled = true;
        btn.textContent = 'Saving Override...';
        await api(`/api/client-folders/${encodeURIComponent(client.file_no)}/override`, {
          method: 'POST',
          body: JSON.stringify({ structure: treeState })
        });
        msgEl.innerHTML = message('Client folder override saved successfully.');
        close();
        if (onSaved) onSaved();
      } catch (err) {
        msgEl.innerHTML = message(err.message, true);
        overlay.querySelector('#co-btn-save').disabled = false;
        overlay.querySelector('#co-btn-save').textContent = '💾 Save Client Override';
      }
    };

    renderTree();
  }

  const selectedClientFileNos = new Set();

  function updateBulkBar() {
    const container = document.getElementById('clients-bulk-bar-container');
    if (!container) return;
    const count = selectedClientFileNos.size;
    if (count === 0) {
      container.innerHTML = '';
      return;
    }
    
    container.innerHTML = `
      <div class="clients-bulk-glass-bar">
        <div class="bulk-count">
          <span style="font-size:16px;">☑️</span>
          <span><strong>${count}</strong> client${count > 1 ? 's' : ''} selected</span>
        </div>
        <div class="bulk-actions">
          <button type="button" class="tpl-btn" id="bulk-btn-manage-access" style="background:#eef2ff;color:#3730a3;border-color:#c7d2fe;font-weight:600;padding:6px 12px;font-size:12px;">🌐 Manage Access (${count})</button>
          <button type="button" class="tpl-btn" id="bulk-btn-export" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;font-weight:600;padding:6px 12px;font-size:12px;">📊 Export Selected (${count})</button>
          <button type="button" class="tpl-btn" id="bulk-btn-delete" style="background:#fef2f2;color:#991b1b;border-color:#fecaca;font-weight:600;padding:6px 12px;font-size:12px;">🗑️ Delete Selected (${count})</button>
          <button type="button" class="tpl-btn" id="bulk-btn-deselect" style="background:#f8fafc;color:#64748b;padding:6px 10px;font-size:12px;">✖ Clear Selection</button>
        </div>
      </div>
    `;
    
    container.querySelector('#bulk-btn-manage-access').onclick = () => showBulkManageAccessModal(Array.from(selectedClientFileNos));
    container.querySelector('#bulk-btn-export').onclick = () => {
      const fnos = Array.from(selectedClientFileNos).join(',');
      window.open(`/api/clients/export?format=xlsx&file_nos=${encodeURIComponent(fnos)}`);
    };
    container.querySelector('#bulk-btn-delete').onclick = () => showBulkDeleteModal(Array.from(selectedClientFileNos));
    container.querySelector('#bulk-btn-deselect').onclick = () => {
      selectedClientFileNos.clear();
      document.querySelectorAll('.client-row-checkbox').forEach(cb => cb.checked = false);
      const selectAll = document.getElementById('client-select-all');
      if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
      document.querySelectorAll('#registered-clients-tbody tr').forEach(tr => tr.classList.remove('client-row-selected'));
      updateBulkBar();
    };
  }

  async function renderSecurityAlerts() {
    try {
      const alerts = await api('/api/security-alerts');
      let container = document.getElementById('host-security-alert-container');
      if (!alerts || !alerts.length) {
        if (container) container.innerHTML = '';
        return;
      }
      if (!container) {
        container = document.createElement('div');
        container.id = 'host-security-alert-container';
        container.className = 'host-security-alert-container';
        const contentEl = document.getElementById('content');
        if (contentEl) {
          contentEl.insertBefore(container, contentEl.firstChild);
        }
      }
      container.innerHTML = alerts.map(a => `
        <div class="host-security-alert-bar">
          <div class="alert-left">
            <span class="alert-icon">🚨</span>
            <div>
              <strong style="text-transform:uppercase;color:#7f1d1d;">${escapeHtml(a.title)}:</strong>
              <span style="color:#991b1b;">${escapeHtml(a.message)}</span>
              <span class="muted" style="font-size:11px;margin-left:6px;">${escapeHtml(a.created_at || '')}</span>
            </div>
          </div>
          <button type="button" class="alert-dismiss-btn" data-aid="${a.id}">Dismiss</button>
        </div>
      `).join('');
      
      container.querySelectorAll('.alert-dismiss-btn').forEach(btn => {
        btn.onclick = async () => {
          await api('/api/security-alerts/dismiss', { method: 'POST', body: JSON.stringify({ id: Number(btn.dataset.aid) }) });
          renderSecurityAlerts();
        };
      });
    } catch (e) {}
  }

  async function showBulkDeleteModal(fileNos) {
    if (!fileNos || !fileNos.length) return;
    const targetClients = clients.filter(c => fileNos.includes(c.file_no));
    const count = targetClients.length || fileNos.length;
    
    const overlay = document.createElement('div');
    overlay.className = 'portal-modal';
    
    function renderStep1() {
      overlay.innerHTML = `
        <div class="portal-dialog" style="max-width:540px;border:1px solid #fca5a5;box-shadow:0 20px 40px -15px rgba(239,68,68,0.25);">
          <button class="modal-close" aria-label="Close">×</button>
          <p class="eyebrow" style="color:#dc2626;">PERMANENT CLIENT DELETION</p>
          <h2 style="color:#991b1b;margin-bottom:6px;">Delete ${count} Client${count > 1 ? 's' : ''}</h2>
          <p class="muted" style="margin-bottom:12px;">Choose deletion scope and confirm permanent removal.</p>
          
          <div style="max-height:120px;overflow-y:auto;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:8px 12px;margin-bottom:14px;">
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#9f1239;line-height:1.5;">
              ${targetClients.slice(0, 10).map(c => `<li><strong>${escapeHtml(c.name)}</strong> <span style="font-size:11px;color:#be123c;">(Ref: ${escapeHtml(c.file_no)})</span></li>`).join('')}
              ${targetClients.length > 10 ? `<li style="font-style:italic;">... and ${targetClients.length - 10} more</li>` : ''}
            </ul>
          </div>
          
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
            <label style="font-weight:600;font-size:13px;color:#1e1b4b;">Select Deletion Scope:</label>
            
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;">
              <input type="radio" name="delete-scope" value="db_portal_only" checked style="margin-top:3px;accent-color:#4f46e5;" />
              <div>
                <strong>📄 Remove Software Records & Portal Links Only (Safe)</strong>
                <div class="muted" style="font-size:11px;">Removes client from database and deletes Portal Access PDFs from "Client Access Links". Local physical files & Google Drive remain intact.</div>
              </div>
            </label>
            
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid #fca5a5;border-radius:10px;background:#fff1f2;">
              <input type="radio" name="delete-scope" value="local_files" style="margin-top:3px;accent-color:#ef4444;" />
              <div>
                <strong style="color:#991b1b;">📁 Delete Software Records + Local Physical Folders</strong>
                <div class="muted" style="font-size:11px;">Deletes client records AND completely deletes local folder data on disk ("D:\\Code Trial\\&lt;Client&gt;").</div>
              </div>
            </label>
            
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid #fca5a5;border-radius:10px;background:#fff1f2;">
              <input type="radio" name="delete-scope" value="google_drive" style="margin-top:3px;accent-color:#ef4444;" />
              <div>
                <strong style="color:#991b1b;">☁️ Delete Software Records + Google Drive Cloud Folders</strong>
                <div class="muted" style="font-size:11px;">Deletes client records AND completely removes client folder from Google Drive.</div>
              </div>
            </label>
            
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid #ef4444;border-radius:10px;background:#fef2f2;">
              <input type="radio" name="delete-scope" value="both_local_and_drive" style="margin-top:3px;accent-color:#dc2626;" />
              <div>
                <strong style="color:#7f1d1d;">⚠️ Delete EVERYTHING (Local Disk + Google Drive + Portal Links)</strong>
                <div class="muted" style="font-size:11px;">Complete irreversible destruction across local disk and Google Drive cloud.</div>
              </div>
            </label>
          </div>
          
          <div class="actions" style="display:flex;justify-content:flex-end;gap:10px;">
            <button class="secondary" id="cancel-del-step1">Cancel</button>
            <button class="primary" id="btn-next-del-step" style="background:#dc2626;border-color:#b91c1c;color:#fff;">Continue to Authorization ➔</button>
          </div>
        </div>
      `;
      overlay.querySelector('.modal-close').onclick = () => overlay.remove();
      overlay.querySelector('#cancel-del-step1').onclick = () => overlay.remove();
      overlay.querySelector('#btn-next-del-step').onclick = () => {
        const selectedScope = overlay.querySelector('input[name="delete-scope"]:checked')?.value || 'db_portal_only';
        renderStep2(selectedScope);
      };
    }
    
    function renderStep2(selectedScope) {
      const isDestructive = selectedScope !== 'db_portal_only';
      overlay.innerHTML = `
        <div class="portal-dialog" style="max-width:500px;border:2px solid #ef4444;box-shadow:0 25px 50px -12px rgba(239,68,68,0.35);">
          <button class="modal-close" aria-label="Close">×</button>
          <p class="eyebrow" style="color:#dc2626;">🔐 HOST PC SECURITY VERIFICATION</p>
          <h2 style="color:#7f1d1d;margin-bottom:8px;">Authorize Deletion</h2>
          <p class="muted" style="margin-bottom:12px;">
            ${isDestructive 
              ? '⚠️ <strong>CRITICAL WARNING:</strong> You have selected to permanently delete physical files. This operation CANNOT be undone.' 
              : 'You are deleting <strong>' + count + '</strong> client(s) and their portal access passes.'}
          </p>
          
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;margin-bottom:14px;">
            <label style="font-weight:600;font-size:12px;color:#991b1b;display:block;margin-bottom:6px;">
              Enter Host\'s PC Password / PIN to authorize:
            </label>
            <input type="password" id="delete-host-pin-input" placeholder="Host Password or PIN..." style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid #f87171;font-size:14px;background:#fff;" autofocus />
            <div id="del-pin-error" style="display:none;color:#b91c1c;font-size:12px;font-weight:600;margin-top:6px;"></div>
          </div>
          
          <div class="actions" style="display:flex;justify-content:space-between;align-items:center;">
            <button class="secondary" id="btn-back-del-step">⬅ Back</button>
            <div style="display:flex;gap:8px;">
              <button class="secondary" id="cancel-del-step2">Cancel</button>
              <button class="primary" id="btn-confirm-execute-delete" style="background:#b91c1c;border-color:#991b1b;color:#fff;">🗑️ Execute Deletion</button>
            </div>
          </div>
        </div>
      `;
      overlay.querySelector('.modal-close').onclick = () => overlay.remove();
      overlay.querySelector('#cancel-del-step2').onclick = () => overlay.remove();
      overlay.querySelector('#btn-back-del-step').onclick = () => renderStep1();
      
      const pinInput = overlay.querySelector('#delete-host-pin-input');
      const errBox = overlay.querySelector('#del-pin-error');
      const execBtn = overlay.querySelector('#btn-confirm-execute-delete');
      
      setTimeout(() => pinInput?.focus(), 50);
      pinInput.onkeydown = (e) => {
        if (e.key === 'Enter') execBtn.click();
      };
      
      execBtn.onclick = async () => {
        const pin = pinInput.value.trim();
        if (!pin) {
          errBox.textContent = 'Please enter the Host password or PIN.';
          errBox.style.display = 'block';
          pinInput.focus();
          return;
        }
        
        try {
          execBtn.disabled = true;
          execBtn.textContent = 'Verifying & Deleting...';
          const pb = showGlassProgressBar({ title: 'Authorizing Deletion', subtitle: `Processing ${count} client(s)...` });
          pb.simulate(800);
          
          const res = await api('/api/clients/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({
              client_file_nos: fileNos,
              delete_scope: selectedScope,
              host_pin: pin
            })
          });
          await pb.finish(`Deleted ${res.deleted} Client(s) Successfully`, 'Deletion Completed');
          overlay.remove();
          for (const f of fileNos) selectedClientFileNos.delete(f);
          clients = await api('/api/clients');
          clientsPage();
        } catch (e) {
          const existingPb = document.querySelector('.vs-progress-backdrop');
          if (existingPb) existingPb.remove();
          execBtn.disabled = false;
          execBtn.textContent = '🗑️ Execute Deletion';
          
          errBox.textContent = e.message || 'Incorrect Host Password/PIN. Deletion blocked and reported.';
          errBox.style.display = 'block';
          pinInput.value = '';
          pinInput.focus();
          
          // Re-render security alerts banner on host PC!
          renderSecurityAlerts();
        }
      };
    }
    
    renderStep1();
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  }

  async function showBulkManageAccessModal(fileNos) {
    if (!fileNos || !fileNos.length) return;
    const targetClients = clients.filter(c => fileNos.includes(c.file_no));
    const count = targetClients.length || fileNos.length;
    
    const overlay = document.createElement('div');
    overlay.className = 'portal-modal';
    overlay.innerHTML = `
      <div class="portal-dialog" style="max-width:540px;">
        <button class="modal-close" aria-label="Close">×</button>
        <p class="eyebrow">BULK CLIENT PORTAL MANAGEMENT</p>
        <h2 style="margin-bottom:6px;">Manage Access for ${count} Client${count > 1 ? 's' : ''}</h2>
        <p class="muted" style="margin-bottom:16px;">Select an access management action to apply to all selected clients.</p>
        
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
          <label style="font-weight:600;font-size:13px;">Choose Action:</label>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;">
              <input type="radio" name="bulk-access-action" value="generate" checked style="accent-color:#4f46e5;" />
              <div>
                <strong>🌐 Generate / Refresh Official Portal PDFs</strong>
                <div class="muted" style="font-size:12px;">Creates and organizes official client portal access passes with QR codes.</div>
              </div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;">
              <input type="radio" name="bulk-access-action" value="block" style="accent-color:#ef4444;" />
              <div>
                <strong style="color:#b91c1c;">🔒 Block Client Portals</strong>
                <div class="muted" style="font-size:12px;">Temporarily suspend client cloud visibility with a notice.</div>
              </div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;">
              <input type="radio" name="bulk-access-action" value="unblock" style="accent-color:#10b981;" />
              <div>
                <strong style="color:#047857;">🔓 Restore / Unblock Portals</strong>
                <div class="muted" style="font-size:12px;">Re-enable document access and restore portal visibility.</div>
              </div>
            </label>
          </div>
        </div>
        
        <div id="bulk-block-options" style="display:none;background:#fff1f2;padding:12px;border-radius:10px;border:1px solid #fecdd3;margin-bottom:16px;">
          <label style="font-weight:600;font-size:13px;color:#991b1b;">Block Reason:</label>
          <select id="bulk-portal-reason" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #fca5a5;">
            <option>Payment Due</option>
            <option>Portal Under Maintenance</option>
            <option>Temporary Suspension</option>
            <option>Custom Message</option>
          </select>
          <div id="bulk-custom-msg-wrap" style="display:none;margin-top:8px;">
            <label style="font-size:12px;color:#991b1b;">Custom Message:</label>
            <textarea id="bulk-portal-custom-msg" placeholder="Message shown to clients" style="width:100%;border-radius:8px;padding:8px;border:1px solid #fca5a5;font-size:12px;"></textarea>
          </div>
        </div>
        
        <div class="actions" style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="secondary" id="cancel-bulk-access">Cancel</button>
          <button class="primary" id="confirm-bulk-access">Apply Action</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    overlay.querySelector('#cancel-bulk-access').onclick = close;
    
    const radioInputs = overlay.querySelectorAll('input[name="bulk-access-action"]');
    const blockOptions = overlay.querySelector('#bulk-block-options');
    const reasonSelect = overlay.querySelector('#bulk-portal-reason');
    const customWrap = overlay.querySelector('#bulk-custom-msg-wrap');
    
    radioInputs.forEach(r => {
      r.onchange = () => {
        blockOptions.style.display = r.value === 'block' ? 'block' : 'none';
      };
    });
    
    reasonSelect.onchange = () => {
      customWrap.style.display = reasonSelect.value === 'Custom Message' ? 'block' : 'none';
    };
    
    overlay.querySelector('#confirm-bulk-access').onclick = async () => {
      const selectedAction = overlay.querySelector('input[name="bulk-access-action"]:checked')?.value || 'generate';
      const reason = reasonSelect.value;
      const customMsg = overlay.querySelector('#bulk-portal-custom-msg')?.value || '';
      
      try {
        overlay.remove();
        const actionLabels = {
          generate: 'Generating Portal Access Passes',
          block: 'Blocking Client Portals',
          unblock: 'Restoring Client Portals'
        };
        const pb = showGlassProgressBar({ title: actionLabels[selectedAction] || 'Processing Access', subtitle: `Applying to ${count} client(s)...` });
        pb.simulate(1200);
        
        const res = await api('/api/clients/bulk-manage-access', {
          method: 'POST',
          body: JSON.stringify({
            client_file_nos: fileNos,
            action: selectedAction,
            reason: reason,
            custom_message: customMsg
          })
        });
        
          await pb.finish(`Processed ${res.processed} Client(s) Successfully`, 'Client Access Updated');
          clients = await api('/api/clients');
          clientsPage();
        } catch (e) {
          const existingPb = document.querySelector('.vs-progress-backdrop');
          if (existingPb) existingPb.remove();
          alert('Error updating client access: ' + e.message);
        }
    };
  }

  function bindClientTableActions() {
    const table = document.querySelector('#registered-clients-table') || document.querySelector('#content .card table');
    if (!table) return;
    
    // Add Actions column header if not present
    const theadTr = table.querySelector('thead tr');
    if (theadTr && !theadTr.querySelector('.th-actions')) {
      const th = document.createElement('th');
      th.className = 'th-actions';
      th.textContent = 'Actions';
      th.style.textAlign = 'right';
      theadTr.appendChild(th);
    }
    
    // Master select all checkbox
    const selectAllCb = table.querySelector('#client-select-all');
    if (selectAllCb) {
      selectAllCb.onclick = (e) => {
        const checked = e.target.checked;
        table.querySelectorAll('.client-row-checkbox').forEach(cb => {
          cb.checked = checked;
          const fno = cb.dataset.fno;
          if (fno) {
            if (checked) selectedClientFileNos.add(fno);
            else selectedClientFileNos.delete(fno);
          }
          const tr = cb.closest('tr');
          if (tr) tr.classList.toggle('client-row-selected', checked);
        });
        updateBulkBar();
      };
    }
    
    // Bind checkboxes and Actions buttons to each row
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const fileNo = tr.dataset.fno || tr.cells[1]?.textContent.trim() || tr.cells[0]?.textContent.trim();
      if (!fileNo) return;
      const client = clients.find(c => c.file_no === fileNo);
      if (!client) return;
      
      const cb = tr.querySelector('.client-row-checkbox');
      if (cb) {
        cb.checked = selectedClientFileNos.has(fileNo);
        tr.classList.toggle('client-row-selected', cb.checked);
        cb.onchange = (e) => {
          if (e.target.checked) selectedClientFileNos.add(fileNo);
          else selectedClientFileNos.delete(fileNo);
          tr.classList.toggle('client-row-selected', e.target.checked);
          
          if (selectAllCb) {
            const allCbs = table.querySelectorAll('.client-row-checkbox');
            const checkedCount = table.querySelectorAll('.client-row-checkbox:checked').length;
            selectAllCb.checked = checkedCount > 0 && checkedCount === allCbs.length;
            selectAllCb.indeterminate = checkedCount > 0 && checkedCount < allCbs.length;
          }
          updateBulkBar();
        };
      }
      
      if (!tr.querySelector('.td-actions')) {
        const td = document.createElement('td');
        td.className = 'td-actions';
        td.style.textAlign = 'right';
        td.innerHTML = `
          <div class="acts">
            <button class="btn ib tip btn-client-edit" data-t="Edit" aria-label="Edit client" data-fno="${escapeHtml(client.file_no)}"><svg class="i"><use href="#edit"/></svg></button>
            <button class="btn ib tip btn-client-tree" data-t="Open folders" aria-label="Open folders" data-fno="${escapeHtml(client.file_no)}"><svg class="i"><use href="#folder"/></svg></button>
            <button class="btn ib tip btn-client-portal" data-t="Client portal" aria-label="Client portal" data-fno="${escapeHtml(client.file_no)}"><svg class="i"><use href="#drive"/></svg></button>
            <button class="btn ib d tip btn-client-delete" data-t="Delete" aria-label="Delete ${escapeHtml(client.name)}" data-del="${escapeHtml(client.name)}" data-fno="${escapeHtml(client.file_no)}"><svg class="i"><use href="#trash"/></svg></button>
          </div>
        `;
        tr.appendChild(td);
      }

    });
    
    table.querySelectorAll('.btn-client-portal').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        portalDialog(btn.dataset.fno);
      };
    });
    table.querySelectorAll('.btn-client-edit').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const client = clients.find(c => c.file_no === btn.dataset.fno);
        if (client) showEditClientModal(client);
      };
    });
    table.querySelectorAll('.btn-client-tree').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showFolderTree(btn.dataset.fno);
      };
    });
    table.querySelectorAll('.btn-client-pdf-pwd').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const client = clients.find(c => c.file_no === btn.dataset.fno);
        if (client) showClientPdfPasswordsModal(client);
      };
    });
    table.querySelectorAll('.btn-client-delete').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showBulkDeleteModal([btn.dataset.fno]);
      };
    });
    
    updateBulkBar();
  }
  window.bindClientTableActions = bindClientTableActions;

  const originalClientsPage = clientsPage;
  clientsPage = function () {
    originalClientsPage();
    bindClientTableActions();
    renderSecurityAlerts();
  };

  async function portalDialog(fileNo) {
    const client = clients.find(item => item.file_no === fileNo); if (!client) return;
    const blocks = await api('/api/client-portals/blocks');
    const block = blocks.find(item => item.client_file_no === fileNo);
    const overlay = document.createElement('div'); overlay.className = 'portal-modal';
    overlay.innerHTML = `<div class="portal-dialog"><button class="modal-close" aria-label="Close">×</button><p class="eyebrow">CLIENT PORTAL</p><h2>${client.name}</h2><p class="muted">${block ? 'This portal is currently blocked: ' + block.reason : 'Control document visibility through this client’s shared link.'}</p>${block ? '<div class="notice">Documents are safely archived and will be restored when access is unblocked.</div><div class="actions"><button class="primary" id="unblock-portal">Restore client access</button></div>' : '<label>Reason</label><select id="portal-reason"><option>Payment Due</option><option>Portal Under Maintenance</option><option>Temporary Suspension</option><option>Custom Message</option></select><div id="custom-reason-wrap" hidden><label>Custom message</label><textarea id="portal-custom-message" placeholder="Message shown to the client"></textarea></div><div class="actions"><button class="primary" id="block-portal">Block client portal</button></div>'}</div>`;
    document.body.append(overlay);
    const close = () => overlay.remove(); overlay.querySelector('.modal-close').onclick=close; overlay.onclick=event=>{if(event.target===overlay)close();};
    const reason = overlay.querySelector('#portal-reason'); if (reason) reason.onchange=()=>overlay.querySelector('#custom-reason-wrap').hidden=reason.value!=='Custom Message';
    const blockButton = overlay.querySelector('#block-portal'); if (blockButton) blockButton.onclick=async()=>{try{blockButton.disabled=true;blockButton.textContent='Blocking portal...';await api('/api/client-portals/block',{method:'POST',body:JSON.stringify({client_file_no:fileNo,reason:reason.value,custom_message:overlay.querySelector('#portal-custom-message')?.value||''})});close();clientsPage();}catch(error){blockButton.disabled=false;blockButton.textContent=error.message;}};
    const unblockButton = overlay.querySelector('#unblock-portal'); if (unblockButton) unblockButton.onclick=async()=>{try{unblockButton.disabled=true;unblockButton.textContent='Restoring...';await api('/api/client-portals/unblock',{method:'POST',body:JSON.stringify({client_file_no:fileNo})});close();clientsPage();}catch(error){unblockButton.disabled=false;unblockButton.textContent=error.message;}};
  }

  // Automatically ensure the creator credit footer is present in every modal/dialogue/popup
  function attachModalCredits(container = document) {
    const dialogSelectors = [
      '.portal-dialog',
      '.ft-modal-dialog',
      '.import-modal',
      '.custom-modal-card',
      '.auth-card',
      '.modal-content',
      '.vs-progress-card',
      '.dialog'
    ];
    
    dialogSelectors.forEach(selector => {
      container.querySelectorAll(selector).forEach(dialog => {
        if (!dialog.querySelector('.modal-credit-footer')) {
          const footer = document.createElement('div');
          footer.className = 'modal-credit-footer';
          footer.textContent = "© Designed & Created By Rudraksh Sikhwal";
          dialog.appendChild(footer);
        }
      });
    });
  }

  attachModalCredits(document);
  document.addEventListener('click', () => {
    setTimeout(attachModalCredits, 50);
  });
})();
