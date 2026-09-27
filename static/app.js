// =========================================================================
// NATIVE WINDOWS DESKTOP SHELL HARDENING
// =========================================================================
(function initNativeDesktopShell() {
  // 1. Disable browser context menu except on editable text inputs
  document.addEventListener('contextmenu', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    e.preventDefault();
  }, false);

  // 2. Suppress browser shortcuts (F5, Ctrl+R reload, Ctrl+U view source, F12 inspect)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
    }
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
      e.preventDefault();
    }
  }, false);

  // 3. Universal Native Drag & Drop Handler for Desktop App
  let windowDragCounter = 0;

  function hasExternalFiles(e) {
    if (!e || !e.dataTransfer) return false;
    if (e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types);
      return types.includes('Files') || types.includes('application/x-moz-file');
    }
    return false;
  }

  window.addEventListener('dragenter', (e) => {
    if (hasExternalFiles(e)) {
      windowDragCounter++;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const overlay = document.getElementById('vs-global-drop-overlay');
      if (overlay) overlay.classList.add('active');
    }
  }, false);

  window.addEventListener('dragover', (e) => {
    if (hasExternalFiles(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    } else {
      e.preventDefault();
    }
  }, false);

  window.addEventListener('dragleave', (e) => {
    if (hasExternalFiles(e)) {
      windowDragCounter = Math.max(0, windowDragCounter - 1);
      if (windowDragCounter === 0) {
        const overlay = document.getElementById('vs-global-drop-overlay');
        if (overlay) overlay.classList.remove('active');
      }
    }
  }, false);

  window.addEventListener('drop', async (e) => {
    const overlay = document.getElementById('vs-global-drop-overlay');
    if (overlay) overlay.classList.remove('active');
    windowDragCounter = 0;

    // If dropped directly into a specialized modal/element with its own ondrop handler, let it handle
    if (e.target && (e.target.closest('#merge-dropzone') || e.target.closest('#insert-dropzone') || e.target.closest('#save-dropzone') || e.target.closest('#pdf-studio-open-dropzone'))) {
      return;
    }

    if (!hasExternalFiles(e) && (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    const rawFiles = Array.from(e.dataTransfer.files || []);
    if (!rawFiles.length) return;

    // If currently in PDF Studio and a single PDF was dropped anywhere on the window
    if (typeof current !== 'undefined' && current === 'pdf-studio' && rawFiles.length === 1 && rawFiles[0].name.toLowerCase().endsWith('.pdf')) {
      if (typeof window.openUploadedPdfInStudio === 'function') {
        await window.openUploadedPdfInStudio(rawFiles[0]);
        return;
      }
    }

    // Route dropped files directly into the Save Files workspace
    if (typeof current !== 'undefined' && current !== 'save') {
      if (typeof navigateTo === 'function') {
        navigateTo('save');
      } else {
        current = 'save';
        window.location.hash = 'save';
        if (typeof nav === 'function') nav();
      }
    }

    if (typeof window.saveAddIncomingFiles === 'function') {
      await window.saveAddIncomingFiles(rawFiles);
      showNativeToast(`Added ${rawFiles.length} file(s) to Save workspace`, 'success');
    } else {
      window._pendingDroppedFiles = (window._pendingDroppedFiles || []).concat(rawFiles);
      showNativeToast(`Imported ${rawFiles.length} file(s) into Save workspace`, 'success');
    }
  }, false);
})();

// Native Toast Notifications
function showNativeToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('vs-native-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'vs-native-toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '<svg class="i" style="width:16px;height:16px;stroke:var(--ok);"><use href="#check"/></svg>',
    error: '<svg class="i" style="width:16px;height:16px;stroke:var(--er);"><use href="#alert"/></svg>',
    warning: '<svg class="i" style="width:16px;height:16px;stroke:var(--wn);"><use href="#alert"/></svg>',
    info: '<svg class="i" style="width:16px;height:16px;stroke:var(--pri);"><use href="#info"/></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `vs-native-toast toast-${type}`;
  toast.innerHTML = `
    <span class="vs-native-toast-icon">${icons[type] || icons.info}</span>
    <div class="vs-native-toast-body">${message}</div>
    <button type="button" class="vs-native-toast-close" title="Dismiss"><svg class="i" style="width:12px;height:12px;"><use href="#close"/></svg></button>
  `;

  toast.querySelector('.vs-native-toast-close').onclick = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  };

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.isConnected) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px) scale(0.95)';
        setTimeout(() => toast.remove(), 250);
      }
    }, duration);
  }
}
window.showNativeToast = showNativeToast;

// Native Modal Alert (Replacing browser alert())
function showNativeAlert(message, { title = 'VS Database', type = 'info' } = {}) {
  const existing = document.getElementById('vs-native-alert-modal');
  if (existing) existing.remove();

  const icons = {
    success: '<svg class="i" style="width:22px;height:22px;stroke:var(--ok);"><use href="#check"/></svg>',
    error: '<svg class="i" style="width:22px;height:22px;stroke:var(--er);"><use href="#alert"/></svg>',
    warning: '<svg class="i" style="width:22px;height:22px;stroke:var(--wn);"><use href="#alert"/></svg>',
    info: '<svg class="i" style="width:22px;height:22px;stroke:var(--pri);"><use href="#info"/></svg>'
  };

  const overlay = document.createElement('div');
  overlay.className = 'vs-native-alert-overlay';
  overlay.id = 'vs-native-alert-modal';

  overlay.innerHTML = `
    <div class="vs-native-alert-card">
      <div class="vs-native-alert-header">
        <span style="font-size:22px;display:flex;align-items:center;">${icons[type] || icons.info}</span>
        <h3>${title}</h3>
      </div>
      <div class="vs-native-alert-msg">${typeof message === 'string' ? message.replace(/\n/g, '<br>') : String(message)}</div>
      <div class="vs-native-alert-actions">
        <button type="button" class="btn primary" id="vs-native-alert-ok-btn" style="min-width:90px;padding:8px 20px;font-size:13px;">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const okBtn = overlay.querySelector('#vs-native-alert-ok-btn');
  const closeAlert = () => overlay.remove();
  okBtn.onclick = closeAlert;
  overlay.onclick = (e) => { if (e.target === overlay) closeAlert(); };
  okBtn.focus();
}
window.showNativeAlert = showNativeAlert;

// Native Confirmation Modal
function showNativeConfirm(message, { title = 'VS Database', confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('vs-native-confirm-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-native-alert-overlay';
    overlay.id = 'vs-native-confirm-modal';

    overlay.innerHTML = `
      <div class="vs-native-alert-card">
        <div class="vs-native-alert-header">
          <span style="font-size:22px;display:flex;align-items:center;"><svg class="i" style="width:22px;height:22px;stroke:var(--pri);"><use href="#info"/></svg></span>
          <h3>${title}</h3>
        </div>
        <div class="vs-native-alert-msg">${typeof message === 'string' ? message.replace(/\n/g, '<br>') : String(message)}</div>
        <div class="vs-native-alert-actions">
          <button type="button" class="btn secondary" id="vs-confirm-cancel-btn" style="padding:8px 18px;font-size:13px;">${cancelText}</button>
          <button type="button" class="btn primary" id="vs-confirm-ok-btn" style="padding:8px 18px;font-size:13px;">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const onFinish = (res) => {
      overlay.remove();
      resolve(res);
    };

    overlay.querySelector('#vs-confirm-cancel-btn').onclick = () => onFinish(false);
    overlay.querySelector('#vs-confirm-ok-btn').onclick = () => onFinish(true);
    overlay.onclick = (e) => { if (e.target === overlay) onFinish(false); };
  });
}
window.showNativeConfirm = showNativeConfirm;

// Monkey-patch window.alert to render our native dialog automatically
window.alert = function(msg) {
  showNativeAlert(msg, { title: 'VS Database', type: String(msg).toLowerCase().includes('failed') || String(msg).toLowerCase().includes('error') ? 'error' : 'info' });
};

const getDeviceId = () => {
  let id = localStorage.getItem('vs-device-id');
  if (!id) {
    id = 'dev-' + (crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)));
    localStorage.setItem('vs-device-id', id);
  }
  return id;
};
const getDeviceName = () => localStorage.getItem('vs-device-name') || '';
const setDeviceName = (name) => localStorage.setItem('vs-device-name', name);

