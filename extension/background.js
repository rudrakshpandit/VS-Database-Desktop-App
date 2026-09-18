const queues = new Map();
const busy = new Set();
const extensionInitiatedDownloads = new Set();

// Enable Chrome Side Panel on action click
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-filing') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  }
});

const SUPPORTED_EXTENSIONS = [
  '.pdf', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.pptx', '.ppt', '.zip', '.json', '.txt', '.xml'
];

function getExtensionFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('sheet')) return 'xlsx';
  if (m.includes('csv')) return 'csv';
  if (m.includes('word') || m.includes('document')) return 'docx';
  if (m.includes('zip')) return 'zip';
  if (m.includes('json')) return 'json';
  return 'pdf';
}

function isSupportedFile(filename, mime, url = '') {
  const name = (filename || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (SUPPORTED_EXTENSIONS.some(ext => name.endsWith(ext) || name.includes(ext + '?') || name.includes(ext + '#') || u.includes(ext))) {
    return true;
  }
  if (m.includes('pdf') || m.includes('spreadsheet') || m.includes('excel') || m.includes('word') || m.includes('document') || m.includes('zip') || m.includes('json') || m.includes('octet-stream') || m.includes('csv')) {
    return true;
  }
  if (/download|export|report|statement|challan|receipt|invoice|return|gstr|itr|ais|tis|26as|ledger|ack|computation|form/i.test(name) || /download|export|report|statement|challan|receipt|invoice|return|gstr|itr|ais|tis|26as|ledger|ack|computation|form/i.test(u)) {
    return true;
  }
  return false;
}

function extractFilename(url, suggestedName, mime = '') {
  if (suggestedName && suggestedName.trim()) {
    const clean = suggestedName.split(/[/\\]/).pop().trim();
    if (clean) {
      if (clean.includes('.')) return clean;
      const ext = getExtensionFromMime(mime);
      return `${clean}.${ext}`;
    }
  }
  try {
    const u = new URL(url);
    const pathPart = u.pathname.split('/').pop();
    if (pathPart && pathPart.includes('.')) return decodeURIComponent(pathPart);
    const queryFile = u.searchParams.get('file') || u.searchParams.get('filename') || u.searchParams.get('name') || u.searchParams.get('doc');
    if (queryFile) return decodeURIComponent(queryFile);
  } catch (_) {}
  const ext = getExtensionFromMime(mime);
  return `document.${ext}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function isServerOrigin(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      if (u.port === '8767' || u.pathname.startsWith('/api/client-files/')) return true;
    }
    const store = await chrome.storage.local.get(['server']);
    if (store.server) {
      const sUrl = new URL(store.server);
      if (u.origin === sUrl.origin) return true;
    }
    if (u.hostname === 'vs-database.in') return true;
  } catch (_) {}
  return false;
}

function isServerOriginSync(url) {
  try {
    const u = new URL(url);
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '8767') return true;
    if (u.hostname === 'vs-database.in') return true;
    if (u.pathname.startsWith('/api/client-files/')) return true;
  } catch (_) {}
  return false;
}

async function practiveTab() {
  const tabs = await chrome.tabs.query({ url: ['https://app.practive.in/*'] });
  if (tabs.length) return tabs[0];
  return chrome.tabs.create({ url: 'https://app.practive.in/todos', active: true });
}

async function ensureContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'CA_OFFICE_PING' }); }
  catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    } catch (_) {}
  }
}

async function dispatch(tabId) {
  if (busy.has(tabId) || !(queues.get(tabId)?.length)) return;
  busy.add(tabId);
  try {
    await chrome.tabs.update(tabId, { active: true });
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'START_PRACTIVE_AUTOMATION', job: queues.get(tabId)[0] });
  } catch (_) {
    await chrome.tabs.update(tabId, { url: 'https://app.practive.in/todos', active: true });
  }
}

// ========================================================
// CAPTURE MANAGER (Non-blocking In-Memory Capture Cache)
// ========================================================
const captureCache = new Map(); // key: url or dl_${id} -> Promise<{ base64, size, mime }>

function getCaptureKey(url, downloadId) {
  if (downloadId) return `dl_${downloadId}`;
  return url || '';
}

function isHtmlBuffer(arrayBuf, targetUrl = '') {
  if (!arrayBuf || arrayBuf.byteLength < 5) return false;
  const urlLower = String(targetUrl || '').toLowerCase();
  if (urlLower.includes('.xls') || urlLower.includes('.xml') || urlLower.includes('.csv') || urlLower.includes('.html') || urlLower.includes('.htm')) {
    return false;
  }
  const bytes = new Uint8Array(arrayBuf.slice(0, Math.min(300, arrayBuf.byteLength)));
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  text = text.trim().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<head')) {
    if (urlLower.includes('.pdf')) {
      return !text.includes('%pdf-');
    }
  }
  return false;
}

async function startBackgroundCapture(url, downloadId) {
  const key = getCaptureKey(url, downloadId);
  if (!key) throw new Error('No capture target specified');

  if (captureCache.has(key)) {
    return captureCache.get(key);
  }

  const capturePromise = (async () => {
    try {
      if (!url) throw new Error('No source URL for capture');
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const arrayBuf = await resp.arrayBuffer();
      
      // Guard against HTML error redirects on binary files
      if (isHtmlBuffer(arrayBuf, url)) {
        throw new Error('Received HTML webpage instead of document file');
      }

      const base64 = arrayBufferToBase64(arrayBuf);
      const mime = resp.headers.get('content-type') || 'application/pdf';
      const result = {
        ok: true,
        base64,
        size: arrayBuf.byteLength,
        mime,
        url,
        timestamp: Date.now()
      };
      return result;
    } catch (err) {
      captureCache.delete(key);
      throw err;
    }
  })();

  captureCache.set(key, capturePromise);
  if (url && key !== url) {
    captureCache.set(url, capturePromise);
  }
  return capturePromise;
}

const pendingDownloadDecisions = new Map();
let isBulkModeActive = false;
const bulkInterceptedDownloadIds = new Set();

try {
  chrome.storage.local.get(['bulk_mode'], (res) => {
    if (res && res.bulk_mode) isBulkModeActive = true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bulk_mode !== undefined) {
      isBulkModeActive = Boolean(changes.bulk_mode.newValue);
      if (!isBulkModeActive) {
        bulkInterceptedDownloadIds.clear();
      }
    }
  });
} catch (_) {}

chrome.downloads.onChanged.addListener((delta) => {
  const dlId = Number(delta.id);
  if (bulkInterceptedDownloadIds.has(dlId)) {
    if (delta.state && delta.state.current === 'complete') {
      cancelOrDeleteDownload(dlId);
    }
  }
});

async function waitForDownloadComplete(downloadId, timeoutMs = 45000) {
  if (!downloadId) return null;
  const numId = Number(downloadId);
  if (isNaN(numId) || !Number.isInteger(numId) || numId <= 0) return null;
  const query = { id: numId };

  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
    };

    // 1. Check if already complete
    chrome.downloads.search(query, (items) => {
      if (items && items[0] && items[0].state === 'complete' && items[0].filename) {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(items[0].filename);
        }
      }
    });

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        // One final search before timeout
        chrome.downloads.search(query, (items) => {
          resolve(items && items[0] && items[0].filename ? items[0].filename : null);
        });
      }
    }, timeoutMs);

    function listener(delta) {
      if (delta.id === downloadId || delta.id === numId) {
        if (delta.state && delta.state.current === 'complete') {
          if (!resolved) {
            resolved = true;
            cleanup();
            chrome.downloads.search(query, (items) => {
              resolve(items && items[0] && items[0].filename ? items[0].filename : null);
            });
          }
        } else if (delta.state && (delta.state.current === 'interrupted' || delta.error)) {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(null);
          }
        }
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

async function handleDetectedDownload(downloadItem, customName) {
  try {
    if (extensionInitiatedDownloads.has(downloadItem.id) || extensionInitiatedDownloads.has(downloadItem.url)) {
      return;
    }
    if (await isServerOrigin(downloadItem.url)) {
      return;
    }

    const filename = extractFilename(downloadItem.url, customName || downloadItem.filename, downloadItem.mime);
    if (!isSupportedFile(filename, downloadItem.mime, downloadItem.url)) {
      return;
    }

    // Set badge to alert user
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });

    // Store latest detection in storage for Side Panel
    const detObj = {
      downloadId: downloadItem.id,
      id: downloadItem.id,
      filename: filename,
      source_url: downloadItem.url,
      url: downloadItem.url,
      mime: downloadItem.mime,
      file_type: downloadItem.mime || 'application/octet-stream',
      fileSize: downloadItem.fileSize || downloadItem.totalBytes || 0,
      timestamp: Date.now()
    };

    await chrome.storage.local.set({
      latest_download_detected: detObj,
      pending_detected_file: detObj
    });

    // Notify Side Panel in real-time
    chrome.runtime.sendMessage({
      type: 'NEW_DOWNLOAD_INTERCEPTED',
      file: detObj
    }).catch(() => {});

    // Automatically open Side Panel for the active window
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (chrome.sidePanel && chrome.sidePanel.open) {
      if (tabs[0]?.windowId) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(() => {});
      }
    }

    // Keep Chrome download intact on disk so desktop app can ingest via source_local_path
  } catch (err) {
    // Silent catch
  }
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  const filename = extractFilename(downloadItem.url, downloadItem.filename, downloadItem.mime);
  if (isSupportedFile(filename, downloadItem.mime, downloadItem.url) && !isServerOriginSync(downloadItem.url)) {
    // Start parallel background pre-fetch immediately
    if (downloadItem.url && /^https?:/i.test(downloadItem.url)) {
      startBackgroundCapture(downloadItem.url, downloadItem.id).catch(() => {});
    }
  }
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const filename = extractFilename(downloadItem.url, downloadItem.filename, downloadItem.mime);
  if (!isSupportedFile(filename, downloadItem.mime, downloadItem.url) || isServerOriginSync(downloadItem.url)) {
    suggest();
    return false;
  }

  // Pre-fetch in background immediately
  if (downloadItem.url && /^https?:/i.test(downloadItem.url)) {
    startBackgroundCapture(downloadItem.url, downloadItem.id).catch(() => {});
  }

  // Check storage asynchronously to ensure service worker wake-up has latest bulk_mode
  chrome.storage.local.get(['bulk_mode'], (store) => {
    const isBulk = Boolean(store && store.bulk_mode) || isBulkModeActive;
    if (isBulk) {
      isBulkModeActive = true;
      bulkInterceptedDownloadIds.add(Number(downloadItem.id));
      cancelOrDeleteDownload(downloadItem.id);

      // Broadcast file to bulk collector dock on active tab
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (tabs[0]?.id && !tabs[0].url?.startsWith('chrome://')) {
          ensureContentScript(tabs[0].id).then(() => {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SHOW_DOWNLOAD_INTERCEPT_PROMPT',
              downloadId: downloadItem.id,
              filename: filename,
              url: downloadItem.url,
              mime: downloadItem.mime,
              fileSize: downloadItem.fileSize || downloadItem.totalBytes || 0
            }).catch(() => {});
          });
        }
      });
      return;
    }

    // Normal non-bulk download prompt
    const timeoutId = setTimeout(() => {
      pendingDownloadDecisions.delete(downloadItem.id);
      try { suggest({ filename: downloadItem.filename || filename, conflictAction: 'uniquify' }); } catch (_) {}
    }, 25000);

    pendingDownloadDecisions.set(downloadItem.id, { suggest, timeoutId });

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id && !tabs[0].url?.startsWith('chrome://')) {
        ensureContentScript(tabs[0].id).then(() => {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SHOW_DOWNLOAD_INTERCEPT_PROMPT',
            downloadId: downloadItem.id,
            filename: filename,
            url: downloadItem.url,
            mime: downloadItem.mime,
            fileSize: downloadItem.fileSize || downloadItem.totalBytes || 0
          }).catch(() => {});
        });
      }
    });
  });

  return true; // asynchronous filename determination
});

// Helper for Background API calls (exempt from Webpage CSP restrictions)
async function callServerApi(endpoint, options = {}) {
  const store = await chrome.storage.local.get(['server', 'session_token', 'device_id']);
  let storedServer = (store.server || '').replace(/\/$/, '');
  if (storedServer.includes(':8766')) storedServer = '';
  const candidates = [
    storedServer,
    'http://127.0.0.1:8767',
    'http://localhost:8767',
    'http://vs-database.in'
  ].filter(Boolean);
  const serverUrls = [...new Set(candidates)];

  const headers = {
    'Content-Type': 'application/json',
    'X-VS-Session-Token': store.session_token || '',
    'X-VS-Device-Id': store.device_id || ''
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let lastErr = null;
  for (const serverUrl of serverUrls) {
    const targetUrl = endpoint.startsWith('http') ? endpoint : `${serverUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    try {
      const resp = await fetch(targetUrl, fetchOptions);
      const text = await resp.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

      if (!resp.ok) {
        throw new Error((parsed && parsed.error) ? parsed.error : `HTTP ${resp.status}`);
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      if (endpoint.startsWith('http')) break;
    }
  }

  throw lastErr || new Error('Cannot reach VS Database server.');
}

// Flash badge notification
function flashBadge(text, color = '#22c55e', durationMs = 4000) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    if (durationMs > 0) {
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, durationMs);
    }
  } catch (_) {}
}

