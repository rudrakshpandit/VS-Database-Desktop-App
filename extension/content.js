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
    /* Real-Time Glass Progress Bar Styles */
    .vs-progress-backdrop {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      background: rgba(10, 25, 55, 0.45) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      animation: vsFadeIn 0.2s ease-out !important;
    }
    .vs-progress-card {
      width: min(460px, 92vw) !important;
      background: rgba(255, 255, 255, 0.96) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border: 1.5px solid rgba(255, 255, 255, 0.95) !important;
      border-radius: 24px !important;
      padding: 24px 28px !important;
      box-shadow: 0 25px 60px rgba(10, 31, 68, 0.25) !important;
      color: #0A1F44 !important;
      box-sizing: border-box !important;
    }
    .vs-progress-header {
      display: flex !important;
      align-items: center !important;
      gap: 14px !important;
    }
    .vs-progress-spinner {
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
      border: 3px solid rgba(73, 104, 237, 0.18) !important;
      border-top-color: #2563eb !important;
      animation: vsSpin 0.8s linear infinite !important;
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    @keyframes vsSpin {
      to { transform: rotate(360deg); }
    }
    .vs-progress-title {
      margin: 0 0 3px !important;
      font-size: 15px !important;
      font-weight: 700 !important;
      color: #0A1F44 !important;
      letter-spacing: -0.01em !important;
    }
    .vs-progress-sub {
      margin: 0 !important;
      font-size: 12px !important;
      color: #64748b !important;
      font-weight: 500 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 340px !important;
    }
    .vs-progress-track {
      width: 100% !important;
      height: 10px !important;
      background: rgba(226, 232, 240, 0.8) !important;
      border-radius: 999px !important;
      overflow: hidden !important;
      margin: 18px 0 10px 0 !important;
    }
    .vs-progress-fill {
      height: 100% !important;
      width: 0% !important;
      border-radius: 999px !important;
      background: linear-gradient(90deg, #2563eb 0%, #4f46e5 50%, #10b981 100%) !important;
      transition: width 0.18s ease-out !important;
    }
    .vs-progress-footer {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      font-size: 11.5px !important;
      font-weight: 700 !important;
    }
    .vs-progress-status-text {
      color: #475569 !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      max-width: 290px !important;
    }
    .vs-progress-percent {
      color: #2563eb !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      font-variant-numeric: tabular-nums !important;
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
// BULK DOWNLOAD COLLECTOR STATE & ENGINE
// ========================================================
let bulkQueue = [];
let isBulkMode = false;
let bulkDockPos = null; // { left, top }

// Restore saved dock position from chrome.storage
try {
  chrome.storage.local.get(['vs_bulk_dock_pos', 'bulk_mode'], (res) => {
    if (res && res.vs_bulk_dock_pos) bulkDockPos = res.vs_bulk_dock_pos;
    if (res && res.bulk_mode) isBulkMode = true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bulk_mode !== undefined) {
      isBulkMode = Boolean(changes.bulk_mode.newValue);
    }
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

// ========================================================
// REAL-TIME PROGRESS BAR (KB-ACCURATE STREAMING MODAL)
// ========================================================
function showExtensionProgressBar({ title = 'Staging Documents to Desktop App', subtitle = 'Preparing files...', totalBytes = 0 } = {}) {
  ensureModalStyles();
  const existing = document.querySelector('.vs-progress-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'vs-progress-backdrop';
  backdrop.innerHTML = `
    <div class="vs-progress-card">
      <div class="vs-progress-header">
        <div class="vs-progress-spinner" id="vs-prog-spinner"></div>
        <div style="flex:1;overflow:hidden;">
          <h3 class="vs-progress-title" id="vs-prog-title">${escapeHtml(title)}</h3>
          <p class="vs-progress-sub" id="vs-prog-sub">${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div class="vs-progress-track">
        <div class="vs-progress-fill" id="vs-prog-fill" style="width: 0%;"></div>
      </div>
      <div class="vs-progress-footer">
        <span class="vs-progress-status-text" id="vs-prog-status">${escapeHtml(subtitle)}</span>
        <span class="vs-progress-percent" id="vs-prog-pct">0%</span>
      </div>
    </div>
  `;
  document.documentElement.appendChild(backdrop);

  return {
    update({ transferredBytes = 0, totalBytes: newTotal, currentFilename = '', currentFileIndex = 1, totalFiles = 1 }) {
      const tot = (newTotal !== undefined && newTotal > 0) ? newTotal : totalBytes;
      const pct = tot > 0 ? Math.max(0, Math.min(100, (transferredBytes / tot) * 100)) : 0;
      const fill = backdrop.querySelector('#vs-prog-fill');
      const pctEl = backdrop.querySelector('#vs-prog-pct');
      const subEl = backdrop.querySelector('#vs-prog-sub');
      const statEl = backdrop.querySelector('#vs-prog-status');

      if (fill) fill.style.width = `${pct.toFixed(1)}%`;
      if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
      if (currentFilename && subEl) {
        subEl.textContent = `File ${currentFileIndex} of ${totalFiles}: "${currentFilename}"`;
      }
      if (statEl) {
        if (tot > 0) {
          statEl.textContent = `${formatBytes(transferredBytes)} / ${formatBytes(tot)} (${pct.toFixed(0)}%)`;
        } else {
          statEl.textContent = `Transferring ${currentFilename || 'file'}...`;
        }
      }
    },
    finish(msg = 'Transfer complete!') {
      return new Promise((resolve) => {
        const fill = backdrop.querySelector('#vs-prog-fill');
        const pctEl = backdrop.querySelector('#vs-prog-pct');
        const subEl = backdrop.querySelector('#vs-prog-sub');
        const statEl = backdrop.querySelector('#vs-prog-status');
        const spinner = backdrop.querySelector('#vs-prog-spinner');

        if (fill) {
          fill.style.width = '100%';
          fill.style.background = '#10b981';
        }
        if (pctEl) pctEl.textContent = '100%';
        if (subEl) subEl.textContent = msg;
        if (statEl) statEl.textContent = 'All documents staged successfully';
        if (spinner) {
          spinner.style.borderColor = 'transparent';
          spinner.style.borderTopColor = 'transparent';
          spinner.innerHTML = '<span style="font-size:20px;color:#10b981;line-height:1;font-weight:bold;">✓</span>';
          spinner.style.animation = 'none';
        }

        setTimeout(() => {
          backdrop.style.opacity = '0';
          backdrop.style.transition = 'opacity 0.25s ease';
          setTimeout(() => {
            backdrop.remove();
            resolve();
          }, 250);
        }, 500);
      });
    },
    error(err) {
      const subEl = backdrop.querySelector('#vs-prog-sub');
      const statEl = backdrop.querySelector('#vs-prog-status');
      const spinner = backdrop.querySelector('#vs-prog-spinner');
      if (subEl) subEl.textContent = `Error: ${err}`;
      if (statEl) statEl.textContent = 'Transfer paused';
      if (spinner) {
        spinner.innerHTML = '<span style="font-size:20px;color:#ef4444;line-height:1;font-weight:bold;">✕</span>';
        spinner.style.animation = 'none';
      }
      setTimeout(() => { backdrop.remove(); }, 3500);
    },
    close() {
      backdrop.remove();
    }
  };
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
  try { chrome.storage.local.set({ bulk_mode: true }); } catch (_) {}
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
      try { chrome.storage.local.set({ bulk_mode: false }); } catch (_) {}
      dock.remove();
    }
  };

  dock.querySelector('#vs-dock-btn-clear').onclick = () => {
    bulkQueue = [];
    isBulkMode = false;
    try { chrome.storage.local.set({ bulk_mode: false }); } catch (_) {}
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

  // Attach Done Action -> Stream Bulk Documents to VS Database Desktop App with Real-Time KB Progress
  dock.querySelector('#vs-dock-btn-done').onclick = async () => {
    if (isRedirectingToWeb) return;
    isRedirectingToWeb = true;
    setTimeout(() => { isRedirectingToWeb = false; }, 2500);

    const filesToSave = [...bulkQueue];
    bulkQueue = [];
    isBulkMode = false;
    try { chrome.storage.local.set({ bulk_mode: false }); } catch (_) {}
    dock.remove();

    if (!filesToSave.length) return;

    // 1. Initial calculation of total bytes across all files
    let totalBytes = filesToSave.reduce((sum, f) => {
      const s = f.size || f.fileSize || 0;
      return sum + (s > 0 ? s : (f.base64 ? Math.round(f.base64.length * 0.75) : 0));
    }, 0);

    const progressBar = showExtensionProgressBar({
      title: 'Staging to VS Database',
      subtitle: `Preparing ${filesToSave.length} document${filesToSave.length === 1 ? '' : 's'}...`,
      totalBytes
    });

    // Dual-Buffer Pipelining: Pre-fetch file N+1 in parallel while file N is being transmitted over HTTP loopback
    const prefetchPromises = new Map();
    const triggerPrefetch = (item) => {
      if (!item || item.file_base64 || item.base64 || item.downloadId || !item.url) return;
      if (!prefetchPromises.has(item.id)) {
        const p = retrieveDocumentBytes(item.url).then(b64 => {
          if (b64) {
            item.base64 = b64;
            item.file_base64 = b64;
            if (!item.size) item.size = Math.round(b64.length * 0.75);
          }
        }).catch(() => {});
        prefetchPromises.set(item.id, p);
      }
    };

    // Pre-warm first two files
    triggerPrefetch(filesToSave[0]);
    if (filesToSave.length > 1) triggerPrefetch(filesToSave[1]);

    let transferredBytes = 0;
    let successCount = 0;

    for (let i = 0; i < filesToSave.length; i++) {
      const f = filesToSave[i];
      const isFirst = (i === 0);
      const isLast = (i === filesToSave.length - 1);

      // Concurrently prefetch next item in the pipeline while transmitting current item
      if (i + 1 < filesToSave.length) {
        triggerPrefetch(filesToSave[i + 1]);
      }

      progressBar.update({
        transferredBytes,
        totalBytes,
        currentFilename: f.filename,
        currentFileIndex: i + 1,
        totalFiles: filesToSave.length
      });

      // Await prefetch if item was pre-warmed
      if (prefetchPromises.has(f.id)) {
        await prefetchPromises.get(f.id);
        prefetchPromises.delete(f.id);
      }

      // Retrieve binary in page context if still needed and no downloadId
      let b64 = f.file_base64 || f.base64 || null;
      if (!b64 && !f.downloadId && f.url) {
        try {
          b64 = await retrieveDocumentBytes(f.url);
          f.base64 = b64;
          f.file_base64 = b64;
        } catch (_) {}
      }

      // If file size wasn't known up front, calculate from retrieved base64
      const thisFileSize = f.size || (b64 ? Math.round(b64.length * 0.75) : 0);
      if ((!f.size || f.size <= 0) && thisFileSize > 0) {
        f.size = thisFileSize;
        totalBytes += thisFileSize;
      }

      const rawDlId = f.downloadId || f.sourceData?.downloadId;
      const numId = Number(rawDlId);
      const validDlId = (!isNaN(numId) && Number.isInteger(numId) && numId > 0) ? numId : null;

      const singlePayload = {
        download_id: validDlId,
        downloadId: validDlId,
        id: f.id || (validDlId ? `dl_${validDlId}` : `file_${Date.now()}_${i}`),
        filename: f.filename || 'document.pdf',
        baseName: f.baseName,
        fileExt: f.fileExt,
        url: f.url,
        mime: f.mime || 'application/pdf',
        size: thisFileSize,
        file_base64: b64,
        base64: b64,
        is_first: isFirst,
        is_last: isLast
      };

      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'STAGE_SINGLE_FILE',
          file: singlePayload,
          is_first: isFirst,
          is_last: isLast
        }, (reply) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(reply || { ok: false, error: 'No response from background' });
          }
        });
      });

      if (res && res.ok) {
        successCount++;
      } else {
        console.warn('[Bulk] File staging note:', f.filename, res?.error);
      }

      transferredBytes += (thisFileSize || 1024);
      progressBar.update({
        transferredBytes,
        totalBytes,
        currentFilename: f.filename,
        currentFileIndex: i + 1,
        totalFiles: filesToSave.length
      });

      // Minimal 10ms pause to yield DOM thread for silky-smooth progress animation
      await wait(10);
    }

    if (successCount > 0) {
      await progressBar.finish(`All ${successCount} document${successCount === 1 ? '' : 's'} staged successfully! Opening VS Database...`);
    } else {
      progressBar.error('Could not deliver files to desktop app.');
    }
  };
}