const api = (path, options = {}) => {
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timeoutMs = options.timeout || (path.startsWith('/api/ai') ? 120000 : (path.startsWith('/api/pdf-studio') ? 60000 : 30000));
  let timeoutId = null;
  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`[API] TIMEOUT: ${path} exceeded ${timeoutMs}ms`);
    }, timeoutMs);
  }

  return fetch(path, {
    credentials: 'include',
    signal: options.signal || (controller ? controller.signal : undefined),
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-VS-Device-Id': getDeviceId(),
      ...(options.headers || {})
    }
  }).then(async r => {
    if (timeoutId) clearTimeout(timeoutId);
    const elapsed = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(1);
    if (elapsed > 1000) console.warn(`[API] SLOW RESPONSE: ${path} took ${elapsed}ms`);
    const x = await r.json();
    if (!r.ok) throw Error(x.error || 'Request failed');
    return x;
  }).catch(err => {
    if (timeoutId) clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[API] ABORTED: ${path}`);
      throw Error('Request timed out. Server is taking too long to respond.');
    }
    throw err;
  });
};

async function fileToBase64(file) {
  if (!file) return '';
  if (file._b64) return file._b64;
  if (file.base64) return file.base64;
  if (file.file_base64) return file.file_base64;
  if (typeof file.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  return file.base64 || file._b64 || '';
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, idx)).toFixed(dm)) + ' ' + sizes[idx];
}

let current = 'dashboard', settings = {}, clients = [], rules = { services: [], periods: [] }, currentUser = null, firmTypes = [];
const content = document.querySelector('#content');
const authRoot = document.querySelector('#auth-modal-root');
const message = (text, error = false) => `<div class="notice ${error ? 'error' : ''}">${text}</div>`;

const PAGE_META = {
  dashboard: ["Dashboard", "Overview of your practice"],
  clients: ["Clients", "Manage clients and import from Practive"],
  folders: ["Folder Structure", "Templates that build client folders"],
  save: ["Save Files", "Upload documents to client folders"],
  'pdf-studio': ["Studio", "Merge, split, protect and edit PDFs"],
  studio: ["Studio", "Merge, split, protect and edit PDFs"],
  'vs-ai': ["VS AI", "Statutory legal and tax copilot for Chartered Accountants"],
  ai: ["VS AI", "Statutory legal and tax copilot for Chartered Accountants"],
  drive: ["Drive Sharing", "Client portals on Google Drive"],
  backup: ["Backup & Restore", "Protect your database, clients and settings"],
  activity: ["Activity", "Recent filings you can revert"],
  setup: ["Setup", "Storage and integration"],
  users: ["Users & Devices", "Staff accounts and approved PCs"]
};

function updateHeaderMeta(page) {
  const p = PAGE_META[page] || PAGE_META['dashboard'];
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  if (titleEl) titleEl.textContent = p[0];
  if (subEl) subEl.textContent = p[1];
}

function updateUnifiedStatus(serverOk, driveOk, serverMsg, driveMsg) {
  const pill = document.getElementById('unified-status-pill');
  const dot = document.getElementById('unified-status-dot');
  const txt = document.getElementById('unified-status-text');
  const srvEl = document.getElementById('health');
  const drvEl = document.getElementById('drive-status');

  const sText = serverMsg || (serverOk ? 'Server online' : 'Server offline');
  const dText = driveMsg || (driveOk ? 'Drive connected' : 'Drive offline');

  if (srvEl) srvEl.textContent = sText;
  if (drvEl) drvEl.textContent = dText;

  if (pill) {
    pill.setAttribute('data-t', `${sText} · ${dText}`);
  }
  if (dot) {
    dot.className = 'dot' + (serverOk && driveOk ? '' : ' w');
  }
  if (txt) {
    if (!serverOk) txt.textContent = 'Server offline';
    else if (!driveOk) txt.textContent = 'Drive offline';
    else txt.textContent = 'All systems normal';
  }
}
window.updateUnifiedStatus = updateUnifiedStatus;

function nav() {
  if (current === 'vs-ai' || current === 'ai') {
    document.body.classList.add('page-vs-ai-active');
  } else {
    document.body.classList.remove('page-vs-ai-active');
  }
  document.querySelectorAll('nav button').forEach(b => {
    const isCur = b.dataset.page === current;
    b.classList.toggle('active', isCur);
    if (isCur) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  updateHeaderMeta(current);
  if (content) {
    content.classList.remove('tab-enter');
    void content.offsetWidth;
    content.classList.add('tab-enter');
  }
  render();
}


function navigateTo(page) {
  if (!page) return;
  current = page;
  window.location.hash = page;
  nav();
}
window.navigateTo = navigateTo;

function dismissSplash() {
  const splash = document.getElementById('app-startup-splash');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    setTimeout(() => { splash.style.display = 'none'; }, 250);
  }
}

function showAuthModal(type = 'login') {
  dismissSplash();
  authRoot.innerHTML = `
    <div class="auth-overlay">
      <div class="auth-box">
        <div style="text-align:center;margin-bottom:20px;">
          <img src="logo.png" alt="VS Database" style="height:50px;object-fit:contain;">
          <h2 style="margin:10px 0 4px;font-size:20px;">${type === 'setup-host' ? 'Host Admin Setup' : 'Database Access'}</h2>
          <p class="muted" style="font-size:12px;">${type === 'setup-host' ? 'Create the master Host administrator account for this server.' : 'Sign in to access VS Database on this device.'}</p>
        </div>
        ${type !== 'setup-host' ? `
          <div class="auth-tabs">
            <button id="tab-login" class="${type === 'login' ? 'active' : ''}">Sign In</button>
            <button id="tab-request" class="${type === 'request' ? 'active' : ''}">Request Device Access</button>
          </div>
        ` : ''}
        <div id="auth-form-body"></div>
      </div>
    </div>
  `;

  if (type === 'setup-host') renderSetupHostForm();
  else if (type === 'request') renderRequestAccessForm();
  else renderLoginForm();
}

function renderSetupHostForm() {
  const form = document.querySelector('#auth-form-body');
  form.innerHTML = `
    <div><label>Host Admin User ID *</label><input id="host-user" placeholder="e.g. admin or vimal" autofocus></div>
    <div style="margin-top:12px;"><label>Admin Password * (min 6 chars)</label><input id="host-pass" type="password" placeholder="••••••••"></div>
    <div style="margin-top:12px;"><label>Host PC / Device Name</label><input id="host-device" value="${getDeviceName() || 'Main Server PC'}"></div>
    <div class="actions" style="margin-top:20px;"><button class="primary" id="btn-submit-host" style="width:100%;">Create Host Account & Sign In</button></div>
    <div id="auth-result"></div>
  `;
  document.querySelector('#btn-submit-host').onclick = async () => {
    const user_id = document.querySelector('#host-user').value.trim();
    const password = document.querySelector('#host-pass').value;
    const device_name = document.querySelector('#host-device').value.trim() || 'Main Server PC';
    const result = document.querySelector('#auth-result');
    if (!user_id || !password) { result.innerHTML = message('Please enter User ID and Password.', true); return; }
    try {
      setDeviceName(device_name);
      await api('/api/auth/setup-host', {
        method: 'POST',
        body: JSON.stringify({ user_id, password, device_name, device_id: getDeviceId() })
      });
      authRoot.innerHTML = '';
      await load();
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
}

function renderLoginForm() {
  const form = document.querySelector('#auth-form-body');
  form.innerHTML = `
    <div><label>User ID</label><input id="login-user" placeholder="Enter your User ID" autofocus></div>
    <div style="margin-top:12px;"><label>Password</label><input id="login-pass" type="password" placeholder="••••••••"></div>
    <div class="actions" style="margin-top:20px;"><button class="primary" id="btn-do-login" style="width:100%;">Sign In</button></div>
    <div id="auth-result"></div>
  `;
  document.querySelector('#tab-login')?.classList.add('active');
  document.querySelector('#tab-request')?.classList.remove('active');
  document.querySelector('#tab-request')?.addEventListener('click', () => showAuthModal('request'));

  document.querySelector('#btn-do-login').onclick = async () => {
    const user_id = document.querySelector('#login-user').value.trim();
    const password = document.querySelector('#login-pass').value;
    const result = document.querySelector('#auth-result');
    if (!user_id || !password) { result.innerHTML = message('Please enter User ID and Password.', true); return; }
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ user_id, password, device_id: getDeviceId() })
      });
      authRoot.innerHTML = '';
      await load();
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
}

function renderRequestAccessForm() {
  const form = document.querySelector('#auth-form-body');
  form.innerHTML = `
    <div><label>Desired User ID *</label><input id="req-user" placeholder="e.g. Rahul" autofocus></div>
    <div style="margin-top:12px;"><label>Choose Password * (min 6 chars)</label><input id="req-pass" type="password" placeholder="••••••••"></div>
    <div style="margin-top:12px;"><label>Device Name (e.g. Accounts-PC, Audit-Laptop)</label><input id="req-device" value="${getDeviceName() || 'Office PC'}"></div>
    <div class="actions" style="margin-top:20px;"><button class="primary" id="btn-submit-req" style="width:100%;">Submit Access Request to Host</button></div>
    <div id="auth-result"></div>
  `;
  document.querySelector('#tab-request')?.classList.add('active');
  document.querySelector('#tab-login')?.classList.remove('active');
  document.querySelector('#tab-login')?.addEventListener('click', () => showAuthModal('login'));

  document.querySelector('#btn-submit-req').onclick = async () => {
    const user_id = document.querySelector('#req-user').value.trim();
    const password = document.querySelector('#req-pass').value;
    const device_name = document.querySelector('#req-device').value.trim() || 'Office PC';
    const result = document.querySelector('#auth-result');
    if (!user_id || !password) { result.innerHTML = message('Please enter User ID and Password.', true); return; }
    try {
      setDeviceName(device_name);
      await api('/api/auth/request-access', {
        method: 'POST',
        body: JSON.stringify({ user_id, password, device_name, device_id: getDeviceId() })
      });
      renderWaitingApproval(user_id, password);
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
}

function renderWaitingApproval(user_id, password) {
  const form = document.querySelector('#auth-form-body');
  form.innerHTML = `
    <div style="text-align:center;padding:10px 0;">
      <div style="font-size:36px;margin-bottom:10px;">⏳</div>
      <h3 style="margin:0 0 8px;">Access Request Submitted</h3>
      <p class="muted" style="font-size:13px;line-height:1.5;">
        User: <b>${user_id}</b><br>
        Device: <b>${getDeviceName()}</b> (<code>${getDeviceId().substring(0, 12)}...</code>)<br><br>
        Waiting for the Host Administrator to approve your device on the main office PC...
      </p>
      <div class="actions" style="justify-content:center;margin-top:20px;">
        <button class="secondary" id="btn-check-req">Check Status Now</button>
        <button class="secondary" id="btn-cancel-req">Back to Login</button>
      </div>
      <div id="auth-result" style="margin-top:14px;"></div>
    </div>
  `;
  document.querySelector('#btn-cancel-req').onclick = () => showAuthModal('login');

  const checkStatus = async () => {
    const res = await api(`/api/auth/request-status?device_id=${encodeURIComponent(getDeviceId())}&user_id=${encodeURIComponent(user_id)}`);
    const resEl = document.querySelector('#auth-result');
    if (res.status === 'approved') {
      if (resEl) resEl.innerHTML = message('Device approved! Logging in...');
      try {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ user_id, password, device_id: getDeviceId() })
        });
        authRoot.innerHTML = '';
        await load();
      } catch (e) {
        if (resEl) resEl.innerHTML = message('Device approved! Please enter password on Login tab.');
        setTimeout(() => showAuthModal('login'), 1500);
      }
    } else if (res.status === 'rejected') {
      if (resEl) resEl.innerHTML = message('Access request was rejected by Host.', true);
    }
  };

  document.querySelector('#btn-check-req').onclick = checkStatus;
  const timer = setInterval(() => {
    if (!document.querySelector('#btn-check-req')) { clearInterval(timer); return; }
    checkStatus().catch(() => {});
  }, 4000);
}

let startupVideoDismissTimeout = null;

function dismissStartupAnimationImmediately() {
  const overlay = document.getElementById('vs-daily-startup-splash');
  const video = document.getElementById('vs-startup-video');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.style.opacity = '0';
    overlay.style.visibility = 'hidden';
    overlay.classList.remove('fade-out');
  }
  if (video) {
    try { video.pause(); } catch (_) {}
    video.currentTime = 0;
  }
  const splash = document.getElementById('app-startup-splash');
  if (splash) {
    splash.style.display = 'none';
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
  }
  if (startupVideoDismissTimeout) {
    clearTimeout(startupVideoDismissTimeout);
    startupVideoDismissTimeout = null;
  }
}
window.dismissStartupAnimationImmediately = dismissStartupAnimationImmediately;

function getTodayDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let startupVideoHasRun = false;

function initDailyStartupVideo(force = false) {
  if (startupVideoHasRun && !force) return;
  startupVideoHasRun = true;

  const overlay = document.getElementById('vs-daily-startup-splash');
  const video = document.getElementById('vs-startup-video');
  if (!overlay || !video) return;

  // Check if opened via Companion Extension or direct document save intent
  const urlParams = new URLSearchParams(window.location.search);
  const isFromExtension = urlParams.get('from_extension') === '1' ||
                          urlParams.get('skip_animation') === '1' ||
                          window.location.hash === '#save' ||
                          window.location.hash === '#save-files';

  if (isFromExtension) {
    dismissStartupAnimationImmediately();
    return;
  }

  if (startupVideoDismissTimeout) {
    clearTimeout(startupVideoDismissTimeout);
    startupVideoDismissTimeout = null;
  }

  overlay.classList.remove('fade-out');
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
  overlay.style.visibility = 'visible';
  overlay.style.transform = 'none';

  // Ensure normal startup video is loaded
  if (!video.src.includes('Startup.mp4')) {
    video.src = 'Startup.mp4?v=20260924_orig';
  }
  video.playbackRate = 1.0;
  video.currentTime = 0;
  video.muted = true; // Video only, no audio

  let dismissed = false;
  const dismissVideo = () => {
    if (dismissed) return;
    dismissed = true;
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.style.display = 'none';
      try { video.pause(); } catch (_) {}
    }, 1050);
  };

  // Crossfade gently when reaching resting state (0.9s before video end)
  video.ontimeupdate = () => {
    if (video.duration && video.currentTime >= Math.max(0, video.duration - 0.95)) {
      dismissVideo();
    }
  };

  video.onended = dismissVideo;
  video.onerror = dismissVideo;

  // Fallback safety timeout if playback stalls
  startupVideoDismissTimeout = setTimeout(() => {
    if (!dismissed) dismissVideo();
  }, 8500);

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.warn('[StartupVideo] Autoplay error, auto-dismissing:', err);
      dismissVideo();
    });
  }
}

window.initDailyStartupVideo = initDailyStartupVideo;

function updateMaximizeIcon(isMaximized) {
  const iconMax = document.getElementById('titlebar-icon-max');
  const iconRestore = document.getElementById('titlebar-icon-restore');
  const maxBtn = document.getElementById('titlebar-max');
  if (iconMax && iconRestore) {
    if (isMaximized) {
      iconMax.style.display = 'none';
      iconRestore.style.display = 'inline-block';
      if (maxBtn) maxBtn.title = 'Restore';
    } else {
      iconMax.style.display = 'inline-block';
      iconRestore.style.display = 'none';
      if (maxBtn) maxBtn.title = 'Maximize';
    }
  }
}

window.onWindowMaximizedState = function(isMaximized) {
  updateMaximizeIcon(isMaximized);
};

function showExitConfirmModal() {
  const modal = document.getElementById('vs-exit-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    const cancelBtn = document.getElementById('vs-exit-btn-cancel');
    if (cancelBtn) cancelBtn.focus();
  }
}
window.showExitConfirmModal = showExitConfirmModal;

function hideExitConfirmModal() {
  const modal = document.getElementById('vs-exit-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}
window.hideExitConfirmModal = hideExitConfirmModal;

function playExitReverseAnimationAndClose() {
  const modal = document.getElementById('vs-exit-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  const overlay = document.getElementById('vs-daily-startup-splash');
  const video = document.getElementById('vs-startup-video');

  const doClose = async () => {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.confirm_close) {
        await window.pywebview.api.confirm_close();
        return;
      }
    } catch (err) {
      console.warn('Native pywebview close error:', err);
    }
    try {
      await fetch('/api/desktop/close', { method: 'POST' });
    } catch (_) {}
    try { window.close(); } catch (_) {}
  };

  if (!overlay || !video) {
    doClose();
    return;
  }

  if (startupVideoDismissTimeout) {
    clearTimeout(startupVideoDismissTimeout);
    startupVideoDismissTimeout = null;
  }

  overlay.classList.remove('fade-out');
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
  overlay.style.visibility = 'visible';
  overlay.style.transform = 'none';

  let closeExecuted = false;
  const triggerCloseOnce = () => {
    if (closeExecuted) return;
    closeExecuted = true;
    doClose();
  };

  video.ontimeupdate = null;
  video.onended = triggerCloseOnce;
  video.onerror = triggerCloseOnce;

  // Exit_Reverse.mp4 is pre-rendered in reverse at 1.75X speed (3.88s duration)
  video.src = 'Exit_Reverse.mp4?v=20260924_rev_175';
  video.playbackRate = 1.0;
  video.currentTime = 0;
  video.muted = true;
  video.load();

  // Safety fallback timeout in case video stalls
  setTimeout(() => {
    triggerCloseOnce();
  }, 4500);

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn('[ExitVideo] Playback failed, closing immediately:', err);
      triggerCloseOnce();
    });
  }
}
window.playExitReverseAnimationAndClose = playExitReverseAnimationAndClose;

function initExitModal() {
  const modal = document.getElementById('vs-exit-modal');
  const confirmBtn = document.getElementById('vs-exit-btn-confirm');
  const cancelBtn = document.getElementById('vs-exit-btn-cancel');

  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      hideExitConfirmModal();
    };
  }

  if (confirmBtn) {
    confirmBtn.onclick = (e) => {
      e.preventDefault();
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Closing...';
      playExitReverseAnimationAndClose();
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        hideExitConfirmModal();
      }
    };
  }

  window.addEventListener('keydown', (e) => {
    if (modal && modal.style.display !== 'none') {
      if (e.key === 'Escape') {
        e.preventDefault();
        hideExitConfirmModal();
      } else if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active && active.id === 'vs-exit-btn-cancel') {
          hideExitConfirmModal();
        } else if (confirmBtn) {
          confirmBtn.click();
        }
      }
    }
  });
}

function initDesktopWindowControls() {
  const minBtn = document.getElementById('titlebar-min');
  const maxBtn = document.getElementById('titlebar-max');
  const closeBtn = document.getElementById('titlebar-close');
  const dragArea = document.querySelector('.titlebar-drag-area');

  if (minBtn) {
    minBtn.onclick = (e) => {
      e.stopPropagation();
      if (window.pywebview && window.pywebview.api && window.pywebview.api.minimize_window) {
        window.pywebview.api.minimize_window();
      }
    };
  }

  if (maxBtn) {
    maxBtn.onclick = (e) => {
      e.stopPropagation();
      if (window.pywebview && window.pywebview.api && window.pywebview.api.maximize_window) {
        window.pywebview.api.maximize_window().then(res => {
          if (res && typeof res.maximized === 'boolean') {
            updateMaximizeIcon(res.maximized);
          }
        }).catch(() => {});
      }
    };
  }

  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      showExitConfirmModal();
    };
  }

  if (dragArea) {
    dragArea.ondblclick = (e) => {
      if (e.target.closest('.no-drag') || e.target.closest('.titlebar-btn')) return;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.maximize_window) {
        window.pywebview.api.maximize_window().then(res => {
          if (res && typeof res.maximized === 'boolean') {
            updateMaximizeIcon(res.maximized);
          }
        }).catch(() => {});
      }
    };

    dragArea.onmousedown = (e) => {
      if (e.target.closest('.no-drag') || e.target.closest('.titlebar-btn')) return;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.start_drag) {
        window.pywebview.api.start_drag();
      }
    };
  }

  if (window.pywebview && window.pywebview.api && window.pywebview.api.is_maximized) {
    window.pywebview.api.is_maximized().then(res => {
      if (res && typeof res.maximized === 'boolean') {
        updateMaximizeIcon(res.maximized);
      }
    }).catch(() => {});
  }

  initExitModal();
}

window.addEventListener('pywebviewready', () => {
  if (window.pywebview && window.pywebview.api && window.pywebview.api.is_maximized) {
    window.pywebview.api.is_maximized().then(res => {
      if (res && typeof res.maximized === 'boolean') {
        updateMaximizeIcon(res.maximized);
      }
    }).catch(() => {});
  }
});

async function load() {
  initDesktopWindowControls();
  initDailyStartupVideo();
  try {
    const authStatus = await api('/api/auth/status');
    if (!authStatus.initialized) {
      showAuthModal('setup-host');
      return;
    }
    if (!authStatus.authenticated) {
      showAuthModal(authStatus.is_loopback ? 'login' : 'request');
      return;
    }

    currentUser = authStatus.user;
    const userBadge = document.querySelector('#user-status');
    if (userBadge) {
      userBadge.style.display = 'flex';
      document.querySelector('#current-user-badge').textContent = `${currentUser.user_id} (${currentUser.role === 'host' ? 'Host' : 'Staff'})`;
      document.querySelector('#logout-btn').onclick = async () => {
        try {
          await api('/api/auth/logout', { method: 'POST', body: '{}' });
          location.reload();
        } catch (_) { location.reload(); }
      };
    }

    const navUsersBtn = document.querySelector('#nav-users');
    if (navUsersBtn) {
      navUsersBtn.style.display = currentUser.role === 'host' ? 'block' : 'none';
    }

    [settings, clients, rules, firmTypes] = await Promise.all([
      api('/api/settings'),
      api('/api/clients'),
      api('/api/rules'),
      api('/api/firm-types')
    ]);

    let isDriveConnected = false;
    try {
      const gStat = await api('/api/google/status');
      isDriveConnected = !!(gStat && gStat.connected);
      const ds = document.querySelector('#drive-status');
      if (ds) {
        ds.textContent = isDriveConnected ? 'Drive: Connected' : 'Drive: Not Connected';
      }
    } catch (_) {}

    updateUnifiedStatus(true, isDriveConnected, 'Server online', isDriveConnected ? 'Drive connected' : 'Drive offline');

    await render();
    document.querySelectorAll('nav button').forEach(b => {
      const isCur = b.dataset.page === current;
      b.classList.toggle('active', isCur);
      if (isCur) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    dismissSplash();
  } catch (e) {
    dismissSplash();
    updateUnifiedStatus(false, false, 'Server offline', 'Drive offline');
    content.innerHTML = message(e.message, true);
  }

}

function setup() {
  const curMode = settings.google_drive_mode || 'backup_and_client';
  const localVal = settings.local_root || 'D:\\Code Trial';
  const driveVal = settings.drive_root || 'G:\\My Drive\\VS Database';
  const officeName = settings.office_folder_name || 'Office';
  const clientName = settings.client_folder_name || 'Client';
  const driveRootName = settings.google_portal_root_name || 'VS Database';

  content.innerHTML = `
    <div class="glass card setup-wizard-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;gap:14px;">
        <div>
          <h1 style="margin:0 0 6px 0;font-size:24px;">System & Storage Setup</h1>
          <p class="muted" style="margin:0;font-size:13px;">Configure your storage engine, Google Drive integration modes, dedicated folder names, and firm branding.</p>
        </div>
        <button type="button" id="btn-fresh-start" class="btn d" style="font-size:12px;">
          <svg class="i" aria-hidden="true"><use href="#trash"/></svg>
          <span>Clean Fresh Start</span>
        </button>
      </div>

      <!-- 1. Mode Chooser Cards -->
      <div style="margin-top:14px;margin-bottom:22px;">
        <label style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--tx);margin-bottom:10px;display:block;">
          1. Select Storage & Google Drive Integration Mode
        </label>
        <div class="drive-mode-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;">
          
          <div class="drive-mode-card ${curMode === 'backup_and_client' ? 'active-mode' : ''}" data-mode="backup_and_client" style="border:2px solid ${curMode === 'backup_and_client' ? '#4f46e5' : 'var(--line)'};background:${curMode === 'backup_and_client' ? 'rgba(238,242,255,0.7)' : 'var(--glass2)'};border-radius:16px;padding:16px;cursor:pointer;transition:all .2s ease;">
            <div style="margin-bottom:6px;"><svg class="i" style="width:26px;height:26px;color:#2563eb;" aria-hidden="true"><use href="#drive"/></svg></div>
            <div style="font-weight:800;font-size:14px;color:var(--tx);">Backup And Client</div>
            <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;line-height:1.4;">Full Cloud Integration: Google Drive handles both Office Backups & Read-Only Client Portals.</div>
          </div>

          <div class="drive-mode-card ${curMode === 'only_client' ? 'active-mode' : ''}" data-mode="only_client" style="border:2px solid ${curMode === 'only_client' ? '#4f46e5' : 'var(--line)'};background:${curMode === 'only_client' ? 'rgba(238,242,255,0.7)' : 'var(--glass2)'};border-radius:16px;padding:16px;cursor:pointer;transition:all .2s ease;">
            <div style="margin-bottom:6px;"><svg class="i" style="width:26px;height:26px;color:#2563eb;" aria-hidden="true"><use href="#folder"/></svg></div>
            <div style="font-weight:800;font-size:14px;color:var(--tx);">Only Client</div>
            <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;line-height:1.4;">Google Drive used exclusively for Client Portals; internal Office files stored on Local disk.</div>
          </div>

          <div class="drive-mode-card ${curMode === 'only_backup' ? 'active-mode' : ''}" data-mode="only_backup" style="border:2px solid ${curMode === 'only_backup' ? '#4f46e5' : 'var(--line)'};background:${curMode === 'only_backup' ? 'rgba(238,242,255,0.7)' : 'var(--glass2)'};border-radius:16px;padding:16px;cursor:pointer;transition:all .2s ease;">
            <div style="margin-bottom:6px;"><svg class="i" style="width:26px;height:26px;color:#2563eb;" aria-hidden="true"><use href="#backup"/></svg></div>
            <div style="font-weight:800;font-size:14px;color:var(--tx);">Only Backup</div>
            <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;line-height:1.4;">Google Drive used for Office Cloud Backups only; No Client Document Portals.</div>
          </div>

          <div class="drive-mode-card ${curMode === 'disabled' ? 'active-mode' : ''}" data-mode="disabled" style="border:2px solid ${curMode === 'disabled' ? '#4f46e5' : 'var(--line)'};background:${curMode === 'disabled' ? 'rgba(238,242,255,0.7)' : 'var(--glass2)'};border-radius:16px;padding:16px;cursor:pointer;transition:all .2s ease;">
            <div style="margin-bottom:6px;"><svg class="i" style="width:26px;height:26px;color:#64748b;" aria-hidden="true"><use href="#setup"/></svg></div>
            <div style="font-weight:800;font-size:14px;color:var(--tx);">Disable Google Drive</div>
            <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;line-height:1.4;">100% Offline / Local Storage only. All office files and PDF passes stored locally.</div>
          </div>

        </div>
        <input type="hidden" id="google-drive-mode" value="${escapeHtml(curMode)}">
      </div>

      <!-- 2. Folder Names & Storage Locations -->
      <div style="background:rgba(248,250,252,0.8);border:1px solid rgba(226,232,240,0.9);border-radius:16px;padding:18px;margin-bottom:20px;">
        <label style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:#1e293b;margin-bottom:12px;display:block;">
          2. Folder Names & Storage Locations
        </label>
        
        <div class="grid3" style="gap:14px;margin-bottom:16px;">
          <div id="drive-root-name-wrapper">
            <label style="font-weight:700;font-size:12.5px;">Google Drive Root Folder Name</label>
            <input id="drive-root-name" class="input" value="${escapeHtml(driveRootName)}" placeholder="VS Database">
            <p class="muted" style="margin-top:4px;font-size:11px;">Top-level parent directory in Google Drive cloud.</p>
          </div>
          
          <div id="office-folder-name-wrapper">
            <label style="font-weight:700;font-size:12.5px;">Office Folder Name</label>
            <input id="office-folder-name" class="input" value="${escapeHtml(officeName)}" placeholder="Office">
            <p class="muted" style="margin-top:4px;font-size:11px;">Folder name for internal office files & backups.</p>
          </div>

          <div id="client-folder-name-wrapper">
            <label style="font-weight:700;font-size:12.5px;">Client Portal Folder Name</label>
            <input id="client-folder-name" class="input" value="${escapeHtml(clientName)}" placeholder="Client">
            <p class="muted" style="margin-top:4px;font-size:11px;">Folder name managed via Google Drive API for client portals.</p>
          </div>
        </div>

        <div class="grid2" id="path-fields-grid" style="gap:16px;">
          <div id="local-root-wrapper">
            <label style="font-weight:700;font-size:13px;">Local Storage Root Folder</label>
            <input id="local" class="input" placeholder="D:\\Code Trial" value="${escapeHtml(localVal)}">
            <p class="muted" style="margin-top:4px;font-size:11px;">Primary local disk location for office files and Client Access Link PDFs.</p>
          </div>

          <div id="drive-base-wrapper">
            <label style="font-weight:700;font-size:13px;">Google Drive Synced Root Path (G: Drive)</label>
            <input id="drive" class="input" placeholder="G:\\My Drive\\VS Database" value="${escapeHtml(driveVal)}">
            <p class="muted" style="margin-top:4px;font-size:11px;">Local mirror path for instant G: drive disk speed saving.</p>
          </div>
        </div>
      </div>

      <!-- Live Hierarchy Preview -->
      <div id="setup-hierarchy-preview" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:14px;padding:14px 18px;margin-bottom:22px;font-family:Consolas, monospace;font-size:12px;color:#334155;line-height:1.5;">
        <!-- Injected via JS -->
      </div>

      <!-- 3. Firm Details & Branding -->
      <div style="background:rgba(248,250,252,0.8);border:1px solid rgba(226,232,240,0.9);border-radius:16px;padding:18px;margin-bottom:22px;">
        <label style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:#1e293b;margin-bottom:12px;display:block;">
          3. Firm Information & Pass Branding
        </label>
        <div class="grid3" style="gap:14px;">
          <div><label style="font-weight:700;font-size:12.5px;">Firm Name</label><input id="firm-name" class="input" value="${escapeHtml(settings.firm_name || 'Vimal Sikhwal')}"></div>
          <div><label style="font-weight:700;font-size:12.5px;">Professional Title</label><input id="firm-title" class="input" value="${escapeHtml(settings.firm_title || 'Tax Practitioner')}"></div>
          <div><label style="font-weight:700;font-size:12.5px;">City</label><input id="firm-city" class="input" value="${escapeHtml(settings.firm_city || 'Jodhpur')}"></div>
          <div><label style="font-weight:700;font-size:12.5px;">Office Phone / Helpline</label><input id="firm-phone" class="input" value="${escapeHtml(settings.firm_phone || '+91 9460222319')}"></div>
          <div><label style="font-weight:700;font-size:12.5px;">UPI ID (Payment Notice Scanner)</label><input id="firm-upi" class="input" value="${escapeHtml(settings.firm_upi_id || '8104888850@ybl')}"></div>
        </div>
      </div>

      <!-- 4. In-House Software Version & GitHub Updates -->
      <div style="background:rgba(248,250,252,0.8);border:1px solid rgba(226,232,240,0.9);border-radius:16px;padding:18px;margin-bottom:22px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <label style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:#1e293b;margin-bottom:4px;display:block;">
              4. In-House Software & GitHub Updates
            </label>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <span style="font-size:13px;color:#475569;">Release Channel:</span>
              <span id="system-version-pill" class="badge active" style="font-size:11px;padding:3px 10px;border-radius:8px;">v1.0.1 (Production)</span>
              <span id="system-commit-badge" style="font-size:11.5px;color:#64748b;font-family:monospace;font-weight:600;"></span>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" id="btn-check-updates" class="btn">
              <svg class="i" aria-hidden="true"><use href="#search"/></svg>
              <span>Check for Updates</span>
            </button>
            <button type="button" id="btn-apply-update" class="btn p" style="display:none;">
              <svg class="i" aria-hidden="true"><use href="#refresh"/></svg>
              <span>Update Now</span>
            </button>
          </div>
        </div>
        <div id="update-status-msg" style="margin-top:12px;font-size:12.5px;display:none;"></div>
      </div>

      <div class="row" style="margin-top:16px;">
        <button class="btn p" id="save-settings" style="min-height:46px;font-size:14px;padding:0 26px;">
          <svg class="i" aria-hidden="true"><use href="#check"/></svg>
          <span>Save & Provision Workspace</span>
        </button>
      </div>
      <div id="result" style="margin-top:14px;"></div>
    </div>
  `;

  // UI Interactive Handlers
  const modeInput = document.getElementById('google-drive-mode');
  const driveBaseWrap = document.getElementById('drive-base-wrapper');
  const driveRootNameWrap = document.getElementById('drive-root-name-wrapper');
  const officeNameWrap = document.getElementById('office-folder-name-wrapper');
  const clientNameWrap = document.getElementById('client-folder-name-wrapper');
  const previewBox = document.getElementById('setup-hierarchy-preview');

  function updateModeUI(mode) {
    modeInput.value = mode;
    document.querySelectorAll('.drive-mode-card').forEach(card => {
      const isSel = card.getAttribute('data-mode') === mode;
      card.style.borderColor = isSel ? '#4f46e5' : 'rgba(226,232,240,0.8)';
      card.style.background = isSel ? 'rgba(238,242,255,0.7)' : '#fff';
    });

    const oName = (document.getElementById('office-folder-name').value || 'Office').trim();
    const cName = (document.getElementById('client-folder-name').value || 'Client').trim();
    const dName = (document.getElementById('drive-root-name').value || 'VS Database').trim();
    const locPath = (document.getElementById('local').value || 'D:\\Code Trial').trim();
    const drvPath = (document.getElementById('drive').value || 'G:\\My Drive\\VS Database').trim();

    if (mode === 'backup_and_client') {
      driveBaseWrap.style.display = 'block';
      driveRootNameWrap.style.display = 'block';
      officeNameWrap.style.display = 'block';
      clientNameWrap.style.display = 'block';
      previewBox.innerHTML = `<strong>Active Structure Preview (Backup And Client):</strong><br>
├── Local Storage [<code>${escapeHtml(locPath)}</code>]<br>
│   ├── ${escapeHtml(oName)}/ (Internal Office Files)<br>
│   └── Client Access Links/ (Document Access Passes)<br>
└── Google Drive [<code>${escapeHtml(drvPath)}</code>]<br>
    ├── ${escapeHtml(oName)}/ (Synced Office Files & Backups)<br>
    └── ${escapeHtml(cName)}/ (Read-Only Shared Client Portals [Google Drive API])`;
    } else if (mode === 'only_client') {
      driveBaseWrap.style.display = 'block';
      driveRootNameWrap.style.display = 'block';
      officeNameWrap.style.display = 'none';
      clientNameWrap.style.display = 'block';
      previewBox.innerHTML = `<strong>Active Structure Preview (Only Client):</strong><br>
├── Local Storage [<code>${escapeHtml(locPath)}</code>]<br>
│   ├── ${escapeHtml(oName)}/ (Internal Office Files & Backups)<br>
│   └── Client Access Links/<br>
└── Google Drive [<code>${escapeHtml(drvPath)}</code>]<br>
    └── ${escapeHtml(cName)}/ (Read-Only Shared Client Portals [Google Drive API])`;
    } else if (mode === 'only_backup') {
      driveBaseWrap.style.display = 'block';
      driveRootNameWrap.style.display = 'block';
      officeNameWrap.style.display = 'block';
      clientNameWrap.style.display = 'none';
      previewBox.innerHTML = `<strong>Active Structure Preview (Only Backup):</strong><br>
├── Local Storage [<code>${escapeHtml(locPath)}</code>]<br>
│   └── ${escapeHtml(oName)}/ (Internal Office Files)<br>
└── Google Drive [<code>${escapeHtml(drvPath)}</code>]<br>
    └── ${escapeHtml(oName)}/Backups/ (Encrypted Cloud Backups)`;
    } else {
      driveBaseWrap.style.display = 'none';
      driveRootNameWrap.style.display = 'none';
      officeNameWrap.style.display = 'block';
      clientNameWrap.style.display = 'none';
      previewBox.innerHTML = `<strong>Active Structure Preview (Disable Google Drive):</strong><br>
└── Local Storage Only [<code>${escapeHtml(locPath)}</code>]<br>
    ├── ${escapeHtml(oName)}/ (All internal office files)<br>
    ├── Backups/<br>
    └── Client Access Links/`;
    }
  }

  document.querySelectorAll('.drive-mode-card').forEach(card => {
    card.onclick = () => updateModeUI(card.getAttribute('data-mode'));
  });

  ['local', 'drive', 'office-folder-name', 'client-folder-name', 'drive-root-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => updateModeUI(modeInput.value);
  });

  updateModeUI(curMode);

  // Save Settings & Provision Handler
  document.getElementById('save-settings').onclick = async () => {
    const resEl = document.getElementById('result');
    try {
      const payload = {
        local_root: document.getElementById('local').value.trim(),
        drive_root: document.getElementById('drive').value.trim(),
        office_folder_name: document.getElementById('office-folder-name').value.trim(),
        client_folder_name: document.getElementById('client-folder-name').value.trim(),
        google_portal_root_name: document.getElementById('drive-root-name').value.trim(),
        google_drive_mode: modeInput.value,
        firm_name: document.getElementById('firm-name').value.trim(),
        firm_title: document.getElementById('firm-title').value.trim(),
        firm_city: document.getElementById('firm-city').value.trim(),
        firm_phone: document.getElementById('firm-phone').value.trim(),
        firm_upi_id: document.getElementById('firm-upi').value.trim(),
      };

      const pb = (typeof showGlassProgressBar === 'function')
        ? showGlassProgressBar({ title: 'Configuring Storage & Provisioning', subtitle: 'Setting up directories and passes...' })
        : null;
      if (pb) pb.simulate(1000);

      settings = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (pb) await pb.finish('Storage Provisioned Successfully');
      if (typeof playCompletionChime === 'function') playCompletionChime();

      resEl.innerHTML = message(`Settings saved & workspace successfully provisioned under mode '${payload.google_drive_mode}'.`);
    } catch (e) {
      resEl.innerHTML = message(e.message, true);
    }
  };

  // Software Update Event Handlers
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnApplyUpdate = document.getElementById('btn-apply-update');
  const updateMsg = document.getElementById('update-status-msg');
  const commitBadge = document.getElementById('system-commit-badge');

  if (btnCheckUpdates) {
    btnCheckUpdates.onclick = async () => {
      btnCheckUpdates.disabled = true;
      btnCheckUpdates.textContent = 'Checking GitHub...';
      updateMsg.style.display = 'block';
      updateMsg.innerHTML = '<span style="color:#64748b;">Connecting to GitHub repository and checking latest version...</span>';
      try {
        const res = await api('/api/system/check-updates');
        if (res.current_commit) commitBadge.textContent = `[${res.current_commit}]`;
        if (res.update_available) {
          updateMsg.innerHTML = `<span style="color:#16a34a;font-weight:700;display:inline-flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#16a34a;"><use href="#check"/></svg>New update available (${res.latest_commit})! Click "Update Now" to apply.</span>`;
          btnApplyUpdate.style.display = 'inline-flex';
        } else {
          updateMsg.innerHTML = `<span style="color:#2563eb;font-weight:600;display:inline-flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#2563eb;"><use href="#check"/></svg>Your VS Database software is completely up-to-date.</span>`;
          btnApplyUpdate.style.display = 'none';
        }
      } catch (err) {
        updateMsg.innerHTML = `<span style="color:#dc2626;">Error checking updates: ${escapeHtml(err.message)}</span>`;
      } finally {
        btnCheckUpdates.disabled = false;
        btnCheckUpdates.innerHTML = '<svg class="i" style="width:14px;height:14px;margin-right:6px;"><use href="#search"/></svg>Check for Updates';
      }
    };
  }

  if (btnApplyUpdate) {
    btnApplyUpdate.onclick = async () => {
      btnApplyUpdate.disabled = true;
      btnApplyUpdate.textContent = 'Applying Update...';
      updateMsg.innerHTML = '<span style="color:#64748b;">Pulling latest update from GitHub...</span>';
      try {
        const res = await api('/api/system/apply-update', { method: 'POST', body: '{}' });
        if (res.ok) {
          updateMsg.innerHTML = `<span style="color:#16a34a;font-weight:700;display:inline-flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#16a34a;"><use href="#check"/></svg>Update successful! Reloading application...</span>`;
          setTimeout(() => location.reload(), 1500);
        } else {
          updateMsg.innerHTML = `<span style="color:#dc2626;">Update failed: ${escapeHtml(res.error || 'Unknown error')}</span>`;
          btnApplyUpdate.disabled = false;
        }
      } catch (err) {
        updateMsg.innerHTML = `<span style="color:#dc2626;">Update failed: ${escapeHtml(err.message)}</span>`;
        btnApplyUpdate.disabled = false;
      }
    };
  }

  // Clean Fresh Start Handler
  document.getElementById('btn-fresh-start').onclick = () => {
    if (typeof showFreshStartModal === 'function') {
      showFreshStartModal();
    } else {
      if (confirm('Are you sure you want to perform a Fresh Start Wipe? This will clear all client records, passes, and temporary cache.')) {
        api('/api/setup/fresh-start', { method: 'POST', body: '{}' })
          .then(r => {
            alert(r.message || 'Fresh start completed.');
            setup();
          })
          .catch(e => alert(e.message));
      }
    }
  };
}

async function loadFirmTypes() {
  try {
    firmTypes = await api('/api/firm-types');
  } catch (_) {}
}

function showAddFirmTypeModal(onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'ft-modal-overlay';
  overlay.innerHTML = `
    <div class="ft-modal-dialog" style="width:min(440px,94vw);">
      <button class="modal-close" aria-label="Close">×</button>
      <p class="eyebrow">FIRM TYPE SETUP</p>
      <h2>Add New Firm Type</h2>
      <p class="muted">Create a new firm or entity type. It will immediately be available in client dropdowns and folder templates.</p>
      <div style="margin:16px 0;">
        <label for="new-ft-input">Firm Type Name *</label>
        <input id="new-ft-input" placeholder="e.g. Trust, Society" autofocus style="margin-top:6px;width:100%;">
      </div>
      <div id="new-ft-error"></div>
      <div class="actions" style="margin-top:20px;justify-content:flex-end;gap:8px;">
        <button class="secondary" id="cancel-add-ft">Cancel</button>
        <button class="primary" id="confirm-add-ft">Add Firm Type</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector('#cancel-add-ft').onclick = close;

  const input = overlay.querySelector('#new-ft-input');
  const errDiv = overlay.querySelector('#new-ft-error');
  const submitBtn = overlay.querySelector('#confirm-add-ft');

  const doAdd = async () => {
    const name = input.value.trim();
    if (!name) { errDiv.innerHTML = message('Enter a firm type name.', true); return; }
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding…';
      const created = await api('/api/firm-types', { method: 'POST', body: JSON.stringify({ name }) });
      await loadFirmTypes();
      close();
      if (onSuccess) onSuccess(created);
    } catch (e) {
      errDiv.innerHTML = message(e.message, true);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Firm Type';
    }
  };

  submitBtn.onclick = doAdd;
  input.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
}

