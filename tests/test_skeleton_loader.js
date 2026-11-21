/**
 * VS Database 2.0 - Skeleton Loading Screen Verification Suite
 * Verifies pixel-perfect glassmorphic skeleton screen for Host and Client apps.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const baseDir = path.resolve(__dirname, '..');
const indexHtmlPath = path.join(baseDir, 'static', 'index.html');
const appJsPath = path.join(baseDir, 'static', 'app.js');
const appCssPath = path.join(baseDir, 'static', 'app.css');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const appCss = fs.readFileSync(appCssPath, 'utf8');

// Normalize CRLF to LF for consistent string searching across operating systems
const indexHtmlNorm = indexHtml.replace(/\r\n/g, '\n');
const appJsNorm = appJs.replace(/\r\n/g, '\n');
const appCssNorm = appCss.replace(/\r\n/g, '\n');

// --- Simulated DOM Sandbox for app.js execution ---
const domSandbox = {
  window: {},
  document: {
    _contentEl: null,
    querySelector(sel) {
      if (sel === '#content') {
        if (!this._contentEl) {
          this._contentEl = {
            innerHTML: '',
            firstElementChild: null,
            classList: {
              classes: new Set(),
              remove(c) { this.classes.delete(c); },
              add(c) { this.classes.add(c); }
            }
          };
        }
        return this._contentEl;
      }
      return null;
    }
  }
};
domSandbox.window.__vsIsClientMode = false;

// Extract getSkeletonHtml and renderSkeletonLoader implementation from app.js
const scriptContext = {
  window: domSandbox.window,
  document: domSandbox.document,
  console: console
};
vm.createContext(scriptContext);

const extractCode = `
${appJsNorm.substring(appJsNorm.indexOf('function getSkeletonHtml('), appJsNorm.indexOf('function resolveDownloadUrl('))}
`;
vm.runInContext(extractCode, scriptContext);

const getSkeletonHtml = scriptContext.window.getSkeletonHtml || scriptContext.getSkeletonHtml;
const renderSkeletonLoader = scriptContext.window.renderSkeletonLoader || scriptContext.renderSkeletonLoader;

// Helper to count buttons in actions row HTML
function countSkeletonButtons(html) {
  const startIdx = html.indexOf('vs-skeleton-actions');
  if (startIdx === -1) return 0;
  const endIdx = html.indexOf('<!-- Skeleton 2-Column', startIdx) !== -1
    ? html.indexOf('<!-- Skeleton 2-Column', startIdx)
    : html.indexOf('class="two"', startIdx);
  const part = html.substring(startIdx, endIdx !== -1 ? endIdx : startIdx + 800);
  const matches = part.match(/class=["'][^"']*vs-skeleton(?:\s|["'])/g);
  return matches ? matches.length : 0;
}

function hasPairWorkstationPin(html) {
  const startIdx = html.indexOf('vs-skeleton-actions');
  if (startIdx === -1) return false;
  const endIdx = html.indexOf('<!-- Skeleton 2-Column', startIdx) !== -1
    ? html.indexOf('<!-- Skeleton 2-Column', startIdx)
    : html.indexOf('class="two"', startIdx);
  const part = html.substring(startIdx, endIdx !== -1 ? endIdx : startIdx + 800);
  return part.includes('vs-skeleton-btn-primary') || part.includes('width:170px');
}

function countActivityRows(html) {
  // Activity rows each have a circular icon placeholder (border-radius:50%)
  const matches = html.match(/vs-skeleton-circle["'][^>]*style=["'][^"']*width:36px/g);
  return matches ? matches.length : 0;
}

function countStatsCards(html) {
  const matches = html.match(/class="[^"]*vs-skeleton-stat[^"]*"/g);
  return matches ? matches.length : 0;
}

const hostSkeletonHtml = getSkeletonHtml(false);
const clientSkeletonHtml = getSkeletonHtml(true);

const assertions = [
  // --- 1. static/index.html Static Initial Pre-render ---
  ['index.html contains #content populated with .vs-dashboard-skeleton', indexHtmlNorm.includes('<main class="view" id="content">') && indexHtmlNorm.includes('class="vs-dashboard-skeleton"')],
  ['index.html initial skeleton contains global search bar placeholder (height:46px, border-radius:14px)', indexHtmlNorm.includes('height:46px;border-radius:14px;')],
  ['index.html initial skeleton contains .grid5 with 5 stats cards', countStatsCards(indexHtmlNorm) === 5],
  ['index.html initial skeleton contains 6 quick action buttons for host', countSkeletonButtons(indexHtmlNorm) === 6],
  ['index.html initial skeleton includes Pair Workstation (PIN) button with primary accent border', hasPairWorkstationPin(indexHtmlNorm)],
  ['index.html initial skeleton contains .two layout with Recent activity and Storage', indexHtmlNorm.includes('class="two"') && indexHtmlNorm.includes('vs-skeleton-card')],
  ['index.html initial skeleton contains 4 distinct activity rows with circular icons', countActivityRows(indexHtmlNorm) === 4],
  ['index.html initial skeleton contains local disk & Google Drive storage sections', indexHtmlNorm.includes('width:85%;height:11px') && indexHtmlNorm.includes('width:75%;height:11px')],
  ['index.html critical boot CSS contains @keyframes vs-skeleton-shimmer for instant paint', indexHtmlNorm.includes('@keyframes vs-skeleton-shimmer')],
  ['index.html critical boot CSS contains .vs-skeleton with linear-gradient wave', indexHtmlNorm.includes('.vs-skeleton {') && indexHtmlNorm.includes('linear-gradient(')],

  // --- 2. static/app.css Glassmorphism & Aesthetics ---
  ['app.css defines @keyframes vs-skeleton-shimmer with 1.5s infinite wave', appCssNorm.includes('@keyframes vs-skeleton-shimmer') && appCssNorm.includes('vs-skeleton-shimmer 1.5s')],
  ['app.css defines @keyframes fadeIn', appCssNorm.includes('@keyframes fadeIn')],
  ['app.css defines .vs-skeleton with linear-gradient background shimmer', appCssNorm.includes('.vs-skeleton {') && appCssNorm.includes('linear-gradient(')],
  ['app.css defines .vs-skeleton-card with glassmorphic backdrop-filter and border', appCssNorm.includes('.vs-skeleton-card {') && appCssNorm.includes('backdrop-filter: blur(') && appCssNorm.includes('border: 1px solid rgba(255, 255, 255')],
  ['app.css defines .vs-skeleton-stat matching height 82px and border-radius 16px', appCssNorm.includes('.vs-skeleton-stat {') && appCssNorm.includes('height: 82px') && appCssNorm.includes('border-radius: 16px')],
  ['app.css defines .vs-skeleton-circle with border-radius: 50% !important', appCssNorm.includes('.vs-skeleton-circle {') && appCssNorm.includes('border-radius: 50% !important')],
  ['app.css defines .vs-skeleton-pill with border-radius: 999px !important', appCssNorm.includes('.vs-skeleton-pill {') && appCssNorm.includes('border-radius: 999px !important')],
  ['app.css defines .vs-skeleton-btn-primary with primary accent border', appCssNorm.includes('.vs-skeleton-btn-primary {') && appCssNorm.includes('var(--pc')],

  // --- 3. Dynamic Host vs Client Skeleton Logic in app.js ---
  ['app.js exports getSkeletonHtml function', typeof getSkeletonHtml === 'function'],
  ['app.js exports renderSkeletonLoader function', typeof renderSkeletonLoader === 'function'],
  ['Host mode getSkeletonHtml(false) renders exactly 6 quick action buttons', countSkeletonButtons(hostSkeletonHtml) === 6],
  ['Host mode getSkeletonHtml(false) includes Pair Workstation (PIN) button with primary accent border', hasPairWorkstationPin(hostSkeletonHtml)],
  ['Client mode getSkeletonHtml(true) renders exactly 5 quick action buttons', countSkeletonButtons(clientSkeletonHtml) === 5],
  ['Client mode getSkeletonHtml(true) DOES NOT include Pair Workstation (PIN) button', hasPairWorkstationPin(clientSkeletonHtml) === false],
  ['Both Host and Client skeleton have exactly 5 quick stats cards', countStatsCards(hostSkeletonHtml) === 5 && countStatsCards(clientSkeletonHtml) === 5],
  ['Both Host and Client skeleton have 4 distinct activity rows with circular icons', countActivityRows(hostSkeletonHtml) === 4 && countActivityRows(clientSkeletonHtml) === 4],

  // --- 4. Dynamic Invocation & Integration in app.js ---
  ['app.js invokes renderSkeletonLoader(isClient) at the very start of load()', appJsNorm.includes('window.__vsIsClientMode = isClient;\n\n  // Immediately render pixel-perfect skeleton screen matching detected mode (Host vs Client)\n  renderSkeletonLoader(isClient);')],
  ['app.js invokes renderSkeletonLoader(true) in VSOfflineManager.init() for Client mode', appJsNorm.includes('if (isClient) {\n      this.currentState = this.STATE_CHECKING;\n      this.lockdownMutations();\n      this.showCheckingBanner();\n      const contentEl = document.querySelector(\'#content\');\n      if (contentEl && (!contentEl.firstElementChild || contentEl.innerHTML.trim() === \'\' || !window.__vsDashboardRendered)) {\n        renderSkeletonLoader(true);')],
  ['app.js defines setHostChecking function', appJsNorm.includes('function setHostChecking(isChecking)') && appJsNorm.includes('window.setHostChecking = setHostChecking;')],
  ['app.js provides VSOfflineManager.setHostChecking method', appJsNorm.includes('setHostChecking(isChecking) {')],
  ['app.js VSOfflineManager.showCheckingBanner ensures skeleton screen is rendered', appJsNorm.includes('showCheckingBanner() {\n    let banner = document.getElementById(\'vs-offline-banner\');') && appJsNorm.includes('renderSkeletonLoader(true);')],
  ['app.js dashboard() smoothly replaces skeleton with tab-enter transition', appJsNorm.includes('const hadSkeleton = !!document.querySelector(\'.vs-dashboard-skeleton\');') && appJsNorm.includes('if (hadSkeleton && content) {\n    content.classList.remove(\'tab-enter\');\n    void content.offsetWidth;\n    content.classList.add(\'tab-enter\');')]
];

let failed = 0;
console.log('Running VS Database Skeleton Loading Screen Test Suite...\n');

for (const [desc, pass] of assertions) {
  if (pass) {
    console.log('✓ PASS:', desc);
  } else {
    console.error('✗ FAIL:', desc);
    failed++;
  }
}

if (failed === 0) {
  console.log(`\nAll ${assertions.length} skeleton loader specifications verified successfully!`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${assertions.length} tests failed!`);
  process.exit(1);
}
