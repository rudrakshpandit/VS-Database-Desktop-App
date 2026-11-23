/**
 * VS Database 2.0 — Tauri Compatibility Bridge (tauri-bridge.js)
 * 
 * Transparent dual-mode compatibility bridge between the web frontend and Tauri 2:
 * 1. Runtime Detection: Identifies whether the app is executing inside Tauri (Tauri 2 globals/internals or custom scheme).
 * 2. Window Controls: Exposes native minimize, maximize/restore, and close via Tauri IPC with pywebview/DOM fallbacks.
 * 3. Drag Regions: Implements hardware-accelerated frameless window dragging via data-tauri-drag-region.
 * 4. Native Dialogs: Provides open/save file & folder dialogs via @tauri-apps/plugin-dialog with fallback to HTML file inputs.
 * 5. API Base URL Resolution: Transparently routes API requests to http://127.0.0.1:8767 when running under custom schemes.
 * 6. Pywebview Polyfill: Maintains 100% backward compatibility for legacy pywebview desktop APIs.
 */

(function (global) {
  'use strict';

  // 1. Detection
  function isTauri() {
    if (typeof window === 'undefined') return false;
    if (typeof window.__TAURI_INTERNALS__ !== 'undefined') return true;
    if (typeof window.__TAURI__ !== 'undefined') return true;
    const loc = window.location || {};
    const proto = loc.protocol || '';
    const host = loc.hostname || '';
    return proto === 'tauri:' || host === 'tauri.localhost' || proto === 'asset:';
  }

  // 2. Base URL & Route Resolution (ADR-015 Host-Client Architecture)
  const DEFAULT_HOST_URL = 'http://127.0.0.1:8768';

  function getHostUrl() {
    if (typeof window === 'undefined') return DEFAULT_HOST_URL;
    try {
      if (window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const hostParam = params.get('host') || params.get('host_url');
        if (hostParam) return sanitizeHostUrl(hostParam);
      }
      const stored = localStorage.getItem('vs-host-url') || localStorage.getItem('vs_host_url');
      if (stored) return sanitizeHostUrl(stored);
    } catch (e) {
      console.warn('[TauriBridge] Failed to read stored host URL:', e);
    }
    return null;
  }

  function sanitizeHostUrl(url) {
    if (!url || typeof url !== 'string') return DEFAULT_HOST_URL;
    let clean = url.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    while (clean.endsWith('/')) {
      clean = clean.slice(0, -1);
    }
    return clean;
  }

  function setHostUrl(url) {
    if (typeof window === 'undefined') return DEFAULT_HOST_URL;
    const sanitized = sanitizeHostUrl(url);
    try {
      localStorage.setItem('vs-host-url', sanitized);
      window.dispatchEvent(new CustomEvent('vshosturlchanged', { detail: { hostUrl: sanitized } }));
    } catch (e) {
      console.warn('[TauriBridge] Failed to store host URL:', e);
    }
    return sanitized;
  }

  function resetHostUrl() {
    if (typeof window === 'undefined') return DEFAULT_HOST_URL;
    try {
      localStorage.removeItem('vs-host-url');
      localStorage.removeItem('vs_host_url');
      window.dispatchEvent(new CustomEvent('vshosturlchanged', { detail: { hostUrl: DEFAULT_HOST_URL } }));
    } catch (e) {
      console.warn('[TauriBridge] Failed to reset host URL:', e);
    }
    return DEFAULT_HOST_URL;
  }

  function getBaseUrl() {
    if (typeof window === 'undefined') return DEFAULT_HOST_URL;
    const configuredHost = getHostUrl();
    if (configuredHost) return configuredHost;

    const loc = window.location;
    const proto = loc.protocol;
    const host = loc.hostname;
    // When served from Tauri custom scheme or file protocol
    if (proto === 'tauri:' || host === 'tauri.localhost' || proto === 'asset:' || proto === 'file:' || (isTauri() && loc.port !== '8768' && loc.port !== '8767')) {
      return DEFAULT_HOST_URL;
    }
    return loc.origin || DEFAULT_HOST_URL;
  }

  function resolveApiUrl(path) {
    if (!path || typeof path !== 'string') return path;
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
      return path;
    }
    const base = getBaseUrl();
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return `${base}${cleanPath}`;
  }

  // 3. Tauri 2 IPC & Window Accessors
  function getTauriInvoke() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI__?.core?.invoke && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke;
    }
    if (window.__TAURI__?.invoke && typeof window.__TAURI__.invoke === 'function') {
      return window.__TAURI__.invoke;
    }
    if (window.__TAURI_INTERNALS__?.invoke && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke;
    }
    return null;
  }

  function getTauriWindow() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI__?.window?.getCurrentWindow && typeof window.__TAURI__.window.getCurrentWindow === 'function') {
      return window.__TAURI__.window.getCurrentWindow();
    }
    return null;
  }

  // 4. Window Operations
  async function minimizeWindow() {
    const win = getTauriWindow();
    if (win && typeof win.minimize === 'function') {
      try {
        await win.minimize();
        return { ok: true };
      } catch (e) {
        console.warn('[TauriBridge] Window minimize error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        const res = await inv('minimize_window');
        return res || { ok: true };
      } catch (_) {}
    }
    if (!isTauri() && window.pywebview?.api?.minimize_window && typeof window.pywebview.api.minimize_window === 'function') {
      return await window.pywebview.api.minimize_window();
    }
    return { ok: false };
  }

  async function toggleMaximize() {
    const win = getTauriWindow();
    if (win && typeof win.toggleMaximize === 'function') {
      try {
        await win.toggleMaximize();
        const isMax = typeof win.isMaximized === 'function' ? await win.isMaximized() : false;
        if (typeof window.onWindowMaximizedState === 'function') {
          window.onWindowMaximizedState(isMax);
        }
        return { ok: true, maximized: isMax };
      } catch (e) {
        console.warn('[TauriBridge] Window toggleMaximize error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        const res = await inv('maximize_window');
        if (res && typeof res.maximized === 'boolean' && typeof window.onWindowMaximizedState === 'function') {
          window.onWindowMaximizedState(res.maximized);
        }
        return res || { ok: true };
      } catch (_) {}
    }
    if (!isTauri() && window.pywebview?.api?.maximize_window && typeof window.pywebview.api.maximize_window === 'function') {
      return await window.pywebview.api.maximize_window();
    }
    const isMax = document.body.classList.toggle('window-maximized');
    if (typeof window.onWindowMaximizedState === 'function') {
      window.onWindowMaximizedState(isMax);
    }
    return { ok: true, maximized: isMax };
  }

  async function isMaximized() {
    const win = getTauriWindow();
    if (win && typeof win.isMaximized === 'function') {
      try {
        const isMax = await win.isMaximized();
        return { ok: true, maximized: Boolean(isMax) };
      } catch (e) {
        console.warn('[TauriBridge] Window isMaximized error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        const res = await inv('is_maximized');
        return { ok: true, maximized: Boolean(res) };
      } catch (_) {}
    }
    if (!isTauri() && window.pywebview?.api?.is_maximized && typeof window.pywebview.api.is_maximized === 'function') {
      return await window.pywebview.api.is_maximized();
    }
    return { ok: true, maximized: document.body.classList.contains('window-maximized') };
  }

  async function closeWindow() {
    if (typeof window.showExitConfirmModal === 'function') {
      window.showExitConfirmModal();
      return { ok: true };
    }
    return await confirmClose();
  }

  async function confirmClose() {
    const win = getTauriWindow();
    if (win && typeof win.close === 'function') {
      try {
        await win.close();
        return { ok: true };
      } catch (e) {
        console.warn('[TauriBridge] Window close error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        const res = await inv('confirm_close');
        return res || { ok: true };
      } catch (_) {
        try {
          const res = await inv('close_window');
          return res || { ok: true };
        } catch (_) {}
      }
    }
    if (!isTauri() && window.pywebview?.api?.confirm_close && typeof window.pywebview.api.confirm_close === 'function') {
      return await window.pywebview.api.confirm_close();
    }
    try {
      await fetch(resolveApiUrl('/api/desktop/close'), { method: 'POST' });
    } catch (_) {}
    try { window.close(); } catch (_) {}
    return { ok: true };
  }

  async function startDrag() {
    const win = getTauriWindow();
    if (win && typeof win.startDragging === 'function') {
      try {
        await win.startDragging();
        return { ok: true };
      } catch (e) {
        console.warn('[TauriBridge] Window startDragging error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        await inv('start_drag');
        return { ok: true };
      } catch (_) {}
    }
    if (!isTauri() && window.pywebview?.api?.start_drag && typeof window.pywebview.api.start_drag === 'function') {
      return await window.pywebview.api.start_drag();
    }
    return { ok: false };
  }

  // 5. Native Dialog Helpers
  async function openFileDialog(options = {}) {
    // Check @tauri-apps/plugin-dialog via window.__TAURI__.dialog
    const tauriDialog = window.__TAURI__?.dialog;
    if (tauriDialog && typeof tauriDialog.open === 'function') {
      try {
        const res = await tauriDialog.open(options);
        return res;
      } catch (e) {
        console.warn('[TauriBridge] tauri.dialog.open error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        return await inv('plugin:dialog|open', { options });
      } catch (_) {
        try {
          return await inv('open_file_dialog', { options });
        } catch (_) {}
      }
    }
    // Web DOM fallback with input[type=file]
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      if (options.multiple) input.multiple = true;
      if (options.directory) {
        input.webkitdirectory = true;
        input.directory = true;
      }
      if (options.filters && Array.isArray(options.filters)) {
        const exts = [];
        options.filters.forEach(f => {
          if (Array.isArray(f.extensions)) {
            exts.push(...f.extensions.map(e => e.startsWith('.') ? e : '.' + e));
          }
        });
        if (exts.length) input.accept = exts.join(',');
      }
      let settled = false;
      input.onchange = () => {
        if (settled) return;
        settled = true;
        const files = Array.from(input.files || []);
        if (input.parentNode) input.parentNode.removeChild(input);
        if (!files.length) {
          resolve(null);
          return;
        }
        resolve(options.multiple ? files : files[0]);
      };
      input.oncancel = () => {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(null);
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  async function saveFileDialog(options = {}) {
    const tauriDialog = window.__TAURI__?.dialog;
    if (tauriDialog && typeof tauriDialog.save === 'function') {
      try {
        return await tauriDialog.save(options);
      } catch (e) {
        console.warn('[TauriBridge] tauri.dialog.save error:', e);
      }
    }
    const inv = getTauriInvoke();
    if (inv) {
      try {
        return await inv('plugin:dialog|save', { options });
      } catch (_) {
        try {
          return await inv('save_file_dialog', { options });
        } catch (_) {}
      }
    }
    return null;
  }

  async function saveFileToLocation(sourceFilename, defaultName, artifactId) {
    const inv = getTauriInvoke();
    if (inv) {
      try {
        const res = await inv('save_file_to_location', {
          sourceFilename: sourceFilename || '',
          defaultName: defaultName || null,
          artifactId: artifactId ? String(artifactId) : null
        });
        if (res && (res.ok || res.cancelled)) return res;
      } catch (_) {}
    }
    if (window.pywebview?.api?.save_file_to_location && typeof window.pywebview.api.save_file_to_location === 'function') {
      try {
        return await window.pywebview.api.save_file_to_location(sourceFilename, defaultName, artifactId);
      } catch (_) {}
    }
    // Server native save dialog fallback
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/native-save-dialog'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_id: artifactId || '',
          source_filename: sourceFilename || '',
          default_name: defaultName || ''
        })
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async function openLocalFolder(folderPath) {
    const inv = getTauriInvoke();
    if (inv) {
      try {
        return await inv('open_local_folder', { folderPath });
      } catch (_) {}
    }
    if (!isTauri() && window.pywebview?.api?.open_local_folder && typeof window.pywebview.api.open_local_folder === 'function') {
      return await window.pywebview.api.open_local_folder(folderPath);
    }
    try {
      const resp = await fetch(resolveApiUrl('/api/folder/open'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      return await resp.json();
    } catch (e) {
      return { error: String(e) };
    }
  }

  // 6. Setup data-tauri-drag-region on DOM
  function applyDragRegions() {
    if (typeof document === 'undefined') return;
    const selectors = [
      '#app-titlebar',
      '.app-titlebar',
      '.titlebar-drag-area',
      '.titlebar-brand',
      '.pywebview-drag-region'
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.hasAttribute('data-tauri-drag-region')) {
          el.setAttribute('data-tauri-drag-region', '');
        }
      });
    });
  }

  // 7. Transparent fetch monkey-patching for cross-origin Tauri requests & Handshake Token injection
  let cachedHandshakeToken = null;
  let handshakePromise = null;
  function initHandshakeToken() {
    const inv = getTauriInvoke();
    if (inv) {
      handshakePromise = inv('get_desktop_handshake_token').then(t => {
        cachedHandshakeToken = t;
        return t;
      }).catch(() => null);
    }
  }
  if (isTauri()) {
    initHandshakeToken();
  }

  if (typeof window !== 'undefined' && window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (resource, init) {
      let finalResource = resource;
      const targetBase = getBaseUrl();
      if (targetBase !== window.location.origin) {
        if (typeof resource === 'string') {
          if (resource.startsWith('/api/') || resource.startsWith('api/')) {
            finalResource = resolveApiUrl(resource);
          }
        } else if (resource instanceof Request) {
          try {
            const parsed = new URL(resource.url, window.location.href);
            if (parsed.pathname.startsWith('/api/')) {
              finalResource = new Request(resolveApiUrl(parsed.pathname + parsed.search), resource);
            }
          } catch (_) {}
        }
      }

      if (!cachedHandshakeToken && handshakePromise) {
        try { await handshakePromise; } catch (_) {}
      }

      if (cachedHandshakeToken) {
        init = init || {};
        if (init.headers instanceof Headers) {
          if (!init.headers.has('X-VS-Handshake-Token')) {
            init.headers.set('X-VS-Handshake-Token', cachedHandshakeToken);
          }
        } else if (Array.isArray(init.headers)) {
          init.headers.push(['X-VS-Handshake-Token', cachedHandshakeToken]);
        } else {
          init.headers = Object.assign({}, init.headers, {
            'X-VS-Handshake-Token': cachedHandshakeToken
          });
        }
      }

      return originalFetch.call(this, finalResource, init);
    };
  }

  // 8. TauriBridge Namespace Object
  const TauriBridge = {
    isTauri: isTauri(),
    isTauriApp: isTauri,
    version: '2.0.0',
    getBaseUrl: getBaseUrl,
    getHostUrl: getHostUrl,
    setHostUrl: setHostUrl,
    resetHostUrl: resetHostUrl,
    resolveApiUrl: resolveApiUrl,
    getInvoke: getTauriInvoke,
    getWindow: getTauriWindow,
    minimizeWindow: minimizeWindow,
    toggleMaximize: toggleMaximize,
    maximizeWindow: toggleMaximize,
    isMaximized: isMaximized,
    closeWindow: closeWindow,
    confirmClose: confirmClose,
    closeApp: confirmClose,
    startDrag: startDrag,
    openFileDialog: openFileDialog,
    saveFileDialog: saveFileDialog,
    saveFileToLocation: saveFileToLocation,
    openLocalFolder: openLocalFolder,
    openPath: async function(pathOrUrl) {
      if (!pathOrUrl) return false;
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('open_path', { path: pathOrUrl });
        } catch (_) {
          try {
            return await inv('plugin:opener|open_path', { path: pathOrUrl });
          } catch (_) {
            try {
              return await inv('plugin:opener|open_url', { url: pathOrUrl });
            } catch (_) {}
          }
        }
      }
      if (window.__TAURI__?.opener?.openPath) {
        try { return await window.__TAURI__.opener.openPath(pathOrUrl); } catch (_) {}
      }
      if (window.__TAURI__?.opener?.openUrl) {
        try { return await window.__TAURI__.opener.openUrl(pathOrUrl); } catch (_) {}
      }
      if (window.__TAURI__?.shell?.open) {
        try { return await window.__TAURI__.shell.open(pathOrUrl); } catch (_) {}
      }
      if (window.pywebview?.api?.open_local_folder && typeof window.pywebview.api.open_local_folder === 'function') {
        try { return await window.pywebview.api.open_local_folder(pathOrUrl); } catch (_) {}
      }
      try { window.open(pathOrUrl, '_blank'); } catch (_) {}
      return true;
    },
    applyDragRegions: applyDragRegions,
    isClientMode: async function() {
      if (typeof window !== 'undefined') {
        try {
          if (window.location && window.location.search) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mode') === 'client' || params.get('client') === '1') return true;
            if (params.get('mode') === 'host') return false;
          }
          if (typeof window.__vsIsClientMode === 'boolean') return window.__vsIsClientMode;
          const stored = localStorage.getItem('vs_app_mode') || localStorage.getItem('vs-app-mode');
          if (stored === 'client') return true;
          if (stored === 'host') return false;
        } catch (_) {}
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('is_client_mode');
        } catch (_) {}
      }
      return false;
    },
    getAppMode: async function() {
      if (typeof window !== 'undefined') {
        try {
          if (window.location && window.location.search) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mode') === 'client' || params.get('client') === '1') return 'client';
            if (params.get('mode') === 'host') return 'host';
          }
          if (typeof window.__vsIsClientMode === 'boolean') return window.__vsIsClientMode ? 'client' : 'host';
          const stored = localStorage.getItem('vs_app_mode') || localStorage.getItem('vs-app-mode');
          if (stored) return stored;
        } catch (_) {}
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('get_app_mode');
        } catch (_) {}
      }
      return 'host';
    },
    getClientConnectionState: async function() {
      if (typeof window !== 'undefined' && window.pywebview?.api?.get_client_connection_state) {
        try {
          const res = await window.pywebview.api.get_client_connection_state();
          if (res) return (typeof res === 'string') ? JSON.parse(res) : res;
        } catch (_) {}
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          const raw = await inv('get_client_connection_state');
          if (raw) return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_) {}
      }
      try {
        const resp = await fetch('/api/client/connection-state', { timeout: 1000 }).catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json();
          if (data && data.status) return data;
        }
      } catch (_) {}
      if (typeof localStorage !== 'undefined') {
        try {
          const stored = localStorage.getItem('vs_client_connection_state') || localStorage.getItem('vs-client-connection-state');
          if (stored) return JSON.parse(stored);
        } catch (_) {}
      }
      return null;
    },
    getClientAutostartStatus: async function() {
      if (typeof window !== 'undefined' && window.pywebview?.api?.get_client_autostart_status) {
        try {
          const res = await window.pywebview.api.get_client_autostart_status();
          if (typeof res === 'boolean') return res;
          if (res && typeof res.autostart === 'boolean') return res.autostart;
        } catch (_) {}
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          const res = await inv('get_client_autostart_status');
          if (typeof res === 'boolean') return res;
        } catch (_) {}
      }
      try {
        const resp = await fetch('/api/client/autostart', { timeout: 1000 }).catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json();
          if (typeof data.autostart === 'boolean') return data.autostart;
        }
      } catch (_) {}
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('vs_client_daemon_autostart') === 'true';
      }
      return false;
    },
    setClientAutostart: async function(enabled) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vs_client_daemon_autostart', enabled ? 'true' : 'false');
      }
      if (typeof window !== 'undefined' && window.pywebview?.api?.set_client_autostart) {
        try {
          const res = await window.pywebview.api.set_client_autostart(enabled);
          if (res && res.ok !== undefined) return res;
        } catch (_) {}
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          const res = await inv('set_client_autostart', { enabled: !!enabled });
          return { ok: true, autostart: !!res };
        } catch (_) {}
      }
      try {
        const resp = await fetch('/api/client/autostart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autostart: !!enabled })
        }).catch(() => null);
        if (resp && resp.ok) {
          return await resp.json();
        }
      } catch (_) {}
      return { ok: true, autostart: !!enabled };
    },
    isAutostartEnabled: async function() {
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('is_autostart_enabled');
        } catch (_) {}
      }
      try {
        const resp = await fetch('/api/system/autostart', { timeout: 1000 }).catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json();
          if (typeof data.enabled === 'boolean') return data.enabled;
          if (typeof data.server_autostart === 'boolean') return data.server_autostart;
        }
      } catch (_) {}
      return false;
    },
    enableAutostartServer: async function() {
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('enable_autostart_server');
        } catch (_) {}
      }
      const resp = await fetch('/api/system/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });
      return await resp.json();
    },
    disableAutostartServer: async function() {
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('disable_autostart_server');
        } catch (_) {}
      }
      const resp = await fetch('/api/system/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      });
      return await resp.json();
    },
    getLaunchPdfPath: async function() {
      if (typeof window !== 'undefined' && window.__VS_LAUNCH_PDF__) {
        return window.__VS_LAUNCH_PDF__;
      }
      const inv = getTauriInvoke();
      if (inv) {
        try {
          const res = await inv('get_launch_pdf_path');
          if (res) return res;
        } catch (_) {}
      }
      if (typeof window !== 'undefined' && window.pywebview?.api?.get_launch_pdf_path) {
        try {
          const res = await window.pywebview.api.get_launch_pdf_path();
          if (res) return res;
        } catch (_) {}
      }
      return null;
    },
    handlePdfLaunch: async function(filePath) {
      if (!filePath) return false;
      if (typeof global.openPdfFilePathInStudio === 'function') {
        return await global.openPdfFilePathInStudio(filePath);
      }
      return false;
    }
  };

  global.TauriBridge = TauriBridge;

  // 9. Pywebview polyfill when running in Tauri without pywebview
  if (typeof window !== 'undefined' && typeof window.pywebview === 'undefined' && isTauri()) {
    window.pywebview = {
      api: {
        minimize_window: () => TauriBridge.minimizeWindow(),
        maximize_window: () => TauriBridge.toggleMaximize(),
        is_maximized: () => TauriBridge.isMaximized(),
        close_window: () => TauriBridge.closeWindow(),
        confirm_close: () => TauriBridge.confirmClose(),
        start_drag: () => TauriBridge.startDrag(),
        start_resize: () => {},
        save_file_to_location: (src, defName, artId) => TauriBridge.saveFileToLocation(src, defName, artId),
        open_local_folder: (path) => TauriBridge.openLocalFolder(path),
        get_client_connection_state: () => TauriBridge.getClientConnectionState(),
        get_client_autostart_status: () => TauriBridge.getClientAutostartStatus(),
        set_client_autostart: (enabled) => TauriBridge.setClientAutostart(enabled),
        get_launch_pdf_path: () => TauriBridge.getLaunchPdfPath()
      }
    };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('pywebviewready'));
    }, 10);
  }

  // 10. Auto-initialize drag regions on DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyDragRegions);
    } else {
      applyDragRegions();
    }
  }

  // 11. Global native PDF launcher handler
  global.openPdfFilePathInStudio = async function(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const cleanPath = filePath.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    console.log('[PDF Viewer] Opening PDF in Studio:', cleanPath);

    // Set navigation state immediately
    if (typeof global.current !== 'undefined') {
      global.current = 'pdf-studio';
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = 'pdf-studio';
    }
    if (typeof global.safeNavigate === 'function') {
      global.safeNavigate('studio');
    } else if (typeof global.navigateTo === 'function') {
      global.navigateTo('pdf-studio');
    } else if (typeof global.nav === 'function') {
      global.nav();
    }

    // Request backend to create PDF session from file path
    const getApi = () => global.api || (typeof api === 'function' ? api : null);
    let apiFn = getApi();
    if (!apiFn) {
      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise(r => setTimeout(r, 200));
        apiFn = getApi();
        if (apiFn) break;
      }
    }

    if (!apiFn) {
      console.error('[PDF Viewer] API client unavailable to load PDF file.');
      return false;
    }

    try {
      const res = await apiFn('/api/pdf-studio/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: cleanPath })
      });

      if (res && res.ok && res.session) {
        if (typeof global.openPdfStudioSession === 'function') {
          global.openPdfStudioSession(res.session, res.thumbnails);
          if (typeof global.renderStudioAll === 'function' && document.getElementById('studio-root')) {
            global.renderStudioAll();
          }
          return true;
        }
      } else {
        console.error('[PDF Viewer] Backend returned error for file path:', res?.error);
        if (typeof global.studioToast === 'function') {
          global.studioToast('Failed to open PDF: ' + (res?.error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('[PDF Viewer] Network error opening PDF file path:', err);
    }
    return false;
  };

  // 12. Single-instance PDF event listener
  if (typeof window !== 'undefined') {
    const registerPdfOpenListener = async () => {
      try {
        if (window.__TAURI__?.event?.listen) {
          await window.__TAURI__.event.listen('open-pdf-file', async (evt) => {
            const pdfPath = evt.payload;
            if (pdfPath) {
              console.log('[TauriBridge] Received open-pdf-file event:', pdfPath);
              if (typeof global.openPdfFilePathInStudio === 'function') {
                await global.openPdfFilePathInStudio(pdfPath);
              }
            }
          });
        }
      } catch (err) {
        console.warn('[TauriBridge] Error setting up open-pdf-file event listener:', err);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', registerPdfOpenListener);
    } else {
      registerPdfOpenListener();
    }
  }

})(typeof window !== 'undefined' ? window : this);
