const $ = id => document.getElementById(id);
let selectedFiles = [];
let cachedClientsList = [];
let canonicalClientTree = [];
let navCurrentPath = '';
let selectedTargetFolder = '';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function splitFileNameAndExt(fullName) {
  const name = String(fullName || '').trim();
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) {
    return { base: name || 'Document', ext: '.pdf' };
  }
  const base = name.substring(0, lastDot);
  const ext = name.substring(lastDot);
  return { base: base || 'Document', ext: ext || '.pdf' };
}

const say = (x, bad = false) => {
  const el = $('status');
  if (el) el.innerHTML = `<span style="color:${bad ? '#b42318' : '#166534'}">${x}</span>`;
};

async function apiCall(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        type: 'VS_API_CALL',
        url: endpoint,
        method: options.method || 'GET',
        body: options.body
      }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          const candidatePorts = ['8767'];
          for (const port of candidatePorts) {
            try {
              const targetUrl = endpoint.startsWith('http') ? endpoint : `http://127.0.0.1:${port}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
              const r = await fetch(targetUrl, {
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
                body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
              });
              if (r.ok) {
                const data = await r.json();
                return resolve(data);
              }
            } catch (_) {}
          }
          reject(new Error('Cannot reach VS Database server.'));
        } else if (res.ok) {
          resolve(res.data);
        } else {
          reject(new Error(res.error || 'API call failed'));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return '📑';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return '📊';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (name.endsWith('.zip') || name.endsWith('.rar')) return '📦';
  if (name.endsWith('.json') || name.endsWith('.xml')) return '⚙️';
  return '📄';
}

async function fileToBase64(file) {
  if (file.file_base64) return file.file_base64;
  if (typeof FileReader !== 'undefined' && file instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result || '';
        resolve(res.includes(',') ? res.split(',')[1] : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function renderClientDropdown(clients) {
  const selectEl = $('client');
  if (!selectEl) return;
  const curVal = selectEl.value;
  selectEl.innerHTML = '<option value="">Select client...</option>' + clients.map(c => `<option value="${c.file_no}">${escapeHtml(c.name)} (${c.file_no})</option>`).join('');
  if (curVal && clients.some(c => c.file_no === curVal)) {
    selectEl.value = curVal;
  }
}

async function loadClients() {
  const store = await chrome.storage.local.get(['cached_clients']);
  if (Array.isArray(store.cached_clients) && store.cached_clients.length > 0) {
    cachedClientsList = store.cached_clients;
    renderClientDropdown(cachedClientsList);
  }

  try {
    const clients = await apiCall('/api/clients');
    if (Array.isArray(clients) && clients.length > 0) {
      cachedClientsList = clients;
      renderClientDropdown(clients);
      await chrome.storage.local.set({ cached_clients: clients });
      say(`Connected: ${clients.length} clients loaded.`);
      $('health').textContent = 'Online';
      $('server-dot').style.background = '#22c55e';
    }
  } catch (err) {
    if (!cachedClientsList.length) {
      say('Cannot connect to VS Database: ' + err.message, true);
      $('health').textContent = 'Offline';
      $('server-dot').style.background = '#ef4444';
    }
  }
}

async function checkPendingDetectedFile() {
  const store = await chrome.storage.local.get(['pending_detected_file', 'latest_download_detected']);
  const pending = store.pending_detected_file || store.latest_download_detected;
  const banner = $('detected-file-banner');
  const renameBtn = $('btn-rename-selected');

  if (pending && pending.filename) {
    if (pending.file_base64) {
      try {
        const binaryString = atob(pending.file_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const file = new File([bytes], pending.filename, { type: pending.file_type || 'application/octet-stream' });
        selectedFiles = [file];
        $('file-label').textContent = `${file.name} (${formatBytes(file.size)})`;

        if (banner) {
          banner.style.display = 'block';
          $('detected-file-name').textContent = pending.filename;
          $('detected-file-icon').textContent = getFileIcon(pending.filename);
          $('detected-file-info').textContent = `${formatBytes(file.size)} • Pre-detected and ready`;
        }
        if (renameBtn) renameBtn.style.display = 'inline-block';
        say(`Pre-detected file ready: ${pending.filename}`);
      } catch (e) {
        console.warn('Error constructing pending file:', e);
      }
    } else {
      selectedFiles = [{
        name: pending.filename,
        size: pending.fileSize || pending.file_size || 0,
        type: pending.file_type || pending.mime || 'application/octet-stream',
        source_url: pending.source_url || pending.url || '',
        downloadId: pending.downloadId || pending.id,
        is_pending: true
      }];
      $('file-label').textContent = `${pending.filename} (⚡ Detected Download)`;

      if (banner) {
        banner.style.display = 'block';
        $('detected-file-name').textContent = pending.filename;
        $('detected-file-icon').textContent = getFileIcon(pending.filename);
        $('detected-file-info').textContent = '⚡ Ready to file into client folder';
      }
      if (renameBtn) renameBtn.style.display = 'inline-block';
      say(`Detected download ready: ${pending.filename}`);

      if (pending.source_url || pending.url) {
        chrome.runtime.sendMessage({
          type: 'FETCH_REMOTE_DOCUMENT',
          url: pending.source_url || pending.url,
          downloadId: pending.downloadId || pending.id
        }, (res) => {
          if (res && res.ok && res.base64) {
            if (selectedFiles.length && selectedFiles[0].name === pending.filename) {
              selectedFiles[0].file_base64 = res.base64;
              selectedFiles[0].is_pending = false;
              $('file-label').textContent = `${pending.filename} (${formatBytes(res.size || pending.file_size || 0)}) ✓`;
              if ($('detected-file-info')) $('detected-file-info').textContent = '✓ Captured and ready to file';
            }
          }
        });
      }
    }
  } else {
    if (banner) banner.style.display = 'none';
  }
}

function setupRenameHandlers() {
  const renameBox = $('popup-rename-box');
  const baseInput = $('popup-rename-basename');
  const extBadge = $('popup-rename-ext-badge');
  const btnSave = $('btn-popup-rename-save');
  const btnCancel = $('btn-popup-rename-cancel');

  const openRename = () => {
    const curName = (selectedFiles.length && selectedFiles[0].name) ? selectedFiles[0].name : $('detected-file-name')?.textContent || 'document.pdf';
    const { base, ext } = splitFileNameAndExt(curName);
    baseInput.value = base;
    extBadge.textContent = ext;
    renameBox.style.display = 'block';
    if ($('detected-file-banner')) $('detected-file-banner').style.display = 'block';
    baseInput.focus();
    baseInput.select();
  };

  if ($('btn-rename-detected')) $('btn-rename-detected').onclick = openRename;
  if ($('btn-rename-selected')) $('btn-rename-selected').onclick = openRename;

  const doSaveRename = async () => {
    const rawBase = baseInput.value.trim().replace(/[/\\?%*:|"<>]/g, '_');
    if (!rawBase) {
      say('Filename cannot be empty.', true);
      return;
    }
    const ext = extBadge.textContent.trim() || '.pdf';
    const newFullName = `${rawBase}${ext}`;

    if (selectedFiles.length > 0) {
      if (selectedFiles[0] instanceof File) {
        try {
          const b64 = await fileToBase64(selectedFiles[0]);
          const binaryString = atob(b64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          selectedFiles[0] = new File([bytes], newFullName, { type: selectedFiles[0].type });
        } catch (_) {
          selectedFiles[0] = { ...selectedFiles[0], name: newFullName };
        }
      } else {
        selectedFiles[0].name = newFullName;
      }
    }

    if ($('detected-file-name')) $('detected-file-name').textContent = newFullName;
    $('file-label').textContent = `${newFullName} (${selectedFiles[0]?.size ? formatBytes(selectedFiles[0].size) : 'Ready'})`;
    renameBox.style.display = 'none';

    const store = await chrome.storage.local.get(['pending_detected_file']);
    if (store.pending_detected_file) {
      store.pending_detected_file.filename = newFullName;
      await chrome.storage.local.set({ pending_detected_file: store.pending_detected_file });
    }

    say(`✓ Renamed document to: ${newFullName}`);
  };

  if (btnSave) btnSave.onclick = doSaveRename;
  if (baseInput) {
    baseInput.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSaveRename(); }
      if (e.key === 'Escape') { e.preventDefault(); renameBox.style.display = 'none'; }
    };
  }
  if (btnCancel) {
    btnCancel.onclick = () => {
      renameBox.style.display = 'none';
    };
  }
}

function showFiles(files) {
  selectedFiles = [...files];
  $('file-label').textContent = selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected (${selectedFiles.map(f => f.name).join(', ')})` : 'Click or drop document here';
  if ($('btn-rename-selected')) $('btn-rename-selected').style.display = selectedFiles.length === 1 ? 'inline-block' : 'none';
  updatePdfSecurityCard();
}

async function loadClientTree(fileNo) {
  if (!fileNo) {
    canonicalClientTree = [];
    selectedTargetFolder = '';
    updateSelectedFolderDisplay();
    renderFolderNav();
    return;
  }
  const listEl = $('folder-nav-list');
  if (listEl) listEl.innerHTML = '<div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">Loading folder structure...</div>';
  try {
    const storageKind = $('storage-kind')?.value || 'local';
    const res = await apiCall(`/api/client-folders/${encodeURIComponent(fileNo)}/tree?storage_kind=${storageKind}`);
    canonicalClientTree = res.tree || [];
    navCurrentPath = '';
    renderFolderNav();
  } catch (err) {
    canonicalClientTree = [];
    if (listEl) listEl.innerHTML = `<div style="padding:10px;font-size:11px;color:#dc2626;text-align:center;">Cannot load folders: ${err.message}</div>`;
  }
}

function findNode(nodes, relPath) {
  if (!relPath) return { children: nodes };
  const parts = relPath.split('/');
  let currList = nodes;
  let curr = null;
  for (const p of parts) {
    if (!currList) return null;
    curr = currList.find(n => n.name === p && n.type === 'folder');
    if (!curr) return null;
    currList = curr.children;
  }
  return curr;
}

function renderFolderNav() {
  const listEl = $('folder-nav-list');
  const crumbEl = $('folder-nav-current-crumb');
  const upBtn = $('folder-nav-up');
  if (!listEl) return;

  crumbEl.textContent = navCurrentPath ? `/${navCurrentPath}` : '/ (Client Root)';
  upBtn.disabled = !navCurrentPath;

  const node = findNode(canonicalClientTree, navCurrentPath);
  const items = (node && node.children) ? node.children : [];
  const folders = items.filter(x => x.type === 'folder');

  if (folders.length === 0) {
    listEl.innerHTML = `
      <div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">
        No subfolders here.<br>
        <span style="font-size:10px;color:#94a3b8;">Click "✓ Select This" to file into this folder.</span>
      </div>
    `;
    return;
  }

  let html = '';
  folders.forEach(f => {
    const subRel = navCurrentPath ? `${navCurrentPath}/${f.name}` : f.name;
    const isSel = selectedTargetFolder === subRel;
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;margin:2px 0;background:${isSel ? '#eff6ff' : '#f8fafc'};border:1px solid ${isSel ? '#bfdbfe' : '#e2e8f0'};border-radius:8px;font-size:11px;">
        <div class="ext-folder-open-btn" data-path="${escapeHtml(subRel)}" style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <span>📁</span>
          <strong style="color:#1e293b;">${escapeHtml(f.name)}</strong>
        </div>
        <div style="display:flex;gap:4px;">
          <button type="button" class="ext-folder-select-btn" data-path="${escapeHtml(subRel)}" style="font-size:9.5px;padding:2px 6px;border-radius:6px;border:1px solid ${isSel ? '#2563eb' : '#cbd5e1'};background:${isSel ? '#2563eb' : '#fff'};color:${isSel ? '#fff' : '#1e40af'};cursor:pointer;font-weight:700;">
            ${isSel ? '✓ Selected' : 'Select'}
          </button>
          <button type="button" class="ext-folder-name-btn" data-path="${escapeHtml(subRel)}" style="font-size:9.5px;padding:2px 5px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#475569;cursor:pointer;">
            Open ❯
          </button>
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('.ext-folder-select-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedTargetFolder = btn.getAttribute('data-path') || '';
      updateSelectedFolderDisplay();
      say(`Folder selected: ${selectedTargetFolder}`);
      renderFolderNav();
    };
  });

  listEl.querySelectorAll('.ext-folder-open-btn, .ext-folder-name-btn').forEach(el => {
    el.onclick = () => {
      navCurrentPath = el.getAttribute('data-path') || '';
      renderFolderNav();
    };
  });
}

function updateSelectedFolderDisplay() {
  const lbl = $('selected-folder-label');
  const resetBtn = $('btn-reset-folder-sel');
  if (selectedTargetFolder) {
    lbl.textContent = '/' + selectedTargetFolder;
    lbl.style.color = '#2563eb';
    resetBtn.style.display = 'inline-block';
  } else {
    lbl.textContent = '/ (Client Root)';
    lbl.style.color = '#1e40af';
    resetBtn.style.display = 'none';
  }
}

async function updatePdfSecurityCard() {
  const card = $('pdf-security-card');
  if (!card) return;

  const currentFile = selectedFiles.length > 0 ? selectedFiles[0] : null;
  const isPdf = currentFile && (currentFile.name || '').toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    card.style.display = 'none';
    if ($('popup-lock-form')) $('popup-lock-form').style.display = 'none';
    if ($('popup-unlock-form')) $('popup-unlock-form').style.display = 'none';
    return;
  }

  card.style.display = 'block';
  const badge = $('pdf-sec-status-badge');
  const desc = $('pdf-sec-desc');
  const fno = $('client')?.value || '';

  const pwdSelect = $('popup-saved-password-select');
  const pwdWrap = $('popup-saved-passwords-wrap');
  const autoTryBtn = $('btn-popup-auto-try');

  if (fno) {
    try {
      const creds = await apiCall(`/api/clients/${encodeURIComponent(fno)}/pdf-passwords`);
      if (creds && creds.length > 0) {
        pwdWrap.style.display = 'block';
        if (autoTryBtn) autoTryBtn.style.display = 'inline-flex';
        pwdSelect.innerHTML = creds.map(c => `<option value="${c.id}">🔑 ${c.label || 'Saved Password'}</option>`).join('') + '<option value="manual">✏ Enter password manually</option>';
        pwdSelect.onchange = () => {
          $('popup-unlock-pw').style.display = pwdSelect.value === 'manual' ? 'block' : 'none';
        };
        $('popup-unlock-pw').style.display = pwdSelect.value === 'manual' ? 'block' : 'none';
      } else {
        pwdWrap.style.display = 'none';
        if (autoTryBtn) autoTryBtn.style.display = 'none';
        $('popup-unlock-pw').style.display = 'block';
      }
    } catch (_) {
      pwdWrap.style.display = 'none';
      if (autoTryBtn) autoTryBtn.style.display = 'none';
      $('popup-unlock-pw').style.display = 'block';
    }
  }

  if (currentFile.file_base64 || currentFile instanceof Blob) {
    try {
      const b64 = await fileToBase64(currentFile);
      const detectRes = await apiCall('/api/pdf/detect', {
        method: 'POST',
        body: { client_file_no: fno, file_base64: b64 }
      });
      if (detectRes) {
        if (detectRes.is_encrypted) {
          badge.textContent = '🔒 Password-Locked';
          badge.style.background = '#fef2f2';
          badge.style.color = '#991b1b';
          desc.textContent = 'This PDF is encrypted. Unlock with password before saving.';
        } else {
          badge.textContent = '✓ Unencrypted PDF';
          badge.style.background = '#f0fdf4';
          badge.style.color = '#166534';
          desc.textContent = 'Ready to file or lock with password.';
        }
      }
    } catch (_) {
      badge.textContent = 'PDF Document';
    }
  }
}

