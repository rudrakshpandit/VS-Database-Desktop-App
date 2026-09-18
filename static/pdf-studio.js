/**
 * VS Database — PDF Studio Subsystem Frontend Module
 * Professional 3-Pane Glassmorphic PDF Editing Workspace.
 * Tool-Based Execution via Backend API Engine.
 */

let currentPdfSession = null;
let currentThumbnails = [];
let currentPreviewPage = 1;
let currentZoom = 1.0;
let pdfStudioOriginContext = null;
let isExecutingPdfTool = false;

function safeNavigate(page) {
  if (typeof window.safeNavigate === 'function' && window.safeNavigate !== safeNavigate) {
    window.safeNavigate(page);
    return;
  }
  if (typeof window.navigateTo === 'function') {
    window.navigateTo(page);
    return;
  }
  if (typeof navigateTo === 'function') {
    navigateTo(page);
    return;
  }
  window.location.hash = page;
  const btn = document.querySelector(`nav button[data-page="${page}"]`);
  if (btn) {
    btn.click();
  } else if (typeof render === 'function') {
    if (typeof current !== 'undefined') current = page;
    if (typeof nav === 'function') nav();
    else render();
  }
}
window.safeNavigate = safeNavigate;

// Expose open session helper globally
window.openPdfStudioSession = function(session, thumbnails, originContext) {
  currentPdfSession = session;
  currentThumbnails = thumbnails || [];
  currentPreviewPage = 1;
  currentZoom = 1.0;
  pdfStudioOriginContext = originContext || null;
  safeNavigate('pdf-studio');
};

async function pdfStudioPage() {
  const content = document.getElementById('content');
  if (!content) return;

  if (!currentPdfSession) {
    renderPdfStudioEmptyState(content);
    return;
  }

  renderPdfStudioWorkspace(content);
}

function renderPdfStudioEmptyState(content) {
  content.innerHTML = `
    <div class="card" style="max-width: 900px; margin: 20px auto; text-align: center; padding: 48px 32px;">
      <div style="font-size: 54px; margin-bottom: 12px;">📑</div>
      <h1 style="color: #0A1F44; margin-bottom: 8px; font-size: 24px;">VS PDF Studio</h1>
      <p style="color: var(--muted); font-size: 14px; max-width: 540px; margin: 0 auto 28px auto; line-height: 1.6;">
        Professional PDF workspace: Merge, Compress, Watermark, Split, Rotate, Lock, and Chain multiple operations before saving to client.
      </p>

      <div id="pdf-studio-open-dropzone" class="dropzone" style="border: 2px dashed rgba(112, 126, 187, 0.4); border-radius: 20px; padding: 42px 24px; background: rgba(255, 255, 255, 0.65); cursor: pointer; transition: all 0.2s ease; max-width: 540px; margin: 0 auto 24px auto;">
        <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
        <h3 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: #0A1F44;">Choose or Drop a PDF File</h3>
        <p style="margin: 0 0 16px 0; font-size: 12px; color: var(--muted);">Click to browse files or drag & drop a PDF here</p>
        <span class="badge" style="background:#eef2ff;color:#4968ed;border:1px solid #c7d2fe;padding:8px 20px;border-radius:20px;font-size:12.5px;font-weight:600;">Browse PDF from Computer</span>
        <input type="file" id="pdf-studio-file-input" accept="application/pdf,.pdf" style="display:none;">
      </div>

      <div style="display: flex; justify-content: center; gap: 12px;">
        <button type="button" class="btn" onclick="safeNavigate('save')" style="font-size: 12.5px; padding: 8px 18px;">
          ← Return to Save Files
        </button>
      </div>
    </div>
  `;

  const dropzone = document.getElementById('pdf-studio-open-dropzone');
  const fileInput = document.getElementById('pdf-studio-file-input');

  if (dropzone && fileInput) {
    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) await openUploadedPdfInStudio(file);
    };

    dropzone.ondragover = (e) => { 
      e.preventDefault(); 
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropzone.style.borderColor = '#2563eb'; 
    };
    dropzone.ondragleave = () => { dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)'; };
    dropzone.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = document.getElementById('vs-global-drop-overlay');
      if (overlay) overlay.classList.remove('active');
      dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)';
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        await openUploadedPdfInStudio(file);
      } else {
        if (typeof showNativeToast === 'function') {
          showNativeToast('Please drop a valid PDF file.', 'warning');
        } else {
          alert('Please drop a valid PDF file.');
        }
      }
    };
  }
}

async function openUploadedPdfInStudio(file) {
  try {
    const pb = showGlassProgressBar({ title: 'Opening PDF in Studio', subtitle: 'Processing document structure...' });
    pb.simulate(1000);
    const b64 = await fileToBase64(file);
    const res = await api('/api/pdf-studio/sessions', {
      method: 'POST',
      body: JSON.stringify({
        original_name: file.name,
        file_base64: b64
      })
    });
    await pb.finish('PDF Loaded');
    if (res && res.ok && res.session) {
      window.openPdfStudioSession(res.session, res.thumbnails, null);
    }
  } catch (err) {
    alert('Failed to open PDF: ' + err.message);
  }
}
window.openUploadedPdfInStudio = openUploadedPdfInStudio;

