/**
 * VS AI — Frontend Module (CA & Tax Practice Copilot)
 * Professional Legal-Tech Glassmorphic UI/UX Suite
 * Powered by VS AI Engine + Statutory RAG + PDF Studio Engine
 */
(function () {
  'use strict';

  let currentConvId = null;
  let activeScope = 'All Knowledge';
  let sourceOnly = false;
  let currentAttachments = [];
  let vsAiHealth = { online: false, active_model: 'VS AI Fast Core' };
  let sidebarCollapsed = false;
  let lastSentPrompt = '';
  let lastSentAttachments = [];
  let isRequestInFlight = false;
  let currentAbortController = null;
  let currentStreamReader = null;
  let autoRetryTimer = null;
  let autoRetrySecondsLeft = 0;
  let retryAttempts = 0;
  const MAX_AUTO_RETRIES = 3;
  let allConversationsCache = [];
  let activeGenerationMode = null;

  const GENERATION_MODE_CONFIG = {
    pdf: {
      title: 'PDF Document',
      icon: '📑',
      class: 'vs-mode-pdf',
      badge: '📑 Direct PDF Mode',
      desc: 'AI will generate a direct statutory PDF file',
      placeholder: 'Describe the PDF document to generate (e.g., Notice reply under Section 148, Legal Advisory Brief)...'
    },
    excel: {
      title: 'Excel Spreadsheet',
      icon: '📊',
      class: 'vs-mode-excel',
      badge: '📊 Direct Excel Mode',
      desc: 'AI will generate a multi-sheet .xlsx workbook with formulas & tables',
      placeholder: 'Describe the Excel spreadsheet to generate (e.g., Footwear company 35 GST transactions, ITC ledger)...'
    },
    gsheet: {
      title: 'Google Sheet',
      icon: '📈',
      class: 'vs-mode-gsheet',
      badge: '📈 Direct Google Sheet Mode',
      desc: 'AI will generate a structured cloud-ready financial dataset',
      placeholder: 'Describe the Google Sheet dataset (e.g., Monthly TDS computation, Vendor reconciliation)...'
    },
    word: {
      title: 'Word Document',
      icon: '📄',
      class: 'vs-mode-word',
      badge: '📄 Direct Word Mode',
      desc: 'AI will generate an executive .docx document with formal legal clauses',
      placeholder: 'Describe the Word document to draft (e.g., Employment Agreement, Partnership Deed, Board Resolution)...'
    },
    docs: {
      title: 'Google Docs',
      icon: '📝',
      class: 'vs-mode-docs',
      badge: '📝 Direct Google Docs Mode',
      desc: 'AI will generate a structured legal draft ready for Google Docs',
      placeholder: 'Describe the Google Doc to draft (e.g., Statutory Appeal Petition, Legal Notice)...'
    }
  };

  function setGenerationMode(mode) {
    activeGenerationMode = mode;
    renderActiveModeBar();
    const promptInput = document.querySelector('#vs-ai-prompt-input');
    if (promptInput) {
      if (mode && GENERATION_MODE_CONFIG[mode]) {
        promptInput.placeholder = GENERATION_MODE_CONFIG[mode].placeholder;
      } else {
        promptInput.placeholder = "Ask any Indian tax or statutory law question… (e.g. 'What are the conditions for ITC under Section 16 of CGST Act?')";
      }
      promptInput.focus();
    }
  }

  function renderActiveModeBar() {
    const bar = document.querySelector('#vs-ai-active-mode-bar');
    if (!bar) return;
    if (!activeGenerationMode || !GENERATION_MODE_CONFIG[activeGenerationMode]) {
      bar.innerHTML = '';
      bar.style.display = 'none';
      return;
    }
    const conf = GENERATION_MODE_CONFIG[activeGenerationMode];
    bar.style.display = 'flex';
    bar.innerHTML = `
      <div class="vs-ai-active-mode-pill ${conf.class}">
        <span class="vs-ai-mode-pill-badge">${conf.badge}</span>
        <span class="vs-ai-mode-pill-msg">${conf.desc}</span>
        <button type="button" class="vs-ai-mode-pill-clear" title="Clear mode (regular chat)">✕</button>
      </div>
    `;
    const clearBtn = bar.querySelector('.vs-ai-mode-pill-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setGenerationMode(null);
      });
    }
  }

  // ------------------------------------------------------------
  // INITIALIZATION & DOM STRUCTURE
  // ------------------------------------------------------------
  function initVSAI() {
    const content = document.querySelector('#content');
    if (!content) return;

    // Set page body helper class for fluid layout
    document.body.classList.add('page-vs-ai-active');

    content.innerHTML = `
      <div class="ai vs-ai-container">
        <!-- Left History Panel -->
        <aside class="glass hist vs-ai-sidebar" id="vs-ai-sidebar" aria-label="Conversation History">
          <button class="btn p vs-ai-new-chat-btn" id="vs-ai-btn-new-chat" title="Start a new statutory consultation">
            <svg class="i" aria-hidden="true"><use href="#plus"/></svg>
            <span>New Chat</span>
          </button>
          
          <label class="field" style="min-height:40px;">
            <svg class="i" aria-hidden="true"><use href="#search"/></svg>
            <input type="text" id="vs-ai-search-history" placeholder="Search chats..." aria-label="Search conversation history">
          </label>

          <div class="vs-ai-history-list" id="vs-ai-history-container" role="list">
            <div style="padding:18px 12px;text-align:center;color:var(--tx2);font-size:12px;">
              Loading conversations...
            </div>
          </div>

          <button class="btn vs-ai-clean-chats-btn" id="vs-ai-btn-clean-chats" title="Preview and delete empty or single-message chats" style="font-size:12px;width:100%;margin-top:auto;">
            <svg class="i" aria-hidden="true"><use href="#trash"/></svg>
            <span>Clean short chats</span>
          </button>
          <button id="vs-ai-btn-toggle-sidebar" style="display:none;" aria-label="Toggle history panel"></button>
        </aside>

        <!-- Main Expansive Chat Workspace -->
        <main class="glass chat vs-ai-workspace" role="region" aria-label="Statutory Copilot Workspace">
          <!-- Top Controls Bar -->
          <div class="bar2 vs-ai-workspace-topbar">
            <select class="btn vs-ai-scope-select" id="vs-ai-scope-select" title="Select Statutory Domain Scope" aria-label="Statutory Scope">
              <option value="All Knowledge">Scope: All statutory knowledge</option>
              <option value="Income Tax">Income Tax Act 2025 & Rules</option>
              <option value="GST">CGST & State GST Acts / Rules</option>
              <option value="Judgments">AAAR & Judicial Rulings</option>
            </select>

            <!-- Grounding Toggle Switch -->
            <button type="button" class="sw" role="switch" aria-checked="false" id="vs-ai-grounding-toggle" title="Restrict reasoning strictly to indexed sources and attached files">
              <i></i>
              <span class="vs-ai-switch-label">Available sources only</span>
            </button>
            <span class="tip" data-t="Answers only from indexed statutes and attached files" tabindex="0">
              <svg class="i" aria-hidden="true"><use href="#info"/></svg>
            </span>

            <span class="sp" style="flex:1"></span>

            <!-- Indexed Sections Status Badge -->
            <span class="chip tip" id="vs-ai-status-badge" style="cursor:pointer;" data-t="Click to view indexed sections and models" role="button" tabindex="0">
              <svg class="i" aria-hidden="true"><use href="#ai"/></svg>
              <span id="vs-ai-status-text">2,506 sections indexed</span>
            </span>

            <!-- More Actions Dropdown -->
            <div class="vs-ai-more-menu-wrap" style="position:relative;">
              <button type="button" class="btn ib tip" id="vs-ai-btn-more-menu" data-t="More actions" aria-label="More actions">
                <svg class="i" aria-hidden="true"><use href="#setup"/></svg>
              </button>
              <div class="vs-ai-dropdown-menu" id="vs-ai-dropdown-more" style="display:none;">
                <button type="button" class="vs-ai-dropdown-item" id="vs-ai-btn-auto-rename">
                  <svg class="i" style="width:14px;height:14px;"><use href="#refresh"/></svg>
                  <span>Auto AI Rename</span>
                </button>
                <button type="button" class="vs-ai-dropdown-item" id="vs-ai-btn-sources-lib">
                  <svg class="i" style="width:14px;height:14px;"><use href="#folder"/></svg>
                  <span>Sources Library</span>
                </button>
                <button type="button" class="vs-ai-dropdown-item" id="vs-ai-btn-settings">
                  <svg class="i" style="width:14px;height:14px;"><use href="#setup"/></svg>
                  <span>Settings & API Key</span>
                </button>
              </div>
            </div>

            <!-- Preserved hidden probe hooks for background JS compatibility -->
            <div id="vs-ai-grounding-wrap" style="display:none;"></div>
            <input type="checkbox" id="vs-ai-grounding-cb" style="display:none;" aria-hidden="true">
            <span id="vs-ai-model-pill" style="display:none;"></span>
            <span id="vs-ai-server-status" style="display:none;"></span>
            <span id="vs-ai-drive-status" style="display:none;"></span>
            <span id="vs-ai-user-badge" style="display:none;"><span id="vs-ai-user-name"></span></span>
            <button id="vs-ai-logout-btn" style="display:none;"></button>
          </div>

          <!-- Conversation Stream -->
          <div class="log vs-ai-chat-content" id="vs-ai-chat-stream" role="log" aria-live="polite"></div>

          <!-- Floating Jump to Latest Button -->
          <button class="vs-ai-jump-bottom-btn" id="vs-ai-jump-bottom" title="Scroll down to the latest message" style="display:none;">
            <span>↓</span>
            <span>Jump to latest</span>
          </button>

          <!-- Quick Prompt Action Chips -->
          <div class="chips vs-ai-quick-chips-row" id="vs-ai-quick-chips">
            <button type="button" class="vs-ai-quick-chip-btn" data-prompt="Draft a formal reply to GST Notice DRC-01 regarding alleged ITC mismatch between GSTR-3B and GSTR-2B.">
              <span>Draft GST notice reply</span>
            </button>
            <button type="button" class="vs-ai-quick-chip-btn" data-prompt="Explain Section 43B(h) applicability, payment time limits, and disallowances for payments to MSME suppliers.">
              <span>Section 43B(h) explained</span>
            </button>
            <button type="button" class="vs-ai-quick-chip-btn" data-prompt="What are the statutory due dates for filing Income Tax Returns (ITR) for AY 2025-26 and AY 2026-27 under the Income-tax Act?">
              <span>ITR due dates</span>
            </button>
            <button type="button" class="vs-ai-quick-chip-btn" data-prompt="What are the essential conditions for claiming Input Tax Credit (ITC) under Section 16 of the CGST Act?">
              <span>ITC conditions under Sec 16</span>
            </button>
          </div>

          <!-- Bottom Floating Glass Composer -->
          <div class="comp vs-ai-composer-wrapper">
            <div class="vs-ai-active-mode-pill-bar" id="vs-ai-active-mode-bar" style="display:none;"></div>
            <div class="vs-ai-attachment-preview-bar" id="vs-ai-att-preview-bar" style="display:none;"></div>

            <textarea
              class="vs-ai-textarea"
              id="vs-ai-prompt-input"
              rows="1"
              placeholder="Ask any Indian tax or statutory law question… (e.g. 'What are the conditions for ITC under Section 16 of CGST Act?')"
              aria-label="Ask tax or statutory law question"
            ></textarea>

            <div class="row" style="margin-top:8px;">
              <input type="file" id="vs-ai-file-picker" style="display:none;" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx,.txt">
              
              <!-- DropUp File Generation Selector -->
              <div class="vs-ai-dropup-container" id="vs-ai-dropup-container">
                <button type="button" class="btn vs-ai-btn-dropup-trigger" id="vs-ai-btn-dropup" title="Generate Direct File: PDF, Excel, Word, Sheet, Docs">
                  <svg class="i" style="width:13px;height:13px;margin-right:2px;" aria-hidden="true"><use href="#plus"/></svg>
                  <span>Generate</span>
                  <svg class="i" style="width:10px;height:10px;margin-left:2px;opacity:0.7;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="vs-ai-dropup-menu" id="vs-ai-dropup-menu" style="display:none;">
                  <div class="vs-ai-dropup-header">
                    <span>Generate File</span>
                    <span class="vs-ai-dropup-hint">Select format</span>
                  </div>
                  <div class="vs-ai-dropup-list">
                    <button type="button" class="vs-ai-dropup-item" data-mode="pdf">
                      <span class="vs-ai-dropup-icon vs-dropup-pdf">📑</span>
                      <div class="vs-ai-dropup-item-text">
                        <span class="vs-ai-dropup-item-title">PDF Document</span>
                        <span class="vs-ai-dropup-item-desc">Statutory brief, notice reply, legal opinion (.pdf)</span>
                      </div>
                    </button>
                    <button type="button" class="vs-ai-dropup-item" data-mode="excel">
                      <span class="vs-ai-dropup-icon vs-dropup-excel">📊</span>
                      <div class="vs-ai-dropup-item-text">
                        <span class="vs-ai-dropup-item-title">Excel Spreadsheet</span>
                        <span class="vs-ai-dropup-item-desc">Formulas, tables & calculations (.xlsx)</span>
                      </div>
                    </button>
                    <button type="button" class="vs-ai-dropup-item" data-mode="gsheet">
                      <span class="vs-ai-dropup-icon vs-dropup-gsheet">📈</span>
                      <div class="vs-ai-dropup-item-text">
                        <span class="vs-ai-dropup-item-title">Google Sheet</span>
                        <span class="vs-ai-dropup-item-desc">Cloud spreadsheet & financial dataset</span>
                      </div>
                    </button>
                    <button type="button" class="vs-ai-dropup-item" data-mode="word">
                      <span class="vs-ai-dropup-icon vs-dropup-word">📄</span>
                      <div class="vs-ai-dropup-item-text">
                        <span class="vs-ai-dropup-item-title">Word Document</span>
                        <span class="vs-ai-dropup-item-desc">Contract, formal petition, agreement (.docx)</span>
                      </div>
                    </button>
                    <button type="button" class="vs-ai-dropup-item" data-mode="docs">
                      <span class="vs-ai-dropup-icon vs-dropup-docs">📝</span>
                      <div class="vs-ai-dropup-item-text">
                        <span class="vs-ai-dropup-item-title">Google Docs</span>
                        <span class="vs-ai-dropup-item-desc">Cloud-ready structured legal draft</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <button type="button" class="btn" id="vs-ai-btn-attach-file" title="Attach Document, Image, or Data Spreadsheet">
                <svg class="i" aria-hidden="true"><use href="#clip"/></svg>
                <span>Attach</span>
              </button>
              <button type="button" class="btn" id="vs-ai-btn-browse-client-docs" title="Reference client file vault">
                <svg class="i" aria-hidden="true"><use href="#folder"/></svg>
                <span>Client files</span>
              </button>
              <span class="sp" style="flex:1"></span>
              <small class="muted">Enter to send · Shift+Enter for new line</small>
              <button type="button" class="btn p" id="vs-ai-btn-send" title="Send statutory inquiry" disabled>
                <span>Send</span>
                <svg class="i" aria-hidden="true"><use href="#send"/></svg>
              </button>
              <button type="button" class="btn d" id="vs-ai-btn-stop" style="display:none;" title="Stop generating response">
                <span>Stop</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    `;

    bindEvents();
    checkVsAiStatus();
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
        if (!sidebar) return;
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('collapsed', sidebarCollapsed);
        toggleSidebarBtn.innerHTML = sidebarCollapsed ? '▶' : '◀';
      });
    }

    // More Menu Dropdown
    const moreMenuBtn = document.querySelector('#vs-ai-btn-more-menu');
    const dropdownMore = document.querySelector('#vs-ai-dropdown-more');
    if (moreMenuBtn && dropdownMore) {
      moreMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownMore.style.display === 'flex';
        dropdownMore.style.display = isOpen ? 'none' : 'flex';
      });

      document.addEventListener('click', (e) => {
        if (!dropdownMore.contains(e.target) && e.target !== moreMenuBtn) {
          dropdownMore.style.display = 'none';
        }
      });
    }

    const settingsItem = document.querySelector('#vs-ai-btn-settings');
    if (settingsItem) {
      settingsItem.addEventListener('click', () => {
        if (dropdownMore) dropdownMore.style.display = 'none';
        showSettingsModal();
      });
    }

    const autoRenameBtn = document.querySelector('#vs-ai-btn-auto-rename');
    if (autoRenameBtn) {
      autoRenameBtn.addEventListener('click', () => {
        if (dropdownMore) dropdownMore.style.display = 'none';
        showAutoRenameModal();
      });
    }

    const sourcesLibBtn = document.querySelector('#vs-ai-btn-sources-lib');
    if (sourcesLibBtn) {
      sourcesLibBtn.addEventListener('click', () => {
        if (dropdownMore) dropdownMore.style.display = 'none';
        showSourcesLibraryModal();
      });
    }

    const statusBadge = document.querySelector('#vs-ai-status-badge');
    if (statusBadge) {
      statusBadge.addEventListener('click', showSettingsModal);
    }

    const logoutBtn = document.querySelector('#vs-ai-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Sign out of current practice session?')) {
          const globalLogout = document.querySelector('#logout-btn');
          if (globalLogout) {
            globalLogout.click();
          } else {
            window.location.reload();
          }
        }
      });
    }

    // Quick Chips Handlers
    document.querySelectorAll('.vs-ai-quick-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        const input = document.querySelector('#vs-ai-prompt-input');
        if (input && prompt) {
          input.value = prompt;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
          handleSendQuery();
        }
      });
    });

    const scopeSelect = document.querySelector('#vs-ai-scope-select');
    if (scopeSelect) {
      scopeSelect.addEventListener('change', (e) => {
        activeScope = e.target.value;
      });
    }

    // Grounding Toggle Switch
    const toggleBtn = document.querySelector('#vs-ai-grounding-toggle');
    const groundingCb = document.querySelector('#vs-ai-grounding-cb');
    const groundingWrap = document.querySelector('#vs-ai-grounding-wrap');

    const updateGroundingState = (checked) => {
      sourceOnly = checked;
      if (groundingCb) groundingCb.checked = checked;
      if (toggleBtn) toggleBtn.setAttribute('aria-checked', String(checked));
    };

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateGroundingState(!sourceOnly);
      });
      toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          updateGroundingState(!sourceOnly);
        }
      });
    }

    if (groundingWrap) {
      groundingWrap.addEventListener('click', () => {
        updateGroundingState(!sourceOnly);
      });
    }

    // Composer Input & Send / Stop Button
    const sendBtn = document.querySelector('#vs-ai-btn-send');
    if (sendBtn) sendBtn.addEventListener('click', () => handleSendQuery());

    const stopBtn = document.querySelector('#vs-ai-btn-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => handleStopGeneration());

    const promptInput = document.querySelector('#vs-ai-prompt-input');
    if (promptInput) {
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendQuery();
        }
      });
      promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
        updateSendButtonState();
      });
    }

    // Generate DropUp Menu Trigger & Items
    const dropupBtn = document.querySelector('#vs-ai-btn-dropup');
    const dropupMenu = document.querySelector('#vs-ai-dropup-menu');
    const dropupContainer = document.querySelector('#vs-ai-dropup-container');

    if (dropupBtn && dropupMenu) {
      dropupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropupMenu.style.display !== 'none';
        dropupMenu.style.display = isOpen ? 'none' : 'flex';
        dropupBtn.classList.toggle('active', !isOpen);
      });

      document.querySelectorAll('.vs-ai-dropup-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = item.getAttribute('data-mode');
          setGenerationMode(mode);
          dropupMenu.style.display = 'none';
          dropupBtn.classList.remove('active');
        });
      });

      document.addEventListener('click', (e) => {
        if (dropupContainer && !dropupContainer.contains(e.target)) {
          dropupMenu.style.display = 'none';
          dropupBtn.classList.remove('active');
        }
      });
    }

    const attachBtn = document.querySelector('#vs-ai-btn-attach-file');
    const filePicker = document.querySelector('#vs-ai-file-picker');
    if (attachBtn && filePicker) {
      attachBtn.addEventListener('click', () => filePicker.click());
      filePicker.addEventListener('change', handleFileSelected);
    }

    const browseClientBtn = document.querySelector('#vs-ai-btn-browse-client-docs');
    if (browseClientBtn) {
      browseClientBtn.addEventListener('click', () => {
        if (promptInput) {
          promptInput.value += (promptInput.value ? ' ' : '') + '[Referencing client vault] ';
          promptInput.focus();
          promptInput.style.height = 'auto';
          promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
          updateSendButtonState();
        }
      });
    }

    // Search History Live Filtering
    const searchHistoryInput = document.querySelector('#vs-ai-search-history');
    if (searchHistoryInput) {
      searchHistoryInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        filterConversations(q);
      });
    }

    // Clean up short chats button
    const cleanChatsBtn = document.querySelector('#vs-ai-btn-clean-chats');
    if (cleanChatsBtn) cleanChatsBtn.addEventListener('click', showCleanChatsModal);

    // Scroll stream listener for "Jump to Latest" pill
    const stream = document.querySelector('#vs-ai-chat-stream');
    const jumpBtn = document.querySelector('#vs-ai-jump-bottom');
    if (stream && jumpBtn) {
      stream.addEventListener('scroll', () => {
        const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
        if (distanceToBottom > 150) {
          jumpBtn.classList.add('visible');
        } else {
          jumpBtn.classList.remove('visible');
        }
      });

      jumpBtn.addEventListener('click', () => {
        stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
        jumpBtn.classList.remove('visible');
      });
    }

    updateSendButtonState();
  }

  function handleStopGeneration() {
    if (!isRequestInFlight) return;
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch(e) {}
      currentAbortController = null;
    }
    if (currentStreamReader) {
      try { currentStreamReader.cancel(); } catch(e) {}
      currentStreamReader = null;
    }
  }

  function updateSendButtonState() {
    const sendBtn = document.querySelector('#vs-ai-btn-send');
    const stopBtn = document.querySelector('#vs-ai-btn-stop');
    const promptInput = document.querySelector('#vs-ai-prompt-input');
    const hasText = promptInput && promptInput.value.trim().length > 0;
    const hasAtt = currentAttachments.length > 0;

    if (isRequestInFlight) {
      if (sendBtn) sendBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
    } else {
      if (sendBtn) {
        sendBtn.style.display = 'inline-flex';
        sendBtn.disabled = !hasText && !hasAtt;
      }
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  // ------------------------------------------------------------
  // STATUS & HEALTH CHECK
  // ------------------------------------------------------------
  async function checkVsAiStatus() {
    const text = document.querySelector('#vs-ai-status-text');
    const modelPill = document.querySelector('#vs-ai-model-pill');

    try {
      const resp = await fetch('/api/ai/health');
      const data = await resp.json();
      vsAiHealth = data;

      if (modelPill) {
        modelPill.textContent = 'VS AI Fast Core';
      }

      if (text) {
        if (data.has_api_key || data.has_oauth) {
          text.textContent = (data.chunks_indexed || '2,506') + ' sections indexed';
        } else {
          text.textContent = 'Configure VS AI Key';
        }
      }
    } catch (err) {
      if (text) text.textContent = 'VS AI Offline';
    }
  }

  // ------------------------------------------------------------
  // CHAT STREAM & WELCOME HERO
  // ------------------------------------------------------------
  function renderWelcomeHero() {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    stream.innerHTML = `
      <div class="empty">
        <div class="mono" style="margin:0 auto 14px;width:44px;height:44px;font-size:18px;">VS</div>
        <h2>What do you need to check today?</h2>
        <p class="muted">Answers cite the Income-tax Act 2025, CGST Act and judicial precedents.</p>
      </div>
    `;
  }

  function triggerMermaidRender() {
    if (window.mermaid && typeof mermaid.run === 'function') {
      try {
        mermaid.run({ querySelector: '.mermaid' }).catch(() => {});
      } catch(e) {}
    }
  }

  function renderAssistantActionsHtml() {
    return `
      <div class="row vs-ai-msg-actions" style="margin-top:8px;gap:6px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="btn ib tip btn-copy-text" data-t="Copy text" aria-label="Copy">
          <svg class="i" aria-hidden="true"><use href="#copy"/></svg>
        </button>
        <button type="button" class="btn ib tip btn-regenerate" data-t="Regenerate answer" aria-label="Regenerate">
          <svg class="i" aria-hidden="true"><use href="#refresh"/></svg>
        </button>
        <button type="button" class="btn tip btn-open-canvas" data-t="Edit & Enhance in Document Canvas" aria-label="Edit in Canvas" style="font-size:12px;gap:5px;background:#f0fdf4;border-color:#bbf7d0;color:#166534;">
          <svg class="i" aria-hidden="true" style="width:13px;height:13px;"><use href="#setup"/></svg>
          <span>Canvas</span>
        </button>
        
        <!-- DIRECT ONE-CLICK GENERATION & DOWNLOAD BUTTONS -->
        <button type="button" class="btn tip vs-ai-btn-direct-export vs-ai-btn-direct-pdf btn-direct-pdf" data-t="Generate & Preview PDF" aria-label="Direct PDF">
          <span>📑 PDF</span>
        </button>
        <button type="button" class="btn tip vs-ai-btn-direct-export vs-ai-btn-direct-excel btn-direct-excel" data-t="Generate & Download Excel (.xlsx)" aria-label="Direct Excel">
          <span>📊 Excel</span>
        </button>
        <button type="button" class="btn tip vs-ai-btn-direct-export vs-ai-btn-direct-word btn-direct-word" data-t="Generate & Download Word (.docx)" aria-label="Direct Word">
          <span>📄 Word</span>
        </button>

        <div class="vs-ai-export-dropdown-wrap" style="position:relative;display:inline-block;">
          <button type="button" class="btn tip secondary btn-export-dropdown-toggle" data-t="More Export & Print Options" aria-label="More" style="font-size:12px;gap:4px;">
            <span>More ▾</span>
          </button>
          <div class="vs-ai-export-menu" style="display:none;">
            <button type="button" class="vs-ai-export-item export-opt-copy">
              <span class="export-icon">📋</span>
              <div class="export-text">
                <div class="export-title">Copy Formatted Text</div>
              </div>
            </button>
            <button type="button" class="vs-ai-export-item export-opt-print">
              <span class="export-icon">🖨️</span>
              <div class="export-text">
                <div class="export-title">Print Document</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function extractCleanDocTitle(content, fallbackTitle) {
    if (content) {
      const lines = content.split('\n');
      for (let i = 0; i < Math.min(lines.length, 6); i++) {
        const l = lines[i].trim();
        if (l.startsWith('#')) {
          let clean = l.replace(/^[#\s*]+/, '').replace(/[*_`]/g, '').trim();
          clean = clean.replace(/^\d+\.\s*/, '').replace(/[:\-–—\\/]+$/, '').trim();
          if (clean.length > 3 && clean.length < 65 && !clean.toLowerCase().startsWith('table') && !clean.toLowerCase().startsWith('note') && !clean.toLowerCase().startsWith('disclaimer')) {
            return clean;
          }
        }
      }
    }
    if (fallbackTitle) {
      let t = fallbackTitle.split('\n')[0].trim();
      const low = t.toLowerCase();
      if (low.includes('pdf') && (low.includes('generate') || low.includes('can you') || low.includes('create') || low.includes('export') || low.includes('make') || low.includes('download'))) {
        return 'PDF Generation and Document Export';
      }
      if (low.includes('excel') || low.includes('spreadsheet') || low.includes('xlsx')) {
        return 'Excel Spreadsheet Generation';
      }
      if (low.includes('word') || low.includes('docx')) {
        return 'Word Document Drafting';
      }
      t = t.replace(/^(?:okay|hey|hi|hello|please|tell me|can you|could you|i want to|i need to|how to|what is|what are|explain|draft|create|generate|genrate|make|show me|provide)\s+(?:a\s+|an\s+|the\s+)?/i, '').trim();
      t = t.replace(/^(?:okay|hey|hi|hello|please|tell me|can you|could you|i want to|i need to|how to|what is|what are|explain|draft|create|generate|genrate|make|show me|provide)\s+(?:a\s+|an\s+|the\s+)?/i, '').trim();
      t = t.replace(/[\\/*?:"<>|]/g, '').replace(/\.(docx|xlsx|pdf|txt)+$/i, '').trim();
      t = t.replace(/\s+/g, ' ').trim();
      if (t.length > 3) {
        return t.length > 55 ? t.slice(0, 52) + '...' : t.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
    return 'Statutory Advisory Brief';
  }

  function attachAssistantActionHandlers(row, title, content, citations) {
    const actionsRow = row.querySelector('.vs-ai-msg-actions');
    if (!actionsRow) return;
    actionsRow.style.display = 'flex';

    const cleanHeading = extractCleanDocTitle(content, title);

    // Direct Inbuilt Generated File Card
    const pLow = (title || lastSentPrompt || '').toLowerCase();
    const isTableData = content.includes('| ---') || content.includes('|:---') || content.includes('|---|') || (content.includes('|') && content.split('\n').filter(l => l.includes('|')).length >= 3);
    const hasActiveMode = Boolean(activeGenerationMode);
    const wantsPdf = activeGenerationMode === 'pdf' || pLow.includes('pdf');
    const wantsExcel = activeGenerationMode === 'excel' || activeGenerationMode === 'gsheet' || pLow.includes('excel') || pLow.includes('spreadsheet') || pLow.includes('sheet') || pLow.includes('xlsx');
    const wantsWord = activeGenerationMode === 'word' || activeGenerationMode === 'docs' || pLow.includes('word') || pLow.includes('doc') || pLow.includes('docx');
    const wantsFile = hasActiveMode || wantsPdf || wantsExcel || wantsWord || pLow.includes('generate') || pLow.includes('create') || pLow.includes('export');

    if (wantsFile || isTableData) {
      let existingCard = row.querySelector('.vs-ai-direct-file-card');
      if (!existingCard) {
        let fileType = 'pdf';
        let fileExt = 'pdf';
        let fileIcon = '📑';
        let badgeClass = 'pdf';
        let badgeLabel = 'ReportLab 300 DPI';
        let typeDesc = 'Direct Statutory PDF';

        if (activeGenerationMode === 'gsheet') {
          fileType = 'xlsx';
          fileExt = 'xlsx';
          fileIcon = '📈';
          badgeClass = 'xlsx';
          badgeLabel = 'Google Sheet';
          typeDesc = 'Direct Financial Dataset';
        } else if (wantsExcel || (isTableData && !wantsPdf && !wantsWord)) {
          fileType = 'xlsx';
          fileExt = 'xlsx';
          fileIcon = '📊';
          badgeClass = 'xlsx';
          badgeLabel = 'Excel · .xlsx';
          typeDesc = 'Direct Financial Spreadsheet';
        } else if (activeGenerationMode === 'docs') {
          fileType = 'docx';
          fileExt = 'docx';
          fileIcon = '📝';
          badgeClass = 'docx';
          badgeLabel = 'Google Docs';
          typeDesc = 'Structured Legal Draft';
        } else if (wantsWord) {
          fileType = 'docx';
          fileExt = 'docx';
          fileIcon = '📄';
          badgeClass = 'docx';
          badgeLabel = 'Word · .docx';
          typeDesc = 'Direct Executive Document';
        }

        const safeFilename = cleanHeading.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') + '.' + fileExt;

        const card = document.createElement('div');
        card.className = 'vs-ai-direct-file-card';
        card.innerHTML = `
          <div class="vs-ai-file-icon-box ${badgeClass}">${fileIcon}</div>
          <div class="vs-ai-file-meta-col">
            <div class="vs-ai-file-meta-name" title="${escapeHtml(safeFilename)}">${escapeHtml(safeFilename)}</div>
            <div class="vs-ai-file-meta-sub">
              <span class="vs-ai-file-badge ${badgeClass}">${badgeLabel}</span>
              <span>${typeDesc}</span>
            </div>
          </div>
          <div class="vs-ai-file-actions-row">
            <button type="button" class="btn secondary btn-sm btn-card-preview" title="Preview Generated Document">
              <span>👁️ Preview</span>
            </button>
            <button type="button" class="btn primary btn-sm btn-card-download" title="Download Generated File">
              <svg class="i" style="width:12px;height:12px;margin-right:3px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Download</span>
            </button>
            <button type="button" class="btn secondary btn-sm btn-card-canvas" title="Make Changes / Edit in Document Canvas">
              <span>✏️ Make Changes</span>
            </button>
          </div>
        `;

        const asstBody = row.querySelector('.vs-ai-asst-body');
        if (asstBody && (hasActiveMode || wantsPdf || wantsExcel || wantsWord)) {
          // If file explicitly targeted, position the File Card at the top of the message bubble
          asstBody.parentNode.insertBefore(card, asstBody);
        } else {
          const footerRow = row.querySelector('.vs-ai-asst-footer-row');
          if (footerRow) {
            footerRow.parentNode.insertBefore(card, footerRow);
          } else {
            actionsRow.parentNode.insertBefore(card, actionsRow);
          }
        }

        card.querySelector('.btn-card-preview').onclick = () => {
          if (fileType === 'xlsx') handleExportExcel(cleanHeading, content);
          else if (fileType === 'docx') handleExportWord(cleanHeading, content, citations);
          else handlePreviewPdf(cleanHeading, content, citations);
        };
        card.querySelector('.btn-card-download').onclick = () => {
          if (fileType === 'xlsx') handleExportExcel(cleanHeading, content);
          else if (fileType === 'docx') handleExportWord(cleanHeading, content, citations);
          else handleSavePdf(cleanHeading, content, citations);
        };
        card.querySelector('.btn-card-canvas').onclick = () => {
          showDocumentCanvasModal({ title: cleanHeading, content: content, citations: citations });
        };
      }
    }

    // Direct 1-Click PDF Button
    const directPdfBtn = actionsRow.querySelector('.btn-direct-pdf');
    if (directPdfBtn) {
      directPdfBtn.onclick = () => handlePreviewPdf(cleanHeading, content, citations);
    }

    // Direct 1-Click Excel Button
    const directExcelBtn = actionsRow.querySelector('.btn-direct-excel');
    if (directExcelBtn) {
      directExcelBtn.onclick = () => handleExportExcel(cleanHeading, content);
    }

    // Direct 1-Click Word Button
    const directWordBtn = actionsRow.querySelector('.btn-direct-word');
    if (directWordBtn) {
      directWordBtn.onclick = () => handleExportWord(cleanHeading, content, citations);
    }

    // Copy Text
    const copyBtn = actionsRow.querySelector('.btn-copy-text');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        copyBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#check"/></svg>';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#copy"/></svg>';
        }, 2000);
      };
    }

    // Regenerate
    const regenBtn = actionsRow.querySelector('.btn-regenerate');
    if (regenBtn) {
      regenBtn.onclick = () => {
        if (lastSentPrompt) {
          handleSendQuery(lastSentPrompt, lastSentAttachments);
        }
      };
    }

    // Open in Canvas
    const canvasBtn = actionsRow.querySelector('.btn-open-canvas');
    if (canvasBtn) {
      canvasBtn.onclick = () => {
        showDocumentCanvasModal({
          title: cleanHeading,
          content: content,
          citations: citations
        });
      };
    }

    // Export Dropdown
    const exportToggle = actionsRow.querySelector('.btn-export-dropdown-toggle');
    const exportMenu = actionsRow.querySelector('.vs-ai-export-menu');
    if (exportToggle && exportMenu) {
      exportToggle.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.vs-ai-export-menu').forEach(m => {
          if (m !== exportMenu) m.style.display = 'none';
        });
        exportMenu.style.display = exportMenu.style.display === 'block' ? 'none' : 'block';
      };

      const optCopy = exportMenu.querySelector('.export-opt-copy');
      if (optCopy) {
        optCopy.onclick = () => {
          exportMenu.style.display = 'none';
          navigator.clipboard.writeText(content);
          if (typeof showNativeToast === 'function') {
            showNativeToast('Formatted content copied to clipboard', 'success', 2000);
          }
        };
      }

      const optPrint = exportMenu.querySelector('.export-opt-print');
      if (optPrint) {
        optPrint.onclick = () => {
          exportMenu.style.display = 'none';
          printFormattedContent(cleanHeading, content);
        };
      }
    }
  }

  // ------------------------------------------------------------
  // SEND QUERY & RECEIVE ANSWER (REAL-TIME SSE STREAMING)
  // ------------------------------------------------------------
  async function handleSendQuery(retryText = null, retryAtts = null, existingErrorRow = null) {
    if (isRequestInFlight) return;

    cancelAutoRetry();

    const stream = document.querySelector('#vs-ai-chat-stream');
    if (stream) {
      const heroEls = stream.querySelectorAll('.vs-ai-hero-wrap, .empty');
      heroEls.forEach(el => el.remove());
    }

    const input = document.querySelector('#vs-ai-prompt-input');
    const promptText = retryText !== null ? retryText : (input ? input.value.trim() : '');
    const attachmentsToSend = retryAtts !== null ? retryAtts : [...currentAttachments];

    if (!promptText && attachmentsToSend.length === 0) return;

    // Cache last sent query for retries
    lastSentPrompt = promptText;
    lastSentAttachments = [...attachmentsToSend];

    // Immediate Smooth Chat Generation in the Chats Tab
    const cleanPromptTitle = extractCleanDocTitle(null, promptText);
    if (!currentConvId) {
      currentConvId = 'conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      insertNewChatToSidebar(currentConvId, cleanPromptTitle);
    }

    // If NOT a retry, append the User message bubble to the stream
    if (!existingErrorRow) {
      appendMessage('user', promptText || '(Attached document query)', null, null, attachmentsToSend, false, false);
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      currentAttachments = [];
      renderAttachmentPreviewBar();
    }

    let thinkingMsg = 'VS AI is thinking & analyzing statutory provisions...';
    if (activeGenerationMode === 'pdf') thinkingMsg = 'VS AI is compiling statutory PDF document & citations...';
    else if (activeGenerationMode === 'excel' || activeGenerationMode === 'gsheet') thinkingMsg = 'VS AI is generating financial spreadsheet & calculations...';
    else if (activeGenerationMode === 'word' || activeGenerationMode === 'docs') thinkingMsg = 'VS AI is drafting executive legal document & clauses...';

    const loadingId = 'loading-' + Date.now();
    const loadingEl = document.createElement('div');
    loadingEl.className = 'msg vs-ai-message-row assistant';
    loadingEl.id = loadingId;
    loadingEl.innerHTML = `
      <div class="av">VS</div>
      <div class="bub">
        <div class="vs-ai-thinking-card">
          <div class="vs-ai-thinking-sparkle">✨</div>
          <div class="vs-ai-thinking-content">
            <span class="vs-ai-thinking-label">${escapeHtml(thinkingMsg)}</span>
            <div class="typing"><i></i><i></i><i></i></div>
          </div>
        </div>
      </div>
    `;

    // If retrying, replace the error card in place
    if (existingErrorRow && existingErrorRow.parentNode) {
      existingErrorRow.parentNode.replaceChild(loadingEl, existingErrorRow);
    } else if (stream) {
      stream.appendChild(loadingEl);
      stream.scrollTop = stream.scrollHeight;
    }

    isRequestInFlight = true;
    currentAbortController = new AbortController();
    updateSendButtonState();

    let asstRow = null;
    let bodyEl = null;
    let sourcesLabel = null;
    let actionsRow = null;
    let accumulatedText = '';
    let currentCitations = [];

    function ensureAssistantBubble() {
      if (asstRow) return;
      if (loadingEl.parentNode) loadingEl.remove();

      asstRow = document.createElement('div');
      asstRow.className = 'msg vs-ai-message-row assistant';
      asstRow.innerHTML = `
        <div class="av">VS</div>
        <div class="bub">
          <div class="vs-ai-asst-body">
            <div class="vs-ai-thinking-card">
              <div class="vs-ai-thinking-sparkle">✨</div>
              <div class="vs-ai-thinking-content">
                <span class="vs-ai-thinking-label">${escapeHtml(thinkingMsg)}</span>
                <div class="typing"><i></i><i></i><i></i></div>
              </div>
            </div>
          </div>
          <div class="src vs-ai-asst-footer-row">
            <span class="chip vs-ai-sources-pill">
              <svg class="i" style="width:13px;height:13px;" aria-hidden="true"><use href="#folder"/></svg>
              <span class="sources-pill-label">Income-tax Act, 2025</span>
            </span>
          </div>
          ${renderAssistantActionsHtml()}
        </div>
      `;

      stream.appendChild(asstRow);
      bodyEl = asstRow.querySelector('.vs-ai-asst-body');
      sourcesLabel = asstRow.querySelector('.sources-pill-label');
      actionsRow = asstRow.querySelector('.vs-ai-msg-actions');
      if (actionsRow) actionsRow.style.display = 'none';
      stream.scrollTop = stream.scrollHeight;
    }

    function updateCitationsPill(cList) {
      if (!cList || cList.length === 0 || !sourcesLabel) return;
      const secList = cList.map(c => c.section || 'Statute').filter(Boolean);
      const text = secList.length > 0 ? secList.slice(0, 2).join(', ') : 'Income-tax Act, 2025';
      sourcesLabel.textContent = text;
    }

    function finalizeAssistantActions() {
      if (!asstRow) return;
      attachAssistantActionHandlers(asstRow, promptText || 'Statutory Advisory Brief', accumulatedText, currentCitations);
      triggerMermaidRender();
    }

    try {
      const resp = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: currentAbortController.signal,
        body: JSON.stringify({
          conversation_id: currentConvId,
          title: cleanPromptTitle,
          prompt: promptText,
          scope: activeScope,
          source_only: sourceOnly,
          attachments: attachmentsToSend,
          generation_mode: activeGenerationMode
        })
      });

      if (!resp.ok) {
        let errData = {};
        try { errData = await resp.json(); } catch(e) {}
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      currentStreamReader = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let streamFinished = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;
              let ev = null;
              try { ev = JSON.parse(jsonStr); } catch(e) { continue; }

              if (ev.type === 'start') {
                if (ev.conversation_id) currentConvId = ev.conversation_id;
                if (ev.auto_title) {
                  updateSidebarChatTitle(currentConvId, ev.auto_title);
                }
              } else if (ev.type === 'meta') {
                currentCitations = ev.citations || [];
                ensureAssistantBubble();
                updateCitationsPill(currentCitations);
              } else if (ev.type === 'token') {
                ensureAssistantBubble();
                accumulatedText += ev.delta || '';
                bodyEl.innerHTML = renderMarkdown(accumulatedText) + '<span class="vs-ai-type-cursor">▌</span>';

                const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
                if (distanceToBottom < 180) stream.scrollTop = stream.scrollHeight;
              } else if (ev.type === 'done') {
                ensureAssistantBubble();
                bodyEl.innerHTML = renderMarkdown(accumulatedText);
                if (ev.citations && ev.citations.length > 0) {
                  currentCitations = ev.citations;
                  updateCitationsPill(currentCitations);
                }
                if (ev.auto_title) {
                  updateSidebarChatTitle(currentConvId, ev.auto_title);
                }
                finalizeAssistantActions();
                retryAttempts = 0;
                streamFinished = true;
                try { await reader.cancel(); } catch(e) {}
                break;
              } else if (ev.type === 'error') {
                if (!asstRow) {
                  if (loadingEl.parentNode) loadingEl.remove();
                  retryAttempts++;
                  renderErrorCard(ev.error || 'Failed to generate response.', promptText, attachmentsToSend);
                  if (ev.error && ev.error.toLowerCase().includes('key')) {
                    showSettingsModal();
                  }
                } else {
                  bodyEl.innerHTML = renderMarkdown(accumulatedText) + `<div style="color:#b91c1c;margin-top:12px;font-size:13px;display:flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#b91c1c;"><use href="#alert"/></svg>Stream interrupted: ${escapeHtml(ev.error)}</div>`;
                  finalizeAssistantActions();
                }
                streamFinished = true;
                try { await reader.cancel(); } catch(e) {}
                break;
              }
            }
          }
          if (streamFinished) break;
        }
        if (streamFinished) break;
      }

      if (asstRow && bodyEl && !streamFinished) {
        bodyEl.innerHTML = renderMarkdown(accumulatedText);
        finalizeAssistantActions();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        if (loadingEl.parentNode) loadingEl.remove();
        if (asstRow && bodyEl) {
          bodyEl.innerHTML = renderMarkdown(accumulatedText) + '\n\n*(Generation stopped by user)*';
          finalizeAssistantActions();
        }
      } else {
        if (loadingEl.parentNode) loadingEl.remove();
        if (!asstRow) {
          retryAttempts++;
          renderErrorCard('VS AI servers are experiencing peak demand across model pools. Please retry.', promptText, attachmentsToSend);
        }
      }
    } finally {
      if (loadingEl.parentNode) loadingEl.remove();
      isRequestInFlight = false;
      currentAbortController = null;
      currentStreamReader = null;
      updateSendButtonState();
      const input = document.querySelector('#vs-ai-prompt-input');
      if (input) input.focus();
    }
  }

  // ------------------------------------------------------------
  // RESILIENT SYSTEM ERROR CARD & RETRY COUNTDOWN
  // ------------------------------------------------------------
  function renderErrorCard(errorMsg, originalPrompt, originalAtts) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    // Collapse any previous consecutive error cards
    const existingErrors = stream.querySelectorAll('.vs-ai-error-card');
    existingErrors.forEach(card => {
      const row = card.closest('.vs-ai-message-row');
      if (row) row.remove();
    });

    row.className = 'msg vs-ai-message-row assistant';
    row.innerHTML = `
      <div class="err vs-ai-error-card">
        <b>
          <svg class="i" style="width:16px;height:16px;" aria-hidden="true"><use href="#alert"/></svg>
          <span class="vs-ai-error-title">High demand right now</span>
        </b>
        <p class="vs-ai-error-desc" style="margin:4px 0 0 0;font-size:13px;line-height:1.45;">${escapeHtml(errorMsg)}</p>
        <div class="row" style="margin-top:12px;">
          <button type="button" class="btn p vs-ai-btn-retry" id="btn-manual-retry" title="Resend inquiry immediately">
            <svg class="i" aria-hidden="true"><use href="#refresh"/></svg>
            <span>Retry Query</span>
          </button>
          ${canAutoRetry ? `
            <div class="row vs-ai-auto-retry-status" id="vs-ai-countdown-wrap" style="gap:8px;">
              <button type="button" class="btn vs-ai-btn-cancel-retry" id="btn-cancel-auto-retry" title="Cancel automatic retry">Cancel</button>
              <small class="muted">Auto-retry in <strong id="retry-seconds-count">${backoffSeconds}</strong>s</small>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;

    const retryBtn = row.querySelector('#btn-manual-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        cancelAutoRetry();
        handleSendQuery(originalPrompt, originalAtts, row);
      });
    }

    const cancelBtn = row.querySelector('#btn-cancel-auto-retry');
    const countdownWrap = row.querySelector('#vs-ai-countdown-wrap');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelAutoRetry();
        if (countdownWrap) countdownWrap.remove();
      });
    }

    if (canAutoRetry) {
      autoRetrySecondsLeft = backoffSeconds;
      const countEl = row.querySelector('#retry-seconds-count');

      autoRetryTimer = setInterval(() => {
        autoRetrySecondsLeft--;
        if (countEl) countEl.textContent = autoRetrySecondsLeft;

        if (autoRetrySecondsLeft <= 0) {
          cancelAutoRetry();
          handleSendQuery(originalPrompt, originalAtts, row);
        }
      }, 1000);
    }
  }

  function cancelAutoRetry() {
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }
  }

  // ------------------------------------------------------------
  // APPEND MESSAGE TO CHAT STREAM
  // ------------------------------------------------------------
  function appendMessage(role, content, citations, promptTitle, attachments, isNewResponse, isError) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    const heroEls = stream.querySelectorAll('.vs-ai-hero-wrap, .empty');
    heroEls.forEach(el => el.remove());

    const row = document.createElement('div');
    row.className = `vs-ai-message-row ${role} vs-ai-message-fade-in`;

    if (role === 'user') {
      let attHtml = '';
      if (attachments && attachments.length > 0) {
        attHtml = `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            ${attachments.map(a => `
              <span class="vs-ai-att-pill">
                <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#clip"/></svg>
                <span>${escapeHtml(a.name)}</span>
                <span style="opacity:0.75;font-size:10px;">${formatFileSize(a.size)}</span>
              </span>
            `).join('')}
          </div>
        `;
      }
      row.className = 'msg u vs-ai-message-row user';
      row.innerHTML = `
        <div class="av">R</div>
        <div class="bub vs-ai-bubble-user">
          ${attHtml}
          <div>${escapeHtml(content)}</div>
          <small>${formatTime(new Date())}</small>
        </div>
      `;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
    } else {
      let sourcesText = 'Income-tax Act, 2025';
      if (citations && citations.length > 0) {
        const secList = citations.map(c => c.section || 'Statute').filter(Boolean);
        sourcesText = secList.length > 0 ? secList.slice(0, 2).join(', ') : 'Income-tax Act, 2025';
      }

      row.className = 'msg vs-ai-message-row assistant';
      row.innerHTML = `
        <div class="av">VS</div>
        <div class="bub vs-ai-bubble-assistant">
          <div class="vs-ai-asst-body"></div>
          <div class="src vs-ai-asst-footer-row">
            <span class="chip vs-ai-sources-pill">
              <svg class="i" style="width:13px;height:13px;" aria-hidden="true"><use href="#folder"/></svg>
              <span class="sources-pill-label">${escapeHtml(sourcesText)}</span>
            </span>
          </div>
          ${renderAssistantActionsHtml()}
        </div>
      `;

      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;

      const bodyEl = row.querySelector('.vs-ai-asst-body');
      attachAssistantActionHandlers(row, promptTitle || 'Statutory Advisory Brief', content, citations);

      if (isNewResponse) {
        streamTypewriter(bodyEl, content, () => {
          const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          if (distanceToBottom < 200) stream.scrollTop = stream.scrollHeight;
        });
      } else {
        bodyEl.innerHTML = renderMarkdown(content);
      }
    }
  }

  // ------------------------------------------------------------
  // STREAM TYPEWRITER EFFECT
  // ------------------------------------------------------------
  function streamTypewriter(container, fullText, onComplete) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    const words = fullText.split(/(\s+)/);
    let index = 0;
    let accumulated = '';

    const cursorSpan = document.createElement('span');
    cursorSpan.className = 'vs-ai-type-cursor';
    cursorSpan.textContent = '▌';

    container.innerHTML = '';
    container.appendChild(cursorSpan);

    const stepInterval = 12;
    const wordsPerStep = 3;

    const timer = setInterval(() => {
      let chunk = '';
      for (let k = 0; k < wordsPerStep && index < words.length; k++, index++) {
        chunk += words[index];
      }
      accumulated += chunk;

      container.innerHTML = renderMarkdown(accumulated);
      container.appendChild(cursorSpan);

      if (stream) {
        const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
        if (distanceToBottom < 160) {
          stream.scrollTop = stream.scrollHeight;
        }
      }

      if (index >= words.length) {
        clearInterval(timer);
        cursorSpan.remove();
        container.innerHTML = renderMarkdown(fullText);
        triggerMermaidRender();
        if (onComplete) onComplete();
        if (stream) {
          const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          if (distanceToBottom < 160) stream.scrollTop = stream.scrollHeight;
        }
      }
    }, stepInterval);
  }

  // ------------------------------------------------------------
  // UNIVERSAL DOCUMENT, SPREADSHEET & PDF EXPORT SUITE
  // ------------------------------------------------------------
  const pdfExportCache = new Map();

  async function ensurePdfExported(title, content, citations) {
    const cacheKey = (title || '') + '::' + (content || '').slice(0, 150);
    if (pdfExportCache.has(cacheKey)) {
      return pdfExportCache.get(cacheKey);
    }
    const resp = await fetch('/api/ai/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Statutory Legal Opinion & Advisory',
        content: content || '',
        citations: citations || []
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate PDF');
    }
    pdfExportCache.set(cacheKey, data);
    return data;
  }

  async function handlePreviewPdf(title, content, citations) {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Branded Statutory PDF...', 'info', 2000);
      }
      const data = await ensurePdfExported(title, content, citations);
      showInAppPdfPreview(data, title);
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    }
  }

  async function handleSavePdf(title, content, citations) {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Preparing Document for Save...', 'info', 1500);
      }
      const data = await ensurePdfExported(title, content, citations);
      showUniversalSaveOptionsModal(data, title, 'pdf');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    }
  }

  async function handleExportWord(title, content, citations, fontName = 'Plus Jakarta Sans') {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Microsoft Word (.docx)...', 'info', 2000);
      }
      const resp = await fetch('/api/ai/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || 'Statutory Legal Opinion & Advisory',
          content: content || '',
          citations: citations || [],
          font_name: fontName
        })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Failed to generate Word document');
      showUniversalSaveOptionsModal(data, title, 'docx');
    } catch (err) {
      alert('Word export error: ' + err.message);
    }
  }

  async function handleExportExcel(title, content) {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Microsoft Excel (.xlsx)...', 'info', 2000);
      }
      const resp = await fetch('/api/ai/export-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || 'Statutory Statement & Computations',
          content: content || ''
        })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Failed to generate Excel spreadsheet');
      showUniversalSaveOptionsModal(data, title, 'xlsx');
    } catch (err) {
      alert('Excel export error: ' + err.message);
    }
  }

  function printFormattedContent(title, content) {
    const printWin = window.open('', '_blank');
    if (!printWin) {
      window.print();
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${escapeHtml(title || 'Statutory Document')}</title>
          <style>
            body { font-family: 'Plus Jakarta Sans', Segoe UI, Arial, sans-serif; line-height: 1.6; color: #0f172a; padding: 40px; margin: 0; }
            h1, h2, h3 { color: #1e3a8a; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 12px; font-size: 13px; }
            th { background: #f1f5f9; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>${escapeHtml(title || 'Statutory Document')}</h2>
          <hr style="border: 0; border-top: 2px solid #2563eb; margin-bottom: 20px;" />
          ${renderMarkdown(content)}
          <script>
            window.onload = function() { window.print(); window.close(); };
          <\/script>
        </body>
      </html>
    `);
    printWin.document.close();
  }

  function showInAppPdfPreview(pdfData, title) {
    const existing = document.getElementById('vs-ai-pdf-preview-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vs-ai-pdf-preview-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10001';

    const pdfUrl = `/api/ai/exports/${encodeURIComponent(pdfData.filename)}`;
    const safeTitle = escapeHtml(title || 'Statutory Legal Opinion & Advisory');

    modal.innerHTML = `
      <div class="vs-ai-pdf-modal-card glass">
        <div class="vs-ai-pdf-toolbar">
          <div class="vs-ai-pdf-toolbar-title">
            <svg class="i" style="width:18px;height:18px;color:#2563eb;" aria-hidden="true"><use href="#ai"/></svg>
            <span style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeTitle}</span>
            <span class="vs-ai-chart-badge" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;">ReportLab 300 DPI</span>
          </div>
          <div class="vs-ai-pdf-toolbar-actions">
            <button type="button" class="btn primary btn-sm" id="vs-ai-pdf-btn-save-options">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Save / Download</span>
            </button>
            <button type="button" class="btn secondary btn-sm" id="vs-ai-pdf-btn-save-client">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#folder"/></svg>
              <span>Save to Client</span>
            </button>
            <button type="button" class="btn secondary btn-sm" id="vs-ai-pdf-btn-save-location">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#drive"/></svg>
              <span>Save to Windows</span>
            </button>
            <button type="button" class="vs-ai-modal-close" id="vs-ai-pdf-btn-close" aria-label="Close Preview">✕</button>
          </div>
        </div>
        <iframe class="vs-ai-pdf-frame" src="${pdfUrl}#toolbar=1&navpanes=0" title="PDF Document Preview"></iframe>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#vs-ai-pdf-btn-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelector('#vs-ai-pdf-btn-save-options').onclick = () => {
      showUniversalSaveOptionsModal(pdfData, title, 'pdf');
    };
    modal.querySelector('#vs-ai-pdf-btn-save-client').onclick = () => {
      showUniversalSaveOptionsModal(pdfData, title, 'pdf', 'client');
    };
    modal.querySelector('#vs-ai-pdf-btn-save-location').onclick = () => {
      executeSaveToWindowsLocation(pdfData, title, 'pdf');
    };
  }

  let cachedClientsList = null;

  function showUniversalSaveOptionsModal(fileData, title, fileType = 'pdf', initialOption = null) {
    const existing = document.getElementById('vs-ai-save-options-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vs-ai-save-options-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10005';

    let cleanBase = (title || fileData.filename || 'Statutory Document').trim();
    cleanBase = cleanBase.replace(/\.(docx|xlsx|pdf|txt)+$/i, '');
    const safeTitle = escapeHtml(cleanBase);
    const extLabel = fileType === 'xlsx' ? 'Excel Spreadsheet (.xlsx)' : (fileType === 'docx' ? 'Word Document (.docx)' : 'Statutory Document (.pdf)');
    const extIcon = fileType === 'xlsx' ? '📊' : (fileType === 'docx' ? '📄' : '📑');

    modal.innerHTML = `
      <div class="vs-ai-save-options-card glass">
        <div class="vs-ai-modal-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:20px;">${extIcon}</span>
            <h3 class="vs-ai-modal-title" style="margin:0;font-size:17px;">Save ${extLabel}</h3>
          </div>
          <button type="button" class="vs-ai-modal-close" id="vs-ai-save-modal-close">✕</button>
        </div>
        
        <p style="margin:0 0 16px 0;font-size:12.5px;color:#64748b;">
          Choose where you want to store <strong>${safeTitle}</strong>:
        </p>

        <div class="vs-ai-save-choice-grid">
          <!-- Option 1: SAVE TO CLIENT -->
          <div class="vs-ai-save-choice-box ${initialOption === 'client' ? 'active' : ''}" id="opt-save-client">
            <div class="vs-ai-save-icon-circle">📂</div>
            <div class="vs-ai-save-choice-title">SAVE TO CLIENT</div>
            <div class="vs-ai-save-choice-desc">Store directly into client's official file vault & folder structure</div>
            <button type="button" class="btn primary btn-sm" style="width:100%;margin-top:4px;pointer-events:none;">
              Select Client
            </button>
          </div>

          <!-- Option 2: SAVE TO LOCATION -->
          <div class="vs-ai-save-choice-box" id="opt-save-location">
            <div class="vs-ai-save-icon-circle">💻</div>
            <div class="vs-ai-save-choice-title">SAVE TO LOCATION</div>
            <div class="vs-ai-save-choice-desc">Choose any folder on your PC using native Windows file dialog</div>
            <button type="button" class="btn secondary btn-sm" style="width:100%;margin-top:4px;pointer-events:none;">
              Browse Windows...
            </button>
          </div>
        </div>

        <!-- Inline Client Picker Container -->
        <div id="vs-ai-client-picker-wrap" style="display:${initialOption === 'client' ? 'flex' : 'none'};" class="vs-ai-client-picker-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:700;color:#1e293b;">Select Client</span>
            <span style="font-size:11px;color:#64748b;" id="vs-ai-client-count-badge">Loading clients...</span>
          </div>
          <input type="text" class="vs-ai-client-search-input" id="vs-ai-client-search" placeholder="Search by Client Name, PAN, or File No...">
          <div class="vs-ai-client-search-results" id="vs-ai-client-results">
            <div style="padding:14px;text-align:center;color:#64748b;font-size:12px;">Loading clients...</div>
          </div>
          
          <div style="display:flex;gap:10px;align-items:center;">
            <label style="font-size:11.5px;font-weight:600;color:#475569;white-space:nowrap;">Folder / Section:</label>
            <select id="vs-ai-client-target-folder" class="vs-ai-input" style="padding:6px 10px;font-size:12px;flex:1;">
              <option value="General">General Documents</option>
              <option value="Income Tax">Income Tax / Advisory</option>
              <option value="GST">GST / Returns</option>
              <option value="Audit">Audit / Financials</option>
              <option value="Notices">Statutory Notices & Replies</option>
            </select>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
            <button type="button" class="btn secondary btn-sm" id="vs-ai-btn-cancel-client-save">Back</button>
            <button type="button" class="btn primary btn-sm" id="vs-ai-btn-confirm-client-save" disabled>Save to Client Vault</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#vs-ai-save-modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelector('#opt-save-location').onclick = async () => {
      modal.remove();
      await executeSaveToWindowsLocation(fileData, title, fileType);
    };

    const clientBox = modal.querySelector('#opt-save-client');
    const pickerWrap = modal.querySelector('#vs-ai-client-picker-wrap');
    clientBox.onclick = () => {
      clientBox.classList.add('active');
      modal.querySelector('#opt-save-location').classList.remove('active');
      pickerWrap.style.display = 'flex';
      setupClientPicker(modal, fileData, title, fileType);
    };

    if (initialOption === 'client') {
      setupClientPicker(modal, fileData, title, fileType);
    }
  }

  function showPdfSaveOptionsModal(pdfData, title, initialOption = null) {
    showUniversalSaveOptionsModal(pdfData, title, 'pdf', initialOption);
  }

  async function executeSaveToWindowsLocation(fileData, title, fileType = 'pdf') {
    const ext = (fileData.filename ? fileData.filename.slice(fileData.filename.lastIndexOf('.')) : `.${fileType}`).toLowerCase();
    let base = (title || fileData.filename || 'VS_AI_Document').replace(/[/\\?%*:|"<>]/g, '_').trim();
    base = base.replace(/\.(docx|xlsx|pdf|txt)+$/i, '');
    const defaultName = `${base}${ext}`;
    
    // In pywebview native desktop mode:
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_to_location) {
      try {
        const res = await window.pywebview.api.save_file_to_location(fileData.filename, defaultName);
        if (res && res.ok) {
          const msg = `✓ Document saved successfully to:\n${res.path}`;
          if (typeof showNativeToast === 'function') {
            showNativeToast(msg, 'success', 5000);
          } else {
            alert(msg);
          }
          return;
        } else if (res && res.cancelled) {
          return;
        } else if (res && res.error) {
          throw new Error(res.error);
        }
      } catch (err) {
        console.warn('Native Windows save dialog error:', err);
      }
    }

    // In-browser fallback: trigger clean native download without redirecting
    const a = document.createElement('a');
    a.href = `/api/ai/exports/${encodeURIComponent(fileData.filename)}`;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 200);
    if (typeof showNativeToast === 'function') {
      showNativeToast('Document download started.', 'success', 3000);
    }
  }

  async function setupClientPicker(modal, fileData, title, fileType = 'pdf') {
    const resultsContainer = modal.querySelector('#vs-ai-client-results');
    const countBadge = modal.querySelector('#vs-ai-client-count-badge');
    const searchInput = modal.querySelector('#vs-ai-client-search');
    const confirmBtn = modal.querySelector('#vs-ai-btn-confirm-client-save');
    const cancelBtn = modal.querySelector('#vs-ai-btn-cancel-client-save');
    const folderSelect = modal.querySelector('#vs-ai-client-target-folder');

    cancelBtn.onclick = () => {
      modal.querySelector('#vs-ai-client-picker-wrap').style.display = 'none';
      modal.querySelector('#opt-save-client').classList.remove('active');
    };

    let selectedClient = null;

    try {
      if (!cachedClientsList) {
        cachedClientsList = await (typeof api === 'function' ? api('/api/clients') : fetch('/api/clients').then(r => r.json()));
      }
      const clients = Array.isArray(cachedClientsList) ? cachedClientsList : (cachedClientsList.clients || []);
      countBadge.textContent = `${clients.length} clients available`;

      const renderClients = (filterText = '') => {
        const query = filterText.toLowerCase().trim();
        const filtered = clients.filter(c => {
          if (!query) return true;
          const name = (c.name || '').toLowerCase();
          const fileNo = (c.file_no || '').toLowerCase();
          const pan = (c.pan || '').toLowerCase();
          return name.includes(query) || fileNo.includes(query) || pan.includes(query);
        });

        if (filtered.length === 0) {
          resultsContainer.innerHTML = '<div style="padding:14px;text-align:center;color:#64748b;font-size:12px;">No matching clients found.</div>';
          return;
        }

        resultsContainer.innerHTML = filtered.map(c => `
          <div class="vs-ai-client-item ${selectedClient && selectedClient.file_no === c.file_no ? 'selected' : ''}" data-file-no="${escapeHtml(c.file_no)}">
            <div>
              <div style="font-weight:700;color:#0f172a;">${escapeHtml(c.name || 'Unnamed')}</div>
              <div style="font-size:11px;color:#64748b;">File No: <strong>${escapeHtml(c.file_no)}</strong> ${c.pan ? '| PAN: ' + escapeHtml(c.pan) : ''}</div>
            </div>
            <div style="font-size:11px;color:#2563eb;font-weight:600;">Select →</div>
          </div>
        `).join('');

        resultsContainer.querySelectorAll('.vs-ai-client-item').forEach(item => {
          item.onclick = () => {
            const fNo = item.getAttribute('data-file-no');
            selectedClient = clients.find(c => c.file_no === fNo);
            resultsContainer.querySelectorAll('.vs-ai-client-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            confirmBtn.disabled = false;
            confirmBtn.textContent = `Save to ${selectedClient.name.slice(0, 18)}...`;
          };
        });
      };

      renderClients();
      searchInput.oninput = (e) => renderClients(e.target.value);

      confirmBtn.onclick = async () => {
        if (!selectedClient) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving to Vault...';

        try {
          const ext = (fileData.filename ? fileData.filename.slice(fileData.filename.lastIndexOf('.')) : `.${fileType}`).toLowerCase();
          let cleanDoc = (title || fileData.filename || 'VS_AI_Statutory_Document').replace(/[/\\?%*:|"<>]/g, '_').trim();
          cleanDoc = cleanDoc.replace(/\.(docx|xlsx|pdf|txt)+$/i, '');
          const docName = `${cleanDoc}${ext}`;
          const targetFolder = folderSelect.value || 'General';

          const saveResp = await fetch('/api/ai/save-to-client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: fileData.filename,
              client_file_no: selectedClient.file_no,
              document_name: docName,
              folder: targetFolder
            })
          });
          const saveRes = await saveResp.json();
          if (saveRes.ok) {
            modal.remove();
            const msg = `✓ Document saved successfully into ${selectedClient.name}'s vault under ${targetFolder}!`;
            if (typeof showNativeToast === 'function') {
              showNativeToast(msg, 'success', 4000);
            } else {
              alert(msg);
            }
          } else {
            alert('Failed to save to client: ' + (saveRes.error || 'Server error'));
            confirmBtn.disabled = false;
          }
        } catch (err) {
          alert('Error saving to client vault: ' + err.message);
          confirmBtn.disabled = false;
        }
      };

    } catch (e) {
      resultsContainer.innerHTML = `<div style="padding:14px;color:#ef4444;text-align:center;">Could not load clients: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ------------------------------------------------------------
  // INTERACTIVE IN-APP DOCUMENT CANVAS MODAL & LIVE AI ENHANCER
  // ------------------------------------------------------------
  function showDocumentCanvasModal({ title, content, citations, clientName }) {
    const existing = document.getElementById('vs-ai-canvas-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vs-ai-canvas-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10002';

    const safeTitle = escapeHtml(title || 'Document Canvas & Editor');

    modal.innerHTML = `
      <div class="vs-ai-canvas-card glass">
        <!-- Canvas Header & Formatting Toolbar -->
        <div class="vs-ai-canvas-toolbar">
          <div class="vs-ai-canvas-title-group">
            <svg class="i" style="width:20px;height:20px;color:#2563eb;" aria-hidden="true"><use href="#setup"/></svg>
            <input type="text" id="vs-ai-canvas-doc-title" value="${safeTitle}" class="vs-ai-canvas-title-input" title="Click to rename document" />
          </div>

          <div class="vs-ai-canvas-tools-group">
            <!-- Font Family Selector (Google Fonts) -->
            <div class="vs-ai-canvas-tool-item">
              <label for="vs-ai-canvas-font-select" class="vs-ai-tool-label">Font:</label>
              <select id="vs-ai-canvas-font-select" class="vs-ai-canvas-select">
                <option value="'Plus Jakarta Sans', sans-serif" selected>Plus Jakarta Sans</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="'Roboto Slab', serif">Roboto Slab</option>
                <option value="'Merriweather', serif">Merriweather</option>
                <option value="'Montserrat', sans-serif">Montserrat</option>
                <option value="'Playfair Display', serif">Playfair Display</option>
                <option value="'Fira Code', monospace">Fira Code</option>
                <option value="'Source Serif 4', serif">Source Serif 4</option>
              </select>
            </div>

            <!-- Font Size Selector -->
            <div class="vs-ai-canvas-tool-item">
              <select id="vs-ai-canvas-size-select" class="vs-ai-canvas-select" style="width:72px;">
                <option value="13px">13px</option>
                <option value="14px">14px</option>
                <option value="15px" selected>15px</option>
                <option value="16px">16px</option>
                <option value="18px">18px</option>
              </select>
            </div>

            <div class="vs-ai-canvas-divider"></div>

            <!-- Format Buttons -->
            <div class="vs-ai-canvas-btn-group">
              <button type="button" class="vs-ai-canvas-btn" id="canvas-btn-bold" title="Bold (Ctrl+B)"><b>B</b></button>
              <button type="button" class="vs-ai-canvas-btn" id="canvas-btn-italic" title="Italic (Ctrl+I)"><i>I</i></button>
              <button type="button" class="vs-ai-canvas-btn" id="canvas-btn-underline" title="Underline (Ctrl+U)"><u>U</u></button>
              <button type="button" class="vs-ai-canvas-btn" id="canvas-btn-ul" title="Bullet List">• List</button>
            </div>

            <div class="vs-ai-canvas-divider"></div>

            <!-- Ask AI to Enhance Selected Area -->
            <button type="button" class="btn vs-ai-enhance-selection-btn" id="vs-ai-btn-enhance-selection" title="Highlight any section below and click to instruct AI to improve it">
              <svg class="i" style="width:14px;height:14px;color:#2563eb;" aria-hidden="true"><use href="#ai"/></svg>
              <span>✨ Ask AI to Enhance</span>
            </button>

            <div class="vs-ai-canvas-divider"></div>

            <!-- Export to ▾ Dropdown -->
            <div class="vs-ai-export-dropdown-wrap" style="position:relative;display:inline-block;">
              <button type="button" class="btn primary btn-sm btn-canvas-export-toggle" style="gap:5px;">
                <svg class="i" style="width:13px;height:13px;" aria-hidden="true"><use href="#dl"/></svg>
                <span>Export to ▾</span>
              </button>
              <div class="vs-ai-export-menu" id="vs-ai-canvas-export-menu" style="display:none;right:0;left:auto;">
                <button type="button" class="vs-ai-export-item canvas-export-excel">
                  <span class="export-icon">📊</span>
                  <div class="export-text">
                    <div class="export-title">Excel Spreadsheet (.xlsx)</div>
                    <div class="export-desc">Financial models & structured tables</div>
                  </div>
                </button>
                <button type="button" class="vs-ai-export-item canvas-export-word">
                  <span class="export-icon">📄</span>
                  <div class="export-text">
                    <div class="export-title">Word Document (.docx)</div>
                    <div class="export-desc">Executive draft with active typography</div>
                  </div>
                </button>
                <button type="button" class="vs-ai-export-item canvas-export-pdf">
                  <span class="export-icon">📑</span>
                  <div class="export-text">
                    <div class="export-title">Branded PDF (.pdf)</div>
                    <div class="export-desc">In-app preview & 300 DPI layout</div>
                  </div>
                </button>
                <div class="vs-ai-export-divider"></div>
                <button type="button" class="vs-ai-export-item canvas-export-copy">
                  <span class="export-icon">📋</span>
                  <div class="export-text">
                    <div class="export-title">Copy Formatted Text</div>
                  </div>
                </button>
                <button type="button" class="vs-ai-export-item canvas-export-print">
                  <span class="export-icon">🖨️</span>
                  <div class="export-text">
                    <div class="export-title">Print Document</div>
                  </div>
                </button>
              </div>
            </div>

            <button type="button" class="vs-ai-modal-close" id="vs-ai-canvas-btn-close" aria-label="Close Canvas">✕</button>
          </div>
        </div>

        <!-- AI Enhance Floating Tool Popover -->
        <div id="vs-ai-enhance-popover" class="vs-ai-enhance-popover" style="display:none;">
          <div class="vs-ai-enhance-popover-header">
            <span>✨ Instruct VS AI to Enhance / Change Area</span>
            <button type="button" class="vs-ai-enhance-popover-close" id="popover-close">&times;</button>
          </div>
          <div class="vs-ai-enhance-preview-text" id="vs-ai-enhance-selected-preview"></div>
          <div class="vs-ai-enhance-input-wrap">
            <input type="text" id="vs-ai-enhance-instruction" placeholder="e.g., 'Make it more formal', 'Add penalty Section 271', 'Convert to computation table'..." />
            <button type="button" class="btn primary btn-sm" id="vs-ai-btn-apply-enhance">
              <span>Apply Change</span>
            </button>
          </div>
        </div>

        <!-- Editable Document Surface -->
        <div class="vs-ai-canvas-body-container">
          <div id="vs-ai-canvas-editor" contenteditable="true" spellcheck="false" class="vs-ai-canvas-editor"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const editor = modal.querySelector('#vs-ai-canvas-editor');
    const fontSelect = modal.querySelector('#vs-ai-canvas-font-select');
    const sizeSelect = modal.querySelector('#vs-ai-canvas-size-select');
    const docTitleInput = modal.querySelector('#vs-ai-canvas-doc-title');
    const popover = modal.querySelector('#vs-ai-enhance-popover');
    const popoverClose = modal.querySelector('#popover-close');
    const enhancePreview = modal.querySelector('#vs-ai-enhance-selected-preview');
    const instructionInput = modal.querySelector('#vs-ai-enhance-instruction');
    const applyEnhanceBtn = modal.querySelector('#vs-ai-btn-apply-enhance');

    // Populate formatted HTML into canvas editor
    editor.innerHTML = renderMarkdown(content);
    triggerMermaidRender();

    // Close handlers
    modal.querySelector('#vs-ai-canvas-btn-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Font family changer
    fontSelect.onchange = () => {
      editor.style.fontFamily = fontSelect.value;
    };

    // Font size changer
    sizeSelect.onchange = () => {
      editor.style.fontSize = sizeSelect.value;
    };

    // Formatting buttons
    modal.querySelector('#canvas-btn-bold').onclick = () => document.execCommand('bold', false, null);
    modal.querySelector('#canvas-btn-italic').onclick = () => document.execCommand('italic', false, null);
    modal.querySelector('#canvas-btn-underline').onclick = () => document.execCommand('underline', false, null);
    modal.querySelector('#canvas-btn-ul').onclick = () => document.execCommand('insertUnorderedList', false, null);

    // Selection tracking for Ask AI
    let currentSelectionRange = null;

    function updateSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          currentSelectionRange = range.cloneRange();
          return sel.toString().trim();
        }
      }
      return '';
    }

    editor.addEventListener('mouseup', () => {
      const text = updateSelection();
      if (text) {
        enhancePreview.textContent = `"${text.length > 140 ? text.slice(0, 140) + '...' : text}"`;
      }
    });

    editor.addEventListener('keyup', () => {
      updateSelection();
    });

    const enhanceBtn = modal.querySelector('#vs-ai-btn-enhance-selection');
    enhanceBtn.onclick = (e) => {
      e.stopPropagation();
      const selText = updateSelection();
      if (!selText && (!currentSelectionRange || currentSelectionRange.toString().trim() === '')) {
        alert('Please highlight the text or section in the document that you would like AI to enhance or change.');
        return;
      }
      const textToShow = selText || currentSelectionRange.toString().trim();
      enhancePreview.textContent = `"${textToShow.length > 140 ? textToShow.slice(0, 140) + '...' : textToShow}"`;
      popover.style.display = 'block';
      instructionInput.value = '';
      instructionInput.focus();
    };

    popoverClose.onclick = () => {
      popover.style.display = 'none';
    };

    applyEnhanceBtn.onclick = async () => {
      const instr = instructionInput.value.trim();
      if (!instr) {
        alert('Please describe what AI should change or improve.');
        return;
      }
      if (!currentSelectionRange) {
        alert('No section currently selected.');
        return;
      }

      const selectedText = currentSelectionRange.toString();
      applyEnhanceBtn.disabled = true;
      applyEnhanceBtn.innerHTML = '<span>Enhancing...</span>';

      try {
        const resp = await fetch('/api/ai/enhance-selection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selected_text: selectedText,
            instruction: instr,
            full_document: editor.innerText,
            client_name: clientName || ''
          })
        });
        const res = await resp.json();
        if (!res.ok) {
          throw new Error(res.error || 'Failed to enhance section');
        }

        currentSelectionRange.deleteContents();
        const div = document.createElement('div');
        div.innerHTML = renderMarkdown(res.enhanced_text);
        const frag = document.createDocumentFragment();
        while (div.firstChild) {
          frag.appendChild(div.firstChild);
        }
        currentSelectionRange.insertNode(frag);

        popover.style.display = 'none';
        if (typeof showNativeToast === 'function') {
          showNativeToast('✓ Section enhanced successfully with VS AI', 'success', 3000);
        }
      } catch (err) {
        alert('Enhancement error: ' + err.message);
      } finally {
        applyEnhanceBtn.disabled = false;
        applyEnhanceBtn.innerHTML = '<span>Apply Change</span>';
      }
    };

    // Canvas Export Dropdown Toggle
    const exportToggle = modal.querySelector('.btn-canvas-export-toggle');
    const exportMenu = modal.querySelector('#vs-ai-canvas-export-menu');
    exportToggle.onclick = (e) => {
      e.stopPropagation();
      exportMenu.style.display = exportMenu.style.display === 'block' ? 'none' : 'block';
    };

    const getCanvasContent = () => editor.innerText || editor.textContent || '';
    const getCanvasTitle = () => docTitleInput.value.trim() || 'Document';

    modal.querySelector('.canvas-export-excel').onclick = () => {
      exportMenu.style.display = 'none';
      handleExportExcel(getCanvasTitle(), getCanvasContent());
    };

    modal.querySelector('.canvas-export-word').onclick = () => {
      exportMenu.style.display = 'none';
      const chosenFont = fontSelect.options[fontSelect.selectedIndex].text;
      handleExportWord(getCanvasTitle(), getCanvasContent(), citations, chosenFont);
    };

    modal.querySelector('.canvas-export-pdf').onclick = () => {
      exportMenu.style.display = 'none';
      handlePreviewPdf(getCanvasTitle(), getCanvasContent(), citations);
    };

    modal.querySelector('.canvas-export-copy').onclick = () => {
      exportMenu.style.display = 'none';
      navigator.clipboard.writeText(getCanvasContent());
      if (typeof showNativeToast === 'function') {
        showNativeToast('Document text copied to clipboard', 'success', 2000);
      }
    };

    modal.querySelector('.canvas-export-print').onclick = () => {
      exportMenu.style.display = 'none';
      printFormattedContent(getCanvasTitle(), getCanvasContent());
    };
  }

  // ------------------------------------------------------------
  // CHAT HISTORY MANAGEMENT & DATE GROUPING
  // ------------------------------------------------------------
  async function loadConversations() {
    const list = document.querySelector('#vs-ai-history-container');
    if (!list) return;

    try {
      const resp = await fetch('/api/ai/conversations');
      const data = await resp.json();
      allConversationsCache = data.conversations || [];
      renderConversationList(allConversationsCache);

      const hash = (typeof window !== 'undefined' && window.location && window.location.hash) || '';
      if (hash.includes('conv=')) {
        const targetId = hash.split('conv=')[1].split('&')[0];
        if (targetId) {
          loadConversation(targetId);
          return;
        }
      }

      if (!currentConvId) {
        renderWelcomeHero();
      }
    } catch (e) {
      list.innerHTML = `<div style="padding:15px;color:#ef4444;font-size:12px;">Error loading history</div>`;
    }
  }

  function formatHistoryTime(dateVal, groupTitle) {
    if (!dateVal) return '';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      if (groupTitle === 'Today' || groupTitle === 'Yesterday') {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      }
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const day = String(d.getDate()).padStart(2, '0');
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    } catch (_) {
      return '';
    }
  }

  function insertNewChatToSidebar(convId, initialTitle) {
    const list = document.querySelector('#vs-ai-history-container');
    if (!list) return;

    // Deselect any currently active conversation
    list.querySelectorAll('.vs-ai-history-item').forEach(it => it.classList.remove('active', 'on'));

    // Check if an item for this convId already exists
    let existingItem = list.querySelector(`.vs-ai-history-item[data-id="${convId}"]`);
    if (existingItem) {
      existingItem.classList.add('active', 'on');
      const titleSpan = existingItem.querySelector('.vs-ai-item-title');
      if (titleSpan) titleSpan.textContent = initialTitle;
      return;
    }

    const itemEl = document.createElement('div');
    itemEl.className = 'vs-ai-history-item active on';
    itemEl.setAttribute('data-id', convId);
    itemEl.title = initialTitle;
    itemEl.innerHTML = `
      <div class="vs-ai-item-content">
        <div class="vs-ai-item-top" style="display:flex;align-items:center;gap:6px;">
          <span class="vs-ai-item-title" style="flex:1;">${escapeHtml(initialTitle)}</span>
          <div class="vs-ai-item-actions">
            <button type="button" class="vs-ai-item-btn rename" data-id="${convId}" title="Rename conversation" aria-label="Rename conversation">
              <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#edit"/></svg>
            </button>
            <button type="button" class="vs-ai-item-btn delete" data-id="${convId}" title="Delete conversation" aria-label="Delete conversation">
              <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#trash"/></svg>
            </button>
          </div>
        </div>
        <div class="vs-ai-item-time"><small class="muted">Just now</small></div>
      </div>
    `;

    // Bind item click
    itemEl.addEventListener('click', (e) => {
      if (e.target.closest('.vs-ai-item-btn')) return;
      loadConversation(convId);
    });

    // Bind rename
    const renameBtn = itemEl.querySelector('.vs-ai-item-btn.rename');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const conv = allConversationsCache.find(x => x.id === convId);
        promptRenameConversation(convId, conv ? conv.title : initialTitle);
      });
    }

    // Bind delete
    const deleteBtn = itemEl.querySelector('.vs-ai-item-btn.delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const conv = allConversationsCache.find(x => x.id === convId);
        confirmDeleteConversation(convId, conv ? conv.title : initialTitle);
      });
    }

    // Clear "No chats found" message if present
    if (list.innerHTML.includes('No chats found')) {
      list.innerHTML = '';
    }

    let todayGroup = list.querySelector('.vs-ai-history-group-title');
    if (todayGroup && todayGroup.textContent.trim().toLowerCase() === 'today') {
      todayGroup.insertAdjacentElement('afterend', itemEl);
    } else {
      const todayHeader = document.createElement('div');
      todayHeader.className = 'vs-ai-history-group-title';
      todayHeader.textContent = 'Today';
      list.prepend(itemEl);
      list.prepend(todayHeader);
    }

    // Add to allConversationsCache at top
    allConversationsCache.unshift({
      id: convId,
      title: initialTitle,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      msg_count: 1
    });
  }

  function updateSidebarChatTitle(convId, newTitle) {
    if (!convId || !newTitle) return;
    currentConversationTitle = newTitle;
    const itemEl = document.querySelector(`.vs-ai-history-item[data-id="${convId}"]`);
    if (itemEl) {
      itemEl.title = newTitle;
      const titleSpan = itemEl.querySelector('.vs-ai-item-title');
      if (titleSpan && titleSpan.textContent !== newTitle) {
        titleSpan.textContent = newTitle;
        titleSpan.classList.add('vs-ai-title-updated');
        setTimeout(() => titleSpan.classList.remove('vs-ai-title-updated'), 1500);
      }
    }
    const cached = allConversationsCache.find(c => c.id === convId);
    if (cached) cached.title = newTitle;
  }

  function renderConversationList(conversations) {
    const list = document.querySelector('#vs-ai-history-container');
    if (!list) return;

    if (!conversations || conversations.length === 0) {
      list.innerHTML = `<div style="padding:18px 12px;text-align:center;color:var(--vsai-ink-faint);font-size:12px;">No chats found</div>`;
      return;
    }

    const groups = {
      today: [],
      yesterday: [],
      previous7: [],
      older: []
    };

    const now = new Date();
    const todayStr = toLocalDateString(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    conversations.forEach(c => {
      const updatedDate = new Date(c.updated_at || c.created_at || now);
      const cDateStr = toLocalDateString(updatedDate);

      if (cDateStr === todayStr) {
        groups.today.push(c);
      } else if (cDateStr === yesterdayStr) {
        groups.yesterday.push(c);
      } else if (updatedDate >= sevenDaysAgo) {
        groups.previous7.push(c);
      } else {
        groups.older.push(c);
      }
    });

    let html = '';
    const renderGroup = (title, items) => {
      if (!items || items.length === 0) return '';
      return `
        <div class="vs-ai-history-group-title">${title}</div>
        ${items.map(c => {
          const itemTime = formatHistoryTime(c.updated_at || c.created_at, title);
          return `
            <div class="vs-ai-history-item ${c.id === currentConvId ? 'active on' : ''}" data-id="${c.id}" title="${escapeHtml(c.title || 'Chat')}">
              <div class="vs-ai-item-content">
                <div class="vs-ai-item-top" style="display:flex;align-items:center;gap:6px;">
                  <span class="vs-ai-item-title" style="flex:1;">${escapeHtml(c.title || 'Chat')}</span>
                  <div class="vs-ai-item-actions">
                    <button type="button" class="vs-ai-item-btn rename" data-id="${c.id}" title="Rename conversation" aria-label="Rename conversation">
                      <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#edit"/></svg>
                    </button>
                    <button type="button" class="vs-ai-item-btn delete" data-id="${c.id}" title="Delete conversation" aria-label="Delete conversation">
                      <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#trash"/></svg>
                    </button>
                  </div>
                </div>
                <div class="vs-ai-item-time"><small class="muted">${itemTime}</small></div>
              </div>
            </div>
          `;
        }).join('')}
      `;
    };

    html += renderGroup('Today', groups.today);
    html += renderGroup('Yesterday', groups.yesterday);
    html += renderGroup('Previous 7 Days', groups.previous7);
    html += renderGroup('Older', groups.older);

    list.innerHTML = html;

    list.querySelectorAll('.vs-ai-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.vs-ai-item-btn')) return;
        loadConversation(item.getAttribute('data-id'));
      });
    });

    list.querySelectorAll('.vs-ai-item-btn.rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-id');
        const conv = allConversationsCache.find(x => x.id === cid);
        promptRenameConversation(cid, conv ? conv.title : '');
      });
    });

    list.querySelectorAll('.vs-ai-item-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-id');
        const conv = allConversationsCache.find(x => x.id === cid);
        confirmDeleteConversation(cid, conv ? conv.title : '');
      });
    });
  }

  function filterConversations(query) {
    if (!query) {
      renderConversationList(allConversationsCache);
      return;
    }
    const filtered = allConversationsCache.filter(c => {
      const title = (c.title || '').toLowerCase();
      const preview = (c.preview || '').toLowerCase();
      return title.includes(query) || preview.includes(query);
    });
    renderConversationList(filtered);
  }

  async function loadConversation(convId) {
    if (isRequestInFlight) return;
    currentConvId = convId;

    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;
    stream.innerHTML = `<div style="padding:30px;text-align:center;color:var(--vsai-ink-subtle);">Loading conversation...</div>`;

    document.querySelectorAll('.vs-ai-history-item').forEach(it => {
      it.classList.toggle('active', it.getAttribute('data-id') === convId);
    });

    try {
      const resp = await fetch(`/api/ai/conversations/${convId}`);
      const data = await resp.json();
      stream.innerHTML = '';

      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => {
          appendMessage(m.role, m.content, m.meta ? m.meta.citations : null, null, null, false);
        });
        triggerMermaidRender();
      } else {
        renderWelcomeHero();
      }
    } catch (e) {
      stream.innerHTML = `<div style="padding:20px;color:#ef4444;">Failed to load messages</div>`;
    }
  }

  function startNewChat() {
    if (isRequestInFlight) return;
    cancelAutoRetry();
    currentConvId = null;
    document.querySelectorAll('.vs-ai-history-item').forEach(it => it.classList.remove('active', 'on'));
    renderWelcomeHero();
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.focus();
    }
    currentAttachments = [];
    renderAttachmentPreviewBar();
    updateSendButtonState();
    setGenerationMode(null);
  }

  function promptRenameConversation(cid, currentTitle) {
    const newTitle = prompt('Enter new conversation title:', currentTitle || '');
    if (!newTitle || newTitle.trim() === currentTitle) return;

    fetch(`/api/ai/conversations/${cid}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    }).then(r => r.json()).then(res => {
      if (res.ok) {
        loadConversations();
      } else {
        alert('Could not rename conversation: ' + (res.error || 'Server error'));
      }
    }).catch(err => alert('Rename error: ' + err.message));
  }

  function confirmDeleteConversation(cid, title) {
    if (!confirm(`Are you sure you want to delete this chat?\n"${title || 'Untitled'}"`)) return;

    fetch(`/api/ai/conversations/${cid}`, {
      method: 'DELETE'
    }).then(r => r.json()).then(res => {
      if (res.ok) {
        if (currentConvId === cid) {
          startNewChat();
        }
        loadConversations();
      } else {
        alert('Could not delete conversation: ' + (res.error || 'Server error'));
      }
    }).catch(err => alert('Delete error: ' + err.message));
  }

  // ------------------------------------------------------------
  // CLEAN UP SHORT CHATS MODAL
  // ------------------------------------------------------------
  function showCleanChatsModal() {
    const shortChats = allConversationsCache.filter(c => {
      const msgCount = c.msg_count || 0;
      const title = (c.title || '').trim().toLowerCase();
      return msgCount <= 1 || title === 'hi' || title === 'new chat';
    });

    if (shortChats.length === 0) {
      alert('No empty or short chats found to clean up!');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title"><svg class="i" style="width:16px;height:16px;margin-right:6px;" aria-hidden="true"><use href="#trash"/></svg>Clean Up Short Chats</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div style="font-size:13px;color:var(--vsai-ink-muted);margin-bottom:14px;">
          Found <strong>${shortChats.length}</strong> empty or 1-message chats that can be safely removed:
        </div>
        <div style="max-height:220px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px;padding:8px;margin-bottom:16px;background:#f8fafc;">
          ${shortChats.map(c => `
            <div style="padding:6px 10px;font-size:12px;color:#334155;border-bottom:1px solid #e2e8f0;">
              • ${escapeHtml(c.title || 'Untitled')} <span style="color:#94a3b8;font-size:10px;">(${c.msg_count || 0} msgs)</span>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="vs-ai-tool-btn" id="btn-cancel-clean">Cancel</button>
          <button class="vs-ai-btn-primary" id="btn-confirm-clean" style="background:#dc2626;">Delete ${shortChats.length} Chats</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.vs-ai-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-cancel-clean').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#btn-confirm-clean').addEventListener('click', async () => {
      overlay.remove();
      for (const c of shortChats) {
        try {
          await fetch(`/api/ai/conversations/${c.id}`, { method: 'DELETE' });
        } catch (_) {}
      }
      if (shortChats.some(c => c.id === currentConvId)) {
        startNewChat();
      }
      loadConversations();
    });
  }

  // ------------------------------------------------------------
  // ATTACHMENT HANDLING
  // ------------------------------------------------------------
  async function handleFileSelected(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
      try {
        const attObj = await readFileAsAttachment(file);
        currentAttachments.push(attObj);
      } catch (err) {
        console.error('Failed to read file:', file.name, err);
      }
    }

    e.target.value = '';
    renderAttachmentPreviewBar();
    updateSendButtonState();
  }

  function readFileAsAttachment(file) {
    return new Promise((resolve, reject) => {
      const isText = file.type.startsWith('text/') || file.name.endsWith('.csv') || file.name.endsWith('.txt');
      const reader = new FileReader();

      reader.onerror = () => reject(reader.error);

      if (isText) {
        reader.onload = () => {
          resolve({
            name: file.name,
            size: file.size,
            mime_type: file.type || 'text/plain',
            text_data: reader.result
          });
        };
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          const dataUrl = reader.result;
          const base64Idx = dataUrl.indexOf(';base64,');
          const base64 = base64Idx !== -1 ? dataUrl.substring(base64Idx + 8) : '';

          resolve({
            name: file.name,
            size: file.size,
            mime_type: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
            base64_data: base64
          });
        };
        reader.readAsDataURL(file);
      }
    });
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
        <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#clip"/></svg>
        <span style="font-weight:600;" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <span style="opacity:0.75;font-size:10px;">${formatFileSize(att.size)}</span>
        <span class="vs-ai-att-remove" data-idx="${idx}" title="Remove file">&times;</span>
      </div>
    `).join('');

    bar.querySelectorAll('.vs-ai-att-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'));
        if (!isNaN(idx)) {
          currentAttachments.splice(idx, 1);
          renderAttachmentPreviewBar();
          updateSendButtonState();
        }
      });
    });
  }

  // ------------------------------------------------------------
  // AUTO AI RENAME MODAL
  // ------------------------------------------------------------
  function showAutoRenameModal() {
    const existing = document.querySelector('#modal-auto-rename');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.id = 'modal-auto-rename';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card" style="max-width:580px;">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title"><svg class="i" style="width:16px;height:16px;margin-right:6px;" aria-hidden="true"><use href="#edit"/></svg>Auto AI Document Renamer</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div>
          <p style="font-size:13px;color:var(--vsai-ink-muted);margin:0 0 16px;">
            Drop an Indian tax form, ITR-V, GSTR-3B, or Notice PDF to intelligently classify and generate statutory standardized filenames.
          </p>

          <div id="rename-dropzone" style="border:2px dashed #93c5fd;background:#f0f9ff;border-radius:14px;padding:32px 20px;text-align:center;cursor:pointer;transition:all 0.2s ease;">
            <div style="margin-bottom:8px;"><svg class="i" style="width:36px;height:36px;color:#2563eb;" aria-hidden="true"><use href="#upload"/></svg></div>
            <div style="font-size:13.5px;font-weight:700;color:#1e40af;">Click or drag PDF to inspect</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:4px;">Supports ITRs, Challan 280, Form 16/26AS, GST Returns & Notices</div>
            <input type="file" id="rename-file-input" style="display:none;" accept=".pdf,.png,.jpg,.jpeg">
          </div>

          <div id="rename-result-box" style="display:none;margin-top:16px;padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;"></div>
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
          <svg class="i" style="width:14px;height:14px;stroke:var(--pri);"><use href="#ai"/></svg>
          <span>Analyzing document structure & extracting standard name...</span>
        </div>
      `;

      try {
        const resp = await fetch('/api/ai/doc/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: file.name })
        });
        const res = await resp.json();
        if (res.ok) {
          resultBox.innerHTML = `
            <div style="font-size:12px;font-weight:700;color:#1e40af;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#1e40af;"><use href="#check"/></svg>Document Identified!</div>
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
          resultBox.innerHTML = `<div style="color:#ef4444;font-size:13px;display:flex;align-items:center;gap:6px;"><svg class="i" style="width:14px;height:14px;stroke:#ef4444;"><use href="#alert"/></svg>${escapeHtml(res.error || 'Could not rename document')}</div>`;
        }
      } catch (err) {
        resultBox.innerHTML = `<div style="color:#ef4444;font-size:13px;">Error: ${escapeHtml(err.message)}</div>`;
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
          <h3 class="vs-ai-modal-title"><svg class="i" style="width:16px;height:16px;margin-right:6px;" aria-hidden="true"><use href="#folder"/></svg>Statutory Sources & RAG Library</h3>
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
            The following authentic Acts, Rules, and Case Laws in <code>Sources/</code> are indexed into high-precision statutory chunks:
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto;padding-right:4px;">
            ${data.sources.map(s => `
              <div style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:13.5px;font-weight:700;color:#0f172a;">${escapeHtml(s.name)}</div>
                  <div style="font-size:11.5px;color:#64748b;margin-top:2px;">Authority: ${escapeHtml(s.authority || 'Statutory')} | Domain: <strong>${escapeHtml(s.relevant_law || 'General')}</strong></div>
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
  // SETTINGS MODAL
  // ------------------------------------------------------------
  function showSettingsModal() {
    const existing = document.querySelector('#modal-vs-ai-settings');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'vs-ai-modal-overlay';
    overlay.id = 'modal-vs-ai-settings';
    overlay.innerHTML = `
      <div class="vs-ai-modal-card">
        <div class="vs-ai-modal-header">
          <h3 class="vs-ai-modal-title"><svg class="i" style="width:16px;height:16px;margin-right:6px;" aria-hidden="true"><use href="#setup"/></svg>VS AI Engine Configuration</h3>
          <button class="vs-ai-modal-close">&times;</button>
        </div>
        <div>
          <p style="font-size:13px;color:#475569;margin-top:0;">
            Enter your VS AI Cloud API key to enable high-speed statutory reasoning, deep context retrieval, and native document vision.
          </p>

          <div style="padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:12.5px;font-weight:700;color:#166534;">Get a 100% Free API Key</div>
              <div style="font-size:11.5px;color:#15803d;">Free tier includes generous quota with high-speed statutory processing.</div>
            </div>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="padding:7px 12px;background:#16a34a;color:#ffffff;border-radius:8px;font-size:11.5px;font-weight:600;text-decoration:none;white-space:nowrap;box-shadow:0 2px 6px rgba(22,163,74,0.3);">
              Get Free Key &rarr;
            </a>
          </div>

          <div class="vs-ai-form-group">
            <label class="vs-ai-label">VS AI API Key</label>
            <input type="password" class="vs-ai-input" id="cfg-vs-ai-key" placeholder="AIzaSy..." value="">
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Key is stored locally in your private office database.</div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
            <button class="vs-ai-tool-btn" id="btn-cancel-settings">Cancel</button>
            <button class="vs-ai-btn-primary" id="btn-save-vs-ai-key">Save & Connect</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.vs-ai-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-cancel-settings').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#btn-save-vs-ai-key').addEventListener('click', async () => {
      const keyVal = overlay.querySelector('#cfg-vs-ai-key').value.trim();
      if (!keyVal) {
        alert('Please enter a valid API Key.');
        return;
      }
      try {
        const resp = await fetch('/api/ai/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: keyVal, gemini_api_key: keyVal })
        });
        const res = await resp.json();
        if (res.ok) {
          overlay.remove();
          checkVsAiStatus();
        } else {
          alert('Error saving settings: ' + (res.error || 'Failed'));
        }
      } catch (err) {
        alert('Request failed: ' + err.message);
      }
    });
  }

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  function toLocalDateString(d) {
    const date = new Date(d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatTime(d) {
    const date = new Date(d);
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return `${date.getDate()}/${date.getMonth() + 1}`;
    } catch (_) {
      return '';
    }
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInlineFormatting(text) {
    if (!text) return '';
    let str = escapeHtml(text);
    str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');
    str = str.replace(/`([^`]+)`/g, '<code style="background:rgba(241,245,249,0.95);border:1px solid #cbd5e1;color:#0f172a;padding:1px 5px;border-radius:4px;font-size:11.5px;">$1</code>');
    return str;
  }

  function generateSvgChart(config) {
    try {
      const type = (config.type || 'bar').toLowerCase();
      const title = config.title || 'Data Visualization';
      const labels = Array.isArray(config.labels) ? config.labels : [];
      const datasets = Array.isArray(config.datasets) ? config.datasets : [];

      if (labels.length === 0 || datasets.length === 0) {
        return `<div class="vs-ai-chart-card"><div class="vs-ai-chart-title">📊 ${escapeHtml(title)}</div><p style="color:#64748b;font-size:12px;">Chart configuration contains no data series.</p></div>`;
      }

      const palette = [
        ['#2563eb', '#4f46e5'],
        ['#059669', '#10b981'],
        ['#d97706', '#f59e0b'],
        ['#7c3aed', '#a855f7'],
        ['#e11d48', '#f43f5e']
      ];

      const chartId = 'chart_' + Math.random().toString(36).substr(2, 9);
      const width = 640;
      const height = 280;
      const padding = { top: 30, right: 30, bottom: 45, left: 55 };
      const plotW = width - padding.left - padding.right;
      const plotH = height - padding.top - padding.bottom;

      let allValues = [];
      datasets.forEach(ds => {
        if (Array.isArray(ds.data)) {
          ds.data.forEach(v => allValues.push(Number(v) || 0));
        }
      });
      if (allValues.length === 0) allValues = [0];
      const maxVal = Math.max(...allValues, 1);
      const minVal = Math.min(0, ...allValues);
      const range = maxVal - minVal || 1;

      let svgContent = '';
      let legendItems = '';

      if (type === 'pie' || type === 'doughnut') {
        const cx = width / 2;
        const cy = height / 2 + 5;
        const radius = Math.min(plotW, plotH) / 2 - 10;
        const innerRadius = type === 'doughnut' ? radius * 0.58 : 0;
        const dataValues = datasets[0] ? datasets[0].data : [];
        const total = dataValues.reduce((acc, v) => acc + (Number(v) || 0), 0) || 1;

        let startAngle = 0;
        const slices = [];
        dataValues.forEach((val, idx) => {
          const num = Number(val) || 0;
          const sliceAngle = (num / total) * 2 * Math.PI;
          const endAngle = startAngle + sliceAngle;
          const [colorStart, colorEnd] = palette[idx % palette.length];
          const gradId = `${chartId}_grad_${idx}`;

          const x1 = cx + radius * Math.cos(startAngle);
          const y1 = cy + radius * Math.sin(startAngle);
          const x2 = cx + radius * Math.cos(endAngle);
          const y2 = cy + radius * Math.sin(endAngle);

          const ix1 = cx + innerRadius * Math.cos(endAngle);
          const iy1 = cy + innerRadius * Math.sin(endAngle);
          const ix2 = cx + innerRadius * Math.cos(startAngle);
          const iy2 = cy + innerRadius * Math.sin(startAngle);

          const largeArc = sliceAngle > Math.PI ? 1 : 0;
          let pathD = '';
          if (innerRadius > 0) {
            pathD = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
          } else {
            pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          }

          const label = labels[idx] || `Item ${idx + 1}`;
          const pct = ((num / total) * 100).toFixed(1);

          slices.push(`
            <defs>
              <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${colorStart}"/>
                <stop offset="100%" stop-color="${colorEnd}"/>
              </linearGradient>
            </defs>
            <path d="${pathD}" fill="url(#${gradId})" stroke="#ffffff" stroke-width="2.5" class="vs-ai-slice">
              <title>${escapeHtml(label)}: ${num} (${pct}%)</title>
            </path>
          `);

          legendItems += `
            <span class="vs-ai-legend-pill">
              <span class="vs-ai-legend-color" style="background:linear-gradient(135deg, ${colorStart}, ${colorEnd});"></span>
              <span>${escapeHtml(label)}: <strong>${num}</strong> (${pct}%)</span>
            </span>
          `;
          startAngle = endAngle;
        });

        svgContent = `
          <g>${slices.join('')}</g>
          ${type === 'doughnut' ? `
            <circle cx="${cx}" cy="${cy}" r="${innerRadius - 2}" fill="#ffffff"/>
            <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="11" font-weight="700" fill="#64748b">TOTAL</text>
            <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="14" font-weight="800" fill="#0f172a">${total.toLocaleString()}</text>
          ` : ''}
        `;
      } else if (type === 'line') {
        const gridLines = [];
        const yTicks = 4;
        for (let i = 0; i <= yTicks; i++) {
          const yVal = minVal + (range / yTicks) * i;
          const yPos = padding.top + plotH - (i / yTicks) * plotH;
          gridLines.push(`
            <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#e2e8f0" stroke-dasharray="3,3" stroke-width="1"/>
            <text x="${padding.left - 8}" y="${yPos + 4}" font-size="10.5" text-anchor="end" fill="#64748b" font-family="Plus Jakarta Sans, sans-serif">${Math.round(yVal).toLocaleString()}</text>
          `);
        }

        const lineElements = [];
        datasets.forEach((ds, dsIdx) => {
          const [colStart, colEnd] = palette[dsIdx % palette.length];
          const gradId = `${chartId}_line_area_${dsIdx}`;
          const pts = [];
          const data = ds.data || [];

          data.forEach((val, i) => {
            const x = padding.left + (plotW / (labels.length > 1 ? labels.length - 1 : 1)) * i;
            const y = padding.top + plotH - (((Number(val) || 0) - minVal) / range) * plotH;
            pts.push({ x, y, val });
          });

          if (pts.length > 0) {
            let pathD = `M ${pts[0].x} ${pts[0].y}`;
            for (let i = 1; i < pts.length; i++) {
              const prev = pts[i - 1];
              const cur = pts[i];
              const cpX1 = prev.x + (cur.x - prev.x) / 3;
              const cpX2 = cur.x - (cur.x - prev.x) / 3;
              pathD += ` C ${cpX1} ${prev.y}, ${cpX2} ${cur.y}, ${cur.x} ${cur.y}`;
            }

            const areaD = `${pathD} L ${pts[pts.length - 1].x} ${padding.top + plotH} L ${pts[0].x} ${padding.top + plotH} Z`;

            lineElements.push(`
              <defs>
                <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="${colStart}" stop-opacity="0.2"/>
                  <stop offset="100%" stop-color="${colEnd}" stop-opacity="0.0"/>
                </linearGradient>
              </defs>
              <path d="${areaD}" fill="url(#${gradId})"/>
              <path d="${pathD}" fill="none" stroke="${colStart}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
              ${pts.map((p, pIdx) => `
                <circle cx="${p.x}" cy="${p.y}" r="4" fill="#ffffff" stroke="${colStart}" stroke-width="2.5">
                  <title>${escapeHtml(labels[pIdx] || '')}: ${p.val}</title>
                </circle>
              `).join('')}
            `);

            legendItems += `
              <span class="vs-ai-legend-pill">
                <span class="vs-ai-legend-color" style="background:${colStart};"></span>
                <span>${escapeHtml(ds.label || `Series ${dsIdx + 1}`)}</span>
              </span>
            `;
          }
        });

        const xLabels = labels.map((l, i) => {
          const x = padding.left + (plotW / (labels.length > 1 ? labels.length - 1 : 1)) * i;
          return `<text x="${x}" y="${height - padding.bottom + 18}" font-size="10.5" text-anchor="middle" fill="#64748b" font-family="Plus Jakarta Sans, sans-serif">${escapeHtml(l)}</text>`;
        }).join('');

        svgContent = `${gridLines.join('')}${xLabels}${lineElements.join('')}`;
      } else {
        // Bar Chart
        const gridLines = [];
        const yTicks = 4;
        for (let i = 0; i <= yTicks; i++) {
          const yVal = minVal + (range / yTicks) * i;
          const yPos = padding.top + plotH - (i / yTicks) * plotH;
          gridLines.push(`
            <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#e2e8f0" stroke-dasharray="3,3" stroke-width="1"/>
            <text x="${padding.left - 8}" y="${yPos + 4}" font-size="10.5" text-anchor="end" fill="#64748b" font-family="Plus Jakarta Sans, sans-serif">${Math.round(yVal).toLocaleString()}</text>
          `);
        }

        const barGroupW = plotW / labels.length;
        const barPad = Math.max(6, barGroupW * 0.18);
        const availableW = barGroupW - barPad * 2;
        const singleBarW = Math.max(6, availableW / datasets.length);

        const bars = [];
        labels.forEach((label, lIdx) => {
          const groupX = padding.left + lIdx * barGroupW + barPad;
          datasets.forEach((ds, dsIdx) => {
            const val = Number((ds.data && ds.data[lIdx]) || 0);
            const barH = ((val - minVal) / range) * plotH;
            const barY = padding.top + plotH - barH;
            const barX = groupX + dsIdx * singleBarW;
            const [cStart, cEnd] = palette[dsIdx % palette.length];
            const gradId = `${chartId}_bar_${dsIdx}`;

            bars.push(`
              <defs>
                <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="${cStart}"/>
                  <stop offset="100%" stop-color="${cEnd}"/>
                </linearGradient>
              </defs>
              <rect x="${barX}" y="${barY}" width="${Math.max(4, singleBarW - 2)}" height="${Math.max(2, barH)}" rx="3.5" fill="url(#${gradId})">
                <title>${escapeHtml(label)} - ${escapeHtml(ds.label || '')}: ${val}</title>
              </rect>
              <text x="${barX + (singleBarW - 2) / 2}" y="${barY - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#475569">${val}</text>
            `);
          });

          bars.push(`
            <text x="${groupX + availableW / 2}" y="${height - padding.bottom + 18}" font-size="10.5" text-anchor="middle" fill="#64748b" font-family="Plus Jakarta Sans, sans-serif">${escapeHtml(label)}</text>
          `);
        });

        datasets.forEach((ds, dsIdx) => {
          const [cStart] = palette[dsIdx % palette.length];
          legendItems += `
            <span class="vs-ai-legend-pill">
              <span class="vs-ai-legend-color" style="background:${cStart};"></span>
              <span>${escapeHtml(ds.label || `Series ${dsIdx + 1}`)}</span>
            </span>
          `;
        });

        svgContent = `${gridLines.join('')}${bars.join('')}`;
      }

      const typeBadge = type === 'line' ? '📈 Line' : (type === 'pie' || type === 'doughnut' ? '🍩 Pie' : '📊 Bar');

      return `
        <div class="vs-ai-chart-card" id="${chartId}">
          <div class="vs-ai-chart-header">
            <div class="vs-ai-chart-title">
              <span>${escapeHtml(title)}</span>
              <span class="vs-ai-chart-badge">${typeBadge}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="vs-ai-table-btn btn-copy-chart-data" data-config="${escapeHtml(JSON.stringify(config))}">
                <svg class="i" style="width:12px;height:12px;"><use href="#copy"/></svg> Copy Data
              </button>
            </div>
          </div>
          <div class="vs-ai-chart-svg-wrap">
            <svg class="vs-ai-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
              ${svgContent}
            </svg>
          </div>
          ${legendItems ? `<div class="vs-ai-chart-legend">${legendItems}</div>` : ''}
        </div>
      `;
    } catch (e) {
      return `<div class="vs-ai-chart-card"><p style="color:#ef4444;font-size:12px;">Chart render error: ${escapeHtml(e.message)}</p></div>`;
    }
  }

  function renderMarkdownTable(tableLines) {
    if (!tableLines || tableLines.length < 2) return '';
    const cleanLines = tableLines.map(l => l.trim()).filter(l => l.startsWith('|') && l.endsWith('|'));
    if (cleanLines.length < 2) return '';

    const headerRow = cleanLines[0].slice(1, -1).split('|').map(c => c.trim());
    const alignRow = cleanLines[1].slice(1, -1).split('|').map(c => c.trim());
    const alignments = alignRow.map(col => {
      if (col.startsWith(':') && col.endsWith(':')) return 'center';
      if (col.endsWith(':')) return 'right';
      return 'left';
    });

    const dataRows = [];
    const isNumCol = new Array(headerRow.length).fill(true);

    for (let i = 2; i < cleanLines.length; i++) {
      const cells = cleanLines[i].slice(1, -1).split('|').map(c => c.trim());
      if (cells.length > 0) {
        dataRows.push(cells);
        cells.forEach((val, cIdx) => {
          if (cIdx < isNumCol.length) {
            const cleanVal = val.replace(/[₹$,% ]/g, '');
            if (cleanVal === '' || isNaN(Number(cleanVal))) {
              isNumCol[cIdx] = false;
            }
          }
        });
      }
    }

    const tableId = 'tbl_' + Math.random().toString(36).substr(2, 9);
    const hasNumericData = isNumCol.slice(1).some(Boolean);

    const tsvData = [
      headerRow.join('\t'),
      ...dataRows.map(r => r.join('\t'))
    ].join('\n');

    return `
      <div class="vs-ai-table-wrap" id="${tableId}">
        <div class="vs-ai-table-toolbar">
          <span>📋 Data Table (${dataRows.length} rows)</span>
          <div class="vs-ai-table-toolbar-actions">
            ${hasNumericData ? `
              <button type="button" class="vs-ai-table-btn vs-ai-btn-toggle-chart" data-table-id="${tableId}">
                <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#ai"/></svg> View as Graph
              </button>
            ` : ''}
            <button type="button" class="vs-ai-table-btn vs-ai-btn-copy-table" data-tsv="${escapeHtml(tsvData)}">
              <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#copy"/></svg> Copy Table
            </button>
          </div>
        </div>
        <div class="vs-ai-table-scroll">
          <table class="vs-ai-table">
            <thead>
              <tr>
                ${headerRow.map((h, idx) => {
                  const align = alignments[idx] || (isNumCol[idx] ? 'right' : 'left');
                  const cls = isNumCol[idx] ? 'num' : '';
                  return `<th class="${cls}" style="text-align:${align};">${renderInlineFormatting(h)}</th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              ${dataRows.map(row => `
                <tr>
                  ${headerRow.map((_, idx) => {
                    const val = row[idx] || '';
                    const align = alignments[idx] || (isNumCol[idx] ? 'right' : 'left');
                    const cls = isNumCol[idx] ? 'num' : '';
                    return `<td class="${cls}" style="text-align:${align};">${renderInlineFormatting(val)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="vs-ai-table-chart-container" style="display:none;padding:14px;background:#ffffff;border-top:1px solid #e2e8f0;"></div>
      </div>
    `;
  }

  function renderMarkdown(md) {
    if (!md) return '';

    const placeholders = [];
    let text = md;

    // 1. Extract and process Code Blocks (including ```chart, ```mermaid)
    text = text.replace(/```([a-zA-Z0-9_\-]*)\s*([\s\S]*?)```/g, (match, lang, code) => {
      const cleanLang = (lang || '').trim().toLowerCase();
      const cleanCode = code.trim();

      if (cleanLang === 'chart' || cleanLang === 'graph' || cleanLang === 'chartjs' || (cleanLang === 'json' && cleanCode.includes('"type"') && cleanCode.includes('"datasets"'))) {
        try {
          const config = JSON.parse(cleanCode);
          const chartHtml = generateSvgChart(config);
          const idx = placeholders.length;
          placeholders.push(chartHtml);
          return `\n\n@@@VSAI_PH_${idx}@@@\n\n`;
        } catch (err) {
          const fallback = `<div class="vs-ai-chart-card"><div class="vs-ai-chart-title">📊 Visualizing Chart...</div><pre style="font-size:11px;color:#64748b;">${escapeHtml(cleanCode)}</pre></div>`;
          const idx = placeholders.length;
          placeholders.push(fallback);
          return `\n\n@@@VSAI_PH_${idx}@@@\n\n`;
        }
      }

      if (cleanLang === 'mermaid') {
        const uniqueId = 'mermaid-' + Math.random().toString(36).substring(2, 9);
        const diagramHtml = `
          <div class="vs-ai-mermaid-wrap">
            <div class="vs-ai-mermaid-header">
              <span class="vs-ai-mermaid-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                Statutory / Process Flowchart
              </span>
              <button type="button" class="btn-copy-mermaid" data-code="${escapeHtml(cleanCode)}" title="Copy Diagram Code">Copy Code</button>
            </div>
            <div class="mermaid" id="${uniqueId}">${escapeHtml(cleanCode)}</div>
          </div>
        `;
        const idx = placeholders.length;
        placeholders.push(diagramHtml);
        return `\n\n@@@VSAI_PH_${idx}@@@\n\n`;
      }

      const codeHtml = `<pre style="background:#0f172a;color:#e2e8f0;padding:12px 16px;border-radius:10px;overflow-x:auto;font-size:12.5px;margin:10px 0;position:relative;"><code>${escapeHtml(cleanCode)}</code></pre>`;
      const idx = placeholders.length;
      placeholders.push(codeHtml);
      return `\n\n@@@VSAI_PH_${idx}@@@\n\n`;
    });

    // 2. Extract and process Tables
    const lines = text.split('\n');
    const processedLines = [];
    let inTable = false;
    let tableBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');

      if (isTableRow) {
        inTable = true;
        tableBuffer.push(line);
      } else {
        if (inTable) {
          if (tableBuffer.length >= 2) {
            const tableHtml = renderMarkdownTable(tableBuffer);
            const idx = placeholders.length;
            placeholders.push(tableHtml);
            processedLines.push(`@@@VSAI_PH_${idx}@@@`);
          } else {
            processedLines.push(...tableBuffer);
          }
          tableBuffer = [];
          inTable = false;
        }
        processedLines.push(line);
      }
    }

    if (inTable && tableBuffer.length >= 2) {
      const tableHtml = renderMarkdownTable(tableBuffer);
      const idx = placeholders.length;
      placeholders.push(tableHtml);
      processedLines.push(`@@@VSAI_PH_${idx}@@@`);
    } else if (inTable) {
      processedLines.push(...tableBuffer);
    }

    text = processedLines.join('\n');

    // 3. Process Standard Markdown Elements
    // Escape HTML first
    let html = escapeHtml(text);

    // Replace raw horizontal rules (***, ---, ___ or * * *) with clean real HTML divider
    html = html.replace(/^[ \t]*(\*{3,}|-{3,}|_{3,}|\*\s+\*\s+\*)[ \t]*$/gm, '<hr class="vs-ai-divider"/>');
    // Also catch and render any escaped <hr> tags
    html = html.replace(/&lt;hr(?:\s+class="[^"]*")?\s*\/?&gt;/gi, '<hr class="vs-ai-divider"/>');

    // Headings - support h1 through h6 (Fixes raw #### and ##### completely!)
    html = html.replace(/^###### (.*$)/gim, '<h6 class="vs-ai-h6">$1</h6>');
    html = html.replace(/^##### (.*$)/gim, '<h5 class="vs-ai-h5">$1</h5>');
    html = html.replace(/^#### (.*$)/gim, '<h4 class="vs-ai-h4">$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3 class="vs-ai-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="vs-ai-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="vs-ai-h1">$1</h1>');

    // Bold-italic ***text***, bold **text**, italic *text*
    html = html.replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/gim, '<em>$1</em>');
    // Remove any leftover stray asterisks
    html = html.replace(/\*{2,}/g, '');

    // Blockquotes
    html = html.replace(/^\&gt; (.*$)/gim, '<blockquote style="margin:10px 0;padding:8px 14px;border-left:3px solid #3b82f6;background:rgba(239,246,255,0.7);border-radius:0 8px 8px 0;color:#1e3a8a;">$1</blockquote>');

    // Lists - Group contiguous items cleanly
    html = html.replace(/^[ \t]*[\-\*•] (.*$)/gim, '<li class="vs-ai-bullet-item">$1</li>');
    html = html.replace(/((?:<li class="vs-ai-bullet-item">.*?<\/li>(?:\n|<br\/>)?)+)/gim, '<ul class="vs-ai-list">$1</ul>');

    html = html.replace(/^[ \t]*(\d+)\. (.*$)/gim, '<li class="vs-ai-num-item" value="$1">$2</li>');
    html = html.replace(/((?:<li class="vs-ai-num-item"[^>]*>.*?<\/li>(?:\n|<br\/>)?)+)/gim, '<ol class="vs-ai-list">$1</ol>');

    // Inline code
    html = html.replace(/`([^`]+)`/gim, '<code class="vs-ai-inline-code">$1</code>');

    // Clean line breaks (<br/>) - Smooth transitions without raw broken lines
    html = html.replace(/\n{3,}/g, '\n\n');
    html = html.replace(/<\/h[1-6]>\n+/gi, (m) => m.replace(/\n+/g, ''));
    html = html.replace(/<\/(?:ul|ol|blockquote|div)>\n+/gi, (m) => m.replace(/\n+/g, ''));
    html = html.replace(/<hr[^>]*>\n+/gi, '<hr class="vs-ai-divider"/>');
    html = html.replace(/\n+<(?:h[1-6]|ul|ol|blockquote|hr|div)/gi, (m) => m.replace(/^\n+/, ''));
    html = html.replace(/\n\n/g, '<br/><br/>');
    html = html.replace(/\n/g, '<br/>');

    // 4. Restore Placeholders
    placeholders.forEach((ph, idx) => {
      html = html.replace(`@@@VSAI_PH_${idx}@@@`, ph);
      html = html.replace(`&lt;!--CHART_PLACEHOLDER_${idx}--&gt;`, ph);
    });

    return html;
  }

  // Global event delegation for interactive table & chart actions
  document.addEventListener('click', (e) => {
    // Copy Table TSV for Excel/Word
    const copyTableBtn = e.target.closest('.vs-ai-btn-copy-table');
    if (copyTableBtn) {
      e.preventDefault();
      const tsv = copyTableBtn.getAttribute('data-tsv');
      if (tsv) {
        navigator.clipboard.writeText(tsv).then(() => {
          const original = copyTableBtn.innerHTML;
          copyTableBtn.innerHTML = '<svg class="i" style="width:12px;height:12px;"><use href="#check"/></svg> Copied!';
          setTimeout(() => { copyTableBtn.innerHTML = original; }, 2000);
        });
      }
      return;
    }

    // Toggle Chart from Table
    const toggleChartBtn = e.target.closest('.vs-ai-btn-toggle-chart');
    if (toggleChartBtn) {
      e.preventDefault();
      const tableId = toggleChartBtn.getAttribute('data-table-id');
      const tableWrap = document.getElementById(tableId);
      if (tableWrap) {
        const chartContainer = tableWrap.querySelector('.vs-ai-table-chart-container');
        if (chartContainer) {
          if (chartContainer.style.display === 'none' || !chartContainer.style.display) {
            const ths = Array.from(tableWrap.querySelectorAll('thead th')).map(th => th.textContent.trim());
            const rows = Array.from(tableWrap.querySelectorAll('tbody tr')).map(tr => 
              Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
            );

            if (ths.length >= 2 && rows.length > 0) {
              const labels = rows.map(r => r[0]);
              const datasets = [];
              for (let col = 1; col < ths.length; col++) {
                const colData = rows.map(r => {
                  const raw = (r[col] || '0').replace(/[₹$,% ]/g, '');
                  return Number(raw) || 0;
                });
                if (colData.some(v => v !== 0)) {
                  datasets.push({ label: ths[col], data: colData });
                }
              }

              if (datasets.length > 0) {
                const chartConfig = {
                  type: 'bar',
                  title: `${ths[0]} Breakdown`,
                  labels: labels,
                  datasets: datasets
                };
                chartContainer.innerHTML = generateSvgChart(chartConfig);
                chartContainer.style.display = 'block';
                toggleChartBtn.innerHTML = '<svg class="i" style="width:12px;height:12px;"><use href="#close"/></svg> Hide Graph';
              }
            }
          } else {
            chartContainer.style.display = 'none';
            toggleChartBtn.innerHTML = '<svg class="i" style="width:12px;height:12px;"><use href="#ai"/></svg> View as Graph';
          }
        }
      }
      return;
    }

    // Copy Chart Data
    const copyChartBtn = e.target.closest('.btn-copy-chart-data');
    if (copyChartBtn) {
      e.preventDefault();
      const rawConfig = copyChartBtn.getAttribute('data-config');
      if (rawConfig) {
        navigator.clipboard.writeText(rawConfig).then(() => {
          const orig = copyChartBtn.innerHTML;
          copyChartBtn.innerHTML = '<svg class="i" style="width:12px;height:12px;"><use href="#check"/></svg> Copied!';
          setTimeout(() => { copyChartBtn.innerHTML = orig; }, 2000);
        });
      }
      return;
    }

    // Copy Mermaid Diagram Code
    const copyMermaidBtn = e.target.closest('.btn-copy-mermaid');
    if (copyMermaidBtn) {
      e.preventDefault();
      const code = copyMermaidBtn.getAttribute('data-code');
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          const orig = copyMermaidBtn.innerHTML;
          copyMermaidBtn.innerHTML = 'Copied!';
          setTimeout(() => { copyMermaidBtn.innerHTML = orig; }, 2000);
        });
      }
      return;
    }
  });

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