async function showFirmTypeManagementModal() {
  await loadFirmTypes();
  const esc = escapeHtml;
  const overlay = document.createElement('div');
  overlay.className = 'ft-modal-overlay';

  const renderDialog = () => {
    overlay.innerHTML = `
      <div class="ft-modal-dialog">
        <button class="modal-close" aria-label="Close">×</button>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <p class="eyebrow">CONFIGURATION</p>
            <h2>Firm Type Management</h2>
          </div>
          <button class="primary btn-sm" id="btn-add-ft-from-mgmt" style="font-size:12px;padding:6px 12px;">+ Add Firm Type</button>
        </div>
        <p class="muted">Manage firm types. Disabling a type hides it from new clients while keeping existing client records and folder templates safe.</p>
        <div style="max-height:55vh;overflow-y:auto;margin-top:14px;">
          <table class="ft-table">
            <thead>
              <tr>
                <th>Firm Type</th>
                <th>Status</th>
                <th>Clients</th>
                <th>Templates</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${firmTypes.map(ft => `
                <tr id="ft-row-${ft.id}">
                  <td>
                    <strong class="ft-name-text">${esc(ft.name)}</strong>
                    <div class="ft-rename-box" style="display:none;align-items:center;gap:6px;margin-top:4px;">
                      <input class="ft-rename-input" value="${esc(ft.name)}" style="padding:4px 8px;font-size:12px;width:150px;">
                      <button class="primary btn-sm ft-rename-save" data-id="${ft.id}">Save</button>
                      <button class="secondary btn-sm ft-rename-cancel" data-id="${ft.id}">Cancel</button>
                    </div>
                  </td>
                  <td>
                    <span class="ft-status-badge ${ft.status}">${ft.status}</span>
                  </td>
                  <td>${ft.client_count || 0}</td>
                  <td>${ft.template_count ? `<span style="color:#19a77b;font-weight:700;">Configured</span>` : `<span class="muted">Default</span>`}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex;gap:6px;">
                      <button class="secondary btn-sm ft-action-rename" data-id="${ft.id}">Rename</button>
                      ${ft.status === 'active' 
                        ? `<button class="secondary btn-sm ft-action-toggle" data-id="${ft.id}" data-status="disabled" style="color:#e65100;">Disable</button>` 
                        : `<button class="primary btn-sm ft-action-toggle" data-id="${ft.id}" data-status="active">Enable</button>`}
                      <button class="secondary btn-sm ft-action-delete" data-id="${ft.id}" data-name="${esc(ft.name)}" data-clients="${ft.client_count || 0}" style="color:#b91c1c;">Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div id="ft-mgmt-msg" style="margin-top:12px;"></div>
        <div class="actions" style="margin-top:18px;justify-content:flex-end;">
          <button class="secondary" id="close-ft-mgmt">Done</button>
        </div>
      </div>
    `;

    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#close-ft-mgmt').onclick = () => overlay.remove();
    overlay.querySelector('#btn-add-ft-from-mgmt').onclick = () => {
      showAddFirmTypeModal(async () => {
        await loadFirmTypes();
        renderDialog();
        if (current === 'clients') clientsPage();
      });
    };

    overlay.querySelectorAll('.ft-action-rename').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const row = overlay.querySelector(`#ft-row-${id}`);
        row.querySelector('.ft-name-text').style.display = 'none';
        row.querySelector('.ft-rename-box').style.display = 'flex';
      };
    });

    overlay.querySelectorAll('.ft-rename-cancel').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const row = overlay.querySelector(`#ft-row-${id}`);
        row.querySelector('.ft-name-text').style.display = 'inline';
        row.querySelector('.ft-rename-box').style.display = 'none';
      };
    });

    overlay.querySelectorAll('.ft-rename-save').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const row = overlay.querySelector(`#ft-row-${id}`);
        const newName = row.querySelector('.ft-rename-input').value.trim();
        const msgDiv = overlay.querySelector('#ft-mgmt-msg');
        if (!newName) { msgDiv.innerHTML = message('Firm type name cannot be empty.', true); return; }
        try {
          btn.disabled = true;
          await api('/api/firm-types/update', { method: 'POST', body: JSON.stringify({ id: parseInt(id), name: newName }) });
          await loadFirmTypes();
          clients = await api('/api/clients');
          renderDialog();
          if (current === 'clients') clientsPage();
        } catch (e) {
          msgDiv.innerHTML = message(e.message, true);
          btn.disabled = false;
        }
      };
    });

    overlay.querySelectorAll('.ft-action-toggle').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const newStatus = btn.dataset.status;
        const msgDiv = overlay.querySelector('#ft-mgmt-msg');
        try {
          btn.disabled = true;
          await api('/api/firm-types/update', { method: 'POST', body: JSON.stringify({ id: parseInt(id), status: newStatus }) });
          await loadFirmTypes();
          renderDialog();
          if (current === 'clients') clientsPage();
        } catch (e) {
          msgDiv.innerHTML = message(e.message, true);
          btn.disabled = false;
        }
      };
    });

    overlay.querySelectorAll('.ft-action-delete').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.dataset.id);
        const ftName = btn.dataset.name;
        const clientCount = parseInt(btn.dataset.clients || '0');
        const msgDiv = overlay.querySelector('#ft-mgmt-msg');

        if (firmTypes.length <= 1) {
          msgDiv.innerHTML = message('Cannot delete the only available firm type.', true);
          return;
        }

        let reassignTo = '';
        if (clientCount > 0) {
          const otherTypes = firmTypes.filter(f => f.id !== id);
          const optionsText = otherTypes.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
          const promptMsg = `There are ${clientCount} client(s) currently assigned to '${ftName}'.\n\nTo delete this firm type, please choose which firm type to reassign them to:\n\n${optionsText}\n\nEnter the number or name of the new firm type:`;
          const inputChoice = window.prompt(promptMsg);
          if (!inputChoice || !inputChoice.trim()) return;
          const trimmed = inputChoice.trim();
          const numIdx = parseInt(trimmed);
          if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= otherTypes.length) {
            reassignTo = otherTypes[numIdx - 1].name;
          } else {
            const match = otherTypes.find(f => f.name.toLowerCase() === trimmed.toLowerCase());
            if (match) {
              reassignTo = match.name;
            } else {
              msgDiv.innerHTML = message(`Invalid selection '${trimmed}'. Please select a valid firm type.`, true);
              return;
            }
          }
        } else {
          if (!window.confirm(`Are you sure you want to delete firm type '${ftName}'?`)) return;
        }

        try {
          btn.disabled = true;
          await api('/api/firm-types/delete', {
            method: 'POST',
            body: JSON.stringify({ id, reassign_to: reassignTo })
          });
          await loadFirmTypes();
          clients = await api('/api/clients');
          renderDialog();
          if (current === 'clients') clientsPage();
          if (current === 'folders' && typeof folders === 'function') folders();
          if (current === 'dashboard' && typeof dashboard === 'function') dashboard();
        } catch (err) {
          msgDiv.innerHTML = message(err.message, true);
          btn.disabled = false;
        }
      };
    });
  };

  renderDialog();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function promptNewFirmTypesImport(newFirmTypes, onConfirm, onCancel) {
  const esc = escapeHtml;
  const overlay = document.createElement('div');
  overlay.className = 'ft-modal-overlay';
  overlay.innerHTML = `
    <div class="ft-modal-dialog" style="width:min(480px,94vw);">
      <button class="modal-close" aria-label="Close">×</button>
      <p class="eyebrow">IMPORT VERIFICATION</p>
      <h2>New Firm Type${newFirmTypes.length > 1 ? 's' : ''} Detected</h2>
      <p class="muted">The import file contains ${newFirmTypes.length} firm type(s) not currently registered in the database:</p>
      <div style="margin:14px 0;padding:12px;background:#fef9c3;border:1px solid #fde047;border-radius:10px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#854d0e;">
          ${newFirmTypes.map(esc).join(', ')}
        </p>
      </div>
      <p style="font-size:13px;color:var(--text);">
        Would you like to automatically create and register ${newFirmTypes.length > 1 ? 'these firm types' : 'this firm type'} and continue the import?
      </p>
      <div class="actions" style="margin-top:20px;justify-content:flex-end;gap:8px;">
        <button class="secondary" id="cancel-ft-import">Cancel Import</button>
        <button class="primary" id="confirm-ft-import">${newFirmTypes.length > 1 ? 'Create All & Continue' : 'Create & Continue'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); if (onCancel) onCancel(); };
  overlay.querySelector('.modal-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector('#cancel-ft-import').onclick = close;
  overlay.querySelector('#confirm-ft-import').onclick = () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  };
}

function clientsPage() {
  const activeFirmTypes = firmTypes.filter(ft => ft.status === 'active');
  content.innerHTML = `
    <!-- Top Actions Toolbar -->
    <div class="row" style="margin-bottom:16px;">
      <label class="field" style="flex:1;min-width:240px;">
        <svg class="i" aria-hidden="true"><use href="#search"/></svg>
        <input type="text" id="clients-table-filter" placeholder="Search by name, file no., mobile, firm type or group" aria-label="Search clients">
      </label>
      <input id="client-file" type="file" accept=".csv,.xlsx" multiple style="display:none;">
      <button class="btn" id="btn-trigger-import"><svg class="i" aria-hidden="true"><use href="#upload"/></svg>Import</button>
      <button class="primary" id="import" style="display:none;">Import</button>
      <a class="btn" href="/api/clients/export?format=xlsx" download="VS_Database_Clients.xlsx" id="btn-export-excel"><svg class="i" aria-hidden="true"><use href="#dl"/></svg>Export</a>
      <button class="btn p" id="btn-toggle-add-client"><svg class="i" aria-hidden="true"><use href="#plus"/></svg>Add client</button>
      <button class="btn" id="btn-open-ft-mgmt"><svg class="i" aria-hidden="true"><use href="#setup"/></svg>Firm types</button>
      <a class="secondary" href="/api/template.csv" style="display:none;" id="btn-download-template">Download CSV template</a>
      <a class="secondary" href="/api/clients/export?format=csv" download="VS_Database_Clients.csv" id="btn-export-csv" style="display:none;">Export CSV</a>
    </div>
    <div id="import-result"></div>

    <!-- Collapsible Add Client Card -->
    <section class="glass card" id="add-client-panel" style="display:none;margin-bottom:16px;">
      <div class="row" style="margin-bottom:14px;">
        <h2 style="margin:0;"><svg class="i" aria-hidden="true"><use href="#plus"/></svg>Add client manually</h2>
        <span class="sp"></span>
        <button class="btn ib" id="btn-close-add-client" title="Close" aria-label="Close add client"><svg class="i"><use href="#close"/></svg></button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
        <div><label>Practive File No. (optional)</label><input id="manual-file-no" placeholder="V-0001"></div>
        <div><label>Client name *</label><input id="manual-name" placeholder="XYZ Traders" required></div>
        <div><label>Mobile *</label><input id="manual-mobile" placeholder="9999999999" required></div>
        <div>
          <label>Firm Type *</label>
          <select id="manual-type" required>
            <option value="">Select Firm Type...</option>
            ${activeFirmTypes.map(ft => `<option value="${escapeHtml(ft.name)}">${escapeHtml(ft.name)}</option>`).join('')}
            <option value="__add_new__">+ Add New Firm Type</option>
          </select>
        </div>
        <div><label>Group</label><input id="manual-group" placeholder="Default"></div>
        <div><label>Status</label><select id="manual-status"><option>Active</option><option>Inactive</option></select></div>
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end;">
        <button class="btn p" id="add-client"><svg class="i" aria-hidden="true"><use href="#plus"/></svg>Save client</button>
      </div>
      <div id="manual-result" style="margin-top:10px;"></div>
    </section>

    <!-- Registered Clients Glass Card -->
    <section class="glass card">
      <div class="row" style="margin-bottom:14px;">
        <h2 id="clients-count-label" style="margin:0;">${clients.length} registered clients</h2>
        <span class="sp"></span>
        <div id="clients-bulk-bar-container"></div>
      </div>
      <div class="tw">
        <table id="registered-clients-table">
          <thead>
            <tr>
              <th style="width:36px;text-align:center;"><input type="checkbox" id="client-select-all" title="Select All"></th>
              <th>Reference</th>
              <th>Name</th>
              <th>Mobile</th>
              <th>Firm type</th>
              <th>Group</th>
              <th>Status</th>
              <th style="text-align:right" class="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody id="registered-clients-tbody">
            ${clients.map(c => `
              <tr data-fno="${escapeHtml(c.file_no)}">
                <td style="width:36px;text-align:center;"><input type="checkbox" class="client-row-checkbox" data-fno="${escapeHtml(c.file_no)}"></td>
                <td>${escapeHtml(c.file_no)}</td>
                <td><b>${escapeHtml(c.name)}</b></td>
                <td>${escapeHtml(c.mobile || '')}</td>
                <td>${escapeHtml(c.client_type || 'Unassigned')}</td>
                <td>${escapeHtml(c.client_group || '')}</td>
                <td><span class="chip ${c.status === 'Inactive' ? 'w' : ''}">${escapeHtml(c.status || 'Active')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;


  const field = id => document.getElementById(id), importResult = field('import-result'), manualResult = field('manual-result');

  const filterInput = field('clients-table-filter');
  const tbodyEl = field('registered-clients-tbody');
  const countLabel = field('clients-count-label');

  function filterClientTable(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = clients.filter(c => 
      !q ||
      (c.file_no || '').toLowerCase().includes(q) ||
      (c.name || '').toLowerCase().includes(q) ||
      (c.mobile || '').toLowerCase().includes(q) ||
      (c.client_type || '').toLowerCase().includes(q) ||
      (c.client_group || '').toLowerCase().includes(q) ||
      (c.status || '').toLowerCase().includes(q)
    );

    if (countLabel) {
      countLabel.textContent = q ? `Showing ${filtered.length} of ${clients.length} clients` : `${clients.length} registered clients`;
    }

    if (!tbodyEl) return;
    if (!filtered.length) {
      tbodyEl.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">No clients matching "${escapeHtml(query)}"</td></tr>`;
      return;
    }

    tbodyEl.innerHTML = filtered.map(c => `
      <tr data-fno="${escapeHtml(c.file_no)}">
        <td style="width:36px;text-align:center;"><input type="checkbox" class="client-row-checkbox" data-fno="${escapeHtml(c.file_no)}" /></td>
        <td>${escapeHtml(c.file_no)}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.mobile || '')}</td>
        <td>${escapeHtml(c.client_type || 'Unassigned')}</td>
        <td>${escapeHtml(c.client_group || '')}</td>
        <td>${escapeHtml(c.status || '')}</td>
      </tr>
    `).join('');

    if (window.bindClientTableActions) {
      window.bindClientTableActions();
    }
  }

  if (filterInput) {
    filterInput.oninput = (e) => filterClientTable(e.target.value);
  }

  const addPanel = field('add-client-panel');
  const btnToggleAdd = field('btn-toggle-add-client');
  const btnCloseAdd = field('btn-close-add-client');
  if (btnToggleAdd && addPanel) {
    btnToggleAdd.onclick = () => {
      const isHidden = addPanel.style.display === 'none';
      addPanel.style.display = isHidden ? 'block' : 'none';
      if (isHidden) field('manual-name')?.focus();
    };
  }
  if (btnCloseAdd && addPanel) {
    btnCloseAdd.onclick = () => { addPanel.style.display = 'none'; };
  }

  const btnTrigImp = field('btn-trigger-import');
  const clientFileInput = field('client-file');
  if (btnTrigImp && clientFileInput) {
    btnTrigImp.onclick = () => clientFileInput.click();
    clientFileInput.onchange = () => {
      if (clientFileInput.files && clientFileInput.files.length) {
        field('import').click();
      }
    };
  }

  field('btn-open-ft-mgmt').onclick = () => showFirmTypeManagementModal();


  field('manual-type').onchange = e => {
    if (e.target.value === '__add_new__') {
      showAddFirmTypeModal(newType => {
        const select = field('manual-type');
        const active = firmTypes.filter(ft => ft.status === 'active');
        select.innerHTML = `<option value="">Select Firm Type...</option>` +
          active.map(ft => `<option value="${escapeHtml(ft.name)}" ${ft.name === newType.name ? 'selected' : ''}>${escapeHtml(ft.name)}</option>`).join('') +
          `<option value="__add_new__">+ Add New Firm Type</option>`;
        select.value = newType.name;
      });
    }
  };

  field('import').onclick = async () => {
    try {
      const files = [...field('client-file').files];
      if (!files.length) throw Error('Choose one or more Practive CSV or XLSX exports first.');
      const pb = showGlassProgressBar({ title: 'Analyzing Clients', subtitle: 'Reading export files...' });
      pb.simulate(1000);
      let allNew = [], allConflicts = [], allInvalid = [], allNewFirmTypes = [];
      for (const file of files) {
        const r = await api('/api/import-clients/analyze', { method: 'POST', body: JSON.stringify({ filename: file.name, file_base64: await fileToBase64(file) }) });
        allNew = allNew.concat(r.new_clients || []);
        allConflicts = allConflicts.concat(r.conflicts || []);
        allInvalid = allInvalid.concat(r.invalid_rows || []);
        if (r.new_firm_types) {
          for (const nft of r.new_firm_types) {
            if (!allNewFirmTypes.includes(nft)) allNewFirmTypes.push(nft);
          }
        }
      }
      pb.close();

      if (allNew.length === 0) {
        importResult.innerHTML = `<div class="notice" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:12px 16px;border-radius:12px;">ℹ All ${allConflicts.length} client(s) in the imported file(s) already exist in the database. No new clients were added.</div>`;
        return;
      }

      const executeImport = async (firmTypesToCreate = []) => {
        const execPb = showGlassProgressBar({ title: 'Importing Clients', subtitle: `Adding ${allNew.length} new client(s)...` });
        execPb.simulate(800);
        const r = await api('/api/import-clients/execute', {
          method: 'POST',
          body: JSON.stringify({ new_clients: allNew, actions: [], bulk_action: 'skip', create_firm_types: firmTypesToCreate })
        });
        await loadFirmTypes();
        clients = await api('/api/clients');
        const skippedTotal = allConflicts.length + (r.skipped || 0);
        await execPb.finish(r.imported === 1 ? '1 New Client Imported Successfully' : `Imported ${r.imported} New Clients Successfully`);
        importResult.innerHTML = `<div class="import-summary">
          <span class="stat imported">✓ Imported: ${r.imported} new</span>
          ${skippedTotal > 0 ? `<span class="stat skipped" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;">ℹ Skipped: ${skippedTotal} existing</span>` : ''}
          ${allInvalid.length ? `<span class="stat skipped">— Invalid rows: ${allInvalid.length}</span>` : ''}
          ${r.failed ? `<span class="stat failed">⚠ Failed: ${r.failed}</span>` : ''}
        </div>`;
        render();
      };

      if (allNewFirmTypes.length > 0) {
        promptNewFirmTypesImport(allNewFirmTypes, () => executeImport(allNewFirmTypes));
      } else {
        await executeImport([]);
      }
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      importResult.innerHTML = message(e.message, true);
    }
  };

  field('add-client').onclick = async () => {
    try {
      const typeVal = field('manual-type').value;
      if (!typeVal || typeVal === '__add_new__') throw Error('Select a valid Firm Type.');
      const nameVal = field('manual-name').value.trim();
      if (!nameVal) throw Error('Client name is required.');

      const pb = showGlassProgressBar({ title: 'Adding Client', subtitle: `Registering "${nameVal}"...` });
      pb.simulate(700);

      const res = await api('/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          file_no: field('manual-file-no').value.trim(),
          name: nameVal,
          mobile: field('manual-mobile').value.trim(),
          client_type: typeVal,
          client_group: field('manual-group').value.trim(),
          status: field('manual-status').value
        })
      });
      clients = await api('/api/clients');
      await loadFirmTypes();
      await pb.finish('Client Created Successfully');

      clientsPage();
      const newManualResult = document.getElementById('manual-result');
      if (newManualResult) {
        newManualResult.innerHTML = message(`✓ Client "${escapeHtml(res.name)}" (${escapeHtml(res.file_no)}) registered successfully.`);
      }
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      manualResult.innerHTML = message(e.message, true);
    }
  };
}

function showImportConflictModal(newClients, conflicts, invalidRows, newFirmTypes = []) {
  const esc = escapeHtml;
  const resolutions = conflicts.map(() => ({ action: null }));
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  overlay.innerHTML = `
    <div class="import-modal" style="position:relative;">
      <button class="modal-close" aria-label="Close">×</button>
      <div class="import-modal-header">
        <h2>Import Conflict Resolution</h2>
        <p class="muted">The following clients already exist in the database with the same Name + File Number.</p>
        <div class="summary-badges">
          <span class="summary-badge new">✓ New: ${newClients.length}</span>
          <span class="summary-badge conflict">⚠ Duplicates: ${conflicts.length}</span>
          ${invalidRows.length ? `<span class="summary-badge invalid">✕ Invalid: ${invalidRows.length}</span>` : ''}
        </div>
      </div>
      ${newFirmTypes.length ? `
        <div style="margin:0 24px 12px;padding:10px 14px;background:#fef9c3;border:1px solid #fde047;border-radius:10px;">
          <h4 style="margin:0 0 4px;color:#854d0e;font-size:12px;">⚠️ New Firm Type(s) Detected</h4>
          <p style="margin:0 0 6px;font-size:12px;color:#713f12;">The import contains unregistered firm type(s): <strong>${newFirmTypes.map(esc).join(', ')}</strong>.</p>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#713f12;cursor:pointer;">
            <input type="checkbox" id="approve-all-firm-types-cb" checked> Automatically create and register these firm types
          </label>
        </div>
      ` : ''}
      <div class="import-modal-bulk">
        <p class="muted" style="margin-right:auto;">Resolve all ${conflicts.length} duplicate(s):</p>
        <button class="primary btn-sm" id="bulk-replace-all">Replace All</button>
        <button class="secondary btn-sm" id="bulk-skip-all">Skip All</button>
      </div>
      <div class="import-modal-body" id="conflict-list">
        ${conflicts.map((c, i) => `
          <div class="conflict-card" id="conflict-${i}" data-index="${i}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <strong>${esc(c.incoming.name)} (${esc(c.incoming.file_no)})</strong>
              <small class="muted">Row ${c.row}</small>
            </div>
            <div class="conflict-compare">
              <div class="conflict-side existing">
                <h4>Current Record</h4>
                <p><strong>Name:</strong> ${esc(c.existing.name)}</p>
                <p><strong>File No:</strong> ${esc(c.existing.file_no)}</p>
                <p><strong>Mobile:</strong> ${esc(c.existing.mobile || '—')}</p>
                <p><strong>Firm Type:</strong> ${esc(c.existing.client_type || '—')}</p>
                <p><strong>Status:</strong> ${esc(c.existing.status || '—')}</p>
              </div>
              <div class="conflict-side incoming">
                <h4>Incoming Data</h4>
                <p><strong>Name:</strong> ${esc(c.incoming.name)}</p>
                <p><strong>File No:</strong> ${esc(c.incoming.file_no)}</p>
                <p><strong>Mobile:</strong> ${esc(c.incoming.mobile || '—')}</p>
                <p><strong>Firm Type:</strong> ${esc(c.incoming.client_type || '—')}</p>
                <p><strong>Status:</strong> ${esc(c.incoming.status || '—')}</p>
              </div>
            </div>
            <div class="conflict-actions">
              <button class="primary btn-sm btn-resolve" data-index="${i}" data-action="replace">Replace</button>
              <button class="secondary btn-sm btn-resolve" data-index="${i}" data-action="skip">Skip</button>
              <button class="secondary btn-sm btn-rename-toggle" data-index="${i}">Rename</button>
              <div class="rename-inputs" id="rename-inputs-${i}" style="display:none;">
                <input id="rename-name-${i}" placeholder="New name" value="${esc(c.incoming.name)}">
                <input id="rename-fno-${i}" placeholder="New File No" value="">
                <button class="primary btn-sm btn-resolve" data-index="${i}" data-action="rename">Confirm</button>
              </div>
              <label class="apply-all-check">
                <input type="checkbox" class="apply-all-cb" data-index="${i}"> Apply to all matching
              </label>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="import-modal-footer">
        <button class="secondary" id="cancel-import">Cancel</button>
        <button class="primary" id="execute-import">Import ${newClients.length} new + apply resolutions</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector('#cancel-import').onclick = close;

  overlay.querySelector('#bulk-replace-all').onclick = () => {
    resolutions.forEach((r, i) => { r.action = 'replace'; markResolved(i, 'replace'); });
  };
  overlay.querySelector('#bulk-skip-all').onclick = () => {
    resolutions.forEach((r, i) => { r.action = 'skip'; markResolved(i, 'skip'); });
  };

  function markResolved(i, action) {
    const card = overlay.querySelector(`#conflict-${i}`);
    if (card) {
      card.classList.add('resolved');
      card.insertAdjacentHTML('afterbegin', `<div class="notice" style="margin-bottom:8px;padding:8px 10px;font-size:11px;">Decision: <strong>${action.toUpperCase()}</strong></div>`);
    }
  }

  overlay.querySelectorAll('.btn-rename-toggle').forEach(btn => {
    btn.onclick = () => {
      const idx = btn.dataset.index;
      const inputs = overlay.querySelector(`#rename-inputs-${idx}`);
      inputs.style.display = inputs.style.display === 'none' ? 'flex' : 'none';
    };
  });

  overlay.querySelectorAll('.btn-resolve').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index);
      const action = btn.dataset.action;
      const applyAll = overlay.querySelector(`.apply-all-cb[data-index="${idx}"]`)?.checked;

      if (action === 'rename') {
        resolutions[idx].action = 'rename';
        resolutions[idx].new_name = overlay.querySelector(`#rename-name-${idx}`).value.trim() || conflicts[idx].incoming.name;
        resolutions[idx].new_file_no = overlay.querySelector(`#rename-fno-${idx}`).value.trim();
        if (!resolutions[idx].new_file_no) { alert('Enter a new File Number for the renamed client.'); return; }
      } else {
        resolutions[idx].action = action;
      }
      markResolved(idx, action);

      if (applyAll && action !== 'rename') {
        resolutions.forEach((r, i) => {
          if (i !== idx && !r.action) {
            r.action = action;
            markResolved(i, action);
          }
        });
      }
    };
  });

  overlay.querySelector('#execute-import').onclick = async () => {
    resolutions.forEach(r => { if (!r.action) r.action = 'skip'; });

    const actions = conflicts.map((c, i) => ({
      action: resolutions[i].action,
      incoming: c.incoming,
      new_name: resolutions[i].new_name,
      new_file_no: resolutions[i].new_file_no
    }));

    const createApproved = overlay.querySelector('#approve-all-firm-types-cb')?.checked ? newFirmTypes : [];

    let execPb = null;
    try {
      const btn = overlay.querySelector('#execute-import');
      btn.disabled = true;
      btn.textContent = 'Importing…';
      execPb = showGlassProgressBar({ title: 'Importing Clients', subtitle: `Processing ${newClients.length + actions.length} client(s)...` });
      const stopSim = execPb.simulate(1500, 10, 90);
      const r = await api('/api/import-clients/execute', {
        method: 'POST',
        body: JSON.stringify({ new_clients: newClients, actions, create_firm_types: createApproved })
      });
      stopSim();
      close();
      await loadFirmTypes();
      clients = await api('/api/clients');
      const importResult = document.getElementById('import-result');
      if (importResult) {
        importResult.innerHTML = `<div class="import-summary">
          <span class="stat imported">✓ Imported: ${r.imported}</span>
          <span class="stat replaced">↻ Replaced: ${r.replaced}</span>
          <span class="stat skipped">→ Skipped: ${r.skipped}</span>
          <span class="stat renamed">✎ Renamed: ${r.renamed}</span>
          ${r.failed ? `<span class="stat failed">⚠ Failed: ${r.failed}</span>` : ''}
        </div>`;
      }
      render();
      await execPb.finish(`Imported ${r.imported} Client(s) Successfully`, 'Client Import Completed');
    } catch (e) {
      if (execPb) execPb.close();
      alert('Import failed: ' + e.message);
      overlay.querySelector('#execute-import').disabled = false;
      overlay.querySelector('#execute-import').textContent = 'Retry import';
    }
  };
}