function renderPdfStudioWorkspace(content) {
  const meta = currentPdfSession;
  const isFromSaveTab = Boolean(pdfStudioOriginContext);
  const curSizeKb = (meta.current_size / 1024).toFixed(1);
  const origSizeKb = (meta.original_size / 1024).toFixed(1);
  const sizeDiffPct = meta.original_size > 0 ? (((meta.original_size - meta.current_size) / meta.original_size) * 100).toFixed(1) : '0.0';

  content.innerHTML = `
    <div class="pdf-studio-container">
      <!-- TOP COMMAND BAR -->
      <div class="pdf-studio-topbar glass-card">
        <div class="pdf-studio-title-block">
          <span style="font-size: 22px;">📑</span>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="color:#0A1F44;font-size:14px;letter-spacing:-0.01em;">${escapeHtml(meta.current_name || 'document.pdf')}</strong>
              ${isFromSaveTab ? `<span class="vs-pdf-origin-badge">📥 From Save Tab</span>` : ''}
              ${meta.is_encrypted ? `<span class="vs-pdf-status-glass-badge locked">🔒 AES-256</span>` : `<span class="vs-pdf-status-glass-badge unlocked">🔓 Unlocked</span>`}
            </div>
            <span style="font-size:11.5px;color:var(--muted);">
              ${meta.page_count} Pages • ${curSizeKb} KB
              ${parseFloat(sizeDiffPct) > 0 ? `<span style="color:#16a34a;font-weight:700;margin-left:4px;">(-${sizeDiffPct}%)</span>` : ''}
            </span>
          </div>
        </div>

        <div class="pdf-studio-actions-group">
          ${isFromSaveTab ? `
            <button type="button" class="btn btn-sm btn-outline-danger" id="btn-studio-cancel" title="Discard changes and return to Save Tab">
              ✕ Cancel
            </button>
          ` : `
            <button type="button" class="btn btn-sm" id="btn-studio-open-new" title="Open another PDF">
              📂 Open New
            </button>
          `}

          <button type="button" class="btn btn-sm" id="btn-studio-undo" ${(meta.checkpoint_stack && meta.checkpoint_stack.length > 0) ? '' : 'disabled'} title="Undo last step">
            ↩ Undo
          </button>

          <button type="button" class="btn btn-sm" id="btn-studio-reset" title="Reset all changes to original document">
            ↺ Reset
          </button>

          <button type="button" class="btn btn-sm btn-studio-process-further" id="btn-studio-process-further" title="Chain another PDF operation">
            ✨ Process Further
          </button>

          <button type="button" class="btn btn-sm primary btn-studio-save-client" id="btn-studio-save-client" title="Return to Save Tab and apply this processed PDF">
            💾 Save to Client
          </button>

          <button type="button" class="btn btn-sm btn-studio-download" id="btn-studio-download" title="Download current working PDF to computer">
            ⬇ Download
          </button>
        </div>
      </div>

      <!-- MAIN 3-PANE WORKSPACE -->
      <div class="pdf-studio-main-grid">
        <!-- LEFT PANE: THUMBNAILS & PAGE TOOLS -->
        <aside class="pdf-studio-left-pane glass-card">
          <div class="pdf-studio-pane-header">
            <span>Pages (${currentThumbnails.length})</span>
            <div style="display:flex;gap:4px;">
              <button class="btn-tiny" id="btn-rotate-all-90" title="Rotate all pages 90° CW">🔄 All</button>
            </div>
          </div>

          <div class="pdf-thumbnails-scroll-list" id="pdf-thumbnails-container">
            ${renderThumbnailsListHtml()}
          </div>
        </aside>

        <!-- CENTER PANE: HIGH-RESOLUTION INTERACTIVE VIEWER -->
        <main class="pdf-studio-center-pane glass-card">
          <div class="pdf-viewer-toolbar">
            <div class="pdf-viewer-nav">
              <button class="btn-tiny" id="btn-page-prev" ${currentPreviewPage <= 1 ? 'disabled' : ''}>◀ Prev</button>
              <span style="font-size:12px;font-weight:700;color:#0A1F44;">
                Page <input type="number" id="input-page-jump" min="1" max="${meta.page_count}" value="${currentPreviewPage}" style="width:44px;text-align:center;padding:2px 4px;font-size:12px;border:1px solid #cbd5e1;border-radius:6px;"> of ${meta.page_count}
              </span>
              <button class="btn-tiny" id="btn-page-next" ${currentPreviewPage >= meta.page_count ? 'disabled' : ''}>Next ▶</button>
            </div>

            <div class="pdf-viewer-zoom-controls">
              <button class="btn-tiny" id="btn-zoom-out" title="Zoom Out">🔍−</button>
              <span id="zoom-label" style="font-size:11.5px;color:var(--muted);width:45px;text-align:center;">${Math.round(currentZoom * 100)}%</span>
              <button class="btn-tiny" id="btn-zoom-in" title="Zoom In">🔍+</button>
              <button class="btn-tiny" id="btn-zoom-fit" title="Fit to View">Fit</button>
            </div>
          </div>

          <div class="pdf-preview-stage" id="pdf-preview-stage">
            <div class="pdf-preview-canvas-wrapper" id="pdf-canvas-wrapper" style="transform: scale(${currentZoom});">
              <img id="pdf-main-page-img" src="/api/pdf-studio/sessions/${encodeURIComponent(meta.session_id)}/page/${currentPreviewPage}?dpi=130" alt="Page ${currentPreviewPage}" class="pdf-highres-page-img" />
            </div>
          </div>
        </main>

        <!-- RIGHT PANE: OVERVIEW & TOOL SUITE -->
        <aside class="pdf-studio-right-pane">
          <!-- OVERVIEW CARD -->
          <div class="pdf-overview-card glass-card">
            <div class="pdf-overview-title">
              <span>PDF Overview</span>
              <span style="font-size:11px;font-weight:700;color:#2563eb;">Live State</span>
            </div>

            <div class="pdf-overview-metrics-grid">
              <div class="pdf-metric-row">
                <span class="lbl">Source Files</span>
                <span class="val">${(meta.source_files || []).length}</span>
              </div>
              <div class="pdf-metric-row">
                <span class="lbl">Original Size</span>
                <span class="val">${origSizeKb} KB</span>
              </div>
              <div class="pdf-metric-row">
                <span class="lbl">Working Size</span>
                <span class="val font-bold">${curSizeKb} KB</span>
              </div>
              <div class="pdf-metric-row">
                <span class="lbl">Total Pages</span>
                <span class="val">${meta.page_count}</span>
              </div>
              <div class="pdf-metric-row">
                <span class="lbl">Security</span>
                <span class="val">${meta.is_encrypted ? 'AES-256 Protected' : 'Standard (No Pass)'}</span>
              </div>
            </div>
          </div>

          <!-- TOOL LAUNCHER SUITE -->
          <div class="pdf-tools-launcher-card glass-card">
            <div class="pdf-overview-title" style="margin-bottom:10px;">
              <span>PDF Tool Engine</span>
              <span style="font-size:10.5px;color:var(--muted);">10 Modular Tools</span>
            </div>

            <div class="pdf-tools-button-grid">
              <button type="button" class="btn-studio-tool" data-tool="watermark" title="Add text stamp or watermark">
                <span class="tool-icon">💧</span>
                <span class="tool-name">Watermark</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="compress" title="Compress and reduce file size">
                <span class="tool-icon">🗜️</span>
                <span class="tool-name">Compress</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="lock" title="Encrypt with password">
                <span class="tool-icon">🔐</span>
                <span class="tool-name">Lock</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="unlock" title="Remove password protection">
                <span class="tool-icon">🔓</span>
                <span class="tool-name">Unlock</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="rotate" title="Rotate pages">
                <span class="tool-icon">🔄</span>
                <span class="tool-name">Rotate</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="merge" title="Append other PDFs">
                <span class="tool-icon">📄</span>
                <span class="tool-name">Merge</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="split" title="Extract page range">
                <span class="tool-icon">✂️</span>
                <span class="tool-name">Split</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="insert" title="Insert external pages">
                <span class="tool-icon">➕</span>
                <span class="tool-name">Insert</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="rearrange" title="Reorder pages">
                <span class="tool-icon">🔀</span>
                <span class="tool-name">Rearrange</span>
              </button>

              <button type="button" class="btn-studio-tool" data-tool="delete" title="Delete pages">
                <span class="tool-icon">🗑️</span>
                <span class="tool-name">Delete</span>
              </button>
            </div>
          </div>

          <!-- OPERATION HISTORY AUDIT TIMELINE -->
          <div class="pdf-history-card glass-card">
            <div class="pdf-overview-title" style="margin-bottom:8px;">
              <span>Operation History</span>
              <span style="font-size:10.5px;color:var(--muted);">${(meta.history || []).length} steps</span>
            </div>

            <div class="pdf-history-scroll-list">
              ${renderHistoryListHtml(meta.history)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  attachStudioWorkspaceEvents();
}

function renderThumbnailsListHtml() {
  if (!currentThumbnails || !currentThumbnails.length) {
    return `<div style="padding:16px;text-align:center;font-size:12px;color:var(--muted);">No pages found.</div>`;
  }
  const sessId = currentPdfSession ? currentPdfSession.session_id : '';
  const timeKey = currentPdfSession ? (currentPdfSession.history_count || Date.now()) : Date.now();
  return currentThumbnails.map((th, idx) => {
    const isSelected = (th.page_num === currentPreviewPage);
    const thumbSrc = th.data_url || th.url || (sessId ? `/api/pdf-studio/sessions/${encodeURIComponent(sessId)}/page/${th.page_num}?dpi=45&t=${timeKey}` : '');
    return `
      <div class="pdf-thumb-card ${isSelected ? 'active' : ''}" data-page="${th.page_num}">
        <div class="pdf-thumb-img-wrapper">
          ${!th.is_locked && thumbSrc ? `<img src="${thumbSrc}" loading="lazy" alt="Page ${th.page_num}" class="pdf-thumb-img" />` : `<div class="pdf-thumb-locked">🔒</div>`}
          <span class="pdf-thumb-num-badge">P${th.page_num}</span>
          <div class="pdf-thumb-hover-actions">
            <button class="btn-thumb-action btn-thumb-rot" data-page="${th.page_num}" title="Rotate 90° CW">🔄</button>
            <button class="btn-thumb-action btn-thumb-del" data-page="${th.page_num}" title="Delete page">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderHistoryListHtml(history) {
  if (!history || !history.length) {
    return `<div style="padding:14px;text-align:center;font-size:11.5px;color:var(--muted);">No operations applied yet.</div>`;
  }
  return history.map(item => `
    <div class="pdf-history-item">
      <div class="pdf-hist-dot"></div>
      <div class="pdf-hist-content">
        <strong style="color:#0A1F44;font-size:11.5px;">${escapeHtml(item.title || item.tool_id)}</strong>
        <p style="margin:2px 0 0 0;font-size:11px;color:var(--muted);">${escapeHtml(item.details || '')}</p>
        ${item.stats_diff ? `<span class="badge" style="background:#ecfdf5;color:#059669;font-size:10px;padding:1px 6px;margin-top:2px;">${escapeHtml(item.stats_diff)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function attachStudioWorkspaceEvents() {
  const meta = currentPdfSession;

  // Page selection click
  document.querySelectorAll('.pdf-thumb-card').forEach(card => {
    card.onclick = () => {
      const page = parseInt(card.dataset.page);
      if (page && page !== currentPreviewPage) {
        currentPreviewPage = page;
        updatePreviewPageDisplay();
      }
    };
  });

  // Per-thumb hover actions
  document.querySelectorAll('.btn-thumb-rot').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const page = parseInt(btn.dataset.page);
      await executeStudioTool('rotate_pages', { angle: 90, pages: [page] });
    };
  });

  document.querySelectorAll('.btn-thumb-del').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const page = parseInt(btn.dataset.page);
      if (meta.page_count <= 1) {
        alert('Cannot delete the only page in the document.');
        return;
      }
      if (confirm(`Are you sure you want to delete Page ${page}?`)) {
        await executeStudioTool('delete_pages', { pages: [page] });
      }
    };
  });

  // Zoom controls
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const zoomFitBtn = document.getElementById('btn-zoom-fit');
  const canvasWrapper = document.getElementById('pdf-canvas-wrapper');
  const zoomLabel = document.getElementById('zoom-label');

  if (zoomInBtn && zoomOutBtn && canvasWrapper) {
    zoomInBtn.onclick = () => {
      currentZoom = Math.min(2.5, currentZoom + 0.2);
      applyZoom();
    };
    zoomOutBtn.onclick = () => {
      currentZoom = Math.max(0.4, currentZoom - 0.2);
      applyZoom();
    };
    zoomFitBtn.onclick = () => {
      currentZoom = 1.0;
      applyZoom();
    };
  }

  function applyZoom() {
    if (canvasWrapper) canvasWrapper.style.transform = `scale(${currentZoom})`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
  }

  // Page navigation
  const prevBtn = document.getElementById('btn-page-prev');
  const nextBtn = document.getElementById('btn-page-next');
  const pageJumpInput = document.getElementById('input-page-jump');

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentPreviewPage > 1) {
        currentPreviewPage--;
        updatePreviewPageDisplay();
      }
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentPreviewPage < meta.page_count) {
        currentPreviewPage++;
        updatePreviewPageDisplay();
      }
    };
  }
  if (pageJumpInput) {
    pageJumpInput.onchange = () => {
      const p = parseInt(pageJumpInput.value);
      if (p >= 1 && p <= meta.page_count) {
        currentPreviewPage = p;
        updatePreviewPageDisplay();
      } else {
        pageJumpInput.value = currentPreviewPage;
      }
    };
  }

  // Tool buttons
  document.querySelectorAll('.btn-studio-tool').forEach(btn => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      openStudioToolModal(tool);
    };
  });

  // Action buttons
  const undoBtn = document.getElementById('btn-studio-undo');
  if (undoBtn) {
    undoBtn.onclick = async () => {
      try {
        const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(meta.session_id)}/undo`, {
          method: 'POST',
          timeout: 60000,
          body: '{}'
        });
        if (res && res.ok && res.session) {
          currentPdfSession = res.session;
          currentThumbnails = res.thumbnails;
          currentPreviewPage = Math.min(currentPreviewPage, res.session.page_count);
          renderPdfStudioWorkspace(document.getElementById('content'));
        }
      } catch (err) {
        if (typeof showNativeAlert === 'function') {
          showNativeAlert('Undo failed: ' + err.message, { title: 'Undo Failed', type: 'error' });
        } else {
          alert('Undo failed: ' + err.message);
        }
      }
    };
  }

  const resetBtn = document.getElementById('btn-studio-reset');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      let ok = true;
      if (typeof showNativeConfirm === 'function') {
        ok = await showNativeConfirm('Are you sure you want to reset all changes back to the original uploaded document?', { title: 'Reset Document', confirmText: 'Reset to Original' });
      } else {
        ok = confirm('Are you sure you want to reset all changes back to the original uploaded document?');
      }
      if (!ok) return;

      try {
        const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(meta.session_id)}/reset`, {
          method: 'POST',
          timeout: 60000,
          body: '{}'
        });
        if (res && res.ok && res.session) {
          currentPdfSession = res.session;
          currentThumbnails = res.thumbnails;
          currentPreviewPage = 1;
          renderPdfStudioWorkspace(document.getElementById('content'));
          if (typeof showNativeToast === 'function') {
            showNativeToast('Document reset to original version.', 'info', 3000);
          }
        }
      } catch (err) {
        if (typeof showNativeAlert === 'function') {
          showNativeAlert('Reset failed: ' + err.message, { title: 'Reset Failed', type: 'error' });
        } else {
          alert('Reset failed: ' + err.message);
        }
      }
    };
  }

  const procFurtherBtn = document.getElementById('btn-studio-process-further');
  if (procFurtherBtn) {
    procFurtherBtn.onclick = () => openProcessFurtherModal();
  }

  const cancelBtn = document.getElementById('btn-studio-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      let ok = true;
      if (typeof showNativeConfirm === 'function') {
        ok = await showNativeConfirm('Return to Save Files? Any changes made here that were not applied to the save queue will remain in this session.', { title: 'Exit PDF Studio', confirmText: 'Return to Save' });
      } else {
        ok = confirm('Return to Save Files? Any changes made here that were not applied to the save queue will remain in this session.');
      }
      if (ok) safeNavigate('save');
    };
  }

  const openNewBtn = document.getElementById('btn-studio-open-new');
  if (openNewBtn) {
    openNewBtn.onclick = () => {
      currentPdfSession = null;
      renderPdfStudioEmptyState(document.getElementById('content'));
    };
  }

  const downloadBtn = document.getElementById('btn-studio-download');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      window.open(`/api/pdf-studio/sessions/${encodeURIComponent(meta.session_id)}/download`, '_blank');
    };
  }

  const saveClientBtn = document.getElementById('btn-studio-save-client');
  if (saveClientBtn) {
    saveClientBtn.onclick = async () => {
      await handleSaveToClientHandoff();
    };
  }

  const rotateAllBtn = document.getElementById('btn-rotate-all-90');
  if (rotateAllBtn) {
    rotateAllBtn.onclick = async () => {
      await executeStudioTool('rotate_pages', { angle: 90, pages: 'all' });
    };
  }
}

