(function () {
'use strict';

/**
 * VS Database — Studio Subsystem (PdfCraft Workbench)
 * 3-Pane Glassmorphic Workbench Architecture.
 * Standardized 200ms cubic-bezier(0.16, 1, 0.3, 1) animations.
 * Strictly scoped under #studio-root and #studio-portal.
 * Zero emojis: 100% clean SVG line icons.
 */

// ============================================================
// DATA-DRIVEN CATEGORIES & TOOLS REGISTRY
// ============================================================
const STUDIO_CATEGORIES = [
  {
    id: "pdf",
    name: "PDF Tools",
    icon: "M6 3h8l4 4v14H6zM14 3v4h4",
    tools: [
      {
        id: "merge",
        name: "Merge PDF",
        desc: "Combine PDFs into one",
        icon: "M6 4v6a4 4 0 004 4h8M14 10l4 4-4 4",
        backendTool: "merge_pdf"
      },
      {
        id: "split",
        name: "Split PDF",
        desc: "Pages or page ranges",
        icon: "M12 4v16M5 8l-2 4 2 4M19 8l2 4-2 4",
        backendTool: "split_pdf"
      },
      {
        id: "rotate",
        name: "Rotate PDF",
        desc: "Rotate pages 90, 180, 270",
        icon: "M20 12a8 8 0 10-3 6.2M20 5v5h-5",
        backendTool: "rotate_pages"
      },
      {
        id: "compress",
        name: "Compress PDF",
        desc: "Reduce file size",
        icon: "M12 3v7M8 7l4 4 4-4M12 21v-7M8 17l4-4 4 4",
        backendTool: "compress_pdf"
      },
      {
        id: "unlock",
        name: "Unlock PDF",
        desc: "Remove the password",
        icon: "M7 11V8a5 5 0 019-3M5 11h14v9H5z",
        backendTool: "unlock_pdf"
      },
      {
        id: "protect",
        name: "Protect PDF",
        desc: "Secure with a password",
        icon: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
        backendTool: "lock_pdf"
      },
      {
        id: "extract",
        name: "Extract Pages",
        desc: "Save pages as a new PDF",
        icon: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6",
        backendTool: "extract_pages"
      },
      {
        id: "delete",
        name: "Delete Pages",
        desc: "Remove unwanted pages",
        icon: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
        backendTool: "delete_pages"
      },
      {
        id: "reorder",
        name: "Reorder Pages",
        desc: "Rearrange the sequence",
        icon: "M8 4v16M5 7l3-3 3 3M16 20V4M13 17l3 3 3-3",
        backendTool: "rearrange_pages"
      },
      {
        id: "watermark",
        name: "Add Watermark",
        desc: "Text overlay with custom rotation",
        icon: "M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z",
        backendTool: "watermark_pdf"
      },
      {
        id: "numbers",
        name: "Page Numbers",
        desc: "Insert page numbers",
        icon: "M5 4h14v16H5zM10 9l2-2v7",
        backendTool: "add_page_numbers"
      },
      {
        id: "images",
        name: "Convert to Images",
        desc: "Export pages as PNG or JPEG",
        icon: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01",
        backendTool: "convert_to_images"
      }
    ]
  }
];

// ============================================================
// GLOBAL WORKBENCH STATE
// ============================================================
let currentSession = null;
let activeDoc = null;
let thumbnails = [];
let toc = [];
let zoomLevel = 100; // 50, 75, 100, 125, 150, 200, 'fit'
let currentPage = 1;
let viewMode = 'continuous'; // 'continuous' | 'single'
let activeTool = null; // null | 'organize' | 'split' | 'merge' | 'rotate' | 'compress' | 'protect' | 'watermark' | 'numbers' | 'unlock' | 'images'
let undoHistory = [];
let isDeckCollapsed = false;
let activeDeckTab = 'thumbnails'; // 'thumbnails' | 'bookmarks' | 'files'
let deckSearchQuery = '';
let pdfStudioOriginContext = null;
let isProcessing = false;
let cmdPaletteOpen = false;
let cmdPaletteSelectedIndex = 0;
let cmdPaletteFilteredActions = [];
let dragSourceIndex = null;
let additionalMergeFiles = [];

// ============================================================
// CLEAN SVG ICONS (ZERO EMOJIS)
// ============================================================
const SVG_ICONS = {
  upload: '<svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  file: '<svg class="i" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  chevronLeft: '<svg class="i" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg class="i" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  minus: '<svg class="i" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  rotateCw: '<svg class="i" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  rotateCcw: '<svg class="i" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.12-9.36L1 10"/></svg>',
  trash: '<svg class="i" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  undo: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
  reset: '<svg class="i" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  save: '<svg class="i" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  download: '<svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  sidebarToggle: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  grid: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  bookmark: '<svg class="i" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  layers: '<svg class="i" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  spinner: '<svg class="i studio-spinner" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  command: '<svg class="i" viewBox="0 0 24 24"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>',
  fit: '<svg class="i" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
};

// ============================================================
// API CLIENT WRAPPER
// ============================================================
async function studioApi(path, options = {}) {
  const apiFn = window.api || (typeof api === "function" ? api : null);
  if (apiFn) {
    return await apiFn(path, options);
  }
  const baseUrl = (typeof window.getBaseUrl === "function") ? window.getBaseUrl() : "";
  const fullUrl = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const resp = await fetch(fullUrl, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  return await resp.json();
}

function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function studioToast(msg, type = "info") {
  ensureStudioPortal();
  const portal = document.getElementById("studio-portal");
  let cont = portal.querySelector(".studio-toast-container");
  if (!cont) {
    cont = document.createElement("div");
    cont.className = "studio-toast-container";
    portal.appendChild(cont);
  }
  const toast = document.createElement("div");
  toast.className = `studio-toast ${type}`;
  toast.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  cont.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 200ms cubic-bezier(0.16, 1, 0.3, 1)";
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function ensureStudioPortal() {
  let portal = document.getElementById("studio-portal");
  if (!portal) {
    portal = document.createElement("div");
    portal.id = "studio-portal";
    document.body.appendChild(portal);
  }
  return portal;
}

// Compatibility hooks for legacy tests
function openOrg() {
  setActiveTool("organize");
}
function closeOrg() {
  setActiveTool(null);
}

// ============================================================
// DOCUMENT LIFECYCLE & FILE HANDLING
// ============================================================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let b64 = reader.result;
      if (b64.indexOf(",") !== -1) b64 = b64.split(",")[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function openPdfFilePathInStudio(filePath) {
  if (!filePath) return;
  try {
    studioToast("Loading document...", "info");
    const res = await studioApi("/api/pdf-studio/sessions", {
      method: "POST",
      body: JSON.stringify({ file_path: filePath })
    });
    if (res && res.ok && res.session) {
      window.openPdfStudioSession(res.session, res.thumbnails);
    } else {
      throw new Error(res.error || "Failed to load document from path.");
    }
  } catch (e) {
    studioToast(e.message || "Failed to open PDF file.", "error");
  }
}

async function openUploadedPdfInStudio(file) {
  if (!file) return;
  try {
    studioToast("Processing PDF...", "info");
    const b64 = await fileToBase64(file);
    const res = await studioApi("/api/pdf-studio/sessions", {
      method: "POST",
      body: JSON.stringify({
        original_name: file.name,
        file_base64: b64
      })
    });
    if (res && res.ok && res.session) {
      window.openPdfStudioSession(res.session, res.thumbnails);
    } else {
      throw new Error(res.error || "Failed to create session.");
    }
  } catch (e) {
    studioToast(e.message || "Could not open uploaded PDF.", "error");
  }
}

async function openPdfStudioWithFiles(files) {
  if (!files || !files.length) return;
  await openUploadedPdfInStudio(files[0]);
}

window.openPdfStudioSession = function (session, thumbs, originContext) {
  currentSession = session;
  pdfStudioOriginContext = originContext || null;
  activeDoc = {
    sessionId: session.session_id,
    name: session.current_name,
    pageCount: session.page_count,
    version: Date.now()
  };
  thumbnails = (thumbs || []).map((t, idx) => ({
    page_num: t.page_num || (idx + 1),
    width: t.width || 612,
    height: t.height || 792,
    rotation: t.rotation || 0,
    url: t.url || `/api/pdf-studio/sessions/${encodeURIComponent(session.session_id)}/page/${t.page_num || (idx + 1)}`
  }));
  currentPage = 1;
  activeTool = null;
  safeNavigate("pdf-studio");
  renderStudioAll();
};

function safeNavigate(page) {
  if (typeof window.safeNavigate === "function" && window.safeNavigate !== safeNavigate) {
    window.safeNavigate(page);
    return;
  }
  if (typeof window.navigateTo === "function") {
    window.navigateTo(page);
    return;
  }
  window.location.hash = page;
}

// ============================================================
// WORKBENCH UI RENDERING ENGINE
// ============================================================
function renderStudioAll() {
  const root = document.getElementById("studio-root");
  if (!root) return;

  if (!currentSession) {
    root.innerHTML = renderEmptyStateHtml();
    bindEmptyStateEvents(root);
    return;
  }

  root.innerHTML = `
    <div class="studio-workbench">
      ${renderDeckHtml()}
      ${renderViewportHtml()}
      ${renderInspectorHtml()}
    </div>
  `;

  bindWorkbenchEvents(root);
}

function renderEmptyStateHtml() {
  return `
    <div class="studio-empty-dropzone" id="studio-empty-dropzone">
      <div class="studio-hero-card" id="studio-hero-card">
        <div class="studio-hero-icon">${SVG_ICONS.upload}</div>
        <div class="studio-hero-title">Drop PDF here or browse</div>
        <div class="studio-hero-desc">Organize, merge, split, rotate, compress, protect, and watermark PDFs.</div>
        <div class="studio-hero-actions">
          <button type="button" class="studio-btn-primary" id="btn-studio-browse">
            ${SVG_ICONS.file} Choose PDF File
          </button>
          <button type="button" class="studio-btn-secondary" id="btn-studio-sample">
            Use Sample Invoice
          </button>
        </div>
        <input type="file" id="studio-file-input" accept=".pdf,application/pdf" style="display:none;" />
      </div>
    </div>
  `;
}

function renderDeckHtml() {
  const isCollapsed = isDeckCollapsed;
  const filteredThumbs = (thumbnails || []).filter(t => {
    if (!deckSearchQuery) return true;
    return String(t.page_num).includes(deckSearchQuery);
  });

  return `
    <aside class="studio-deck ${isCollapsed ? 'collapsed' : ''}" id="studio-deck" aria-label="Page Deck">
      <div class="studio-deck-header">
        <div class="studio-deck-tabs">
          <button type="button" class="studio-deck-tab ${activeDeckTab === 'thumbnails' ? 'active' : ''}" data-deck-tab="thumbnails" title="Thumbnails">
            ${SVG_ICONS.grid} <span>Thumbnails</span>
          </button>
          <button type="button" class="studio-deck-tab ${activeDeckTab === 'bookmarks' ? 'active' : ''}" data-deck-tab="bookmarks" title="Bookmarks">
            ${SVG_ICONS.bookmark} <span>Bookmarks</span>
          </button>
          <button type="button" class="studio-deck-tab ${activeDeckTab === 'files' ? 'active' : ''}" data-deck-tab="files" title="Files">
            ${SVG_ICONS.layers} <span>Files</span>
          </button>
        </div>
        <button type="button" class="studio-deck-toggle" id="btn-deck-toggle" title="${isCollapsed ? 'Expand Deck' : 'Collapse Deck'}">
          ${SVG_ICONS.sidebarToggle}
        </button>
      </div>

      <div class="studio-deck-search-wrap">
        <div class="studio-deck-search-box">
          ${SVG_ICONS.search}
          <input type="text" class="studio-deck-search" id="deck-search-input" placeholder="Filter pages..." value="${escapeHtml(deckSearchQuery)}" />
        </div>
      </div>

      ${activeDeckTab === 'thumbnails' ? `
        <div class="studio-deck-pages" id="studio-deck-pages">
          ${filteredThumbs.map((t, idx) => `
            <div class="studio-page-card-deck ${currentPage === t.page_num ? 'active' : ''}"
                 draggable="true"
                 data-page-index="${idx}"
                 data-page-num="${t.page_num}">
              <div class="studio-page-thumb-wrap">
                <img class="studio-page-thumb-img"
                     src="/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/page/${t.page_num}?dpi=96&t=${activeDoc.version}"
                     alt="Page ${t.page_num}"
                     loading="lazy" />
              </div>
              <div class="studio-page-card-deck-footer">
                <span class="studio-page-num-pill">${t.page_num}</span>
                <div class="studio-page-card-actions">
                  <button type="button" class="studio-card-btn" data-action="rotate-cw" data-page="${t.page_num}" title="Rotate 90° CW">${SVG_ICONS.rotateCw}</button>
                  <button type="button" class="studio-card-btn" data-action="rotate-ccw" data-page="${t.page_num}" title="Rotate 90° CCW">${SVG_ICONS.rotateCcw}</button>
                  <button type="button" class="studio-card-btn danger" data-action="delete" data-page="${t.page_num}" title="Delete Page">${SVG_ICONS.trash}</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : activeDeckTab === 'bookmarks' ? `
        <div class="studio-deck-view-content">
          <div class="studio-deck-empty">
            ${SVG_ICONS.bookmark}
            <span>No outline bookmarks found in this document.</span>
          </div>
        </div>
      ` : `
        <div class="studio-deck-view-content">
          <div class="studio-deck-file-row">
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${escapeHtml(currentSession.current_name)}</span>
            <span style="font-size:11px;color:var(--muted);">${thumbnails.length} pgs</span>
          </div>
          <button type="button" class="studio-btn-secondary" id="btn-deck-add-file" style="width:100%;margin-top:8px;">
            ${SVG_ICONS.plus} Add PDF to Merge
          </button>
        </div>
      `}
    </aside>
  `;
}

function renderViewportHtml() {
  const sessId = currentSession ? currentSession.session_id : "";
  const pageCount = thumbnails.length || (currentSession ? currentSession.page_count : 1);
  const zoomScale = zoomLevel === 'fit' ? 1 : (zoomLevel / 100);
  const baseWidth = 612;
  const scaledWidth = Math.round(baseWidth * zoomScale);

  return `
    <section class="studio-viewport" id="studio-viewport">
      <!-- FLOATING TOOLBAR -->
      <header class="studio-toolbar" id="studio-toolbar">
        <!-- Navigation Pill -->
        <div class="studio-toolbar-group">
          <button type="button" class="studio-toolbar-icon-btn" id="tb-prev-page" title="Previous Page">${SVG_ICONS.chevronLeft}</button>
          <span class="studio-toolbar-nav-text" id="tb-nav-label">Page ${currentPage} of ${pageCount}</span>
          <button type="button" class="studio-toolbar-icon-btn" id="tb-next-page" title="Next Page">${SVG_ICONS.chevronRight}</button>
        </div>

        <div class="studio-toolbar-sep"></div>

        <!-- Zoom Pill -->
        <div class="studio-toolbar-group">
          <button type="button" class="studio-toolbar-icon-btn" id="tb-zoom-out" title="Zoom Out">${SVG_ICONS.minus}</button>
          <button type="button" class="studio-toolbar-pill-btn" id="tb-zoom-level" title="Reset Zoom">${zoomLevel === 'fit' ? 'Fit' : zoomLevel + '%'}</button>
          <button type="button" class="studio-toolbar-icon-btn" id="tb-zoom-in" title="Zoom In">${SVG_ICONS.plus}</button>
          <button type="button" class="studio-toolbar-icon-btn" id="tb-zoom-fit" title="Fit to Viewport">${SVG_ICONS.fit}</button>
        </div>

        <div class="studio-toolbar-sep"></div>

        <!-- Action Tool Pills -->
        <div class="studio-toolbar-group">
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'organize' ? 'active' : ''}" data-tool="organize">Organize</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'merge' ? 'active' : ''}" data-tool="merge">Merge</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'split' ? 'active' : ''}" data-tool="split">Split</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'rotate' ? 'active' : ''}" data-tool="rotate">Rotate</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'compress' ? 'active' : ''}" data-tool="compress">Compress</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'protect' ? 'active' : ''}" data-tool="protect">Protect</button>
          <button type="button" class="studio-toolbar-pill-btn ${activeTool === 'watermark' ? 'active' : ''}" data-tool="watermark">Watermark</button>
        </div>

        <div class="studio-toolbar-sep"></div>

        <!-- Undo & Reset -->
        <div class="studio-toolbar-group">
          <button type="button" class="studio-toolbar-icon-btn" id="tb-undo" title="Undo">${SVG_ICONS.undo}</button>
          <button type="button" class="studio-toolbar-icon-btn" id="tb-reset" title="Reset to Original">${SVG_ICONS.reset}</button>
        </div>

        <div class="studio-toolbar-sep"></div>

        <!-- Handoff & Export -->
        <div class="studio-toolbar-group">
          <button type="button" class="studio-toolbar-pill-btn primary" id="tb-save-client" title="Save to Client">${SVG_ICONS.save} Save to Client</button>
          <button type="button" class="studio-toolbar-pill-btn" id="tb-download" title="Download Document">${SVG_ICONS.download} Download</button>
        </div>
      </header>

      <!-- VIEWPORT SCROLL AREA -->
      <div class="studio-viewport-scroll" id="studio-viewport-scroll">
        ${thumbnails.map((t, idx) => `
          <div class="studio-page-card-view ${currentPage === t.page_num ? 'active-view' : ''}"
               id="viewport-page-${t.page_num}"
               data-page-num="${t.page_num}"
               style="width:${scaledWidth}px; aspect-ratio:${t.width || 612}/${t.height || 792};">
            <img class="studio-page-view-img"
                 src="/api/pdf-studio/sessions/${encodeURIComponent(sessId)}/page/${t.page_num}?dpi=150&t=${activeDoc.version}"
                 alt="Document Page ${t.page_num}"
                 loading="lazy" />
            <div class="studio-page-view-badge">Page ${t.page_num} of ${pageCount}</div>
          </div>
          ${idx < thumbnails.length - 1 ? `<div class="studio-divider-insert-line" data-divider-after="${t.page_num}"></div>` : ''}
        `).join('')}
      </div>
    </section>
  `;
}

function renderInspectorHtml() {
  const isOpen = !!activeTool;
  const toolName = activeTool ? (activeTool.charAt(0).toUpperCase() + activeTool.slice(1)) : "";

  return `
    <aside class="studio-inspector ${isOpen ? 'active' : ''}" id="studio-inspector" aria-label="Tool Inspector">
      <div class="studio-inspector-header">
        <div class="studio-inspector-title">
          <span>${toolName}</span>
        </div>
        <button type="button" class="studio-inspector-close" id="btn-inspector-close" title="Close Panel">
          ${SVG_ICONS.close}
        </button>
      </div>

      <div class="studio-inspector-body" id="studio-inspector-body">
        ${renderInspectorBodyContent()}
      </div>

      <div class="studio-inspector-footer">
        <button type="button" class="studio-btn-primary" id="btn-inspector-apply" ${isProcessing ? 'disabled' : ''}>
          ${isProcessing ? SVG_ICONS.spinner : SVG_ICONS.check}
          <span>${isProcessing ? 'Processing...' : 'Apply & Process'}</span>
        </button>
        <button type="button" class="studio-btn-secondary" id="btn-inspector-cancel">Cancel</button>
      </div>
    </aside>
  `;
}

function renderInspectorBodyContent() {
  if (!activeTool) return '<div class="studio-form-help">Select a tool from the toolbar to adjust parameters.</div>';

  if (activeTool === 'organize') {
    return `
      <div class="studio-form-group">
        <span class="studio-form-label">Batch Page Actions</span>
        <div class="studio-preset-chips" style="gap:8px;">
          <button type="button" class="studio-preset-chip" data-org-action="rotate-all-cw">Rotate All 90° CW</button>
          <button type="button" class="studio-preset-chip" data-org-action="rotate-all-ccw">Rotate All 90° CCW</button>
          <button type="button" class="studio-preset-chip" data-org-action="reverse-order">Reverse All Pages</button>
        </div>
      </div>
      <div class="studio-form-group" style="margin-top:10px;">
        <span class="studio-form-label">Deck Tip</span>
        <div class="studio-form-help">You can also directly drag-and-drop page cards in the Left Deck to reorder them in real-time.</div>
      </div>
    `;
  }

  if (activeTool === 'split') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label" for="split-range-input">Page Range to Extract</label>
        <input type="text" id="split-range-input" placeholder="e.g. 1-3, 5, 8" value="1-${thumbnails.length}" />
        <div class="studio-form-help">Comma-separated page numbers or hyphenated ranges.</div>
      </div>
      <div class="studio-form-group">
        <span class="studio-form-label">Quick Presets</span>
        <div class="studio-preset-chips">
          <button type="button" class="studio-preset-chip" data-split-preset="odd">Odd Pages</button>
          <button type="button" class="studio-preset-chip" data-split-preset="even">Even Pages</button>
          <button type="button" class="studio-preset-chip" data-split-preset="first-half">First Half</button>
          <button type="button" class="studio-preset-chip" data-split-preset="second-half">Second Half</button>
        </div>
      </div>
    `;
  }

  if (activeTool === 'merge') {
    return `
      <div class="studio-form-group">
        <span class="studio-form-label">Additional PDFs to Merge</span>
        <button type="button" class="studio-btn-secondary" id="btn-merge-add-file" style="width:100%;justify-content:flex-start;">
          ${SVG_ICONS.plus} Select PDF to Merge...
        </button>
        <input type="file" id="merge-file-input" accept=".pdf,application/pdf" multiple style="display:none;" />
      </div>
      <div class="studio-form-group" id="merge-files-list">
        ${additionalMergeFiles.length === 0 ? `
          <div class="studio-form-help">No secondary PDFs added yet. Click above to add files.</div>
        ` : additionalMergeFiles.map((f, i) => `
          <div class="studio-deck-file-row">
            <span style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${escapeHtml(f.name)}</span>
            <button type="button" class="studio-card-btn danger" data-remove-merge="${i}">${SVG_ICONS.trash}</button>
          </div>
        `).join('')}
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label">Placement</label>
        <select id="merge-order-select">
          <option value="append" selected>Append to End of Document</option>
          <option value="prepend">Prepend to Beginning of Document</option>
        </select>
      </div>
    `;
  }

  if (activeTool === 'rotate') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label">Rotation Angle</label>
        <div class="studio-preset-chips">
          <button type="button" class="studio-preset-chip active" data-angle="90">90° Clockwise</button>
          <button type="button" class="studio-preset-chip" data-angle="180">180° Half-Turn</button>
          <button type="button" class="studio-preset-chip" data-angle="-90">90° Counter-Clockwise</button>
        </div>
      </div>
      <div class="studio-form-group" style="margin-top:12px;">
        <label class="studio-form-label">Target Pages</label>
        <select id="rotate-target-select">
          <option value="all" selected>All Pages in Document</option>
          <option value="current">Current Page (${currentPage})</option>
          <option value="odd">Odd Pages Only</option>
          <option value="even">Even Pages Only</option>
        </select>
      </div>
    `;
  }

  if (activeTool === 'compress') {
    return `
      <div class="studio-form-group">
        <span class="studio-form-label">Compression Preset</span>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="studio-preset-card" data-compress-level="low">
            <div class="studio-preset-card-title">Low (Maximum Quality)</div>
            <div class="studio-preset-card-desc">Minor optimization, preserves high resolution images.</div>
          </div>
          <div class="studio-preset-card active" data-compress-level="balanced">
            <div class="studio-preset-card-title">Balanced (Recommended)</div>
            <div class="studio-preset-card-desc">Optimal balance between file size and text/image clarity.</div>
          </div>
          <div class="studio-preset-card" data-compress-level="high">
            <div class="studio-preset-card-title">High (Smallest Size)</div>
            <div class="studio-preset-card-desc">Aggressive reduction, ideal for email and portals.</div>
          </div>
        </div>
      </div>
    `;
  }

  if (activeTool === 'protect') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label" for="protect-user-pwd">Password to Open PDF *</label>
        <input type="password" id="protect-user-pwd" placeholder="Enter secure password..." autocomplete="new-password" />
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="protect-confirm-pwd">Confirm Password *</label>
        <input type="password" id="protect-confirm-pwd" placeholder="Repeat password..." autocomplete="new-password" />
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="protect-owner-pwd">Owner Password (Optional)</label>
        <input type="password" id="protect-owner-pwd" placeholder="Administrative password..." autocomplete="new-password" />
      </div>
      <div class="studio-form-group" style="flex-direction:row;align-items:center;gap:8px;margin-top:6px;">
        <input type="checkbox" id="protect-save-vault" checked style="width:16px;height:16px;" />
        <label class="studio-form-label" for="protect-save-vault" style="cursor:pointer;margin:0;">Save password in Client Vault</label>
      </div>
    `;
  }

  if (activeTool === 'watermark') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label" for="wm-text-input">Watermark Text *</label>
        <input type="text" id="wm-text-input" placeholder="e.g. CONFIDENTIAL" value="CONFIDENTIAL" />
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label">Position / Layout</label>
        <select id="wm-position-select">
          <option value="center_diagonal" selected>Center Diagonal (45°)</option>
          <option value="center_horizontal">Center Horizontal</option>
          <option value="top_header">Top Header</option>
          <option value="bottom_footer">Bottom Footer</option>
        </select>
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="wm-font-size">Font Size (<span id="wm-size-val">42</span>pt)</label>
        <input type="range" id="wm-font-size" min="14" max="72" value="42" style="padding:0;" />
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="wm-opacity">Opacity (<span id="wm-opacity-val">25</span>%)</label>
        <input type="range" id="wm-opacity" min="5" max="100" value="25" style="padding:0;" />
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="wm-color">Color</label>
        <input type="color" id="wm-color" value="#DC2626" style="height:38px;padding:2px 4px;cursor:pointer;" />
      </div>
    `;
  }

  if (activeTool === 'numbers') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label">Number Position</label>
        <select id="num-position-select">
          <option value="bottom_right" selected>Bottom Right</option>
          <option value="bottom_center">Bottom Center</option>
          <option value="bottom_left">Bottom Left</option>
          <option value="top_right">Top Right</option>
          <option value="top_center">Top Center</option>
        </select>
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label" for="num-format-select">Format</label>
        <select id="num-format-select">
          <option value="Page {n} of {total}" selected>Page {n} of {total}</option>
          <option value="{n}">{n}</option>
          <option value="Page {n}">Page {n}</option>
        </select>
      </div>
    `;
  }

  if (activeTool === 'unlock') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label" for="unlock-pwd-input">Document Password *</label>
        <input type="password" id="unlock-pwd-input" placeholder="Enter password to remove..." />
      </div>
    `;
  }

  if (activeTool === 'images') {
    return `
      <div class="studio-form-group">
        <label class="studio-form-label">Image Format</label>
        <select id="img-format-select">
          <option value="png" selected>PNG (Lossless High Quality)</option>
          <option value="jpeg">JPEG (Standard Photo)</option>
        </select>
      </div>
      <div class="studio-form-group">
        <label class="studio-form-label">Render Resolution (DPI)</label>
        <select id="img-dpi-select">
          <option value="150" selected>150 DPI (Balanced)</option>
          <option value="300">300 DPI (Print Quality)</option>
          <option value="72">72 DPI (Screen Preview)</option>
        </select>
      </div>
    `;
  }

  return '';
}

function setActiveTool(tool) {
  if (activeTool === tool) {
    activeTool = null;
  } else {
    activeTool = tool;
  }
  renderStudioAll();
}

// ============================================================
// WORKBENCH EVENT BINDINGS
// ============================================================
function bindEmptyStateEvents(root) {
  const fileInput = root.querySelector("#studio-file-input");
  const browseBtn = root.querySelector("#btn-studio-browse");
  const sampleBtn = root.querySelector("#btn-studio-sample");
  const dropCard = root.querySelector("#studio-hero-card");

  if (browseBtn && fileInput) {
    browseBtn.onclick = () => fileInput.click();
  }

  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        openUploadedPdfInStudio(e.target.files[0]);
      }
    };
  }

  if (sampleBtn) {
    sampleBtn.onclick = async () => {
      // Create empty sample PDF via backend
      try {
        studioToast("Generating sample invoice...", "info");
        const res = await studioApi("/api/pdf-studio/sessions", {
          method: "POST",
          body: JSON.stringify({
            original_name: "Sample_Invoice.pdf",
            file_base64: "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTgyCiUlRU9GCg=="
          })
        });
        if (res && res.ok && res.session) {
          window.openPdfStudioSession(res.session, res.thumbnails);
        }
      } catch (e) {
        studioToast("Failed to load sample PDF.", "error");
      }
    };
  }

  if (dropCard) {
    dropCard.ondragover = (e) => {
      e.preventDefault();
      dropCard.style.borderColor = "var(--pri-solid)";
    };
    dropCard.ondragleave = () => {
      dropCard.style.borderColor = "";
    };
    dropCard.ondrop = (e) => {
      e.preventDefault();
      dropCard.style.borderColor = "";
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        openUploadedPdfInStudio(e.dataTransfer.files[0]);
      }
    };
  }
}