function folders() {
  content.innerHTML = `
    <div class="glass card">
      <h1>Folder structure</h1>
      <p class="muted">Each active client receives Client → Service → Period folders in both configured roots. Separate services/periods with commas.</p>
      <div class="grid3">
        <div><label>Services</label><textarea id="services">${rules.services.join(', ')}</textarea></div>
        <div><label>Periods</label><textarea id="periods">${rules.periods.join(', ')}</textarea></div>
        <div><label>Folder order</label><select id="order"><option value="service-period" ${rules.order_name === 'service-period' ? 'selected' : ''}>Client / Service / Period</option><option value="period-service" ${rules.order_name === 'period-service' ? 'selected' : ''}>Client / Period / Service</option></select></div>
      </div>
      <div class="row" style="margin-top:16px;">
        <button class="btn secondary" id="save-rules"><svg class="i" aria-hidden="true"><use href="#check"/></svg>Save rules</button>
        <button class="btn p" id="create"><svg class="i" aria-hidden="true"><use href="#plus"/></svg>Create missing folders</button>
        <button class="btn" id="reconcile-all"><svg class="i" aria-hidden="true"><use href="#refresh"/></svg>Scan & Reconcile</button>
      </div>
      <div id="result" style="margin-top:12px;"></div>
      <div id="reconcile-result" style="margin-top:12px;"></div>
    </div>
    <div class="glass card">
      <h2><svg class="i" aria-hidden="true"><use href="#folder"/></svg>Configured destinations</h2>
      <p class="path" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><svg class="i" aria-hidden="true"><use href="#folder"/></svg><span>Local Storage:</span> <code>${escapeHtml(settings.local_root ? (settings.local_root + '\\' + (settings.office_folder_name || 'Office')) : 'No local storage selected')}</code></p>
      ${(settings.google_drive_mode === 'backup_and_client' || settings.google_drive_mode === 'only_backup') ? `<p class="path" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><svg class="i" aria-hidden="true"><use href="#drive"/></svg><span>Google Drive (Office & Backups):</span> <code>${escapeHtml(settings.drive_root ? (settings.drive_root + '\\' + (settings.office_folder_name || 'Office')) : 'Not configured')}</code></p>` : ''}
      ${(settings.google_drive_mode === 'backup_and_client' || settings.google_drive_mode === 'only_client') ? `<p class="path" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><svg class="i" aria-hidden="true"><use href="#drive"/></svg><span>Google Drive (Client Document Portals):</span> <code>${escapeHtml(settings.drive_root ? (settings.drive_root + '\\' + (settings.client_folder_name || 'Client')) : 'Not configured')}</code></p>` : ''}
      ${settings.google_drive_mode === 'disabled' ? `<p class="path muted" style="display:flex;align-items:center;gap:8px;"><svg class="i" aria-hidden="true"><use href="#drive"/></svg><span>Google Drive: Disabled</span></p>` : ''}
    </div>
  `;
  const field = id => document.getElementById(id), readRules = () => ({ services: field('services').value.split(',').map(x => x.trim()).filter(Boolean), periods: field('periods').value.split(',').map(x => x.trim()).filter(Boolean), order_name: field('order').value }), result = field('result');
  field('save-rules').onclick = async () => {
    try {
      rules = await api('/api/rules', { method: 'POST', body: JSON.stringify(readRules()) });
      result.innerHTML = message('Folder rules saved.');
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
  field('create').onclick = async () => {
    try {
      rules = await api('/api/rules', { method: 'POST', body: JSON.stringify(readRules()) });
      let r = await api('/api/create-folders', { method: 'POST', body: '{}' });
      result.innerHTML = message(`${r.folders_created} missing folder(s) created for ${r.clients} client(s).`);
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
  field('reconcile-all').onclick = async () => {
    const reconcileResult = field('reconcile-result');
    const btn = field('reconcile-all');
    try {
      btn.disabled = true; btn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#refresh"/></svg>Scanning…';
      reconcileResult.innerHTML = message('Scanning all client directories for folders and files…');
      const r = await api('/api/folders/reconcile', { method: 'POST', body: '{}' });
      let html = `<div class="notice">${r.clients_scanned} client(s) scanned. ${r.folders} folder(s) and ${r.files} file(s) discovered.</div>`;
      if (r.missing_folders > 0 || r.missing_files > 0) {
        html += `<div class="missing-notice"><strong>⚠ Missing items detected (not deleted — retained in database):</strong>`;
        if (r.missing_folders > 0) html += `${r.missing_folders} folder(s) no longer on disk. `;
        if (r.missing_files > 0) html += `${r.missing_files} file(s) no longer on disk.`;
        if (r.missing_folder_details && r.missing_folder_details.length > 0) {
          html += `<br><small>${r.missing_folder_details.slice(0, 10).join(', ')}${r.missing_folder_details.length > 10 ? '…' : ''}</small>`;
        }
        html += `</div>`;
      }
      reconcileResult.innerHTML = html;
    } catch (e) { reconcileResult.innerHTML = message(e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#refresh"/></svg>Scan & Reconcile'; }
  };
}

// --- Audio Chime & Browser Notification System ---
function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    
    // 3-tone pleasant glass chime (E5 -> B5 -> E6)
    const tones = [
      { freq: 659.25, time: 0, dur: 0.35, gain: 0.18 },
      { freq: 987.77, time: 0.11, dur: 0.45, gain: 0.24 },
      { freq: 1318.51, time: 0.22, dur: 0.75, gain: 0.28 }
    ];
    
    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.time);
      g.gain.setValueAtTime(t.gain, now + t.time);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t.time + t.dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + t.time);
      osc.stop(now + t.time + t.dur);
    });
  } catch (e) {}
}

function requestNotificationPermission() {
  if (typeof window.pywebview !== 'undefined' || window.location.search.includes('desktop_app=1') || window.location.port === '8767') {
    return;
  }
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      Notification.requestPermission().catch(() => {});
    } catch (_) {}
  }
}
if (typeof window.pywebview === 'undefined' && !window.location.search.includes('desktop_app=1')) {
  document.addEventListener('click', requestNotificationPermission, { once: true });
}

let titleFlashTimer = null;
const originalDocTitle = document.title || 'VS Database';

function flashTabTitle(text = '✅ Task Complete!') {
  if (titleFlashTimer) clearInterval(titleFlashTimer);
  let isOriginal = false;
  titleFlashTimer = setInterval(() => {
    document.title = isOriginal ? originalDocTitle : text;
    isOriginal = !isOriginal;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  document.title = originalDocTitle;
}

window.addEventListener('focus', stopTitleFlash);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopTitleFlash();
});

function notifyTaskComplete({ title = 'Task Completed', message = 'Operation completed successfully in VS Database.' } = {}) {
  playCompletionChime();
  
  if (document.hidden) {
    flashTabTitle(`(1) ✅ ${title}`);
    
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          const notif = new Notification(`✅ ${title}`, {
            body: message,
            icon: 'logo Monogram.png',
            badge: 'logo Monogram.png',
            tag: 'vs-task-complete',
            renotify: true
          });
          notif.onclick = () => {
            window.focus();
            notif.close();
          };
        } catch (e) {}
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            try {
              const notif = new Notification(`✅ ${title}`, { body: message, icon: 'logo Monogram.png' });
              notif.onclick = () => { window.focus(); notif.close(); };
            } catch (e) {}
          }
        });
      }
    }
  }
}
window.notifyTaskComplete = notifyTaskComplete;

// --- Deferred Success Tick Animation Queue ---
let pendingSuccessAnimation = null;

function executeSuccessAnimation(msg = '', durationMs = 1800) {
  return new Promise((resolve) => {
    const existing = document.querySelector('.vs-success-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'vs-success-backdrop';
    backdrop.innerHTML = `
      <div class="vs-success-card">
        <div class="vs-success-icon-wrap">
          <div class="vs-success-glow"></div>
          <svg class="vs-success-svg" viewBox="0 0 80 80">
            <circle class="vs-circle-bg" cx="40" cy="40" r="36" />
            <circle class="vs-circle-fill" cx="40" cy="40" r="36" />
            <path class="vs-tick-path" d="M25 41 L35 51 L56 30" />
          </svg>
        </div>
        ${msg ? `<div class="vs-success-msg">${escapeHtml(msg)}</div>` : ''}
      </div>
    `;

    document.body.appendChild(backdrop);

    setTimeout(() => {
      const card = backdrop.querySelector('.vs-success-card');
      if (card) card.classList.add('closing');
      setTimeout(() => {
        backdrop.remove();
        resolve();
      }, 300);
    }, durationMs);
  });
}

function showGlassmorphicSuccessAnimation(msg = '', durationMs = 1800) {
  // If the document is currently hidden in background, queue the animation until user returns!
  if (document.hidden) {
    return new Promise((resolve) => {
      pendingSuccessAnimation = { msg, durationMs, resolve };
    });
  }
  return executeSuccessAnimation(msg, durationMs);
}
window.showGlassmorphicSuccessAnimation = showGlassmorphicSuccessAnimation;

function showSuccessTickCard({ title = 'Success', message = '' } = {}) {
  const fullMsg = message ? (title ? `${title}: ${message}` : message) : title;
  return showGlassmorphicSuccessAnimation(fullMsg, 2000);
}
window.showSuccessTickCard = showSuccessTickCard;

function checkAndRunPendingSuccessAnimation() {
  if (pendingSuccessAnimation && !document.hidden) {
    const { msg, durationMs, resolve } = pendingSuccessAnimation;
    pendingSuccessAnimation = null;
    executeSuccessAnimation(msg, durationMs).then(resolve);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkAndRunPendingSuccessAnimation();
});
window.addEventListener('focus', () => {
  if (!document.hidden) checkAndRunPendingSuccessAnimation();
});

function showGlassProgressBar({ title = 'Processing...', subtitle = 'Please wait...', initialPercent = 0 } = {}) {
  const existing = document.querySelector('.vs-progress-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'vs-progress-backdrop';
  backdrop.innerHTML = `
    <div class="vs-progress-card">
      <div class="vs-progress-header">
        <div class="vs-progress-spinner"></div>
        <div>
          <h3 class="vs-progress-title">${escapeHtml(title)}</h3>
          <p class="vs-progress-sub">${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div class="vs-progress-track">
        <div class="vs-progress-fill" style="width: ${Math.max(0, Math.min(100, initialPercent))}%;"></div>
      </div>
      <div class="vs-progress-footer">
        <span class="vs-progress-status-text">${escapeHtml(subtitle)}</span>
        <span class="vs-progress-percent">${Math.round(initialPercent)}%</span>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  return {
    update(percent, text = '') {
      const p = Math.max(0, Math.min(100, percent));
      const fill = backdrop.querySelector('.vs-progress-fill');
      const pctEl = backdrop.querySelector('.vs-progress-percent');
      const subEl = backdrop.querySelector('.vs-progress-sub');
      const statEl = backdrop.querySelector('.vs-progress-status-text');
      if (fill) fill.style.width = `${p}%`;
      if (pctEl) pctEl.textContent = `${Math.round(p)}%`;
      if (text) {
        if (subEl) subEl.textContent = text;
        if (statEl) statEl.textContent = text;
      }
    },
    simulate(durationMs = 1500, from = 0, to = 92) {
      let start = performance.now();
      let interval = setInterval(() => {
        let elapsed = performance.now() - start;
        let progress = Math.min(1, elapsed / durationMs);
        let cur = from + (to - from) * (1 - Math.pow(1 - progress, 2));
        this.update(cur);
        if (progress >= 1) clearInterval(interval);
      }, 40);
      return () => clearInterval(interval);
    },
    finish(successMessage = '', taskTitle = '') {
      return new Promise((resolve) => {
        this.update(100, 'Complete');
        
        notifyTaskComplete({
          title: taskTitle || title || 'Task Complete',
          message: successMessage || `${title} completed successfully.`
        });

        setTimeout(() => {
          backdrop.classList.add('closing');
          setTimeout(async () => {
            backdrop.remove();
            if (successMessage) {
              await showGlassmorphicSuccessAnimation(successMessage, 1800);
            }
            resolve();
          }, 250);
        }, 200);
      });
    },
    close() {
      backdrop.remove();
    }
  };
}
window.showGlassProgressBar = showGlassProgressBar;

function showLockedPdfPromptModal(lockedFiles) {
  return new Promise((resolve) => {
    const existing = document.getElementById('vs-locked-pdf-modal');
    if (existing) existing.remove();

    const fileListHtml = lockedFiles.map(f => `
      <div style="padding: 7px 12px; background: rgba(254, 242, 242, 0.7); border: 1px solid rgba(254, 202, 202, 0.8); border-radius: 8px; font-size: 11.5px; color: #991b1b; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span style="font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; display: flex; align-items: center; gap: 6px;">
          <svg class="i" style="width:14px;height:14px;stroke:#dc2626;"><use href="#clip"/></svg>
          ${escapeHtml(f.name)}
        </span>
        <span style="font-size: 10.5px; font-weight: 800; background: #fee2e2; color: #b91c1c; padding: 2px 7px; border-radius: 6px; text-transform: uppercase;">Locked</span>
      </div>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'vs-locked-pdf-modal';
    modal.className = 'vs-modal-backdrop';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 16px;
      animation: fadeIn 0.2s ease-out;
    `;

    modal.innerHTML = `
      <div style="background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(254, 202, 202, 0.8); border-radius: 20px; max-width: 470px; width: 100%; padding: 24px; box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.9); animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 12px;">
          <div style="width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #fef2f2, #fee2e2); border: 1px solid #fecaca; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.15);">
            <svg class="i" style="width:22px;height:22px;stroke:#dc2626;"><use href="#setup"/></svg>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #1e293b;">Password-Protected PDF Detected</h3>
            <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">${lockedFiles.length} file(s) are encrypted with a password</p>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; margin: 12px 0; padding-right: 4px;">
          ${fileListHtml}
        </div>

        <p style="font-size: 12px; color: #475569; margin: 12px 0 20px; line-height: 1.5;">
          You can <strong>enter the password & unlock</strong> them to enable future auto-unlocking, or <strong>continue</strong> to save them directly in their current locked state.
        </p>

        <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" id="btn-modal-unlock-pdf" class="btn-sm" style="padding: 9px 16px; font-size: 12px; font-weight: 700; background: #fff; border: 1px solid #cbd5e1; color: #1e293b; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
            <svg class="i" style="width:13px;height:13px;stroke:currentColor;"><use href="#setup"/></svg> Unlock PDF(s)
          </button>
          <button type="button" id="btn-modal-continue-save" class="btn-sm primary" style="padding: 9px 20px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: 0; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
            <svg class="i" style="width:13px;height:13px;stroke:#fff;"><use href="#check"/></svg> Continue & Save
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const unlockBtn = modal.querySelector('#btn-modal-unlock-pdf');
    const continueBtn = modal.querySelector('#btn-modal-continue-save');

    unlockBtn.onclick = () => {
      modal.remove();
      resolve('unlock');
    };

    continueBtn.onclick = () => {
      modal.remove();
      resolve('continue');
    };
  });
}
window.showLockedPdfPromptModal = showLockedPdfPromptModal;

// ========================================================
// BACKGROUND FILE SAVE QUEUE ENGINE
// ========================================================

class BackgroundFileSaveQueue {
  constructor() {
    this.jobs = [];
    this.isWorking = false;
    this.drawerOpen = false;
    this.listeners = new Set();
    this.domMounted = false;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.initDOM());
      } else {
        this.initDOM();
      }
    }
  }

  initDOM() {
    if (this.domMounted || typeof document === 'undefined') return;
    
    // 1. Floating Badge Button
    let btn = document.getElementById('vs-queue-floating-btn');
    if (!btn) {
      btn = document.createElement('div');
      btn.id = 'vs-queue-floating-btn';
      btn.className = 'vs-queue-floating-btn';
      btn.style.display = 'none';
      btn.onclick = () => this.toggleDrawer();
      document.body.appendChild(btn);
    }

    // 2. Queue Drawer
    let drawer = document.getElementById('vs-queue-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'vs-queue-drawer';
      drawer.className = 'vs-queue-drawer';
      drawer.style.display = 'none';
      drawer.innerHTML = `
        <div class="vs-queue-drawer-header">
          <div class="vs-queue-drawer-title">
            <svg class="i" style="width:16px;height:16px;stroke:var(--pri);"><use href="#folder"/></svg>
            <span>Save Queue</span>
            <span id="vs-queue-header-count" class="badge active" style="font-size:11px;padding:2px 8px;">0 active</span>
          </div>
          <div class="vs-queue-drawer-actions">
            <button type="button" class="vs-queue-clear-btn" id="vs-queue-clear-btn" title="Clear completed tasks">Clear Finished</button>
            <button type="button" class="vs-queue-close-btn" id="vs-queue-close-btn" title="Minimize"><svg class="i" style="width:12px;height:12px;"><use href="#close"/></svg></button>
          </div>
        </div>
        <div class="vs-queue-drawer-body" id="vs-queue-drawer-body">
          <div class="vs-queue-empty-state">No background save tasks in queue.</div>
        </div>
      `;
      document.body.appendChild(drawer);

      const closeBtn = drawer.querySelector('#vs-queue-close-btn');
      if (closeBtn) closeBtn.onclick = () => this.closeDrawer();
      const clearBtn = drawer.querySelector('#vs-queue-clear-btn');
      if (clearBtn) clearBtn.onclick = () => this.clearCompleted();
    }

    this.domMounted = true;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach(fn => {
      try { fn(this.jobs); } catch (_) {}
    });
    this.renderUI();
  }

  enqueue(jobData) {
    this.initDOM();
    const job = {
      id: 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      client_file_no: jobData.client_file_no,
      client_name: jobData.client_name,
      target_folder: jobData.target_folder || '',
      period: jobData.period || 'AY 2025-26',
      save_local: jobData.save_local !== false,
      save_drive: jobData.save_drive !== false,
      client_visibility: !!jobData.client_visibility,
      upload_practive: !!jobData.upload_practive,
      files: jobData.files || [],
      total_files: (jobData.files || []).length,
      completed_files: 0,
      current_file_name: '',
      progress_percent: 0,
      status: 'queued',
      error: null,
      created_at: new Date(),
      cancelled: false
    };

    this.jobs.push(job);
    this.notify();
    this.showDrawer();
    this.processNext();
    return job;
  }

  cancelJob(jobId) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) return;
    job.cancelled = true;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.notify();
    } else if (job.status === 'processing') {
      job.status = 'cancelled';
      this.notify();
    }
  }

  removeJob(jobId) {
    this.jobs = this.jobs.filter(j => j.id !== jobId);
    this.notify();
  }

  clearCompleted() {
    this.jobs = this.jobs.filter(j => j.status === 'processing' || j.status === 'queued');
    this.notify();
  }

  toggleDrawer() {
    if (this.drawerOpen) {
      this.closeDrawer();
    } else {
      this.showDrawer();
    }
  }

  showDrawer() {
    this.initDOM();
    this.drawerOpen = true;
    const drawer = document.getElementById('vs-queue-drawer');
    if (drawer) drawer.style.display = 'flex';
    this.renderUI();
  }

  closeDrawer() {
    this.drawerOpen = false;
    const drawer = document.getElementById('vs-queue-drawer');
    if (drawer) drawer.style.display = 'none';
  }

  isProcessing() {
    return this.jobs.some(j => j.status === 'processing');
  }

  getPendingCount() {
    return this.jobs.filter(j => j.status === 'queued' || j.status === 'processing').length;
  }

  renderUI() {
    this.initDOM();
    const btn = document.getElementById('vs-queue-floating-btn');
    const drawer = document.getElementById('vs-queue-drawer');
    const countBadge = document.getElementById('vs-queue-header-count');
    const bodyEl = document.getElementById('vs-queue-drawer-body');

    if (!btn || !drawer) return;

    const activeJobs = this.jobs.filter(j => j.status === 'queued' || j.status === 'processing');
    const hasJobs = this.jobs.length > 0;

    // Floating Button Update
    if (hasJobs) {
      btn.style.display = 'flex';
      const isProc = this.isProcessing();
      const currentJob = this.jobs.find(j => j.status === 'processing');
      btn.className = `vs-queue-floating-btn ${isProc ? 'processing' : ''}`;
      if (isProc && currentJob) {
        btn.innerHTML = `
          <div class="vs-queue-badge-spinner"></div>
          <span>Saving (${currentJob.completed_files + 1}/${currentJob.total_files}) ${currentJob.progress_percent}%</span>
          <span style="background:#e0e7ff;color:#3730a3;padding:2px 7px;border-radius:10px;font-size:11px;">${activeJobs.length} active</span>
        `;
      } else if (activeJobs.length > 0) {
        btn.innerHTML = `
          <span>⏳</span>
          <span>${activeJobs.length} Job(s) in Queue</span>
        `;
      } else {
        btn.innerHTML = `
          <span>✅</span>
          <span>Queue Finished (${this.jobs.length})</span>
        `;
      }
    } else {
      btn.style.display = 'none';
      if (!this.drawerOpen) drawer.style.display = 'none';
    }

    if (countBadge) {
      countBadge.textContent = `${activeJobs.length} active`;
      countBadge.className = activeJobs.length > 0 ? 'badge active' : 'badge disabled';
    }

    // Drawer Body Update
    if (bodyEl) {
      if (this.jobs.length === 0) {
        bodyEl.innerHTML = '<div class="vs-queue-empty-state">No background save tasks in queue.</div>';
        return;
      }

      bodyEl.innerHTML = this.jobs.slice().reverse().map(job => {
        const isProc = job.status === 'processing';
        const isComp = job.status === 'completed';
        const isCanc = job.status === 'cancelled';
        const isFail = job.status === 'failed';
        const isQueued = job.status === 'queued';

        let statusText = '';
        let badgeClass = 'badge pending';
        if (isProc) {
          badgeClass = 'badge active';
          statusText = `Saving (${job.completed_files + 1}/${job.total_files}): "${escapeHtml(job.current_file_name || '...')}"`;
        } else if (isQueued) {
          badgeClass = 'badge pending';
          statusText = `Waiting in queue (${job.total_files} files)...`;
        } else if (isComp) {
          badgeClass = 'badge active';
          statusText = `Saved ${job.total_files} file(s) successfully.`;
        } else if (isCanc) {
          badgeClass = 'badge disabled';
          statusText = `Cancelled by user (${job.completed_files}/${job.total_files} saved).`;
        } else if (isFail) {
          badgeClass = 'badge revoked';
          statusText = `Error: ${escapeHtml(job.error || 'Failed to save')}`;
        }

        const pct = Math.max(0, Math.min(100, job.progress_percent));

        return `
          <div class="vs-queue-item-card ${job.status}" id="queue-card-${job.id}">
            <div class="vs-queue-item-header">
              <div class="vs-queue-client-info" title="${escapeHtml(job.client_name)} (${escapeHtml(job.client_file_no)})">
                <span>🏢</span>
                <strong style="color:#0f172a;">${escapeHtml(job.client_name)}</strong>
                <span class="muted" style="font-size:11px;font-weight:600;">(${escapeHtml(job.client_file_no)})</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="${badgeClass}" style="font-size:10.5px;padding:2px 7px;">${job.status.toUpperCase()}</span>
                ${(isQueued || isProc) ? `
                  <button type="button" class="vs-queue-cancel-btn" onclick="window.fileSaveQueue.cancelJob('${job.id}')" title="Cancel this save job">
                    <span>✕</span> Cancel
                  </button>
                ` : `
                  <button type="button" class="vs-queue-remove-btn" onclick="window.fileSaveQueue.removeJob('${job.id}')" title="Dismiss">
                    ✕
                  </button>
                `}
              </div>
            </div>

            <div class="vs-queue-target-path">
              <span>📁</span>
              <span>Folder: <code>/${escapeHtml(job.target_folder || 'Client Root')}</code></span>
              <span class="muted">• ${job.period}</span>
            </div>

            <div class="vs-queue-status-line">
              <span class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;" title="${escapeHtml(statusText)}">
                ${isProc ? '⏳ ' : (isComp ? '✅ ' : (isCanc ? '🚫 ' : '📄 '))}${statusText}
              </span>
              <strong style="font-size:11.5px;color:#1e1b4b;">${pct}%</strong>
            </div>

            <div class="vs-queue-progress-track">
              <div class="vs-queue-progress-fill ${isComp ? 'completed' : (isFail ? 'failed' : '')}" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  async processNext() {
    if (this.isWorking) return;
    const nextJob = this.jobs.find(j => j.status === 'queued' && !j.cancelled);
    if (!nextJob) {
      this.isWorking = false;
      this.notify();
      return;
    }

    this.isWorking = true;
    nextJob.status = 'processing';
    this.notify();

    try {
      const total = nextJob.files.length;
      if (total > 1) {
        nextJob.current_file_name = `Preparing ${total} files...`;
        this.notify();

        const preparedFiles = await Promise.all(nextJob.files.map(async (fileItem, idx) => {
          let b64 = fileItem.base64 || fileItem.file_base64;
          if (!b64 && !fileItem.staged_file_id && !fileItem.source_local_path && fileItem.fileObj) {
            b64 = await fileToBase64(fileItem.fileObj);
          }
          const fName = fileItem.name || (fileItem.fileObj && fileItem.fileObj.name) || `file_${idx+1}`;
          const fVis = (fileItem.client_visibility !== undefined) ? Boolean(fileItem.client_visibility) : Boolean(nextJob.client_visibility);
          return {
            document_name: fName,
            file_base64: b64,
            staged_file_id: fileItem.staged_file_id || undefined,
            staging_session_id: fileItem.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : undefined),
            source_local_path: fileItem.source_local_path || fileItem.localPath || '',
            source_url: fileItem.source_url || fileItem.url || '',
            downloadId: fileItem.downloadId,
            client_visibility: fVis
          };
        }));

        if (nextJob.cancelled) {
          nextJob.status = 'cancelled';
          nextJob.notify();
          return;
        }

        nextJob.current_file_name = `Saving ${total} files in fast batch...`;
        nextJob.progress_percent = 50;
        this.notify();

        const bulkPayload = {
          client_file_no: nextJob.client_file_no,
          service: 'General',
          period: nextJob.period,
          target_folder: nextJob.target_folder || '',
          relative_path: nextJob.target_folder || '',
          save_local: nextJob.save_local,
          save_drive: nextJob.save_drive,
          client_visibility: Boolean(nextJob.client_visibility),
          upload_practive: nextJob.upload_practive,
          files: preparedFiles
        };

        await api('/api/files/bulk-save', { method: 'POST', body: JSON.stringify(bulkPayload) });

        nextJob.completed_files = total;
        nextJob.progress_percent = 100;
        this.notify();
      } else if (total === 1) {
        // Single file fast path with inline server-side auto-unlock
        const fileItem = nextJob.files[0];
        const fileName = fileItem.name || (fileItem.fileObj && fileItem.fileObj.name) || 'file_1';
        nextJob.current_file_name = fileName;
        nextJob.progress_percent = 50;
        this.notify();

        let b64 = fileItem.base64 || fileItem.file_base64;
        if (!b64 && !fileItem.staged_file_id && !fileItem.source_local_path && fileItem.fileObj) {
          b64 = await fileToBase64(fileItem.fileObj);
        }

        if (nextJob.cancelled) {
          nextJob.status = 'cancelled';
          this.notify();
          return;
        }

        const fileVisibility = (fileItem.client_visibility !== undefined) ? Boolean(fileItem.client_visibility) : Boolean(nextJob.client_visibility);
        const payload = {
          client_file_no: nextJob.client_file_no,
          service: 'General',
          period: nextJob.period,
          document_name: fileName,
          file_base64: b64,
          staged_file_id: fileItem.staged_file_id || undefined,
          staging_session_id: fileItem.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : undefined),
          source_local_path: fileItem.source_local_path || fileItem.localPath || '',
          source_url: fileItem.source_url || fileItem.url || '',
          downloadId: fileItem.downloadId,
          save_local: nextJob.save_local,
          save_drive: nextJob.save_drive,
          client_visibility: fileVisibility,
          upload_practive: nextJob.upload_practive
        };

        if (nextJob.target_folder) {
          payload.target_folder = nextJob.target_folder;
          payload.relative_path = nextJob.target_folder;
        }

        await api('/api/save-document', { method: 'POST', body: JSON.stringify(payload) });

        nextJob.completed_files = 1;
        nextJob.progress_percent = 100;
        this.notify();
      }

      if (!nextJob.cancelled) {
        nextJob.status = 'completed';
        nextJob.progress_percent = 100;
        this.notify();
        if (window.saveStaging) {
          window.saveStaging.clearSession().catch(() => {});
        }
        try {
          notifyTaskComplete(`${nextJob.total_files} file(s) saved for ${nextJob.client_name}`);
        } catch (_) {}

        if (window._isRedirectedFromExt || window._originTabId) {
          const targetTabId = window._originTabId;
          try {
            api('/api/desktop/return_to_browser', {
              method: 'POST',
              body: JSON.stringify({ origin_tab_id: targetTabId })
            }).catch(() => {});
          } catch (_) {}
          window.postMessage({
            type: 'VS_SAVED_CLOSE_AND_RETURN',
            origin_tab_id: targetTabId
          }, '*');
          window._isRedirectedFromExt = false;
          window._originTabId = null;
        }
      }
    } catch (err) {
      nextJob.status = 'failed';
      nextJob.error = err.message || String(err);
      this.notify();
    } finally {
      this.isWorking = false;
      this.notify();
      // Continue next job in queue
      this.processNext();
    }
  }
}

// Global Singleton Instance
window.fileSaveQueue = new BackgroundFileSaveQueue();

// Global processor for incoming staging files from Companion Extension or External Drops
let incomingDrainInProgress = false;
async function processIncomingStaging(staging) {
  if (!staging || incomingDrainInProgress) return false;
  incomingDrainInProgress = true;
  try {
    const rawItems = (staging.files && Array.isArray(staging.files) && staging.files.length > 0)
      ? staging.files
      : (staging.bulk && Array.isArray(staging.bulk) && staging.bulk.length > 0)
        ? staging.bulk
        : (staging.single && (staging.single.filename || staging.single.name))
          ? [staging.single]
          : [];

    const hasFiles = rawItems.length > 0;
    if (!hasFiles && !staging.is_redirected) return false;

    if (staging.is_redirected || staging.origin_tab_id) {
      window._isRedirectedFromExt = true;
      if (staging.origin_tab_id) window._originTabId = staging.origin_tab_id;
    }

    // 1. Immediately dismiss startup intro animation if active
    if (typeof dismissStartupAnimationImmediately === 'function') {
      dismissStartupAnimationImmediately();
    }

    // 2. Extract files
    const newFiles = [];
    rawItems.forEach(item => {
      if (item && (item.filename || item.name)) {
        const fname = item.filename || item.name;
        const isPdf = Boolean(item.is_pdf || fname.toLowerCase().endsWith('.pdf'));
        newFiles.push({
          name: fname,
          filename: fname,
          size: item.size || item.fileSize || 0,
          type: item.mime || item.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
          _b64: item.file_base64 || item.base64 || item._b64 || '',
          base64: item.file_base64 || item.base64 || item._b64 || '',
          file_base64: item.file_base64 || item.base64 || item._b64 || '',
          staged_file_id: item.staged_file_id || null,
          staging_session_id: item.staging_session_id || null,
          badge: item.badge || '📥 Chrome Download',
          is_pdf: isPdf,
          source_local_path: item.source_local_path || item.localPath || item.local_path || '',
          source_url: item.source_url || item.url || item.sourceData?.url || '',
          downloadId: item.downloadId || item.download_id
        });
      }
    });

    // 3. Clear the server buffer immediately to avoid re-triggering
    try {
      await api('/api/staging/incoming/clear', { method: 'POST', body: '{}' });
    } catch (_) {}

    // 4. Ensure app is on the Save workspace
    if (typeof current !== 'undefined' && current !== 'save') {
      current = 'save';
      document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === 'save'));
      if (typeof save === 'function') save();
      window.location.hash = 'save';
    }

    // 5. Ingest into Save Files list
    if (newFiles.length > 0) {
      if (typeof window.saveAddIncomingFiles === 'function') {
        await window.saveAddIncomingFiles(newFiles);
      } else {
        window._pendingDroppedFiles = (window._pendingDroppedFiles || []).concat(newFiles);
      }
      const noticeEl = document.getElementById('result');
      if (noticeEl) {
        noticeEl.innerHTML = `<div class="notice" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af;font-weight:600;">📥 ${newFiles.length} file(s) received from Chrome Extension. Select a Client & Destination Folder to save.</div>`;
      }
      if (typeof showNativeToast === 'function') {
        showNativeToast(`📥 Received ${newFiles.length} file(s) from Chrome Extension`, 'success');
      }
      return true;
    }
    return false;
  } finally {
    incomingDrainInProgress = false;
  }
}
window.processIncomingStaging = processIncomingStaging;