function cancelOrDeleteDownload(downloadId) {
  if (!downloadId) return;
  const numId = Number(downloadId);
  const dlId = (!isNaN(numId) && Number.isInteger(numId) && numId > 0) ? numId : downloadId;

  // 1. Immediate cancel to abort in-flight transfers instantly
  try {
    chrome.downloads.cancel(dlId, () => {
      chrome.downloads.erase({ id: dlId }, () => {});
    });
  } catch (_) {}

  // 2. Query download state to remove from disk if already completed
  chrome.downloads.search({ id: dlId }, (items) => {
    if (items && items[0]) {
      const item = items[0];
      if (item.state === 'complete') {
        try {
          chrome.downloads.removeFile(dlId, () => {
            chrome.downloads.erase({ id: dlId }, () => {});
          });
        } catch (_) {
          chrome.downloads.erase({ id: dlId }, () => {});
        }
      } else {
        try {
          chrome.downloads.cancel(dlId, () => {
            chrome.downloads.erase({ id: dlId }, () => {});
          });
        } catch (_) {}
      }
    }
  });
}

// ========================================================
// BACKGROUND SAVE TASK RUNNER
// ========================================================
async function processBackgroundSave(job) {
  const {
    client_file_no,
    document_name,
    source_url,
    downloadId,
    file_base64,
    mime,
    fileSize,
    target_folder,
    service,
    period,
    save_local,
    save_drive,
    client_visibility,
    upload_practive,
    clientName,
    taskName
  } = job;

  flashBadge('⏳', '#2563eb', 0);

  let source_local_path = null;
  let b64 = file_base64;

  // 1. If downloadId exists, wait for completed file on disk
  if (downloadId) {
    source_local_path = await waitForDownloadComplete(downloadId, 15000);
  }

  // 2. If no local path on disk, try in-memory capture
  if (!source_local_path && !b64) {
    if (source_url || downloadId) {
      try {
        const captured = await startBackgroundCapture(source_url, downloadId);
        b64 = captured?.base64;
      } catch (_) {}
    }

    // 3. Fallback: Request active tab to fetch with session cookies
    if (!b64 && source_url) {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs[0]?.id) {
          const pageRes = await chrome.tabs.sendMessage(tabs[0].id, { type: 'FETCH_DOCUMENT', url: source_url });
          if (pageRes?.ok && pageRes.base64) {
            b64 = pageRes.base64;
          }
        }
      } catch (_) {}
    }
  }

  if (!source_local_path && !b64) {
    flashBadge('ERR', '#ef4444', 4000);
    throw new Error('Could not obtain document content to save. Please try selecting or dropping the file again.');
  }

  let resolvedPeriod = period && period !== 'Current' ? period : 'AY 2025-26';
  if (target_folder) {
    const match = target_folder.match(/\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b/i);
    if (match) resolvedPeriod = match[0];
  }

  const payload = {
    client_file_no,
    document_name: document_name || 'document.pdf',
    save_local: save_local !== false,
    save_drive: !!save_drive,
    client_visibility: !!client_visibility,
    upload_practive: !!upload_practive,
    service: service || 'General',
    period: resolvedPeriod
  };

  if (source_local_path) {
    payload.source_local_path = source_local_path;
  } else {
    payload.file_base64 = b64;
  }

  if (target_folder) {
    payload.target_folder = target_folder;
    payload.relative_path = target_folder;
  }

  const saveResponse = await callServerApi('/api/save-document', {
    method: 'POST',
    body: payload
  });

  // Cleanup browser download so it does not remain in user's general Downloads folder
  if (downloadId) {
    cancelOrDeleteDownload(downloadId);
  }

  // Handle Practive automation if requested
  if (upload_practive) {
    const pTab = await practiveTab();
    if (pTab) {
      const queue = queues.get(pTab.id) || [];
      queue.push({
        ...saveResponse,
        server: (await chrome.storage.local.get(['server'])).server || 'http://127.0.0.1:8767',
        sessionToken: (await chrome.storage.local.get(['session_token'])).session_token || '',
        clientName: clientName || client_file_no,
        service: service || 'General',
        period: period || 'Current',
        taskName: taskName || '',
        fileName: document_name || 'filing.pdf'
      });
      queues.set(pTab.id, queue);
      busy.delete(pTab.id);
      dispatch(pTab.id);
    }
  }

  // Clean pending detected file in storage
  await chrome.storage.local.remove(['pending_detected_file', 'latest_download_detected']);
  await chrome.storage.local.set({
    last_saved_job: {
      document_name,
      client_file_no,
      timestamp: Date.now(),
      success: true
    }
  });

  flashBadge('✓', '#22c55e', 4000);
  return saveResponse;
}