function bindWorkbenchEvents(root) {
  // Deck Collapse Toggle
  const deckToggle = root.querySelector("#btn-deck-toggle");
  if (deckToggle) {
    deckToggle.onclick = () => {
      isDeckCollapsed = !isDeckCollapsed;
      renderStudioAll();
    };
  }

  // Deck Tabs
  root.querySelectorAll("[data-deck-tab]").forEach(tabBtn => {
    tabBtn.onclick = () => {
      activeDeckTab = tabBtn.dataset.deckTab;
      renderStudioAll();
    };
  });

  // Deck Search Input
  const deckSearch = root.querySelector("#deck-search-input");
  if (deckSearch) {
    deckSearch.oninput = (e) => {
      deckSearchQuery = e.target.value;
      const pagesCont = root.querySelector("#studio-deck-pages");
      if (pagesCont) {
        const cards = pagesCont.querySelectorAll(".studio-page-card-deck");
        cards.forEach(card => {
          const pNum = card.dataset.pageNum;
          if (!deckSearchQuery || pNum.includes(deckSearchQuery)) {
            card.style.display = "";
          } else {
            card.style.display = "none";
          }
        });
      }
    };
  }

  // Drag-and-Drop Page Reordering in Left Deck
  const deckCards = root.querySelectorAll(".studio-page-card-deck");
  deckCards.forEach(card => {
    card.ondragstart = (e) => {
      dragSourceIndex = parseInt(card.dataset.pageIndex, 10);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.pageNum);
    };

    card.ondragend = () => {
      card.classList.remove("dragging");
      deckCards.forEach(c => {
        c.classList.remove("drag-over-top");
        c.classList.remove("drag-over-bottom");
      });
      dragSourceIndex = null;
    };

    card.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        card.classList.add("drag-over-top");
        card.classList.remove("drag-over-bottom");
      } else {
        card.classList.add("drag-over-bottom");
        card.classList.remove("drag-over-top");
      }
    };

    card.ondragleave = () => {
      card.classList.remove("drag-over-top");
      card.classList.remove("drag-over-bottom");
    };

    card.ondrop = async (e) => {
      e.preventDefault();
      card.classList.remove("drag-over-top");
      card.classList.remove("drag-over-bottom");
      const targetIndex = parseInt(card.dataset.pageIndex, 10);
      if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;

      const rect = card.getBoundingClientRect();
      const insertAfter = e.clientY >= (rect.top + rect.height / 2);

      // Reorder array
      const newOrderItems = [...thumbnails];
      const movedItem = newOrderItems.splice(dragSourceIndex, 1)[0];
      const adjustedTarget = dragSourceIndex < targetIndex ? (insertAfter ? targetIndex : targetIndex - 1) : (insertAfter ? targetIndex + 1 : targetIndex);
      newOrderItems.splice(Math.max(0, adjustedTarget), 0, movedItem);

      const newOrderNums = newOrderItems.map(item => item.page_num);
      await executeRearrangePages(newOrderNums);
    };

    // Clicking page card in deck scrolls viewport to that page
    card.onclick = (e) => {
      if (e.target.closest(".studio-page-card-actions")) return;
      const pNum = parseInt(card.dataset.pageNum, 10);
      scrollToPage(pNum);
    };
  });

  // Quick Action Buttons on Deck Cards (Rotate CW, Rotate CCW, Delete)
  root.querySelectorAll(".studio-card-btn").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const pageNum = parseInt(btn.dataset.page, 10);
      if (action === "rotate-cw") {
        await executeBackendTool("rotate_pages", { angle: 90, pages: [pageNum] });
      } else if (action === "rotate-ccw") {
        await executeBackendTool("rotate_pages", { angle: -90, pages: [pageNum] });
      } else if (action === "delete") {
        if (thumbnails.length <= 1) {
          studioToast("Cannot delete the only page in the document.", "error");
          return;
        }
        await executeBackendTool("delete_pages", { pages: [pageNum] });
      }
    };
  });

  // Top Floating Toolbar Buttons
  const prevBtn = root.querySelector("#tb-prev-page");
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentPage > 1) scrollToPage(currentPage - 1);
    };
  }

  const nextBtn = root.querySelector("#tb-next-page");
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentPage < thumbnails.length) scrollToPage(currentPage + 1);
    };
  }

  // Zoom Controls
  const zoomInBtn = root.querySelector("#tb-zoom-in");
  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      const levels = [50, 75, 100, 125, 150, 200];
      const cur = typeof zoomLevel === 'number' ? zoomLevel : 100;
      const next = levels.find(l => l > cur) || 200;
      zoomLevel = next;
      renderStudioAll();
    };
  }

  const zoomOutBtn = root.querySelector("#tb-zoom-out");
  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      const levels = [200, 150, 125, 100, 75, 50];
      const cur = typeof zoomLevel === 'number' ? zoomLevel : 100;
      const next = levels.find(l => l < cur) || 50;
      zoomLevel = next;
      renderStudioAll();
    };
  }

  const zoomFitBtn = root.querySelector("#tb-zoom-fit");
  if (zoomFitBtn) {
    zoomFitBtn.onclick = () => {
      zoomLevel = zoomLevel === 'fit' ? 100 : 'fit';
      renderStudioAll();
    };
  }

  const zoomPillBtn = root.querySelector("#tb-zoom-level");
  if (zoomPillBtn) {
    zoomPillBtn.onclick = () => {
      zoomLevel = 100;
      renderStudioAll();
    };
  }

  // Tool Pills in Top Toolbar
  root.querySelectorAll("[data-tool]").forEach(toolBtn => {
    toolBtn.onclick = () => {
      setActiveTool(toolBtn.dataset.tool);
    };
  });

  // Undo & Reset Buttons
  const undoBtn = root.querySelector("#tb-undo");
  if (undoBtn) {
    undoBtn.onclick = async () => {
      await executeUndo();
    };
  }

  const resetBtn = root.querySelector("#tb-reset");
  if (resetBtn) {
    resetBtn.onclick = async () => {
      await executeReset();
    };
  }

  // Save to Client Staging Handoff
  const saveClientBtn = root.querySelector("#tb-save-client");
  if (saveClientBtn) {
    saveClientBtn.onclick = async () => {
      await handleSaveToClient();
    };
  }

  // Download Working Copy Button
  const downloadBtn = root.querySelector("#tb-download");
  if (downloadBtn) {
    downloadBtn.onclick = async () => {
      await handleDownloadDocument();
    };
  }

  // Inspector Close & Cancel
  const inspClose = root.querySelector("#btn-inspector-close");
  const inspCancel = root.querySelector("#btn-inspector-cancel");
  if (inspClose) inspClose.onclick = () => setActiveTool(null);
  if (inspCancel) inspCancel.onclick = () => setActiveTool(null);

  // Inspector Apply Button
  const inspApply = root.querySelector("#btn-inspector-apply");
  if (inspApply) {
    inspApply.onclick = async () => {
      await handleInspectorApply();
    };
  }

  // Inspector Dynamic Presets & Sliders
  bindInspectorFormControls(root);

  // Viewport Scroll Listener for Active Page Highlighting
  const scrollCont = root.querySelector("#studio-viewport-scroll");
  if (scrollCont) {
    scrollCont.onscroll = () => {
      const pageViews = scrollCont.querySelectorAll(".studio-page-card-view");
      const scrollMid = scrollCont.scrollTop + scrollCont.clientHeight / 2;
      pageViews.forEach(pv => {
        const top = pv.offsetTop;
        const bottom = top + pv.offsetHeight;
        if (scrollMid >= top && scrollMid <= bottom) {
          const pNum = parseInt(pv.dataset.pageNum, 10);
          if (currentPage !== pNum) {
            currentPage = pNum;
            const navLabel = root.querySelector("#tb-nav-label");
            if (navLabel) navLabel.textContent = `Page ${pNum} of ${thumbnails.length}`;
            root.querySelectorAll(".studio-page-card-deck").forEach(card => {
              if (parseInt(card.dataset.pageNum, 10) === pNum) {
                card.classList.add("active");
              } else {
                card.classList.remove("active");
              }
            });
          }
        }
      });
    };
  }
}