function save() {
  let selectedFiles = [];
  let canonicalTree = [];
  let navPath = '';
  let selectedTargetFolder = '';
  let isRedirectedFromExt = false;
  let originTabId = null;

  // Returning banner from PDF Studio
  let returnedBannerHtml = '';
  if (window.lastAppliedStagingResult) {
    const resFile = window.lastAppliedStagingResult;
    returnedBannerHtml = `
      <div class="stg-banner-returned" id="stg-banner-returned">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">✅</span>
          <div>
            <div style="font-weight:700;color:#065f46;">Processed PDF returned to staging: <u>${escapeHtml(resFile.filename || 'document.pdf')}</u></div>
            <div style="font-size:11px;color:#047857;margin-top:2px;">Original selected PDF(s) replaced. All other staged files preserved. Ready to save to client.</div>
          </div>
        </div>
        <button type="button" class="btn-tiny" onclick="document.getElementById('stg-banner-returned')?.remove()" style="font-size:13px;padding:2px 8px;">✕</button>
      </div>
    `;
    window.lastAppliedStagingResult = null;
  }

  content.innerHTML = `
    <div class="glass card">
      ${returnedBannerHtml}
      <h1>Save Files</h1>
      <p class="muted">Upload and organize client documents: PDF, Excel, Word, CSV, ZIP, JSON, images, and other office files.</p>
      
      <!-- DRAG AND DROP ZONE -->
      <div id="save-dropzone" class="dropzone" style="border: 2px dashed rgba(112, 126, 187, 0.4); border-radius: 20px; padding: 32px 20px; text-align: center; background: rgba(255, 255, 255, 0.55); cursor: pointer; transition: all 0.2s ease; margin-bottom: 16px;">
        <div style="margin-bottom: 8px;"><svg class="i" style="width:38px;height:38px;color:#2563eb;" aria-hidden="true"><use href="#upload"/></svg></div>
        <h3 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: var(--tx);">Drag & Drop Documents Here</h3>
        <p style="margin: 0 0 12px 0; font-size: 12px; color: var(--muted);">PDF, Excel, Word, CSV, ZIP, JSON, Images</p>
        <span id="save-file-label" class="btn p" style="min-height:36px;font-size:12px;padding:0 18px;border-radius:20px;">Choose Files from Computer</span>
        <input type="file" id="pdf" multiple style="display:none;">
      </div>

      <!-- SELECTED FILES LIST -->
      <div id="selected-files-container" style="display:none;margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:var(--tx2);margin-bottom:8px;">Selected Documents:</div>
        <div id="selected-files-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>

      <!-- CLIENT & STORAGE -->
      <div class="grid" style="margin-top:0;">
        <div>
          <label>Select Client *</label>
          <input type="text" id="client-search-filter" placeholder="Search client by name or file no..." style="margin-bottom:6px;width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--glass2);font-size:12px;" />
          <select id="client">
            <option value="">Select client…</option>
            ${clients.map(c => `<option value="${escapeHtml(c.file_no)}">${escapeHtml(c.name)} (${escapeHtml(c.file_no)})</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Storage Location</label>
          <select id="save-storage-kind">
            <option value="local">Local Storage</option>
            <option value="drive">Google Drive</option>
          </select>
        </div>
      </div>

      <!-- DIRECT FOLDER DESTINATION NAVIGATOR -->
      <div style="margin-top: 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="margin:0;">Destination Folder *</label>
          <span id="web-folder-status-tag" style="font-size:11px;color:#2563eb;font-weight:700;">Client Folders</span>
        </div>
        
        <div id="web-selected-folder-box" style="background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <svg class="i" style="width:16px;height:16px;color:#2563eb;" aria-hidden="true"><use href="#folder"/></svg>
            <strong id="web-selected-folder-label" style="color:#2563eb;">/ (Client Root)</strong>
          </div>
          <button id="web-btn-reset-folder" type="button" class="btn" style="min-height:28px;padding:0 10px;font-size:11px;">Root</button>
        </div>

        <div id="web-folder-navigator" style="border:1px solid var(--line);border-radius:16px;background:var(--glass2);padding:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line);gap:8px;">
            <button id="web-folder-nav-up" type="button" class="btn" style="min-height:30px;font-size:11px;padding:2px 10px;">&larr; Up</button>
            <span id="web-folder-nav-crumb" style="font-size:12px;font-weight:600;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">/ (Client Root)</span>
            <button id="web-folder-nav-select-this" type="button" class="btn p" style="min-height:30px;font-size:11px;padding:2px 12px;"><svg class="i" aria-hidden="true"><use href="#check"/></svg>Select This Folder</button>
          </div>
          <div id="web-folder-nav-list" style="max-height:200px;overflow-y:auto;">
            <div style="padding:16px;font-size:12px;color:var(--muted);text-align:center;">Select a client above to view and pick folders</div>
          </div>
        </div>
      </div>

      <!-- STORAGE & PORTAL OPTIONS -->
      <div class="actions storage-options-row" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;">
        <label class="check"><input type="checkbox" id="save-local" checked> Save to local storage</label>
        
        <span id="save-drive-container" style="position:relative;display:inline-flex;align-items:center;">
          <label class="check" id="save-drive-label"><input type="checkbox" id="save-drive" checked> Copy to Google Drive (Office Storage)</label>
          <div id="save-drive-lock" class="glass-drive-lock-badge" style="display:none;" tabindex="0" role="button" aria-label="Google Drive Office storage is locked in Only Client mode">
            <span class="lock-icon">🔒</span>
            <span class="lock-text">Copy to Google Drive</span>
            <span class="lock-pill">Only Client</span>
            <div class="glass-drive-lock-tooltip">
              <div style="font-weight:800;color:#93c5fd;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                <span>🔒</span> Google Drive Office Storage Locked
              </div>
              <div style="margin-bottom:6px;color:#e2e8f0;">
                <strong>Reason:</strong> Google Drive is currently configured in <strong>'Only Client'</strong> mode. Internal office files stay strictly on Local Storage.
              </div>
              <div style="border-top:1px solid rgba(255,255,255,0.15);padding-top:6px;font-size:11px;color:#94a3b8;">
                <strong>💡 How to Unlock:</strong><br>
                Go to the <strong>Setup</strong> tab and switch Google Drive mode to <em>'Use Google Drive for backup And Client'</em> or <em>'Only Backup'</em>.<br>
                <em>(Shared files can still be saved directly to the Client Portal using the per-file checkbox in the list above.)</em>
              </div>
            </div>
          </div>
        </span>

        <label class="check"><input type="checkbox" id="practive"> Queue visible Practive upload</label>
      </div>

      <div class="actions" style="margin-top:16px;">
        <button class="primary" id="save-document" style="padding:10px 24px;font-size:13px;">Save Documents</button>
      </div>

      <div id="result"></div>
    </div>
  `;

  const field = id => document.getElementById(id);
  const dropzone = field('save-dropzone');
  const fileInput = field('pdf');
  const filesContainer = field('selected-files-container');
  const filesList = field('selected-files-list');
  const fileLabel = field('save-file-label');
  const clientSearchFilter = field('client-search-filter');
  const clientSelect = field('client');
  const storageSelect = field('save-storage-kind');
  const folderCrumb = field('web-folder-nav-crumb');
  const folderListEl = field('web-folder-nav-list');
  const selectedFolderLabel = field('web-selected-folder-label');
  const resetFolderBtn = field('web-btn-reset-folder');
  const navUpBtn = field('web-folder-nav-up');
  const selectThisBtn = field('web-folder-nav-select-this');
  const result = field('result');

  const syncDriveModeOption = () => {
    const isOnlyClient = settings.google_drive_mode === 'only_client';
    const isDisabled = settings.google_drive_mode === 'disabled';
    const driveLabel = field('save-drive-label');
    const driveLock = field('save-drive-lock');
    const driveInput = field('save-drive');

    if (!driveLabel || !driveLock || !driveInput) return;

    if (isOnlyClient || isDisabled) {
      driveLabel.style.display = 'none';
      driveLock.style.display = 'inline-flex';
      driveInput.disabled = true;
      driveInput.checked = false;
    } else {
      driveLabel.style.display = 'inline-flex';
      driveLock.style.display = 'none';
      driveInput.disabled = false;
    }
  };
  syncDriveModeOption();

  function renderClientOptions(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = clients.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.file_no || '').toLowerCase().includes(q));
    clientSelect.innerHTML = '<option value="">Select client…</option>' +
      filtered.map(c => `<option value="${escapeHtml(c.file_no)}">${escapeHtml(c.name)} (${escapeHtml(c.file_no)})</option>`).join('');
  }

  if (clientSearchFilter) {
    clientSearchFilter.oninput = (e) => {
      renderClientOptions(e.target.value);
    };
  }

  async function inspectAndAutoUnlockFile(file, clientFileNo) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      file.is_pdf = false;
      file.is_encrypted = false;
      file.is_unlocked = true;
      return;
    }
    file.is_pdf = true;
    if (!file.base64 && file.fileObj) {
      try {
        file.base64 = await fileToBase64(file.fileObj);
      } catch (_) {}
    }
    if (!file.base64) return;

    try {
      const detect = await api('/api/pdf/detect', {
        method: 'POST',
        body: JSON.stringify({ client_file_no: clientFileNo || '', file_base64: file.base64 })
      });
      file.is_encrypted = Boolean(detect && detect.is_encrypted);
      if (!file.is_encrypted) {
        file.is_unlocked = true;
        file.show_unlock_panel = false;
        file.unlock_error = null;
      } else {
        // Locked PDF -> try all saved client passwords
        if (clientFileNo) {
          try {
            const unlockRes = await api('/api/pdf/unlock', {
              method: 'POST',
              body: JSON.stringify({ client_file_no: clientFileNo, file_base64: file.base64, auto_try_saved: true })
            });
            if (unlockRes && unlockRes.ok && unlockRes.output_base64) {
              file.is_unlocked = true;
              file.base64 = unlockRes.output_base64;
              file.matched_label = unlockRes.matched_credential_label || 'Saved Password';
              file.show_unlock_panel = false;
              file.unlock_error = null;
            } else {
              file.is_unlocked = false;
              file.show_unlock_panel = true;
            }
          } catch (e) {
            file.is_unlocked = false;
            file.show_unlock_panel = true;
          }
        } else {
          file.is_unlocked = false;
          file.show_unlock_panel = true;
        }
      }
    } catch (e) {
      console.warn('PDF inspection error:', e);
    }
  }

  async function addIncomingFiles(newFilesList) {
    if (!newFilesList || !newFilesList.length) return;
    const startIndex = selectedFiles.length;
    for (const f of newFilesList) {
      const isPdf = Boolean(f.is_pdf || (f.name || f.filename || '').toLowerCase().endsWith('.pdf'));
      let stagedFileId = f.staged_file_id || null;
      let badge = f.badge || (f.source_local_path ? '📥 Chrome Download' : null);

      // Check if file is already in selectedFiles by staged_file_id or source_local_path
      const isDuplicate = selectedFiles.some(sf => 
        (stagedFileId && sf.staged_file_id === stagedFileId) ||
        (f.source_local_path && sf.source_local_path === f.source_local_path)
      );
      if (isDuplicate) continue;

      // Staging to disk for persistent session (only if not already staged)
      if (!stagedFileId && window.saveStaging) {
        try {
          if (!window.saveStaging.isInitialized || !window.saveStaging.sessionId) {
            await window.saveStaging.init();
          }
          const fileObj = f.fileObj || (f instanceof File ? f : null);
          if (fileObj) {
            const staged = await window.saveStaging.addFileDirect(fileObj, f.name || fileObj.name);
            if (staged) {
              stagedFileId = staged.staged_file_id;
              badge = staged.badge || null;
            }
          } else if (f.base64 || f.file_base64 || f._b64 || f.source_local_path) {
            const b64 = f.base64 || f.file_base64 || f._b64 || '';
            const res = await api(`/api/staging/sessions/${encodeURIComponent(window.saveStaging.sessionId)}/files`, {
              method: 'POST',
              body: JSON.stringify({
                original_name: f.name || f.filename || 'document.pdf',
                base64: b64,
                source_local_path: f.source_local_path || f.localPath || '',
                type: f.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
                size: f.size || 0
              })
            });
            if (res && res.file) {
              stagedFileId = res.file.staged_file_id;
              badge = res.file.badge || null;
              window.saveStaging.manifest.files.push(res.file);
            }
          }
        } catch (e) {
          console.warn('[Staging] Disk staging warning:', e);
        }
      }

      // Ensure window.saveStaging manifest knows about this file if staged
      if (window.saveStaging && stagedFileId) {
        if (!window.saveStaging.manifest.files) window.saveStaging.manifest.files = [];
        const inManifest = window.saveStaging.manifest.files.some(mf => mf.staged_file_id === stagedFileId);
        if (!inManifest) {
          window.saveStaging.manifest.files.push({
            staged_file_id: stagedFileId,
            filename: f.name || f.filename || 'document.pdf',
            name: f.name || f.filename || 'document.pdf',
            size: f.size || 0,
            is_pdf: isPdf,
            pdf_selected: false,
            badge: badge || '📥 Chrome Download'
          });
        }
      }

      const item = {
        staged_file_id: stagedFileId,
        staging_session_id: f.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : null),
        name: f.name || f.filename || 'document.pdf',
        size: f.size || (f.fileObj ? f.fileObj.size : 0),
        fileObj: f.fileObj || (f instanceof File ? f : null),
        base64: f.base64 || f.file_base64 || f._b64 || '',
        client_visibility: f.client_visibility !== undefined ? Boolean(f.client_visibility) : true,
        is_pdf: isPdf,
        pdf_selected: false,
        badge: badge,
        is_encrypted: isPdf ? null : false,
        is_unlocked: !isPdf,
        matched_label: null,
        show_unlock_panel: false,
        unlock_error: null,
        entered_password: '',
        source_local_path: f.source_local_path || f.localPath || '',
        source_url: f.source_url || f.url || '',
        downloadId: f.downloadId
      };
      selectedFiles.push(item);
    }
    renderSelectedFiles();

    // Inspect newly added files in background
    for (let i = startIndex; i < selectedFiles.length; i++) {
      const item = selectedFiles[i];
      if (item && item.is_pdf && item.is_encrypted === null) {
        await inspectAndAutoUnlockFile(item, clientSelect.value);
        renderSelectedFiles();
      }
    }
  }

  // Expose global handler and drain any files dropped onto the window before Save tab opened
  window.saveAddIncomingFiles = addIncomingFiles;
  if (window._pendingDroppedFiles && window._pendingDroppedFiles.length > 0) {
    const pendingFiles = window._pendingDroppedFiles;
    window._pendingDroppedFiles = null;
    setTimeout(() => {
      addIncomingFiles(pendingFiles);
    }, 80);
  }

  // Initialize staging session and rehydrate if files already exist
  if (window.saveStaging) {
    window.saveStaging.init().then(() => {
      const staged = window.saveStaging.getFiles();
      if (staged && staged.length > 0 && selectedFiles.length === 0) {
        staged.forEach(f => {
          selectedFiles.push({
            staged_file_id: f.staged_file_id,
            staging_session_id: window.saveStaging.sessionId,
            name: f.filename,
            size: f.size,
            is_pdf: Boolean(f.is_pdf),
            pdf_selected: Boolean(f.pdf_selected),
            badge: f.badge || null,
            client_visibility: true,
            is_encrypted: f.is_pdf ? null : false,
            is_unlocked: !f.is_pdf,
            matched_label: null,
            show_unlock_panel: false,
            unlock_error: null,
            entered_password: '',
            source_local_path: '',
            source_url: '',
            downloadId: null
          });
        });
        renderSelectedFiles();
      }
    }).catch(e => console.warn('[Staging] Init error:', e));
  }

  // Check incoming staging buffer from Chrome Extension
  if (typeof window.processIncomingStaging === 'function' && !incomingDrainInProgress) {
    api('/api/staging/incoming?drain=1').then(stageRes => {
      const hasFiles = stageRes && stageRes.ok && (
        (stageRes.count && stageRes.count > 0) ||
        (stageRes.staging && (
          (stageRes.staging.files && stageRes.staging.files.length > 0) ||
          (stageRes.staging.bulk && stageRes.staging.bulk.length > 0) ||
          (stageRes.staging.single && (stageRes.staging.single.filename || stageRes.staging.single.name)) ||
          stageRes.staging.is_redirected
        ))
      );
      if (hasFiles) {
        window.processIncomingStaging(stageRes.staging || stageRes);
      }
    }).catch(() => {});
  }

  function updateFolderDisplay() {
    if (selectedTargetFolder) {
      selectedFolderLabel.textContent = '/' + selectedTargetFolder;
      selectedFolderLabel.style.color = '#2563eb';
      resetFolderBtn.style.display = 'inline-block';
    } else {
      selectedFolderLabel.textContent = '/ (Client Root)';
      selectedFolderLabel.style.color = '#1e40af';
      resetFolderBtn.style.display = 'none';
    }
  }

  function renderSelectedFiles() {
    if (!selectedFiles.length) {
      filesContainer.style.display = 'none';
      fileLabel.textContent = 'Choose Files from Computer';
      return;
    }
    filesContainer.style.display = 'block';
    fileLabel.textContent = `${selectedFiles.length} file(s) selected`;

    const allPortalChecked = selectedFiles.every(f => f.client_visibility !== false);
    const pdfFiles = selectedFiles.filter(f => f.is_pdf);
    const selectedPdfs = selectedFiles.filter(f => f.is_pdf && f.pdf_selected);
    const allPdfsSelected = pdfFiles.length > 0 && selectedPdfs.length === pdfFiles.length;

    filesList.innerHTML = `
      <!-- PDF Studio Master Staging Bar -->
      <div class="save-staging-toolbar">
        <div style="display:flex;align-items:center;gap:12px;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#1e40af;cursor:${pdfFiles.length > 0 ? 'pointer' : 'not-allowed'};margin:0;">
            <input type="checkbox" id="master-pdf-select-check" ${allPdfsSelected ? 'checked' : ''} ${pdfFiles.length === 0 ? 'disabled' : ''} style="accent-color:#2563eb;cursor:${pdfFiles.length > 0 ? 'pointer' : 'not-allowed'};">
            <span>Select PDFs (${selectedPdfs.length}/${pdfFiles.length})</span>
          </label>
          <span style="font-size:11.5px;color:var(--muted);">Select PDF(s) to edit in PDF Studio</span>
        </div>
        <div>
          ${selectedPdfs.length > 0 ? `
            <button type="button" class="btn-open-pdf-studio" id="btn-open-pdf-studio" title="Send selected PDF(s) into PDF Studio">
              <span>📄 Open in PDF Studio</span>
              <span style="background:rgba(255,255,255,0.3);padding:1px 7px;border-radius:10px;font-size:11px;font-weight:800;">${selectedPdfs.length}</span>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="vs-files-table-header">
        <div style="width:36px;text-align:center;">Edit</div>
        <div style="flex:1;">Files (${selectedFiles.length})</div>
        <div style="display:flex;align-items:center;gap:18px;">
          <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#1e40af;cursor:pointer;margin:0;text-transform:none;" title="Toggle Client Portal access for all files">
            <input type="checkbox" id="master-portal-check" ${allPortalChecked ? 'checked' : ''} style="cursor:pointer;accent-color:#2563eb;">
            <span>👥 Client Portal (All)</span>
          </label>
          <span style="font-size:11px;color:var(--muted);width:95px;text-align:center;">Security</span>
          <span style="width:24px;"></span>
        </div>
      </div>

      <div class="vs-files-scroll-container">
        ${selectedFiles.map((file, idx) => {
          const isPdf = file.is_pdf || file.name.toLowerCase().endsWith('.pdf');
          const sizeStr = file.size ? `${(file.size / 1024).toFixed(1)} KB` : '';
          const isPortal = file.client_visibility !== false;

          let lockBadgeHtml = '';
          if (!isPdf) {
            lockBadgeHtml = `<span class="vs-pdf-status-glass-badge unlocked" title="Non-PDF file">📄 Ready</span>`;
          } else if (file.is_encrypted === null) {
            lockBadgeHtml = `<span class="vs-pdf-status-glass-badge checking">⏳ Checking...</span>`;
          } else if (!file.is_encrypted || file.is_unlocked) {
            const badgeTitle = file.matched_label ? `Auto-unlocked with: ${file.matched_label}` : 'File is unlocked and ready to save';
            lockBadgeHtml = `<span class="vs-pdf-status-glass-badge unlocked" title="${escapeHtml(badgeTitle)}">🔓 ${file.matched_label ? 'Auto-Unlocked' : 'Unlocked'}</span>`;
          } else {
            lockBadgeHtml = `
              <span class="vs-pdf-status-glass-badge locked btn-toggle-unlock-drawer" data-idx="${idx}" title="PDF is locked. Click to enter password">
                🔒 Locked
              </span>
            `;
          }

          let fileIcon = '📄';
          const lowerName = (file.name || '').toLowerCase();
          if (isPdf) fileIcon = '📕';
          else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) fileIcon = '📊';
          else if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) fileIcon = '📝';
          else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp')) fileIcon = '🖼️';
          else if (lowerName.endsWith('.zip') || lowerName.endsWith('.rar')) fileIcon = '📦';

          return `
            <div class="vs-file-item-card">
              <div class="vs-file-row">
                <div style="width:36px;display:flex;align-items:center;justify-content:center;">
                  ${isPdf ? `
                    <input type="checkbox" class="file-pdf-select-check" data-idx="${idx}" ${file.pdf_selected ? 'checked' : ''} style="cursor:pointer;accent-color:#2563eb;width:16px;height:16px;" title="Select this PDF for PDF Studio">
                  ` : `
                    <span class="stg-badge non-pdf" title="Non-PDF files cannot be opened in PDF Studio">N/A</span>
                  `}
                </div>

                <div class="vs-file-meta">
                  <span style="font-size:18px;">${fileIcon}</span>
                  <div class="vs-file-name-block">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <strong style="color:var(--ink);font-size:12.5px;">${escapeHtml(file.name)}</strong>
                      ${file.badge ? `<span class="stg-badge processed" title="Processed in PDF Studio">${escapeHtml(file.badge)}</span>` : ''}
                    </div>
                    <span style="color:var(--muted);font-size:11px;">${sizeStr}</span>
                  </div>
                </div>

                <div class="vs-file-actions-group">
                  <label class="vs-portal-check-label" title="Save this file into the Client's Google Drive Portal">
                    <input type="checkbox" class="file-portal-check" data-idx="${idx}" ${isPortal ? 'checked' : ''} style="cursor:pointer;accent-color:#2563eb;">
                    <span>👥 Portal</span>
                  </label>

                  <div style="width:95px;display:flex;justify-content:center;">
                    ${lockBadgeHtml}
                  </div>

                  <button type="button" class="btn-remove-file" data-idx="${idx}" title="Remove file" style="background:transparent;border:0;color:#ef4444;cursor:pointer;font-weight:700;font-size:16px;line-height:1;padding:4px 6px;border-radius:6px;">×</button>
                </div>
              </div>

              ${(file.show_unlock_panel && isPdf && !file.is_unlocked) ? `
                <div class="vs-inline-unlock-drawer">
                  <span style="font-size:11.5px;font-weight:700;color:#92400e;display:flex;align-items:center;gap:4px;">
                    <span>🔑</span> Enter PDF Password:
                  </span>
                  <input type="password" class="inline-pdf-pw-input" data-idx="${idx}" placeholder="Password for this PDF..." value="${escapeHtml(file.entered_password || '')}" style="flex:1;min-width:140px;padding:4px 8px;font-size:12px;border:1px solid #d97706;border-radius:6px;background:#fff;">
                  <button type="button" class="btn-inline-unlock primary btn-sm" data-idx="${idx}" style="font-size:11px;font-weight:700;padding:4px 12px;background:#d97706;border-color:#b45309;color:#fff;">Unlock & Remember</button>
                  ${file.unlock_error ? `<div style="width:100%;color:#dc2626;font-size:11px;font-weight:700;margin-top:2px;">⚠️ ${escapeHtml(file.unlock_error)}</div>` : ''}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Master PDF select check
    const masterPdfCheck = filesList.querySelector('#master-pdf-select-check');
    if (masterPdfCheck && !masterPdfCheck.disabled) {
      masterPdfCheck.onchange = () => {
        const val = masterPdfCheck.checked;
        selectedFiles.forEach(f => {
          if (f.is_pdf) {
            f.pdf_selected = val;
            if (window.saveStaging && f.staged_file_id) {
              window.saveStaging.toggleFilePdfSelection(f.staged_file_id, val);
            }
          }
        });
        renderSelectedFiles();
      };
    }

    // Individual PDF select check
    filesList.querySelectorAll('.file-pdf-select-check').forEach(chk => {
      chk.onchange = () => {
        const idx = Number(chk.dataset.idx);
        if (selectedFiles[idx]) {
          selectedFiles[idx].pdf_selected = chk.checked;
          if (window.saveStaging && selectedFiles[idx].staged_file_id) {
            window.saveStaging.toggleFilePdfSelection(selectedFiles[idx].staged_file_id, chk.checked);
          }
          renderSelectedFiles();
        }
      };
    });

    // Open in PDF Studio button
    const openPdfStudioBtn = filesList.querySelector('#btn-open-pdf-studio');
    if (openPdfStudioBtn) {
      openPdfStudioBtn.onclick = async () => {
        const origHtml = openPdfStudioBtn.innerHTML;
        try {
          if (window.saveStaging) {
            openPdfStudioBtn.disabled = true;
            openPdfStudioBtn.style.opacity = '0.7';
            openPdfStudioBtn.innerHTML = '<span>⏳ Opening in PDF Studio...</span>';
            await window.saveStaging.openPdfStudioWithSelected();
          }
        } catch (err) {
          alert('Could not open PDF Studio: ' + err.message);
        } finally {
          if (openPdfStudioBtn) {
            openPdfStudioBtn.disabled = false;
            openPdfStudioBtn.style.opacity = '1';
            openPdfStudioBtn.innerHTML = origHtml;
          }
        }
      };
    }

    // Master portal checkbox handler
    const masterCheck = filesList.querySelector('#master-portal-check');
    if (masterCheck) {
      masterCheck.onchange = () => {
        const val = masterCheck.checked;
        selectedFiles.forEach(f => { f.client_visibility = val; });
        renderSelectedFiles();
      };
    }

    // Individual portal checkbox handler
    filesList.querySelectorAll('.file-portal-check').forEach(chk => {
      chk.onchange = () => {
        const idx = Number(chk.dataset.idx);
        if (selectedFiles[idx]) {
          selectedFiles[idx].client_visibility = chk.checked;
          const allChecked = selectedFiles.every(f => f.client_visibility !== false);
          const masterEl = filesList.querySelector('#master-portal-check');
          if (masterEl) masterEl.checked = allChecked;
        }
      };
    });

    // Toggle unlock drawer on badge click
    filesList.querySelectorAll('.btn-toggle-unlock-drawer').forEach(badge => {
      badge.onclick = () => {
        const idx = Number(badge.dataset.idx);
        if (selectedFiles[idx]) {
          selectedFiles[idx].show_unlock_panel = !selectedFiles[idx].show_unlock_panel;
          renderSelectedFiles();
        }
      };
    });

    // Inline unlock handler
    filesList.querySelectorAll('.btn-inline-unlock').forEach(btn => {
      btn.onclick = async () => {
        const idx = Number(btn.dataset.idx);
        const item = selectedFiles[idx];
        if (!item) return;
        const pwInput = filesList.querySelector(`.inline-pdf-pw-input[data-idx="${idx}"]`);
        const enteredPw = (pwInput ? pwInput.value : '').trim();
        if (!enteredPw) {
          item.unlock_error = 'Please enter password.';
          renderSelectedFiles();
          return;
        }
        item.entered_password = enteredPw;
        btn.disabled = true;
        btn.textContent = 'Unlocking...';

        try {
          if (!item.base64 && item.fileObj) {
            item.base64 = await fileToBase64(item.fileObj);
          }
          const unlockRes = await api('/api/pdf/unlock', {
            method: 'POST',
            body: JSON.stringify({
              client_file_no: clientSelect.value || '',
              file_base64: item.base64,
              password: enteredPw,
              remember_password: true,
              label: `${item.name.replace(/\.pdf$/i, '')} Password`
            })
          });

          if (unlockRes && unlockRes.ok && unlockRes.output_base64) {
            item.is_unlocked = true;
            item.is_encrypted = false;
            item.base64 = unlockRes.output_base64;
            item.matched_label = 'Entered Password (Saved)';
            item.show_unlock_panel = false;
            item.unlock_error = null;
            renderSelectedFiles();
          } else {
            item.unlock_error = 'Could not unlock PDF. Please verify password.';
            renderSelectedFiles();
          }
        } catch (err) {
          item.unlock_error = err.message || 'Incorrect password.';
          renderSelectedFiles();
        }
      };
    });

    // Enter key in password input
    filesList.querySelectorAll('.inline-pdf-pw-input').forEach(inp => {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const idx = inp.dataset.idx;
          const unlockBtn = filesList.querySelector(`.btn-inline-unlock[data-idx="${idx}"]`);
          if (unlockBtn) unlockBtn.click();
        }
      };
    });

    // Remove file handler
    filesList.querySelectorAll('.btn-remove-file').forEach(btn => {
      btn.onclick = async () => {
        const idx = Number(btn.dataset.idx);
        const item = selectedFiles[idx];
        if (item && item.staged_file_id && window.saveStaging) {
          await window.saveStaging.removeFile(item.staged_file_id);
        }
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      };
    });
  }

  dropzone.onclick = () => fileInput.click();
  dropzone.ondragover = e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropzone.style.background = 'rgba(238, 242, 255, 0.9)';
    dropzone.style.borderColor = '#4968ed';
  };
  dropzone.ondragleave = () => {
    dropzone.style.background = 'rgba(255, 255, 255, 0.55)';
    dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)';
  };
  dropzone.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.background = 'rgba(255, 255, 255, 0.55)';
    dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)';
    const overlay = document.getElementById('vs-global-drop-overlay');
    if (overlay) overlay.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addIncomingFiles(Array.from(e.dataTransfer.files));
      showNativeToast(`📥 Added ${e.dataTransfer.files.length} document(s) to Save workspace`, 'success');
    }
  };
  fileInput.onchange = () => {
    if (fileInput.files && fileInput.files.length > 0) {
      addIncomingFiles(Array.from(fileInput.files));
    }
  };

  async function loadTree(fno) {
    if (!fno) {
      canonicalTree = [];
      navPath = '';
      renderNav();
      return;
    }
    folderListEl.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--muted);text-align:center;">Loading folder structure...</div>';
    try {
      const storageKind = storageSelect.value;
      const res = await api(`/api/client-folders/${encodeURIComponent(fno)}/tree?storage_kind=${storageKind}`);
      canonicalTree = res?.tree || [];
      navPath = '';
      renderNav();
    } catch (err) {
      canonicalTree = [];
      folderListEl.innerHTML = `<div style="padding:14px;font-size:12px;color:#dc2626;text-align:center;">Cannot load folders: ${escapeHtml(err.message)}</div>`;
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

  function renderNav() {
    folderCrumb.textContent = navPath ? `/${navPath}` : '/ (Client Root)';
    navUpBtn.disabled = !navPath;

    if (!clientSelect.value) {
      folderListEl.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center;">Please select a client above to view folders.</div>';
      return;
    }

    const node = findSubNode(canonicalTree, navPath);
    const folders = (node && node.children) ? node.children.filter(n => n.type === 'folder' && !(n.name || '').toLowerCase().includes('client shared folder') && !(n.relative_path || '').toLowerCase().includes('client shared folder')) : [];

    if (folders.length === 0) {
      folderListEl.innerHTML = `
        <div style="padding:14px;font-size:12px;color:var(--muted);text-align:center;">
          No subfolders here.<br>
          <button type="button" id="web-empty-select-btn" class="primary btn-sm" style="margin-top:8px;font-size:11px;font-weight:700;">
            ✓ Use ${escapeHtml(navPath ? '/' + navPath : 'Client Root')}
          </button>
        </div>
      `;
      const emptyBtn = folderListEl.querySelector('#web-empty-select-btn');
      if (emptyBtn) {
        emptyBtn.onclick = () => {
          selectedTargetFolder = navPath;
          updateFolderDisplay();
        };
      }
      return;
    }

    folderListEl.innerHTML = folders.map(f => {
      const subCount = (f.children && Array.isArray(f.children)) ? f.children.filter(n => n.type === 'folder').length : 0;
      const itemPath = navPath ? `${navPath}/${f.name}` : f.name;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:3px 0;border-radius:10px;background:rgba(255,255,255,0.7);border:1px solid var(--line);font-size:12px;">
          <div class="web-folder-name-btn" data-path="${escapeHtml(itemPath)}" style="cursor:pointer;flex:1;display:flex;align-items:center;gap:6px;">
            <span>📁</span>
            <strong>${escapeHtml(f.name)}</strong>
            ${subCount > 0 ? `<small style="color:var(--muted);">(${subCount})</small>` : ''}
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="web-folder-select-btn" data-path="${escapeHtml(itemPath)}" style="font-size:11px;padding:3px 10px;background:#4968ed;color:#fff;border:0;border-radius:8px;cursor:pointer;font-weight:700;">Select</button>
            ${subCount > 0 ? `<button type="button" class="web-folder-open-btn" data-path="${escapeHtml(itemPath)}" style="font-size:11px;padding:3px 10px;background:#eef2ff;color:#334155;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-weight:700;">Open ›</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    folderListEl.querySelectorAll('.web-folder-select-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        selectedTargetFolder = btn.getAttribute('data-path') || '';
        updateFolderDisplay();
      };
    });

    folderListEl.querySelectorAll('.web-folder-open-btn, .web-folder-name-btn').forEach(el => {
      el.onclick = () => {
        navPath = el.getAttribute('data-path') || '';
        selectedTargetFolder = navPath;
        updateFolderDisplay();
        renderNav();
      };
    });
  }

  clientSelect.onchange = async () => {
    selectedTargetFolder = '';
    navPath = '';
    updateFolderDisplay();
    const fno = clientSelect.value;
    if (fno) {
      loadTree(fno);
      // Auto-try all currently locked PDFs with the newly selected client's saved passwords!
      let changed = false;
      for (const item of selectedFiles) {
        if (item.is_pdf && !item.is_unlocked) {
          await inspectAndAutoUnlockFile(item, fno);
          changed = true;
        }
      }
      if (changed) {
        renderSelectedFiles();
      }
    } else {
      canonicalTree = [];
      renderNav();
    }
  };

  storageSelect.onchange = () => {
    if (clientSelect.value) loadTree(clientSelect.value);
  };

  navUpBtn.onclick = () => {
    if (!navPath) return;
    const parts = navPath.split('/');
    parts.pop();
    navPath = parts.join('/');
    selectedTargetFolder = navPath;
    updateFolderDisplay();
    renderNav();
  };

  selectThisBtn.onclick = () => {
    selectedTargetFolder = navPath;
    updateFolderDisplay();
  };

  resetFolderBtn.onclick = () => {
    selectedTargetFolder = '';
    navPath = '';
    updateFolderDisplay();
    renderNav();
  };

  field('save-document').onclick = async () => {
    try {
      if (!selectedFiles.length) throw Error('Choose or drop at least one file.');
      if (!clientSelect.value) throw Error('Select a client.');

      // Check if any PDF is still locked
      const lockedFiles = selectedFiles.filter(f => f.is_pdf && !f.is_unlocked && f.is_encrypted);
      if (lockedFiles.length > 0) {
        const choice = await showLockedPdfPromptModal(lockedFiles);
        if (choice === 'unlock') {
          lockedFiles.forEach(f => { f.show_unlock_panel = true; });
          renderSelectedFiles();
          const firstInp = filesList.querySelector('.inline-pdf-pw-input');
          if (firstInp) firstInp.focus();
          return;
        }
        // If choice === 'continue', proceed with saving as normal!
      }

      const clientName = clientSelect.options[clientSelect.selectedIndex] ? clientSelect.options[clientSelect.selectedIndex].textContent.replace(/\(.*?\)/g, '').trim() : clientSelect.value;
      const totalFiles = selectedFiles.length;

      const activePeriod = (rules && rules.periods && rules.periods.length > 0) ? rules.periods[0] : 'AY 2025-26';
      let docPeriod = activePeriod;
      if (selectedTargetFolder) {
        const match = selectedTargetFolder.match(/\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b/i);
        if (match) docPeriod = match[0];
      }

      const isQueuedMode = (totalFiles > 5) || (window.fileSaveQueue && (window.fileSaveQueue.isProcessing() || window.fileSaveQueue.getPendingCount() > 0));

      if (isQueuedMode) {
        // Enqueue for background saving
        const filesToQueue = selectedFiles.map(f => ({
          name: f.name,
          staged_file_id: f.staged_file_id || undefined,
          staging_session_id: f.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : undefined),
          fileObj: f.fileObj || f,
          file_base64: f.base64 || '',
          client_visibility: f.client_visibility !== false,
          source_local_path: f.source_local_path || f.localPath || '',
          source_url: f.source_url || f.url || '',
          downloadId: f.downloadId
        }));

        window.fileSaveQueue.enqueue({
          client_file_no: clientSelect.value,
          client_name: clientName,
          target_folder: selectedTargetFolder,
          period: docPeriod,
          save_local: field('save-local').checked,
          save_drive: (settings.google_drive_mode !== 'only_client' && settings.google_drive_mode !== 'disabled') ? field('save-drive').checked : false,
          client_visibility: true,
          upload_practive: field('practive').checked,
          files: filesToQueue
        });

        // Automatically show tick animation with text "Files will be saved shortly"
        showGlassmorphicSuccessAnimation("Files will be saved shortly");

        result.innerHTML = message(`📋 <strong>${totalFiles} file(s) added to background queue</strong> for <strong>${escapeHtml(clientName)}</strong>. Files will be saved in the background. You can now select another client and continue saving.`);

        // Clear files and reset form immediately so user can save for other clients
        selectedFiles = [];
        if (window.saveStaging) {
          window.saveStaging.manifest.files = [];
        }
        renderSelectedFiles();
        const saveBtn = field('save-document');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Documents';
        }
        return;
      }

      // If <= 5 files and no queue active: interactive saving
      const saveBtn = field('save-document');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving Documents...';

      const pb = showGlassProgressBar({
        title: 'Saving Documents',
        subtitle: `Preparing ${totalFiles} file(s)...`,
        initialPercent: 5
      });

      let portal = '';
      if (totalFiles > 1) {
        pb.update(25, `Preparing ${totalFiles} files in parallel...`);
        const preparedFiles = await Promise.all(selectedFiles.map(async (file, idx) => {
          let b64 = file.base64;
          if (!b64 && !file.staged_file_id && !file.source_local_path && file.fileObj) {
            b64 = await fileToBase64(file.fileObj);
          }
          return {
            document_name: file.name,
            file_base64: b64,
            staged_file_id: file.staged_file_id || undefined,
            staging_session_id: file.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : undefined),
            source_local_path: file.source_local_path || file.localPath || '',
            source_url: file.source_url || file.url || '',
            downloadId: file.downloadId,
            client_visibility: file.client_visibility !== false
          };
        }));

        pb.update(60, `Saving ${totalFiles} files in fast batch...`);
        const allowDriveOffice = (settings.google_drive_mode !== 'only_client' && settings.google_drive_mode !== 'disabled') && field('save-drive').checked;
        const bulkPayload = {
          client_file_no: clientSelect.value,
          service: 'General',
          period: docPeriod,
          target_folder: selectedTargetFolder || '',
          relative_path: selectedTargetFolder || '',
          save_local: field('save-local').checked,
          save_drive: allowDriveOffice,
          client_visibility: true,
          upload_practive: field('practive').checked,
          files: preparedFiles
        };

        const res = await api('/api/files/bulk-save', { method: 'POST', body: JSON.stringify(bulkPayload) });
        if (res.client_portal_link) portal = res.client_portal_link;
        pb.update(100, `Saved ${totalFiles} file(s) successfully!`);
      } else if (totalFiles === 1) {
        const file = selectedFiles[0];
        pb.update(40, `Saving "${file.name}"...`);
        let b64 = file.base64;
        if (!b64 && !file.staged_file_id && !file.source_local_path && file.fileObj) {
          b64 = await fileToBase64(file.fileObj);
        }
        const allowDriveOffice = (settings.google_drive_mode !== 'only_client' && settings.google_drive_mode !== 'disabled') && field('save-drive').checked;
        const payload = {
          client_file_no: clientSelect.value,
          service: 'General',
          period: docPeriod,
          document_name: file.name,
          file_base64: b64,
          staged_file_id: file.staged_file_id || undefined,
          staging_session_id: file.staging_session_id || (window.saveStaging ? window.saveStaging.sessionId : undefined),
          source_local_path: file.source_local_path || file.localPath || '',
          source_url: file.source_url || file.url || '',
          downloadId: file.downloadId,
          save_local: field('save-local').checked,
          save_drive: allowDriveOffice,
          client_visibility: file.client_visibility !== false,
          upload_practive: field('practive').checked
        };
        if (selectedTargetFolder) {
          payload.target_folder = selectedTargetFolder;
          payload.relative_path = selectedTargetFolder;
        }
        const r = await api('/api/save-document', { method: 'POST', body: JSON.stringify(payload) });
        if (r.client_portal_link) portal = r.client_portal_link;
        pb.update(100, 'Saved 1 file successfully!');
      }

      // Finish progress bar and play checkmark animation with custom message
      await pb.finish(totalFiles === 1 ? 'File Saved Successfully' : `${totalFiles} Files Saved Successfully`);

      result.innerHTML = message(`${selectedFiles.length} file(s) saved successfully into ${selectedTargetFolder ? '/' + escapeHtml(selectedTargetFolder) : 'Client Root'}.${portal ? '<br>Client portal: <a target="_blank" href="' + portal + '">Open Google Drive Client Portal</a>' : ''}`);
      selectedFiles = [];
      if (window.saveStaging) {
        window.saveStaging.clearSession().catch(() => {});
      }
      renderSelectedFiles();
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Documents';
      if (clientSelect.value) await loadTree(clientSelect.value);

      // 2. If redirected from Chrome Extension, automatically return to original portal tab
      if (isRedirectedFromExt || window._isRedirectedFromExt || originTabId || window._originTabId) {
        const targetTabId = originTabId || window._originTabId;
        try {
          await api('/api/desktop/return_to_browser', {
            method: 'POST',
            body: JSON.stringify({ origin_tab_id: targetTabId })
          });
        } catch (_) {}
        window.postMessage({
          type: 'VS_SAVED_CLOSE_AND_RETURN',
          origin_tab_id: targetTabId
        }, '*');
        window._isRedirectedFromExt = false;
        window._originTabId = null;
      }
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      result.innerHTML = message(e.message, true);
      const saveBtn = field('save-document');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Documents';
      }
    }
  };
}

