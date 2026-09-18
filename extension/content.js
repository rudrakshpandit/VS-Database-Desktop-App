if (!globalThis.__vsDatabaseFilingSaverLoaded) {
globalThis.__vsDatabaseFilingSaverLoaded = true;
const AUTO_KEY = 'ca-office-practive-job';
let automationRunning = false;

// ========================================================
// PRACTIVE AUTOMATION HELPERS
// ========================================================
function panel(message, tone = 'info') {
  let box = document.getElementById('ca-office-automation-panel');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ca-office-automation-panel';
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:340px;padding:16px;border-radius:12px;background:#172554;color:#fff;font:14px Segoe UI,Arial;box-shadow:0 16px 40px #0005';
    document.documentElement.append(box);
  }
  box.style.background = tone === 'error' ? '#991b1b' : tone === 'success' ? '#166534' : '#172554';
  box.innerHTML = `<b>VS Database Assistant</b><div style="margin-top:7px;line-height:1.4">${message}</div>`;
}

function exactText(text) {
  return [...document.querySelectorAll('a,button,[role="tab"],[role="button"]')].find(el => visible(el) && el.textContent.trim().toLowerCase() === text.toLowerCase());
}

function taskLink(job) {
  const wanted = (job.taskName || job.service || '').toLowerCase();
  const client = (job.clientName || '').toLowerCase();
  const links = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible);
  return links.find(el => {
    const row = el.closest('tr,[role="row"],li') || el.parentElement;
    const text = `${el.textContent} ${row?.textContent || ''}`.toLowerCase();
    return text.includes(wanted) && text.includes(client);
  }) || links.find(el => el.textContent.toLowerCase().includes(wanted));
}

async function getFile(job) {
  const response = await fetch(`${job.server}/api/jobs/${job.job_id}/file`, {
    headers: { 'X-VS-Session-Token': job.sessionToken || '' }
  });
  if (!response.ok) throw Error('The saved file could not be read from the main server.');
  return new File([await response.blob()], job.fileName || 'filing.pdf', { type: 'application/pdf' });
}

async function upload(job, input) {
  panel('Retrieving the saved PDF from the main server…');
  const file = await getFile(job);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  panel(`Uploading <b>${file.name}</b> to Practive…`);
  for (let i = 0; i < 20; i++) {
    await wait(700);
    if (document.body.innerText.includes(file.name)) return true;
  }
  return false;
}

async function runPractive() {
  if (automationRunning) return;
  const raw = sessionStorage.getItem(AUTO_KEY);
  if (!raw) return;
  automationRunning = true;
  const job = JSON.parse(raw);
  try {
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const done = await upload(job, fileInput);
      if (!done) throw Error('Practive did not confirm the upload. Check the Documents list before retrying.');
      panel(`Uploaded <b>${job.fileName}</b> successfully to Practive.`, 'success');
      sessionStorage.removeItem(AUTO_KEY);
      chrome.runtime.sendMessage({ type: 'PRACTIVE_AUTOMATION_DONE' });
      return;
    }
    const documents = exactText('Documents');
    if (documents) {
      panel(`Verified task screen for <b>${job.clientName}</b>. Opening Documents…`);
      documents.click();
      await wait(900);
      automationRunning = false;
      return runPractive();
    }
    const link = taskLink(job);
    if (link) {
      panel(`Opening Practive task for <b>${job.clientName}</b>…`);
      link.click();
      await wait(900);
      automationRunning = false;
      return runPractive();
    }
    panel(`Find the Practive task for <b>${job.clientName}</b> (${job.service}, ${job.period}) and open it. The assistant will automatically upload once its Documents tab appears.`);
    automationRunning = false;
  } catch (error) {
    panel(error.message, 'error');
    automationRunning = false;
  }
}

// ========================================================
// UTILITIES & STYLES
// ========================================================
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ========================================================
// FULL-SCREEN WEBSITE ISOLATION & SHIELD GUARD
// (Completely blocks underlying website scripts, event trapping,
// scrolling, focus-stealing, and click-stealing while modal is active)
// ========================================================
const WebsiteIsolationGuard = {
  activeModal: null,
  originalOverflow: '',
  cleanups: [],

  block(modalEl) {
    if (this.activeModal && this.activeModal !== modalEl) {
      this.unblock();
    }
    this.activeModal = modalEl;

    // 1. Freeze scrolling on the host page
    try {
      this.originalOverflow = document.documentElement.style.overflow;
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    } catch (_) {}

    // 2. Global Event Interceptor (Capture Phase)
    // Only blocks events when targeting OUTSIDE our active modal dialog
    const events = ['click', 'mousedown', 'pointerdown', 'touchstart', 'contextmenu', 'wheel'];

    this.cleanups = [];
    const onCapturedEvent = (e) => {
      if (!this.activeModal) return;
      // If event is inside our modal, DO NOT block it — let it reach buttons/inputs naturally!
      if (this.activeModal.contains(e.target) || e.target === this.activeModal) {
        return;
      }
      // Any event targeting the host website underneath the modal is BLOCKED
      e.stopPropagation();
      e.stopImmediatePropagation();
      try { e.preventDefault(); } catch (_) {}
    };

    events.forEach(evt => {
      window.addEventListener(evt, onCapturedEvent, true);
      this.cleanups.push(() => {
        window.removeEventListener(evt, onCapturedEvent, true);
      });
    });

    // 3. Ensure modal has full pointer priority
    if (modalEl) {
      modalEl.style.setProperty('pointer-events', 'auto', 'important');
      modalEl.style.setProperty('z-index', '2147483647', 'important');
    }
  },

  unblock() {
    this.activeModal = null;
    try {
      document.documentElement.style.overflow = this.originalOverflow || '';
    } catch (_) {}

    this.cleanups.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    this.cleanups = [];
  }
};