function bindInspectorFormControls(root) {
  // Watermark font size slider
  const wmSizeSlider = root.querySelector("#wm-font-size");
  const wmSizeVal = root.querySelector("#wm-size-val");
  if (wmSizeSlider && wmSizeVal) {
    wmSizeSlider.oninput = (e) => wmSizeVal.textContent = e.target.value;
  }

  // Watermark opacity slider
  const wmOpacitySlider = root.querySelector("#wm-opacity");
  const wmOpacityVal = root.querySelector("#wm-opacity-val");
  if (wmOpacitySlider && wmOpacityVal) {
    wmOpacitySlider.oninput = (e) => wmOpacityVal.textContent = e.target.value;
  }

  // Split presets
  root.querySelectorAll("[data-split-preset]").forEach(presetBtn => {
    presetBtn.onclick = () => {
      const input = root.querySelector("#split-range-input");
      if (!input) return;
      const total = thumbnails.length;
      const type = presetBtn.dataset.splitPreset;
      if (type === "odd") {
        input.value = Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 1).join(", ");
      } else if (type === "even") {
        input.value = Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 0).join(", ");
      } else if (type === "first-half") {
        const mid = Math.ceil(total / 2);
        input.value = `1-${mid}`;
      } else if (type === "second-half") {
        const mid = Math.ceil(total / 2) + 1;
        input.value = `${mid}-${total}`;
      }
    };
  });

  // Compression preset cards
  root.querySelectorAll("[data-compress-level]").forEach(card => {
    card.onclick = () => {
      root.querySelectorAll("[data-compress-level]").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
    };
  });

  // Rotation angle chips
  root.querySelectorAll("[data-angle]").forEach(chip => {
    chip.onclick = () => {
      root.querySelectorAll("[data-angle]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    };
  });

  // Organize batch action chips
  root.querySelectorAll("[data-org-action]").forEach(chip => {
    chip.onclick = async () => {
      const action = chip.dataset.orgAction;
      if (action === "rotate-all-cw") {
        await executeBackendTool("rotate_pages", { angle: 90, which_pages: "all" });
      } else if (action === "rotate-all-ccw") {
        await executeBackendTool("rotate_pages", { angle: -90, which_pages: "all" });
      } else if (action === "reverse-order") {
        const rev = [...thumbnails].reverse().map(t => t.page_num);
        await executeRearrangePages(rev);
      }
    };
  });

  // Merge additional file selection
  const mergeAddBtn = root.querySelector("#btn-merge-add-file");
  const mergeFileInput = root.querySelector("#merge-file-input");
  if (mergeAddBtn && mergeFileInput) {
    mergeAddBtn.onclick = () => mergeFileInput.click();
    mergeFileInput.onchange = async (e) => {
      if (e.target.files) {
        for (let i = 0; i < e.target.files.length; i++) {
          const f = e.target.files[i];
          const b64 = await fileToBase64(f);
          additionalMergeFiles.push({ name: f.name, bytes: b64 });
        }
        renderStudioAll();
      }
    };
  }

  root.querySelectorAll("[data-remove-merge]").forEach(rmBtn => {
    rmBtn.onclick = () => {
      const idx = parseInt(rmBtn.dataset.removeMerge, 10);
      additionalMergeFiles.splice(idx, 1);
      renderStudioAll();
    };
  });
}

function scrollToPage(pageNum) {
  currentPage = pageNum;
  const pageEl = document.getElementById(`viewport-page-${pageNum}`);
  if (pageEl) {
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const root = document.getElementById("studio-root");
  if (root) {
    const navLabel = root.querySelector("#tb-nav-label");
    if (navLabel) navLabel.textContent = `Page ${pageNum} of ${thumbnails.length}`;
    root.querySelectorAll(".studio-page-card-deck").forEach(card => {
      if (parseInt(card.dataset.pageNum, 10) === pageNum) {
        card.classList.add("active");
      } else {
        card.classList.remove("active");
      }
    });
  }
}

// ============================================================
// BACKEND TOOL EXECUTION & STATE SYNCHRONIZATION
// ============================================================
async function executeBackendTool(toolId, params = {}) {
  if (!currentSession) return;
  isProcessing = true;
  renderStudioAll();

  try {
    const res = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/execute`, {
      method: "POST",
      body: JSON.stringify({
        tool_id: toolId,
        params: params
      })
    });

    if (res && res.ok) {
      studioToast(res.message || "Operation completed successfully.", "success");
      await refreshSessionState();
      activeTool = null;
    } else {
      throw new Error(res.error || "Operation failed.");
    }
  } catch (e) {
    studioToast(e.message || "Execution error.", "error");
  } finally {
    isProcessing = false;
    renderStudioAll();
  }
}

async function executeRearrangePages(newOrder) {
  if (!currentSession) return;
  try {
    studioToast("Reordering pages...", "info");
    const res = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/execute`, {
      method: "POST",
      body: JSON.stringify({
        tool_id: "rearrange_pages",
        params: { new_order: newOrder }
      })
    });
    if (res && res.ok) {
      studioToast("Pages reordered.", "success");
      await refreshSessionState();
    } else {
      throw new Error(res.error || "Failed to reorder pages.");
    }
  } catch (e) {
    studioToast(e.message || "Could not rearrange pages.", "error");
  } finally {
    renderStudioAll();
  }
}

async function executeUndo() {
  if (!currentSession) return;
  try {
    const res = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/undo`, {
      method: "POST"
    });
    if (res && res.ok) {
      studioToast("Action undone.", "info");
      await refreshSessionState();
    } else {
      studioToast(res.error || "Nothing to undo.", "info");
    }
  } catch (e) {
    studioToast(e.message || "Undo failed.", "error");
  } finally {
    renderStudioAll();
  }
}

async function executeReset() {
  if (!currentSession) return;
  try {
    const res = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/reset`, {
      method: "POST"
    });
    if (res && res.ok) {
      studioToast("Reset to original document.", "info");
      await refreshSessionState();
    } else {
      throw new Error(res.error || "Reset failed.");
    }
  } catch (e) {
    studioToast(e.message || "Reset failed.", "error");
  } finally {
    renderStudioAll();
  }
}