async function drive() {
  const status = await api('/api/google/status');
  content.innerHTML = `
    <div class="glass card">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
        <svg class="i" style="width:36px;height:36px;color:#2563eb;" aria-hidden="true"><use href="#drive"/></svg>
        <div>
          <h1 style="margin:0;font-size:24px;font-weight:600;">Google Drive Client Sharing</h1>
          <p class="muted" style="margin:2px 0 0;font-size:13px;">Connect your firm Google Drive once. The system automatically maintains separated, secure Client Document Access portals for each client.</p>
        </div>
      </div>
      <div class="grid" style="margin-top:20px;">
        <div><label>Google OAuth credentials JSON</label><input id="google-credentials" type="file" accept="application/json,.json"><p class="muted" style="margin-top:4px;">Redirect URI:<br><code>${status.redirect_uri}</code></p></div>
        <div>
          <label>Connection status</label>
          <p class="path" style="display:flex;align-items:center;gap:8px;">
            <svg class="i" style="width:18px;height:18px;color:${status.connected ? '#10b981' : '#f59e0b'};" aria-hidden="true"><use href="#drive"/></svg>
            <strong>${status.connected ? 'Connected to Google Drive' : 'Not connected'}</strong>
          </p>
          <p class="muted">Credentials: ${status.credentials_uploaded ? 'uploaded' : 'not uploaded'}</p>
        </div>
      </div>
      <div style="margin-top:16px;background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:16px;">
        <label style="font-weight:700;margin-bottom:6px;display:block;color:var(--tx);">Google Drive Usage Mode</label>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <select id="drive-usage-mode" class="input" style="flex:1;min-width:280px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font-size:13.5px;background:var(--glass2);">
            <option value="backup_and_client" ${status.google_drive_mode === 'backup_and_client' || !status.google_drive_mode ? 'selected' : ''}>Use Google Drive for backup And Client</option>
            <option value="only_client" ${status.google_drive_mode === 'only_client' ? 'selected' : ''}>Only Client</option>
            <option value="only_backup" ${status.google_drive_mode === 'only_backup' ? 'selected' : ''}>Only Backup</option>
            <option value="disabled" ${status.google_drive_mode === 'disabled' ? 'selected' : ''}>Disable</option>
          </select>
          <button class="btn p" id="save-drive-mode" style="padding:9px 18px;font-size:13px;">Save Drive Mode</button>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:12px;">Controls whether Google Drive handles both Client Document Portals and System Backups, is dedicated solely to Client Portals or Backups, or is disabled.</p>
      </div>
      <div class="row" style="margin-top:20px;">
        <button class="btn secondary" id="upload-google"><svg class="i" aria-hidden="true"><use href="#upload"/></svg>Upload credentials</button>
        <button class="btn p" id="connect-google"><svg class="i" aria-hidden="true"><use href="#drive"/></svg>Connect Google Drive</button>
        <button class="btn secondary" id="create-portals"><svg class="i" aria-hidden="true"><use href="#folder"/></svg>Create client folder links</button>
      </div>
      <div id="result" style="margin-top:12px;"></div>
    </div>
  `;
  const field = id => document.getElementById(id), result = field('result');
  field('save-drive-mode').onclick = async () => {
    try {
      const mode = field('drive-usage-mode').value;
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ google_drive_mode: mode })
      });
      result.innerHTML = message(`Google Drive mode updated to: <strong>${field('drive-usage-mode').selectedOptions[0].text}</strong>`);
    } catch (e) {
      result.innerHTML = message(e.message, true);
    }
  };
  field('upload-google').onclick = async () => {
    try {
      const file = field('google-credentials').files[0];
      if (!file) throw Error('Choose the OAuth credentials JSON file.');
      const pb = showGlassProgressBar({ title: 'Uploading Credentials', subtitle: 'Processing OAuth JSON...' });
      pb.simulate(600);
      await api('/api/google/credentials', { method: 'POST', body: JSON.stringify({ file_base64: await fileToBase64(file) }) });
      await pb.finish('Google Credentials Uploaded Successfully');
      result.innerHTML = message('Credentials uploaded. Click Connect Google Drive.');
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      result.innerHTML = message(e.message, true);
    }
  };
  field('connect-google').onclick = async () => {
    try {
      const r = await api('/api/google/connect', { method: 'POST', body: '{}' });
      window.open(r.authorization_url, '_blank');
      result.innerHTML = message('Google authorization opened in a new tab. Complete sign-in, and this page will update automatically.');
      const onMsg = async (ev) => {
        if (ev.data && ev.data.type === 'GOOGLE_DRIVE_CONNECTED') {
          window.removeEventListener('message', onMsg);
          await drive();
        }
      };
      window.addEventListener('message', onMsg);
    } catch (e) { result.innerHTML = message(e.message, true); }
  };
  field('create-portals').onclick = async () => {
    const btn = field('create-portals');
    try {
      btn.disabled = true;
      btn.textContent = 'Generating PDFs…';
      const pb = showGlassProgressBar({ title: 'Generating Portal Access PDFs', subtitle: 'Creating access PDFs with QR codes...' });
      pb.simulate(1400);
      const r = await api('/api/google/create-client-portals', { method: 'POST', body: '{}' });
      await pb.finish(`Generated ${r.created + r.already_present} Client Portal PDFs`);
      const msg = `Successfully generated/updated ${r.created + r.already_present} Client Document Access PDFs in "${settings.local_root || 'D:\\Code Trial'}\\Client Access Links".`;
      result.innerHTML = message(msg);
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      result.innerHTML = message(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create client folder links';
    }
  };
}