// ========================================================
// IN-PAGE DOWNLOAD INTERCEPT PROMPT & FILING SAVER
// ========================================================
function showDownloadPrompt(data) {
  if (window !== window.top) return;
  // If Bulk Mode is currently active, directly auto-collect into Bulk Queue and block normal download!
  if (isBulkMode) {
    addToBulkQueue(data);
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

  if (message.type === 'TRIGGER_PROTOCOL_LAUNCH') {
    triggerAppProtocolOnPage();
    sendResponse({ ok: true });
    return true;
  }
});

// Triggers Windows protocol handler directly on the active webpage
// This ensures Chrome shows the permission prompt on the SAME TAB with the "Always allow" checkbox
function triggerAppProtocolOnPage() {
  try {
    const a = document.createElement('a');
    a.href = 'vs-database://open?from_extension=1&skip_animation=1#save';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (a.parentNode) a.remove(); }, 600);
  } catch (_) {
    try {
      window.location.href = 'vs-database://open?from_extension=1&skip_animation=1#save';
    } catch (_) {}
  }
}

// ========================================================
// GLOBAL CAPTURE-PHASE CLICK & DOWNLOAD INTERCEPTOR
// (Overrides event suppression on Motilal Oswal, Practive, SPA portals)
// ========================================================
document.addEventListener('click', (e) => {
  try {
    if (!e.isTrusted || !e.target) return;
    const tag = e.target.nodeName;
    if (tag === 'HTML' || tag === 'BODY') return;

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