async function save() {
  const saveBtn = $('save');
  try {
    if (!selectedFiles.length) {
      const store = await chrome.storage.local.get(['pending_detected_file', 'latest_download_detected']);
      if (store.pending_detected_file || store.latest_download_detected) {
        await checkPendingDetectedFile();
      }
    }

    if (!selectedFiles.length) {
      throw Error('Please select or drop a file to upload.');
    }
    if (!$('client')?.value) {
      throw Error('Please select a client.');
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving Document... ⏳';

    const saved = [];
    const clientFileNo = $('client').value;
    const clientName = $('client').selectedOptions[0]?.text?.replace(/\s*\([^)]*\)\s*$/, '') || clientFileNo;
    const storageKind = $('storage-kind')?.value || 'local';

    for (const f of selectedFiles) {
      say(`Saving ${f.name}...`);

      let docPeriod = 'AY 2025-26';
      if (selectedTargetFolder) {
        const match = selectedTargetFolder.match(/\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b/i);
        if (match) docPeriod = match[0];
      }

      if (f.is_pending && !f.file_base64) {
        // Execute synchronous save via background worker
        const res = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'PROCESS_SAVE_SYNC',
            job: {
              client_file_no: clientFileNo,
              service: 'General',
              period: docPeriod,
              document_name: f.name,
              source_url: f.source_url,
              downloadId: f.downloadId,
              save_local: storageKind === 'local',
              save_drive: storageKind === 'drive',
              client_visibility: $('client-visible')?.checked || false,
              upload_practive: $('practive')?.checked || false,
              clientName,
              taskName: $('practive-task')?.value || '',
              target_folder: selectedTargetFolder
            }
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response || !response.ok) {
              reject(new Error(response?.error || 'Save failed'));
            } else {
              resolve(response.data);
            }
          });
        });

        saved.push(res);
      } else {
        const fileBytes = await fileToBase64(f);
        const payload = {
          client_file_no: clientFileNo,
          service: 'General',
          period: docPeriod,
          document_name: f.name,
          file_base64: fileBytes,
          save_local: storageKind === 'local',
          save_drive: storageKind === 'drive',
          client_visibility: $('client-visible')?.checked || false,
          upload_practive: $('practive')?.checked || false
        };

        if (selectedTargetFolder) {
          payload.target_folder = selectedTargetFolder;
          payload.relative_path = selectedTargetFolder;
        }

        const response = await apiCall('/api/save-document', {
          method: 'POST',
          body: payload
        });

        saved.push(response);

        if ($('practive')?.checked) {
          chrome.runtime.sendMessage({
            type: 'START_PRACTIVE_UPLOAD',
            job: {
              ...response,
              server: (await chrome.storage.local.get(['server'])).server || 'http://localhost:8767',
              clientName,
              service: 'General',
              period: docPeriod,
              taskName: $('practive-task')?.value || '',
              fileName: f.name
            }
          });
        }
      }
    }

    await chrome.storage.local.remove(['pending_detected_file', 'latest_download_detected']);
    if ($('detected-file-banner')) $('detected-file-banner').style.display = 'none';
    selectedFiles = [];
    $('file-label').textContent = 'Click or drop document here';

    if (saved.length > 0) {
      const destName = selectedTargetFolder ? `/${selectedTargetFolder}` : 'Root';
      say(`✓ ${saved.length} file${saved.length === 1 ? '' : 's'} saved into ${destName} for ${clientName}!`);
    }
    await loadClientTree(clientFileNo);
  } catch (e) {
    say('Save Error: ' + e.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Document';
  }
}