// Injects the shared CSS styles for the VS Database in-page modals
function ensureModalStyles() {
  if (document.getElementById('vs-database-inpage-styles')) return;
  const style = document.createElement('style');
  style.id = 'vs-database-inpage-styles';
  style.textContent = `
    .vs-inpage-overlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      background: rgba(10, 25, 55, 0.72) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 16px !important;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      animation: vsFadeIn 0.2s ease-out !important;
    }
    @keyframes vsFadeIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes vsPulseAnim {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    .vs-capturing-pulse {
      animation: vsPulseAnim 1.4s infinite ease-in-out;
    }
    .vs-inpage-dialog {
      width: min(520px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.9);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 25px 60px rgba(10, 31, 68, 0.35);
      color: #0f172a;
      position: relative;
      font-size: 13px;
    }
    .vs-inpage-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .vs-inpage-emblem {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #0A1F44, #1E40AF);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #C9A227;
      font-size: 22px;
      font-weight: 800;
      box-shadow: 0 4px 14px rgba(10, 31, 68, 0.25);
      flex-shrink: 0;
    }
    .vs-file-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 14px;
      margin: 14px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .vs-file-icon {
      font-size: 28px;
      flex-shrink: 0;
    }
    .vs-btn-group {
      display: flex;
      gap: 10px;
      margin-top: 18px;
    }
    .vs-btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #334155;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 40px;
    }
    .vs-btn:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }
    .vs-btn.primary {
      background: linear-gradient(135deg, #1e40af, #2563eb);
      color: #fff;
      border: 0;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
    }
    .vs-btn.primary:hover {
      background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
      box-shadow: 0 6px 18px rgba(37, 99, 235, 0.45);
    }
    .vs-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .vs-select-input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #fff;
      font-size: 12px;
      font-family: inherit;
      color: #0f172a;
      box-sizing: border-box;
      margin-top: 4px;
    }
    .vs-select-input:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    .vs-folder-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      margin: 2px 0;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.12s ease;
    }
    .vs-folder-item:hover {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .vs-bulk-dock {
      position: fixed;
      width: 320px;
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 16px 40px rgba(10,31,68,0.24), 0 0 0 1px rgba(10,31,68,0.08);
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      transition: box-shadow 0.15s ease;
    }
    .vs-dock-header {
      padding: 10px 14px;
      background: #0A1F44;
      color: #ffffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
      border-top-left-radius: 14px;
      border-top-right-radius: 14px;
    }
    .vs-dock-list {
      overflow-y: auto;
      max-height: 340px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      scrollbar-width: thin;
      box-sizing: border-box;
    }
    .vs-dock-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 11.5px;
      transition: all 0.12s ease;
    }
    .vs-dock-item:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    @keyframes vsToastSlide {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ========================================================
// DOCUMENT RETRIEVAL ENGINE
// ========================================================
async function blobToBase64(blob) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result || '';
        resolve(res.includes(',') ? res.split(',')[1] : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
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

async function retrieveDocumentBytes(url) {
  if (!url) throw new Error('No URL provided');

  // 1. Data URI
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    if (parts.length < 2) throw new Error('Invalid data URI');
    return parts[1];
  }

  // 2. Blob URL
  if (url.startsWith('blob:')) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const blob = await resp.blob();
        return await blobToBase64(blob);
      }
    } catch (_) {}
  }

  // 3. Delegate to Background Extension Proxy (Bypasses Webpage CSP)
  try {
    const bgResp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_REMOTE_DOCUMENT', url }, resolve);
    });

    if (bgResp && bgResp.ok && bgResp.base64) {
      return bgResp.base64;
    }
  } catch (_) {}

  // 4. In-Page fetch fallback (silent)
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (resp.ok) {
      const cType = (resp.headers.get('content-type') || '').toLowerCase();
      if (!cType.includes('html')) {
        const blob = await resp.blob();
        return await blobToBase64(blob);
      }
    }
  } catch (_) {}

  throw new Error('Unable to retrieve document content from URL.');
}

// ========================================================
// CANDIDATE DETECTOR (PDFs & OFFICE DOCUMENTS)
// ========================================================
function candidates() {
  const found = [];
  const add = (item) => {
    if (!found.some(x => (x.url && x.url === item.url) || (x.controlId && x.controlId === item.controlId) || (x.title === item.title))) {
      found.push(item);
    }
  };

  const sanitizeTitle = title => `${(title || 'document').replace(/[^a-z0-9._ -]/gi, '_')}`;

  const toAbsolute = (url) => {
    if (!url) return '';
    try {
      return new URL(url, location.href).href;
    } catch (_) {
      return url;
    }
  };

  // 1. Current page is a PDF or document
  const isDocPage = document.contentType === 'application/pdf' || 
                    location.pathname.toLowerCase().endsWith('.pdf') || 
                    /\.(pdf|xlsx|xls|csv|docx|doc|zip|json)([?#].*)?$/i.test(location.href) ||
                    /pdf|receipt|ack|challan|computation|return|statement|report|ledger|invoice/i.test(document.title);

  if (isDocPage) {
    const ext = location.pathname.match(/\.(pdf|xlsx|xls|csv|docx|doc|zip|json)$/i)?.[1] || 'pdf';
    add({
      title: document.title || `Current Document (.${ext})`,
      url: location.href,
      kind: 'direct',
      filename: `${sanitizeTitle(document.title || 'document')}.${ext}`
    });
  }

  // 2. Embedded PDF / Document viewers (<embed>, <object>, <iframe>)
  document.querySelectorAll('embed, object, iframe').forEach(el => {
    const rawSrc = el.src || el.data || el.getAttribute('src') || el.getAttribute('data');
    const type = el.type || el.getAttribute('type') || '';
    if (rawSrc && (type.includes('pdf') || /\.pdf([?#].*)?$/i.test(rawSrc) || rawSrc.startsWith('blob:'))) {
      const absUrl = toAbsolute(rawSrc);
      const title = el.title || el.getAttribute('aria-label') || 'Embedded Document Viewer';
      add({
        title: title,
        url: absUrl,
        kind: rawSrc.startsWith('blob:') ? 'blob' : 'embed',
        filename: `${sanitizeTitle(title)}.pdf`
      });
    }
  });

  // 3. Blob URLs from anchors or media
  document.querySelectorAll('a[href^="blob:"], embed[src^="blob:"], object[data^="blob:"], iframe[src^="blob:"]').forEach(el => {
    const url = el.href || el.src || el.data;
    if (url) {
      const text = (el.innerText || el.title || el.getAttribute('aria-label') || 'Generated Document Blob').trim();
      const ext = text.match(/\.(pdf|xlsx|xls|csv|docx|doc|zip|json)$/i)?.[1] || 'pdf';
      add({
        title: text,
        url: url,
        kind: 'blob',
        filename: text.includes('.') ? sanitizeTitle(text) : `${sanitizeTitle(text)}.${ext}`
      });
    }
  });

  // 4. Download / Document links (<a href>)
  const docExtRegex = /\.(pdf|xlsx|xls|csv|docx|doc|zip|json)([?#].*)?$/i;
  document.querySelectorAll('a[href]').forEach(a => {
    const rawHref = a.getAttribute('href') || a.href || '';
    const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim();
    if (docExtRegex.test(rawHref) || (/pdf|download|export|statement|challan|return|ack|receipt|invoice|gstr|itr|26as|ais|tis|form/i.test(text) && /download|pdf|print|export|file|doc|view|get/i.test(rawHref))) {
      const absUrl = toAbsolute(rawHref);
      const ext = rawHref.match(docExtRegex)?.[1] || 'pdf';
      add({
        title: text || `Download Document (.${ext})`,
        url: absUrl,
        kind: 'link',
        filename: text.includes('.') ? sanitizeTitle(text) : `${sanitizeTitle(text || 'document')}.${ext}`
      });
    }
  });

  // 5. Dynamic Download Buttons & Controls
  document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[onclick], div[onclick]').forEach(btn => {
    const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    const hasIcon = Boolean(btn.querySelector('svg, img, [class*="download" i], [class*="pdf" i], [class*="export" i]'));
    if ((/pdf|download|export|gstr|itr|26as|ais|tis|challan|ack|receipt|generate|print/i.test(text) || hasIcon) && text.length > 1 && text.length < 120 && !btn.href) {
      const id = `vs-btn-control-${found.length + 1}`;
      btn.dataset.vsControlId = id;
      add({
        title: text || 'Download Action Button',
        kind: 'button',
        controlId: id,
        filename: `${sanitizeTitle(text || 'filing')}.pdf`
      });
    }
  });

  return found.slice(0, 50);
}

// ========================================================
// API PROXY CALLER FOR IN-PAGE MODALS (CSP OVERRIDE & CACHING)
// ========================================================
let cachedClientsList = null;

function sendBackgroundMsg(msg, timeoutMs = 3500) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) return resolve(null);
      let done = false;
      const t = setTimeout(() => {
        if (!done) { done = true; resolve(null); }
      }, timeoutMs);

      chrome.runtime.sendMessage(msg, (res) => {
        if (!done) {
          done = true;
          clearTimeout(t);
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function apiCall(endpoint, options = {}) {
  // If requesting clients and we have memory cache, return immediately
  if (endpoint === '/api/clients' && Array.isArray(cachedClientsList) && cachedClientsList.length > 0) {
    sendBackgroundMsg({ type: 'VS_API_CALL', url: '/api/clients', method: 'GET' }).then(res => {
      if (res && res.ok && Array.isArray(res.data)) cachedClientsList = res.data;
    });
    return cachedClientsList;
  }

  // 1. Primary: Extension Background Message Proxy (100% exempt from Webpage CSP restrictions on Practive, Motilal Oswal, etc.)
  let res = await sendBackgroundMsg({
    type: 'VS_API_CALL',
    url: endpoint,
    method: options.method || 'GET',
    body: options.body
  }, 4000);

  // If initial attempt failed, wake up worker and retry once
  if (!res || !res.ok) {
    res = await sendBackgroundMsg({
      type: 'VS_API_CALL',
      url: endpoint,
      method: options.method || 'GET',
      body: options.body
    }, 3000);
  }

  if (res && res.ok && res.data !== undefined) {
    if (endpoint === '/api/clients' && Array.isArray(res.data)) {
      cachedClientsList = res.data;
    }
    return res.data;
  }

  // 2. Direct Fallback across active ports
  const candidatePorts = ['8767'];
  for (const port of candidatePorts) {
    try {
      const url = endpoint.startsWith('http') ? endpoint : `http://127.0.0.1:${port}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
      const fetchResp = await fetch(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
      });
      if (fetchResp.ok) {
        const data = await fetchResp.json();
        if (endpoint === '/api/clients' && Array.isArray(data)) {
          cachedClientsList = data;
        }
        return data;
      }
    } catch (_) {}
  }

  if (res && res.error) {
    throw new Error(res.error);
  }
  throw new Error('Unable to connect to VS Database server.');
}

// ========================================================
// BULK DOWNLOAD COLLECTOR STATE & ENGINE
// ========================================================
let bulkQueue = [];
let isBulkMode = false;
let bulkDockPos = null; // { left, top }

// Restore saved dock position from chrome.storage
try {
  chrome.storage.local.get(['vs_bulk_dock_pos'], (res) => {
    if (res && res.vs_bulk_dock_pos) bulkDockPos = res.vs_bulk_dock_pos;
  });
} catch (_) {}

function saveDockPosition(pos) {
  bulkDockPos = pos;
  try { chrome.storage.local.set({ vs_bulk_dock_pos: pos }); } catch (_) {}
}

