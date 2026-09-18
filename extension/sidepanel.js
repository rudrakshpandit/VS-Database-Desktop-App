// ========================================================
// VS DATABASE CHROME SIDE PANEL CONTROLLER
// ========================================================

const $ = id => document.getElementById(id);

let clientList = [];
let fileQueue = [];
let filingMode = 'single'; // 'single' | 'bulk'
let selectedClientFileNo = '';
let selectedClientName = '';
let selectedTargetFolder = '';
let currentFolderData = [];
let folderPathStack = [];

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Split base name and file extension
function splitFileNameAndExt(filename) {
  if (!filename) return { baseName: 'document', ext: '.pdf' };
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return { baseName: filename, ext: '' };
  return {
    baseName: filename.substring(0, lastDot),
    ext: filename.substring(lastDot)
  };
}

// Helper: Format bytes
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: Get icon for file extension
function getFileIcon(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['zip', 'rar', '7z'].includes(ext)) return '📦';
  if (['png', 'jpg', 'jpeg'].includes(ext)) return '🖼️';
  return '📁';
}

// Background API Call Proxy
async function apiCall(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'VS_API_CALL',
      url,
      method: options.method || 'GET',
      body: options.body || null
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.ok) {
        reject(new Error(response?.error || 'Database connection error'));
      } else {
        resolve(response.data);
      }
    });
  });
}

// Convert File to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Toast notification helper
function showToast(msg, isError = false, duration = 4000) {
  const t = $('sidepanel-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast-msg ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    if (t.textContent === msg) {
      t.className = 'toast-msg';
    }
  }, duration);
}

// ========================================================
// INITIALIZATION & CLIENT MANAGEMENT
// ========================================================
async function initSidePanel() {
  await loadClients();
  await checkExistingPendingFiles();
  setupEventListeners();
  checkServerHealth();
}

async function checkServerHealth() {
  const badge = $('server-status-badge');
  const text = $('server-status-text');
  try {
    const clients = await apiCall('/api/clients');
    if (Array.isArray(clients)) {
      badge.className = 'status-badge';
      text.textContent = 'Connected';
    }
  } catch (_) {
    badge.className = 'status-badge offline';
    text.textContent = 'Offline';
  }
}

async function loadClients() {
  // 1. Fast load from local cache
  try {
    const store = await chrome.storage.local.get(['cached_clients', 'last_selected_client']);
    if (store.cached_clients && store.cached_clients.length > 0) {
      clientList = store.cached_clients;
      renderClientSelect(clientList);
      if (store.last_selected_client) {
        selectClient(store.last_selected_client);
      }
    }
  } catch (_) {}

  // 2. Fetch fresh clients from server
  try {
    const clients = await apiCall('/api/clients');
    if (Array.isArray(clients) && clients.length > 0) {
      clientList = clients;
      await chrome.storage.local.set({ cached_clients: clients });
      renderClientSelect(clientList);
      const store = await chrome.storage.local.get(['last_selected_client']);
      if (store.last_selected_client) {
        selectClient(store.last_selected_client);
      }
    }
  } catch (err) {
    if (!clientList.length) {
      showToast('Cannot connect to VS Database server. Please ensure the app is open.', true);
    }
  }
}