async function init() {
  await loadClients();
  await checkPendingDetectedFile();
  setupRenameHandlers();
}

$('client').onchange = () => {
  selectedTargetFolder = '';
  navCurrentPath = '';
  updateSelectedFolderDisplay();
  loadClientTree($('client').value);
  updatePdfSecurityCard();
};

$('storage-kind').onchange = () => {
  if ($('client').value) {
    loadClientTree($('client').value);
  }
};

$('folder-nav-up').onclick = () => {
  if (!navCurrentPath) return;
  const parts = navCurrentPath.split('/');
  parts.pop();
  navCurrentPath = parts.join('/');
  selectedTargetFolder = navCurrentPath;
  updateSelectedFolderDisplay();
  renderFolderNav();
};

$('folder-nav-select-this').onclick = () => {
  selectedTargetFolder = navCurrentPath;
  updateSelectedFolderDisplay();
  say(`Folder selected: ${selectedTargetFolder || 'Client Root'}`);
};

$('btn-reset-folder-sel').onclick = () => {
  selectedTargetFolder = '';
  navCurrentPath = '';
  updateSelectedFolderDisplay();
  renderFolderNav();
};

if ($('btn-refresh-clients')) {
  $('btn-refresh-clients').onclick = () => {
    say('Refreshing clients...');
    loadClients();
  };
}