async function refreshSessionState() {
  if (!currentSession) return;
  try {
    const metaRes = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}`);
    if (metaRes && metaRes.session) {
      currentSession = metaRes.session;
      activeDoc.version = Date.now();
    }
    const thumbsRes = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/thumbnails`);
    if (thumbsRes && thumbsRes.thumbnails) {
      thumbnails = thumbsRes.thumbnails.map((t, idx) => ({
        page_num: t.page_num || (idx + 1),
        width: t.width || 612,
        height: t.height || 792,
        rotation: t.rotation || 0,
        url: t.url || `/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/page/${t.page_num || (idx + 1)}`
      }));
    }
    if (currentPage > thumbnails.length) currentPage = Math.max(1, thumbnails.length);
  } catch (e) {
    console.warn("Could not refresh session state:", e);
  }
}

async function handleInspectorApply() {
  const root = document.getElementById("studio-root");
  if (!root || !activeTool) return;

  if (activeTool === 'split') {
    const rangeInput = root.querySelector("#split-range-input");
    const val = rangeInput ? rangeInput.value.trim() : "";
    if (!val) {
      studioToast("Please enter a valid page range.", "error");
      return;
    }
    await executeBackendTool("split_pdf", { mode: "extract_range", page_range: val });
  } else if (activeTool === 'merge') {
    if (additionalMergeFiles.length === 0) {
      studioToast("Please add at least one PDF to merge.", "error");
      return;
    }
    const orderSelect = root.querySelector("#merge-order-select");
    const orderVal = orderSelect ? orderSelect.value : "append";
    await executeBackendTool("merge_pdf", {
      additional_files: additionalMergeFiles.map(f => f.bytes),
      order: orderVal
    });
    additionalMergeFiles = [];
  } else if (activeTool === 'rotate') {
    const activeAngleChip = root.querySelector("[data-angle].active");
    const angleVal = activeAngleChip ? parseInt(activeAngleChip.dataset.angle, 10) : 90;
    const targetSelect = root.querySelector("#rotate-target-select");
    const targetVal = targetSelect ? targetSelect.value : "all";

    const params = { angle: angleVal };
    if (targetVal === "all") {
      params.which_pages = "all";
    } else if (targetVal === "current") {
      params.pages = [currentPage];
    } else if (targetVal === "odd" || targetVal === "even") {
      params.which_pages = targetVal;
    }
    await executeBackendTool("rotate_pages", params);
  } else if (activeTool === 'compress') {
    const activeCompCard = root.querySelector("[data-compress-level].active");
    const levelVal = activeCompCard ? activeCompCard.dataset.compressLevel : "balanced";
    await executeBackendTool("compress_pdf", { level: levelVal });
  } else if (activeTool === 'protect') {
    const userPwd = root.querySelector("#protect-user-pwd");
    const confPwd = root.querySelector("#protect-confirm-pwd");
    const ownerPwd = root.querySelector("#protect-owner-pwd");
    const saveVault = root.querySelector("#protect-save-vault");

    if (!userPwd || !userPwd.value) {
      studioToast("Password cannot be blank.", "error");
      return;
    }
    if (confPwd && userPwd.value !== confPwd.value) {
      studioToast("Passwords do not match.", "error");
      return;
    }

    await executeBackendTool("lock_pdf", {
      user_password: userPwd.value,
      owner_password: ownerPwd ? ownerPwd.value : "",
      save_to_client_vault: saveVault ? saveVault.checked : true
    });
  } else if (activeTool === 'watermark') {
    const wmText = root.querySelector("#wm-text-input");
    const wmPos = root.querySelector("#wm-position-select");
    const wmSize = root.querySelector("#wm-font-size");
    const wmOpacity = root.querySelector("#wm-opacity");
    const wmColor = root.querySelector("#wm-color");

    if (!wmText || !wmText.value.trim()) {
      studioToast("Watermark text is required.", "error");
      return;
    }

    await executeBackendTool("watermark_pdf", {
      text: wmText.value.trim(),
      position: wmPos ? wmPos.value : "center_diagonal",
      font_size: wmSize ? parseInt(wmSize.value, 10) : 42,
      opacity: wmOpacity ? (parseInt(wmOpacity.value, 10) / 100) : 0.25,
      color: wmColor ? wmColor.value : "#DC2626"
    });
  } else if (activeTool === 'numbers') {
    const numPos = root.querySelector("#num-position-select");
    const numFmt = root.querySelector("#num-format-select");
    await executeBackendTool("add_page_numbers", {
      position: numPos ? numPos.value : "bottom_right",
      format: numFmt ? numFmt.value : "Page {n} of {total}",
      start_number: 1
    });
  } else if (activeTool === 'unlock') {
    const pwdInput = root.querySelector("#unlock-pwd-input");
    await executeBackendTool("unlock_pdf", {
      password: pwdInput ? pwdInput.value : ""
    });
  } else if (activeTool === 'images') {
    const fmtSelect = root.querySelector("#img-format-select");
    const dpiSelect = root.querySelector("#img-dpi-select");
    await executeBackendTool("convert_to_images", {
      format: fmtSelect ? fmtSelect.value : "png",
      dpi: dpiSelect ? parseInt(dpiSelect.value, 10) : 150
    });
  }
}