function updatePreviewPageDisplay() {
  const meta = currentPdfSession;
  const img = document.getElementById('pdf-main-page-img');
  if (img) {
    img.src = `/api/pdf-studio/sessions/${encodeURIComponent(meta.session_id)}/page/${currentPreviewPage}?dpi=130&t=${Date.now()}`;
  }
  const jumpInput = document.getElementById('input-page-jump');
  if (jumpInput) jumpInput.value = currentPreviewPage;

  document.querySelectorAll('.pdf-thumb-card').forEach(card => {
    card.classList.toggle('active', parseInt(card.dataset.page) === currentPreviewPage);
  });

  const prevBtn = document.getElementById('btn-page-prev');
  const nextBtn = document.getElementById('btn-page-next');
  if (prevBtn) prevBtn.disabled = (currentPreviewPage <= 1);
  if (nextBtn) nextBtn.disabled = (currentPreviewPage >= meta.page_count);
}

async function executeStudioTool(toolId, parameters) {
  if (isExecutingPdfTool || !currentPdfSession) return;
  isExecutingPdfTool = true;
  const pb = showGlassProgressBar({ title: 'Processing PDF', subtitle: `Applying tool: ${toolId}...` });
  pb.simulate(1200);

  try {
    const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/execute`, {
      method: 'POST',
      timeout: 60000,
      body: JSON.stringify({ tool_id: toolId, parameters: parameters || {} })
    });

    await pb.finish('Applied Successfully');
    if (res && res.ok && res.session) {
      currentPdfSession = res.session;
      currentThumbnails = res.thumbnails || [];
      currentPreviewPage = Math.min(currentPreviewPage, res.session.page_count);
      renderPdfStudioWorkspace(document.getElementById('content'));
      if (typeof showNativeToast === 'function') {
        const msg = (res.result && res.result.message) ? res.result.message : `${toolId.replace('_', ' ').toUpperCase()} applied successfully!`;
        showNativeToast(msg, 'success', 3500);
      }
    }
  } catch (err) {
    await pb.finish('Error');
    if (typeof showNativeAlert === 'function') {
      showNativeAlert(err.message, { title: 'Tool Execution Failed', type: 'error' });
    } else {
      alert(`Tool execution failed: ${err.message}`);
    }
  } finally {
    isExecutingPdfTool = false;
  }
}

async function handleSaveToClientHandoff() {
  if (!currentPdfSession) return;

  if (pdfStudioOriginContext && window.saveStaging) {
    // Return to originating Save Tab staging session
    try {
      const pb = showGlassProgressBar({ title: 'Applying to Save Queue', subtitle: 'Updating staging session on disk...' });
      pb.simulate(1000);
      await window.saveStaging.applyPdfStudioResult(currentPdfSession.session_id, currentPdfSession.current_name);
      await pb.finish('Applied to Save Queue');
      if (typeof showNativeToast === 'function') {
        showNativeToast('Document returned to Save Queue successfully.', 'success', 3000);
      }
    } catch (err) {
      if (typeof showNativeAlert === 'function') {
        showNativeAlert('Failed to return to Save Tab: ' + err.message, { title: 'Save Queue Error', type: 'error' });
      } else {
        alert('Failed to return to Save Tab: ' + err.message);
      }
    }
  } else {
    // Direct PDF Studio session -> add to staging manager and switch to Save Tab
    try {
      const pb = showGlassProgressBar({ title: 'Preparing Save Tab', subtitle: 'Exporting document to staging...' });
      pb.simulate(1000);
      const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(currentPdfSession.session_id)}/download`);
      // Use staging direct file
      safeNavigate('save');
      await pb.finish('Ready in Save Tab');
    } catch (err) {
      safeNavigate('save');
    }
  }
}