if ($('server-pill-wrap')) {
  $('server-pill-wrap').onclick = () => {
    say('Checking connection...');
    loadClients();
  };
}

if ($('btn-clear-detected')) {
  $('btn-clear-detected').onclick = async () => {
    await chrome.storage.local.remove(['pending_detected_file']);
    $('detected-file-banner').style.display = 'none';
    selectedFiles = [];
    $('file-label').textContent = 'Click or drop document here';
    if ($('btn-rename-selected')) $('btn-rename-selected').style.display = 'none';
    say('Pre-detected file cleared.');
  };
}

$('btn-popup-lock-pdf').onclick = () => {
  $('popup-lock-form').style.display = $('popup-lock-form').style.display === 'none' ? 'block' : 'none';
  $('popup-unlock-form').style.display = 'none';
};

$('btn-popup-unlock-pdf').onclick = () => {
  $('popup-unlock-form').style.display = $('popup-unlock-form').style.display === 'none' ? 'block' : 'none';
  $('popup-lock-form').style.display = 'none';
};

$('btn-apply-popup-lock').onclick = async () => {
  const currentFile = selectedFiles.length > 0 ? selectedFiles[0] : null;
  if (!currentFile) { say('Please select a PDF file first.', true); return; }
  const pw = $('popup-lock-pw').value;
  const confirmPw = $('popup-lock-confirm-pw').value;
  if (!pw || pw.length < 3) { say('Password must be at least 3 characters.', true); return; }
  if (pw !== confirmPw) { say('Passwords do not match.', true); return; }

  try {
    $('btn-apply-popup-lock').disabled = true;
    $('btn-apply-popup-lock').textContent = 'Encrypting...';
    const b64 = await fileToBase64(currentFile);
    const fno = $('client')?.value || '';
    const label = $('popup-lock-label').value.trim() || 'General Password';
    const remember = $('popup-lock-remember').checked;

    const res = await apiCall('/api/pdf/lock', {
      method: 'POST',
      body: {
        client_file_no: fno,
        file_base64: b64,
        password: pw,
        confirm_password: confirmPw,
        remember_password: remember,
        label: label
      }
    });

    selectedFiles[0].file_base64 = res.output_base64;
    selectedFiles[0].is_pending = false;
    $('popup-lock-form').style.display = 'none';
    $('btn-apply-popup-lock').disabled = false;
    $('btn-apply-popup-lock').textContent = 'Encrypt & Lock PDF';
    $('pdf-sec-status-badge').textContent = '🔒 Locked';
    $('pdf-sec-status-badge').style.background = '#fef2f2';
    $('pdf-sec-status-badge').style.color = '#991b1b';
    say('✓ PDF encrypted and locked with password.');
  } catch (err) {
    $('btn-apply-popup-lock').disabled = false;
    $('btn-apply-popup-lock').textContent = 'Encrypt & Lock PDF';
    say('Lock failed: ' + err.message, true);
  }
};