// ============================================================
// HANDOFF & EXPORT PIPELINES
// ============================================================
async function handleSaveToClient() {
  if (!currentSession) return;
  try {
    studioToast("Saving to Client staging...", "info");
    const resultName = currentSession.current_name || "document_processed.pdf";

    if (window.saveStaging && typeof window.saveStaging.applyPdfStudioResult === "function" && window.saveStaging.activePdfStudioContext) {
      await window.saveStaging.applyPdfStudioResult(currentSession.session_id, resultName);
      safeNavigate("save");
      return;
    }

    // Direct staging session apply
    const stgSessionId = (window.saveStaging && window.saveStaging.sessionId) ? window.saveStaging.sessionId : sessionStorage.getItem("vs_staging_session_vs_desktop_app");
    if (stgSessionId) {
      const res = await studioApi(`/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/apply-to-staging`, {
        method: "POST",
        body: JSON.stringify({
          staging_session_id: stgSessionId,
          result_name: resultName
        })
      });
      if (res && res.ok) {
        window.lastAppliedStagingResult = { filename: resultName };
        safeNavigate("save");
        return;
      }
    }

    // Fallback: trigger download
    await handleDownloadDocument();
  } catch (e) {
    studioToast(e.message || "Failed to transfer document.", "error");
  }
}

