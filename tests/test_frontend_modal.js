/**
 * Comprehensive Headless Frontend Modal & Interaction Test Suite
 * Tests showUpdateAvailableModal(res) and checkForAppUpdates() from static/app.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJsPath = path.resolve(__dirname, '..', 'static', 'app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Lightweight HTML Parser & Mock DOM
class MockElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.id = attributes.id || '';
    this.className = attributes.class || '';
    this.classList = new Set(this.className ? this.className.split(/\s+/).filter(Boolean) : []);
    this.children = [];
    this.parentNode = null;
    this.style = {};
    if (attributes.style) {
      attributes.style.split(';').forEach(rule => {
        const parts = rule.split(':');
        if (parts.length >= 2) {
          const k = parts[0].trim();
          const v = parts.slice(1).join(':').trim();
          if (k && v) {
            const camelKey = k.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            this.style[camelKey] = v;
          }
        }
      });
    }
    this.onclick = null;
    this.disabled = false;
    this._textContent = '';
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  get innerHTML() {
    return this.children.map(c => c.outerHTML).join('') || this._textContent;
  }

  set innerHTML(html) {
    this.children = [];
    this._textContent = '';
    const parsed = parseHTMLtoElements(html);
    for (const el of parsed) {
      this.appendChild(el);
    }
  }

  get outerHTML() {
    const attrs = Object.entries(this.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    const attrStr = attrs ? ' ' + attrs : '';
    return `<${this.tagName.toLowerCase()}${attrStr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') {
      this.className = String(v);
      this.classList = new Set(this.className.split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const match = (el) => {
      if (sel.startsWith('#')) {
        return el.id === sel.slice(1);
      } else if (sel.startsWith('.')) {
        return el.classList.has(sel.slice(1));
      } else if (sel.includes('[')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          return val !== undefined ? el.getAttribute(attr) === val : el.getAttribute(attr) !== null;
        }
      }
      return el.tagName.toLowerCase() === sel.toLowerCase();
    };

    const traverse = (node) => {
      for (const child of node.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  insertAdjacentHTML(position, html) {
    const parsed = parseHTMLtoElements(html);
    for (const el of parsed) {
      this.appendChild(el);
    }
  }
}

// Simple HTML Tokenizer & DOM Builder for mock
function parseHTMLtoElements(html) {
  const elements = [];
  const tagRegex = /<(\/)?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9_:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;
  let match;
  const stack = [];

  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClosing, tagName, attrString, isSelfClosing, textContent] = match;

    if (textContent) {
      const trimmed = textContent.trim();
      if (trimmed && stack.length > 0) {
        const textNode = new MockElement('#text');
        textNode.textContent = textContent;
        stack[stack.length - 1].appendChild(textNode);
      }
      continue;
    }

    if (isClosing) {
      if (stack.length > 0) {
        const popped = stack.pop();
        if (stack.length === 0) {
          elements.push(popped);
        }
      }
      continue;
    }

    // Opening tag
    const attrs = {};
    if (attrString) {
      const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let aMatch;
      while ((aMatch = attrRegex.exec(attrString)) !== null) {
        const key = aMatch[1];
        const val = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] || ''));
        attrs[key] = val;
      }
    }

    const elem = new MockElement(tagName, attrs);

    const isVoid = isSelfClosing || ['path', 'line', 'polyline', 'circle', 'rect', 'use', 'hr', 'br', 'img', 'input'].includes(tagName.toLowerCase());
    if (isVoid) {
      if (stack.length > 0) {
        stack[stack.length - 1].appendChild(elem);
      } else {
        elements.push(elem);
      }
    } else {
      if (stack.length > 0) {
        stack[stack.length - 1].appendChild(elem);
      }
      stack.push(elem);
    }
  }

  while (stack.length > 0) {
    elements.push(stack.shift());
  }

  return elements;
}

// Set up Context
function createTestContext() {
  const body = new MockElement('body');
  const listeners = {};

  const document = {
    body: body,
    getElementById: (id) => {
      const all = body.querySelectorAll('#' + id);
      return all.length > 0 ? all[0] : null;
    },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener: (event, fn) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },
    dispatchEvent: (event) => {
      if (listeners[event.type]) {
        for (const fn of listeners[event.type]) fn(event);
      }
    }
  };

  const sessionStorageStore = {};
  const sessionStorage = {
    getItem: (k) => (k in sessionStorageStore ? sessionStorageStore[k] : null),
    setItem: (k, v) => { sessionStorageStore[k] = String(v); },
    removeItem: (k) => { delete sessionStorageStore[k]; },
    clear: () => {
      for (const k of Object.keys(sessionStorageStore)) delete sessionStorageStore[k];
    },
    _store: sessionStorageStore
  };

  const window = {
    APP_VERSION: '2.2.1',
    document: document,
    sessionStorage: sessionStorage,
    location: { origin: 'http://127.0.0.1:8768' },
    open: (url, target) => {
      window._openCalls.push({ url, target });
    },
    _openCalls: [],
    close: () => {
      window._closeCalled = true;
    },
    _closeCalled: false,
    TauriBridge: {
      _isClient: false,
      _calls: [],
      openPath: async function(url) {
        this._calls.push({ fn: 'openPath', url });
        return true;
      },
      closeApp: async function() {
        this._calls.push({ fn: 'closeApp' });
        return true;
      },
      isClientMode: async function() {
        return this._isClient;
      },
      getBaseUrl: function() {
        return 'http://127.0.0.1:8768';
      }
    },
    escapeHtml: (str) => String(str || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]))
  };

  const apiCalls = [];
  const defaultApi = async (url, opts) => {
    apiCalls.push({ url, opts });
    if (url.includes('/api/system/start-update-download')) {
      return { ok: true, status: 'downloading' };
    }
    if (url.includes('/api/system/update-progress')) {
      return { status: 'downloading', percentage: 0, speed_str: '0 KB/s' };
    }
    if (url.includes('/api/system/execute-update-restart')) {
      return { ok: true };
    }
    return { ok: true };
  };

  const activeIntervals = [];
  const sandbox = {
    window,
    document,
    sessionStorage,
    escapeHtml: window.escapeHtml,
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      activeIntervals.push(id);
      return id;
    },
    clearInterval: (id) => {
      clearInterval(id);
      const idx = activeIntervals.indexOf(id);
      if (idx !== -1) activeIntervals.splice(idx, 1);
    },
    api: defaultApi,
    _apiCalls: apiCalls,
    _activeIntervals: activeIntervals
  };
  window.api = defaultApi;

  vm.createContext(sandbox);

  // Extract functions from static/app.js fresh
  const appJsFresh = fs.readFileSync(appJsPath, 'utf8');
  const scriptToRun = `
    ${appJsFresh.slice(appJsFresh.indexOf('function resolveDownloadUrl'), appJsFresh.indexOf('async function load()'))}
  `;
  vm.runInContext(scriptToRun, sandbox);

  return sandbox;
}

// Sample update payload
const samplePayload = {
  current_version: "2.2.1",
  latest_version: "2.2.2",
  update_available: true,
  host_download_url: "https://github.com/rudrakshpandit/VS-Database-Host-and-Client/releases/download/v2.2.2/VS.Database.Host.Setup.exe",
  client_download_url: "https://github.com/rudrakshpandit/VS-Database-Host-and-Client/releases/download/v2.2.2/VS.Database.Client.Setup.exe",
  release_notes: "## VS Database v2.2.2 Release Notes\n- In-App Update Prompt\n- NSIS Installers",
  message: "⚡ Update Available (v2.2.2)!"
};

async function runTests() {
  console.log("=== Running Frontend Update Modal & Interaction Test Suite ===");
  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // --- Test 1: Rendering of classes and contents ---
  console.log("\n--- Test Suite 1: Modal Rendering & Structure ---");
  {
    const ctx = createTestContext();
    ctx.showUpdateAvailableModal(samplePayload);

    const overlay = ctx.document.querySelector('.vs-update-overlay');
    assert(overlay !== null, "Modal overlay rendered with class .vs-update-overlay");
    assert(overlay && overlay.id === 'vs-update-modal-overlay', "Overlay has id #vs-update-modal-overlay");

    const card = ctx.document.querySelector('.vs-update-card');
    assert(card !== null, "Card element rendered with class .vs-update-card");

    const title = ctx.document.querySelector('#vs-update-modal-title');
    assert(title !== null && title.textContent.includes('Update Available'), "Title contains 'Update Available'");

    const badge = ctx.document.querySelector('.vs-update-badge-pill');
    assert(badge !== null && badge.textContent.includes('v2.2.2'), "Version badge pill contains 'v2.2.2'");

    const btnLater = ctx.document.querySelector('#btn-modal-update-later');
    assert(btnLater !== null, "Modal contains 'Later' button with id #btn-modal-update-later");

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    assert(btnNow !== null, "Modal contains 'Update Now' button with id #btn-modal-update-now");

    const notes = ctx.document.querySelector('.vs-update-notes-content');
    assert(notes !== null && notes.textContent.includes('VS Database v2.2.2 Release Notes'), "Release notes rendered inside modal");
  }

  // --- Test 2: 'Later' Button Click & Snooze Flow ---
  console.log("\n--- Test Suite 2: 'Later' Snooze Flow ---");
  {
    const ctx = createTestContext();
    ctx.showUpdateAvailableModal(samplePayload);

    const btnLater = ctx.document.querySelector('#btn-modal-update-later');
    assert(ctx.sessionStorage.getItem('vs_update_snooze_2.2.2') === null, "Snooze initially null before click");

    // Click 'Later'
    btnLater.onclick();

    assert(ctx.sessionStorage.getItem('vs_update_snooze_2.2.2') === 'true', "sessionStorage vs_update_snooze_2.2.2 set to 'true'");

    const overlay = ctx.document.querySelector('#vs-update-modal-overlay');
    assert(overlay.classList.has('vs-modal-closing'), "Overlay received .vs-modal-closing class for smooth dismiss");

    // Wait for timeout dismissal
    await new Promise(r => setTimeout(r, 250));
    assert(ctx.document.querySelector('#vs-update-modal-overlay') === null, "Overlay element removed from DOM after dismiss timeout");
  }

  // --- Test 3: Close Button (X) Click Snooze Flow ---
  console.log("\n--- Test Suite 3: Close Button (X) Flow ---");
  {
    const ctx = createTestContext();
    ctx.showUpdateAvailableModal(samplePayload);

    const btnClose = ctx.document.querySelector('#vs-update-btn-close');
    assert(btnClose !== null, "Modal contains close button #vs-update-btn-close");

    btnClose.onclick();
    assert(ctx.sessionStorage.getItem('vs_update_snooze_2.2.2') === 'true', "Close button sets sessionStorage snooze");
  }

  // --- Test 4: Escape Key Press Snooze Flow ---
  console.log("\n--- Test Suite 4: Keyboard Navigation (Escape) Flow ---");
  {
    const ctx = createTestContext();
    ctx.showUpdateAvailableModal(samplePayload);

    ctx.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert(ctx.sessionStorage.getItem('vs_update_snooze_2.2.2') === 'true', "Pressing Escape key sets sessionStorage snooze to 'true'");
  }

  // --- Test 5: 'Update Now' Click & Start Download (Host Mode) ---
  console.log("\n--- Test Suite 5: 'Update Now' Execution & Download Start (Host Mode) ---");
  {
    const ctx = createTestContext();
    ctx.window.TauriBridge._isClient = false;
    ctx.showUpdateAvailableModal(samplePayload);

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    assert(btnNow !== null, "Update Now button present");

    await btnNow.onclick();

    // Verify /api/system/start-update-download call
    const startCall = ctx._apiCalls.find(c => c.url.includes('/api/system/start-update-download'));
    assert(startCall !== undefined, "api called with /api/system/start-update-download");
    assert(startCall && startCall.opts && startCall.opts.method === 'POST', "start-update-download called with POST");
    const body = JSON.parse(startCall.opts.body);
    assert(body.version === '2.2.2', "start-update-download payload has correct version (2.2.2)");
    assert(body.product === 'host', "start-update-download payload product is 'host'");

    // Verify progress UI rendered
    const fillBar = ctx.document.querySelector('#vs-update-progress-fill');
    assert(fillBar !== null, "Progress fill bar rendered with id #vs-update-progress-fill");
    assert(fillBar.style.width === '0%', "Initial fill bar width is 0%");

    const pctText = ctx.document.querySelector('#vs-update-percentage-text');
    assert(pctText !== null && pctText.textContent.includes('0%'), "Percentage text initialized to 0%");

    const statsText = ctx.document.querySelector('#vs-update-stats-text');
    assert(statsText !== null && statsText.textContent.includes('Downloaded:'), "Stats label rendered");

    // Verify footer hidden during active download
    const footer = ctx.document.querySelector('#vs-update-modal-footer');
    assert(footer && footer.style.display === 'none', "Modal footer hidden during active download");

    // Clean up active intervals
    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 6: 'Update Now' Execution (Client Mode) ---
  console.log("\n--- Test Suite 6: 'Update Now' Execution (Client Mode) ---");
  {
    const ctx = createTestContext();
    ctx.window.TauriBridge._isClient = true;
    ctx.showUpdateAvailableModal(samplePayload);

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    await btnNow.onclick();

    const startCall = ctx._apiCalls.find(c => c.url.includes('/api/system/start-update-download'));
    assert(startCall !== undefined, "start-update-download called for client");
    const body = JSON.parse(startCall.opts.body);
    assert(body.product === 'client', "start-update-download product parameter is 'client' in client mode");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 7: Real-Time Progress Polling & UI Updates ---
  console.log("\n--- Test Suite 7: Real-Time Progress Bar Polling (0% -> 50%) ---");
  {
    let currentProgress = { status: 'downloading', percentage: 10, downloaded_mb: '5.0', total_mb: '50.0', speed_str: '1.2 MB/s' };
    const ctx = createTestContext();
    ctx.api = async (url, opts) => {
      ctx._apiCalls.push({ url, opts });
      if (url.includes('start-update-download')) return { ok: true };
      if (url.includes('update-progress')) return currentProgress;
      return { ok: true };
    };

    ctx.showUpdateAvailableModal(samplePayload);
    await ctx.document.querySelector('#btn-modal-update-now').onclick();

    // Advance progress to 50%
    currentProgress = { status: 'downloading', percentage: 50, downloaded_mb: '25.0', total_mb: '50.0', speed_str: '3.4 MB/s' };
    await new Promise(r => setTimeout(r, 380));

    const fillBar = ctx.document.querySelector('#vs-update-progress-fill');
    const pctText = ctx.document.querySelector('#vs-update-percentage-text');
    const statsText = ctx.document.querySelector('#vs-update-stats-text');

    assert(fillBar && fillBar.style.width === '50%', "Progress fill bar width updated to 50%");
    assert(pctText && pctText.textContent === '50%', "Percentage text updated to 50%");
    assert(statsText && statsText.textContent.includes('25.0 MB / 50.0 MB') && statsText.textContent.includes('3.4 MB/s'), "Stats text contains 25.0 MB / 50.0 MB and 3.4 MB/s speed");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 8: 100% Download Complete -> Single Choice Restart Modal ---
  console.log("\n--- Test Suite 8: 100% Complete & Single Choice Restart Button ---");
  {
    let currentProgress = { status: 'downloading', percentage: 90, downloaded_mb: '45.0', total_mb: '50.0', speed_str: '2.0 MB/s' };
    const ctx = createTestContext();
    ctx.api = async (url, opts) => {
      ctx._apiCalls.push({ url, opts });
      if (url.includes('start-update-download')) return { ok: true };
      if (url.includes('update-progress')) return currentProgress;
      if (url.includes('execute-update-restart')) return { ok: true };
      return { ok: true };
    };

    ctx.showUpdateAvailableModal(samplePayload);
    await ctx.document.querySelector('#btn-modal-update-now').onclick();

    // Trigger complete
    currentProgress = { status: 'complete', percentage: 100, downloaded_mb: '50.0', total_mb: '50.0', speed_str: '0 KB/s', installer_path: 'C:\\temp\\VS-Setup.exe' };
    await new Promise(r => setTimeout(r, 380));

    // Verify Title
    const title = ctx.document.querySelector('#vs-update-modal-title');
    assert(title && title.textContent.includes('Update Download Complete'), "Header shows 'Update Download Complete'");

    // Verify Fill bar locked at 100% with green accent class
    const fillBar = ctx.document.querySelector('.vs-update-progress-fill');
    assert(fillBar && fillBar.style.width === '100%', "Fill bar locked at 100%");
    assert(fillBar && fillBar.classList.has('vs-fill-complete'), "Fill bar has green success class .vs-fill-complete");

    // Verify ONLY ONE button in footer
    const restartBtn = ctx.document.querySelector('#btn-modal-restart-now');
    assert(restartBtn !== null, "Restart button #btn-modal-restart-now is present");
    assert(restartBtn.textContent.includes('Restart & Apply Update'), "Restart button text is 'Restart & Apply Update'");

    // Assert NO "Later" or "Cancel" buttons exist in footer
    const btnLater = ctx.document.querySelector('#btn-modal-update-later');
    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    assert(btnLater === null, "NO 'Later' button exists in completed restart state");
    assert(btnNow === null, "NO 'Update Now' button exists in completed restart state");

    // Verify Close (X) button is hidden
    const btnClose = ctx.document.querySelector('#vs-update-btn-close');
    assert(btnClose && btnClose.style.display === 'none', "Close button is hidden in complete state");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 9: Restart Action Trigger & App Exit ---
  console.log("\n--- Test Suite 9: Restart Trigger Execution ---");
  {
    const ctx = createTestContext();
    let currentProgress = { status: 'complete', percentage: 100, installer_path: 'C:\\temp\\VS-Setup.exe' };
    ctx.api = async (url, opts) => {
      ctx._apiCalls.push({ url, opts });
      if (url.includes('start-update-download')) return { ok: true };
      if (url.includes('update-progress')) return currentProgress;
      if (url.includes('execute-update-restart')) return { ok: true };
      return { ok: true };
    };

    ctx.showUpdateAvailableModal(samplePayload);
    await ctx.document.querySelector('#btn-modal-update-now').onclick();
    await new Promise(r => setTimeout(r, 380));

    const restartBtn = ctx.document.querySelector('#btn-modal-restart-now');
    assert(restartBtn !== null, "Restart button ready to click");

    // Click Restart button
    await restartBtn.onclick();

    assert(restartBtn.disabled === true, "Restart button disabled on click");
    assert(restartBtn.innerHTML.includes('Restarting Application'), "Restart button displays spinner / restarting status");

    const restartCall = ctx._apiCalls.find(c => c.url.includes('/api/system/execute-update-restart'));
    assert(restartCall !== undefined, "api called with /api/system/execute-update-restart");
    const rBody = JSON.parse(restartCall.opts.body);
    assert(rBody.installer_path === 'C:\\temp\\VS-Setup.exe', "execute-update-restart called with correct installer_path");

    // Verify window.TauriBridge.closeApp was called
    const closeCall = ctx.window.TauriBridge._calls.find(c => c.fn === 'closeApp');
    assert(closeCall !== undefined, "window.TauriBridge.closeApp called to finalize restart");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 10: Non-Tauri Browser Fallback for Restart ---
  console.log("\n--- Test Suite 10: Non-Tauri Close Fallback ---");
  {
    const ctx = createTestContext();
    delete ctx.window.TauriBridge;
    ctx.window._closeCalled = false;
    ctx.window.close = () => { ctx.window._closeCalled = true; };

    let currentProgress = { status: 'complete', percentage: 100, installer_path: 'C:\\temp\\VS-Setup.exe' };
    ctx.api = async (url, opts) => {
      ctx._apiCalls.push({ url, opts });
      if (url.includes('start-update-download')) return { ok: true };
      if (url.includes('update-progress')) return currentProgress;
      if (url.includes('execute-update-restart')) return { ok: true };
      return { ok: true };
    };

    ctx.showUpdateAvailableModal(samplePayload);
    await ctx.document.querySelector('#btn-modal-update-now').onclick();
    await new Promise(r => setTimeout(r, 380));

    const restartBtn = ctx.document.querySelector('#btn-modal-restart-now');
    await restartBtn.onclick();

    assert(ctx.window._closeCalled === true, "window.close called when TauriBridge not present");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  // --- Test 11: Squelch when update_available is False ---
  console.log("\n--- Test Suite 11: Squelch on up-to-date payload ---");
  {
    const ctx = createTestContext();
    const upToDatePayload = { ...samplePayload, update_available: false };
    ctx.showUpdateAvailableModal(upToDatePayload);

    assert(ctx.document.querySelector('#vs-update-modal-overlay') === null, "Modal not rendered when update_available is false");
  }

  // --- Test 12: checkForAppUpdates Background vs Manual Snooze Integration ---
  console.log("\n--- Test Suite 12: Background vs Manual Snooze Flow ---");
  {
    const ctx = createTestContext();
    ctx.api = async (url, opts) => {
      ctx._apiCalls.push({ url, opts });
      assert(url.includes('/api/system/check-updates'), "api called with check-updates URL");
      return samplePayload;
    };

    // Case A: Fresh check (not snoozed, background)
    await ctx.checkForAppUpdates(false);
    assert(ctx.document.querySelector('#vs-update-modal-overlay') !== null, "Modal opens automatically on background check when not snoozed");

    // Dismiss & snooze
    ctx.document.querySelector('#btn-modal-update-later').onclick();
    assert(ctx.sessionStorage.getItem('vs_update_snooze_2.2.2') === 'true', "Session snooze set");
    ctx.document.body.children = []; // reset DOM

    // Case B: Background check when snoozed -> should NOT open modal
    await ctx.checkForAppUpdates(false);
    assert(ctx.document.querySelector('#vs-update-modal-overlay') === null, "Background check suppresses modal when snoozed");

    // Case C: Manual check when snoozed -> SHOULD bypass snooze and open modal
    await ctx.checkForAppUpdates(true);
    assert(ctx.document.querySelector('#vs-update-modal-overlay') !== null, "Manual check in Settings forces modal display even if snoozed");

    ctx._activeIntervals.forEach(id => clearInterval(id));
  }

  console.log("\n==============================================");
  console.log(`TOTAL FRONTEND TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("==============================================");

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