$('btn-apply-popup-unlock').onclick = async () => {
  const currentFile = selectedFiles.length > 0 ? selectedFiles[0] : null;
  if (!currentFile) { say('Please select a PDF file first.', true); return; }
  const fno = $('client')?.value || '';
  const pwdSelect = $('popup-saved-password-select');
  const isSavedCred = pwdSelect && pwdSelect.value && pwdSelect.value !== 'manual';
  const credId = isSavedCred ? Number(pwdSelect.value) : null;
  const pw = isSavedCred ? '' : $('popup-unlock-pw').value;
  const remember = $('popup-unlock-remember').checked;
  const label = $('popup-unlock-label').value.trim() || 'General Password';

  if (!isSavedCred && !pw) { say('Please enter a password to unlock.', true); return; }

  try {
    $('btn-apply-popup-unlock').disabled = true;
    $('btn-apply-popup-unlock').textContent = 'Decrypting...';
    const b64 = await fileToBase64(currentFile);

    const res = await apiCall('/api/pdf/unlock', {
      method: 'POST',
      body: {
        client_file_no: fno,
        file_base64: b64,
        credential_id: credId,
        password: pw,
        remember_password: remember,
        label: label
      }
    });

    selectedFiles[0].file_base64 = res.output_base64;
    selectedFiles[0].is_pending = false;
    $('popup-unlock-form').style.display = 'none';
    $('btn-apply-popup-unlock').disabled = false;
    $('btn-apply-popup-unlock').textContent = 'Decrypt PDF';
    $('pdf-sec-status-badge').textContent = '✓ Unlocked';
    $('pdf-sec-status-badge').style.background = '#f0fdf4';
    $('pdf-sec-status-badge').style.color = '#166534';
    say('✓ PDF unlocked successfully!');
  } catch (err) {
    $('btn-apply-popup-unlock').disabled = false;
    $('btn-apply-popup-unlock').textContent = 'Decrypt PDF';
    say('Unlock failed: ' + err.message, true);
  }
};