// =========================================================================
// GLASSMORPHIC MODAL DIALOGS FOR THE 10 TOOLS
// =========================================================================

function openProcessFurtherModal() {
  closeActiveStudioModal();
  const modalRoot = document.getElementById('auth-modal-root') || document.body;
  const div = document.createElement('div');
  div.className = 'vs-studio-modal-overlay';
  div.id = 'studio-tool-modal';

  div.innerHTML = `
    <div class="vs-studio-modal-card glass-card">
      <div class="vs-modal-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:22px;">✨</span>
          <h3 style="margin:0;color:#0A1F44;font-size:16px;">Process Further</h3>
        </div>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>

      <p style="font-size:12.5px;color:var(--muted);margin:0 0 16px 0;">
        Chain another operation on the current working copy (<strong>${escapeHtml(currentPdfSession.current_name)}</strong>, ${currentPdfSession.page_count} pages).
      </p>

      <div class="pdf-tools-button-grid" style="grid-template-columns: repeat(3, 1fr); gap: 10px;">
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('watermark')"><span class="tool-icon">💧</span><span class="tool-name">Watermark</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('compress')"><span class="tool-icon">🗜️</span><span class="tool-name">Compress</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('lock')"><span class="tool-icon">🔐</span><span class="tool-name">Lock</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('unlock')"><span class="tool-icon">🔓</span><span class="tool-name">Unlock</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('rotate')"><span class="tool-icon">🔄</span><span class="tool-name">Rotate</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('merge')"><span class="tool-icon">📄</span><span class="tool-name">Merge</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('split')"><span class="tool-icon">✂️</span><span class="tool-name">Split</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('insert')"><span class="tool-icon">➕</span><span class="tool-name">Insert</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('rearrange')"><span class="tool-icon">🔀</span><span class="tool-name">Rearrange</span></button>
        <button type="button" class="btn-studio-tool" onclick="openStudioToolModal('delete')"><span class="tool-icon">🗑️</span><span class="tool-name">Delete Pages</span></button>
      </div>
    </div>
  `;
  modalRoot.appendChild(div);
}

