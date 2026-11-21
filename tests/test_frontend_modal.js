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
    TauriBridge: {
      _isClient: false,
      _calls: [],
      openPath: async function(url) {
        this._calls.push({ fn: 'openPath', url });
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

  const sandbox = {
    window,
    document,
    sessionStorage,
    escapeHtml: window.escapeHtml,
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };

  vm.createContext(sandbox);

  // Extract functions from static/app.js
  const scriptToRun = `
    ${appJsContent.slice(appJsContent.indexOf('function resolveDownloadUrl'), appJsContent.indexOf('async function load()'))}
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

  // --- Test 5: 'Update Now' Click in Host Mode ---
  console.log("\n--- Test Suite 5: 'Update Now' Execution (Host Mode) ---");
  {
    const ctx = createTestContext();
    ctx.window.TauriBridge._isClient = false;
    ctx.showUpdateAvailableModal(samplePayload);

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    await btnNow.onclick();

    assert(ctx.window.TauriBridge._calls.length === 1, "window.TauriBridge.openPath called once");
    const call = ctx.window.TauriBridge._calls[0];
    assert(call.fn === 'openPath', "TauriBridge function called is openPath");
    assert(call.url === samplePayload.host_download_url, "openPath called with host_download_url (" + samplePayload.host_download_url + ")");

    const progArea = ctx.document.querySelector('#vs-update-progress-area');
    assert(progArea.style.display === 'block', "Progress area displayed (style.display = block)");
    assert(progArea.innerHTML.includes('Installer is downloading &amp; launching') || progArea.innerHTML.includes('Installer is downloading & launching'), "Progress feedback message rendered");
    assert(progArea.innerHTML.includes(samplePayload.host_download_url), "Fallback manual download link rendered");
    assert(btnNow.innerHTML.includes('Installer Launched'), "Button text updated to 'Installer Launched'");
  }

  // --- Test 6: 'Update Now' Click in Client Mode ---
  console.log("\n--- Test Suite 6: 'Update Now' Execution (Client Mode) ---");
  {
    const ctx = createTestContext();
    ctx.window.TauriBridge._isClient = true;
    ctx.showUpdateAvailableModal(samplePayload);

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    await btnNow.onclick();

    assert(ctx.window.TauriBridge._calls.length === 1, "window.TauriBridge.openPath called once for client");
    const call = ctx.window.TauriBridge._calls[0];
    assert(call.url === samplePayload.client_download_url, "openPath called with client_download_url (" + samplePayload.client_download_url + ")");
  }

  // --- Test 7: 'Update Now' Fallback when TauriBridge not available ---
  console.log("\n--- Test Suite 7: 'Update Now' Browser Fallback (Non-Tauri) ---");
  {
    const ctx = createTestContext();
    delete ctx.window.TauriBridge;
    ctx.showUpdateAvailableModal(samplePayload);

    const btnNow = ctx.document.querySelector('#btn-modal-update-now');
    await btnNow.onclick();

    assert(ctx.window._openCalls.length === 1, "window.open called as fallback");
    assert(ctx.window._openCalls[0].url === samplePayload.host_download_url, "window.open opened host_download_url");
    assert(ctx.window._openCalls[0].target === '_blank', "window.open opened in _blank");
  }

  // --- Test 8: Squelch when update_available is False ---
  console.log("\n--- Test Suite 8: Squelch on up-to-date payload ---");
  {
    const ctx = createTestContext();
    const upToDatePayload = { ...samplePayload, update_available: false };
    ctx.showUpdateAvailableModal(upToDatePayload);

    assert(ctx.document.querySelector('#vs-update-modal-overlay') === null, "Modal not rendered when update_available is false");
  }

  // --- Test 9: checkForAppUpdates Background vs Manual Snooze Integration ---
  console.log("\n--- Test Suite 9: Background vs Manual Snooze Flow ---");
  {
    const ctx = createTestContext();
    ctx.api = async (url) => {
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