async function activity() {
  let jobs = [], activityLog = [];
  try { jobs = await api('/api/jobs'); } catch (_) {}
  try { activityLog = await api('/api/activity-log'); } catch (_) {}
  const eventIcon = (type) => {
    if (type.includes('import')) return '<div class="event-icon import"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#upload"/></svg></div>';
    if (type.includes('replace')) return '<div class="event-icon replace"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#refresh"/></svg></div>';
    if (type.includes('skip')) return '<div class="event-icon skip">&rarr;</div>';
    if (type.includes('rename')) return '<div class="event-icon rename"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#edit"/></svg></div>';
    if (type.includes('folder') || type.includes('reconcil')) return '<div class="event-icon folder"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#folder"/></svg></div>';
    if (type.includes('revok') || type.includes('revert')) return '<div class="event-icon skip" style="background:#fee2e2;color:#991b1b;"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#refresh"/></svg></div>';
    return '<div class="event-icon import"><svg class="i" style="width:14px;height:14px;" aria-hidden="true"><use href="#activity"/></svg></div>';
  };
  content.innerHTML = `
    <div class="glass card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div>
          <h1>Recent filing activity</h1>
          <p class="muted">Live log of saved filings. The top 5 recent tasks can be reverted with 30-day safe archive auto-cleanup.</p>
        </div>
      </div>
      <div id="activity-alert"></div>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Client</th>
              <th>Destination Directory</th>
              <th>Document</th>
              <th>Status</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.length === 0 ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:18px;">No filing activity recorded yet.</td></tr>' : jobs.map((j, idx) => `
              <tr style="${j.status === 'revoked' ? 'opacity:0.65;background:#f8fafc;' : ''}">
                <td>${new Date(j.created_at).toLocaleString()}</td>
                <td><b>${escapeHtml(j.actor || 'Host')}</b></td>
                <td><b>${escapeHtml(j.client_name)}</b><br><small class="muted">${escapeHtml(j.client_file_no)}</small></td>
                <td><code>${escapeHtml(j.destination_folder || j.target_folder || (j.service + ' / ' + j.period))}</code></td>
                <td><b>${escapeHtml(j.document_name)}</b></td>
                <td>
                  <span class="chip ${j.status === 'revoked' ? 'w' : (j.status === 'saved' ? '' : 'w')}">${escapeHtml(j.status)}</span>
                  ${j.reverted_at ? `<br><small class="muted">Reverted ${new Date(j.reverted_at).toLocaleTimeString()}</small>` : ''}
                </td>
                <td style="text-align:right;">
                  ${j.is_revocable && j.status !== 'revoked' ? `
                    <button class="btn ib d tip btn-revert-job" data-t="Revert" data-id="${escapeHtml(j.id)}" data-doc="${escapeHtml(j.document_name)}" aria-label="Revert"><svg class="i" aria-hidden="true"><use href="#refresh"/></svg></button>
                  ` : (j.status === 'revoked' ? `
                    <span style="color:#64748b;font-size:11px;font-style:italic;">Safe Archived</span>
                  ` : `
                    <span class="muted" style="font-size:11px;">Completed</span>
                  `)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="glass card">
      <h2>System Activity Log</h2>
      <p class="muted">Import, replace, rename, reconciliation, folder, and security events.</p>
      ${activityLog.length === 0 ? '<p class="muted">No activity events recorded yet.</p>' :
        activityLog.slice(0, 100).map(e => `
          <div class="activity-event">
            ${eventIcon(e.event_type)}
            <div class="event-body">
              <strong>${escapeHtml(e.event_type)}</strong>
              ${e.client_name ? ` — ${escapeHtml(e.client_name)}` : ''}
              ${e.client_file_no ? ` <small>(${escapeHtml(e.client_file_no)})</small>` : ''}
              ${e.details ? `<br><small>${escapeHtml(e.details)}</small>` : ''}
              ${e.actor ? `<br><small class="muted">by ${escapeHtml(e.actor)}</small>` : ''}
            </div>
            <span class="event-time">${new Date(e.created_at).toLocaleString()}</span>
          </div>
        `).join('')}
    </div>
  `;

  content.querySelectorAll('.btn-revert-job').forEach(btn => {
    btn.onclick = async () => {
      const docName = btn.dataset.doc;
      if (!confirm(`Are you sure you want to revert "${docName}"?\n\nThe saved file will be safely shifted to the Revoked Archive folder (auto-cleaned per 30-day retention).`)) return;
      try {
        btn.disabled = true;
        btn.textContent = 'Reverting...';
        const res = await api('/api/jobs/revert', { method: 'POST', body: JSON.stringify({ job_id: btn.dataset.id }) });
        await activity();
        const alertBox = document.getElementById('activity-alert');
        if (alertBox) {
          alertBox.innerHTML = message(`✓ ${res.message || 'Task reverted successfully.'}`);
        }
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = '↩ Revert';
      }
    };
  });
}

async function usersPage() {
  if (currentUser?.role !== 'host') {
    content.innerHTML = message('Access restricted to Host administrator.', true);
    return;
  }
  const data = await api('/api/admin/users');
  const pendingRequests = data.requests.filter(r => r.status === 'pending');

  content.innerHTML = `
    ${pendingRequests.length > 0 ? `
    <section class="glass card" style="border-color:rgba(245,158,11,0.4);margin-bottom:16px;">
      <h2 style="color:var(--wn);"><svg class="i"><use href="#alert"/></svg>Pending device access requests (${pendingRequests.length})</h2>
      <div id="pending-requests-container">
        ${pendingRequests.map(r => `
          <div class="req-item" id="req-${r.request_id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);">
            <div class="req-meta">
              <b>${escapeHtml(r.user_id)}</b> &middot; Device: <strong>${escapeHtml(r.device_name)}</strong> (<code>${escapeHtml(r.ip_address)}</code>)<br>
              <small class="muted">Requested at: ${new Date(r.created_at).toLocaleString()}</small>
            </div>
            <div class="acts">
              <button class="btn p btn-sm btn-approve" data-id="${r.request_id}">Approve</button>
              <button class="btn d btn-sm btn-reject" data-id="${r.request_id}">Reject</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="req-result" style="margin-top:10px;"></div>
    </section>
    ` : ''}

    <section class="glass card" style="margin-bottom:16px;">
      <h2><svg class="i"><use href="#users"/></svg>Approved devices</h2>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>User</th>
              <th>IP Address</th>
              <th>Last active</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.devices.map(d => `
              <tr>
                <td><b>${escapeHtml(d.device_name)}</b><br><small class="muted" style="font-family:monospace;">${escapeHtml((d.device_id || '').substring(0, 16))}...</small></td>
                <td>${escapeHtml(d.user_id)}</td>
                <td><code>${escapeHtml(d.ip_address)}</code></td>
                <td>${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'Never'}</td>
                <td><span class="chip ${d.status === 'approved' ? '' : 'w'}">${escapeHtml(d.status)}</span></td>
                <td>
                  <div class="acts">
                    ${d.status === 'approved' ? `
                      <button class="btn btn-sm btn-toggle-dev" data-id="${d.device_id}" data-status="disabled">Disable</button>
                      <button class="btn ib d tip btn-revoke-dev" data-t="Revoke" aria-label="Revoke device" data-id="${d.device_id}"><svg class="i"><use href="#trash"/></svg></button>
                    ` : d.status === 'disabled' ? `
                      <button class="btn p btn-sm btn-toggle-dev" data-id="${d.device_id}" data-status="approved">Enable</button>
                      <button class="btn ib d tip btn-revoke-dev" data-t="Revoke" aria-label="Revoke device" data-id="${d.device_id}"><svg class="i"><use href="#trash"/></svg></button>
                    ` : `<span class="muted">Revoked</span>`}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="glass card">
      <div class="row" style="margin-bottom:12px;">
        <h2><svg class="i"><use href="#users"/></svg>User accounts</h2>
        <span class="sp"></span>
        <div id="users-alert"></div>
      </div>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Password (Host view)</th>
              <th>Created</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map(u => `
              <tr>
                <td><b>${escapeHtml(u.user_id)}</b></td>
                <td>${u.role === 'host' ? '<b>Host Admin</b>' : 'Staff'}</td>
                <td><span class="chip ${u.status === 'active' ? '' : 'w'}">${escapeHtml(u.status)}</span></td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span class="pwd-display" data-uid="${escapeHtml(u.user_id)}" style="font-family:monospace;font-size:13px;letter-spacing:1px;">••••••••</span>
                    <button class="btn ib tip btn-toggle-pwd" data-uid="${escapeHtml(u.user_id)}" data-pwd="${escapeHtml(u.password_text || '')}" data-t="Show/Hide" aria-label="View Password"><svg class="i"><use href="#search"/></svg></button>
                  </div>
                </td>
                <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</td>
                <td>
                  <div class="acts">
                    ${u.role !== 'host' ? (u.status === 'active' ? `
                      <button class="btn btn-sm btn-toggle-user" data-user="${u.user_id}" data-status="disabled">Disable</button>
                    ` : `
                      <button class="btn p btn-sm btn-toggle-user" data-user="${u.user_id}" data-status="active">Enable</button>
                    `) : `<span class="chip">Owner</span>`}
                    <button class="btn btn-sm btn-change-pwd" data-uid="${escapeHtml(u.user_id)}">Reset password</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:12px;font-size:12.5px;">Passwords are secured in SQLite vault. Reset allows configuring a new password directly.</p>
    </section>
  `;

  // Attach handlers

  content.querySelectorAll('.btn-approve').forEach(btn => {
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        await api('/api/admin/requests/approve', { method: 'POST', body: JSON.stringify({ request_id: btn.dataset.id }) });
        await usersPage();
      } catch (e) { alert(e.message); }
    };
  });

  content.querySelectorAll('.btn-reject').forEach(btn => {
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        await api('/api/admin/requests/reject', { method: 'POST', body: JSON.stringify({ request_id: btn.dataset.id }) });
        await usersPage();
      } catch (e) { alert(e.message); }
    };
  });

  content.querySelectorAll('.btn-revoke-dev').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Are you sure you want to revoke access for this device? Only this specific device will be blocked.')) return;
      try {
        await api('/api/admin/devices/revoke', { method: 'POST', body: JSON.stringify({ device_id: btn.dataset.id }) });
        await usersPage();
      } catch (e) { alert(e.message); }
    };
  });

  content.querySelectorAll('.btn-toggle-dev').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api('/api/admin/devices/status', { method: 'POST', body: JSON.stringify({ device_id: btn.dataset.id, status: btn.dataset.status }) });
        await usersPage();
      } catch (e) { alert(e.message); }
    };
  });

  content.querySelectorAll('.btn-toggle-user').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api('/api/admin/users/status', { method: 'POST', body: JSON.stringify({ user_id: btn.dataset.user, status: btn.dataset.status }) });
        await usersPage();
      } catch (e) { alert(e.message); }
    };
  });

  content.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
    btn.onclick = () => {
      const uid = btn.dataset.uid;
      const span = content.querySelector(`.pwd-display[data-uid="${uid}"]`);
      if (!span) return;
      if (span.textContent === '••••••••') {
        span.textContent = btn.dataset.pwd || '(Not saved)';
        span.style.color = '#0A1F44';
        span.style.fontWeight = '700';
        btn.textContent = '🙈 Hide';
      } else {
        span.textContent = '••••••••';
        span.style.color = '';
        span.style.fontWeight = '';
        btn.textContent = '👁 View';
      }
    };
  });

  content.querySelectorAll('.btn-change-pwd').forEach(btn => {
    btn.onclick = () => {
      const uid = btn.dataset.uid;
      showChangePasswordModal(uid, async (newPwd) => {
        try {
          const res = await api('/api/admin/users/password', {
            method: 'POST',
            body: JSON.stringify({ user_id: uid, password: newPwd })
          });
          await usersPage();
          const alertBox = document.getElementById('users-alert');
          if (alertBox) {
            alertBox.innerHTML = message(`✓ ${res.message || 'Password updated successfully.'}`);
          }
        } catch (err) {
          alert(err.message);
        }
      });
    };
  });
}

function showChangePasswordModal(userId, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.innerHTML = `
    <div class="custom-modal-card" style="max-width:440px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:17px;font-weight:700;color:#0A1F44;">Change Password</h3>
        <button class="modal-close" style="background:none;border:none;font-size:22px;color:#64748b;cursor:pointer;">×</button>
      </div>
      <p class="muted" style="margin-bottom:16px;font-size:13px;">Set a new password for account <b>${escapeHtml(userId)}</b>. As Host, you can view and update this credentials anytime.</p>
      
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#334155;">New Password (min. 6 chars) *</label>
        <div style="display:flex;gap:6px;">
          <input id="modal-new-pwd" type="password" placeholder="Enter new password" style="flex:1;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
          <button type="button" id="toggle-new-pwd" class="secondary" style="padding:0 10px;font-size:12px;">👁</button>
        </div>
      </div>
      
      <div style="margin-bottom:18px;">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#334155;">Confirm New Password *</label>
        <input id="modal-confirm-pwd" type="password" placeholder="Repeat new password" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
      </div>
      
      <div id="modal-pwd-err" style="color:#ef4444;font-size:12px;margin-bottom:12px;"></div>
      
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="secondary" id="modal-pwd-cancel" style="padding:7px 16px;">Cancel</button>
        <button type="button" class="primary" id="modal-pwd-save" style="padding:7px 18px;">Update Password</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('#modal-pwd-cancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };

  const toggleBtn = overlay.querySelector('#toggle-new-pwd');
  const pwdInput = overlay.querySelector('#modal-new-pwd');
  toggleBtn.onclick = () => {
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      toggleBtn.textContent = '🙈';
    } else {
      pwdInput.type = 'password';
      toggleBtn.textContent = '👁';
    }
  };

  overlay.querySelector('#modal-pwd-save').onclick = async () => {
    const errBox = overlay.querySelector('#modal-pwd-err');
    errBox.textContent = '';
    const newPwd = pwdInput.value.trim();
    const confPwd = overlay.querySelector('#modal-confirm-pwd').value.trim();
    if (!newPwd) {
      errBox.textContent = 'Please enter a new password.';
      return;
    }
    if (newPwd.length < 6) {
      errBox.textContent = 'Password must be at least 6 characters.';
      return;
    }
    if (newPwd !== confPwd) {
      errBox.textContent = 'Passwords do not match.';
      return;
    }
    close();
    if (onSave) onSave(newPwd);
  };
}

const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

/* ==========================================================================
   Dashboard Implementation
   ========================================================================== */

async function dashboard() {
  content.innerHTML = `
    <!-- Prominent Global Search Bar -->
    <label class="field" style="margin-bottom:16px;">
      <svg class="i" aria-hidden="true"><use href="#search"/></svg>
      <input type="text" id="dash-global-search" class="dash-search-input" placeholder="Search client, file number, folder, or file..." autocomplete="off" aria-label="Search client, file number, folder or file">
    </label>
    <div id="dash-search-results" class="dash-search-results" style="display:none;"></div>

    <!-- Quick Stats Grid -->
    <div class="grid5" id="dash-stats-grid">
      <div class="glass stat" id="card-stat-clients" style="cursor:pointer;" title="Click to view Clients">
        <span>Clients</span>
        <b id="stat-total-clients">${clients.length || '0'}</b>
      </div>
      <div class="glass stat" id="card-stat-folders" style="cursor:pointer;" title="Click to view Folders">
        <span>Folders</span>
        <b id="stat-total-folders">...</b>
      </div>
      <div class="glass stat" id="card-stat-files" style="cursor:pointer;" title="Click to view Saved Files">
        <span>Files</span>
        <b id="stat-total-files">...</b>
      </div>
      <div class="glass stat" id="card-stat-cloud" style="cursor:pointer;" title="Click to view Drive Sharing">
        <span>Cloud files</span>
        <b id="stat-cloud-files">...</b>
      </div>
      <div class="glass stat" id="card-stat-issues" style="cursor:pointer;" title="Click to review Attention Items">
        <span>Needs attention</span>
        <b id="stat-pending-issues">0</b>
      </div>
    </div>

    <!-- Quick Actions Row -->
    <div class="row" style="margin-top:16px;">
      <button class="btn p" id="dash-quick-add-client"><svg class="i" aria-hidden="true"><use href="#plus"/></svg>Add client</button>
      <button class="btn" id="dash-quick-save-file"><svg class="i" aria-hidden="true"><use href="#upload"/></svg>Save file</button>
      <button class="btn" id="qa-open-explorer"><svg class="i" aria-hidden="true"><use href="#folder"/></svg>Open explorer</button>
      <button class="btn" id="qa-reconcile"><svg class="i" aria-hidden="true"><use href="#refresh"/></svg>Reconcile folders</button>
      <button class="btn" id="qa-backup"><svg class="i" aria-hidden="true"><use href="#backup"/></svg>Backup</button>
      <button class="btn" id="qa-import-clients" style="display:none;"></button>
      <button class="btn" id="qa-pdf-security" style="display:none;"></button>
      <button class="btn" id="qa-add-client" style="display:none;"></button>
      <button class="btn" id="qa-save-file" style="display:none;"></button>
    </div>

    <!-- Attention Container -->
    <div id="dash-attention-container" style="display:none;margin-top:16px;"></div>

    <!-- Two-Column Layout: Recent Activity & Storage Overview -->
    <div class="two" style="margin-top:16px;">
      <!-- Column 1: Recent Activity -->
      <section class="glass card" style="display:flex;flex-direction:column;">
        <div class="row" style="margin-bottom:12px;">
          <h2 style="margin:0;"><svg class="i" aria-hidden="true"><use href="#activity"/></svg>Recent activity</h2>
          <span class="sp"></span>
          <button class="btn" id="dash-view-all-activity" style="min-height:32px;padding:0 12px;font-size:12px;">View all <svg class="i" style="width:14px;height:14px;"><use href="#send"/></svg></button>
        </div>
        <ul class="list" id="dash-recent-activity-list" style="flex:1;">
          <li><span class="muted">Loading recent activities...</span></li>
        </ul>
      </section>

      <!-- Column 2: Storage -->
      <section class="glass card">
        <div class="row" style="margin-bottom:14px;">
          <h2 style="margin:0;"><svg class="i" aria-hidden="true"><use href="#folder"/></svg>Storage</h2>
          <span class="sp"></span>
          <span id="dash-drive-badge" class="chip" style="font-size:11px;">Checking Drive...</span>
        </div>

        <!-- Local Disk -->
        <div class="row">
          <b>Local disk</b>
          <span class="sp"></span>
          <span id="dash-local-percent-badge" class="chip w">0% used</span>
        </div>
        <div class="bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
          <i id="dash-local-progress-bar" style="width: 0%;"></i>
        </div>
        <p class="muted" style="font-size:12.5px;margin-bottom:16px;line-height:1.5;">
          <span id="dash-local-free-text">...</span> free of <span id="dash-local-usage-text">Calculating...</span>. Backups share this disk. <a href="#backup" id="dash-open-backup-tab" style="color:var(--pc);font-weight:600;text-decoration:none;">Move backups to Drive</a>
          <span style="display:block;margin-top:4px;font-size:11.5px;">Path: <code id="dash-local-path-text">${escapeHtml(settings.local_root || 'D:\\Code Trial')}</code> &middot; Managed: <strong id="dash-local-managed-text" style="color:var(--pc);">0 B</strong></span>
        </p>

        <!-- Google Drive Cloud Storage -->
        <div class="row" style="margin-top:16px;">
          <b>Google Drive</b>
          <span class="sp"></span>
          <span id="dash-drive-cloud-status" class="chip">Connected</span>
        </div>
        <div class="bar" role="progressbar">
          <i id="dash-drive-progress-bar" style="width: 0%; background: #10b981;"></i>
        </div>
        <div id="dash-drive-storage-body">
          <p class="muted" style="font-size:12.5px;line-height:1.5;">
            <span id="dash-drive-free-text">...</span> free of <span id="dash-drive-usage-text">Connecting...</span> quota.
            <span style="display:block;margin-top:4px;font-size:11.5px;">Account: <strong id="dash-drive-account-text">...</strong> &middot; Status: <span id="dash-drive-folder-text">Synced</span> &middot; <a href="#drive" id="dash-open-drive-tab" style="color:var(--pc);font-weight:600;text-decoration:none;">Manage Drive</a></span>
          </p>
        </div>
      </section>
    </div>
  `;

  attachDashboardEvents();
  loadDashboardData();
}


function attachDashboardEvents() {
  const navigateTo = (page) => {
    current = page;
    window.location.hash = page;
    nav();
  };

  document.querySelector('#dash-quick-add-client')?.addEventListener('click', () => {
    if (typeof showAddClientModal === 'function') showAddClientModal();
    else navigateTo('clients');
  });

  document.querySelector('#dash-quick-save-file')?.addEventListener('click', () => navigateTo('save'));
  document.querySelector('#card-stat-clients')?.addEventListener('click', () => navigateTo('clients'));
  document.querySelector('#card-stat-folders')?.addEventListener('click', () => navigateTo('folders'));
  document.querySelector('#card-stat-files')?.addEventListener('click', () => navigateTo('save'));
  document.querySelector('#card-stat-cloud')?.addEventListener('click', () => navigateTo('drive'));
  document.querySelector('#card-stat-issues')?.addEventListener('click', () => navigateTo('activity'));

  document.querySelector('#qa-add-client')?.addEventListener('click', () => {
    if (typeof showAddClientModal === 'function') showAddClientModal();
    else navigateTo('clients');
  });
  document.querySelector('#qa-import-clients')?.addEventListener('click', () => {
    if (typeof showImportModal === 'function') showImportModal();
    else navigateTo('clients');
  });
  document.querySelector('#qa-open-explorer')?.addEventListener('click', () => navigateTo('folders'));
  document.querySelector('#qa-save-file')?.addEventListener('click', () => navigateTo('save'));
  document.querySelector('#qa-pdf-security')?.addEventListener('click', () => {
    if (typeof showPdfSecurityModal === 'function') showPdfSecurityModal();
    else navigateTo('folders');
  });
  document.querySelector('#qa-reconcile')?.addEventListener('click', async () => {
    try {
      const pb = showGlassProgressBar({ title: 'Reconciling Filesystem', subtitle: 'Scanning local and cloud files for all clients...' });
      pb.simulate(1200);
      const res = await api('/api/folders/reconcile', { method: 'POST', body: '{}' });
      await pb.finish('Filesystem Reconciled');
      alert(`Scanned all clients: Found ${res.total_folders || 0} folders and ${res.total_files || 0} files.`);
      loadDashboardData();
    } catch (err) {
      alert(`Reconciliation error: ${err.message}`);
    }
  });
  document.querySelector('#qa-backup')?.addEventListener('click', () => navigateTo('backup'));
  document.querySelector('#dash-view-all-activity')?.addEventListener('click', () => navigateTo('activity'));
  document.querySelector('#dash-open-drive-tab')?.addEventListener('click', () => navigateTo('drive'));
  document.querySelector('#dash-open-backup-tab')?.addEventListener('click', () => navigateTo('backup'));

  // Prominent Global Live Search
  const searchInput = document.querySelector('#dash-global-search');
  const searchResults = document.querySelector('#dash-search-results');
  let searchTimer = null;

  if (searchInput && searchResults) {
    searchInput.oninput = () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (!q) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const res = await api(`/api/global-search?q=${encodeURIComponent(q)}`);
          renderGlobalSearchResults(res, q, searchResults);
        } catch (err) {
          searchResults.innerHTML = `<div style="padding:10px;color:red;font-size:12px;">Search failed: ${escapeHtml(err.message)}</div>`;
          searchResults.style.display = 'block';
        }
      }, 200);
    };

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });
  }
}

function renderGlobalSearchResults(res, query, container) {
  const esc = escapeHtml;
  let html = '';
  const clientsList = res.clients || [];
  const foldersList = res.folders || [];
  const filesList = res.files || [];

  if (!clientsList.length && !foldersList.length && !filesList.length) {
    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--muted);font-size:13px;">No matching clients, folders, or files found for "${esc(query)}".</div>`;
    container.style.display = 'block';
    return;
  }

  if (clientsList.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--muted);padding:6px 10px;text-transform:uppercase;">👥 Clients (${clientsList.length})</div>`;
    html += clientsList.map(c => `
      <div class="dash-search-item" data-type="client" data-fno="${esc(c.file_no)}">
        <div>
          <strong>${esc(c.name)}</strong>
          <span class="file-meta-badge" style="margin-left:6px;font-size:10px;">${esc(c.file_no)}</span>
          ${c.client_type ? `<span class="summary-badge" style="margin-left:4px;font-size:10px;">${esc(c.client_type)}</span>` : ''}
        </div>
        <button class="primary btn-sm" style="font-size:11px;padding:3px 8px;">View Client</button>
      </div>
    `).join('');
  }

  if (foldersList.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--muted);padding:6px 10px;text-transform:uppercase;margin-top:6px;">📁 Folders (${foldersList.length})</div>`;
    html += foldersList.map(f => `
      <div class="dash-search-item" data-type="folder" data-fno="${esc(f.client_file_no)}" data-path="${esc(f.relative_path)}">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;">
          <span>📁 ${esc(f.relative_path)}</span>
          <span class="muted" style="font-size:10px;margin-left:6px;">Client: ${esc(f.client_file_no)}</span>
        </div>
        <span class="file-meta-badge" style="font-size:10px;">${esc(f.storage_kind)}</span>
      </div>
    `).join('');
  }

  if (filesList.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--muted);padding:6px 10px;text-transform:uppercase;margin-top:6px;">📄 Files (${filesList.length})</div>`;
    html += filesList.map(doc => `
      <div class="dash-search-item" data-type="file" data-fno="${esc(doc.client_file_no)}" data-path="${esc(doc.relative_path)}">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;">
          <span>📄 ${esc(doc.relative_path)}</span>
          <span class="muted" style="font-size:10px;margin-left:6px;">${doc.size_bytes ? formatBytes(doc.size_bytes) : ''}</span>
        </div>
        <span class="file-meta-badge" style="font-size:10px;">${esc(doc.storage_kind)}</span>
      </div>
    `).join('');
  }

  container.innerHTML = html;
  container.style.display = 'block';

  container.querySelectorAll('.dash-search-item').forEach(el => {
    el.onclick = () => {
      const type = el.dataset.type;
      const fno = el.dataset.fno;
      if (type === 'client') {
        current = 'clients';
        window.location.hash = 'clients';
        nav();
      } else if (type === 'folder' || type === 'file') {
        current = 'folders';
        window.location.hash = 'folders';
        nav();
      }
    };
  });
}