async function handleDownloadDocument() {
  if (!currentSession) return;
  try {
    // 1. Try native desktop save dialog
    const res = await studioApi("/api/ai/native-save-dialog", {
      method: "POST",
      body: JSON.stringify({
        default_filename: currentSession.current_name || "document.pdf",
        session_id: currentSession.session_id
      })
    });
    if (res && res.ok && res.saved_path) {
      studioToast(`File saved to ${res.saved_path}`, "success");
      return;
    }
  } catch (_) {}

  // 2. Direct browser download fallback
  const a = document.createElement("a");
  a.href = `/api/pdf-studio/sessions/${encodeURIComponent(currentSession.session_id)}/download`;
  a.download = currentSession.current_name || "document.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  studioToast("Download started.", "success");
}

// ============================================================
// COMMAND PALETTE (CTRL+K / CMD+K)
// ============================================================
const COMMAND_ACTIONS = [
  { id: "open", name: "Open PDF Document", shortcut: "Ctrl+O", run: () => { const inp = document.getElementById("studio-file-input"); if (inp) inp.click(); } },
  { id: "organize", name: "Organize & Reorder Pages", shortcut: "G", run: () => setActiveTool("organize") },
  { id: "merge", name: "Merge Multiple PDFs", shortcut: "M", run: () => setActiveTool("merge") },
  { id: "split", name: "Split Pages / Ranges", shortcut: "S", run: () => setActiveTool("split") },
  { id: "rotate", name: "Rotate Pages", shortcut: "R", run: () => setActiveTool("rotate") },
  { id: "compress", name: "Compress & Reduce Size", shortcut: "C", run: () => setActiveTool("compress") },
  { id: "protect", name: "Protect with Password", shortcut: "P", run: () => setActiveTool("protect") },
  { id: "watermark", name: "Apply Watermark", shortcut: "W", run: () => setActiveTool("watermark") },
  { id: "numbers", name: "Add Page Numbers", shortcut: "N", run: () => setActiveTool("numbers") },
  { id: "images", name: "Convert Pages to Images", shortcut: "I", run: () => setActiveTool("images") },
  { id: "undo", name: "Undo Last Action", shortcut: "Ctrl+Z", run: () => executeUndo() },
  { id: "reset", name: "Reset to Original PDF", shortcut: "Ctrl+Shift+R", run: () => executeReset() },
  { id: "save", name: "Save to Client", shortcut: "Ctrl+S", run: () => handleSaveToClient() },
  { id: "download", name: "Download Working Document", shortcut: "Ctrl+D", run: () => handleDownloadDocument() },
  { id: "zoom-fit", name: "Fit Page to Viewport", shortcut: "F", run: () => { zoomLevel = 'fit'; renderStudioAll(); } },
  { id: "zoom-reset", name: "Reset Zoom to 100%", shortcut: "0", run: () => { zoomLevel = 100; renderStudioAll(); } }
];

