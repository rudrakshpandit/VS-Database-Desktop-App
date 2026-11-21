const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const appJsPath = path.join(baseDir, 'static', 'app.js');
const appCssPath = path.join(baseDir, 'static', 'app.css');
const tauriBridgePath = path.join(baseDir, 'static', 'tauri-bridge.js');

const appJs = fs.readFileSync(appJsPath, 'utf8');
const appCss = fs.readFileSync(appCssPath, 'utf8');
const tauriBridge = fs.readFileSync(tauriBridgePath, 'utf8');

const assertions = [
  ['app.js contains showUpdateAvailableModal', appJs.includes('function showUpdateAvailableModal(res)')],
  ['app.js contains checkForAppUpdates', appJs.includes('function checkForAppUpdates(')],
  ['app.js contains resolveDownloadUrl', appJs.includes('function resolveDownloadUrl(rawDl)')],
  ['app.js calls /api/system/check-updates', appJs.includes('/api/system/check-updates?version=')],
  ['app.js checks sessionStorage for snooze', appJs.includes('sessionStorage.getItem(\'vs_update_snooze_\' + res.latest_version)')],
  ['app.js sets sessionStorage snooze on Later', appJs.includes('sessionStorage.setItem(\'vs_update_snooze_\' + latestVer, \'true\')')],
  ['app.js handles Update Now click with client/host detection', appJs.includes('product: isClient ? \'client\' : \'host\'')],
  ['app.js triggers real-time download via start-update-download', appJs.includes('/api/system/start-update-download')],
  ['app.js polls update progress via update-progress', appJs.includes('/api/system/update-progress')],
  ['app.js executes restart via execute-update-restart', appJs.includes('/api/system/execute-update-restart')],
  ['app.js provides btn-snooze-update in Settings section 4', appJs.includes('id="btn-snooze-update"')],
  ['app.js attaches event listener for btn-snooze-update', appJs.includes('if (btnSnoozeUpdate)')],
  ['app.js auto-checks updates on dashboard init in load()', appJs.includes('checkForAppUpdates(false)')],
  ['app.css contains .vs-update-overlay', appCss.includes('.vs-update-overlay')],
  ['app.css contains .vs-update-card', appCss.includes('.vs-update-card')],
  ['app.css contains .vs-update-badge-pill', appCss.includes('.vs-update-badge-pill')],
  ['app.css contains .vs-update-btn-primary', appCss.includes('.vs-update-btn-primary')],
  ['app.css contains .vs-update-btn-secondary', appCss.includes('.vs-update-btn-secondary')],
  ['tauri-bridge.js exposes openPath', tauriBridge.includes('openPath: async function(pathOrUrl)')]
];

let failed = 0;
for (const [desc, pass] of assertions) {
  if (pass) {
    console.log('✓ PASS:', desc);
  } else {
    console.error('✗ FAIL:', desc);
    failed++;
  }
}

if (failed === 0) {
  console.log('\nAll ' + assertions.length + ' requirements verified successfully!');
  process.exit(0);
} else {
  console.error('\n' + failed + ' assertions failed!');
  process.exit(1);
}