async function loadDashboardData() {
  // 1. Instant Parallel Fetch: Stats, Activity, Storage
  loadDashboardStats().catch(() => {});
  loadDashboardActivity().catch(() => {});
  loadDashboardLocalStorage().catch(() => {});
  loadDashboardCloudStorage().catch(() => {});
}

async function loadDashboardStats() {
  try {
    const data = await api('/api/dashboard/stats');
    const stats = data.stats || {};
    
    const cEl = document.querySelector('#stat-total-clients');
    const fEl = document.querySelector('#stat-total-folders');
    const docEl = document.querySelector('#stat-total-files');
    const cldEl = document.querySelector('#stat-cloud-files');
    const issEl = document.querySelector('#stat-pending-issues');

    if (cEl) cEl.textContent = stats.total_clients || '0';
    if (fEl) fEl.textContent = stats.total_folders || '0';
    if (docEl) docEl.textContent = stats.total_files || '0';
    if (cldEl) cldEl.textContent = stats.cloud_files || '0';
    if (issEl) issEl.textContent = stats.pending_issues || '0';

    const attentionContainer = document.querySelector('#dash-attention-container');
    if (attentionContainer) {
      const items = data.pending_items || [];
      if (items.length) {
        attentionContainer.innerHTML = `
          <h3 style="font-size:13px;font-weight:700;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px;color:#b91c1c;">⚠️ Attention Required</h3>
          ${items.map(item => `
            <div class="dash-attention-card ${item.severity || 'warning'}">
              <div>
                <strong>${escapeHtml(item.title)}</strong> — <span style="font-weight:normal;">${escapeHtml(item.desc)}</span>
              </div>
            </div>
          `).join('')}
        `;
      } else {
        attentionContainer.innerHTML = '';
      }
    }
  } catch (err) {
    console.warn('Dashboard stats load error:', err);
  }
}

async function loadDashboardLocalStorage() {
  try {
    const data = await api('/api/dashboard/storage');
    const localInfo = data.local;
    if (!localInfo) return;

    const pUsed = Number(localInfo.percent_used || 0);
    const barEl = document.querySelector('#dash-local-progress-bar');
    const pBadge = document.querySelector('#dash-local-percent-badge');
    const uText = document.querySelector('#dash-local-usage-text');
    const fText = document.querySelector('#dash-local-free-text');
    const mText = document.querySelector('#dash-local-managed-text');
    const pathText = document.querySelector('#dash-local-path-text');

    if (barEl) {
      barEl.style.width = `${Math.min(pUsed, 100)}%`;
      barEl.className = 'storage-progress-bar ' + (pUsed > 90 ? 'danger' : pUsed > 75 ? 'warning' : 'local');
    }
    if (pBadge) {
      pBadge.textContent = `${pUsed}% Used`;
      pBadge.className = 'summary-badge ' + (pUsed > 90 ? 'conflict' : pUsed > 75 ? 'conflict' : 'ok');
    }
    if (uText) uText.textContent = `${formatBytes(localInfo.used_bytes)} / ${formatBytes(localInfo.total_bytes)} (${pUsed}%)`;
    if (fText) fText.textContent = `${formatBytes(localInfo.free_bytes)} Free`;
    if (mText) mText.textContent = formatBytes(localInfo.managed_bytes || 0);
    if (pathText) pathText.textContent = localInfo.display_path || settings.local_root || 'D:\\Code Trial';
  } catch (err) {
    console.warn('Local storage stats load error:', err);
  }
}

async function loadDashboardCloudStorage() {
  const driveBadge = document.querySelector('#dash-drive-badge');
  const driveBody = document.querySelector('#dash-drive-storage-body');
  const driveStatusBadge = document.querySelector('#dash-drive-cloud-status');

  try {
    const driveInfo = await api('/api/dashboard/cloud');
    
    if (driveInfo && driveInfo.connected) {
      if (driveBadge) {
        driveBadge.className = 'summary-badge ok';
        driveBadge.textContent = '☁️ Connected';
      }
      if (driveStatusBadge) {
        driveStatusBadge.className = 'summary-badge ok';
        driveStatusBadge.textContent = '✓ Connected';
      }
      if (driveBody) {
        const dPercent = Number(driveInfo.percent_used || 0);
        const dBar = document.querySelector('#dash-drive-progress-bar');
        const dUsageText = document.querySelector('#dash-drive-usage-text');
        const dFreeText = document.querySelector('#dash-drive-free-text');
        const dAccText = document.querySelector('#dash-drive-account-text');
        
        if (dBar) {
          dBar.style.width = `${Math.min(dPercent, 100)}%`;
          dBar.className = 'storage-progress-bar ' + (dPercent > 90 ? 'danger' : dPercent > 75 ? 'warning' : 'drive');
        }
        if (dUsageText) {
          if (driveInfo.limit_bytes) {
            dUsageText.textContent = `${formatBytes(driveInfo.usage_bytes)} / ${formatBytes(driveInfo.limit_bytes)} (${dPercent}%)`;
          } else {
            dUsageText.textContent = `${formatBytes(driveInfo.usage_bytes)} Used (Unlimited)`;
          }
        }
        if (dFreeText) {
          if (driveInfo.limit_bytes) {
            const freeBytes = Math.max(0, driveInfo.limit_bytes - driveInfo.usage_bytes);
            dFreeText.textContent = `${formatBytes(freeBytes)} Free`;
          } else {
            dFreeText.textContent = `Unlimited`;
          }
        }
        if (dAccText) {
          dAccText.textContent = driveInfo.user_email || driveInfo.user_name || 'Active Firm Account';
        }
      }
    } else {
      if (driveBadge) {
        driveBadge.className = 'summary-badge conflict';
        driveBadge.textContent = '⚠️ Not Connected';
      }
      if (driveStatusBadge) {
        driveStatusBadge.className = 'summary-badge conflict';
        driveStatusBadge.textContent = '⚠️ Not Connected';
      }
      if (driveBody) {
        driveBody.innerHTML = `
          <div style="padding:8px 0;text-align:center;">
            <p class="muted" style="margin:0 0 10px;font-size:12px;">Google Drive is not linked yet. Connect to track cloud quota & client portals.</p>
            <button class="secondary btn-sm" id="dash-connect-drive-quick" style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:6px 14px;cursor:pointer;">
              <img src="google-drive.ico" style="width:14px;height:14px;object-fit:contain;">
              <span>Connect Google Drive</span>
            </button>
          </div>
        `;
        document.querySelector('#dash-connect-drive-quick')?.addEventListener('click', () => {
          current = 'drive';
          window.location.hash = 'drive';
          nav();
        });
      }
    }
  } catch (err) {
    if (driveBadge) {
      driveBadge.className = 'summary-badge conflict';
      driveBadge.textContent = '⚠️ Cloud Offline';
    }
    if (driveStatusBadge) {
      driveStatusBadge.className = 'summary-badge conflict';
      driveStatusBadge.textContent = '⚠️ Offline';
    }
  }
}

async function loadDashboardActivity() {
  try {
    const data = await api('/api/dashboard/activity');
    const activityListEl = document.querySelector('#dash-recent-activity-list');
    if (!activityListEl) return;

    const formatActionName = (action) => {
      const map = {
        'client_created': '👤 Client Added',
        'client_updated': '✏️ Client Updated',
        'client_deleted': '🗑️ Client Deleted',
        'file_saved': '💾 File Saved',
        'backup_created': '🛡️ Manual Backup',
        'automatic_backup_created': '🛡️ Automatic Backup',
        'backup_restored': '🔄 System Restored',
        'backup_deleted': '🗑️ Backup Deleted',
        'portal_blocked': '🔒 Portal Blocked',
        'portal_unblocked': '🔓 Portal Restored',
        'login': '🔑 User Sign In',
        'logout': '🚪 User Sign Out',
        'password_changed': '🔑 Password Changed',
        'device_approved': '💻 Device Authorized'
      };
      if (map[action]) return map[action];
      return (action || 'Activity').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    const acts = data.activities || [];
    if (!acts.length) {
      activityListEl.innerHTML = `<li><span class="muted" style="font-size:12px;">No activity recorded yet.</span></li>`;
    } else {
      activityListEl.innerHTML = acts.map(a => `
        <li>
          <span>
            <strong>${escapeHtml(formatActionName(a.action || a.event_type))}</strong>${a.details || a.detail ? `: ${escapeHtml(a.details || a.detail)}` : ''}
            ${a.client_file_no ? `<br><small class="muted">Client ${escapeHtml(a.client_file_no)}</small>` : ''}
          </span>
          <small class="muted">${a.created_at ? new Date(a.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</small>
        </li>
      `).join('');
    }

  } catch (err) {
    console.warn('Recent activity load error:', err);
  }
}


/* ==========================================================================
   Backup & Restore Page UI
   ========================================================================== */

async function backupPage() {
  try {
    settings = await api('/api/settings');
  } catch (_) {}

  const backupDir = settings.backup_dir || 'D:\\AntiGravity Automation\\VS_Desktop_App Old\\data\\backups';

  content.innerHTML = `
    <!-- Top Banner -->
    <div class="banner">
      <svg class="i"><use href="#backup"/></svg>
      <span>Last backup <span id="last-backup-display">${escapeHtml(settings.last_backup_time ? new Date(settings.last_backup_time).toLocaleString() : 'None Recorded')}</span> &middot; verified (SHA-256)</span>
      <span style="flex:1"></span>
      <button class="btn p" id="btn-create-backup"><svg class="i"><use href="#plus"/></svg>Create backup</button>
      <button class="btn" id="btn-restore-file"><svg class="i"><use href="#refresh"/></svg>Restore from file</button>
      <input type="file" id="backup-file-input" accept=".vsbackup" style="display:none;">
    </div>

    <!-- Schedule & Retention Glass Card -->
    <section class="glass card">
      <h2><svg class="i"><use href="#setup"/></svg>Schedule and retention</h2>
      <div class="row">
        <select class="btn" id="backup-freq-select" aria-label="Schedule">
          <option value="Daily" ${settings.backup_frequency === 'Daily' ? 'selected' : ''}>Daily (recommended)</option>
          <option value="Weekly" ${settings.backup_frequency === 'Weekly' ? 'selected' : ''}>Weekly</option>
          <option value="Monthly" ${settings.backup_frequency === 'Monthly' ? 'selected' : ''}>Monthly</option>
          <option value="Disabled" ${settings.backup_frequency === 'Disabled' ? 'selected' : ''}>Disabled</option>
        </select>
        <label class="muted" style="display:flex;align-items:center;gap:6px;">Keep last <input class="field" id="backup-retention-count" style="width:70px;min-height:38px;padding:0 8px;text-align:center;" value="${escapeHtml(settings.backup_retention_count || '10')}"> backups</label>
        <label class="muted" style="display:flex;align-items:center;gap:6px;">for <input class="field" id="backup-retention-days" style="width:70px;min-height:38px;padding:0 8px;text-align:center;" value="${escapeHtml(settings.backup_retention_days || '60')}"> days</label>
        <span class="sp"></span>
        <button class="btn" id="btn-save-backup-settings">Save schedule</button>
        <button class="btn secondary" id="btn-open-backup-dir"><svg class="i"><use href="#folder"/></svg>Open folder</button>
      </div>
      <div id="backup-settings-result" style="margin-top:10px;"></div>
      <p class="chip w" style="margin-top:14px;"><svg class="i"><use href="#alert"/></svg>Backups are stored on the same disk as your data. Add a Drive copy.</p>
    </section>

    <!-- Backup History Glass Card -->
    <section class="glass card">
      <div class="row" style="margin-bottom:14px;">
        <h2><svg class="i"><use href="#backup"/></svg>Backup history <span class="muted" id="backup-count-badge" style="font-size:12.5px;font-weight:normal;margin-left:8px;">...</span></h2>
        <span class="sp"></span>
        <button class="btn ib tip" id="btn-refresh-backups" data-t="Refresh" aria-label="Refresh backups"><svg class="i"><use href="#refresh"/></svg></button>
      </div>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>File</th>
              <th>Size</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody id="backup-history-tbody">
            <tr><td colspan="6" style="padding:20px;text-align:center;" class="muted">Loading backup history...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  attachBackupEvents();
  loadBackupHistory();
}

function attachBackupEvents() {
  document.querySelector('#btn-open-backup-dir')?.addEventListener('click', async () => {
    try {
      await api('/api/backup/open-folder', { method: 'POST', body: '{}' });
    } catch (err) {
      alert(`Could not open backups folder: ${err.message}`);
    }
  });

  document.querySelector('#btn-create-backup')?.addEventListener('click', async () => {
    const btn = document.querySelector('#btn-create-backup');
    try {
      btn.disabled = true;
      btn.textContent = 'Backing up...';
      const pb = showGlassProgressBar({ title: 'Creating System Backup', subtitle: 'Snapshotting SQLite database, clients, and configuration...' });
      pb.simulate(1000);
      const res = await api('/api/backup/create', { method: 'POST', body: JSON.stringify({ type: 'manual' }) });
      await pb.finish('Backup Verified & Saved');
      settings.last_backup_time = res.manifest?.created_at || new Date().toISOString();
      settings.last_backup_status = 'Verified';
      const lastBkpDisp = document.querySelector('#last-backup-display');
      if (lastBkpDisp) lastBkpDisp.textContent = new Date(settings.last_backup_time).toLocaleString();
      await loadBackupHistory();
    } catch (err) {
      alert(`Backup failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg class="i"><use href="#plus"/></svg>Create backup`;
    }
  });

  const fileInput = document.querySelector('#backup-file-input');
  document.querySelector('#btn-restore-file')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm(`WARNING: Restoring will replace the current live database and application state with the contents of "${file.name}".\n\nAn automatic emergency backup will be taken before restoring.\n\nDo you want to proceed?`)) {
      fileInput.value = '';
      return;
    }

    try {
      const pb = showGlassProgressBar({ title: 'Restoring System State', subtitle: `Reading "${file.name}" and preparing atomic rollback snapshot...` });
      pb.simulate(1500);
      const b64 = await fileToBase64(file);
      await api('/api/backup/upload-restore', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, file_base64: b64 })
      });
      await pb.finish('Restore Completed Successfully');
      alert('System state restored successfully! The page will now reload.');
      window.location.reload();
    } catch (err) {
      alert(`Restoration failed: ${err.message}`);
    } finally {
      fileInput.value = '';
    }
  });

  document.querySelector('#btn-save-backup-settings')?.addEventListener('click', async () => {
    const freq = document.querySelector('#backup-freq-select').value;
    const retCount = document.querySelector('#backup-retention-count').value;
    const retDays = document.querySelector('#backup-retention-days').value;
    const resDiv = document.querySelector('#backup-settings-result');
    try {
      const updated = await api('/api/backup/settings', {
        method: 'POST',
        body: JSON.stringify({
          backup_frequency: freq,
          backup_retention_count: retCount,
          backup_retention_days: retDays
        })
      });
      settings = updated;
      resDiv.innerHTML = message('Backup schedule and retention settings saved successfully!');
    } catch (err) {
      resDiv.innerHTML = message(err.message, true);
    }
  });

  document.querySelector('#btn-refresh-backups')?.addEventListener('click', loadBackupHistory);
}

async function loadBackupHistory() {
  const tbody = document.querySelector('#backup-history-tbody');
  const countBadge = document.querySelector('#backup-count-badge');
  if (!tbody) return;
  try {
    const list = await api('/api/backups');
    if (countBadge) {
      const totalBytes = (list || []).reduce((acc, b) => acc + (b.size_bytes || 0), 0);
      countBadge.textContent = `${list.length} archive(s) · ${formatBytes(totalBytes)}`;
    }
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;" class="muted">No backups found. Click <strong>"Create backup"</strong> to generate your first verified system snapshot.</td></tr>`;
      return;
    }
    const esc = escapeHtml;
    tbody.innerHTML = list.map(b => {
      const dateStr = b.created_at || b.modified_at;
      let displayDate = esc(dateStr);
      try {
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            displayDate = d.toLocaleString();
          }
        }
      } catch (_) {}

      const isEmergency = (b.backup_type || '').toLowerCase().includes('pre-restore') || (b.filename || '').includes('emergency');
      const typeLabel = isEmergency ? 'Emergency' : (b.backup_type ? (b.backup_type.charAt(0).toUpperCase() + b.backup_type.slice(1)) : 'Manual');
      const isUnusuallySmall = (b.size_bytes || 0) < 50000;

      return `
        <tr>
          <td style="font-weight:600;">${displayDate}</td>
          <td><span class="chip ${isEmergency ? 'w' : ''}">${esc(typeLabel)}</span></td>
          <td><code>${esc(b.filename)}</code></td>
          <td>${formatBytes(b.size_bytes || 0)}${isUnusuallySmall ? ' <span class="chip w">Unusually small</span>' : ''}</td>
          <td>
            ${b.status === 'Verified' 
              ? `<span class="chip">Verified</span>` 
              : `<span class="chip w">${esc(b.status)}</span>`}
          </td>
          <td>
            <div class="acts">
              <button class="btn btn-sm btn-restore-item" data-file="${esc(b.filename)}">Restore</button>
              <a href="/api/backup/download/${encodeURIComponent(b.filename)}" download class="btn ib tip" data-t="Download" aria-label="Download backup"><svg class="i"><use href="#dl"/></svg></a>
              <button class="btn ib d tip btn-delete-item" data-file="${esc(b.filename)}" data-t="Delete" aria-label="Delete backup"><svg class="i"><use href="#trash"/></svg></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-restore-item').forEach(btn => {
      btn.onclick = async () => {
        const fn = btn.dataset.file;
        if (!window.confirm(`WARNING: Restoring will replace the live database with backup "${fn}".\n\nAn automatic emergency backup will be taken before restoring.\n\nDo you want to proceed?`)) return;
        try {
          const pb = showGlassProgressBar({ title: 'Restoring System State', subtitle: `Restoring from "${fn}"...` });
          pb.simulate(1500);
          await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ filename: fn }) });
          await pb.finish('Restored Successfully');
          alert('System state restored successfully! The page will now reload.');
          window.location.reload();
        } catch (err) {
          alert(`Restore failed: ${err.message}`);
        }
      };
    });

    tbody.querySelectorAll('.btn-delete-item').forEach(btn => {
      btn.onclick = async () => {
        const fn = btn.dataset.file;
        if (!window.confirm(`Are you sure you want to delete backup file "${fn}"?`)) return;
        try {
          await api('/api/backup/delete', { method: 'POST', body: JSON.stringify({ filename: fn }) });
          await loadBackupHistory();
        } catch (err) {
          alert(`Delete failed: ${err.message}`);
        }
      };
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:red;">Failed to load backups: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function render() {
  if (current === 'vs-ai' || current === 'ai') {
    document.body.classList.add('page-vs-ai-active');
  } else {
    document.body.classList.remove('page-vs-ai-active');
  }
  if (current === 'dashboard') await dashboard();
  else if (current === 'setup') setup();
  else if (current === 'clients') clientsPage();
  else if (current === 'folders') folders();
  else if (current === 'drive') await drive();
  else if (current === 'save') save();
  else if (current === 'backup') await backupPage();
  else if (current === 'users') await usersPage();
  else if (current === 'pdf-studio' || current === 'studio') { if (typeof pdfStudioPage === 'function') await pdfStudioPage(); }
  else if (current === 'vs-ai' || current === 'ai') {
    if (typeof renderVsAi === 'function') await renderVsAi();
    else if (typeof render_page_vs_ai === 'function') await render_page_vs_ai();
  }
  else await activity();
}

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  current = b.dataset.page;
  window.location.hash = current;
  nav();
});

function applyHashRoute() {
  const rawHash = (window.location.hash || '').replace('#', '').trim();
  const hash = rawHash.split('?')[0];
  if (!hash || hash === current) return;
  if (hash === 'dashboard') {
    current = 'dashboard';
    nav();
  } else if (hash === 'save' || hash === 'save-files') {
    current = 'save';
    nav();
  } else if (hash === 'pdf-studio' || hash === 'studio') {
    current = 'pdf-studio';
    nav();
  } else if (hash === 'vs-ai' || hash === 'ai') {
    current = 'vs-ai';
    nav();
  } else if (hash === 'clients') {
    current = 'clients';
    nav();
  } else if (hash === 'folders') {
    current = 'folders';
    nav();
  } else if (hash === 'drive') {
    current = 'drive';
    nav();
  } else if (hash === 'backup') {
    current = 'backup';
    nav();
  } else if (hash === 'setup') {
    current = 'setup';
    nav();
  } else if (hash === 'activity') {
    current = 'activity';
    nav();
  }
}

window.addEventListener('hashchange', applyHashRoute);

// Extension communication handoff bridge
window.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'VS_GET_EXTENSION_PAIRING_CODE') {
    try {
      const res = await api('/api/auth/extension-code', { method: 'POST', body: '{}' });
      window.postMessage({ type: 'VS_EXTENSION_PAIRING_CODE_RESPONSE', ok: true, code: res.code, user_id: res.user_id, device_id: res.device_id }, '*');
    } catch (err) {
      window.postMessage({ type: 'VS_EXTENSION_PAIRING_CODE_RESPONSE', ok: false, error: err.message }, '*');
    }
  }
});

// Pre-route check: if launched via extension or directly targeting Save
(function preRouteCheck() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('from_extension') === '1' || urlParams.get('skip_animation') === '1' || window.location.hash === '#save' || window.location.hash === '#save-files') {
    current = 'save';
    if (typeof dismissStartupAnimationImmediately === 'function') {
      dismissStartupAnimationImmediately();
    }
  }
})();

load().then(() => {
  if (window.location.hash) {
    applyHashRoute();
  }
});

// Fast periodic staging poller: detects incoming files from Chrome Extension
let isPollingStaging = false;
async function pollIncomingStaging() {
  if (isPollingStaging || incomingDrainInProgress) return;
  try {
    isPollingStaging = true;
    // 1. Check for remote navigation requests (e.g. from extension or secondary launcher)
    try {
      const navRes = await api('/api/desktop/navigate', { timeout: 1000 });
      if (navRes && navRes.ok && navRes.has_route && navRes.route) {
        const targetRoute = navRes.route.replace(/^#/, '').trim();
        if (targetRoute && targetRoute !== current) {
          window.location.hash = targetRoute;
          current = targetRoute;
          if (typeof nav === 'function') nav();
        }
      }
    } catch (_) {}

    // 2. Poll incoming staging files
    const stageRes = await api('/api/staging/incoming?drain=1', { timeout: 1500 });
    const hasFiles = stageRes && stageRes.ok && (
      (stageRes.count && stageRes.count > 0) ||
      (stageRes.staging && (
        (stageRes.staging.files && stageRes.staging.files.length > 0) ||
        (stageRes.staging.bulk && stageRes.staging.bulk.length > 0) ||
        (stageRes.staging.single && (stageRes.staging.single.filename || stageRes.staging.single.name)) ||
        stageRes.staging.is_redirected
      ))
    );
    if (hasFiles) {
      if (typeof window.processIncomingStaging === 'function') {
        await window.processIncomingStaging(stageRes.staging || stageRes);
      }
    }
  } catch (_) {
  } finally {
    isPollingStaging = false;
  }
}
setInterval(pollIncomingStaging, 800);
window.addEventListener('focus', pollIncomingStaging);


