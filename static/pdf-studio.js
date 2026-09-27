/**
 * VS Database — Studio Subsystem Frontend Module
 * 100% Parity with UI/Desired/PDF Studio.png
 * 12 Modular Tools, Multi-File Queue, Dynamic Settings, Real-Time Preview, and Operation History.
 */

// Active Studio Global State
let studioSelectedTool = 'merge_pdf';
let studioFiles = []; // Array of { id, file, name, size, base64 }
let currentPdfSession = null;
let currentThumbnails = [];
let currentPreviewPage = 1;
let currentZoom = 1.0;
let pdfStudioOriginContext = null;
let isExecutingStudioTool = false;

// 12 Tool Definitions matching Mockup
const STUDIO_TOOLS = [
  {
    id: 'merge_pdf',
    name: 'Merge PDF',
    desc: 'Combine multiple PDFs into a single document',
    badgeClass: 'badge-blue',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.5-1.5M8 8l1.5 1.5M16 8l-1.5 1.5M8 16l1.5-1.5"/></svg>`
  },
  {
    id: 'split_pdf',
    name: 'Split PDF',
    desc: 'Extract specific pages or page ranges',
    badgeClass: 'badge-orange',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`
  },
  {
    id: 'rotate_pages',
    name: 'Rotate PDF',
    desc: 'Rotate pages 90, 180, or 270 degrees',
    badgeClass: 'badge-purple',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`
  },
  {
    id: 'compress_pdf',
    name: 'Compress PDF',
    desc: 'Reduce PDF file size while preserving quality',
    badgeClass: 'badge-emerald',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6m-6-4h6m4 0h6m-6 4h6M7 4v16m10-16v16"/></svg>`
  },
  {
    id: 'unlock_pdf',
    name: 'Unlock PDF',
    desc: 'Remove password and restrictions from PDF',
    badgeClass: 'badge-rose',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
  },
  {
    id: 'lock_pdf',
    name: 'Protect PDF',
    desc: 'Secure your PDF with a password',
    badgeClass: 'badge-blue',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
  },
  {
    id: 'extract_pages',
    name: 'Extract Pages',
    desc: 'Save selected pages as a new PDF',
    badgeClass: 'badge-indigo',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
  },
  {
    id: 'delete_pages',
    name: 'Delete Pages',
    desc: 'Remove unwanted pages from your document',
    badgeClass: 'badge-red',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`
  },
  {
    id: 'rearrange_pages',
    name: 'Reorder Pages',
    desc: 'Rearrange the page sequence in your PDF',
    badgeClass: 'badge-amber',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/></svg>`
  },
  {
    id: 'watermark_pdf',
    name: 'Add Watermark',
    desc: 'Overlay text or image watermarks onto pages',
    badgeClass: 'badge-teal',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`
  },
  {
    id: 'page_numbers',
    name: 'Add Page Numbers',
    desc: 'Insert customizable page numbers to your document',
    badgeClass: 'badge-azure',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="12" y1="8" x2="12" y2="14"/></svg>`
  },
  {
    id: 'convert_images',
    name: 'Convert to Images',
    desc: 'Export PDF pages as JPG or PNG images',
    badgeClass: 'badge-purple',
    iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
  }
];