function renderClientSelect(clients, filterText = '') {
  const select = $('client-select');
  const countBadge = $('client-count-badge');
  select.innerHTML = '<option value="">-- Choose Client --</option>';

  let filtered = clients;
  if (filterText && filterText.trim()) {
    const q = filterText.trim().toLowerCase();
    filtered = clients.filter(c => 
      (c.name || '').toLowerCase().includes(q) || 
      (c.file_no || '').toLowerCase().includes(q)
    );
  }

  filtered.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.file_no;
    opt.textContent = `${c.file_no} - ${c.name}`;
    select.appendChild(opt);
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} client${filtered.length === 1 ? '' : 's'}`;
  }

  if (selectedClientFileNo) {
    select.value = selectedClientFileNo;
  }
}

function selectClient(fileNo) {
  const select = $('client-select');
  select.value = fileNo;
  selectedClientFileNo = fileNo;
  const opt = select.selectedOptions[0];
  selectedClientName = opt ? opt.text.replace(/^[^-]+-\s*/, '') : fileNo;
  chrome.storage.local.set({ last_selected_client: fileNo });
  loadFolderTree(fileNo);
  updateSaveButtonState();
}

// ========================================================
// FOLDER TREE EXPLORER
// ========================================================
// ========================================================
// FOLDER TREE EXPLORER (EXACT WEBSITE MODULE)
// ========================================================
let navPath = '';

function updateFolderDisplay() {
  const badge = $('sidepanel-selected-badge');
  const resetBtn = $('btn-reset-folder');
  if (selectedTargetFolder) {
    badge.textContent = '/' + selectedTargetFolder;
    badge.style.color = '#2563eb';
    badge.style.background = '#eff6ff';
    if (resetBtn) resetBtn.style.display = 'inline-block';
  } else {
    badge.textContent = '/ (Client Root)';
    badge.style.color = '#1e40af';
    badge.style.background = '#f1f5f9';
    if (resetBtn) resetBtn.style.display = 'none';
  }
}

async function loadFolderTree(fileNo) {
  const container = $('folder-tree-container');
  if (!fileNo) {
    currentFolderData = [];
    navPath = '';
    selectedTargetFolder = '';
    updateFolderDisplay();
    container.innerHTML = '<div style="padding:10px;text-align:center;font-size:11.5px;color:var(--text-light);">Select a client to view folders</div>';
    return;
  }

  container.innerHTML = '<div style="padding:10px;text-align:center;font-size:11.5px;color:var(--primary);font-weight:600;">Loading folder structure... ⏳</div>';

  try {
    const storageKind = $('storage-kind-select').value || 'local';
    const res = await apiCall(`/api/client-folders/${encodeURIComponent(fileNo)}/tree?storage_kind=${storageKind}`);
    currentFolderData = res.tree || [];
    navPath = '';
    selectedTargetFolder = '';
    updateFolderDisplay();
    renderFolderTree();
  } catch (err) {
    container.innerHTML = `<div style="padding:10px;text-align:center;font-size:11.5px;color:var(--error);">Failed to load folders: ${escapeHtml(err.message)}</div>`;
  }
}

function findSubNode(nodes, p) {
  if (!p) return { children: nodes };
  const parts = p.split('/');
  let curr = nodes;
  let target = null;
  for (const part of parts) {
    if (!curr) return null;
    target = curr.find(n => n.name === part && n.type === 'folder');
    if (!target) return null;
    curr = target.children;
  }
  return target;
}

function renderFolderTree() {
  const container = $('folder-tree-container');
  const breadcrumb = $('folder-breadcrumb-text');
  const upBtn = $('btn-folder-up');

  breadcrumb.textContent = navPath ? `📁 /${navPath}` : '📁 / (Client Root)';
  if (upBtn) upBtn.disabled = !navPath;

  if (!selectedClientFileNo) {
    container.innerHTML = '<div style="padding:10px;text-align:center;font-size:11.5px;color:var(--text-light);">Select a client to view folders</div>';
    return;
  }

  const node = findSubNode(currentFolderData, navPath);
  const folders = (node && node.children) ? node.children.filter(n => n.type === 'folder') : [];

  if (folders.length === 0) {
    container.innerHTML = `
      <div style="padding:10px;text-align:center;font-size:11px;color:var(--text-muted);">
        No subfolders here.<br>
        <button type="button" id="btn-sidepanel-empty-use" class="btn-action-sm" style="margin-top:6px;font-size:10.5px;background:var(--primary);color:#fff;font-weight:700;">
          ✓ Use ${escapeHtml(navPath ? '/' + navPath : 'Client Root')}
        </button>
      </div>
    `;
    const emptyBtn = $('btn-sidepanel-empty-use');
    if (emptyBtn) {
      emptyBtn.onclick = () => {
        selectedTargetFolder = navPath;
        updateFolderDisplay();
        renderFolderTree();
      };
    }
    return;
  }

  container.innerHTML = folders.map(f => {
    const subCount = (f.children && Array.isArray(f.children)) ? f.children.filter(n => n.type === 'folder').length : 0;
    const itemPath = navPath ? `${navPath}/${f.name}` : f.name;
    const isSelected = selectedTargetFolder === itemPath;
    return `
      <div class="folder-tree-item ${isSelected ? 'selected' : ''}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin:2px 0;">
        <div class="side-folder-name-btn" data-path="${escapeHtml(itemPath)}" style="cursor:pointer;flex:1;display:flex;align-items:center;gap:5px;overflow:hidden;margin-right:6px;">
          <span>📁</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escapeHtml(f.name)}</span>
          ${subCount > 0 ? `<small style="color:var(--text-light);font-size:10px;">(${subCount})</small>` : ''}
          ${isSelected ? `<span style="color:var(--primary);font-weight:700;font-size:9.5px;">✓</span>` : ''}
        </div>
        <div style="display:flex;gap:3px;flex-shrink:0;">
          <button type="button" class="btn-side-folder-select btn-action-sm" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 7px;background:${isSelected ? 'var(--primary)' : '#fff'};color:${isSelected ? '#fff' : 'inherit'};font-weight:700;">Select</button>
          ${subCount > 0 ? `<button type="button" class="btn-side-folder-open btn-action-sm" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 6px;">›</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-side-folder-select').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedTargetFolder = btn.getAttribute('data-path') || '';
      updateFolderDisplay();
      renderFolderTree();
    };
  });

  container.querySelectorAll('.btn-side-folder-open, .side-folder-name-btn').forEach(el => {
    el.onclick = () => {
      navPath = el.getAttribute('data-path') || '';
      selectedTargetFolder = navPath;
      updateFolderDisplay();
      renderFolderTree();
    };
  });
}

// ========================================================
// FILE QUEUE & REAL-TIME DETECTION
// ========================================================
async function checkExistingPendingFiles() {
  const store = await chrome.storage.local.get(['pending_detected_file', 'latest_download_detected', 'bulk_pending_files', 'bulk_mode']);
  if (store.bulk_mode && Array.isArray(store.bulk_pending_files) && store.bulk_pending_files.length > 0) {
    filingMode = 'bulk';
    $('btn-mode-bulk')?.classList.add('active');
    $('btn-mode-single')?.classList.remove('active');
    fileQueue = [];
    store.bulk_pending_files.forEach(f => addFileToQueue(f));
    chrome.storage.local.remove(['bulk_pending_files', 'bulk_mode']);
    return;
  }

  const pending = store.pending_detected_file || store.latest_download_detected;
  if (pending && pending.filename) {
    addFileToQueue({
      id: pending.downloadId || pending.id || `file_${Date.now()}`,
      filename: pending.filename,
      size: pending.fileSize || pending.file_size || 0,
      mime: pending.mime || pending.file_type || 'application/octet-stream',
      source_url: pending.source_url || pending.url || '',
      downloadId: pending.downloadId || pending.id,
      base64: pending.file_base64 || null,
      is_pending: !pending.file_base64
    });
  }
}

// Listen for storage updates and runtime messages
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.pending_detected_file?.newValue) {
      const item = changes.pending_detected_file.newValue;
      if (item && item.filename) {
        addFileToQueue({
          id: item.downloadId || item.id || `file_${Date.now()}`,
          filename: item.filename,
          size: item.fileSize || item.file_size || 0,
          mime: item.mime || item.file_type || 'application/octet-stream',
          source_url: item.source_url || item.url || '',
          downloadId: item.downloadId || item.id,
          base64: item.file_base64 || null,
          is_pending: !item.file_base64
        });
      }
    }
    if (changes.bulk_pending_files?.newValue && Array.isArray(changes.bulk_pending_files.newValue)) {
      filingMode = 'bulk';
      $('btn-mode-bulk')?.classList.add('active');
      $('btn-mode-single')?.classList.remove('active');
      fileQueue = [];
      changes.bulk_pending_files.newValue.forEach(f => addFileToQueue(f));
    }
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_DOWNLOAD_INTERCEPTED' && message.file) {
    addFileToQueue({
      id: message.file.downloadId || message.file.id || `file_${Date.now()}`,
      filename: message.file.filename,
      size: message.file.fileSize || 0,
      mime: message.file.mime || 'application/octet-stream',
      source_url: message.file.source_url || '',
      downloadId: message.file.downloadId,
      is_pending: true
    });
  }

  if (message.type === 'BULK_FILES_LOADED' && Array.isArray(message.files)) {
    filingMode = 'bulk';
    $('btn-mode-bulk')?.classList.add('active');
    $('btn-mode-single')?.classList.remove('active');
    fileQueue = [];
    message.files.forEach(f => addFileToQueue(f));
  }
});

function addFileToQueue(fileObj) {
  const parts = splitFileNameAndExt(fileObj.filename);
  const queueItem = {
    ...fileObj,
    baseName: parts.baseName,
    fileExt: parts.ext,
    is_editing_name: false
  };

  if (filingMode === 'single') {
    // Single Save mode: replace queue with single intercepted file
    fileQueue = [queueItem];
  } else {
    // Bulk Filing mode: accumulate files
    const existingIdx = fileQueue.findIndex(x => 
      (fileObj.downloadId && x.downloadId === fileObj.downloadId) || 
      (x.filename === fileObj.filename && x.size === fileObj.size)
    );

    if (existingIdx !== -1) {
      fileQueue[existingIdx] = { ...fileQueue[existingIdx], ...queueItem };
    } else {
      fileQueue.push(queueItem);
    }
  }

  renderFileQueue();
  updateSaveButtonState();
  showToast(`⚡ Intercepted "${fileObj.filename}" (${filingMode === 'bulk' ? `Bulk Mode: ${fileQueue.length} files` : 'Single Save'})`);
}

function renderFileQueue() {
  const container = $('file-queue-container');
  const countBadge = $('queue-count-badge');

  countBadge.textContent = `${fileQueue.length} file${fileQueue.length === 1 ? '' : 's'}`;

  if (fileQueue.length === 0) {
    container.innerHTML = `
      <div id="empty-queue-placeholder" style="text-align:center;padding:12px 6px;color:var(--text-light);font-size:12px;">
        ⚡ Downloads will automatically appear here
      </div>
    `;
    return;
  }

  let html = '';
  fileQueue.forEach((item, idx) => {
    const isEditing = item.is_editing_name;

    html += `
      <div class="file-item-card" data-idx="${idx}">
        <div class="file-item-main">
          <div class="file-icon-box">${getFileIcon(item.filename)}</div>
          <div class="file-info">
            <div class="file-name-row" title="${escapeHtml(item.filename)}">
              ${escapeHtml(item.filename)}
            </div>
            <div class="file-meta-row">
              <span>${formatBytes(item.size)}</span>
              <span>•</span>
              <span style="color:${item.is_pending ? 'var(--primary)' : 'var(--success)'};font-weight:600;">
                ${item.is_pending ? '⚡ Background capture' : '✓ Ready'}
              </span>
            </div>
          </div>
        </div>

        <!-- Inline Rename Box -->
        ${isEditing ? `
          <div class="rename-box-wrap">
            <input type="text" class="rename-base-input" data-idx="${idx}" value="${escapeHtml(item.baseName)}" placeholder="Document name" />
            <span class="rename-ext-badge">${escapeHtml(item.fileExt)}</span>
            <button type="button" class="btn-action-sm btn-save-rename" data-idx="${idx}" style="background:var(--primary);color:#fff;border-color:var(--primary);">✓</button>
            <button type="button" class="btn-action-sm btn-cancel-rename" data-idx="${idx}">✕</button>
          </div>
        ` : `
          <div class="file-actions">
            <button type="button" class="btn-action-sm btn-edit-name" data-idx="${idx}">✏️ Rename</button>
            <button type="button" class="btn-action-sm delete btn-remove-file" data-idx="${idx}">🗑 Remove</button>
          </div>
        `}
      </div>
    `;
  });

  container.innerHTML = html;

  // Attach Rename Listeners
  container.querySelectorAll('.btn-edit-name').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      fileQueue[idx].is_editing_name = true;
      renderFileQueue();
      const input = container.querySelector(`.rename-base-input[data-idx="${idx}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    };
  });

  container.querySelectorAll('.btn-save-rename').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      saveRename(idx);
    };
  });

  container.querySelectorAll('.rename-base-input').forEach(input => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = parseInt(input.dataset.idx, 10);
        saveRename(idx);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const idx = parseInt(input.dataset.idx, 10);
        fileQueue[idx].is_editing_name = false;
        renderFileQueue();
      }
    };
  });

  container.querySelectorAll('.btn-cancel-rename').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      fileQueue[idx].is_editing_name = false;
      renderFileQueue();
    };
  });

  // Attach Delete Listener
  container.querySelectorAll('.btn-remove-file').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const removed = fileQueue.splice(idx, 1)[0];
      renderFileQueue();
      updateSaveButtonState();
      showToast(`Removed "${removed.filename}"`);
    };
  });
}