// ========================================================
// MESSAGE DISPATCHER
// ========================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Practive Automation
  if (message.type === 'START_PRACTIVE_UPLOAD') {
    practiveTab().then(tab => {
      const queue = queues.get(tab.id) || [];
      queue.push(message.job);
      queues.set(tab.id, queue);
      busy.delete(tab.id);
      dispatch(tab.id);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'PRACTIVE_AUTOMATION_DONE') {
    const queue = queues.get(sender.tab?.id) || [];
    queue.shift();
    queues.set(sender.tab?.id, queue);
    busy.delete(sender.tab?.id);
    dispatch(sender.tab?.id);
    return;
  }

  // 2. Fetch Remote Document Proxy (Bypasses webpage CSP for content script)
  if (message.type === 'FETCH_REMOTE_DOCUMENT') {
    (async () => {
      try {
        const cap = await startBackgroundCapture(message.url, message.downloadId);
        sendResponse({ ok: true, base64: cap.base64, size: cap.size, mime: cap.mime });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Instant Download Decision from In-Page Prompt
  if (message.type === 'VS_DOWNLOAD_DECISION') {
    (async () => {
      const { downloadId, decision, filename, url, file_base64, mime, fileSize } = message;
      chrome.action.setBadgeText({ text: '' });

      const pending = pendingDownloadDecisions.get(downloadId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingDownloadDecisions.delete(downloadId);
      }

      if (decision === 'no') {
        if (pending && pending.suggest) {
          try { pending.suggest(); } catch (_) {}
        }
        if (downloadId) {
          chrome.downloads.resume(downloadId).catch(() => {});
        }
        sendResponse({ ok: true, resumed: true });
        return;
      }

      if (decision === 'bulk') {
        isBulkModeActive = true;
        await chrome.storage.local.set({ bulk_mode: true });
        const pending = pendingDownloadDecisions.get(downloadId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingDownloadDecisions.delete(downloadId);
        }
        if (downloadId) {
          const numId = Number(downloadId);
          const dlId = (!isNaN(numId) && numId > 0) ? numId : downloadId;
          bulkInterceptedDownloadIds.add(dlId);
          cancelOrDeleteDownload(dlId);
        }
        sendResponse({ ok: true, blocked: true });
        return;
      }

      if (decision === 'yes') {
        // If file base64 is already available, cancel/block normal download immediately
        if (file_base64 && downloadId) {
          try {
            chrome.downloads.cancel(downloadId, () => {
              chrome.downloads.erase({ id: downloadId }, () => {});
            });
          } catch (_) {}
        } else if (downloadId) {
          // If waiting for disk buffer, let Chrome write to disk; it will be moved/deleted by server upon staging
          if (pending && pending.suggest) {
            try { pending.suggest({ filename: filename || 'document.pdf', conflictAction: 'uniquify' }); } catch (_) {}
          }
          chrome.downloads.resume(downloadId).catch(() => {});
        }

        await chrome.storage.local.set({
          pending_detected_file: {
            filename: filename || 'detected_document.pdf',
            file_type: mime || 'application/octet-stream',
            file_size: fileSize || 0,
            source_url: url,
            file_base64: file_base64 || null,
            downloadId: downloadId,
            timestamp: Date.now()
          }
        });

        sendResponse({ ok: true, saved_pending: true });
        return;
      }
    })();
    return true;
  }

let isRedirectingToApp = false;

// The desktop application binds to 8767 (and dynamic range 8767-8799).
// Under no circumstances should port 8766 (Office Automation) ever be probed or used.
const DESKTOP_PORTS = Array.from({ length: 33 }, (_, index) => 8767 + index);

function desktopEndpointForPort(port) {
  return `http://127.0.0.1:${port}`;
}

let cachedDesktopEndpoint = 'http://127.0.0.1:8767';

async function findDesktopEndpoint(timeoutMs = 400) {
  // 1. Ultra-fast check on cached/default 8767 endpoint (completes in 1-2ms on local loopback)
  const candidate = cachedDesktopEndpoint || 'http://127.0.0.1:8767';
  try {
    const fastResp = await fetch(`${candidate}/api/desktop/health`, {
      signal: AbortSignal.timeout(120)
    });
    if (fastResp.ok) {
      const health = await fastResp.json().catch(() => null);
      if (health && health.ok && health.service === 'VS Database Desktop') {
        cachedDesktopEndpoint = candidate;
        return candidate;
      }
    }
  } catch (_) {}

  // 2. Fast check of stored server or fallback localhost
  const stored = await chrome.storage.local.get(['server']);
  let storedServer = (stored.server || '').replace(/\/$/, '');
  if (storedServer.includes(':8766')) storedServer = '';

  const quickCandidates = [storedServer, 'http://127.0.0.1:8767', 'http://localhost:8767'].filter(Boolean);
  for (const ep of [...new Set(quickCandidates)]) {
    try {
      const resp = await fetch(`${ep}/api/desktop/health`, { signal: AbortSignal.timeout(180) });
      if (resp.ok) {
        const h = await resp.json().catch(() => null);
        if (h && h.ok && h.service === 'VS Database Desktop') {
          cachedDesktopEndpoint = ep;
          await chrome.storage.local.set({ server: ep });
          return ep;
        }
      }
    } catch (_) {}
  }

  // 3. Fallback scan across dynamic range (8767-8799)
  const checks = await Promise.all(DESKTOP_PORTS.map(async p => {
    const ep = `http://127.0.0.1:${p}`;
    try {
      const response = await fetch(`${ep}/api/desktop/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return null;
      const health = await response.json().catch(() => null);
      return health && health.ok && health.service === 'VS Database Desktop' ? ep : null;
    } catch (_) {
      return null;
    }
  }));
  const endpoint = checks.find(Boolean) || null;
  if (endpoint) {
    cachedDesktopEndpoint = endpoint;
    await chrome.storage.local.set({ server: endpoint });
  }
  return endpoint;
}

async function redirectToDesktopApp(stagingData = null, originTabId = null) {
  if (isRedirectingToApp) return { ok: false, busy: true };
  isRedirectingToApp = true;
  setTimeout(() => { isRedirectingToApp = false; }, 800);

  // 1. Ultra-fast check if desktop application is currently running (< 2ms)
  let targetEndpoint = await findDesktopEndpoint(250);

  // 2. If Desktop App is offline, wake it up via in-page protocol on the user's active tab
  if (!targetEndpoint) {
    if (originTabId) {
      chrome.tabs.sendMessage(originTabId, { type: 'TRIGGER_PROTOCOL_LAUNCH' }).catch(() => {});
    }
    // Fast poll every 250ms for server readiness (completes as soon as binary boots)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250));
      targetEndpoint = await findDesktopEndpoint(150);
      if (targetEndpoint) break;
    }
  }

  if (!targetEndpoint) {
    console.warn('VS Database Desktop App did not become available; keeping browser downloads intact.');
    return { ok: false, error: 'Desktop application is not running.' };
  }

  // 3. Post lightweight metadata to Desktop Backend Staging API
  let serverResult = null;
  if (stagingData) {
    stagingData.origin_tab_id = originTabId;
    stagingData.is_redirected = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const postRes = await fetch(`${targetEndpoint}/api/staging/incoming`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stagingData)
        });
        if (postRes.ok) {
          serverResult = await postRes.json();
          break;
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!serverResult || !serverResult.success) {
      console.warn('VS Database Desktop App did not accept staged download:', serverResult);
      return { ok: false, error: 'Could not deliver files to desktop app.', result: serverResult };
    }
  }

  // 4. Bring native desktop window to front on Windows (non-blocking)
  fetch(`${targetEndpoint}/api/desktop/bring_to_front`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => {});

  return { ok: true, endpoint: targetEndpoint, result: serverResult };
}

  // 3. Send Single Document directly to VS Database Desktop App (No browser tab)
  if (message.type === 'OPEN_WEBSITE_FOR_SAVE' || message.type === 'OPEN_EXTENSION_FOR_SINGLE_SAVE') {
    (async () => {
      let file = message.file;

      if (message.use_stored_file || !file?.downloadId) {
        const store = await chrome.storage.local.get(['pending_detected_file', 'latest_download_detected']);
        const stored = store.pending_detected_file || store.latest_download_detected;
        if (stored) {
          file = { ...stored, ...(file || {}) };
        }
      }

      const downloadId = file?.downloadId || file?.id || null;
      let sourceLocalPath = file?.source_local_path || file?.local_path || null;
      let b64 = file?.file_base64 || file?.base64 || message.base64 || '';

      if (!b64 && downloadId) {
        const cap = captureCache.get(getCaptureKey(file?.url || file?.source_url, downloadId));
        if (cap) {
          try {
            const res = await cap;
            if (res && res.base64) b64 = res.base64;
          } catch (_) {}
        }
      }

      // Only wait for Chrome disk write if we DO NOT already have in-memory base64
      if (!b64 && !sourceLocalPath && downloadId) {
        sourceLocalPath = await waitForDownloadComplete(downloadId, 3500);
      }

      const fileItem = {
        download_id: downloadId,
        id: downloadId || `file_${Date.now()}`,
        filename: file?.filename || 'document.pdf',
        source_local_path: sourceLocalPath,
        file_base64: b64,
        base64: b64,
        source_url: file?.url || file?.source_url || '',
        url: file?.url || '',
        mime: file?.mime || file?.file_type || 'application/pdf',
        size: file?.fileSize || file?.size || 0
      };

      const originTabId = sender.tab?.id || null;
      const payload = {
        files: [fileItem],
        is_redirected: true,
        origin_tab_id: originTabId
      };

      const sendResult = await redirectToDesktopApp(payload, originTabId);

      // EXPLICIT RECEIPT ACKNOWLEDGEMENT CONTRACT:
      // Permanently block and erase the Chrome download once server confirms staging
      if (sendResult && sendResult.ok && sendResult.result && sendResult.result.success) {
        const stagedList = sendResult.result.files || [];
        for (const sf of stagedList) {
          const dlId = sf.download_id || downloadId;
          if (dlId) {
            cancelOrDeleteDownload(dlId);
          }
        }
        await chrome.storage.local.remove(['pending_detected_file', 'latest_download_detected']);
      } else {
        console.warn('[Extension] Staging was not acknowledged by desktop; preserving local download intact.');
      }

      sendResponse({ ok: Boolean(sendResult && sendResult.ok), result: sendResult?.result });
    })();
    return true;
  }

  // 4. Send Bulk Documents directly to VS Database Desktop App (No browser tab)
  if (message.type === 'OPEN_WEBSITE_FOR_BULK_SAVE' || message.type === 'OPEN_EXTENSION_FOR_BULK_SAVE') {
    (async () => {
      try {
        let files = message.files || [];

        if (message.use_stored_files || !files.length) {
          const store = await chrome.storage.local.get(['bulk_pending_files']);
          if (store.bulk_pending_files && store.bulk_pending_files.length) {
            files = store.bulk_pending_files;
          }
        }

        // Resolve local disk paths across queued items only when base64 is missing
        const enrichedFiles = await Promise.all((files || []).map(async f => {
          const rawDlId = f.download_id || f.downloadId;
          const numId = Number(rawDlId);
          const dlId = (!isNaN(numId) && Number.isInteger(numId) && numId > 0) ? numId : null;
          let sourceLocalPath = f.source_local_path || f.local_path || null;
          let b64 = f.file_base64 || f.base64 || '';
          if (!b64 && dlId) {
            const cap = captureCache.get(getCaptureKey(f.url || f.source_url, dlId));
            if (cap) {
              try {
                const res = await cap;
                if (res && res.base64) b64 = res.base64;
              } catch (_) {}
            }
          }
          if (!b64 && !sourceLocalPath && dlId) {
            try {
              sourceLocalPath = await waitForDownloadComplete(dlId, 2500);
            } catch (_) {}
          }
          return {
            download_id: dlId,
            filename: f.filename || 'document.pdf',
            source_local_path: sourceLocalPath,
            file_base64: b64,
            base64: b64,
            source_url: f.url || f.sourceData?.url || f.source_url || '',
            url: f.url || '',
            mime: f.mime || 'application/pdf',
            size: f.size || 0
          };
        }));

        const originTabId = sender.tab?.id || null;
        const payload = {
          files: enrichedFiles,
          is_redirected: true,
          origin_tab_id: originTabId
        };

        const sendResult = await redirectToDesktopApp(payload, originTabId);

        // EXPLICIT RECEIPT ACKNOWLEDGEMENT CONTRACT:
        if (sendResult && sendResult.ok && sendResult.result && sendResult.result.success) {
          const stagedList = sendResult.result.files || [];
          for (const sf of stagedList) {
            const numId = Number(sf.download_id);
            if (!isNaN(numId) && numId > 0) {
              cancelOrDeleteDownload(numId);
            }
          }
          isBulkModeActive = false;
          await chrome.storage.local.remove(['bulk_pending_files', 'bulk_mode']);
        } else {
          console.warn('[Extension] Bulk staging was not acknowledged by desktop; preserving local downloads intact.');
        }

        sendResponse({ ok: Boolean(sendResult && sendResult.ok), result: sendResult?.result });
      } catch (err) {
        console.error('[Extension] Error in OPEN_WEBSITE_FOR_BULK_SAVE:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Auto-close Website Tab and Return to Original Portal
  if (message.type === 'VS_SAVED_CLOSE_AND_RETURN') {
    (async () => {
      const { origin_tab_id } = message;
      if (origin_tab_id) {
        try {
          await chrome.tabs.update(origin_tab_id, { active: true });
          const originTab = await chrome.tabs.get(origin_tab_id).catch(() => null);
          if (originTab && originTab.windowId) {
            await chrome.windows.update(originTab.windowId, { focused: true }).catch(() => {});
          }
        } catch (_) {}
      }

      if (sender.tab?.id) {
        try {
          await chrome.tabs.remove(sender.tab.id);
        } catch (_) {}
      }

      sendResponse({ ok: true });
    })();
    return true;
  }

  // 6. Seamlessly Focus Original Portal Tab (keeps website tab running in background)
  if (message.type === 'VS_FOCUS_ORIGIN_TAB') {
    (async () => {
      const { origin_tab_id } = message;
      if (origin_tab_id) {
        try {
          await chrome.tabs.update(origin_tab_id, { active: true });
          const originTab = await chrome.tabs.get(origin_tab_id).catch(() => null);
          if (originTab && originTab.windowId) {
            await chrome.windows.update(originTab.windowId, { focused: true }).catch(() => {});
          }
        } catch (_) {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  // 7. Auto-close Website Tab after background queue processing completes
  if (message.type === 'VS_CLOSE_WEBSITE_TAB') {
    (async () => {
      if (sender.tab?.id) {
        try {
          await chrome.tabs.remove(sender.tab.id);
        } catch (_) {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  // 3. Document Intent / Click Capture Bridge
  if (message.type === 'RECORD_INTENT_DOWNLOAD') {
    (async () => {
      try {
        if (message.url && /^https?:/i.test(message.url)) {
          startBackgroundCapture(message.url).catch(() => {});
        }
        const det = {
          filename: message.filename || 'filing.pdf',
          source_url: message.url || '',
          file_type: 'application/octet-stream',
          timestamp: Date.now()
        };
        await chrome.storage.local.set({
          pending_detected_file: det,
          latest_download_detected: det
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 4. Background Capture / Remote Fetching Bridge
  if (message.type === 'FETCH_REMOTE_DOCUMENT' || message.type === 'START_BACKGROUND_CAPTURE') {
    (async () => {
      try {
        const captured = await startBackgroundCapture(message.url, message.downloadId);
        sendResponse({ ok: true, base64: captured.base64, mime: captured.mime, size: captured.size });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Synchronous / Asynchronous Save Pipeline
  if (message.type === 'PROCESS_SAVE_SYNC' || message.type === 'QUEUE_BACKGROUND_SAVE') {
    (async () => {
      try {
        const result = await processBackgroundSave(message.job);
        sendResponse({ ok: true, data: result });
      } catch (err) {
        console.error('Background save failed:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 6. Background API Call Proxy
  if (message.type === 'VS_API_CALL') {
    (async () => {
      try {
        const res = await callServerApi(message.url, {
          method: message.method,
          body: message.body
        });
        sendResponse({ ok: true, data: res });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'Cannot reach VS Database server.' });
      }
    })();
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && tab.url?.startsWith('https://app.practive.in/')) {
    busy.delete(tabId);
    dispatch(tabId);
  }
});

// ========================================================
// 3-HOUR PERIODIC AUTO-REFRESH ALARM
// ========================================================
try {
  if (chrome.alarms) {
    chrome.alarms.create('vs_database_3hr_refresh', { periodInMinutes: 180 });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'vs_database_3hr_refresh') {
        try {
          captureCache.clear();
          const store = await chrome.storage.local.get(['server']);
          const serverBase = (store.server || 'http://127.0.0.1:8767').replace(/\/$/, '');
          
          // 1. Refresh cached clients from server
          try {
            const clients = await callServerApi('/api/clients');
            if (Array.isArray(clients) && clients.length > 0) {
              await chrome.storage.local.set({ cached_clients: clients });
            }
          } catch (_) {}

          // 2. Auto-reload open VS Database website tabs every 3 hours
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.url && (t.url.startsWith(serverBase) || t.url.includes(':8767') || t.url.includes('vs-database.in'))) {
              chrome.tabs.reload(t.id).catch(() => {});
            }
          }
        } catch (_) {}
      }
    });
  }
} catch (_) {}

// ========================================================
// DESKTOP APP SAVE COMPLETION: AUTOMATIC RETURN TO BROWSER
// ========================================================
let isCheckingBrowserReturn = false;
async function checkPendingBrowserReturn() {
  if (isCheckingBrowserReturn) return;
  isCheckingBrowserReturn = true;
  try {
    const store = await chrome.storage.local.get(['server']);
    const serverBase = (store.server || 'http://127.0.0.1:8767').replace(/\/$/, '');
    const resp = await fetch(`${serverBase}/api/desktop/pending_browser_return`, { signal: AbortSignal.timeout(800) });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.pending && data.origin_tab_id) {
        await chrome.tabs.update(data.origin_tab_id, { active: true }).catch(() => {});
        const originTab = await chrome.tabs.get(data.origin_tab_id).catch(() => null);
        if (originTab && originTab.windowId) {
          await chrome.windows.update(originTab.windowId, { focused: true }).catch(() => {});
        }
      }
    }
  } catch (_) {}
  finally {
    isCheckingBrowserReturn = false;
  }
}

setInterval(checkPendingBrowserReturn, 1500);