function openStudioToolModal(toolId) {
  closeActiveStudioModal();
  const modalRoot = document.getElementById('auth-modal-root') || document.body;
  const div = document.createElement('div');
  div.className = 'vs-studio-modal-overlay';
  div.id = 'studio-tool-modal';

  let bodyHtml = '';
  let postRender = () => {};

  if (toolId === 'watermark' || toolId === 'watermark_pdf') {
    let activeWmTab = 'image';
    let selectedAsset = 'vs_logo';
    let customImgBase64 = null;

    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">💧 Apply Watermark</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>

      <!-- Tab Switcher -->
      <div class="vs-modal-tabs" style="margin-top:10px;">
        <button type="button" class="vs-modal-tab-btn active" id="tab-wm-image">🖼️ Image / Logo Watermark</button>
        <button type="button" class="vs-modal-tab-btn" id="tab-wm-text">🔤 Text Watermark</button>
      </div>

      <!-- IMAGE WATERMARK PANEL -->
      <div id="wm-image-panel" style="display:flex;flex-direction:column;gap:12px;margin:12px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:6px;">Select Logo / Watermark Image:</label>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <!-- Option 1: Official VS Logo (Pre-filled Default!) -->
            <label class="vs-asset-card-select selected" id="card-asset-vs_logo">
              <input type="radio" name="wm-asset-choice" value="vs_logo" checked style="accent-color:#2563eb;">
              <img src="/static/logo.png" style="height:28px;max-width:140px;object-fit:contain;" alt="VS Logo">
              <div style="flex:1;">
                <strong style="font-size:12.5px;color:#0A1F44;">VS Database Official Logo</strong>
                <span style="display:block;font-size:11px;color:var(--muted);">Pre-filled official firm logo asset</span>
              </div>
            </label>

            <!-- Option 2: VS Monogram Emblem -->
            <label class="vs-asset-card-select" id="card-asset-vs_emblem">
              <input type="radio" name="wm-asset-choice" value="vs_emblem" style="accent-color:#2563eb;">
              <img src="/static/logo_emblem.png" style="height:28px;width:28px;object-fit:contain;" alt="VS Emblem">
              <div style="flex:1;">
                <strong style="font-size:12.5px;color:#0A1F44;">VS Monogram Emblem</strong>
                <span style="display:block;font-size:11px;color:var(--muted);">Square crest / monogram icon watermark</span>
              </div>
            </label>

            <!-- Option 3: Custom Upload -->
            <label class="vs-asset-card-select" id="card-asset-custom">
              <input type="radio" name="wm-asset-choice" value="custom" style="accent-color:#2563eb;">
              <span style="font-size:22px;">📁</span>
              <div style="flex:1;">
                <strong style="font-size:12.5px;color:#0A1F44;">Upload Custom Image...</strong>
                <span style="display:block;font-size:11px;color:var(--muted);" id="wm-custom-filename">Select custom PNG or JPG from computer</span>
              </div>
              <input type="file" id="wm-custom-file-input" accept="image/png,image/jpeg,image/webp" style="display:none;">
            </label>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Placement:</label>
            <select id="wm-img-pos" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;">
              <option value="center" selected>Center of Page</option>
              <option value="top_right">Top-Right Header</option>
              <option value="bottom_right">Bottom-Right Footer</option>
              <option value="top_left">Top-Left Header</option>
              <option value="bottom_left">Bottom-Left Footer</option>
              <option value="top_header">Top Center Header</option>
              <option value="bottom_footer">Bottom Center Footer</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Logo Size / Scale:</label>
            <select id="wm-img-scale" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;">
              <option value="small">Small (25% page width)</option>
              <option value="medium" selected>Medium (45% page width)</option>
              <option value="large">Large (70% page width)</option>
              <option value="fit">Fit / Hero (90% width)</option>
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Opacity: <span id="wm-img-op-val">25%</span></label>
            <input type="range" id="wm-img-opacity" min="0.05" max="0.95" step="0.05" value="0.25" style="width:100%;">
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Target Pages:</label>
            <select id="wm-img-target" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;">
              <option value="all" selected>All Pages (${currentPdfSession.page_count})</option>
              <option value="current">Current Page (${currentPreviewPage})</option>
            </select>
          </div>
        </div>
      </div>

      <!-- TEXT WATERMARK PANEL -->
      <div id="wm-text-panel" style="display:none;flex-direction:column;gap:12px;margin:12px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Watermark Text:</label>
          <input type="text" id="wm-text-input" value="CONFIDENTIAL" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            ${['CONFIDENTIAL', 'DRAFT', 'ORIGINAL', 'COPY', 'APPROVED'].map(t => `<button type="button" class="badge btn-wm-preset" style="cursor:pointer;background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;" onclick="document.getElementById('wm-text-input').value='${t}'">${t}</button>`).join('')}
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Position:</label>
          <select id="wm-pos-select" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
            <option value="center_diagonal" selected>Center Diagonal (45°)</option>
            <option value="center_horizontal">Center Horizontal (0°)</option>
            <option value="top_header">Top Header</option>
            <option value="bottom_footer">Bottom Footer</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Opacity: <span id="wm-op-val">25%</span></label>
            <input type="range" id="wm-opacity" min="0.05" max="0.9" step="0.05" value="0.25" style="width:100%;">
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Font Size: <span id="wm-size-val">42pt</span></label>
            <input type="range" id="wm-fontsize" min="18" max="72" step="2" value="42" style="width:100%;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Color:</label>
            <input type="color" id="wm-color" value="#DC2626" style="width:100%;height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:2px;cursor:pointer;">
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Target Pages:</label>
            <select id="wm-text-target" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;">
              <option value="all" selected>All Pages (${currentPdfSession.page_count})</option>
              <option value="current">Current Page (${currentPreviewPage})</option>
            </select>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-wm">Apply Watermark</button>
      </div>
    `;

    postRender = () => {
      const tabImg = div.querySelector('#tab-wm-image');
      const tabTxt = div.querySelector('#tab-wm-text');
      const pnlImg = div.querySelector('#wm-image-panel');
      const pnlTxt = div.querySelector('#wm-text-panel');
      const imgOpSlider = div.querySelector('#wm-img-opacity');
      const imgOpVal = div.querySelector('#wm-img-op-val');
      const txtOpSlider = div.querySelector('#wm-opacity');
      const txtOpVal = div.querySelector('#wm-op-val');
      const txtSzSlider = div.querySelector('#wm-fontsize');
      const txtSzVal = div.querySelector('#wm-size-val');

      if (imgOpSlider && imgOpVal) {
        imgOpSlider.oninput = () => { imgOpVal.textContent = Math.round(imgOpSlider.value * 100) + '%'; };
      }
      if (txtOpSlider && txtOpVal) {
        txtOpSlider.oninput = () => { txtOpVal.textContent = Math.round(txtOpSlider.value * 100) + '%'; };
      }
      if (txtSzSlider && txtSzVal) {
        txtSzSlider.oninput = () => { txtSzVal.textContent = txtSzSlider.value + 'pt'; };
      }

      tabImg.onclick = () => {
        activeWmTab = 'image';
        tabImg.classList.add('active');
        tabTxt.classList.remove('active');
        pnlImg.style.display = 'flex';
        pnlTxt.style.display = 'none';
      };
      tabTxt.onclick = () => {
        activeWmTab = 'text';
        tabTxt.classList.add('active');
        tabImg.classList.remove('active');
        pnlTxt.style.display = 'flex';
        pnlImg.style.display = 'none';
      };

      const customFileInput = div.querySelector('#wm-custom-file-input');
      const cardVsLogo = div.querySelector('#card-asset-vs_logo');
      const cardVsEmblem = div.querySelector('#card-asset-vs_emblem');
      const cardCustom = div.querySelector('#card-asset-custom');

      const updateAssetSelection = (assetKey) => {
        selectedAsset = assetKey;
        [cardVsLogo, cardVsEmblem, cardCustom].forEach(c => c && c.classList.remove('selected'));
        if (assetKey === 'vs_logo') cardVsLogo && cardVsLogo.classList.add('selected');
        if (assetKey === 'vs_emblem') cardVsEmblem && cardVsEmblem.classList.add('selected');
        if (assetKey === 'custom') cardCustom && cardCustom.classList.add('selected');
      };

      if (cardVsLogo) cardVsLogo.onclick = () => updateAssetSelection('vs_logo');
      if (cardVsEmblem) cardVsEmblem.onclick = () => updateAssetSelection('vs_emblem');
      if (cardCustom) {
        cardCustom.onclick = () => {
          updateAssetSelection('custom');
          if (!customImgBase64 && customFileInput) customFileInput.click();
        };
      }

      if (customFileInput) {
        customFileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              customImgBase64 = ev.target.result;
              const fnLabel = div.querySelector('#wm-custom-filename');
              if (fnLabel) fnLabel.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
              updateAssetSelection('custom');
            };
            reader.readAsDataURL(file);
          }
        };
      }

      const applyBtn = div.querySelector('#btn-apply-wm');
      if (applyBtn) {
        applyBtn.onclick = async () => {
          closeActiveStudioModal();
          if (activeWmTab === 'image') {
            const pos = div.querySelector('#wm-img-pos').value;
            const scale = div.querySelector('#wm-img-scale').value;
            const opacity = parseFloat(div.querySelector('#wm-img-opacity').value);
            const target = div.querySelector('#wm-img-target').value;
            const pages = target === 'all' ? 'all' : [currentPreviewPage];

            const payload = {
              watermark_type: 'image',
              position: pos,
              scale: scale,
              opacity: opacity,
              pages: pages
            };
            if (selectedAsset === 'custom' && customImgBase64) {
              payload.image_bytes = customImgBase64;
            } else {
              payload.image_asset = selectedAsset;
            }
            await executeStudioTool('watermark_pdf', payload);
          } else {
            const text = div.querySelector('#wm-text-input').value.trim();
            if (!text) {
              if (typeof showNativeAlert === 'function') showNativeAlert('Please enter watermark text.', { type: 'warning' });
              else alert('Please enter watermark text.');
              return;
            }
            const pos = div.querySelector('#wm-pos-select').value;
            const op = parseFloat(div.querySelector('#wm-opacity').value);
            const sz = parseInt(div.querySelector('#wm-fontsize').value);
            const col = div.querySelector('#wm-color').value;
            const target = div.querySelector('#wm-text-target').value;
            const pages = target === 'all' ? 'all' : [currentPreviewPage];
            await executeStudioTool('watermark_pdf', { watermark_type: 'text', text, position: pos, opacity: op, font_size: sz, color: col, pages });
          }
        };
      }
    };
  } else if (toolId === 'merge' || toolId === 'merge_pdf') {
    let selectedFiles = []; // array of { file, name, size, base64 }

    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">📄 Merge PDF Documents</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 14px 0;">
        Combine one or more secondary PDF files with the current working document (<strong>${escapeHtml(currentPdfSession.current_name)}</strong>, ${currentPdfSession.page_count} pages).
      </p>

      <div id="merge-dropzone" class="dropzone" style="border: 2px dashed rgba(112, 126, 187, 0.4); border-radius: 14px; padding: 22px 16px; background: rgba(255, 255, 255, 0.65); text-align: center; cursor: pointer; transition: all 0.2s ease; margin-bottom: 12px;">
        <div style="font-size: 28px; margin-bottom: 6px;">📑</div>
        <div style="font-size: 13px; font-weight: 700; color: #0A1F44;">Click or Drop PDF Files Here</div>
        <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Select 1 or more PDF files to combine</div>
        <input type="file" id="merge-file-input" accept="application/pdf,.pdf" multiple style="display:none;">
      </div>

      <div id="merge-files-list" style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: rgba(248, 250, 252, 0.6);">
        <div id="merge-no-files" style="font-size: 12px; color: var(--muted); text-align: center; padding: 8px;">No additional PDFs selected yet.</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
        <label style="font-size:12px; font-weight: 700; color: #334155;">Merge Placement Order:</label>
        <div style="display: flex; gap: 16px;">
          <label style="font-size: 12.5px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="radio" name="merge-order" value="append" checked style="accent-color:#2563eb;"> Append to End (After page ${currentPdfSession.page_count})
          </label>
          <label style="font-size: 12.5px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="radio" name="merge-order" value="prepend" style="accent-color:#2563eb;"> Prepend to Beginning (Before page 1)
          </label>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-merge" disabled>Merge Documents</button>
      </div>
    `;

    postRender = () => {
      const dropzone = div.querySelector('#merge-dropzone');
      const fileInput = div.querySelector('#merge-file-input');
      const listEl = div.querySelector('#merge-files-list');
      const applyBtn = div.querySelector('#btn-apply-merge');

      const renderFiles = () => {
        if (!selectedFiles.length) {
          listEl.innerHTML = `<div id="merge-no-files" style="font-size: 12px; color: var(--muted); text-align: center; padding: 8px;">No additional PDFs selected yet.</div>`;
          applyBtn.disabled = true;
          return;
        }
        applyBtn.disabled = false;
        listEl.innerHTML = selectedFiles.map((f, idx) => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 8px; background: #fff; border: 1px solid #e2e8f0; font-size: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
              <span style="font-size: 14px;">📄</span>
              <span style="font-weight: 600; color: #1e293b; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 260px;">${escapeHtml(f.name)}</span>
              <span style="font-size: 11px; color: var(--muted);">(${(f.size / 1024).toFixed(1)} KB)</span>
            </div>
            <button type="button" class="btn-remove-merge-file" data-idx="${idx}" style="background: transparent; border: 0; color: #ef4444; font-size: 13px; cursor: pointer; padding: 2px 6px; border-radius: 4px;">✕</button>
          </div>
        `).join('');

        listEl.querySelectorAll('.btn-remove-merge-file').forEach(btn => {
          btn.onclick = (e) => {
            const i = parseInt(btn.dataset.idx);
            selectedFiles.splice(i, 1);
            renderFiles();
          };
        });
      };

      const handleFiles = (files) => {
        for (const file of files) {
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              selectedFiles.push({ name: file.name, size: file.size, base64: ev.target.result });
              renderFiles();
            };
            reader.readAsDataURL(file);
          }
        }
      };

      dropzone.onclick = () => fileInput.click();
      fileInput.onchange = (e) => handleFiles(e.target.files);

      dropzone.ondragover = (e) => { 
        e.preventDefault(); 
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dropzone.style.borderColor = '#2563eb'; 
      };
      dropzone.ondragleave = () => { dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)'; };
      dropzone.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const overlay = document.getElementById('vs-global-drop-overlay');
        if (overlay) overlay.classList.remove('active');
        dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)';
        if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
      };

      applyBtn.onclick = async () => {
        if (!selectedFiles.length) return;
        const order = div.querySelector('input[name="merge-order"]:checked')?.value || 'append';
        const filesPayload = selectedFiles.map(f => ({ name: f.name, data: f.base64 }));
        closeActiveStudioModal();
        await executeStudioTool('merge_pdf', { additional_files: filesPayload, order });
      };
    };
  } else if (toolId === 'insert' || toolId === 'insert_pages') {
    let chosenFile = null;

    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">➕ Insert PDF Pages</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 14px 0;">
        Insert pages from another PDF into a specific position within the active document (${currentPdfSession.page_count} pages).
      </p>

      <div id="insert-dropzone" class="dropzone" style="border: 2px dashed rgba(112, 126, 187, 0.4); border-radius: 14px; padding: 20px 16px; background: rgba(255, 255, 255, 0.65); text-align: center; cursor: pointer; transition: all 0.2s ease; margin-bottom: 14px;">
        <div style="font-size: 26px; margin-bottom: 4px;">📂</div>
        <div style="font-size: 13px; font-weight: 700; color: #0A1F44;" id="insert-drop-label">Click or Drop a PDF File Here</div>
        <div style="font-size: 11px; color: var(--muted); margin-top: 2px;" id="insert-drop-sub">Choose 1 PDF file to insert</div>
        <input type="file" id="insert-file-input" accept="application/pdf,.pdf" style="display:none;">
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Insertion Location:</label>
          <select id="insert-pos-select" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
            <option value="end" selected>At the End of Document (After Page ${currentPdfSession.page_count})</option>
            <option value="start">At the Beginning (Before Page 1)</option>
            <option value="after_page">After Specific Page...</option>
            <option value="before_page">Before Specific Page...</option>
          </select>
        </div>

        <div id="insert-page-num-wrapper" style="display:none;">
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Target Page Number (1 - ${currentPdfSession.page_count}):</label>
          <input type="number" id="insert-target-page" min="1" max="${currentPdfSession.page_count}" value="${currentPreviewPage}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-insert" disabled>Insert Pages</button>
      </div>
    `;

    postRender = () => {
      const dropzone = div.querySelector('#insert-dropzone');
      const fileInput = div.querySelector('#insert-file-input');
      const dropLabel = div.querySelector('#insert-drop-label');
      const dropSub = div.querySelector('#insert-drop-sub');
      const posSelect = div.querySelector('#insert-pos-select');
      const pageWrapper = div.querySelector('#insert-page-num-wrapper');
      const applyBtn = div.querySelector('#btn-apply-insert');

      posSelect.onchange = () => {
        const val = posSelect.value;
        pageWrapper.style.display = (val === 'after_page' || val === 'before_page') ? 'block' : 'none';
      };

      const setFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          chosenFile = { name: file.name, base64: ev.target.result };
          dropLabel.textContent = `✅ ${file.name}`;
          dropSub.textContent = `File ready (${(file.size / 1024).toFixed(1)} KB)`;
          dropzone.style.background = '#f0fdf4';
          dropzone.style.borderColor = '#10b981';
          applyBtn.disabled = false;
        };
        reader.readAsDataURL(file);
      };

      dropzone.onclick = () => fileInput.click();
      fileInput.onchange = (e) => { if (e.target.files && e.target.files[0]) setFile(e.target.files[0]); };

      dropzone.ondragover = (e) => { 
        e.preventDefault(); 
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dropzone.style.borderColor = '#2563eb'; 
      };
      dropzone.ondragleave = () => { dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)'; };
      dropzone.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const overlay = document.getElementById('vs-global-drop-overlay');
        if (overlay) overlay.classList.remove('active');
        dropzone.style.borderColor = 'rgba(112, 126, 187, 0.4)';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
      };

      applyBtn.onclick = async () => {
        if (!chosenFile) return;
        const pos = posSelect.value;
        const targetPage = parseInt(div.querySelector('#insert-target-page').value) || 1;
        closeActiveStudioModal();
        await executeStudioTool('insert_pages', { source_bytes: chosenFile.base64, position: pos, target_page: targetPage });
      };
    };
  } else if (toolId === 'compress' || toolId === 'compress_pdf') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🗜️ Compress PDF</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 16px 0;">Choose compression intensity to reduce file size:</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <label class="vs-compress-opt-card">
          <input type="radio" name="comp-level" value="balanced" checked style="accent-color:#2563eb;">
          <div>
            <strong>Balanced (Recommended)</strong>
            <p style="margin:2px 0 0 0;font-size:11.5px;color:var(--muted);">Cleans stream duplicates, deflates objects. -30% to -60% reduction with zero visual degradation.</p>
          </div>
        </label>
        <label class="vs-compress-opt-card">
          <input type="radio" name="comp-level" value="low" style="accent-color:#2563eb;">
          <div>
            <strong>Low (Lossless)</strong>
            <p style="margin:2px 0 0 0;font-size:11.5px;color:var(--muted);">Safe metadata and stream cleanup without touching image rasters.</p>
          </div>
        </label>
        <label class="vs-compress-opt-card">
          <input type="radio" name="comp-level" value="high" style="accent-color:#2563eb;">
          <div>
            <strong>High (Aggressive)</strong>
            <p style="margin:2px 0 0 0;font-size:11.5px;color:var(--muted);">Aggressive stream optimization and image downsampling for maximum size reduction.</p>
          </div>
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-comp">Start Compression</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-comp').onclick = async () => {
        const selected = div.querySelector('input[name="comp-level"]:checked')?.value || 'balanced';
        closeActiveStudioModal();
        await executeStudioTool('compress_pdf', { level: selected });
      };
    };
  } else if (toolId === 'lock' || toolId === 'lock_pdf') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🔐 Lock PDF (AES-256)</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Set Password:</label>
          <input type="password" id="lock-pw-input" placeholder="Enter password to encrypt PDF..." style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Confirm Password:</label>
          <input type="password" id="lock-pw-confirm" placeholder="Confirm password..." style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-lock">Lock Document</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-lock').onclick = async () => {
        const p1 = div.querySelector('#lock-pw-input').value;
        const p2 = div.querySelector('#lock-pw-confirm').value;
        if (!p1) {
          if (typeof showNativeAlert === 'function') showNativeAlert('Password cannot be empty.', { type: 'warning' });
          else alert('Password cannot be empty.');
          return;
        }
        if (p1 !== p2) {
          if (typeof showNativeAlert === 'function') showNativeAlert('Passwords do not match.', { type: 'warning' });
          else alert('Passwords do not match.');
          return;
        }
        closeActiveStudioModal();
        await executeStudioTool('lock_pdf', { user_password: p1 });
      };
    };
  } else if (toolId === 'unlock' || toolId === 'unlock_pdf') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🔓 Unlock PDF</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Enter Document Password:</label>
          <input type="password" id="unlock-pw-input" placeholder="Enter password..." style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-unlock">Unlock</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-unlock').onclick = async () => {
        const pw = div.querySelector('#unlock-pw-input').value;
        closeActiveStudioModal();
        await executeStudioTool('unlock_pdf', { password: pw });
      };
    };
  } else if (toolId === 'rotate' || toolId === 'rotate_pages') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🔄 Rotate Pages</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Rotation Direction:</label>
          <select id="rot-angle" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
            <option value="90">90° Clockwise</option>
            <option value="-90">90° Counter-Clockwise</option>
            <option value="180">180° Invert</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Target Pages:</label>
          <select id="rot-target" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
            <option value="all">All Pages (${currentPdfSession.page_count})</option>
            <option value="current">Current Page (${currentPreviewPage})</option>
          </select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-rot">Rotate</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-rot').onclick = async () => {
        const angle = parseInt(div.querySelector('#rot-angle').value);
        const target = div.querySelector('#rot-target').value;
        const pages = target === 'all' ? 'all' : [currentPreviewPage];
        closeActiveStudioModal();
        await executeStudioTool('rotate_pages', { angle, pages });
      };
    };
  } else if (toolId === 'split' || toolId === 'split_pdf') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">✂️ Split / Extract Pages</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Page Ranges to Keep:</label>
          <input type="text" id="split-range-input" placeholder="e.g. 1-3, 5, 8-10" value="1-${currentPdfSession.page_count}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
          <span style="font-size:11px;color:var(--muted);margin-top:4px;display:block;">Only the specified pages will remain in the new working document.</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-split">Extract Pages</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-split').onclick = async () => {
        const range = div.querySelector('#split-range-input').value.trim();
        if (!range) {
          if (typeof showNativeAlert === 'function') showNativeAlert('Please enter page ranges.', { type: 'warning' });
          else alert('Please enter page ranges.');
          return;
        }
        closeActiveStudioModal();
        await executeStudioTool('split_pdf', { mode: 'extract_range', page_range: range });
      };
    };
  } else if (toolId === 'rearrange' || toolId === 'rearrange_pages') {
    const defaultSeq = Array.from({ length: currentPdfSession.page_count }, (_, i) => i + 1).join(', ');
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🔀 Rearrange Pages</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 14px 0;">
        Specify the exact new order of pages as comma-separated page numbers.
      </p>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">New Page Sequence (Total ${currentPdfSession.page_count} pages):</label>
          <input type="text" id="rearrange-input" value="${defaultSeq}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-family:ui-monospace,monospace;">
          <span style="font-size:11px;color:var(--muted);margin-top:4px;display:block;">Must include all ${currentPdfSession.page_count} page numbers without duplicates.</span>
        </div>

        <div style="display:flex;gap:8px;">
          <button type="button" class="badge" style="cursor:pointer;background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;" id="btn-rearrange-reverse">Reverse Order</button>
          <button type="button" class="badge" style="cursor:pointer;background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;" id="btn-rearrange-reset">Reset Order</button>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-rearrange">Apply New Order</button>
      </div>
    `;
    postRender = () => {
      const inputEl = div.querySelector('#rearrange-input');
      div.querySelector('#btn-rearrange-reverse').onclick = () => {
        const nums = inputEl.value.split(',').map(s => s.trim()).filter(Boolean);
        inputEl.value = nums.reverse().join(', ');
      };
      div.querySelector('#btn-rearrange-reset').onclick = () => {
        inputEl.value = defaultSeq;
      };
      div.querySelector('#btn-apply-rearrange').onclick = async () => {
        const raw = inputEl.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        if (raw.length !== currentPdfSession.page_count) {
          const err = `Sequence must contain all ${currentPdfSession.page_count} page numbers (currently has ${raw.length}).`;
          if (typeof showNativeAlert === 'function') showNativeAlert(err, { type: 'warning' });
          else alert(err);
          return;
        }
        closeActiveStudioModal();
        await executeStudioTool('rearrange_pages', { new_order: raw });
      };
    };
  } else if (toolId === 'delete' || toolId === 'delete_pages') {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">🗑️ Delete Pages</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 14px 0;">
        Remove specific pages from the current working document (${currentPdfSession.page_count} pages).
      </p>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Pages to Delete:</label>
          <select id="del-choice" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;margin-bottom:8px;">
            <option value="current">Delete Current Page (Page ${currentPreviewPage})</option>
            <option value="range">Specify Page Numbers or Range...</option>
          </select>
        </div>

        <div id="del-range-wrapper" style="display:none;">
          <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Page Numbers / Range (e.g. 2, 4-6):</label>
          <input type="text" id="del-range-input" placeholder="e.g. 2, 4-6" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm" style="background:#ef4444;color:#fff;border:0;font-weight:700;" id="btn-apply-del">Delete Pages</button>
      </div>
    `;
    postRender = () => {
      const choiceSel = div.querySelector('#del-choice');
      const rangeWrap = div.querySelector('#del-range-wrapper');
      choiceSel.onchange = () => {
        rangeWrap.style.display = (choiceSel.value === 'range') ? 'block' : 'none';
      };
      div.querySelector('#btn-apply-del').onclick = async () => {
        let pagesToDelete = [];
        let pageRange = '';
        if (choiceSel.value === 'current') {
          pagesToDelete = [currentPreviewPage];
        } else {
          pageRange = div.querySelector('#del-range-input').value.trim();
          if (!pageRange) {
            if (typeof showNativeAlert === 'function') showNativeAlert('Please specify pages or range to delete.', { type: 'warning' });
            else alert('Please specify pages to delete.');
            return;
          }
        }
        closeActiveStudioModal();
        const payload = pagesToDelete.length ? { pages: pagesToDelete } : { page_range: pageRange };
        await executeStudioTool('delete_pages', payload);
      };
    };
  } else {
    bodyHtml = `
      <div class="vs-modal-header">
        <h3 style="margin:0;color:#0A1F44;font-size:16px;">PDF Tool: ${toolId}</h3>
        <button type="button" class="btn-close-modal" onclick="closeActiveStudioModal()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin:16px 0;">Configure parameters for ${toolId}:</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-sm" onclick="closeActiveStudioModal()">Cancel</button>
        <button type="button" class="btn btn-sm primary" id="btn-apply-generic">Execute</button>
      </div>
    `;
    postRender = () => {
      div.querySelector('#btn-apply-generic').onclick = async () => {
        closeActiveStudioModal();
        await executeStudioTool(toolId, {});
      };
    };
  }

  div.innerHTML = `<div class="vs-studio-modal-card glass-card">${bodyHtml}</div>`;
  modalRoot.appendChild(div);
  postRender();
}

function closeActiveStudioModal() {
  const m = document.getElementById('studio-tool-modal');
  if (m) m.remove();
}