function saveRename(idx) {
  const container = $('file-queue-container');
  const input = container.querySelector(`.rename-base-input[data-idx="${idx}"]`);
  if (!input) return;

  const item = fileQueue[idx];
  let newBase = input.value.trim();
  if (!newBase) newBase = item.baseName || 'document';
  newBase = newBase.replace(/[<>:"/\\|?*]/g, '_');
  if (newBase.toLowerCase().endsWith(item.fileExt.toLowerCase())) {
    newBase = newBase.substring(0, newBase.length - item.fileExt.length);
  }

  item.baseName = newBase;
  item.filename = `${newBase}${item.fileExt}`;
  item.is_editing_name = false;
  renderFileQueue();
  showToast(`Renamed to "${item.filename}"`);
}

function updateSaveButtonState() {
  const btn = $('btn-save-all');
  const hasClient = !!selectedClientFileNo;
  const hasFiles = fileQueue.length > 0;

  btn.disabled = !(hasClient && hasFiles);
  if (fileQueue.length <= 1) {
    btn.textContent = '💾 Save Document';
  } else {
    btn.textContent = `💾 Save All (${fileQueue.length}) Documents`;
  }
}

// ========================================================
// SAVE ALL FILES (SYNCHRONOUS VERIFIED PIPELINE)
// ========================================================
async function saveAllDocuments() {
  const btn = $('btn-save-all');
  if (!selectedClientFileNo) {
    showToast('Please select a client first.', true);
    return;
  }
  if (!fileQueue.length) {
    showToast('No documents in queue to save.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving Documents... ⏳';

  const storageKind = $('storage-kind-select').value || 'local';
  const uploadPractive = $('check-practive-sync').checked;
  const savedResults = [];

  try {
    for (let i = 0; i < fileQueue.length; i++) {
      const item = fileQueue[i];
      btn.textContent = `Moving & Routing ${i + 1} of ${fileQueue.length}... ⏳`;

      const res = await apiCall('/api/file-router/route', {
        method: 'POST',
        body: {
          source_path: item.source_path || '',
          file_base64: item.base64 || null,
          client_file_no: selectedClientFileNo,
          document_name: item.filename,
          target_folder: selectedTargetFolder,
          collision_action: 'keep_both',
          save_local: storageKind === 'local',
          save_drive: storageKind === 'drive',
          upload_practive: uploadPractive
        }
      });
      savedResults.push(res);
    }

    // Clean storage & reset queue
    await chrome.storage.local.remove(['pending_smart_prompt', 'pending_detected_file', 'latest_download_detected']);
    fileQueue = [];
    renderFileQueue();
    updateSaveButtonState();

    const destFolder = selectedTargetFolder ? `/${selectedTargetFolder}` : 'Root';
    showToast(`✓ Successfully saved ${savedResults.length} file${savedResults.length === 1 ? '' : 's'} into ${destFolder} for ${selectedClientName}!`, false, 6000);

    // Reload folder tree to show newly saved files
    await loadFolderTree(selectedClientFileNo);
  } catch (err) {
    showToast(`Save Error: ${err.message}`, true, 6000);
  } finally {
    btn.disabled = false;
    updateSaveButtonState();
  }
}

// ========================================================
// EVENT LISTENERS SETUP
// ========================================================
function setupEventListeners() {
  // Mode Switch Buttons
  const singleBtn = $('mode-btn-single');
  const bulkBtn = $('mode-btn-bulk');

  if (singleBtn && bulkBtn) {
    singleBtn.onclick = () => {
      filingMode = 'single';
      singleBtn.classList.add('active');
      bulkBtn.classList.remove('active');
      if (fileQueue.length > 1) {
        fileQueue = [fileQueue[fileQueue.length - 1]];
        renderFileQueue();
        updateSaveButtonState();
      }
      showToast('⚡ Switched to Single Save Mode');
    };

    bulkBtn.onclick = () => {
      filingMode = 'bulk';
      bulkBtn.classList.add('active');
      singleBtn.classList.remove('active');
      showToast('📦 Switched to Bulk Filing Mode — Multiple downloads will collect here');
    };
  }

  // Client Search input
  $('client-search').oninput = (e) => {
    renderClientSelect(clientList, e.target.value);
  };

  // Client Selection Change
  $('client-select').onchange = (e) => {
    selectClient(e.target.value);
  };

  // Storage Kind Change
  $('storage-kind-select').onchange = () => {
    if (selectedClientFileNo) {
      loadFolderTree(selectedClientFileNo);
    }
  };

  // Refresh Buttons
  $('btn-refresh-all').onclick = () => {
    loadClients();
    checkServerHealth();
    showToast('Refreshed clients and connection');
  };

  // Folder Navigation Toolbar Buttons
  const upBtn = $('btn-folder-up');
  if (upBtn) {
    upBtn.onclick = () => {
      if (!navPath) return;
      const parts = navPath.split('/');
      parts.pop();
      navPath = parts.join('/');
      selectedTargetFolder = navPath;
      updateFolderDisplay();
      renderFolderTree();
    };
  }

  const rootBtn = $('btn-folder-root');
  if (rootBtn) {
    rootBtn.onclick = () => {
      navPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderFolderTree();
    };
  }

  const useCurrentBtn = $('btn-use-current-folder');
  if (useCurrentBtn) {
    useCurrentBtn.onclick = () => {
      selectedTargetFolder = navPath;
      updateFolderDisplay();
      renderFolderTree();
      showToast(`Selected: /${selectedTargetFolder || 'Client Root'}`);
    };
  }

  const resetFolderBtn = $('btn-reset-folder');
  if (resetFolderBtn) {
    resetFolderBtn.onclick = () => {
      selectedTargetFolder = '';
      navPath = '';
      updateFolderDisplay();
      renderFolderTree();
      showToast('Reset destination to Client Root');
    };
  }

  // Drag and Drop Zone
  const dropzone = $('dropzone');
  const fileInput = $('file-input-hidden');

  dropzone.onclick = () => fileInput.click();

  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  };

  dropzone.ondragleave = () => {
    dropzone.classList.remove('dragover');
  };

  dropzone.ondrop = async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handlePickedFiles(e.dataTransfer.files);
    }
  };

  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files.length) {
      handlePickedFiles(e.target.files);
      fileInput.value = '';
    }
  };

  // Save All Action
  $('btn-save-all').onclick = saveAllDocuments;
}

async function handlePickedFiles(files) {
  for (const file of files) {
    const b64 = await fileToBase64(file);
    addFileToQueue({
      id: `local_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      filename: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      base64: b64,
      is_pending: false
    });
  }
}

// Start side panel
document.addEventListener('DOMContentLoaded', initSidePanel);