function toggleCommandPalette() {
  cmdPaletteOpen = !cmdPaletteOpen;
  ensureStudioPortal();
  const portal = document.getElementById("studio-portal");
  let existing = portal.querySelector("#studio-cmd-palette");

  if (!cmdPaletteOpen) {
    if (existing) existing.remove();
    return;
  }

  cmdPaletteSelectedIndex = 0;
  cmdPaletteFilteredActions = [...COMMAND_ACTIONS];

  const overlay = document.createElement("div");
  overlay.id = "studio-cmd-palette";
  overlay.className = "studio-cmd-overlay";
  overlay.innerHTML = `
    <div class="studio-cmd-modal" id="studio-cmd-modal">
      <div class="studio-cmd-search-wrap">
        ${SVG_ICONS.command}
        <input type="text" class="studio-cmd-input" id="studio-cmd-search" placeholder="Type a command or tool..." autocomplete="off" />
      </div>
      <div class="studio-cmd-list" id="studio-cmd-list">
        ${renderCmdPaletteItemsHtml()}
      </div>
      <div class="studio-cmd-footer">
        <span>Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to execute</span>
        <span><kbd>Esc</kbd> to close</span>
      </div>
    </div>
  `;

  portal.appendChild(overlay);

  const searchInput = overlay.querySelector("#studio-cmd-search");
  if (searchInput) {
    searchInput.focus();
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      cmdPaletteFilteredActions = COMMAND_ACTIONS.filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q));
      cmdPaletteSelectedIndex = 0;
      const list = overlay.querySelector("#studio-cmd-list");
      if (list) list.innerHTML = renderCmdPaletteItemsHtml();
    };
  }

  overlay.onclick = (e) => {
    if (e.target === overlay) toggleCommandPalette();
  };
}