function showToast(msg) {
  const existing = document.getElementById('vs-floating-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'vs-floating-toast';
  toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(20px) scale(0.95);opacity:0;background:rgba(255,255,255,0.85);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);color:#0A1F44;padding:12px 24px;border-radius:16px;font-size:13px;font-weight:600;box-shadow:0 14px 40px rgba(10,31,68,0.18),0 0 0 1px rgba(226,232,240,0.7);z-index:2147483647;display:flex;align-items:center;gap:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border:1px solid rgba(226,232,240,0.6);transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1),opacity 0.2s ease;max-width:480px;text-align:center;pointer-events:none;';
  toast.innerHTML = `<span style="font-size:18px;flex-shrink:0;">📄</span> <span style="line-height:1.4;">${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    toast.style.opacity = '1';
  });
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.transform = 'translateX(-50%) translateY(16px) scale(0.95)';
      toast.style.opacity = '0';
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 250);
    }
  }, 2800);
}

function splitFileNameAndExt(filename) {
  const str = String(filename || 'document').trim();
  const lastDot = str.lastIndexOf('.');
  if (lastDot > 0 && lastDot < str.length - 1) {
    return {
      baseName: str.substring(0, lastDot),
      ext: str.substring(lastDot).toLowerCase()
    };
  }
  return {
    baseName: str,
    ext: '.pdf'
  };
}

function addToBulkQueue(data) {
  if (window !== window.top) return;
  // Deduplication: skip if same downloadId or same url+filename already in queue
  const isDuplicate = bulkQueue.some(existing =>
    (data.downloadId && existing.downloadId === data.downloadId) ||
    (data.url && existing.url === data.url && existing.originalFilename === data.filename)
  );
  if (isDuplicate) return;

  const id = 'bulk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const parts = splitFileNameAndExt(data.filename || 'document.pdf');
  const item = {
    id,
    filename: `${parts.baseName}${parts.ext}`,
    baseName: parts.baseName,
    fileExt: parts.ext,
    originalFilename: data.filename,
    sourceData: data,
    base64: data.file_base64 || data.fileBase64 || null,
    file_base64: data.file_base64 || data.fileBase64 || null,
    downloadId: data.downloadId,
    url: data.url || '',
    mime: data.mime || 'application/pdf',
    size: data.fileSize || 0
  };
  bulkQueue.push(item);
  isBulkMode = true;
  renderBulkCollectorDock();
  showToast(`Added to Bulk Collector: "${item.filename}" (${bulkQueue.length} total)`);

  // Pre-fetch binary in page context immediately (supports blob:, data:, session cookies)
  if (!item.base64 && item.url) {
    retrieveDocumentBytes(item.url).then(b64 => {
      if (b64) {
        item.base64 = b64;
        item.file_base64 = b64;
      }
    }).catch(() => {});
  }
}

let isRedirectingToWeb = false;
let activeDockDragCleanup = null;

function makeDockDraggable(element, handle) {
  if (!handle || !element) return;

  if (activeDockDragCleanup) {
    try { activeDockDragCleanup(); } catch (_) {}
    activeDockDragCleanup = null;
  }

  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  const onMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    isDragging = true;
    const rect = element.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.left = `${initialLeft}px`;
    element.style.top = `${initialTop}px`;
    handle.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newLeft = Math.max(10, Math.min(window.innerWidth - element.offsetWidth - 10, initialLeft + dx));
    let newTop = Math.max(10, Math.min(window.innerHeight - element.offsetHeight - 10, initialTop + dy));
    
    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;
  };

  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      handle.style.cursor = 'move';
      document.body.style.userSelect = '';
      // Persist final position
      const rect = element.getBoundingClientRect();
      saveDockPosition({ left: rect.left, top: rect.top });
    }
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  activeDockDragCleanup = () => {
    handle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

function showRenameDialog(item, onSave) {
  ensureModalStyles();
  const existing = document.getElementById('vs-rename-modal-dialog');
  if (existing) existing.remove();

  const parts = splitFileNameAndExt(item.filename || `${item.baseName}${item.fileExt}`);
  const overlay = document.createElement('div');
  overlay.id = 'vs-rename-modal-dialog';
  overlay.className = 'vs-inpage-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(10,31,68,0.5);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

  overlay.innerHTML = `
    <div style="background:#ffffff;border-radius:14px;padding:20px 22px;width:min(440px, 92vw);box-shadow:0 24px 56px rgba(10,31,68,0.32);border:1px solid #e2e8f0;display:flex;flex-direction:column;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">✏️</span>
          <strong style="font-size:15px;color:#0A1F44;font-weight:700;">Rename Document</strong>
        </div>
        <button id="vs-rename-close" style="background:none;border:none;font-size:18px;color:#64748b;cursor:pointer;line-height:1;padding:4px;">✕</button>
      </div>

      <p style="font-size:12px;color:#64748b;margin:0 0 14px 0;">
        Enter a new name for this document. The file format (<strong style="color:#0A1F44;">${escapeHtml(parts.ext)}</strong>) is locked and protected.
      </p>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;">
        <input type="text" id="vs-rename-input-box" value="${escapeHtml(parts.baseName)}" placeholder="Document name" style="flex:1;padding:10px 12px;font-size:13px;font-weight:600;color:#0f172a;background:#ffffff;border:1.5px solid #2563eb;border-radius:8px;outline:none;box-sizing:border-box;" />
        <span style="font-size:12px;font-weight:700;color:#334155;background:#e2e8f0;border:1px solid #cbd5e1;padding:10px 14px;border-radius:8px;flex-shrink:0;user-select:none;">
          ${escapeHtml(parts.ext)}
        </span>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" id="vs-rename-cancel-btn" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;cursor:pointer;">
          Cancel
        </button>
        <button type="button" id="vs-rename-save-btn" style="padding:8px 20px;border-radius:8px;font-size:12px;font-weight:700;background:linear-gradient(135deg, #1e40af, #2563eb);color:#ffffff;border:none;cursor:pointer;box-shadow:0 3px 10px rgba(37,99,235,0.35);">
          ✓ Save Name
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector('#vs-rename-input-box');
  const close = () => overlay.remove();

  overlay.querySelector('#vs-rename-close').onclick = close;
  overlay.querySelector('#vs-rename-cancel-btn').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  setTimeout(() => {
    input.focus();
    input.select();
  }, 60);

  const save = () => {
    let newBase = input.value.trim();
    if (!newBase) newBase = parts.baseName || 'document';
    newBase = newBase.replace(/[<>:"/\\|?*]/g, '_');
    if (newBase.toLowerCase().endsWith(parts.ext.toLowerCase())) {
      newBase = newBase.substring(0, newBase.length - parts.ext.length);
    }
    const finalFilename = `${newBase}${parts.ext}`;
    close();
    if (onSave) onSave(newBase, finalFilename);
  };

  overlay.querySelector('#vs-rename-save-btn').onclick = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
}

function renderBulkCollectorDock() {
  ensureModalStyles();
  let dock = document.getElementById('vs-bulk-collector-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'vs-bulk-collector-dock';
    dock.className = 'vs-bulk-dock';
    if (bulkDockPos) {
      dock.style.left = `${bulkDockPos.left}px`;
      dock.style.top = `${bulkDockPos.top}px`;
    } else {
      dock.style.right = '24px';
      dock.style.bottom = '24px';
    }
    document.body.appendChild(dock);
  }

  if (bulkQueue.length === 0) {
    dock.remove();
    isBulkMode = false;
    return;
  }

  const isMinimized = dock.dataset.minimized === 'true';

  dock.innerHTML = `
    <div class="vs-dock-header">
      <div style="display:flex;align-items:center;gap:7px;">
        <span style="font-size:13px;opacity:0.85;">✥</span>
        <strong style="font-size:12px;letter-spacing:-0.01em;">Bulk Collector (${bulkQueue.length})</strong>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <button id="vs-dock-btn-min" title="${isMinimized ? 'Expand' : 'Minimize'}" style="background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;padding:2px 5px;line-height:1;">${isMinimized ? '▲' : '▼'}</button>
        <button id="vs-dock-btn-close" title="Close Bulk Mode" style="background:none;border:none;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px 5px;line-height:1;">✕</button>
      </div>
    </div>

    <div id="vs-dock-body" style="background:#fff;display:${isMinimized ? 'none' : 'flex'};flex-direction:column;">
      <div style="padding:6px 12px 2px 12px;font-size:11px;color:#64748b;display:flex;justify-content:space-between;">
        <span>Collected Files:</span>
        <span style="font-weight:600;color:#0A1F44;">${bulkQueue.length} item${bulkQueue.length === 1 ? '' : 's'}</span>
      </div>

      <div class="vs-dock-list">
        ${bulkQueue.map(item => `
          <div class="vs-dock-item" data-id="${item.id}" style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11.5px;">
            <span style="font-size:14px;flex-shrink:0;">${getFileIcon(item.filename)}</span>
            
            <div style="flex:1;display:flex;align-items:center;gap:4px;overflow:hidden;">
              <span class="vs-dock-filename" data-id="${item.id}" title="${escapeHtml(item.filename)}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b;font-weight:600;cursor:pointer;">
                ${escapeHtml(item.baseName)}<span style="color:#64748b;font-weight:500;">${escapeHtml(item.fileExt)}</span>
              </span>
              <button type="button" class="vs-dock-btn-rename" data-id="${item.id}" title="Rename file" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;border-radius:4px;cursor:pointer;padding:3px 8px;font-size:11px;line-height:1;display:inline-flex;align-items:center;gap:2px;">
                ✏ Edit
              </button>
              <button type="button" class="vs-dock-btn-delete" data-id="${item.id}" title="Remove file" style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:4px;cursor:pointer;padding:3px 6px;font-size:11px;line-height:1;">
                🗑
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="padding:8px 12px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom-left-radius:14px;border-bottom-right-radius:14px;">
        <button id="vs-dock-btn-clear" style="background:none;border:none;color:#dc2626;font-size:11px;font-weight:600;cursor:pointer;padding:4px 6px;" title="Clear all files (Alt+C)">
          <u>C</u>lear All
        </button>
        <button id="vs-dock-btn-done" style="background:linear-gradient(135deg, #1e40af, #2563eb);color:#fff;border:none;padding:7px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(37,99,235,0.35);display:flex;align-items:center;gap:6px;" title="Done & Save Files (Enter or Alt+D)">
          <span>✓ <u>D</u>one (${bulkQueue.length})</span>
          <kbd style="font-size:10px;padding:2px 5px;background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.45);border-radius:3px;color:#fff;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;">(↵ Enter)</kbd>
        </button>
      </div>
    </div>
  `;

  // Attach Bulk Dock Keyboard Shortcut Handler
  const handleDockKeydown = (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
    if (document.getElementById('vs-rename-modal-dialog') || document.getElementById('vs-download-prompt-modal')) return;

    if (e.key === 'Enter' || (e.altKey && e.key.toLowerCase() === 'd')) {
      const doneBtn = dock.querySelector('#vs-dock-btn-done');
      if (doneBtn) {
        e.preventDefault();
        e.stopPropagation();
        doneBtn.click();
      }
    } else if (e.altKey && e.key.toLowerCase() === 'c') {
      const clearBtn = dock.querySelector('#vs-dock-btn-clear');
      if (clearBtn) {
        e.preventDefault();
        e.stopPropagation();
        clearBtn.click();
      }
    }
  };

  if (window.__vsBulkDockKeyHandler) {
    window.removeEventListener('keydown', window.__vsBulkDockKeyHandler, true);
  }
  window.__vsBulkDockKeyHandler = handleDockKeydown;
  window.addEventListener('keydown', window.__vsBulkDockKeyHandler, true);

  // Attach Drag Listener
  const header = dock.querySelector('.vs-dock-header');
  makeDockDraggable(dock, header);

  // Attach Minimize & Close
  dock.querySelector('#vs-dock-btn-min').onclick = () => {
    dock.dataset.minimized = isMinimized ? 'false' : 'true';
    renderBulkCollectorDock();
  };

  dock.querySelector('#vs-dock-btn-close').onclick = () => {
    if (confirm('Close Bulk Collector? Any queued files will be dismissed.')) {
      bulkQueue = [];
      isBulkMode = false;
      dock.remove();
    }
  };

  dock.querySelector('#vs-dock-btn-clear').onclick = () => {
    bulkQueue = [];
    isBulkMode = false;
    dock.remove();
    showToast('Bulk Queue cleared.');
  };

  // Attach Rename Modal Actions
  dock.querySelectorAll('.vs-dock-btn-rename, .vs-dock-filename').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.id;
      const item = bulkQueue.find(x => x.id === id);
      if (!item) return;

      showRenameDialog(item, (newBase, newFullName) => {
        item.baseName = newBase;
        item.filename = newFullName;
        renderBulkCollectorDock();
        showToast(`Renamed to "${newFullName}"`);
      });
    };
  });

  // Attach Delete Action
  dock.querySelectorAll('.vs-dock-btn-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = bulkQueue.findIndex(x => x.id === btn.dataset.id);
      if (idx !== -1) {
        const removed = bulkQueue.splice(idx, 1)[0];
        renderBulkCollectorDock();
        showToast(`Removed "${removed.filename}"`);
      }
    };
  });

  // Attach Done Action -> Open Bulk Filing in VS Database Desktop App
  dock.querySelector('#vs-dock-btn-done').onclick = async () => {
    if (isRedirectingToWeb) return;
    isRedirectingToWeb = true;
    setTimeout(() => { isRedirectingToWeb = false; }, 2500);

    const filesToSave = [...bulkQueue];
    bulkQueue = [];
    isBulkMode = false;
    dock.remove();

    // Send lightweight metadata only (zero Base64 in JS memory)
    const lightweightFiles = filesToSave.map(f => ({
      download_id: f.downloadId || f.sourceData?.downloadId || null,
      downloadId: f.downloadId || f.sourceData?.downloadId || null,
      id: f.id,
      filename: f.filename,
      baseName: f.baseName,
      fileExt: f.fileExt,
      url: f.url,
      mime: f.mime,
      size: f.size,
      file_base64: f.file_base64 || f.base64 || null,
      base64: f.file_base64 || f.base64 || null
    }));

    // Persist lightweight metadata in storage for service worker recovery
    try {
      await chrome.storage.local.set({
        bulk_pending_files: lightweightFiles,
        bulk_mode: true
      });
    } catch (err) {
      console.warn('Could not save bulk metadata to chrome.storage.local:', err);
    }

    // Direct lightweight IPC message to background service worker
    chrome.runtime.sendMessage({
      type: 'OPEN_WEBSITE_FOR_BULK_SAVE',
      files: lightweightFiles,
      use_stored_files: true
    }).catch(() => {});

    showToast(`⚡ Sending ${filesToSave.length} file(s) to VS Database Desktop App...`);
  };
}

// Bulk Save In-Page Workspace
async function showInPageBulkFilingModal(files) {
  if (!files || !files.length) return;
  ensureModalStyles();
  const existing = document.getElementById('vs-inpage-filing-modal');
  if (existing) existing.remove();

  const logoUrl = chrome.runtime.getURL('monogram.png');
  const overlay = document.createElement('div');
  overlay.id = 'vs-inpage-filing-modal';
  overlay.className = 'vs-inpage-overlay';

  overlay.innerHTML = `
    <div class="vs-inpage-dialog" style="width:min(580px, 94vw);">
      <button id="vs-modal-close" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:20px;color:#64748b;cursor:pointer;">×</button>
      
      <div class="vs-inpage-header">
        <img src="${logoUrl}" style="width:44px;height:44px;object-fit:contain;border-radius:50%;box-shadow:0 4px 14px rgba(10,31,68,0.18);border:1.5px solid #e2e8f0;background:#ffffff;padding:2px;flex-shrink:0;" alt="VS">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#0A1F44;">Bulk Save to VS Database</h3>
          <p style="margin:2px 0 0 0;font-size:11px;color:#64748b;">Select Client & Destination for ${files.length} documents</p>
        </div>
      </div>

      <!-- BULK FILES LIST PREVIEW (WITH LOCKED FORMAT EXTENSIONS) -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px;margin-top:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:11px;font-weight:700;color:#334155;">
          <span>Queued Documents (${files.length}) — Edit names if needed:</span>
          <span style="font-size:10px;color:#166534;font-weight:600;">✓ Ready to File</span>
        </div>
        <div style="max-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin;">
          ${files.map((f, i) => {
            const parts = splitFileNameAndExt(f.filename);
            return `
              <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:#1e293b;background:#fff;padding:5px 8px;border-radius:6px;border:1px solid #e2e8f0;">
                <span style="font-size:14px;flex-shrink:0;">${getFileIcon(f.filename)}</span>
                <input type="text" class="vs-bulk-modal-docname" data-idx="${i}" data-ext="${escapeHtml(parts.ext)}" value="${escapeHtml(parts.baseName)}" title="Edit filename" style="flex:1;font-size:11.5px;font-weight:600;padding:3px 6px;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc;color:#0f172a;outline:none;" />
                <span style="font-size:10px;font-weight:700;color:#475569;background:#e2e8f0;padding:3px 6px;border-radius:4px;flex-shrink:0;">${escapeHtml(parts.ext)}</span>
                <span style="font-size:10px;color:#64748b;flex-shrink:0;">${f.size ? formatBytes(f.size) : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div id="vs-inpage-form">
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:3px;">Select Client *</label>
          <input type="text" id="vs-bulk-client-search" class="vs-select-input" placeholder="🔍 Search client by name or file no..." style="margin-bottom:6px;padding:6px 8px;font-size:11px;" />
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
            <select id="vs-client-select" class="vs-select-input">
              <option value="">Loading clients...</option>
            </select>
            <select id="vs-storage-select" class="vs-select-input">
              <option value="local">Local Storage</option>
              <option value="drive">Google Drive</option>
            </select>
          </div>
        </div>

        <!-- DIRECT DESTINATION FOLDER NAVIGATOR (EXACT WEBSITE MODULE) -->
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-size:11px;font-weight:700;color:#475569;">Destination Folder *</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <span id="vs-selected-folder-label" style="font-size:10.5px;font-weight:700;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:6px;">/ (Client Root)</span>
              <button id="vs-btn-reset-folder" type="button" style="font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;font-weight:700;display:none;">Reset</button>
            </div>
          </div>

          <div id="vs-tree-nav-box" style="margin-top:6px;border:1px solid #cbd5e1;border-radius:12px;padding:8px;background:#fff;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;align-items:center;gap:4px;overflow:hidden;flex:1;">
                <button id="vs-nav-up" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;" disabled>⬆ Up</button>
                <button id="vs-nav-root" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;">🏠 Root</button>
                <span id="vs-nav-crumb" style="font-size:11px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">/ (Client Root)</span>
              </div>
              <button id="vs-nav-select" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:#2563eb;color:#fff;border:0;cursor:pointer;white-space:nowrap;">✓ Use Folder</button>
            </div>
            <div id="vs-tree-items" style="max-height:150px;overflow-y:auto;">
              <div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">Select a client above to browse folders</div>
            </div>
          </div>
        </div>

        <div id="vs-status-msg" style="margin-bottom:10px;font-size:11px;"></div>

        <div class="vs-btn-group">
          <button class="vs-btn" id="vs-btn-cancel">Cancel</button>
          <button class="vs-btn primary" id="vs-btn-save-all">💾 Save All (${files.length}) Documents</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  WebsiteIsolationGuard.block(overlay);

  const close = () => {
    WebsiteIsolationGuard.unblock();
    overlay.remove();
  };
  overlay.querySelector('#vs-modal-close').onclick = close;
  overlay.querySelector('#vs-btn-cancel').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  const clientSearchInput = overlay.querySelector('#vs-bulk-client-search');
  const clientSelect = overlay.querySelector('#vs-client-select');
  const statusMsg = overlay.querySelector('#vs-status-msg');
  const saveBtn = overlay.querySelector('#vs-btn-save-all');
  const selectedFolderLabel = overlay.querySelector('#vs-selected-folder-label');
  const treeItemsBox = overlay.querySelector('#vs-tree-items');
  const navCrumb = overlay.querySelector('#vs-nav-crumb');
  const navUpBtn = overlay.querySelector('#vs-nav-up');
  const navRootBtn = overlay.querySelector('#vs-nav-root');
  const navSelectBtn = overlay.querySelector('#vs-nav-select');
  const resetFolderBtn = overlay.querySelector('#vs-btn-reset-folder');

  let selectedTargetFolder = '';
  let currentNavPath = '';
  let fullClientTree = [];
  let loadedClients = [];

  function updateFolderDisplay() {
    if (selectedTargetFolder) {
      selectedFolderLabel.textContent = '/' + selectedTargetFolder;
      selectedFolderLabel.style.color = '#2563eb';
      selectedFolderLabel.style.background = '#eff6ff';
      resetFolderBtn.style.display = 'inline-block';
    } else {
      selectedFolderLabel.textContent = '/ (Client Root)';
      selectedFolderLabel.style.color = '#1e40af';
      selectedFolderLabel.style.background = '#f1f5f9';
      resetFolderBtn.style.display = 'none';
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

  function renderNavLevel() {
    navCrumb.textContent = currentNavPath ? `/${currentNavPath}` : '/ (Client Root)';
    navUpBtn.disabled = !currentNavPath;

    if (!clientSelect.value) {
      treeItemsBox.innerHTML = '<div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">Select a client above to browse folders</div>';
      return;
    }

    const node = findSubNode(fullClientTree, currentNavPath);
    const folders = (node && node.children) ? node.children.filter(n => n.type === 'folder') : [];

    if (folders.length === 0) {
      treeItemsBox.innerHTML = `
        <div style="padding:12px;font-size:11px;color:#64748b;text-align:center;">
          No subfolders here.<br>
          <button type="button" id="vs-bulk-empty-use-btn" style="margin-top:6px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px;background:#2563eb;color:#fff;border:0;cursor:pointer;">
            ✓ Use ${escapeHtml(currentNavPath ? '/' + currentNavPath : 'Client Root')}
          </button>
        </div>
      `;
      const emptyBtn = treeItemsBox.querySelector('#vs-bulk-empty-use-btn');
      if (emptyBtn) {
        emptyBtn.onclick = () => {
          selectedTargetFolder = currentNavPath;
          updateFolderDisplay();
          renderNavLevel();
        };
      }
      return;
    }

    treeItemsBox.innerHTML = folders.map(f => {
      const subCount = (f.children && Array.isArray(f.children)) ? f.children.filter(n => n.type === 'folder').length : 0;
      const itemPath = currentNavPath ? `${currentNavPath}/${f.name}` : f.name;
      const isSelected = selectedTargetFolder === itemPath;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin:2px 0;border-radius:8px;background:${isSelected ? '#eff6ff' : '#ffffff'};border:1px solid ${isSelected ? '#3b82f6' : '#e2e8f0'};font-size:11px;">
          <div class="vs-folder-name-btn" data-path="${escapeHtml(itemPath)}" style="cursor:pointer;flex:1;display:flex;align-items:center;gap:5px;overflow:hidden;margin-right:6px;">
            <span>📁</span>
            <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0f172a;">${escapeHtml(f.name)}</strong>
            ${subCount > 0 ? `<small style="color:#64748b;font-weight:600;">(${subCount})</small>` : ''}
            ${isSelected ? `<span style="color:#2563eb;font-weight:700;font-size:9.5px;">✓</span>` : ''}
          </div>
          <div style="display:flex;gap:3px;flex-shrink:0;">
            <button type="button" class="vs-btn vs-folder-select-btn" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 7px;background:${isSelected ? '#2563eb' : '#fff'};color:${isSelected ? '#fff' : 'inherit'};font-weight:700;">Select</button>
            ${subCount > 0 ? `<button type="button" class="vs-btn vs-folder-open-btn" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 6px;">›</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    treeItemsBox.querySelectorAll('.vs-folder-select-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        selectedTargetFolder = btn.getAttribute('data-path') || '';
        updateFolderDisplay();
        renderNavLevel();
      };
    });

    treeItemsBox.querySelectorAll('.vs-folder-open-btn, .vs-folder-name-btn').forEach(el => {
      el.onclick = () => {
        currentNavPath = el.getAttribute('data-path') || '';
        selectedTargetFolder = currentNavPath;
        updateFolderDisplay();
        renderNavLevel();
      };
    });
  }

  navUpBtn.onclick = () => {
    if (!currentNavPath) return;
    const parts = currentNavPath.split('/');
    parts.pop();
    currentNavPath = parts.join('/');
    selectedTargetFolder = currentNavPath;
    updateFolderDisplay();
    renderNavLevel();
  };

  navRootBtn.onclick = () => {
    currentNavPath = '';
    selectedTargetFolder = '';
    updateFolderDisplay();
    renderNavLevel();
  };

  navSelectBtn.onclick = () => {
    selectedTargetFolder = currentNavPath;
    updateFolderDisplay();
    renderNavLevel();
  };

  resetFolderBtn.onclick = () => {
    selectedTargetFolder = '';
    currentNavPath = '';
    updateFolderDisplay();
    renderNavLevel();
  };

  async function loadClientTreeForFno(fno) {
    if (!fno) {
      fullClientTree = [];
      currentNavPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderNavLevel();
      return;
    }
    treeItemsBox.innerHTML = '<div style="padding:10px;font-size:11px;color:#2563eb;text-align:center;">Loading folder structure... ⏳</div>';
    try {
      const storageKind = overlay.querySelector('#vs-storage-select').value;
      const res = await apiCall(`/api/client-folders/${encodeURIComponent(fno)}/tree?storage_kind=${storageKind}`);
      fullClientTree = res?.tree || [];
      currentNavPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderNavLevel();
    } catch (err) {
      fullClientTree = [];
      treeItemsBox.innerHTML = `<div style="padding:10px;font-size:11px;color:#dc2626;text-align:center;">Could not load folder tree: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderClientOptions(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = loadedClients.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.file_no || '').toLowerCase().includes(q));
    clientSelect.innerHTML = '<option value="">Select a Client...</option>' +
      filtered.map(c => `<option value="${escapeHtml(c.file_no)}">${escapeHtml(c.name)} (${escapeHtml(c.file_no)})</option>`).join('');
  }

  // Populate client dropdown
  try {
    const clients = await apiCall('/api/clients');
    loadedClients = Array.isArray(clients) ? clients : [];
    renderClientOptions();
  } catch (err) {
    clientSelect.innerHTML = `<option value="">Error loading clients: ${escapeHtml(err.message)}</option>`;
  }

  clientSearchInput.oninput = (e) => {
    renderClientOptions(e.target.value);
  };

  clientSelect.onchange = () => {
    loadClientTreeForFno(clientSelect.value);
  };

  overlay.querySelector('#vs-storage-select').onchange = () => {
    if (clientSelect.value) loadClientTreeForFno(clientSelect.value);
  };

  // Bulk Save Execution
  saveBtn.onclick = async () => {
    const fno = clientSelect.value;
    if (!fno) {
      statusMsg.innerHTML = '<span style="color:#dc2626;font-weight:600;">Please select a client first.</span>';
      return;
    }

    const storageKind = overlay.querySelector('#vs-storage-select').value;
    saveBtn.disabled = true;

    try {
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const nameInput = overlay.querySelector(`.vs-bulk-modal-docname[data-idx="${i}"]`);
        const parts = splitFileNameAndExt(item.filename);
        let baseName = nameInput ? nameInput.value.trim() : parts.baseName;
        if (!baseName) baseName = parts.baseName || 'document';
        baseName = baseName.replace(/[<>:"/\\|?*]/g, '_');
        if (baseName.toLowerCase().endsWith(parts.ext.toLowerCase())) {
          baseName = baseName.substring(0, baseName.length - parts.ext.length);
        }
        const docName = `${baseName}${parts.ext}`;

        saveBtn.textContent = `Saving ${i + 1} of ${files.length}...`;
        statusMsg.innerHTML = `<span style="color:#2563eb;font-weight:600;">⚡ Saving (${i + 1}/${files.length}): "${escapeHtml(docName)}"...</span>`;

        let fileBase64 = item.base64;
        if (!fileBase64 && item.sourceData && item.sourceData.url) {
          try {
            fileBase64 = await retrieveDocumentBytes(item.sourceData.url);
          } catch (_) {}
        }

        let docPeriod = 'AY 2025-26';
        if (selectedTargetFolder) {
          const match = selectedTargetFolder.match(/\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b/i);
          if (match) docPeriod = match[0];
        }

        const payload = {
          client_file_no: fno,
          document_name: docName,
          file_base64: fileBase64,
          save_local: storageKind === 'local',
          save_drive: storageKind === 'drive',
          service: 'General',
          period: docPeriod
        };

        if (selectedTargetFolder) {
          payload.target_folder = selectedTargetFolder;
          payload.relative_path = selectedTargetFolder;
        }

        if (!fileBase64) {
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: 'PROCESS_SAVE_SYNC',
              job: {
                client_file_no: fno,
                document_name: docName,
                source_url: item.sourceData?.url || '',
                downloadId: item.downloadId,
                mime: item.mime,
                fileSize: item.size,
                target_folder: selectedTargetFolder,
                save_local: storageKind === 'local',
                save_drive: storageKind === 'drive',
                service: 'General',
                period: docPeriod
              }
            }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (!res || !res.ok) {
                reject(new Error(res?.error || 'Save failed'));
              } else {
                resolve(res.data);
              }
            });
          });
        } else {
          await apiCall('/api/save-document', {
            method: 'POST',
            body: payload
          });
        }
      }

      statusMsg.innerHTML = `<span style="color:#166534;font-weight:700;">✓ Successfully saved all ${files.length} documents into "${escapeHtml(selectedTargetFolder ? '/' + selectedTargetFolder : '/ (Client Root)')}"!</span>`;
      saveBtn.textContent = `✓ All ${files.length} Saved`;
      await wait(1200);
      close();
    } catch (err) {
      statusMsg.innerHTML = `<span style="color:#dc2626;font-weight:600;">Error: ${escapeHtml(err.message)}</span>`;
      saveBtn.disabled = false;
      saveBtn.textContent = `💾 Save All (${files.length}) Documents`;
    }
  };
}

// ========================================================
// IN-PAGE DOWNLOAD INTERCEPT PROMPT & FILING SAVER
// ========================================================
function showDownloadPrompt(data) {
  if (window !== window.top) return;
  // If Bulk Mode is currently active, directly auto-collect into Bulk Queue!
  if (isBulkMode) {
    addToBulkQueue(data);
    chrome.runtime.sendMessage({
      type: 'VS_DOWNLOAD_DECISION',
      decision: 'yes',
      downloadId: data.downloadId,
      filename: data.filename,
      url: data.url,
      mime: data.mime,
      fileSize: data.fileSize
    });
    return;
  }

  ensureModalStyles();
  const existing = document.getElementById('vs-download-prompt-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vs-download-prompt-modal';
  overlay.className = 'vs-inpage-overlay';

  const icon = getFileIcon(data.filename);
  const sizeStr = data.fileSize ? formatBytes(data.fileSize) : 'Ready to save';
  const logoUrl = chrome.runtime.getURL('monogram.png');

  overlay.innerHTML = `
    <div class="vs-inpage-dialog">
      <div class="vs-inpage-header">
        <img src="${logoUrl}" style="width:44px;height:44px;object-fit:contain;border-radius:50%;box-shadow:0 4px 14px rgba(10,31,68,0.18);border:1.5px solid #e2e8f0;background:#ffffff;padding:2px;flex-shrink:0;" alt="VS">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#0A1F44;">New File Detected</h3>
          <p style="margin:2px 0 0 0;font-size:11px;color:#64748b;">Store this document directly on VS Database?</p>
        </div>
      </div>

      <div class="vs-file-card">
        <div class="vs-file-icon">${icon}</div>
        <div style="flex:1;overflow:hidden;">
          <strong style="display:block;font-size:13px;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(data.filename)}
          </strong>
          <span style="font-size:11px;color:#64748b;">${sizeStr} &nbsp;•&nbsp; Source: ${escapeHtml(location.hostname)}</span>
        </div>
      </div>

      <div class="vs-btn-group" style="display:flex;gap:8px;align-items:center;margin-top:16px;">
        <button class="vs-btn" id="vs-prompt-btn-no" style="flex:1;" title="Ignore download (Esc or Alt+I)">
          <span>✕ <u>I</u>gnore</span>
          <kbd style="margin-left:4px;font-size:10.5px;padding:2px 5px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#475569;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;">Esc</kbd>
        </button>
        <button class="vs-btn" id="vs-prompt-btn-bulk" style="flex:1.2;background:#fef3c7;border:1.5px solid #fde68a;color:#92400e;font-weight:700;" title="Queue in bulk collector (B or Alt+B)">
          <span>📦 <u>B</u>ulk Save</span>
          <kbd style="margin-left:4px;font-size:10.5px;padding:2px 5px;background:#fde68a;border:1px solid #f59e0b;border-radius:4px;color:#78350f;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;">(B)</kbd>
        </button>
        <button class="vs-btn primary" id="vs-prompt-btn-yes" style="flex:1.4;" title="Save document to VS Database (Enter or Alt+S)">
          <span>💾 <u>S</u>ave</span>
          <kbd style="margin-left:4px;font-size:10.5px;padding:2px 6px;background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.45);border-radius:4px;color:#ffffff;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;">(↵ Enter)</kbd>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  WebsiteIsolationGuard.block(overlay);

  const noBtn = overlay.querySelector('#vs-prompt-btn-no');
  const bulkBtn = overlay.querySelector('#vs-prompt-btn-bulk');
  const yesBtn = overlay.querySelector('#vs-prompt-btn-yes');

  const cleanupKeydown = () => {
    window.removeEventListener('keydown', handleKeydown, true);
  };

  const handleNo = (e) => {
    if (e) e.stopPropagation();
    cleanupKeydown();
    WebsiteIsolationGuard.unblock();
    overlay.remove();
    chrome.runtime.sendMessage({
      type: 'VS_DOWNLOAD_DECISION',
      decision: 'no',
      downloadId: data.downloadId
    });
  };

  const handleBulk = (e) => {
    if (e) e.stopPropagation();
    cleanupKeydown();
    WebsiteIsolationGuard.unblock();
    overlay.remove();
    chrome.runtime.sendMessage({
      type: 'VS_DOWNLOAD_DECISION',
      decision: 'bulk',
      downloadId: data.downloadId,
      filename: data.filename,
      url: data.url,
      mime: data.mime,
      fileSize: data.fileSize,
      file_base64: data.file_base64 || data.fileBase64 || null
    });
    addToBulkQueue(data);
    showToast(`📦 Bulk mode active. "${data.filename}" added to queue.`);
  };

  const handleYes = async (e) => {
    if (e) e.stopPropagation();
    cleanupKeydown();
    WebsiteIsolationGuard.unblock();
    overlay.remove();

    if (isRedirectingToWeb) return;
    isRedirectingToWeb = true;
    setTimeout(() => { isRedirectingToWeb = false; }, 2500);

    // Pre-fetch binary in page context immediately (supports blob:, data:, session cookies)
    let b64 = data.file_base64 || data.fileBase64 || null;
    if (!b64 && data.url) {
      try {
        b64 = await retrieveDocumentBytes(data.url);
      } catch (_) {}
    }
    if (b64) {
      data.file_base64 = b64;
    }

    const detObj = {
      downloadId: data.downloadId,
      id: data.downloadId || `file_${Date.now()}`,
      filename: data.filename || 'document.pdf',
      source_url: data.url || '',
      url: data.url || '',
      mime: data.mime || 'application/pdf',
      file_type: data.mime || 'application/pdf',
      fileSize: data.fileSize || 0,
      file_base64: b64,
      base64: b64,
      timestamp: Date.now()
    };

    try {
      await chrome.storage.local.set({
        latest_download_detected: detObj,
        pending_detected_file: detObj
      });
    } catch (_) {}

    chrome.runtime.sendMessage({
      type: 'VS_DOWNLOAD_DECISION',
      decision: 'yes',
      downloadId: data.downloadId,
      filename: data.filename,
      url: data.url,
      mime: data.mime,
      fileSize: data.fileSize,
      file_base64: b64,
      use_stored_file: true
    }).catch(() => {});

    // Approach 2: Redirect directly to VS Database Desktop App
    chrome.runtime.sendMessage({
      type: 'OPEN_WEBSITE_FOR_SAVE',
      file: detObj,
      base64: b64,
      use_stored_file: false
    }).catch(() => {});

    showToast(`⚡ Sent to VS Database Desktop App!`);
  };

  const handleKeydown = (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
    const key = e.key.toLowerCase();

    if (e.key === 'Enter' || key === 's' || (e.altKey && key === 's')) {
      e.preventDefault();
      e.stopPropagation();
      handleYes();
    } else if (key === 'b' || (e.altKey && key === 'b')) {
      e.preventDefault();
      e.stopPropagation();
      handleBulk();
    } else if (e.key === 'Escape' || key === 'i' || (e.altKey && key === 'i')) {
      e.preventDefault();
      e.stopPropagation();
      handleNo();
    }
  };

  window.addEventListener('keydown', handleKeydown, true);

  if (noBtn) {
    noBtn.onclick = handleNo;
    noBtn.addEventListener('click', handleNo);
  }
  if (bulkBtn) {
    bulkBtn.onclick = handleBulk;
    bulkBtn.addEventListener('click', handleBulk);
  }
  if (yesBtn) {
    yesBtn.onclick = handleYes;
    yesBtn.addEventListener('click', handleYes);
  }
}

// In-Page Single Filing Saver Workspace
async function showInPageFilingModal(filename, sourceData, mimeType) {
  ensureModalStyles();
  const existing = document.getElementById('vs-inpage-filing-modal');
  if (existing) existing.remove();

  const logoUrl = chrome.runtime.getURL('monogram.png');

  // Handle string base64 or source metadata object
  let capturedBase64 = null;
  let sourceUrl = '';
  let downloadId = null;
  let itemMime = mimeType || 'application/pdf';
  let itemSize = 0;

  if (typeof sourceData === 'string') {
    capturedBase64 = sourceData;
  } else if (sourceData && typeof sourceData === 'object') {
    capturedBase64 = sourceData.file_base64 || sourceData.fileBase64 || null;
    sourceUrl = sourceData.url || sourceData.source_url || '';
    downloadId = sourceData.downloadId || sourceData.id || null;
    itemMime = sourceData.mime || sourceData.file_type || mimeType || 'application/pdf';
    itemSize = sourceData.fileSize || sourceData.file_size || 0;
  }

  let isCapturing = !capturedBase64;
  let isPdfEncrypted = false;
  let clientSavedPasswords = [];

  const isPdf = filename.toLowerCase().endsWith('.pdf');

  const overlay = document.createElement('div');
  overlay.id = 'vs-inpage-filing-modal';
  overlay.className = 'vs-inpage-overlay';

  overlay.innerHTML = `
    <div class="vs-inpage-dialog" style="width:min(580px, 94vw);">
      <button id="vs-modal-close" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:20px;color:#64748b;cursor:pointer;">×</button>
      
      <div class="vs-inpage-header">
        <img src="${logoUrl}" style="width:44px;height:44px;object-fit:contain;border-radius:50%;box-shadow:0 4px 14px rgba(10,31,68,0.18);border:1.5px solid #e2e8f0;background:#ffffff;padding:2px;flex-shrink:0;" alt="VS">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#0A1F44;">Save to VS Database</h3>
          <p style="margin:2px 0 0 0;font-size:11px;color:#64748b;">Select Client & Destination Folder</p>
        </div>
      </div>

      <div class="vs-file-card" style="margin-top:8px;margin-bottom:12px;">
        <div class="vs-file-icon">${getFileIcon(filename)}</div>
        <div style="flex:1;overflow:hidden;">
          <strong style="display:block;font-size:13px;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(filename)}
          </strong>
          <div id="vs-file-capture-tag" style="margin-top:2px;">
            ${isCapturing 
              ? '<span class="vs-capturing-pulse" style="font-size:11px;color:#2563eb;font-weight:600;">⚡ Capturing file in background...</span>' 
              : '<span style="font-size:11px;color:#166534;font-weight:600;">✓ Captured and ready to file</span>'}
          </div>
        </div>
      </div>

      <!-- DYNAMIC PDF SECURITY WIDGET -->
      ${isPdf ? `
        <div id="vs-pdf-sec-box" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;" id="vs-pdf-sec-status-wrap">
              <span id="vs-pdf-sec-icon">🔓</span>
              <span id="vs-pdf-sec-label" style="color:#166534;">Unencrypted PDF</span>
            </div>
            <button type="button" class="vs-btn" id="vs-btn-toggle-sec" style="font-size:11px;padding:4px 10px;min-height:auto;border-color:#cbd5e1;background:#fff;color:#0f172a;">🔒 Lock PDF</button>
          </div>

          <!-- INLINE LOCK FORM -->
          <div id="vs-inpage-lock-form" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
              <div>
                <label style="font-size:10px;font-weight:700;color:#475569;display:block;margin-bottom:2px;">Password *</label>
                <input type="password" id="vs-lock-pw" class="vs-select-input" style="padding:6px 8px;font-size:11px;" placeholder="Password">
              </div>
              <div>
                <label style="font-size:10px;font-weight:700;color:#475569;display:block;margin-bottom:2px;">Confirm Password *</label>
                <input type="password" id="vs-lock-confirm-pw" class="vs-select-input" style="padding:6px 8px;font-size:11px;" placeholder="Confirm">
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;color:#475569;">
                <input type="checkbox" id="vs-lock-remember" checked> Remember for this client
              </label>
              <input type="text" id="vs-lock-label" class="vs-select-input" style="width:140px;padding:4px 6px;font-size:10px;" value="General PDF" placeholder="Label">
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button type="button" class="vs-btn" id="vs-btn-cancel-lock" style="font-size:10px;padding:3px 8px;min-height:auto;">Cancel</button>
              <button type="button" class="vs-btn primary" id="vs-btn-apply-lock" style="font-size:10px;padding:3px 10px;min-height:auto;background:#dc2626;border-color:#b91c1c;">Encrypt & Lock</button>
            </div>
          </div>

          <!-- INLINE UNLOCK FORM -->
          <div id="vs-inpage-unlock-form" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;">
            <div id="vs-inpage-saved-pwd-wrap" style="display:none;margin-bottom:6px;">
              <label style="font-size:10px;font-weight:700;color:#475569;display:block;margin-bottom:2px;">Client Saved Passwords:</label>
              <select id="vs-inpage-saved-pwd-select" class="vs-select-input" style="padding:6px 8px;font-size:11px;margin-bottom:6px;"></select>
            </div>
            <div style="margin-bottom:6px;">
              <label style="font-size:10px;font-weight:700;color:#475569;display:block;margin-bottom:2px;">Password</label>
              <input type="password" id="vs-unlock-pw" class="vs-select-input" style="padding:6px 8px;font-size:11px;" placeholder="Enter PDF password">
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button type="button" class="vs-btn" id="vs-btn-cancel-unlock" style="font-size:10px;padding:3px 8px;min-height:auto;">Cancel</button>
              <button type="button" class="vs-btn" id="vs-btn-inpage-auto-try" style="font-size:10px;padding:3px 8px;min-height:auto;display:none;background:#fef3c7;border-color:#fde68a;color:#92400e;">⚡ Try Saved</button>
              <button type="button" class="vs-btn primary" id="vs-btn-apply-unlock" style="font-size:10px;padding:3px 10px;min-height:auto;background:#16a34a;border-color:#15803d;">Decrypt PDF</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div id="vs-inpage-form">
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:3px;">Select Client *</label>
          <input type="text" id="vs-single-client-search" class="vs-select-input" placeholder="🔍 Search client by name or file no..." style="margin-bottom:6px;padding:6px 8px;font-size:11px;" />
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
            <select id="vs-client-select" class="vs-select-input">
              <option value="">Loading clients...</option>
            </select>
            <select id="vs-storage-select" class="vs-select-input">
              <option value="local">Local Storage</option>
              <option value="drive">Google Drive</option>
            </select>
          </div>
        </div>

        <!-- DIRECT DESTINATION FOLDER NAVIGATOR (EXACT WEBSITE MODULE) -->
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-size:11px;font-weight:700;color:#475569;">Destination Folder *</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <span id="vs-selected-folder-label" style="font-size:10.5px;font-weight:700;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:6px;">/ (Client Root)</span>
              <button id="vs-btn-reset-folder" type="button" style="font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;font-weight:700;display:none;">Reset</button>
            </div>
          </div>

          <div id="vs-tree-nav-box" style="margin-top:6px;border:1px solid #cbd5e1;border-radius:12px;padding:8px;background:#fff;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;align-items:center;gap:4px;overflow:hidden;flex:1;">
                <button id="vs-nav-up" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;" disabled>⬆ Up</button>
                <button id="vs-nav-root" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;">🏠 Root</button>
                <span id="vs-nav-crumb" style="font-size:11px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">/ (Client Root)</span>
              </div>
              <button id="vs-nav-select" type="button" style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:#2563eb;color:#fff;border:0;cursor:pointer;white-space:nowrap;">✓ Use Folder</button>
            </div>
            <div id="vs-tree-items" style="max-height:160px;overflow-y:auto;">
              <div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">Select a client above to browse folders</div>
            </div>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <label style="font-size:11px;font-weight:700;color:#475569;">Document Name</label>
          <input id="vs-doc-name" class="vs-select-input" value="${escapeHtml(filename)}">
        </div>

        <div id="vs-status-msg" style="margin-bottom:10px;font-size:11px;"></div>

        <div class="vs-btn-group">
          <button class="vs-btn" id="vs-btn-cancel">Cancel</button>
          <button class="vs-btn primary" id="vs-btn-save-file">💾 Save File to Database</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  WebsiteIsolationGuard.block(overlay);

  const captureTag = overlay.querySelector('#vs-file-capture-tag');
  const secBox = overlay.querySelector('#vs-pdf-sec-box');
  const secIcon = overlay.querySelector('#vs-pdf-sec-icon');
  const secLabel = overlay.querySelector('#vs-pdf-sec-label');
  const toggleSecBtn = overlay.querySelector('#vs-btn-toggle-sec');
  const lockForm = overlay.querySelector('#vs-inpage-lock-form');
  const unlockForm = overlay.querySelector('#vs-inpage-unlock-form');

  function updatePdfUiState() {
    if (!isPdf || !secIcon) return;
    if (isPdfEncrypted) {
      secIcon.textContent = '🔒';
      secLabel.textContent = 'Password-Protected PDF';
      secLabel.style.color = '#991b1b';
      secBox.style.background = '#fef2f2';
      secBox.style.borderColor = '#fecaca';
      toggleSecBtn.textContent = '🔓 Unlock PDF';
      toggleSecBtn.style.color = '#991b1b';
      toggleSecBtn.style.borderColor = '#fca5a5';
    } else {
      secIcon.textContent = '🔓';
      secLabel.textContent = 'Unencrypted PDF';
      secLabel.style.color = '#166534';
      secBox.style.background = '#f8fafc';
      secBox.style.borderColor = '#e2e8f0';
      toggleSecBtn.textContent = '🔒 Lock PDF';
      toggleSecBtn.style.color = '#0f172a';
      toggleSecBtn.style.borderColor = '#cbd5e1';
    }
  }

  async function checkAndAutoUnlockPdf(b64, clientFno) {
    if (!isPdf || !b64) return b64;
    try {
      const detect = await apiCall('/api/pdf/detect', { method: 'POST', body: { client_file_no: clientFno, file_base64: b64 } });
      if (detect && detect.is_encrypted) {
        isPdfEncrypted = true;
        updatePdfUiState();
        try {
          const unlockRes = await apiCall('/api/pdf/unlock', { method: 'POST', body: { client_file_no: clientFno, file_base64: b64, auto_try_saved: true } });
          if (unlockRes && unlockRes.output_base64) {
            isPdfEncrypted = false;
            updatePdfUiState();
            if (captureTag) captureTag.innerHTML = `<span style="font-size:11px;color:#166534;font-weight:600;">✓ Auto-unlocked with saved password (${unlockRes.matched_credential_label || 'Decrypted'})</span>`;
            return unlockRes.output_base64;
          }
        } catch (e) {
          isPdfEncrypted = true;
          updatePdfUiState();
        }
      } else {
        isPdfEncrypted = false;
        updatePdfUiState();
      }
    } catch (e) {}
    return b64;
  }

  async function loadClientPasswordsForInPage(fno) {
    if (!fno || !isPdf) return;
    try {
      const creds = await apiCall(`/api/clients/${encodeURIComponent(fno)}/pdf-passwords`);
      clientSavedPasswords = creds || [];
      const wrap = overlay.querySelector('#vs-inpage-saved-pwd-wrap');
      const select = overlay.querySelector('#vs-inpage-saved-pwd-select');
      const autoTry = overlay.querySelector('#vs-btn-inpage-auto-try');

      if (wrap && select && clientSavedPasswords.length > 0) {
        wrap.style.display = 'block';
        if (autoTry) autoTry.style.display = 'inline-flex';
        select.innerHTML = clientSavedPasswords.map(c => `<option value="${c.id}">🔑 ${escapeHtml(c.label || 'Saved Password')}</option>`).join('') + '<option value="manual">✏ Enter password manually</option>';
        select.onchange = () => {
          overlay.querySelector('#vs-unlock-pw').style.display = select.value === 'manual' ? 'block' : 'none';
        };
        overlay.querySelector('#vs-unlock-pw').style.display = select.value === 'manual' ? 'block' : 'none';
      } else if (wrap) {
        wrap.style.display = 'none';
        if (autoTry) autoTry.style.display = 'none';
        overlay.querySelector('#vs-unlock-pw').style.display = 'block';
      }
    } catch (e) {}
  }

  if (!capturedBase64 && sourceUrl) {
    retrieveDocumentBytes(sourceUrl)
      .then(async b64 => {
        capturedBase64 = b64;
        isCapturing = false;
        if (captureTag) {
          captureTag.innerHTML = '<span style="font-size:11px;color:#166534;font-weight:600;">✓ Captured and ready to file</span>';
        }
        capturedBase64 = await checkAndAutoUnlockPdf(b64, overlay.querySelector('#vs-client-select')?.value || '');
        return b64;
      })
      .catch(err => {
        console.warn('In-page background capture note:', err);
      });
  } else if (capturedBase64) {
    checkAndAutoUnlockPdf(capturedBase64, '').then(res => { capturedBase64 = res; });
  }

  const close = () => {
    WebsiteIsolationGuard.unblock();
    overlay.remove();
  };
  overlay.querySelector('#vs-modal-close').onclick = close;
  overlay.querySelector('#vs-btn-cancel').onclick = close;

  const clientSelect = overlay.querySelector('#vs-client-select');
  const treeItemsEl = overlay.querySelector('#vs-tree-items');
  const crumbEl = overlay.querySelector('#vs-nav-crumb');
  const selectedLabel = overlay.querySelector('#vs-selected-folder-label');
  const resetFolderBtn = overlay.querySelector('#vs-btn-reset-folder');
  const statusMsg = overlay.querySelector('#vs-status-msg');
  const saveBtn = overlay.querySelector('#vs-btn-save-file');

  if (toggleSecBtn) {
    toggleSecBtn.onclick = () => {
      if (isPdfEncrypted) {
        unlockForm.style.display = unlockForm.style.display === 'none' ? 'block' : 'none';
        if (lockForm) lockForm.style.display = 'none';
        loadClientPasswordsForInPage(clientSelect.value);
      } else {
        lockForm.style.display = lockForm.style.display === 'none' ? 'block' : 'none';
        if (unlockForm) unlockForm.style.display = 'none';
      }
    };
  }

  if (overlay.querySelector('#vs-btn-cancel-lock')) {
    overlay.querySelector('#vs-btn-cancel-lock').onclick = () => { lockForm.style.display = 'none'; };
  }
  if (overlay.querySelector('#vs-btn-cancel-unlock')) {
    overlay.querySelector('#vs-btn-cancel-unlock').onclick = () => { unlockForm.style.display = 'none'; };
  }

  if (overlay.querySelector('#vs-btn-apply-lock')) {
    overlay.querySelector('#vs-btn-apply-lock').onclick = async () => {
      const pw = overlay.querySelector('#vs-lock-pw').value;
      const confirmPw = overlay.querySelector('#vs-lock-confirm-pw').value;
      if (!pw) { alert('Please enter a password to lock the PDF.'); return; }
      if (pw !== confirmPw) { alert('Passwords do not match.'); return; }
      if (!capturedBase64) { alert('File is still capturing in background. Please wait a moment.'); return; }

      try {
        const lockRes = await apiCall('/api/pdf/lock', {
          method: 'POST',
          body: {
            client_file_no: clientSelect.value,
            file_base64: capturedBase64,
            password: pw,
            confirm_password: confirmPw,
            remember_password: overlay.querySelector('#vs-lock-remember').checked,
            label: overlay.querySelector('#vs-lock-label').value.trim() || 'General Password'
          }
        });
        capturedBase64 = lockRes.output_base64;
        isPdfEncrypted = true;
        updatePdfUiState();
        lockForm.style.display = 'none';
        statusMsg.innerHTML = '<span style="color:#166534;font-weight:700;">✓ PDF locked with password!</span>';
      } catch (err) {
        alert('Lock failed: ' + err.message);
      }
    };
  }

  if (overlay.querySelector('#vs-btn-apply-unlock')) {
    overlay.querySelector('#vs-btn-apply-unlock').onclick = async () => {
      const select = overlay.querySelector('#vs-inpage-saved-pwd-select');
      const isSaved = select && select.value && select.value !== 'manual';
      const credId = isSaved ? Number(select.value) : null;
      const pw = isSaved ? '' : overlay.querySelector('#vs-unlock-pw').value;

      if (!isSaved && !pw) { alert('Please enter password to unlock.'); return; }
      if (!capturedBase64) { alert('File is still capturing in background. Please wait a moment.'); return; }

      try {
        const unlockRes = await apiCall('/api/pdf/unlock', {
          method: 'POST',
          body: {
            client_file_no: clientSelect.value,
            file_base64: capturedBase64,
            credential_id: credId,
            password: pw
          }
        });
        capturedBase64 = unlockRes.output_base64;
        isPdfEncrypted = false;
        updatePdfUiState();
        unlockForm.style.display = 'none';
        statusMsg.innerHTML = `<span style="color:#166534;font-weight:700;">✓ PDF unlocked (${unlockRes.matched_credential_label || 'Decrypted'})!</span>`;
      } catch (err) {
        alert('Unlock failed: ' + err.message);
      }
    };
  }

  if (overlay.querySelector('#vs-btn-inpage-auto-try')) {
    overlay.querySelector('#vs-btn-inpage-auto-try').onclick = async () => {
      if (!clientSelect.value) { alert('Select a client first to try saved passwords.'); return; }
      try {
        const unlockRes = await apiCall('/api/pdf/unlock', {
          method: 'POST',
          body: { client_file_no: clientSelect.value, file_base64: capturedBase64, auto_try_saved: true }
        });
        capturedBase64 = unlockRes.output_base64;
        isPdfEncrypted = false;
        updatePdfUiState();
        unlockForm.style.display = 'none';
        statusMsg.innerHTML = `<span style="color:#166534;font-weight:700;">✓ Auto-unlocked using "${unlockRes.matched_credential_label}"!</span>`;
      } catch (err) {
        alert(err.message);
      }
    };
  }

  let canonicalTree = [];
  let navPath = '';
  let selectedTargetFolder = '';
  let loadedSingleClients = [];

  const singleSearchInput = overlay.querySelector('#vs-single-client-search');
  const navRootBtn = overlay.querySelector('#vs-nav-root');

  function updateFolderDisplay() {
    if (selectedTargetFolder) {
      selectedLabel.textContent = '/' + selectedTargetFolder;
      selectedLabel.style.color = '#2563eb';
      selectedLabel.style.background = '#eff6ff';
      resetFolderBtn.style.display = 'inline-block';
    } else {
      selectedLabel.textContent = '/ (Client Root)';
      selectedLabel.style.color = '#1e40af';
      selectedLabel.style.background = '#f1f5f9';
      resetFolderBtn.style.display = 'none';
    }
  }

  function renderSingleClientOptions(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = loadedSingleClients.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.file_no || '').toLowerCase().includes(q));
    clientSelect.innerHTML = '<option value="">Select a Client...</option>' +
      filtered.map(c => `<option value="${escapeHtml(c.file_no)}">${escapeHtml(c.name)} (${escapeHtml(c.file_no)})</option>`).join('');
  }

  try {
    const clients = await apiCall('/api/clients').catch(() => []);
    loadedSingleClients = Array.isArray(clients) ? clients : [];
    renderSingleClientOptions();
    updateFolderDisplay();
  } catch (err) {
    clientSelect.innerHTML = `<option value="">Cannot load clients: ${escapeHtml(err.message)}</option>`;
  }

  if (singleSearchInput) {
    singleSearchInput.oninput = (e) => {
      renderSingleClientOptions(e.target.value);
    };
  }

  async function loadTree(fno) {
    if (!fno) {
      canonicalTree = [];
      navPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderNav();
      return;
    }
    treeItemsEl.innerHTML = '<div style="padding:10px;font-size:11px;color:#2563eb;text-align:center;">Loading folder structure... ⏳</div>';
    try {
      const storageKind = overlay.querySelector('#vs-storage-select').value;
      const res = await apiCall(`/api/client-folders/${encodeURIComponent(fno)}/tree?storage_kind=${storageKind}`);
      canonicalTree = res?.tree || [];
      navPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderNav();
    } catch (err) {
      canonicalTree = [];
      treeItemsEl.innerHTML = `<div style="padding:10px;font-size:11px;color:#dc2626;text-align:center;">Cannot load folders: ${escapeHtml(err.message)}</div>`;
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
    crumbEl.textContent = navPath ? `/${navPath}` : '/ (Client Root)';
    overlay.querySelector('#vs-nav-up').disabled = !navPath;

    if (!clientSelect.value) {
      treeItemsEl.innerHTML = '<div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">Select a client above to browse folders</div>';
      return;
    }

    const node = findSubNode(canonicalTree, navPath);
    const folders = (node && node.children) ? node.children.filter(n => n.type === 'folder') : [];

    if (folders.length === 0) {
      treeItemsEl.innerHTML = `
        <div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">
          No subfolders here.<br>
          <button type="button" id="vs-empty-select-btn" style="margin-top:6px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px;background:#2563eb;color:#fff;border:0;cursor:pointer;">
            ✓ Use ${escapeHtml(navPath ? '/' + navPath : 'Client Root')}
          </button>
        </div>
      `;
      const emptyBtn = treeItemsEl.querySelector('#vs-empty-select-btn');
      if (emptyBtn) {
        emptyBtn.onclick = () => {
          selectedTargetFolder = navPath;
          updateFolderDisplay();
          renderNav();
        };
      }
      return;
    }

    treeItemsEl.innerHTML = folders.map(f => {
      const subCount = (f.children && Array.isArray(f.children)) ? f.children.filter(n => n.type === 'folder').length : 0;
      const itemPath = navPath ? `${navPath}/${f.name}` : f.name;
      const isSelected = selectedTargetFolder === itemPath;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin:2px 0;border-radius:8px;background:${isSelected ? '#eff6ff' : '#ffffff'};border:1px solid ${isSelected ? '#3b82f6' : '#e2e8f0'};font-size:11px;">
          <div class="vs-folder-name-btn" data-path="${escapeHtml(itemPath)}" style="cursor:pointer;flex:1;display:flex;align-items:center;gap:5px;overflow:hidden;margin-right:6px;">
            <span>📁</span>
            <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0f172a;">${escapeHtml(f.name)}</strong>
            ${subCount > 0 ? `<small style="color:#64748b;font-weight:600;">(${subCount})</small>` : ''}
            ${isSelected ? `<span style="color:#2563eb;font-weight:700;font-size:9.5px;">✓</span>` : ''}
          </div>
          <div style="display:flex;gap:3px;flex-shrink:0;">
            <button type="button" class="vs-btn vs-folder-select-btn" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 7px;background:${isSelected ? '#2563eb' : '#fff'};color:${isSelected ? '#fff' : 'inherit'};font-weight:700;">Select</button>
            ${subCount > 0 ? `<button type="button" class="vs-btn vs-folder-open-btn" data-path="${escapeHtml(itemPath)}" style="font-size:10px;padding:2px 6px;">›</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    treeItemsEl.querySelectorAll('.vs-folder-select-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        selectedTargetFolder = btn.getAttribute('data-path') || '';
        updateFolderDisplay();
        renderNav();
      };
    });

    treeItemsEl.querySelectorAll('.vs-folder-open-btn, .vs-folder-name-btn').forEach(el => {
      el.onclick = () => {
        navPath = el.getAttribute('data-path') || '';
        selectedTargetFolder = navPath;
        updateFolderDisplay();
        renderNav();
      };
    });
  }

  if (navRootBtn) {
    navRootBtn.onclick = () => {
      navPath = '';
      selectedTargetFolder = '';
      updateFolderDisplay();
      renderNav();
    };
  }

  clientSelect.onchange = () => {
    selectedTargetFolder = '';
    navPath = '';
    updateFolderDisplay();
    if (clientSelect.value) {
      loadTree(clientSelect.value);
      loadClientPasswordsForInPage(clientSelect.value);
    } else {
      canonicalTree = [];
      renderNav();
    }
  };

  overlay.querySelector('#vs-storage-select').onchange = () => {
    if (clientSelect.value) {
      loadTree(clientSelect.value);
    }
  };

  overlay.querySelector('#vs-nav-up').onclick = () => {
    if (!navPath) return;
    const parts = navPath.split('/');
    parts.pop();
    navPath = parts.join('/');
    selectedTargetFolder = navPath;
    updateFolderDisplay();
    renderNav();
  };

  overlay.querySelector('#vs-nav-select').onclick = () => {
    selectedTargetFolder = navPath;
    updateFolderDisplay();
  };

  resetFolderBtn.onclick = () => {
    selectedTargetFolder = '';
    navPath = '';
    updateFolderDisplay();
    renderNav();
  };

  saveBtn.onclick = async () => {
    const fno = clientSelect.value;
    if (!fno) {
      statusMsg.innerHTML = '<span style="color:#dc2626;">Please select a client first.</span>';
      return;
    }

    const storageKind = overlay.querySelector('#vs-storage-select').value;
    const docName = overlay.querySelector('#vs-doc-name').value.trim() || filename;

    let docPeriod = 'AY 2025-26';
    if (selectedTargetFolder) {
      const match = selectedTargetFolder.match(/\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b/i);
      if (match) docPeriod = match[0];
    }

    if (!capturedBase64) {
      chrome.runtime.sendMessage({
        type: 'QUEUE_BACKGROUND_SAVE',
        job: {
          client_file_no: fno,
          document_name: docName,
          source_url: sourceUrl,
          downloadId: downloadId,
          mime: itemMime,
          fileSize: itemSize,
          target_folder: selectedTargetFolder,
          save_local: storageKind === 'local',
          save_drive: storageKind === 'drive',
          service: 'General',
          period: docPeriod
        }
      });

      saveBtn.disabled = true;
      saveBtn.textContent = '✓ Save Queued';
      statusMsg.innerHTML = '<span style="color:#166534;font-weight:700;">✓ Save queued!</span>';
      await wait(600);
      close();
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const payload = {
        client_file_no: fno,
        document_name: docName,
        file_base64: capturedBase64,
        save_local: storageKind === 'local',
        save_drive: storageKind === 'drive',
        service: 'General',
        period: docPeriod
      };

      if (selectedTargetFolder) {
        payload.target_folder = selectedTargetFolder;
        payload.relative_path = selectedTargetFolder;
      }

      await apiCall('/api/save-document', {
        method: 'POST',
        body: payload
      });

      statusMsg.innerHTML = `<span style="color:#166534;font-weight:700;">✓ Successfully saved!</span>`;
      saveBtn.textContent = '✓ Saved Successfully';
      await wait(1000);
      close();
    } catch (err) {
      statusMsg.innerHTML = `<span style="color:#dc2626;">Error: ${escapeHtml(err.message)}</span>`;
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Save File to Database';
    }
  };
}

// ========================================================
// MESSAGE LISTENER
// ========================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CA_OFFICE_PING') {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'VS_REQUEST_PAIRING_CODE_FROM_TAB') {
    const listener = (event) => {
      if (event.data && event.data.type === 'VS_EXTENSION_PAIRING_CODE_RESPONSE') {
        window.removeEventListener('message', listener);
        sendResponse(event.data);
      }
    };
    window.addEventListener('message', listener);
    window.postMessage({ type: 'VS_GET_EXTENSION_PAIRING_CODE' }, '*');
    return true;
  }

  if (message.type === 'START_PRACTIVE_AUTOMATION') {
    sessionStorage.setItem(AUTO_KEY, JSON.stringify(message.job));
    runPractive();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'DETECT_PDF_CANDIDATES') {
    sendResponse({ candidates: candidates() });
    return;
  }

  if (message.type === 'CLICK_PDF_CONTROL') {
    const control = document.querySelector(`[data-vs-control-id="${message.controlId}"]`) || document.querySelector(`[data-ca-pdf-control="${message.controlId}"]`);
    if (!control) {
      sendResponse({ error: 'The download control is no longer visible on this page.' });
      return;
    }
    control.click();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'FETCH_PDF' || message.type === 'FETCH_DOCUMENT') {
    retrieveDocumentBytes(message.url)
      .then(base64 => sendResponse({ ok: true, base64 }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'SHOW_DOWNLOAD_INTERCEPT_PROMPT') {
    if (window === window.top) {
      showDownloadPrompt(message);
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ========================================================
// GLOBAL CAPTURE-PHASE CLICK & DOWNLOAD INTERCEPTOR
// (Overrides event suppression on Motilal Oswal, Practive, SPA portals)
// ========================================================
document.addEventListener('click', (e) => {
  try {
    const el = e.target.closest('a, button, [role="button"], input[type="button"], input[type="submit"], div[onclick], span[onclick], tr, [class*="download" i], [class*="export" i], [class*="pdf" i]');
    if (!el) return;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
    const href = el.href || '';
    if ((/pdf|download|export|ledger|statement|report|challan|receipt|invoice|return|p&l|holding|contract/i.test(text) || /\.(pdf|xlsx|xls|csv|zip)/i.test(href)) && text.length > 1 && text.length < 120) {
      chrome.runtime.sendMessage({
        type: 'RECORD_INTENT_DOWNLOAD',
        filename: `${text.replace(/[^a-z0-9._ -]/gi, '_')}.pdf`,
        url: href,
        text
      });
    }
  } catch (_) {}
}, true); // TRUE = Capture Phase! Executes before website frameworks can cancel or stop propagation!

// Auto-run Practive if on Practive tab
if (location.hostname === 'app.practive.in') setTimeout(runPractive, 700);

// Return bridge from VS Database Website
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'VS_SAVED_CLOSE_AND_RETURN') {
    chrome.runtime.sendMessage({
      type: 'VS_SAVED_CLOSE_AND_RETURN',
      origin_tab_id: event.data.origin_tab_id
    });
  }
  if (event.data && event.data.type === 'VS_FOCUS_ORIGIN_TAB') {
    chrome.runtime.sendMessage({
      type: 'VS_FOCUS_ORIGIN_TAB',
      origin_tab_id: event.data.origin_tab_id
    });
  }
  if (event.data && event.data.type === 'VS_CLOSE_WEBSITE_TAB') {
    chrome.runtime.sendMessage({
      type: 'VS_CLOSE_WEBSITE_TAB'
    });
  }
});
}
