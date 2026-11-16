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
    if (window.pywebview?.api?.minimize_window && typeof window.pywebview.api.minimize_window === 'function') {
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
    if (window.pywebview?.api?.maximize_window && typeof window.pywebview.api.maximize_window === 'function') {
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
        return res || { ok: true, maximized: false };
      } catch (_) {}
    }
    if (window.pywebview?.api?.is_maximized && typeof window.pywebview.api.is_maximized === 'function') {
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
    if (window.pywebview?.api?.confirm_close && typeof window.pywebview.api.confirm_close === 'function') {
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
        return await inv('start_drag');
      } catch (_) {}
    }
    if (window.pywebview?.api?.start_drag && typeof window.pywebview.api.start_drag === 'function') {
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
    if (window.pywebview?.api?.open_local_folder && typeof window.pywebview.api.open_local_folder === 'function') {
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
  async function initHandshakeToken() {
    const inv = getTauriInvoke();
    if (inv) {
      try {
        cachedHandshakeToken = await inv('get_desktop_handshake_token');
      } catch (_) {}
    }
  }
  if (isTauri()) {
    initHandshakeToken();
  }

  if (typeof window !== 'undefined' && window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function (resource, init) {
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
    startDrag: startDrag,
    openFileDialog: openFileDialog,
    saveFileDialog: saveFileDialog,
    saveFileToLocation: saveFileToLocation,
    openLocalFolder: openLocalFolder,
    applyDragRegions: applyDragRegions,
    isClientMode: async function() {
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('is_client_mode');
        } catch (_) {}
      }
      return false;
    },
    getAppMode: async function() {
      const inv = getTauriInvoke();
      if (inv) {
        try {
          return await inv('get_app_mode');
        } catch (_) {}
      }
      return 'host';
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
        open_local_folder: (path) => TauriBridge.openLocalFolder(path)
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

})(typeof window !== 'undefined' ? window : this);