function renderCmdPaletteItemsHtml() {
  if (cmdPaletteFilteredActions.length === 0) {
    return '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No matching actions found.</div>';
  }
  return cmdPaletteFilteredActions.map((action, idx) => `
    <div class="studio-cmd-item ${idx === cmdPaletteSelectedIndex ? 'active' : ''}" data-cmd-idx="${idx}">
      <div class="studio-cmd-item-left">
        ${SVG_ICONS.file}
        <span>${escapeHtml(action.name)}</span>
      </div>
      <span class="studio-cmd-shortcut">${action.shortcut}</span>
    </div>
  `).join('');
}

// Global Keyboard Shortcut Listener
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }

  if (cmdPaletteOpen) {
    if (e.key === "Escape") {
      e.preventDefault();
      toggleCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdPaletteSelectedIndex < cmdPaletteFilteredActions.length - 1) {
        cmdPaletteSelectedIndex++;
        const portal = document.getElementById("studio-portal");
        const list = portal ? portal.querySelector("#studio-cmd-list") : null;
        if (list) list.innerHTML = renderCmdPaletteItemsHtml();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdPaletteSelectedIndex > 0) {
        cmdPaletteSelectedIndex--;
        const portal = document.getElementById("studio-portal");
        const list = portal ? portal.querySelector("#studio-cmd-list") : null;
        if (list) list.innerHTML = renderCmdPaletteItemsHtml();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = cmdPaletteFilteredActions[cmdPaletteSelectedIndex];
      if (action && typeof action.run === "function") {
        toggleCommandPalette();
        action.run();
      }
    }
  }
});

// Click listener on command palette items
document.addEventListener("click", (e) => {
  const item = e.target.closest(".studio-cmd-item");
  if (item && item.dataset.cmdIdx !== undefined) {
    const idx = parseInt(item.dataset.cmdIdx, 10);
    const action = cmdPaletteFilteredActions[idx];
    if (action && typeof action.run === "function") {
      toggleCommandPalette();
      action.run();
    }
  }
});

// ============================================================
// MOUNT FUNCTION FOR APP.JS ROUTER
// ============================================================
async function pdfStudioPage() {
  ensureStudioPortal();
  const content = document.getElementById("content");
  if (!content) return;

  content.innerHTML = '<main id="studio-root"></main>';
  renderStudioAll();
}

// Global API & Window Exports
window.pdfStudioPage = pdfStudioPage;
window.openPdfFilePathInStudio = openPdfFilePathInStudio;
window.openUploadedPdfInStudio = openUploadedPdfInStudio;
window.openPdfStudioWithFiles = openPdfStudioWithFiles;
window.studioToast = studioToast;
window.ensureStudioPortal = ensureStudioPortal;
window.openOrg = openOrg;
window.closeOrg = closeOrg;
window.STUDIO_CATEGORIES = STUDIO_CATEGORIES;
window.STUDIO_TOOLS = STUDIO_CATEGORIES[0].tools;

})();