$('btn-popup-auto-try').onclick = async () => {
  const currentFile = selectedFiles.length > 0 ? selectedFiles[0] : null;
  if (!currentFile) { say('Please select a PDF file first.', true); return; }
  const fno = $('client')?.value || '';
  if (!fno) { say('Select a client first.', true); return; }

  try {
    $('btn-popup-auto-try').disabled = true;
    $('btn-popup-auto-try').textContent = 'Testing...';
    const b64 = await fileToBase64(currentFile);

    const res = await apiCall('/api/pdf/unlock', {
      method: 'POST',
      body: {
        client_file_no: fno,
        file_base64: b64,
        auto_try_saved: true
      }
    });

    selectedFiles[0].file_base64 = res.output_base64;
    selectedFiles[0].is_pending = false;
    $('popup-unlock-form').style.display = 'none';
    $('btn-popup-auto-try').disabled = false;
    $('btn-popup-auto-try').textContent = '⚡ Try Saved';
    $('pdf-sec-status-badge').textContent = '✓ Unlocked';
    $('pdf-sec-status-badge').style.background = '#f0fdf4';
    $('pdf-sec-status-badge').style.color = '#166534';
    say(`✓ PDF auto-unlocked using "${res.matched_credential_label}"!`);
  } catch (err) {
    $('btn-popup-auto-try').disabled = false;
    $('btn-popup-auto-try').textContent = '⚡ Try Saved';
    say(err.message, true);
  }
};

$('save').onclick = save;
$('drop').onclick = () => $('pdf').click();
$('pdf').onchange = e => showFiles(e.target.files);
['dragenter', 'dragover'].forEach(type => $('drop').addEventListener(type, e => { e.preventDefault(); $('drop').classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => $('drop').addEventListener(type, e => { e.preventDefault(); $('drop').classList.remove('drag'); }));
$('drop').addEventListener('drop', e => showFiles(e.dataTransfer.files));

init();
