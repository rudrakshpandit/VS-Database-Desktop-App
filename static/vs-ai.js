/**
 * VS AI — Frontend Module (CA & Tax Practice Copilot)
 * Powered by Google Gemini 2.0 Flash + Statutory RAG + PDF Studio Engine
 */
(function () {
  'use strict';

  let currentConvId = null;
  let activeScope = 'All Knowledge';
  let sourceOnly = false;
  let currentAttachments = [];
  let geminiHealth = { online: false, active_model: 'gemini-2.0-flash' };
  let sidebarCollapsed = false;

  function initVSAI() {
    const content = document.querySelector('#content');
    if (!content) return;

    content.innerHTML = `
      <div class="vs-ai-container">
        <!-- Header Bar -->
        <header class="vs-ai-header">
          <div class="vs-ai-brand">
            <img src="VS%20AI%20Logo.png" alt="VS AI" class="vs-ai-logo-img" onerror="this.src='vs_ai_logo.png'">
            <div class="vs-ai-title-wrap">
              <h1 class="vs-ai-title">
                <span>VS AI</span>
                <span class="vs-ai-version-pill">Gemini 2.0 Flash</span>
              </h1>
              <p class="vs-ai-subtitle">Statutory Legal & Tax Copilot for Chartered Accountants</p>
            </div>
          </div>

          <div class="vs-ai-header-actions">
            <button class="vs-ai-action-pill" id="vs-ai-btn-auto-rename" title="Intelligently rename tax & legal documents">
              <span>⚡</span>
              <span>Auto AI Rename</span>
            </button>

            <button class="vs-ai-action-pill" id="vs-ai-btn-sources-lib" title="View indexed Statutory Acts & Case Laws">
              <span>📚</span>
              <span>Sources Library</span>
            </button>

            <div class="vs-ai-status-pill warning" id="vs-ai-status-badge" title="Click to configure Gemini API Key" style="cursor:pointer;">
              <span class="vs-ai-status-dot"></span>
              <span id="vs-ai-status-text">Checking Gemini...</span>
            </div>
          </div>
        </header>

        <!-- Full-Screen 2-Column Body -->
        <div class="vs-ai-body">
          <!-- Left Sidebar: Chat History -->
          <div class="vs-ai-glass-card vs-ai-sidebar" id="vs-ai-sidebar">
            <div class="vs-ai-sidebar-top">
              <button class="vs-ai-new-chat-btn" id="vs-ai-btn-new-chat">
                <span style="font-size:16px;">＋</span>
                <span>New Chat</span>
              </button>
              <button class="vs-ai-toggle-sidebar-btn" id="vs-ai-btn-toggle-sidebar" title="Toggle Sidebar">
                <span>◀</span>
              </button>
            </div>

            <div class="vs-ai-search-box">
              <span class="vs-ai-search-icon">🔍</span>
              <input type="text" class="vs-ai-search-input" id="vs-ai-search-history" placeholder="Search chats...">
            </div>

            <div class="vs-ai-history-list" id="vs-ai-history-container">
              <div style="padding:15px;text-align:center;color:#94a3b8;font-size:12px;">Loading history...</div>
            </div>
          </div>

          <!-- Main Expansive Workspace (Full Remaining Screen) -->
          <div class="vs-ai-glass-card vs-ai-workspace">
            <!-- Top Controls -->
            <div class="vs-ai-workspace-topbar">
              <div class="vs-ai-scope-wrapper">
                <select class="vs-ai-scope-select" id="vs-ai-scope-select" title="Select Statutory Domain">
                  <option value="All Knowledge">📚 Scope: All Statutory Knowledge ▾</option>
                  <option value="Income Tax">Income Tax Act & Rules</option>
                  <option value="GST">CGST & State GST Acts / Rules</option>
                  <option value="Judgments">AAAR & Judicial Rulings</option>
                </select>

                <label class="vs-ai-grounding-checkbox">
                  <input type="checkbox" id="vs-ai-grounding-cb">
                  <span>Strict Statutory Grounding Only</span>
                </label>
              </div>
            </div>

            <!-- Conversation Stream Container -->
            <div class="vs-ai-chat-content" id="vs-ai-chat-stream">
              <!-- Rendered dynamically -->
            </div>

            <!-- Bottom Floating Composer -->
            <div class="vs-ai-composer-wrapper">
              <div class="vs-ai-attachment-preview-bar" id="vs-ai-att-preview-bar" style="display:none;"></div>

              <div class="vs-ai-composer-box">
                <textarea class="vs-ai-textarea" id="vs-ai-prompt-input" placeholder="Ask any Indian tax or statutory law question... (e.g. 'What are the conditions for ITC under Section 16 of CGST Act?')"></textarea>
                <div class="vs-ai-composer-toolbar">
                  <div class="vs-ai-composer-left-tools">
                    <input type="file" id="vs-ai-file-picker" style="display:none;" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx,.txt">
                    <button class="vs-ai-tool-btn" id="vs-ai-btn-attach-file" title="Attach Document or Image">
                      <span>📎 Attach</span>
                    </button>
                    <button class="vs-ai-tool-btn" id="vs-ai-btn-browse-client-docs" title="Select from Client Storage">
                      <span>📁 Client Files</span>
                    </button>
                  </div>

                  <button class="vs-ai-send-btn" id="vs-ai-btn-send">
                    <span>Send Query</span>
                    <span>➔</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    checkGeminiStatus();
    loadConversations();
  }

  // ------------------------------------------------------------
  // EVENT BINDINGS
  // ------------------------------------------------------------
  function bindEvents() {
    const newChatBtn = document.querySelector('#vs-ai-btn-new-chat');
    if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

    const toggleSidebarBtn = document.querySelector('#vs-ai-btn-toggle-sidebar');
    if (toggleSidebarBtn) {
      toggleSidebarBtn.addEventListener('click', () => {
        const sidebar = document.querySelector('#vs-ai-sidebar');
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('collapsed', sidebarCollapsed);
        toggleSidebarBtn.innerHTML = sidebarCollapsed ? '▶' : '◀';
      });
    }

    const scopeSelect = document.querySelector('#vs-ai-scope-select');
    if (scopeSelect) {
      scopeSelect.addEventListener('change', (e) => {
        activeScope = e.target.value;
      });
    }

    const groundingCb = document.querySelector('#vs-ai-grounding-cb');
    if (groundingCb) {
      groundingCb.addEventListener('change', (e) => {
        sourceOnly = e.target.checked;
      });
    }

    const sendBtn = document.querySelector('#vs-ai-btn-send');
    if (sendBtn) sendBtn.addEventListener('click', handleSendQuery);

    const promptInput = document.querySelector('#vs-ai-prompt-input');
    if (promptInput) {
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
          e.preventDefault();
          handleSendQuery();
        }
      });
      // Auto-expand textarea height
      promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
      });
    }

    const statusBadge = document.querySelector('#vs-ai-status-badge');
    if (statusBadge) statusBadge.addEventListener('click', showSettingsModal);

    const autoRenameBtn = document.querySelector('#vs-ai-btn-auto-rename');
    if (autoRenameBtn) autoRenameBtn.addEventListener('click', showAutoRenameModal);

    const sourcesLibBtn = document.querySelector('#vs-ai-btn-sources-lib');
    if (sourcesLibBtn) sourcesLibBtn.addEventListener('click', showSourcesLibraryModal);

    const attachBtn = document.querySelector('#vs-ai-btn-attach-file');
    const filePicker = document.querySelector('#vs-ai-file-picker');
    if (attachBtn && filePicker) {
      attachBtn.addEventListener('click', () => filePicker.click());
      filePicker.addEventListener('change', handleFileSelected);
    }
  }

  // ------------------------------------------------------------
  // GEMINI STATUS & HEALTH
  // ------------------------------------------------------------
  async function checkGeminiStatus() {
    const badge = document.querySelector('#vs-ai-status-badge');
    const text = document.querySelector('#vs-ai-status-text');
    if (!badge || !text) return;

    try {
      const resp = await fetch('/api/ai/health');
      const data = await resp.json();
      geminiHealth = data;

      if (data.has_api_key || data.has_oauth) {
        badge.className = 'vs-ai-status-pill';
        text.textContent = '🟢 Gemini Active (' + (data.chunks_indexed || 0) + ' Sections)';
        badge.title = 'Gemini 2.0 Flash Connected. Grounded on ' + (data.sources_indexed || 0) + ' statutory acts.';
      } else {
        badge.className = 'vs-ai-status-pill warning';
        text.textContent = '⚠️ Configure Gemini API Key';
        badge.title = 'Click to configure your free Gemini API key in Settings.';
      }
    } catch (err) {
      badge.className = 'vs-ai-status-pill warning';
      text.textContent = 'Gemini Offline';
    }
  }

  // ------------------------------------------------------------
  // CHAT STREAM & WELCOME HERO
  // ------------------------------------------------------------
  function renderWelcomeHero() {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    stream.innerHTML = `
      <div class="vs-ai-hero-wrap">
        <img src="VS%20AI%20Logo.png" alt="VS AI" class="vs-ai-hero-logo" onerror="this.src='vs_ai_logo.png'">
        <h2 class="vs-ai-hero-title">Welcome to VS AI Legal & Tax Copilot</h2>
        <p class="vs-ai-hero-desc">
          Powered by Google Gemini Flash with live statutory RAG over the <strong>Income-tax Act 1961</strong>,
          <strong>CGST Act & Rules</strong>, and <strong>AAAR Judicial Precedents</strong>.
        </p>

        <div class="vs-ai-quick-prompts-grid">
          <div class="vs-ai-prompt-card" data-q="What are the essential conditions for claiming Input Tax Credit under Section 16 of the CGST Act?">
            <div class="vs-ai-prompt-card-icon">📜</div>
            <div class="vs-ai-prompt-card-text">Section 16 ITC Conditions (CGST Act)</div>
          </div>

          <div class="vs-ai-prompt-card" data-q="Explain the deductions and maximum limits available under Section 80C, 80D, and 80CCD.">
            <div class="vs-ai-prompt-card-icon">💰</div>
            <div class="vs-ai-prompt-card-text">Section 80C & 80D Deduction Limits</div>
          </div>

          <div class="vs-ai-prompt-card" data-q="Explain Section 43B(h) applicability, payment time limits, and disallowances for payments to MSME suppliers.">
            <div class="vs-ai-prompt-card-icon">🏭</div>
            <div class="vs-ai-prompt-card-text">Section 43B(h) MSME Payment Rules</div>
          </div>

          <div class="vs-ai-prompt-card" data-q="Draft a formal reply to GST Notice DRC-01 regarding alleged ITC mismatch between GSTR-3B and GSTR-2B.">
            <div class="vs-ai-prompt-card-icon">📝</div>
            <div class="vs-ai-prompt-card-text">Draft Reply to GST Notice DRC-01</div>
          </div>
        </div>
      </div>
    `;

    stream.querySelectorAll('.vs-ai-prompt-card').forEach(card => {
      card.addEventListener('click', () => {
        const q = card.getAttribute('data-q');
        const input = document.querySelector('#vs-ai-prompt-input');
        if (input) {
          input.value = q;
          handleSendQuery();
        }
      });
    });
  }

  // ------------------------------------------------------------
  // SEND QUERY & RECEIVE ANSWER
  // ------------------------------------------------------------
  async function handleSendQuery() {
    const input = document.querySelector('#vs-ai-prompt-input');
    const sendBtn = document.querySelector('#vs-ai-btn-send');
    if (!input || !sendBtn) return;

    const promptText = input.value.trim();
    if (!promptText) return;

    // Append User Message to UI
    appendMessage('user', promptText);
    input.value = '';
    input.style.height = 'auto';

    // Show Loading Skeleton Bubble
    const stream = document.querySelector('#vs-ai-chat-stream');
    const loadingId = 'loading-' + Date.now();
    const loadingEl = document.createElement('div');
    loadingEl.className = 'vs-ai-message-row assistant';
    loadingEl.id = loadingId;
    loadingEl.innerHTML = `
      <div class="vs-ai-bubble-assistant">
        <div style="display:flex;align-items:center;gap:10px;color:#2563eb;font-weight:600;font-size:13px;">
          <span style="animation:spin 1s linear infinite;display:inline-block;">⚡</span>
          <span>Analyzing statutes & grounding response via Gemini...</span>
        </div>
      </div>
    `;
    stream.appendChild(loadingEl);
    stream.scrollTop = stream.scrollHeight;

    sendBtn.disabled = true;

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: currentConvId,
          prompt: promptText,
          scope: activeScope,
          source_only: sourceOnly,
          attachments: currentAttachments
        })
      });

      const data = await resp.json();
      loadingEl.remove();

      if (!data.ok) {
        appendMessage('assistant', `⚠️ **Error:** ${data.error || 'Failed to generate response.'}`);
        if (data.error && data.error.includes('API key')) {
          showSettingsModal();
        }
      } else {
        currentConvId = data.conversation_id;
        appendMessage('assistant', data.answer, data.citations, promptText);
        loadConversations();
      }
    } catch (err) {
      loadingEl.remove();
      appendMessage('assistant', `⚠️ **Network Error:** Could not contact backend server.`);
    } finally {
      sendBtn.disabled = false;
      currentAttachments = [];
      renderAttachmentPreviewBar();
    }
  }

  function appendMessage(role, content, citations, promptTitle) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    const hero = stream.querySelector('.vs-ai-hero-wrap');
    if (hero) hero.remove();

    const row = document.createElement('div');
    row.className = `vs-ai-message-row ${role}`;

    if (role === 'user') {
      row.innerHTML = `<div class="vs-ai-bubble-user">${escapeHtml(content)}</div>`;
    } else {
      let citationsHtml = '';
      if (citations && citations.length > 0) {
        citationsHtml = `
          <div class="vs-ai-citations-box">
            <div class="vs-ai-citations-header">📜 Grounding Statutory Citations & Sections:</div>
            <div class="vs-ai-citation-badges">
              ${citations.map(c => `
                <div class="vs-ai-citation-badge" title="${escapeHtml(c.source)}">
                  <span>${escapeHtml(c.section || 'Section')}</span>
                  <span style="opacity:0.75;font-size:10px;">(p. ${c.page || 1})</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      const parsedMarkdown = renderMarkdown(content);

      row.innerHTML = `
        <div class="vs-ai-bubble-assistant">
          <div class="vs-ai-asst-body">${parsedMarkdown}</div>
          ${citationsHtml}
          <div class="vs-ai-msg-actions">
            <button class="vs-ai-msg-btn primary btn-export-pdf" title="Generate styled official PDF via PDF Studio Engine">
              <span>📄</span>
              <span>Export Branded PDF</span>
            </button>
            <button class="vs-ai-msg-btn btn-copy-text" title="Copy reply to clipboard">
              <span>📋</span>
              <span>Copy</span>
            </button>
          </div>
        </div>
      `;

      // Bind Export PDF Button
      const exportPdfBtn = row.querySelector('.btn-export-pdf');
      if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
          handleExportPdf(promptTitle || 'Statutory Legal Opinion', content, citations);
        });
      }

      // Bind Copy Button
      const copyBtn = row.querySelector('.btn-copy-text');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(content);
          copyBtn.innerHTML = '<span>✓</span><span>Copied!</span>';
          setTimeout(() => { copyBtn.innerHTML = '<span>📋</span><span>Copy</span>'; }, 2000);
        });
      }
    }

    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
  }

  // ------------------------------------------------------------
  // EXPORT BRANDED PDF (ReportLab PDF Studio Engine)
  // ------------------------------------------------------------
  async function handleExportPdf(title, content, citations) {
    try {
      const resp = await fetch('/api/ai/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          content: content,
          citations: citations || []
        })
      });
      const data = await resp.json();
      if (data.ok && data.filename) {
        window.open(`/data/ai_exports/${encodeURIComponent(data.filename)}`, '_blank');
      } else {
        alert('Could not generate PDF: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('PDF generation request failed: ' + e.message);
    }
  }

  // ------------------------------------------------------------
  // AUTO AI DOCUMENT RENAMER MODAL
  // ------------------------------------------------------------
  function showAutoRenameModal() {
    const existing = document.querySelector('#modal-auto-rename');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.id = 'modal-auto-rename';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title">⚡ Auto AI Document Renamer</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div class="vs-ai-modal-body">
          <p style="font-size:13px;color:#475569;margin-top:0;">
            Select any tax return, challan, notice, or scanned document. Our 2-tier engine inspects the document in <strong>10ms</strong> via digital regex or classifies it via <strong>Gemini Vision</strong>.
          </p>

          <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:24px;text-align:center;background:#f8fafc;cursor:pointer;" id="rename-dropzone">
            <span style="font-size:32px;">📄</span>
            <div style="font-size:13.5px;font-weight:600;color:#1e293b;margin-top:8px;">Click to select file or drag & drop here</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:4px;">Supported: PDF, PNG, JPG, JPEG</div>
            <input type="file" id="rename-file-input" style="display:none;" accept=".pdf,.png,.jpg,.jpeg">
          </div>

          <div id="rename-result-box" style="display:none;margin-top:16px;padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">
            <!-- Rendered dynamically -->
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.vs-ai-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const dropzone = overlay.querySelector('#rename-dropzone');
    const fileInput = overlay.querySelector('#rename-file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const resultBox = overlay.querySelector('#rename-result-box');
      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="color:#2563eb;font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;">
          <span style="animation:spin 1s linear infinite;">⚡</span>
          <span>Analyzing document structure & extracting standard name...</span>
        </div>
      `;

      // Read file data
      const reader = new FileReader();
      reader.onload = async () => {
        // Upload temporary scratch file or trigger rename
        try {
          const resp = await fetch('/api/ai/doc/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: file.name }) // backend handles local files
          });
          const res = await resp.json();
          if (res.ok) {
            resultBox.innerHTML = `
              <div style="font-size:12px;font-weight:700;color:#1e40af;margin-bottom:6px;">✓ Document Identified!</div>
              <div style="font-size:12.5px;color:#334155;margin-bottom:4px;">Original: <code>${escapeHtml(file.name)}</code></div>
              <div style="font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:8px;">Suggested Name: <span style="color:#2563eb;">${escapeHtml(res.suggested_filename)}</span></div>
              <div style="font-size:11px;color:#64748b;margin-bottom:10px;">Method: <strong>${escapeHtml(res.method || 'Engine')}</strong> | Type: ${escapeHtml(res.doc_type || '-')}</div>
              <button class="vs-ai-btn-primary" id="btn-copy-renamed">Copy Standard Name</button>
            `;
            resultBox.querySelector('#btn-copy-renamed').addEventListener('click', () => {
              navigator.clipboard.writeText(res.suggested_filename);
              alert('Copied to clipboard: ' + res.suggested_filename);
            });
          } else {
            resultBox.innerHTML = `<div style="color:#ef4444;font-size:13px;">⚠️ ${escapeHtml(res.error || 'Could not rename document')}</div>`;
          }
        } catch (err) {
          resultBox.innerHTML = `<div style="color:#ef4444;font-size:13px;">Error: ${escapeHtml(err.message)}</div>`;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------
  // GEMINI SETTINGS MODAL
  // ------------------------------------------------------------
  function showSettingsModal() {
    const existing = document.querySelector('#modal-gemini-settings');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.id = 'modal-gemini-settings';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title">⚙️ Google Gemini API Configuration</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div class="vs-ai-modal-body">
          <p style="font-size:13px;color:#475569;margin-top:0;">
            Enter your Google Gemini API key to enable high-speed statutory reasoning, large context (1M+ tokens), and native document vision.
          </p>

          <div style="padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:12.5px;font-weight:700;color:#166534;">Get a 100% Free Gemini API Key</div>
              <div style="font-size:11.5px;color:#15803d;">Free tier includes 15 queries/minute with 1M tokens/min.</div>
            </div>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="padding:7px 12px;background:#16a34a;color:#ffffff;border-radius:8px;font-size:11.5px;font-weight:600;text-decoration:none;white-space:nowrap;">
              🔑 Get Free Key ➔
            </a>
          </div>

          <div class="vs-ai-form-group">
            <label class="vs-ai-label">Gemini API Key</label>
            <input type="password" class="vs-ai-input" id="cfg-gemini-key" placeholder="AIzaSy..." value="">
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Key is encrypted and stored locally in your private office database.</div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
            <button class="vs-ai-tool-btn" id="btn-cancel-settings">Cancel</button>
            <button class="vs-ai-btn-primary" id="btn-save-gemini-key">Save & Connect</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.vs-ai-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-cancel-settings').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#btn-save-gemini-key').addEventListener('click', async () => {
      const keyVal = overlay.querySelector('#cfg-gemini-key').value.trim();
      if (!keyVal) {
        alert('Please enter a valid Gemini API Key.');
        return;
      }
      try {
        const resp = await fetch('/api/ai/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gemini_api_key: keyVal })
        });
        const res = await resp.json();
        if (res.ok) {
          overlay.remove();
          checkGeminiStatus();
        } else {
          alert('Error saving settings: ' + (res.error || 'Failed'));
        }
      } catch (err) {
        alert('Request failed: ' + err.message);
      }
    });
  }

  // ------------------------------------------------------------
  // SOURCES LIBRARY MODAL
  // ------------------------------------------------------------
  async function showSourcesLibraryModal() {
    const existing = document.querySelector('#modal-sources-lib');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.id = 'modal-sources-lib';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card" style="max-width:760px;">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title">📚 Statutory Sources & RAG Library</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div class="vs-ai-modal-body" id="sources-lib-content">
          <div style="padding:20px;text-align:center;color:#64748b;">Loading indexed acts & case laws...</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.vs-ai-modal-close').addEventListener('click', () => overlay.remove());

    try {
      const resp = await fetch('/api/ai/sources');
      const data = await resp.json();
      const contentBox = overlay.querySelector('#sources-lib-content');

      if (data.sources && data.sources.length > 0) {
        contentBox.innerHTML = `
          <div style="margin-bottom:12px;font-size:12.5px;color:#475569;">
            The following authentic Acts, Rules, and Case Laws in <code>Sources/</code> are indexed into high-precision section chunks:
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${data.sources.map(s => `
              <div style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:13.5px;font-weight:700;color:#0f172a;">${escapeHtml(s.name)}</div>
                  <div style="font-size:11.5px;color:#64748b;">Authority: ${escapeHtml(s.authority || 'Statutory')} | Domain: <strong>${escapeHtml(s.relevant_law || 'General')}</strong></div>
                </div>
                <div style="padding:4px 10px;background:#eff6ff;color:#1d4ed8;border-radius:6px;font-size:11.5px;font-weight:700;border:1px solid #bfdbfe;">
                  ${s.chunk_count || 0} Sections
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        contentBox.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b;">No statutory sources indexed yet.</div>`;
      }
    } catch (e) {
      overlay.querySelector('#sources-lib-content').innerHTML = `<div style="color:#ef4444;">Failed to load sources: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ------------------------------------------------------------
  // CHAT HISTORY MANAGEMENT
  // ------------------------------------------------------------
  async function loadConversations() {
    const list = document.querySelector('#vs-ai-history-container');
    if (!list) return;

    try {
      const resp = await fetch('/api/ai/conversations');
      const data = await resp.json();

      if (!data.conversations || data.conversations.length === 0) {
        list.innerHTML = `<div style="padding:15px;text-align:center;color:#94a3b8;font-size:12px;">No chats yet</div>`;
        if (!currentConvId) renderWelcomeHero();
        return;
      }

      list.innerHTML = data.conversations.map(c => `
        <div class="vs-ai-history-item ${c.id === currentConvId ? 'active' : ''}" data-id="${c.id}" title="${escapeHtml(c.title)}">
          <span style="overflow:hidden;text-overflow:ellipsis;">💬 ${escapeHtml(c.title || 'Chat')}</span>
        </div>
      `).join('');

      list.querySelectorAll('.vs-ai-history-item').forEach(item => {
        item.addEventListener('click', () => {
          loadConversation(item.getAttribute('data-id'));
        });
      });

      if (!currentConvId) {
        renderWelcomeHero();
      }
    } catch (e) {
      list.innerHTML = `<div style="padding:15px;color:#ef4444;font-size:11px;">Error loading history</div>`;
    }
  }

  async function loadConversation(convId) {
    currentConvId = convId;
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;
    stream.innerHTML = `<div style="padding:30px;text-align:center;color:#64748b;">Loading conversation...</div>`;

    document.querySelectorAll('.vs-ai-history-item').forEach(it => {
      it.classList.toggle('active', it.getAttribute('data-id') === convId);
    });

    try {
      const resp = await fetch(`/api/ai/conversations/${convId}`);
      const data = await resp.json();
      stream.innerHTML = '';

      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => {
          appendMessage(m.role, m.content, m.meta ? m.meta.citations : null);
        });
      } else {
        renderWelcomeHero();
      }
    } catch (e) {
      stream.innerHTML = `<div style="padding:20px;color:#ef4444;">Failed to load messages</div>`;
    }
  }

  function startNewChat() {
    currentConvId = null;
    document.querySelectorAll('.vs-ai-history-item').forEach(it => it.classList.remove('active'));
    renderWelcomeHero();
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  // ------------------------------------------------------------
  // ATTACHMENT HANDLING
  // ------------------------------------------------------------
  function handleFileSelected(e) {
    const files = Array.from(e.target.files);
    files.forEach(f => {
      currentAttachments.push({
        name: f.name,
        size: f.size,
        mime_type: f.type || 'application/octet-stream'
      });
    });
    renderAttachmentPreviewBar();
  }

  function renderAttachmentPreviewBar() {
    const bar = document.querySelector('#vs-ai-att-preview-bar');
    if (!bar) return;

    if (currentAttachments.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = currentAttachments.map((att, idx) => `
      <div class="vs-ai-att-pill">
        <span>📎 ${escapeHtml(att.name)}</span>
        <span class="vs-ai-att-remove" data-idx="${idx}">&times;</span>
      </div>
    `).join('');

    bar.querySelectorAll('.vs-ai-att-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'));
        currentAttachments.splice(idx, 1);
        renderAttachmentPreviewBar();
      });
    });
  }

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(md) {
    if (!md) return '';
    let html = escapeHtml(md);

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Bullet lists
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');

    // Code blocks & inline code
    html = html.replace(/```([\s\S]*?)```/gim, '<pre style="background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;overflow-x:auto;"><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9;padding:2px 5px;border-radius:4px;color:#2563eb;">$1</code>');

    // Line breaks
    html = html.replace(/\n/gim, '<br/>');
    return html;
  }

  // Register page renderer on window
  window.render_page_vs_ai = initVSAI;
  window.renderVsAi = initVSAI;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (typeof window !== 'undefined' && window.location && (window.location.hash === '#vs-ai' || window.location.hash === '#ai')) {
          initVSAI();
        }
      });
    } else {
      if (typeof window !== 'undefined' && window.location && (window.location.hash === '#vs-ai' || window.location.hash === '#ai')) {
        initVSAI();
      }
    }
  }
})();