// Recent Operations Store in LocalStorage
function getRecentOperations() {
  try {
    const raw = localStorage.getItem('vs_studio_recent_ops');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // Default mock recent operations matching aesthetic mockup
  return [
    {
      id: 'op_1',
      file: 'financial_report_2024.pdf',
      operation: 'Merge',
      date: 'Today, 2:45 PM',
      status: 'Completed',
      actionUrl: '#'
    },
    {
      id: 'op_2',
      file: 'tax_audit_dossier.pdf',
      operation: 'Compress',
      date: 'Today, 1:12 PM',
      status: 'Completed',
      actionUrl: '#'
    },
    {
      id: 'op_3',
      file: 'gst_annual_return_signed.pdf',
      operation: 'Watermark',
      date: 'Yesterday, 5:30 PM',
      status: 'Completed',
      actionUrl: '#'
    }
  ];
}

function saveRecentOperation(op) {
  try {
    const ops = getRecentOperations();
    ops.unshift(op);
    if (ops.length > 20) ops.pop();
    localStorage.setItem('vs_studio_recent_ops', JSON.stringify(ops));
  } catch (e) {}
}

function safeNavigate(page) {
  if (typeof window.safeNavigate === 'function' && window.safeNavigate !== safeNavigate) {
    window.safeNavigate(page);
    return;
  }
  if (typeof window.navigateTo === 'function') {
    window.navigateTo(page);
    return;
  }
  window.location.hash = page;
}
window.safeNavigate = safeNavigate;

// Expose open session helper globally
window.openPdfStudioSession = function(session, thumbnails, originContext) {
  currentPdfSession = session;
  currentThumbnails = thumbnails || [];
  currentPreviewPage = 1;
  currentZoom = 1.0;
  pdfStudioOriginContext = originContext || null;

  if (session && session.current_name) {
    studioFiles = [{
      id: 'sess_file_' + Date.now(),
      name: session.current_name,
      size: session.current_size || 0,
      isSession: true
    }];
  }

  safeNavigate('studio');
};

// Main Studio Entry Page
async function pdfStudioPage() {
  const content = document.getElementById('content');
  if (!content) return;
  renderStudioLayout(content);
}

// Render Complete Studio Layout (Parity with Desired/PDF Studio.png)
function renderStudioLayout(content) {
  content.innerHTML = `
    <div class="studio-page-container">
      <!-- HEADER SECTION -->
      <header class="studio-header">
        <div class="studio-header-left">
          <h1 class="studio-title">Studio</h1>
          <p class="studio-subtitle">Organize, convert, secure, and edit PDF documents with ease</p>
        </div>
        <div class="studio-header-right">
          <div class="studio-quote-badge">
            <span>“ Same Files. A Smarter Way.® ”</span>
          </div>
        </div>
      </header>

      <!-- 12 TOOL CARDS GRID (2 Rows of 6) -->
      <section class="studio-tools-grid" id="studio-tools-grid">
        ${renderToolCardsHtml()}
      </section>

      <!-- WORKSPACE GRID: 3 COLUMNS -->
      <main class="studio-workspace-grid">
        <!-- COLUMN 1: ADD FILES -->
        <div class="studio-files-col studio-card">
          <div class="studio-card-header">
            <span class="studio-card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Add Files
            </span>
            <span id="studio-file-limit-badge" style="font-size: 11px; color: #94a3b8; font-weight: 500;">Max 50MB</span>
          </div>

          <!-- DROPZONE -->
          <div class="studio-dropzone" id="studio-dropzone">
            <div class="studio-drop-icon">
              <svg class="i" style="width:36px;height:36px;stroke:var(--pri);stroke-width:1.6;"><use href="#folder"/></svg>
            </div>
            <div class="studio-drop-title">Choose PDF files</div>
            <div class="studio-drop-sub">or drag & drop files here</div>
            <button type="button" class="studio-choose-btn" id="studio-choose-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Choose Files
            </button>
            <div class="studio-drop-foot">Supports PDF documents up to 50MB</div>
            <input type="file" id="studio-hidden-file-input" multiple accept="application/pdf,.pdf" style="display:none;">
          </div>

          <!-- SELECTED FILES LIST -->
          <div class="studio-files-header">
            <span class="studio-files-count" id="studio-files-count">Selected Files (${studioFiles.length})</span>
            ${studioFiles.length > 0 ? `<button type="button" class="studio-clear-btn" id="studio-clear-files-btn">Clear all</button>` : ''}
          </div>

          <div class="studio-files-list" id="studio-files-list">
            ${renderSelectedFilesListHtml()}
          </div>
        </div>

        <!-- COLUMN 2: TOOL SETTINGS -->
        <div class="studio-settings-col studio-card" id="studio-settings-container">
          ${renderToolSettingsHtml(studioSelectedTool)}
        </div>

        <!-- COLUMN 3: PREVIEW & RECENT OPERATIONS -->
        <div class="studio-preview-col">
          <!-- PREVIEW CARD -->
          <div class="studio-card studio-preview-card" style="margin-bottom: 16px;">
            <div class="studio-card-header" style="margin-bottom: 8px;">
              <span class="studio-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview
              </span>
              <div class="studio-preview-toolbar">
                <button type="button" class="studio-prev-tool-btn" id="btn-studio-zoom-out" title="Zoom Out">−</button>
                <span class="studio-zoom-label" id="studio-zoom-label">${Math.round(currentZoom * 100)}%</span>
                <button type="button" class="studio-prev-tool-btn" id="btn-studio-zoom-in" title="Zoom In">+</button>
                <div class="studio-tool-sep"></div>
                <button type="button" class="studio-prev-tool-btn" id="btn-studio-page-prev" ${currentPreviewPage <= 1 ? 'disabled' : ''} title="Previous Page">◀</button>
                <span class="studio-page-indicator" id="studio-page-indicator">${currentPdfSession ? `Page ${currentPreviewPage} of ${currentPdfSession.page_count}` : 'Page 1 of 1'}</span>
                <button type="button" class="studio-prev-tool-btn" id="btn-studio-page-next" ${(!currentPdfSession || currentPreviewPage >= currentPdfSession.page_count) ? 'disabled' : ''} title="Next Page">▶</button>
                <div class="studio-tool-sep"></div>
                <button type="button" class="studio-prev-tool-btn" id="btn-studio-open-ext" title="Open in new window">↗</button>
              </div>
            </div>

            <!-- PREVIEW STAGE -->
            <div class="studio-preview-stage" id="studio-preview-stage">
              ${renderPreviewStageHtml()}
            </div>
          </div>

          <!-- RECENT OPERATIONS CARD -->
          <div class="studio-card studio-recent-card">
            <div class="studio-card-header" style="margin-bottom: 10px;">
              <span class="studio-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Recent Operations
              </span>
              <button type="button" class="studio-prev-tool-btn" id="btn-clear-recent-ops" title="Refresh Operations">↺</button>
            </div>

            <div class="studio-recent-table-wrap">
              <table class="studio-recent-table">
                <thead>
                  <tr>
                    <th>FILE</th>
                    <th>OPERATION</th>
                    <th>DATE</th>
                    <th>STATUS</th>
                    <th style="text-align: right;">ACTION</th>
                  </tr>
                </thead>
                <tbody id="studio-recent-tbody">
                  ${renderRecentOperationsHtml()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  `;

  bindStudioEvents();
}

// Render 12 Tool Cards HTML
function renderToolCardsHtml() {
  return STUDIO_TOOLS.map(t => {
    const isActive = (t.id === studioSelectedTool);
    return `
      <div class="studio-tool-card ${isActive ? 'active' : ''}" data-tool-id="${t.id}" id="tool-card-${t.id}">
        <div class="studio-tool-badge ${t.badgeClass}">
          ${t.iconSvg}
        </div>
        <div class="studio-tool-info">
          <div class="studio-tool-title">${t.name}</div>
          <div class="studio-tool-desc">${t.desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Format bytes to human readable
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Render Selected Files List
function renderSelectedFilesListHtml() {
  if (studioFiles.length === 0) {
    return `
      <div style="text-align: center; padding: 24px 12px; color: #94a3b8; font-size: 12.5px;">
        No files selected yet.<br>Choose or drop PDF files above to begin.
      </div>
    `;
  }

  return studioFiles.map((f, idx) => `
    <div class="studio-file-item" data-index="${idx}">
      <div class="studio-file-drag">⋮⋮</div>
      <div class="studio-file-icon">PDF</div>
      <div class="studio-file-details">
        <div class="studio-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="studio-file-size">${formatFileSize(f.size)}</div>
      </div>
      <button type="button" class="studio-file-remove" data-remove-index="${idx}" title="Remove file"><svg class="i" style="width:12px;height:12px;"><use href="#close"/></svg></button>
    </div>
  `).join('');
}

// Render Dynamic Tool Settings
function renderToolSettingsHtml(toolId) {
  const tool = STUDIO_TOOLS.find(t => t.id === toolId) || STUDIO_TOOLS[0];
  let customControlsHtml = '';

  switch (toolId) {
    case 'merge_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Merge Order</label>
          <select class="studio-input" id="setting-merge-order">
            <option value="append" selected>Append in listed order</option>
            <option value="prepend">Prepend to first document</option>
          </select>
        </div>
        <div class="studio-form-group">
          <label class="studio-check-label">
            <input type="checkbox" id="setting-merge-bookmarks" checked>
            <span>Add bookmark for each document</span>
          </label>
          <label class="studio-check-label">
            <input type="checkbox" id="setting-merge-normalize" checked>
            <span>Normalize page sizes to standard A4</span>
          </label>
        </div>
      `;
      break;

    case 'split_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Split Mode</label>
          <select class="studio-input" id="setting-split-mode">
            <option value="extract_range" selected>Extract Page Range</option>
            <option value="split_single">Split each page into separate PDF</option>
          </select>
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Page Range</label>
          <input type="text" class="studio-input" id="setting-split-range" value="1-3, 5" placeholder="e.g. 1-5, 8, 11-14">
          <div class="studio-hint">Specify comma-separated pages and ranges.</div>
        </div>
      `;
      break;

    case 'rotate_pages':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Rotation Angle</label>
          <div style="display:flex;gap:8px;">
            <button type="button" class="studio-opt-btn active" data-angle="90">90° CW ↻</button>
            <button type="button" class="studio-opt-btn" data-angle="180">180° ↺</button>
            <button type="button" class="studio-opt-btn" data-angle="270">270° (90° CCW)</button>
          </div>
          <input type="hidden" id="setting-rotate-angle" value="90">
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Pages to Rotate</label>
          <select class="studio-input" id="setting-rotate-target">
            <option value="all" selected>All pages</option>
            <option value="even">Even pages only</option>
            <option value="odd">Odd pages only</option>
          </select>
        </div>
      `;
      break;

    case 'compress_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Compression Level</label>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px;">
            <div class="studio-level-card" data-level="low">
              <strong>Low</strong>
              <span>Minor reduction, max quality</span>
            </div>
            <div class="studio-level-card active" data-level="balanced">
              <strong>Balanced</strong>
              <span>Recommended (40-60% saved)</span>
            </div>
            <div class="studio-level-card" data-level="high">
              <strong>High</strong>
              <span>Smallest size, web/email</span>
            </div>
          </div>
          <input type="hidden" id="setting-compress-level" value="balanced">
        </div>
      `;
      break;

    case 'unlock_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Document Password</label>
          <input type="password" class="studio-input" id="setting-unlock-pw" placeholder="Enter password to decrypt">
          <div class="studio-hint">Unlocks and permanently removes password restrictions.</div>
        </div>
      `;
      break;

    case 'lock_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">User Password (To Open)</label>
          <input type="password" class="studio-input" id="setting-lock-user-pw" placeholder="Required to open PDF">
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Owner Password (Optional)</label>
          <input type="password" class="studio-input" id="setting-lock-owner-pw" placeholder="Administrative permissions password">
        </div>
        <div class="studio-form-group">
          <label class="studio-check-label">
            <input type="checkbox" id="setting-lock-allow-print" checked>
            <span>Allow High Quality Printing</span>
          </label>
        </div>
      `;
      break;

    case 'extract_pages':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Pages to Extract</label>
          <input type="text" class="studio-input" id="setting-extract-pages" value="1, 3, 5" placeholder="e.g. 1, 3, 5-8">
          <div class="studio-hint">Only selected pages will be kept in the new PDF.</div>
        </div>
      `;
      break;

    case 'delete_pages':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Pages to Delete</label>
          <input type="text" class="studio-input" id="setting-delete-pages" placeholder="e.g. 2, 4-6">
          <div class="studio-hint">Selected pages will be permanently removed from the document.</div>
        </div>
      `;
      break;

    case 'rearrange_pages':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">New Page Sequence</label>
          <input type="text" class="studio-input" id="setting-reorder-sequence" placeholder="e.g. 3, 1, 2, 4">
          <div class="studio-hint">Enter the new desired 1-based order of pages.</div>
        </div>
      `;
      break;

    case 'watermark_pdf':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Watermark Text</label>
          <input type="text" class="studio-input" id="setting-watermark-text" value="CONFIDENTIAL" placeholder="e.g. CONFIDENTIAL, DRAFT, COPY">
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Placement Position</label>
          <select class="studio-input" id="setting-watermark-pos">
            <option value="center_diagonal" selected>Center Diagonal (45°)</option>
            <option value="center_horizontal">Center Horizontal</option>
            <option value="top_header">Top Header</option>
            <option value="bottom_footer">Bottom Footer</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="studio-form-group">
            <label class="studio-label">Opacity (25%)</label>
            <input type="range" class="studio-range" id="setting-watermark-opacity" min="0.05" max="1.0" step="0.05" value="0.25">
          </div>
          <div class="studio-form-group">
            <label class="studio-label">Color</label>
            <input type="color" class="studio-color-picker" id="setting-watermark-color" value="#DC2626">
          </div>
        </div>
      `;
      break;

    case 'page_numbers':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Position</label>
          <select class="studio-input" id="setting-num-pos">
            <option value="bottom_right" selected>Bottom Right</option>
            <option value="bottom_center">Bottom Center</option>
            <option value="bottom_left">Bottom Left</option>
            <option value="top_right">Top Right</option>
            <option value="top_center">Top Center</option>
          </select>
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Format Style</label>
          <select class="studio-input" id="setting-num-format">
            <option value="Page {n} of {total}" selected>Page 1 of 10</option>
            <option value="{n} / {total}">1 / 10</option>
            <option value="Page {n}">Page 1</option>
            <option value="{n}">1</option>
          </select>
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Start Page Number</label>
          <input type="number" class="studio-input" id="setting-num-start" value="1" min="1">
        </div>
      `;
      break;

    case 'convert_images':
      customControlsHtml = `
        <div class="studio-form-group">
          <label class="studio-label">Image Format</label>
          <select class="studio-input" id="setting-convert-fmt">
            <option value="png" selected>PNG (Lossless High Quality)</option>
            <option value="jpeg">JPEG (Compressed Photo)</option>
          </select>
        </div>
        <div class="studio-form-group">
          <label class="studio-label">Resolution DPI</label>
          <select class="studio-input" id="setting-convert-dpi">
            <option value="150" selected>150 DPI (Standard Screen/Print)</option>
            <option value="300">300 DPI (High Resolution Print)</option>
            <option value="72">72 DPI (Web Low Size)</option>
          </select>
        </div>
      `;
      break;

    default:
      break;
  }

  const defaultOutName = (currentPdfSession && currentPdfSession.current_name)
    ? currentPdfSession.current_name.replace(/\.pdf$/i, '') + '_' + toolId.replace('_', '-') + '.pdf'
    : (studioFiles[0] ? studioFiles[0].name.replace(/\.pdf$/i, '') + '_' + toolId.replace('_', '-') + '.pdf' : 'document_processed.pdf');

  return `
    <div class="studio-card-header">
      <span class="studio-card-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        ${tool.name} Settings
      </span>
      <span class="studio-status-pill green">Ready</span>
    </div>

    <div class="studio-form-group">
      <label class="studio-label">Output File Name</label>
      <input type="text" class="studio-input" id="setting-output-filename" value="${escapeHtml(defaultOutName)}" placeholder="e.g. document_output.pdf">
    </div>

    ${customControlsHtml}

    <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 10px;">
      <button type="button" class="studio-action-btn" id="btn-studio-execute" ${isExecutingStudioTool ? 'disabled' : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        <span>${tool.name}</span>
      </button>

      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-sm" id="btn-studio-undo" ${(currentPdfSession && currentPdfSession.checkpoint_stack && currentPdfSession.checkpoint_stack.length > 0) ? '' : 'disabled'} style="flex:1;">
          <svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#refresh"/></svg>Undo
        </button>
        <button type="button" class="btn btn-sm" id="btn-studio-reset" ${currentPdfSession ? '' : 'disabled'} style="flex:1;">
          <svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#refresh"/></svg>Reset
        </button>
        ${(currentPdfSession || studioFiles.length > 0) ? `
          <button type="button" class="btn btn-sm primary" id="btn-studio-save-client" style="flex:1.2;">
            <svg class="i" style="width:13px;height:13px;margin-right:4px;"><use href="#folder"/></svg>Save to Client
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// Render Preview Stage HTML
function renderPreviewStageHtml() {
  if (currentPdfSession) {
    return `
      <div class="studio-preview-canvas" style="transform: scale(${currentZoom}); transform-origin: top center; transition: transform 0.15s ease;">
        <img id="studio-main-preview-img" 
             src="/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/page/${currentPreviewPage}?dpi=130&t=${Date.now()}" 
             alt="Page ${currentPreviewPage}" 
             style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); background:#fff;" />
      </div>
    `;
  }

  // Realistic mock preview when no active session
  return `
    <div class="studio-preview-canvas" style="transform: scale(${currentZoom}); transform-origin: top center; transition: transform 0.15s ease;">
      <div class="studio-mock-page">
        <div class="studio-mock-header">
          <div class="studio-mock-logo">VS</div>
          <div style="font-size: 11px; font-weight: 700; color: #1e293b;">CHARTERED ACCOUNTANTS & CO.</div>
        </div>
        <div class="studio-mock-title">ANNUAL FINANCIAL REPORT & AUDIT DOSSIER</div>
        <div class="studio-mock-line" style="width: 90%;"></div>
        <div class="studio-mock-line" style="width: 82%;"></div>
        <div class="studio-mock-line" style="width: 75%;"></div>
        <div class="studio-mock-table">
          <div class="row header">
            <span>Particulars</span>
            <span>FY 2023-24</span>
            <span>FY 2024-25</span>
          </div>
          <div class="row">
            <span>Gross Revenue</span>
            <span>₹ 1,42,85,000</span>
            <span>₹ 1,88,40,000</span>
          </div>
          <div class="row">
            <span>Direct Operating Costs</span>
            <span>₹ 84,20,000</span>
            <span>₹ 1,02,15,000</span>
          </div>
          <div class="row">
            <span>Net Taxable Income</span>
            <span>₹ 58,65,000</span>
            <span>₹ 86,25,000</span>
          </div>
        </div>
        <div class="studio-mock-stamp">VERIFIED & AUDITED</div>
      </div>
    </div>
  `;
}

// Render Recent Operations Rows
function renderRecentOperationsHtml() {
  const ops = getRecentOperations();
  if (ops.length === 0) {
    return `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:16px;">No recent operations</td></tr>`;
  }

  return ops.map(op => `
    <tr>
      <td>
        <div class="studio-recent-file">
          <svg class="i" style="width:14px;height:14px;margin-right:6px;stroke:#64748b;"><use href="#clip"/></svg>
          <span class="name" title="${escapeHtml(op.file)}">${escapeHtml(op.file)}</span>
        </div>
      </td>
      <td>
        <span class="studio-op-badge">${escapeHtml(op.operation)}</span>
      </td>
      <td style="color:#64748b;font-size:11.5px;">${escapeHtml(op.date)}</td>
      <td>
        <span class="studio-status-pill green">Completed</span>
      </td>
      <td style="text-align:right;">
        <button type="button" class="studio-action-icon-btn" onclick="handleRecentOpAction('${op.id}')" title="Open or Download">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

window.handleRecentOpAction = function(opId) {
  if (currentPdfSession) {
    window.open(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/download`, '_blank');
  } else {
    if (typeof showNativeToast === 'function') {
      showNativeToast('Operation completed and saved.', 'info');
    }
  }
};

// Bind Interactive Studio Events
function bindStudioEvents() {
  // 1. Tool Cards Selection
  document.querySelectorAll('.studio-tool-card').forEach(card => {
    card.onclick = () => {
      const toolId = card.getAttribute('data-tool-id');
      if (toolId && toolId !== studioSelectedTool) {
        studioSelectedTool = toolId;
        // Update active class on cards
        document.querySelectorAll('.studio-tool-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        // Re-render settings container
        const settingsContainer = document.getElementById('studio-settings-container');
        if (settingsContainer) {
          settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
          bindSettingsControls();
        }
      }
    };
  });

  // 2. Dropzone & File Input
  const dropzone = document.getElementById('studio-dropzone');
  const fileInput = document.getElementById('studio-hidden-file-input');
  const chooseBtn = document.getElementById('studio-choose-btn');

  if (dropzone && fileInput) {
    if (chooseBtn) {
      chooseBtn.onclick = (e) => {
        e.stopPropagation();
        fileInput.click();
      };
    }
    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        await handleFilesAdded(files);
      }
      fileInput.value = '';
    };

    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    };
    dropzone.ondragleave = () => {
      dropzone.classList.remove('dragover');
    };
    dropzone.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      if (files.length > 0) {
        await handleFilesAdded(files);
      } else {
        if (typeof showNativeToast === 'function') {
          showNativeToast('Please drop valid PDF documents.', 'warning');
        } else {
          alert('Please drop valid PDF documents.');
        }
      }
    };
  }

  // 3. Clear Files
  const clearBtn = document.getElementById('studio-clear-files-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      studioFiles = [];
      currentPdfSession = null;
      currentThumbnails = [];
      refreshFilesUi();
      refreshPreviewUi();
      const settingsContainer = document.getElementById('studio-settings-container');
      if (settingsContainer) {
        settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
        bindSettingsControls();
      }
    };
  }

  // 4. Preview Toolbar controls
  const zoomInBtn = document.getElementById('btn-studio-zoom-in');
  const zoomOutBtn = document.getElementById('btn-studio-zoom-out');
  const pagePrevBtn = document.getElementById('btn-studio-page-prev');
  const pageNextBtn = document.getElementById('btn-studio-page-next');
  const openExtBtn = document.getElementById('btn-studio-open-ext');

  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      currentZoom = Math.min(2.0, currentZoom + 0.15);
      refreshPreviewUi();
    };
  }
  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      currentZoom = Math.max(0.4, currentZoom - 0.15);
      refreshPreviewUi();
    };
  }
  if (pagePrevBtn) {
    pagePrevBtn.onclick = () => {
      if (currentPreviewPage > 1) {
        currentPreviewPage--;
        refreshPreviewUi();
      }
    };
  }
  if (pageNextBtn) {
    pageNextBtn.onclick = () => {
      if (currentPdfSession && currentPreviewPage < currentPdfSession.page_count) {
        currentPreviewPage++;
        refreshPreviewUi();
      }
    };
  }
  if (openExtBtn) {
    openExtBtn.onclick = () => {
      if (currentPdfSession) {
        window.open(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/page/${currentPreviewPage}?dpi=200`, '_blank');
      }
    };
  }

  // 5. Remove Individual Files
  bindFileRemoveHandlers();

  // 6. Bind Tool Settings Form Controls
  bindSettingsControls();
}

function bindFileRemoveHandlers() {
  document.querySelectorAll('.studio-file-remove').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-remove-index'));
      if (!isNaN(idx) && idx >= 0 && idx < studioFiles.length) {
        studioFiles.splice(idx, 1);
        if (studioFiles.length === 0) {
          currentPdfSession = null;
        }
        refreshFilesUi();
        refreshPreviewUi();
      }
    };
  });
}

function bindSettingsControls() {
  // Option buttons (e.g. Rotate angles)
  document.querySelectorAll('.studio-opt-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.studio-opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const angle = btn.getAttribute('data-angle');
      const hidden = document.getElementById('setting-rotate-angle');
      if (hidden) hidden.value = angle;
    };
  });

  // Level cards (e.g. Compress)
  document.querySelectorAll('.studio-level-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.studio-level-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const level = card.getAttribute('data-level');
      const hidden = document.getElementById('setting-compress-level');
      if (hidden) hidden.value = level;
    };
  });

  // Opacity range
  const opacityRange = document.getElementById('setting-watermark-opacity');
  if (opacityRange) {
    opacityRange.oninput = (e) => {
      const lbl = opacityRange.parentElement.querySelector('.studio-label');
      if (lbl) lbl.textContent = `Opacity (${Math.round(e.target.value * 100)}%)`;
    };
  }

  // Primary Action Execute Button
  const execBtn = document.getElementById('btn-studio-execute');
  if (execBtn) {
    execBtn.onclick = async () => {
      await handleStudioToolExecute();
    };
  }

  // Undo Button
  const undoBtn = document.getElementById('btn-studio-undo');
  if (undoBtn) {
    undoBtn.onclick = async () => {
      if (!currentPdfSession) return;
      try {
        const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/undo`, {
          method: 'POST',
          body: '{}'
        });
        if (res && res.ok && res.session) {
          currentPdfSession = res.session;
          currentThumbnails = res.thumbnails;
          currentPreviewPage = Math.min(currentPreviewPage, res.session.page_count);
          refreshPreviewUi();
          const settingsContainer = document.getElementById('studio-settings-container');
          if (settingsContainer) {
            settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
            bindSettingsControls();
          }
          if (typeof showNativeToast === 'function') {
            showNativeToast('Undo successful.', 'info');
          }
        }
      } catch (err) {
        alert('Undo failed: ' + err.message);
      }
    };
  }

  // Reset Button
  const resetBtn = document.getElementById('btn-studio-reset');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (!currentPdfSession) return;
      if (!confirm('Reset all changes back to original document?')) return;
      try {
        const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/reset`, {
          method: 'POST',
          body: '{}'
        });
        if (res && res.ok && res.session) {
          currentPdfSession = res.session;
          currentThumbnails = res.thumbnails;
          currentPreviewPage = 1;
          refreshPreviewUi();
          const settingsContainer = document.getElementById('studio-settings-container');
          if (settingsContainer) {
            settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
            bindSettingsControls();
          }
          if (typeof showNativeToast === 'function') {
            showNativeToast('Reset to original document.', 'info');
          }
        }
      } catch (err) {
        alert('Reset failed: ' + err.message);
      }
    };
  }

  // Save to Client Button
  const saveClientBtn = document.getElementById('btn-studio-save-client');
  if (saveClientBtn) {
    saveClientBtn.onclick = async () => {
      await handleSaveToClientHandoff();
    };
  }
}

// Convert File to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Handle Files Added into the Queue
async function handleFilesAdded(files) {
  for (const f of files) {
    const b64 = await fileToBase64(f);
    studioFiles.push({
      id: 'file_' + Math.random().toString(36).substr(2, 9),
      file: f,
      name: f.name,
      size: f.size,
      base64: b64
    });
  }

  refreshFilesUi();

  // If no session exists yet, initialize backend session with the first file or multi-file
  if (!currentPdfSession && studioFiles.length > 0) {
    try {
      const payloadFiles = studioFiles.map(sf => ({ name: sf.name, data: sf.base64 }));
      const res = await api('/api/pdf-studio/sessions', {
        method: 'POST',
        body: JSON.stringify({
          original_name: studioFiles[0].name,
          files: payloadFiles
        })
      });
      if (res && res.ok && res.session) {
        currentPdfSession = res.session;
        currentThumbnails = res.thumbnails || [];
        currentPreviewPage = 1;
        refreshPreviewUi();
      }
    } catch (err) {
      console.warn('Backend session init deferred:', err);
    }
  }

  const settingsContainer = document.getElementById('studio-settings-container');
  if (settingsContainer) {
    settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
    bindSettingsControls();
  }
}

// Refresh Left Files List UI
function refreshFilesUi() {
  const countEl = document.getElementById('studio-files-count');
  if (countEl) countEl.textContent = `Selected Files (${studioFiles.length})`;

  const listEl = document.getElementById('studio-files-list');
  if (listEl) {
    listEl.innerHTML = renderSelectedFilesListHtml();
    bindFileRemoveHandlers();
  }

  // Update clear button
  const headerEl = document.querySelector('.studio-files-header');
  if (headerEl) {
    let clearBtn = document.getElementById('studio-clear-files-btn');
    if (studioFiles.length > 0 && !clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'studio-clear-btn';
      clearBtn.id = 'studio-clear-files-btn';
      clearBtn.textContent = 'Clear all';
      headerEl.appendChild(clearBtn);
      clearBtn.onclick = () => {
        studioFiles = [];
        currentPdfSession = null;
        refreshFilesUi();
        refreshPreviewUi();
      };
    } else if (studioFiles.length === 0 && clearBtn) {
      clearBtn.remove();
    }
  }
}

// Refresh Preview UI
function refreshPreviewUi() {
  const stage = document.getElementById('studio-preview-stage');
  if (stage) stage.innerHTML = renderPreviewStageHtml();

  const zoomLbl = document.getElementById('studio-zoom-label');
  if (zoomLbl) zoomLbl.textContent = `${Math.round(currentZoom * 100)}%`;

  const pageInd = document.getElementById('studio-page-indicator');
  if (pageInd) {
    pageInd.textContent = currentPdfSession ? `Page ${currentPreviewPage} of ${currentPdfSession.page_count}` : 'Page 1 of 1';
  }

  const prevBtn = document.getElementById('btn-studio-page-prev');
  const nextBtn = document.getElementById('btn-studio-page-next');
  if (prevBtn) prevBtn.disabled = (currentPreviewPage <= 1);
  if (nextBtn) nextBtn.disabled = (!currentPdfSession || currentPreviewPage >= currentPdfSession.page_count);
}

// Execute Active Studio Tool
async function handleStudioToolExecute() {
  if (isExecutingStudioTool) return;

  if (studioFiles.length === 0 && !currentPdfSession) {
    if (typeof showNativeToast === 'function') {
      showNativeToast('Please select or add at least one PDF file first.', 'warning');
    } else {
      alert('Please select or add at least one PDF file first.');
    }
    return;
  }

  isExecutingStudioTool = true;
  const execBtn = document.getElementById('btn-studio-execute');
  if (execBtn) {
    execBtn.disabled = true;
    execBtn.innerHTML = `<span class="studio-spinner"></span> Processing...`;
  }

  // Ensure active session exists
  if (!currentPdfSession) {
    try {
      const payloadFiles = studioFiles.map(sf => ({ name: sf.name, data: sf.base64 }));
      const sRes = await api('/api/pdf-studio/sessions', {
        method: 'POST',
        body: JSON.stringify({
          original_name: studioFiles[0].name,
          files: payloadFiles
        })
      });
      if (sRes && sRes.ok && sRes.session) {
        currentPdfSession = sRes.session;
        currentThumbnails = sRes.thumbnails || [];
      }
    } catch (err) {
      alert('Failed to initialize PDF session: ' + err.message);
      isExecutingStudioTool = false;
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg> <span>${studioSelectedTool.replace('_', ' ').toUpperCase()}</span>`;
      }
      return;
    }
  }

  // Gather Tool Parameters
  const params = {};
  const outNameInput = document.getElementById('setting-output-filename');
  const outputName = outNameInput ? outNameInput.value.trim() : 'document_processed.pdf';

  switch (studioSelectedTool) {
    case 'merge_pdf':
      const addFiles = studioFiles.slice(1).map(sf => sf.base64);
      params.additional_files = addFiles;
      params.order = document.getElementById('setting-merge-order')?.value || 'append';
      break;

    case 'split_pdf':
      params.mode = document.getElementById('setting-split-mode')?.value || 'extract_range';
      params.page_range = document.getElementById('setting-split-range')?.value || '1';
      break;

    case 'rotate_pages':
      params.angle = parseInt(document.getElementById('setting-rotate-angle')?.value || '90');
      params.pages = document.getElementById('setting-rotate-target')?.value || 'all';
      break;

    case 'compress_pdf':
      params.level = document.getElementById('setting-compress-level')?.value || 'balanced';
      break;

    case 'unlock_pdf':
      params.password = document.getElementById('setting-unlock-pw')?.value || '';
      break;

    case 'lock_pdf':
      params.user_password = document.getElementById('setting-lock-user-pw')?.value || '';
      params.owner_password = document.getElementById('setting-lock-owner-pw')?.value || '';
      break;

    case 'extract_pages':
      params.mode = 'extract_range';
      params.page_range = document.getElementById('setting-extract-pages')?.value || '1';
      break;

    case 'delete_pages':
      const delStr = document.getElementById('setting-delete-pages')?.value || '';
      params.page_range = delStr;
      break;

    case 'rearrange_pages':
      const seqStr = document.getElementById('setting-reorder-sequence')?.value || '';
      const order = seqStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      params.new_order = order;
      break;

    case 'watermark_pdf':
      params.text = document.getElementById('setting-watermark-text')?.value || 'CONFIDENTIAL';
      params.position = document.getElementById('setting-watermark-pos')?.value || 'center_diagonal';
      params.opacity = parseFloat(document.getElementById('setting-watermark-opacity')?.value || '0.25');
      params.color = document.getElementById('setting-watermark-color')?.value || '#DC2626';
      break;

    case 'page_numbers':
      params.position = document.getElementById('setting-num-pos')?.value || 'bottom_right';
      params.format = document.getElementById('setting-num-format')?.value || 'Page {n} of {total}';
      params.start_number = parseInt(document.getElementById('setting-num-start')?.value || '1');
      break;

    case 'convert_images':
      params.format = document.getElementById('setting-convert-fmt')?.value || 'png';
      params.dpi = parseInt(document.getElementById('setting-convert-dpi')?.value || '150');
      break;
  }

  try {
    const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        tool_id: studioSelectedTool,
        parameters: params
      })
    });

    if (res && res.ok) {
      if (res.session) {
        currentPdfSession = res.session;
        if (outputName) currentPdfSession.current_name = outputName;
      }
      currentThumbnails = res.thumbnails || [];
      currentPreviewPage = 1;

      // Log to Recent Operations
      const activeToolObj = STUDIO_TOOLS.find(t => t.id === studioSelectedTool);
      saveRecentOperation({
        id: 'op_' + Date.now(),
        file: outputName || currentPdfSession.current_name,
        operation: activeToolObj ? activeToolObj.name : studioSelectedTool,
        date: 'Just now',
        status: 'Completed',
        actionUrl: `/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/download`
      });

      // Update Recent Operations Table
      const recentTbody = document.getElementById('studio-recent-tbody');
      if (recentTbody) recentTbody.innerHTML = renderRecentOperationsHtml();

      refreshPreviewUi();

      const settingsContainer = document.getElementById('studio-settings-container');
      if (settingsContainer) {
        settingsContainer.innerHTML = renderToolSettingsHtml(studioSelectedTool);
        bindSettingsControls();
      }

      if (typeof showNativeToast === 'function') {
        const msg = (res.result && res.result.message) ? res.result.message : `${activeToolObj?.name || 'Tool'} completed successfully!`;
        showNativeToast(msg, 'success', 3500);
      }
    }
  } catch (err) {
    if (typeof showNativeAlert === 'function') {
      showNativeAlert(err.message, { title: 'Execution Failed', type: 'error' });
    } else {
      alert(`Operation failed: ${err.message}`);
    }
  } finally {
    isExecutingStudioTool = false;
    const currentBtn = document.getElementById('btn-studio-execute');
    if (currentBtn) {
      currentBtn.disabled = false;
      const t = STUDIO_TOOLS.find(x => x.id === studioSelectedTool);
      currentBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg> <span>${t ? t.name : 'Execute'}</span>`;
    }
  }
}

// Handle Save to Client Handoff
async function handleSaveToClientHandoff() {
  if (!currentPdfSession) {
    if (typeof showNativeToast === 'function') {
      showNativeToast('No active PDF session to save.', 'warning');
    } else {
      alert('No active PDF session to save.');
    }
    return;
  }

  if (pdfStudioOriginContext && window.saveStaging) {
    try {
      const pb = (typeof showGlassProgressBar === 'function')
        ? showGlassProgressBar({ title: 'Applying to Save Queue', subtitle: 'Updating staging session on disk...' })
        : null;
      if (pb) pb.simulate(1000);
      await window.saveStaging.applyPdfStudioResult(currentPdfSession.session_id, currentPdfSession.current_name);
      if (pb) await pb.finish('Applied to Save Queue');
      if (typeof showNativeToast === 'function') {
        showNativeToast('Document returned to Save Queue successfully.', 'success', 3000);
      }
    } catch (err) {
      alert('Failed to return to Save Tab: ' + err.message);
    }
  } else {
    // Direct switch to Save Tab or trigger direct browser download
    window.open(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/download`, '_blank');
    if (typeof showNativeToast === 'function') {
      showNativeToast('Document downloaded successfully.', 'success', 3000);
    }
  }
}

// Global Export
window.pdfStudioPage = pdfStudioPage;
window.renderStudioLayout = renderStudioLayout;
window.STUDIO_TOOLS = STUDIO_TOOLS;
