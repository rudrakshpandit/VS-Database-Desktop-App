/**
 * VS AI — Frontend Module (CA & Tax Practice Copilot)
 * Professional Legal-Tech Glassmorphic UI/UX Suite
 * Powered by VS AI Engine + Statutory RAG + PDF Studio Engine
 */
(function () {
  'use strict';

  let currentConvId = null;
  let currentConversationTitle = null;
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
  let pendingClarificationSubmission = null;

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
      </div>
    `;
  }

  function extractExecutiveChatSummary(content, cleanHeading, formatLabel) {
    if (content) {
      const stripped = content
        .replace(/```[\s\S]*?```/gi, '')
        .replace(/^\*\*Artifact Generated\*\*:.*$/gim, '')
        .trim();
      const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean);
      const summaryLines = [];
      for (const l of lines) {
        if (l.startsWith('#') || l.startsWith('|') || l.startsWith('```')) {
          if (summaryLines.length > 0) break;
          continue;
        }
        if (/^(?:[-*]|\d+\.)\s+/.test(l) && summaryLines.length > 0) break;
        summaryLines.push(l);
        if (summaryLines.join(' ').length >= 160 || summaryLines.length >= 2) break;
      }
      if (summaryLines.length > 0) {
        return summaryLines.join(' ');
      }
    }
    return `Your requested ${formatLabel || 'document'} "${cleanHeading}" has been generated with full statutory analysis and structured formatting. Use the artifact card below to download or save it to a client.`;
  }

  function extractCleanDocTitle(content, fallbackTitle) {
    if (content) {
      const stripped = content.replace(/```[\s\S]*?```/gi, '');
      const lines = stripped.split('\n');
      for (let i = 0; i < Math.min(lines.length, 25); i++) {
        const l = lines[i].trim();
        if (l.startsWith('#')) {
          let clean = l.replace(/^[#\s*]+/, '').replace(/[*_`]/g, '').trim();
          clean = clean.replace(/^(?:sheet\s*\d*\s*[:\-–—]\s*|\d+\.\s*)/i, '').replace(/[:\-–—\\/]+$/, '').trim();
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
      if (low.includes('excel') || low.includes('ex cel') || low.includes('exel') || low.includes('spreadsheet') || low.includes('xlsx')) {
        return 'Excel Spreadsheet Workbook';
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

    // Do not render a document artifact card on a clarification-question turn
    const hasQuestionBlock = Boolean(
      /```question[\s\S]*?```/i.test(content || '') ||
      row.querySelector('.vs-ai-question-box') ||
      row.querySelector('.vs-ai-interactive-question-box')
    );

    const pLow = (title || lastSentPrompt || '').toLowerCase();
    const convTitleLow = (currentConversationTitle || '').toLowerCase();
    const combinedContextLow = `${pLow} ${convTitleLow}`;
    const contentHeadLow = (content || '').slice(0, 1600).toLowerCase();
    const contentFullLow = (content || '').toLowerCase();
    const hasActiveMode = Boolean(activeGenerationMode);
    const hasReportVerb = /\b(generate|prepare|create|draft|export|download|save|make|build|compile)\b/i.test(combinedContextLow);
    const explicitGsheet = activeGenerationMode === 'gsheet' || /\b(google\s+sheet|gsheet)\b/i.test(combinedContextLow);
    const explicitGdoc = activeGenerationMode === 'docs' || /\b(google\s+doc|gdoc)\b/i.test(combinedContextLow);
    const contentWantsExcel = /\b(excel\s+(?:workbook|spreadsheet|file)|\.xlsx\b|##\s+sheet\s*\d*\s*:)/i.test(contentFullLow);
    const contentWantsWord = /\b(\.docx\b.*\/api\/ai\/artifacts\/|word\s+document\s+has\s+been)/i.test(contentFullLow);
    const contentWantsPdf = /\b(\.pdf\b.*\/api\/ai\/artifacts\/)/i.test(contentFullLow);
    const explicitPdf = activeGenerationMode === 'pdf' || contentWantsPdf ||
      /\b(export\s+(?:to\s+)?pdf|generate\s+(?:a\s+|an\s+)?pdf|download\s+pdf|create\s+(?:a\s+|an\s+)?pdf|save\s+(?:as\s+)?pdf|as\s+a\s+pdf|in\s+pdf|and\s+pdf|pdf\s+report|\.pdf)\b/i.test(combinedContextLow) ||
      (hasReportVerb && /\bpdf\b/i.test(combinedContextLow));
    const explicitExcel = activeGenerationMode === 'excel' || explicitGsheet || contentWantsExcel ||
      /\b(export\s+(?:to\s+)?excel|generate\s+(?:a\s+|an\s+)?excel|download\s+excel|create\s+(?:a\s+|an\s+)?(?:proper\s+)?ex\s*cel|save\s+(?:as\s+)?excel|in\s+excel|and\s+excel|excel\s+(?:sheet|file|workbook|report|register|schedule|reconciliation)|ex\s*cel\s+file|exel|spreadsheet|\.xlsx|\.xls)\b/i.test(combinedContextLow) ||
      (hasReportVerb && /\b(excel|ex\s*cel|exel|xlsx|spreadsheet|workbook)\b/i.test(combinedContextLow));
    const explicitWord = activeGenerationMode === 'word' || explicitGdoc || contentWantsWord ||
      /\b(export\s+(?:to\s+)?word|generate\s+(?:a\s+|an\s+)?word|download\s+word|create\s+(?:a\s+|an\s+)?word|save\s+(?:as\s+)?word|in\s+word|and\s+word|word\s+(?:file|doc|document|report|reply)|\.docx|\.doc)\b/i.test(combinedContextLow) ||
      (hasReportVerb && /\b(word|docx)\b/i.test(combinedContextLow));
    const isFormalNoticeReplyOrDraft = (content || '').length > 320 && (
      /\b(reply\s+to\s+(?:form\s+|show\s+cause\s+|income\s+tax\s+|gst\s+|statutory\s+)?notice|show\s+cause\s+notice\s+reply|draft\s+(?:a\s+|an\s+|me\s+a\s+|the\s+)?reply|before\s+the\s+(?:assessing|proper|adjudicating)\s+officer|ground-wise\s+reply|submission\s+on\s+merits|drc-01|asmt-10|section\s+148|section\s+143)\b/i.test(`${combinedContextLow} ${contentHeadLow}`)
    );
    const wantsFile = !hasQuestionBlock && (hasActiveMode || explicitPdf || explicitExcel || explicitWord || isFormalNoticeReplyOrDraft);

    if (wantsFile) {
      const requestedFormats = [];
      if (explicitGsheet) requestedFormats.push('gsheet');
      else if (explicitExcel) requestedFormats.push('excel');
      if (explicitGdoc) requestedFormats.push('docs');
      else if (explicitWord) requestedFormats.push('word');
      if (explicitPdf) requestedFormats.push('pdf');
      if (requestedFormats.length === 0) {
        if (activeGenerationMode) requestedFormats.push(activeGenerationMode);
        else requestedFormats.push('pdf');
      }

      const asstBody = row.querySelector('.vs-ai-asst-body');
      let summaryRendered = false;
      let insertAfterEl = asstBody;

      requestedFormats.forEach((formatKey) => {
        if (row.querySelector(`.vs-ai-direct-file-card[data-format-key="${formatKey}"]`)) return;

        let fileType = 'pdf';
        let fileExt = 'pdf';
        let fileIcon = '📑';
        let badgeClass = 'pdf';
        let badgeLabel = 'PDF · 300 DPI';
        let typeDesc = 'Statutory PDF Document';

        if (formatKey === 'gsheet') {
          fileType = 'xlsx';
          fileExt = 'xlsx';
          fileIcon = '📗';
          badgeClass = 'xlsx';
          badgeLabel = 'Google Sheets · .xlsx';
          typeDesc = 'Google Sheets Workbook';
        } else if (formatKey === 'excel') {
          fileType = 'xlsx';
          fileExt = 'xlsx';
          fileIcon = '📊';
          badgeClass = 'xlsx';
          badgeLabel = 'Excel · .xlsx';
          typeDesc = 'Financial Spreadsheet Workbook';
        } else if (formatKey === 'docs') {
          fileType = 'docx';
          fileExt = 'docx';
          fileIcon = '📘';
          badgeClass = 'docx';
          badgeLabel = 'Google Docs · .docx';
          typeDesc = 'Google Docs Document';
        } else if (formatKey === 'word') {
          fileType = 'docx';
          fileExt = 'docx';
          fileIcon = '📄';
          badgeClass = 'docx';
          badgeLabel = 'Word · .docx';
          typeDesc = 'Executive Word Document';
        }

        let baseSlug = cleanHeading.replace(/(\.(docx|xlsx|pdf|txt|csv))+$/gi, '').trim();
        baseSlug = baseSlug.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'VS_AI_Document';
        const safeFilename = `${baseSlug}.${fileExt}`;

        const card = document.createElement('div');
        card.className = 'vs-ai-direct-file-card';
        card.setAttribute('data-format-key', formatKey);
        card.innerHTML = `
          <div class="vs-ai-file-icon-box ${badgeClass}">${fileIcon}</div>
          <div class="vs-ai-file-meta-col">
            <div class="vs-ai-file-meta-name" title="${escapeHtml(safeFilename)}">${escapeHtml(safeFilename)}</div>
            <div class="vs-ai-file-meta-sub">
              <span class="vs-ai-file-badge ${badgeClass}">${badgeLabel}</span>
              <span class="vs-ai-file-status-text">${typeDesc}</span>
            </div>
          </div>
          <div class="vs-ai-file-actions-row">
            <button type="button" class="btn primary btn-sm btn-card-download" title="Download Generated File">
              <svg class="i" style="width:12px;height:12px;margin-right:3px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Download</span>
            </button>
            <button type="button" class="btn secondary btn-sm btn-card-save-client" title="Save to Client Folder">
              <svg class="i" style="width:12px;height:12px;margin-right:3px;" aria-hidden="true"><use href="#folder"/></svg>
              <span>Save to Client</span>
            </button>
            <button type="button" class="btn secondary btn-sm btn-card-preview" title="Preview Document & Select Area to Revise with VS AI">
              <svg class="i" style="width:12px;height:12px;margin-right:3px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Preview</span>
            </button>
            <a class="btn secondary btn-sm btn-card-open-cloud" href="#" target="_blank" rel="noopener noreferrer" style="display:none;text-decoration:none;" title="Open in Google Drive">
              <span>☁️ Open in Drive</span>
            </a>
          </div>
        `;

        if (asstBody) {
          if (!summaryRendered) {
            const execSummary = extractExecutiveChatSummary(content, cleanHeading, typeDesc);
            asstBody.innerHTML = `
              <div class="vs-ai-file-ready-note">
                ${renderInlineFormatting(escapeHtml(execSummary))}
              </div>
            `;
            summaryRendered = true;
          }
          insertAfterEl.parentNode.insertBefore(card, insertAfterEl.nextSibling);
          insertAfterEl = card;
        } else {
          const footerRow = row.querySelector('.vs-ai-asst-footer-row');
          if (footerRow) {
            footerRow.parentNode.insertBefore(card, footerRow);
          } else {
            actionsRow.parentNode.insertBefore(card, actionsRow);
          }
        }

        let currentCardArtifact = null;
        let currentCardContent = content;

        const resolveArtifactExport = async () => {
          if (currentCardArtifact && currentCardArtifact.ok) return currentCardArtifact;
          let exported = null;
          if (formatKey === 'gsheet') exported = await ensureGsheetExported(cleanHeading, currentCardContent);
          else if (formatKey === 'excel') exported = await ensureXlsxExported(cleanHeading, currentCardContent);
          else if (formatKey === 'docs') exported = await ensureGdocExported(cleanHeading, currentCardContent, citations);
          else if (formatKey === 'word') exported = await ensureDocxExported(cleanHeading, currentCardContent, citations);
          else exported = await ensurePdfExported(cleanHeading, currentCardContent, citations);
          if (exported && exported.ok) {
            currentCardArtifact = exported;
          }
          return exported;
        };

        // Pre-compile the artifact immediately so Download / Save to Client / Preview has artifact_id ready
        resolveArtifactExport().then((d) => {
          if (!d || !d.ok) return;
          card.dataset.artifactId = d.artifact_id || '';
          card.dataset.serverFilename = d.filename || safeFilename;
          const statusEl = card.querySelector('.vs-ai-file-status-text');
          if (statusEl && d.size_kb) {
            const orientBadge = d.orientation ? ` · ${d.orientation.charAt(0).toUpperCase() + d.orientation.slice(1)}` : '';
            statusEl.textContent = `${typeDesc}${orientBadge} · ${d.size_kb} KB`;
          }
          if (d.cloud_connected && d.web_view_link) {
            const cloudBtn = card.querySelector('.btn-card-open-cloud');
            if (cloudBtn) {
              cloudBtn.href = d.web_view_link;
              cloudBtn.style.display = 'inline-flex';
            }
          } else if (d.cloud_status_message && (formatKey === 'gsheet' || formatKey === 'docs') && asstBody) {
            const noteEl = document.createElement('div');
            noteEl.style.cssText = 'margin-top:6px;font-size:11.5px;color:#64748b;';
            noteEl.textContent = d.cloud_status_message;
            asstBody.appendChild(noteEl);
          }
        }).catch((err) => {
          console.warn('[VS-AI Artifact Pre-Export]', err);
        });

        // Download Button -> Resolves artifact and opens native Save As dialog (with blob fallback)
        card.querySelector('.btn-card-download').onclick = async () => {
          try {
            const d = await resolveArtifactExport();
            await executeSaveToWindowsLocation(d, cleanHeading, fileType);
          } catch (err) {
            alert('Download failed: ' + err.message);
          }
        };

        // Save to Client Button -> Asks confirmation then redirects to Saves tab prefilled
        const saveClientBtn = card.querySelector('.btn-card-save-client');
        if (saveClientBtn) {
          saveClientBtn.onclick = async () => {
            try {
              const d = await resolveArtifactExport();
              showSaveClientConfirmationModal(d, cleanHeading, fileType);
            } catch (err) {
              alert('Save to Client failed: ' + err.message);
            }
          };
        }

        // Preview Button -> Opens Interactive Document Preview & Select-Area-to-Revise modal
        const previewBtn = card.querySelector('.btn-card-preview');
        if (previewBtn) {
          previewBtn.onclick = async () => {
            try {
              const d = await resolveArtifactExport();
              await openInteractiveDocumentPreviewModal(d, cleanHeading, fileType, currentCardContent, citations, row, card, (revisedArtifact, revisedContent) => {
                currentCardArtifact = revisedArtifact;
                currentCardContent = revisedContent || currentCardContent;
              });
            } catch (err) {
              alert('Preview failed: ' + err.message);
            }
          };
        }
      });
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

    // Interactive Question Box handlers — Sequential Slide-Wise Clarification UX (Workstream 8)
    const questionBoxes = row.querySelectorAll('.vs-ai-interactive-question-box');
    questionBoxes.forEach(qBox => {
      const sections = Array.from(qBox.querySelectorAll('.vs-ai-question-section'));
      const totalSlides = sections.length;
      const prevBtn = qBox.querySelector('.vs-ai-btn-prev-question');
      const nextBtn = qBox.querySelector('.vs-ai-btn-next-question');
      const submitBtn = qBox.querySelector('.vs-ai-btn-submit-choice');
      const progressBadge = qBox.querySelector('.vs-ai-question-progress-badge');
      const stepDots = Array.from(qBox.querySelectorAll('.vs-ai-question-step-dot'));
      const selections = new Map(); // qidx -> { qid, title, val, isOther, otherText }
      let activeSlideIdx = 0;
      let isSubmitted = false;

      function isSlideValid(idx) {
        const sel = selections.get(idx);
        if (!sel || !sel.val) return false;
        if (sel.isOther && (!sel.otherText || !sel.otherText.trim())) return false;
        return true;
      }

      function areAllSlidesValid() {
        if (totalSlides === 0) return false;
        for (let i = 0; i < totalSlides; i++) {
          if (!isSlideValid(i)) return false;
        }
        return true;
      }

      function syncSlideUI(focusSlideControl = false) {
        qBox.setAttribute('data-active-slide', String(activeSlideIdx));
        if (progressBadge) {
          progressBadge.textContent = `Question ${activeSlideIdx + 1} of ${totalSlides}`;
        }
        stepDots.forEach((dot, idx) => {
          dot.classList.toggle('active', idx === activeSlideIdx);
          dot.classList.toggle('answered', isSlideValid(idx));
        });

        sections.forEach((sec, idx) => {
          const isCurrent = idx === activeSlideIdx;
          sec.style.display = isCurrent ? '' : 'none';
          sec.setAttribute('aria-hidden', isCurrent ? 'false' : 'true');

          if (isCurrent) {
            const saved = selections.get(idx);
            const optBtns = sec.querySelectorAll('.vs-ai-question-opt-btn:not(.vs-ai-opt-other)');
            const otherBtn = sec.querySelector('.vs-ai-opt-other');
            const otherInput = sec.querySelector('.vs-ai-question-other-input');
            const specifyLabel = sec.querySelector('.vs-ai-other-specify-label');

            sec.querySelectorAll('.vs-ai-question-opt-btn').forEach(b => {
              b.classList.remove('selected');
              b.setAttribute('aria-checked', 'false');
            });

            if (saved) {
              if (saved.isOther) {
                if (otherBtn) {
                  otherBtn.classList.add('selected');
                  otherBtn.setAttribute('aria-checked', 'true');
                }
                if (otherInput) {
                  otherInput.style.display = 'block';
                  if (otherInput.value !== saved.otherText) {
                    otherInput.value = saved.otherText || '';
                  }
                }
                if (specifyLabel) specifyLabel.style.display = 'block';
              } else {
                if (otherInput) otherInput.style.display = 'none';
                if (specifyLabel) specifyLabel.style.display = 'none';
                const matchedBtn = Array.from(optBtns).find(b => b.getAttribute('data-val') === saved.val);
                if (matchedBtn) {
                  matchedBtn.classList.add('selected');
                  matchedBtn.setAttribute('aria-checked', 'true');
                }
              }
            } else {
              if (otherInput) otherInput.style.display = 'none';
              if (specifyLabel) specifyLabel.style.display = 'none';
            }
          }
        });

        const isLastSlide = activeSlideIdx >= totalSlides - 1;
        if (prevBtn) {
          if (totalSlides <= 1) {
            prevBtn.style.display = 'none';
            prevBtn.disabled = true;
          } else {
            prevBtn.style.display = '';
            prevBtn.style.visibility = activeSlideIdx === 0 ? 'hidden' : 'visible';
            prevBtn.disabled = activeSlideIdx === 0 || isSubmitted;
          }
        }
        if (nextBtn) {
          nextBtn.style.display = isLastSlide ? 'none' : '';
          nextBtn.disabled = isLastSlide || !isSlideValid(activeSlideIdx) || isSubmitted;
        }
        if (submitBtn) {
          submitBtn.style.display = isLastSlide ? '' : 'none';
          submitBtn.disabled = !isLastSlide || !areAllSlidesValid() || isSubmitted;
        }

        if (focusSlideControl && sections[activeSlideIdx]) {
          const activeSec = sections[activeSlideIdx];
          const saved = selections.get(activeSlideIdx);
          if (saved && saved.isOther) {
            const otherInp = activeSec.querySelector('.vs-ai-question-other-input');
            if (otherInp) {
              otherInp.focus();
              return;
            }
          }
          const targetBtn = activeSec.querySelector('.vs-ai-question-opt-btn.selected') ||
                            activeSec.querySelector('.vs-ai-question-opt-btn');
          if (targetBtn) targetBtn.focus();
        }
      }

      sections.forEach((sec, idx) => {
        const qid = sec.getAttribute('data-qid') || `q_${idx + 1}`;
        const qTitle = sec.querySelector('.vs-ai-question-title span')?.textContent || `Question ${idx + 1}`;
        const optBtns = sec.querySelectorAll('.vs-ai-question-opt-btn:not(.vs-ai-opt-other)');
        const otherBtn = sec.querySelector('.vs-ai-opt-other');
        const otherInput = sec.querySelector('.vs-ai-question-other-input');
        const specifyLabel = sec.querySelector('.vs-ai-other-specify-label');

        function updateSecSelection(val, isOther = false) {
          if (isSubmitted) return;
          const prevSaved = selections.get(idx);
          const preservedOtherText = otherInput ? otherInput.value : (prevSaved?.otherText || '');

          sec.querySelectorAll('.vs-ai-question-opt-btn').forEach(b => {
            b.classList.remove('selected');
            b.setAttribute('aria-checked', 'false');
          });

          if (isOther) {
            if (otherBtn) {
              otherBtn.classList.add('selected');
              otherBtn.setAttribute('aria-checked', 'true');
            }
            if (otherInput) {
              otherInput.style.display = 'block';
              if (specifyLabel) specifyLabel.style.display = 'block';
              otherInput.focus();
            }
            selections.set(idx, { qid, title: qTitle, val: '__other__', isOther: true, otherText: preservedOtherText });
          } else {
            if (otherInput) otherInput.style.display = 'none';
            if (specifyLabel) specifyLabel.style.display = 'none';
            const btn = Array.from(optBtns).find(b => b.getAttribute('data-val') === val);
            if (btn) {
              btn.classList.add('selected');
              btn.setAttribute('aria-checked', 'true');
            }
            selections.set(idx, { qid, title: qTitle, val: val, isOther: false, otherText: preservedOtherText });
          }
          syncSlideUI(false);
        }

        optBtns.forEach(btn => {
          btn.onclick = () => updateSecSelection(btn.getAttribute('data-val'), false);
        });

        if (otherBtn) {
          otherBtn.onclick = () => updateSecSelection('__other__', true);
        }

        if (otherInput) {
          otherInput.oninput = () => {
            if (isSubmitted) return;
            const current = selections.get(idx) || { qid, title: qTitle, val: '__other__', isOther: true };
            current.val = '__other__';
            current.isOther = true;
            current.otherText = otherInput.value;
            selections.set(idx, current);
            syncSlideUI(false);
          };
          otherInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (activeSlideIdx < totalSlides - 1) {
                if (nextBtn && !nextBtn.disabled) nextBtn.click();
              } else {
                if (submitBtn && !submitBtn.disabled) submitBtn.click();
              }
            }
          };
        }
      });

      if (prevBtn) {
        prevBtn.onclick = () => {
          if (isSubmitted || activeSlideIdx <= 0) return;
          activeSlideIdx -= 1;
          syncSlideUI(true);
        };
      }

      if (nextBtn) {
        nextBtn.onclick = () => {
          if (isSubmitted || activeSlideIdx >= totalSlides - 1) return;
          if (!isSlideValid(activeSlideIdx)) return;
          activeSlideIdx += 1;
          syncSlideUI(true);
        };
      }

      stepDots.forEach((dot, dotIdx) => {
        dot.onclick = () => {
          if (isSubmitted) return;
          // Allow jumping back to any previous slide, or forward if intervening slides are valid
          if (dotIdx < activeSlideIdx) {
            activeSlideIdx = dotIdx;
            syncSlideUI(true);
          } else if (dotIdx > activeSlideIdx) {
            let canAdvance = true;
            for (let i = 0; i < dotIdx; i++) {
              if (!isSlideValid(i)) {
                canAdvance = false;
                break;
              }
            }
            if (canAdvance) {
              activeSlideIdx = dotIdx;
              syncSlideUI(true);
            }
          }
        };
      });

      const clarifUploadBtn = qBox.querySelector('.vs-ai-btn-clarif-upload');
      const clarifAttachedList = qBox.querySelector('.vs-ai-clarif-attached-list');

      function syncClarifAttachments() {
        if (!clarifAttachedList) return;
        if (!currentAttachments || currentAttachments.length === 0) {
          clarifAttachedList.innerHTML = '';
          clarifAttachedList.style.display = 'none';
          return;
        }
        clarifAttachedList.style.display = 'flex';
        clarifAttachedList.innerHTML = currentAttachments.map((att, aIdx) => `
          <span class="vs-ai-att-pill vs-ai-clarif-att-pill">
            <svg class="i" style="width:11px;height:11px;" aria-hidden="true"><use href="#clip"/></svg>
            <span style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
            <span style="opacity:0.75;font-size:10px;">${formatFileSize(att.size)}</span>
            <button type="button" class="vs-ai-clarif-att-remove" data-att-idx="${aIdx}" title="Remove file" style="border:none;background:transparent;cursor:pointer;color:#64748b;font-weight:700;padding:0 2px;">&times;</button>
          </span>
        `).join('');

        clarifAttachedList.querySelectorAll('.vs-ai-clarif-att-remove').forEach(rmBtn => {
          rmBtn.onclick = (ev) => {
            ev.stopPropagation();
            if (isSubmitted) return;
            const rmIdx = parseInt(rmBtn.getAttribute('data-att-idx') || '-1', 10);
            if (!isNaN(rmIdx) && rmIdx >= 0 && rmIdx < currentAttachments.length) {
              currentAttachments.splice(rmIdx, 1);
              renderAttachmentPreviewBar();
              updateSendButtonState();
              syncClarifAttachments();
            }
          };
        });

        // If current slide asks for supporting documents or reference format and has no selection yet, auto-select the Upload option
        const activeSec = sections[activeSlideIdx];
        if (activeSec && !isSlideValid(activeSlideIdx)) {
          const qid = (activeSec.getAttribute('data-qid') || '').toLowerCase();
          if (qid.includes('document') || qid.includes('format') || qid.includes('upload')) {
            const uploadOptBtn = Array.from(activeSec.querySelectorAll('.vs-ai-question-opt-btn:not(.vs-ai-opt-other)')).find(b =>
              /upload|attach|reference|preferred/i.test(b.getAttribute('data-val') || '')
            );
            if (uploadOptBtn) {
              uploadOptBtn.click();
            }
          }
        }
      }

      if (clarifUploadBtn) {
        clarifUploadBtn.onclick = () => {
          if (isSubmitted) return;
          const fileInput = document.querySelector('#vs-ai-file-input');
          if (fileInput) {
            fileInput.click();
          }
        };
      }

      qBox._syncClarifAttachments = syncClarifAttachments;

      if (submitBtn) {
        submitBtn.onclick = () => {
          if (isSubmitted || !areAllSlidesValid()) return;
          const answers = [];
          const structuredPayload = [];
          sections.forEach((sec, idx) => {
            const sel = selections.get(idx);
            if (!sel) return;
            const customTrimmed = (sel.otherText || '').trim();
            const finalVal = sel.isOther ? `Any other answer: ${customTrimmed}` : sel.val;
            answers.push(finalVal);
            structuredPayload.push({
              index: idx + 1,
              id: sel.qid,
              question_id: sel.qid,
              question: sel.title,
              answer: sel.isOther ? customTrimmed : sel.val,
              is_custom: Boolean(sel.isOther),
              custom_text: customTrimmed
            });
          });
          if (answers.length === 0) return;

          isSubmitted = true;
          qBox.setAttribute('data-submitted', 'true');
          qBox.dataset.submittedAnswers = JSON.stringify(structuredPayload);

          const unlockDeck = () => {
            isSubmitted = false;
            qBox.removeAttribute('data-submitted');
            qBox.querySelectorAll('button, input').forEach(el => el.disabled = false);
            submitBtn.innerHTML = `<span>Submit Answers</span>`;
            submitBtn.style.background = '';
            submitBtn.style.borderColor = '';
            syncSlideUI(false);
          };

          pendingClarificationSubmission = {
            answers: structuredPayload,
            unlockDeck: unlockDeck
          };

          const combinedMessage = answers.length === 1
            ? answers[0]
            : answers.map((ans, i) => `${i + 1}. ${ans}`).join('\n');

          qBox.querySelectorAll('button, input').forEach(el => el.disabled = true);
          submitBtn.innerHTML = `<span>✓ Submitted</span>`;
          submitBtn.style.background = '#16a34a';
          submitBtn.style.borderColor = '#16a34a';

          const promptInp = document.querySelector('#vs-ai-prompt-input');
          if (promptInp) {
            promptInp.value = combinedMessage;
            const sendBtn = document.querySelector('#vs-ai-btn-send');
            if (sendBtn) {
              sendBtn.disabled = false;
              sendBtn.click();
            }
          }
        };
      }

      syncClarifAttachments();
      syncSlideUI(false);
    });
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

    const clarifSubmission = pendingClarificationSubmission;
    pendingClarificationSubmission = null;

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

    let thinkingMsg = 'VS AI is analyzing statutory provisions & legal clauses...';
    const pLow = (promptText || '').toLowerCase();
    let isDocMode = Boolean(
      !clarifSubmission && (
        activeGenerationMode ||
        pLow.includes('pdf') ||
        pLow.includes('excel') ||
        pLow.includes('spreadsheet') ||
        pLow.includes('word') ||
        pLow.includes('docx') ||
        pLow.includes('sample 25 transactions') ||
        pLow.includes('create a sample') ||
        pLow.includes('final accounts') ||
        pLow.includes('balance sheet') ||
        pLow.includes('trial bal') ||
        pLow.includes('journal') ||
        pLow.includes('ledgers')
      )
    );

    if (activeGenerationMode === 'pdf' || pLow.includes('pdf')) thinkingMsg = 'VS AI is compiling statutory PDF document & citations...';
    else if (activeGenerationMode === 'excel' || activeGenerationMode === 'gsheet' || pLow.includes('excel') || pLow.includes('sheet')) thinkingMsg = 'VS AI is generating financial spreadsheet & calculations...';
    else if (activeGenerationMode === 'word' || activeGenerationMode === 'docs' || pLow.includes('word') || pLow.includes('doc')) thinkingMsg = 'VS AI is drafting executive legal document & clauses...';
    else if (pLow.includes('balance sheet') || pLow.includes('p&l') || pLow.includes('financial')) thinkingMsg = 'VS AI is compiling Schedule III financial statements & calculations...';

    // Directly create Assistant Row so loading is IMMEDIATELY visible without delay or flicker
    const asstRow = document.createElement('div');
    asstRow.className = 'msg vs-ai-message-row assistant vs-ai-message-fade-in';
    asstRow.innerHTML = `
      <div class="av">VS</div>
      <div class="bub vs-ai-bubble-assistant">
        <div class="vs-ai-asst-body">
          <div class="vs-ai-thinking-card">
            <div class="vs-ai-thinking-sparkle">✨</div>
            <div class="vs-ai-thinking-content">
              <span class="vs-ai-thinking-label">${escapeHtml(thinkingMsg)}</span>
              <div class="typing"><i></i><i></i><i></i></div>
              <small class="vs-ai-thinking-subtext" style="color:#64748b;font-size:11px;margin-top:2px;">Analyzing request & generating response...</small>
            </div>
          </div>
        </div>
        <div class="src vs-ai-asst-footer-row" style="display:none;">
          <span class="chip vs-ai-sources-pill">
            <svg class="i" style="width:13px;height:13px;" aria-hidden="true"><use href="#folder"/></svg>
            <span class="sources-pill-label">Internet</span>
          </span>
        </div>
        ${renderAssistantActionsHtml()}
      </div>
    `;

    // If retrying, replace the error card in place
    if (existingErrorRow && existingErrorRow.parentNode) {
      existingErrorRow.parentNode.replaceChild(asstRow, existingErrorRow);
    } else if (stream) {
      stream.appendChild(asstRow);
      stream.scrollTop = stream.scrollHeight;
    }

    isRequestInFlight = true;
    currentAbortController = new AbortController();
    console.log(`[VS-AI-STREAM] ${Date.now()} controller-created`, currentAbortController);
    updateSendButtonState();

    const bodyEl = asstRow.querySelector('.vs-ai-asst-body');
    const sourcesLabel = asstRow.querySelector('.sources-pill-label');
    const sourcesFooter = asstRow.querySelector('.vs-ai-asst-footer-row');
    const actionsRow = asstRow.querySelector('.vs-ai-msg-actions');
    if (actionsRow) actionsRow.style.display = 'none';

    let accumulatedText = '';
    let currentCitations = [];
    let rafId = null;
    let isDirty = false;
    let lastRenderTime = 0;
    const RENDER_INTERVAL_MS = 45; // ~22fps maximum during active streaming

    let receivedTokenCount = 0;
    let renderCount = 0;

    const docQuotes = [
      "Generating Document Structure & Accounting Schema...",
      "Compiling Transaction Entries & Ledgers...",
      "Calculating Balances & Verification Totals...",
      "Applying Executive Typography & Table Styling...",
      "Finalizing High-Resolution Document Export..."
    ];
    let quoteIdx = 0;
    let quoteInterval = null;

    if (isDocMode && bodyEl) {
      bodyEl.innerHTML = `
        <div class="vs-ai-generating-box">
          <div class="vs-ai-generating-spinner"></div>
          <div class="vs-ai-generating-content">
            <div class="vs-ai-generating-title">Compiling Professional Document...</div>
            <div class="vs-ai-generating-quote" id="vs-ai-quote-text">${docQuotes[0]}</div>
            <div class="vs-ai-generating-bar"><div class="vs-ai-generating-bar-inner"></div></div>
          </div>
        </div>
      `;
      quoteInterval = setInterval(() => {
        quoteIdx = (quoteIdx + 1) % docQuotes.length;
        const qEl = asstRow.querySelector('#vs-ai-quote-text');
        if (qEl) {
          qEl.style.opacity = '0';
          setTimeout(() => {
            qEl.textContent = docQuotes[quoteIdx];
            qEl.style.opacity = '1';
          }, 200);
        }
      }, 2600);
    }

    console.log(`[VS-AI-STREAM] initial state: convId=${currentConvId}, isDocMode=${isDocMode}, bodyElExists=${Boolean(bodyEl)}`);

    function scheduleFrameRender() {
      if (rafId) return;
      rafId = requestAnimationFrame((now) => {
        rafId = null;
        if (!isDirty || !bodyEl) return;
        if (now - lastRenderTime >= RENDER_INTERVAL_MS) {
          lastRenderTime = now;
          isDirty = false;
          renderCount++;
          if (!isDocMode) {
            bodyEl.innerHTML = renderMarkdown(accumulatedText) + '<span class="vs-ai-type-cursor">▌</span>';
          }
          const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          if (distanceToBottom < 220) stream.scrollTop = stream.scrollHeight;
        } else {
          scheduleFrameRender();
        }
      });
    }

    function flushFrameRender() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      isDirty = false;
      if (quoteInterval) {
        clearInterval(quoteInterval);
        quoteInterval = null;
      }
      if (bodyEl) {
        bodyEl.innerHTML = renderMarkdown(accumulatedText);
        const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
        if (distanceToBottom < 220) stream.scrollTop = stream.scrollHeight;
      }
    }

    function updateCitationsPill(cList) {
      if (!sourcesLabel) return;
      if (!cList || cList.length === 0) {
        sourcesLabel.textContent = 'Internet';
        if (sourcesFooter) sourcesFooter.style.display = 'flex';
        return;
      }
      const secList = cList.map(c => c.section || 'Statute').filter(Boolean);
      const text = secList.length > 0 ? secList.slice(0, 2).join(', ') : 'Internet';
      sourcesLabel.textContent = text;
      if (sourcesFooter) sourcesFooter.style.display = 'flex';
    }

    function finalizeAssistantActions() {
      if (!asstRow) return;
      attachAssistantActionHandlers(asstRow, promptText || 'Statutory Advisory Brief', accumulatedText, currentCitations);
      triggerMermaidRender();
    }

    try {
      console.log(`[VS-AI-STREAM] ${Date.now()} request-start`);
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
          generation_mode: activeGenerationMode,
          clarification_answers: clarifSubmission ? clarifSubmission.answers : undefined
        })
      });

      console.log(`[VS-AI-STREAM] ${Date.now()} response: status=${resp.status}`);

      if (!resp.ok) {
        let errData = {};
        try { errData = await resp.json(); } catch(e) {}
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      currentStreamReader = reader;
      console.log(`[VS-AI-STREAM] ${Date.now()} reader-created`);
      const decoder = new TextDecoder();
      let buffer = '';
      let streamFinished = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(`[VS-AI-STREAM] ${Date.now()} reader done=true`);
          break;
        }

        console.log(`[VS-AI-STREAM] ${Date.now()} chunk-received length=${value ? value.length : 0}`);
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
              try { ev = JSON.parse(jsonStr); } catch(e) {
                console.error(`[VS-AI-STREAM] JSON parse error:`, e, jsonStr);
                continue;
              }
              console.log(`[VS-AI-STREAM] ${Date.now()} event: type=${ev.type}`);

              if (ev.type === 'start') {
                if (ev.conversation_id) currentConvId = ev.conversation_id;
                if (ev.auto_title) {
                  updateSidebarChatTitle(currentConvId, ev.auto_title);
                }
              } else if (ev.type === 'meta') {
                currentCitations = ev.citations || [];
                updateCitationsPill(currentCitations);
              } else if (ev.type === 'token') {
                receivedTokenCount++;
                accumulatedText += ev.delta || '';
                if (isDocMode && accumulatedText.includes('```question')) {
                  isDocMode = false;
                  if (quoteInterval) {
                    clearInterval(quoteInterval);
                    quoteInterval = null;
                  }
                }
                console.log(`[VS-AI-STREAM] token receivedTokenCount=${receivedTokenCount}, renderCount=${renderCount}, accumulatedLength=${accumulatedText.length}`);
                isDirty = true;
                scheduleFrameRender();
              } else if (ev.type === 'phase') {
                console.log(`[VS-AI-STREAM] ${Date.now()} phase:`, ev.phase, ev.message);
                const subtext = asstRow ? asstRow.querySelector('.vs-ai-thinking-subtext') : null;
                if (subtext) {
                  subtext.textContent = ev.message || `Phase ${ev.phase}: Continuing document generation...`;
                }
              } else if (ev.type === 'done') {
                console.log(`[VS-AI-STREAM] ${Date.now()} done: message_id=${ev.message_id}`);
                flushFrameRender();
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
                console.log(`[VS-AI-STREAM] ${Date.now()} server error event:`, ev.error);
                flushFrameRender();
                if (clarifSubmission && typeof clarifSubmission.unlockDeck === 'function') {
                  clarifSubmission.unlockDeck();
                }
                retryAttempts++;
                renderErrorCard(ev.error || 'Failed to generate response.', promptText, attachmentsToSend, asstRow);
                if (ev.error && ev.error.toLowerCase().includes('key')) {
                  showSettingsModal();
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
        console.log(`[VS-AI-STREAM] ${Date.now()} stream loop exited without streamFinished`);
        flushFrameRender();
        finalizeAssistantActions();
      }

    } catch (err) {
      console.error(`[VS-AI-STREAM] ${Date.now()} error:`, err);
      flushFrameRender();
      if (clarifSubmission && typeof clarifSubmission.unlockDeck === 'function') {
        clarifSubmission.unlockDeck();
      }
      if (err.name === 'AbortError') {
        if (asstRow && bodyEl) {
          bodyEl.innerHTML = renderMarkdown(accumulatedText) + '\n\n*(Generation stopped by user)*';
          const actionsRow = asstRow.querySelector('.vs-ai-msg-actions');
          if (actionsRow) actionsRow.style.display = 'flex';
        }
      } else {
        retryAttempts++;
        renderErrorCard('VS AI servers are experiencing peak demand across model pools. Please retry.', promptText, attachmentsToSend, asstRow);
      }
    } finally {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
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
  function renderErrorCard(errorMsg, originalPrompt, originalAtts, targetRow = null) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    const canAutoRetry = retryAttempts < MAX_AUTO_RETRIES;
    const backoffSeconds = Math.min(30, Math.max(2, Math.pow(2, retryAttempts) * 3));

    // Collapse any previous consecutive error cards
    const existingErrors = stream.querySelectorAll('.vs-ai-error-card');
    existingErrors.forEach(card => {
      const r = card.closest('.vs-ai-message-row');
      if (r && r !== targetRow) r.remove();
    });

    const row = targetRow || document.createElement('div');
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
        <div class="bub vs-ai-bubble-user">
          ${attHtml}
          <div>${escapeHtml(content)}</div>
          <small>${formatTime(new Date())}</small>
        </div>
        <div class="av">R</div>
      `;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
    } else {
      let sourcesText = 'Internet';
      if (citations && citations.length > 0) {
        const secList = citations.map(c => c.section || 'Statute').filter(Boolean);
        sourcesText = secList.length > 0 ? secList.slice(0, 2).join(', ') : 'Internet';
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

      if (isNewResponse) {
        streamTypewriter(bodyEl, content, () => {
          attachAssistantActionHandlers(row, promptTitle || 'Statutory Advisory Brief', content, citations);
          const distanceToBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          if (distanceToBottom < 200) stream.scrollTop = stream.scrollHeight;
        });
      } else {
        bodyEl.innerHTML = renderMarkdown(content);
        attachAssistantActionHandlers(row, promptTitle || 'Statutory Advisory Brief', content, citations);
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
  const docxExportCache = new Map();
  const xlsxExportCache = new Map();
  const gdocExportCache = new Map();
  const gsheetExportCache = new Map();

  function downloadDirectFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 250);
    if (typeof showNativeToast === 'function') {
      showNativeToast(`Downloading ${filename || 'file'}...`, 'success', 2500);
    }
  }

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
        citations: citations || [],
        conversation_id: currentConvId || null
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate PDF');
    }
    pdfExportCache.set(cacheKey, data);
    return data;
  }

  async function ensureDocxExported(title, content, citations, fontName = 'Calibri') {
    const cacheKey = (title || '') + '::' + (content || '').slice(0, 150);
    if (docxExportCache.has(cacheKey)) {
      return docxExportCache.get(cacheKey);
    }
    const resp = await fetch('/api/ai/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Statutory Legal Opinion & Advisory',
        content: content || '',
        citations: citations || [],
        font_name: fontName,
        conversation_id: currentConvId || null
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate Word document');
    }
    docxExportCache.set(cacheKey, data);
    return data;
  }

  async function ensureXlsxExported(title, content) {
    const cacheKey = (title || '') + '::' + (content || '').slice(0, 150);
    if (xlsxExportCache.has(cacheKey)) {
      return xlsxExportCache.get(cacheKey);
    }
    const resp = await fetch('/api/ai/export-xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Statutory Statement & Computations',
        content: content || '',
        conversation_id: currentConvId || null
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate Excel spreadsheet');
    }
    xlsxExportCache.set(cacheKey, data);
    return data;
  }

  async function ensureGdocExported(title, content, citations, fontName = 'Calibri') {
    const cacheKey = (title || '') + '::' + (content || '').slice(0, 150);
    if (gdocExportCache.has(cacheKey)) {
      return gdocExportCache.get(cacheKey);
    }
    const resp = await fetch('/api/ai/export-gdoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Statutory Legal Opinion & Advisory',
        content: content || '',
        citations: citations || [],
        font_name: fontName,
        conversation_id: currentConvId || null
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate Google Docs artifact');
    }
    gdocExportCache.set(cacheKey, data);
    return data;
  }

  async function ensureGsheetExported(title, content) {
    const cacheKey = (title || '') + '::' + (content || '').slice(0, 150);
    if (gsheetExportCache.has(cacheKey)) {
      return gsheetExportCache.get(cacheKey);
    }
    const resp = await fetch('/api/ai/export-gsheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Statutory Statement & Computations',
        content: content || '',
        conversation_id: currentConvId || null
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to generate Google Sheets artifact');
    }
    gsheetExportCache.set(cacheKey, data);
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

  async function handlePreviewDocx(title, content, citations) {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Microsoft Word (.docx) Preview...', 'info', 2000);
      }
      const data = await ensureDocxExported(title, content, citations);
      let previewData = null;
      if (data.artifact_id) {
        try {
          const pResp = await fetch(`/api/ai/artifacts/${data.artifact_id}/preview`);
          const pJson = await pResp.json();
          if (pJson.ok && pJson.preview) previewData = pJson.preview;
        } catch (pe) {
          console.warn('Artifact preview fetch error:', pe);
        }
      }
      showInAppDocxPreview(data, title, content, previewData);
    } catch (err) {
      alert('Word preview error: ' + err.message);
    }
  }

  async function handlePreviewExcel(title, content) {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Microsoft Excel (.xlsx) Preview...', 'info', 2000);
      }
      const data = await ensureXlsxExported(title, content);
      let previewData = null;
      if (data.artifact_id) {
        try {
          const pResp = await fetch(`/api/ai/artifacts/${data.artifact_id}/preview`);
          const pJson = await pResp.json();
          if (pJson.ok && pJson.preview) previewData = pJson.preview;
        } catch (pe) {
          console.warn('Artifact preview fetch error:', pe);
        }
      }
      showInAppXlsxPreview(data, title, content, previewData);
    } catch (err) {
      alert('Excel preview error: ' + err.message);
    }
  }

  async function handleExportWord(title, content, citations, fontName = 'Plus Jakarta Sans') {
    try {
      if (typeof showNativeToast === 'function') {
        showNativeToast('Generating Microsoft Word (.docx)...', 'info', 2000);
      }
      const data = await ensureDocxExported(title, content, citations, fontName);
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
      const data = await ensureXlsxExported(title, content);
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

  function extractClientSelectableSections(mdText) {
    const raw = (mdText || '').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const sections = [];
    let curHeading = 'Document Header / Introduction';
    let curLines = [];

    for (const line of lines) {
      const s = line.trim();
      if (/^#{1,4}\s+/.test(s)) {
        const body = curLines.join('\n').trim();
        if (body || sections.length > 0) {
          sections.push({
            section_id: `sec_${sections.length + 1}`,
            index: sections.length + 1,
            heading: curHeading,
            content: body
          });
        }
        curHeading = s.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim() || `Section ${sections.length + 1}`;
        curLines = [line];
      } else {
        curLines.push(line);
      }
    }
    const tail = curLines.join('\n').trim();
    if (tail) {
      sections.push({
        section_id: `sec_${sections.length + 1}`,
        index: sections.length + 1,
        heading: curHeading,
        content: tail
      });
    }
    return sections;
  }

  async function openInteractiveDocumentPreviewModal(fileData, title, fileType = 'pdf', rawContent = '', citations = [], messageRow = null, sourceCard = null, onRevised = null) {
    const existing = document.getElementById('vs-ai-interactive-preview-modal');
    if (existing) existing.remove();

    let currentData = Object.assign({}, fileData || {});
    let currentSourceContent = rawContent || '';
    let currentSections = [];
    let currentPreviewObj = null;
    let currentOrientation = (currentData.orientation || 'portrait').toLowerCase();

    const artifactId = currentData.artifact_id || currentData.id || '';
    if (artifactId) {
      try {
        const pResp = await fetch(`/api/ai/artifacts/${encodeURIComponent(artifactId)}/preview?format=json`);
        if (pResp.ok) {
          const pJson = await pResp.json();
          if (pJson && pJson.ok) {
            currentPreviewObj = pJson.preview || null;
            if (pJson.source_content) currentSourceContent = pJson.source_content;
            if (Array.isArray(pJson.sections) && pJson.sections.length > 0) {
              currentSections = pJson.sections;
            }
            if (pJson.orientation) currentOrientation = String(pJson.orientation).toLowerCase();
          }
        }
      } catch (err) {
        console.warn('[VS-AI Preview] JSON preview fetch fallback:', err);
      }
    }

    if (!currentSections || currentSections.length === 0) {
      currentSections = extractClientSelectableSections(currentSourceContent);
    }
    if (currentSections.length === 0 && currentSourceContent) {
      currentSections = [{
        section_id: 'sec_1',
        index: 1,
        heading: title || 'Full Document Content',
        content: currentSourceContent
      }];
    }

    const modal = document.createElement('div');
    modal.id = 'vs-ai-interactive-preview-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10004';

    const normType = (fileType || 'pdf').toLowerCase();
    const extBadgeLabel = normType === 'xlsx'
      ? 'Excel Workbook (.xlsx)'
      : (normType === 'docx' ? 'Word Document (.docx)' : `PDF · ${currentOrientation === 'landscape' ? 'Landscape' : 'Portrait'}`);
    const extIcon = normType === 'xlsx' ? '📊' : (normType === 'docx' ? '📄' : '📑');
    const safeTitle = escapeHtml(title || currentData.filename || 'Statutory Document Preview');

    modal.innerHTML = `
      <div class="vs-ai-pdf-modal-card vs-ai-interactive-preview-card glass">
        <div class="vs-ai-pdf-toolbar">
          <div class="vs-ai-pdf-toolbar-title">
            <span style="font-size:19px;">${extIcon}</span>
            <span id="vs-ai-iprev-title" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;">${safeTitle}</span>
            <span id="vs-ai-iprev-badge" class="vs-ai-chart-badge" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${escapeHtml(extBadgeLabel)}</span>
          </div>
          <div class="vs-ai-pdf-toolbar-actions" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${normType === 'pdf' ? `
              <div class="vs-ai-iprev-view-tabs" style="display:inline-flex;background:#f1f5f9;border-radius:8px;padding:2px;border:1px solid #cbd5e1;">
                <button type="button" class="vs-ai-iprev-tab active" data-view="interactive" style="border:none;background:#ffffff;color:#1e3a8a;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;">Interactive Sections</button>
                <button type="button" class="vs-ai-iprev-tab" data-view="native-pdf" style="border:none;background:transparent;color:#475569;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;">PDF Page View</button>
              </div>
            ` : ''}
            <button type="button" class="btn primary btn-sm" id="vs-ai-iprev-btn-download">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Download</span>
            </button>
            <button type="button" class="btn secondary btn-sm" id="vs-ai-iprev-btn-save-client">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#folder"/></svg>
              <span>Save to Client</span>
            </button>
            <button type="button" class="vs-ai-modal-close" id="vs-ai-iprev-btn-close" aria-label="Close Preview">✕</button>
          </div>
        </div>

        <div class="vs-ai-iprev-split-body">
          <!-- Left / Main Document Surface -->
          <div class="vs-ai-iprev-main-pane">
            <div class="vs-ai-iprev-helper-banner">
              <span>🎯 <strong>Select Area to Revise:</strong> Click any document section card below (or highlight specific text with your cursor) and instruct VS AI on the right to modify it and generate a new document.</span>
            </div>
            <div id="vs-ai-iprev-surface" class="vs-ai-iprev-surface"></div>
            <iframe id="vs-ai-iprev-pdf-frame" class="vs-ai-pdf-frame" style="display:none;flex:1;width:100%;border:none;border-radius:8px;" title="PDF Native Preview"></iframe>
          </div>

          <!-- Right Sidebar: Select-Area-to-Revise AI Studio -->
          <div class="vs-ai-iprev-side-pane">
            <div class="vs-ai-iprev-side-header">
              <div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px;color:#0f172a;">
                <span>✨ Revise Selected Area</span>
              </div>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px;">
                Select any section or text in the preview, enter your instruction, and VS AI will generate a revised document.
              </div>
            </div>

            <div class="vs-ai-iprev-field-group">
              <label class="vs-ai-iprev-label">Quick Section Picker:</label>
              <select id="vs-ai-iprev-sec-select" class="vs-ai-input" style="padding:6px 10px;font-size:12px;"></select>
            </div>

            <div class="vs-ai-iprev-field-group" style="flex:1;display:flex;flex-direction:column;min-height:110px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <label class="vs-ai-iprev-label" style="margin:0;">Selected Area / Excerpt:</label>
                <span id="vs-ai-iprev-sec-badge" style="font-size:10.5px;font-weight:700;color:#2563eb;background:#eff6ff;padding:2px 7px;border-radius:99px;border:1px solid #bfdbfe;">Section 1</span>
              </div>
              <textarea id="vs-ai-iprev-selected-text" class="vs-ai-input" style="flex:1;min-height:95px;font-size:12px;line-height:1.45;resize:vertical;font-family:inherit;background:#f8fafc;" placeholder="Click a section on the left or highlight text to populate the target area..."></textarea>
            </div>

            <div class="vs-ai-iprev-field-group">
              <label class="vs-ai-iprev-label" for="vs-ai-iprev-instruction">Instruction for VS AI:</label>
              <textarea id="vs-ai-iprev-instruction" class="vs-ai-input" rows="3" style="font-size:12.5px;line-height:1.45;resize:vertical;" placeholder="e.g., 'Update the disputed tax amount to ₹4,15,000', 'Add citation to Circular 183/15/2022-GST', 'Make arguments more assertive'..."></textarea>
              <div class="vs-ai-iprev-chip-row">
                <button type="button" class="vs-ai-iprev-chip" data-ins="Strengthen statutory citations and judicial precedents in this section">⚖️ Add Legal Citations</button>
                <button type="button" class="vs-ai-iprev-chip" data-ins="Convert the figures in this section into a clean structured reconciliation table">📊 Convert to Table</button>
                <button type="button" class="vs-ai-iprev-chip" data-ins="Make this section more formal, concise, and authoritative for tax authorities">✒️ Make Formal</button>
              </div>
            </div>

            <div id="vs-ai-iprev-status" style="display:none;font-size:12px;padding:8px 10px;border-radius:8px;margin-bottom:8px;"></div>

            <button type="button" class="btn primary" id="vs-ai-iprev-apply-btn" style="width:100%;padding:10px 14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;">
              <span>✨ Apply Change & Generate New Document</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const surfaceEl = modal.querySelector('#vs-ai-iprev-surface');
    const pdfFrameEl = modal.querySelector('#vs-ai-iprev-pdf-frame');
    const secSelectEl = modal.querySelector('#vs-ai-iprev-sec-select');
    const secBadgeEl = modal.querySelector('#vs-ai-iprev-sec-badge');
    const selectedTextEl = modal.querySelector('#vs-ai-iprev-selected-text');
    const instructionEl = modal.querySelector('#vs-ai-iprev-instruction');
    const applyBtn = modal.querySelector('#vs-ai-iprev-apply-btn');
    const statusBox = modal.querySelector('#vs-ai-iprev-status');
    const badgeEl = modal.querySelector('#vs-ai-iprev-badge');

    let selectedSectionIndex = 0;

    function selectSectionByIndex(idx, customHighlightedText = null) {
      if (!currentSections || currentSections.length === 0) return;
      selectedSectionIndex = Math.max(0, Math.min(idx, currentSections.length - 1));
      const sec = currentSections[selectedSectionIndex];
      if (secSelectEl) secSelectEl.value = String(selectedSectionIndex);
      if (secBadgeEl) secBadgeEl.textContent = sec.heading ? (sec.heading.length > 26 ? sec.heading.slice(0, 26) + '...' : sec.heading) : `Section ${selectedSectionIndex + 1}`;
      if (selectedTextEl) {
        selectedTextEl.value = customHighlightedText !== null ? customHighlightedText : (sec.content || sec.heading || '');
      }
      surfaceEl.querySelectorAll('.vs-ai-preview-section-block').forEach((blk, bIdx) => {
        blk.classList.toggle('selected', bIdx === selectedSectionIndex);
      });
    }

    function renderInteractiveSurface(recentlyRevisedHeading = null) {
      if (!surfaceEl) return;

      // Populate section dropdown
      if (secSelectEl) {
        secSelectEl.innerHTML = currentSections.map((s, idx) => `
          <option value="${idx}">${idx + 1}. ${escapeHtml(s.heading || ('Section ' + (idx + 1)))}</option>
        `).join('');
      }

      let html = '';

      // If Excel workbook has sheet preview data, render interactive sheet preview at top
      if (normType === 'xlsx' && currentPreviewObj && Array.isArray(currentPreviewObj.sheets) && currentPreviewObj.sheets.length > 0) {
        html += `<div style="margin-bottom:18px;">`;
        currentPreviewObj.sheets.forEach((sh) => {
          const headers = sh.headers || [];
          const rows = sh.rows || [];
          html += `
            <div style="margin-bottom:14px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
              <div style="background:#f0fdf4;padding:8px 12px;border-bottom:1px solid #bbf7d0;font-weight:700;font-size:12.5px;color:#166534;">
                📊 Sheet: ${escapeHtml(sh.name || 'Schedule')}
              </div>
              <div style="overflow-x:auto;">
                <table class="vs-ai-excel-table" style="width:100%;border-collapse:collapse;font-size:12px;">
                  ${headers.length > 0 ? `<thead><tr>${headers.map(h => `<th style="background:#1e3a8a;color:#fff;padding:6px 10px;border:1px solid #cbd5e1;text-align:left;">${escapeHtml(String(h ?? ''))}</th>`).join('')}</tr></thead>` : ''}
                  <tbody>
                    ${rows.slice(0, 40).map(r => `<tr>${r.map(c => `<td style="padding:5px 10px;border:1px solid #e2e8f0;">${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        });
        html += `</div>`;
      }

      html += `
        <div class="vs-ai-docx-page" style="max-width:${currentOrientation === 'landscape' ? '1060px' : '820px'};margin:0 auto;padding:36px 44px;">
          <div class="vs-ai-docx-letterhead">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:16px;font-weight:800;color:#1e3a8a;letter-spacing:0.4px;">VS DATABASE · STATUTORY DOCUMENT PREVIEW</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px;">Click any section block below or highlight text to revise with VS AI</div>
              </div>
              <span style="font-size:11px;font-weight:700;color:#1e40af;background:#eff6ff;padding:4px 10px;border-radius:6px;border:1px solid #bfdbfe;">
                ${currentOrientation === 'landscape' ? '📐 Landscape Mode' : '📄 Portrait Mode'}
              </span>
            </div>
            <div style="height:2px;background:linear-gradient(90deg, #2563eb 0%, #93c5fd 100%);margin:10px 0 18px 0;"></div>
          </div>
          <div class="vs-ai-iprev-sections-list">
            ${currentSections.map((sec, idx) => {
              const isRevised = recentlyRevisedHeading && sec.heading && sec.heading.toLowerCase() === recentlyRevisedHeading.toLowerCase();
              return `
                <div class="vs-ai-preview-section-block ${idx === selectedSectionIndex ? 'selected' : ''} ${isRevised ? 'just-revised' : ''}" data-sec-idx="${idx}">
                  <div class="vs-ai-preview-section-bar">
                    <span class="vs-ai-preview-sec-title">§ ${idx + 1}. ${escapeHtml(sec.heading || ('Section ' + (idx + 1)))}</span>
                    <span class="vs-ai-preview-sec-action-pill">${isRevised ? '✓ Updated by VS AI' : 'Click to Select & Revise'}</span>
                  </div>
                  <div class="vs-ai-preview-section-content">${renderMarkdown(sec.content || '')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      surfaceEl.innerHTML = html;

      surfaceEl.querySelectorAll('.vs-ai-preview-section-block').forEach((blk) => {
        blk.onclick = (e) => {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().trim().length > 3) {
            return; // Let mouseup text selection handler capture the exact highlighted substring
          }
          const idx = parseInt(blk.getAttribute('data-sec-idx') || '0', 10);
          selectSectionByIndex(idx);
        };
      });

      selectSectionByIndex(selectedSectionIndex);
    }

    // Support freeform text selection inside the preview surface
    surfaceEl.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        const highlighted = sel.toString().trim();
        if (highlighted.length > 3) {
          let secIdx = selectedSectionIndex;
          const anchorEl = sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
          const secBlk = anchorEl ? anchorEl.closest('.vs-ai-preview-section-block') : null;
          if (secBlk) {
            secIdx = parseInt(secBlk.getAttribute('data-sec-idx') || '0', 10);
          }
          selectSectionByIndex(secIdx, highlighted);
        }
      }
    });

    if (secSelectEl) {
      secSelectEl.onchange = () => {
        const idx = parseInt(secSelectEl.value || '0', 10);
        selectSectionByIndex(idx);
        const targetBlk = surfaceEl.querySelector(`.vs-ai-preview-section-block[data-sec-idx="${idx}"]`);
        if (targetBlk) targetBlk.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    }

    modal.querySelectorAll('.vs-ai-iprev-chip').forEach(chip => {
      chip.onclick = () => {
        instructionEl.value = chip.getAttribute('data-ins') || '';
        instructionEl.focus();
      };
    });

    // View mode toggle for PDF (Interactive Sections vs Native PDF Frame)
    modal.querySelectorAll('.vs-ai-iprev-tab').forEach(tabBtn => {
      tabBtn.onclick = () => {
        modal.querySelectorAll('.vs-ai-iprev-tab').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'transparent';
          b.style.color = '#475569';
        });
        tabBtn.classList.add('active');
        tabBtn.style.background = '#ffffff';
        tabBtn.style.color = '#1e3a8a';

        const viewMode = tabBtn.getAttribute('data-view');
        if (viewMode === 'native-pdf') {
          const curArtId = currentData.artifact_id || currentData.id || '';
          const pdfStreamUrl = (curArtId ? `/api/ai/artifacts/${encodeURIComponent(curArtId)}/preview` : null) ||
            (currentData.filename ? `/api/ai/exports/${encodeURIComponent(currentData.filename)}` : '');
          surfaceEl.style.display = 'none';
          pdfFrameEl.style.display = 'block';
          pdfFrameEl.src = `${pdfStreamUrl}#toolbar=1&navpanes=0&t=${Date.now()}`;
        } else {
          pdfFrameEl.style.display = 'none';
          surfaceEl.style.display = 'block';
        }
      };
    });

    // Apply AI Revision & Generate New Document
    applyBtn.onclick = async () => {
      const targetText = (selectedTextEl.value || '').trim();
      const instruction = (instructionEl.value || '').trim();
      if (!targetText) {
        alert('Please click a section in the preview or highlight the text area you want to revise.');
        return;
      }
      if (!instruction) {
        alert('Please enter an instruction telling VS AI what to change in the selected area.');
        instructionEl.focus();
        return;
      }

      const activeSec = currentSections[selectedSectionIndex] || {};
      applyBtn.disabled = true;
      applyBtn.innerHTML = `<span>⏳ Revising Area & Generating New Document...</span>`;
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = '#eff6ff';
        statusBox.style.color = '#1e40af';
        statusBox.style.border = '1px solid #bfdbfe';
        statusBox.textContent = 'VS AI is revising the selected section and compiling the updated document...';
      }

      try {
        const resp = await fetch('/api/ai/revise-document-area', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artifact_id: currentData.artifact_id || currentData.id || '',
            title: title || currentData.filename || 'Statutory Document',
            format: normType,
            full_content: currentSourceContent,
            selected_area: targetText,
            section_heading: activeSec.heading || '',
            instruction: instruction,
            conversation_id: currentConvId || null
          })
        });
        const res = await resp.json();
        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'Failed to revise selected area');
        }

        // Update state with newly generated artifact
        currentData = {
          ok: true,
          artifact_id: res.artifact_id,
          filename: res.filename,
          format: res.format || normType,
          orientation: res.orientation || currentOrientation,
          size_kb: res.size_kb,
          download_url: res.download_url,
          preview_url: res.preview_url
        };
        currentSourceContent = res.revised_content || currentSourceContent;
        currentOrientation = (res.orientation || currentOrientation).toLowerCase();
        currentPreviewObj = res.preview || currentPreviewObj;
        currentSections = (Array.isArray(res.sections) && res.sections.length > 0)
          ? res.sections
          : extractClientSelectableSections(currentSourceContent);

        if (badgeEl && normType === 'pdf') {
          badgeEl.textContent = `PDF · ${currentOrientation === 'landscape' ? 'Landscape' : 'Portrait'} (Revised)`;
        }

        renderInteractiveSurface(activeSec.heading || '');
        instructionEl.value = '';

        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.style.background = '#f0fdf4';
          statusBox.style.color = '#166534';
          statusBox.style.border = '1px solid #bbf7d0';
          statusBox.textContent = `✓ Revised document "${res.filename}" generated! Preview updated & added to chat.`;
        }

        if (typeof onRevised === 'function') {
          onRevised(currentData, currentSourceContent);
        }

        // Append a new Revised Document Card into the chat stream so the user has the newly generated file card
        if (messageRow) {
          const revisedCard = document.createElement('div');
          const badgeCls = normType === 'xlsx' ? 'xlsx' : (normType === 'docx' ? 'docx' : 'pdf');
          const badgeLbl = normType === 'xlsx' ? 'Excel · Revised' : (normType === 'docx' ? 'Word · Revised' : `PDF · ${currentOrientation === 'landscape' ? 'Landscape' : 'Portrait'} · Revised`);
          revisedCard.className = 'vs-ai-direct-file-card vs-ai-revised-file-card';
          revisedCard.dataset.artifactId = res.artifact_id || '';
          revisedCard.dataset.serverFilename = res.filename || '';
          revisedCard.innerHTML = `
            <div class="vs-ai-file-icon-box ${badgeCls}">${extIcon}</div>
            <div class="vs-ai-file-meta-col">
              <div class="vs-ai-file-meta-name" title="${escapeHtml(res.filename)}">${escapeHtml(res.filename)}</div>
              <div class="vs-ai-file-meta-sub">
                <span class="vs-ai-file-badge ${badgeCls}">${badgeLbl}</span>
                <span class="vs-ai-file-status-text">Updated via AI Area Revision · ${res.size_kb || ''} KB</span>
              </div>
            </div>
            <div class="vs-ai-file-actions-row">
              <button type="button" class="btn primary btn-sm btn-card-download" title="Download Revised File">
                <svg class="i" style="width:12px;height:12px;margin-right:3px;" aria-hidden="true"><use href="#dl"/></svg>
                <span>Download</span>
              </button>
              <button type="button" class="btn secondary btn-sm btn-card-save-client" title="Save Revised File to Client">
                <svg class="i" style="width:12px;height:12px;margin-right:3px;" aria-hidden="true"><use href="#folder"/></svg>
                <span>Save to Client</span>
              </button>
              <button type="button" class="btn secondary btn-sm btn-card-preview" title="Preview Revised Document">
                <svg class="i" style="width:12px;height:12px;margin-right:3px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Preview</span>
              </button>
            </div>
          `;
          const latestDataSnapshot = Object.assign({}, currentData);
          const latestContentSnapshot = currentSourceContent;
          revisedCard.querySelector('.btn-card-download').onclick = () => executeSaveToWindowsLocation(latestDataSnapshot, title, normType);
          revisedCard.querySelector('.btn-card-save-client').onclick = () => showSaveClientConfirmationModal(latestDataSnapshot, title, normType);
          revisedCard.querySelector('.btn-card-preview').onclick = () => openInteractiveDocumentPreviewModal(latestDataSnapshot, title, normType, latestContentSnapshot, citations, messageRow, revisedCard);

          if (sourceCard && sourceCard.parentNode) {
            sourceCard.parentNode.insertBefore(revisedCard, sourceCard.nextSibling);
          } else {
            const footerRow = messageRow.querySelector('.vs-ai-asst-footer-row');
            if (footerRow && footerRow.parentNode) {
              footerRow.parentNode.insertBefore(revisedCard, footerRow);
            }
          }
        }

        if (typeof showNativeToast === 'function') {
          showNativeToast(`✓ Revised document "${res.filename}" generated!`, 'success', 3500);
        }
      } catch (err) {
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.style.background = '#fef2f2';
          statusBox.style.color = '#b91c1c';
          statusBox.style.border = '1px solid #fecaca';
          statusBox.textContent = `Revision error: ${err.message}`;
        } else {
          alert('Failed to revise selected area: ' + err.message);
        }
      } finally {
        applyBtn.disabled = false;
        applyBtn.innerHTML = `<span>✨ Apply Change & Generate New Document</span>`;
      }
    };

    renderInteractiveSurface();

    modal.querySelector('#vs-ai-iprev-btn-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('#vs-ai-iprev-btn-download').onclick = () => executeSaveToWindowsLocation(currentData, title, normType);
    modal.querySelector('#vs-ai-iprev-btn-save-client').onclick = () => showSaveClientConfirmationModal(currentData, title, normType);
  }

  function showInAppPdfPreview(pdfData, title, rawContent = '') {
    openInteractiveDocumentPreviewModal(pdfData, title, 'pdf', rawContent);
  }

  function showInAppDocxPreview(docxData, title, rawContent, previewData) {
    const existing = document.getElementById('vs-ai-docx-preview-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vs-ai-docx-preview-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10001';

    const safeTitle = escapeHtml(title || docxData.filename || 'Executive Advisory Document');
    const downloadUrl = docxData.download_url || `/api/ai/exports/${encodeURIComponent(docxData.filename)}`;

    function formatDocxPreviewCell(cell) {
      if (!cell) return '';
      let c = escapeHtml(String(cell));
      c = c.replace(/&lt;br\s*\/?&gt;/gi, '<br/>');
      c = c.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      c = c.replace(/\*(.*?)\*/g, '<em>$1</em>');
      return c;
    }

    let docHtml = '';
    if (previewData && previewData.paragraphs && previewData.paragraphs.length > 0) {
      docHtml = previewData.paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '<p style="margin:8px 0;height:12px;"></p>';
        if (trimmed.startsWith('#') || (trimmed.toUpperCase() === trimmed && trimmed.length < 80)) {
          return `<h3 style="color:#1e3a8a;margin:20px 0 8px 0;font-size:16px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">${escapeHtml(trimmed.replace(/^#+\s*/, ''))}</h3>`;
        }
        let pFormatted = escapeHtml(trimmed);
        pFormatted = pFormatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        pFormatted = pFormatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        return `<p style="margin:8px 0;line-height:1.7;color:#1e293b;font-size:13.5px;text-align:justify;">${pFormatted}</p>`;
      }).join('');
      if (previewData.tables && previewData.tables.length > 0) {
        docHtml += '<div style="margin-top:24px;">';
        previewData.tables.forEach(tbl => {
          docHtml += '<div style="overflow-x:auto;margin:16px 0;"><table class="vs-ai-docx-table" style="width:100%;border-collapse:collapse;font-size:12.5px;">';
          tbl.forEach((row, rIdx) => {
            const isHead = rIdx === 0;
            docHtml += `<tr style="${isHead ? 'background:#1e3a8a;color:#ffffff;font-weight:700;' : (rIdx % 2 === 0 ? 'background:#f8fafc;' : 'background:#ffffff;')}">`;
            row.forEach(cell => {
              docHtml += `<td style="border:1px solid #cbd5e1;padding:8px 12px;${isHead ? 'color:#fff;' : 'color:#1e293b;'}">${formatDocxPreviewCell(cell)}</td>`;
            });
            docHtml += '</tr>';
          });
          docHtml += '</table></div>';
        });
        docHtml += '</div>';
      }
    } else {
      docHtml = renderMarkdown(rawContent || '');
    }

    modal.innerHTML = `
      <div class="vs-ai-pdf-modal-card vs-ai-preview-card glass">
        <div class="vs-ai-pdf-toolbar">
          <div class="vs-ai-pdf-toolbar-title">
            <span style="font-size:20px;">📄</span>
            <span style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeTitle}</span>
            <span class="vs-ai-chart-badge" style="background:#eff6ff;color:#2563eb;border-color:#bfdbfe;">Microsoft Word (.docx)</span>
          </div>
          <div class="vs-ai-pdf-toolbar-actions">
            <button type="button" class="btn primary btn-sm" id="vs-ai-docx-btn-download">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Download Word</span>
            </button>
            <button type="button" class="btn secondary btn-sm" id="vs-ai-docx-btn-save-client">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#folder"/></svg>
              <span>Save to Client</span>
            </button>
            <button type="button" class="vs-ai-modal-close" id="vs-ai-docx-btn-close" aria-label="Close Preview">✕</button>
          </div>
        </div>
        <div class="vs-ai-docx-paper-container">
          <div class="vs-ai-docx-page">
            <div class="vs-ai-docx-letterhead">
              <div style="font-size:17px;font-weight:800;color:#1e3a8a;letter-spacing:0.5px;">VS ADVISORY SERVICES & ASSOCIATES</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">Chartered Accountants & Legal Practitioners · Professional Advisory Dossier</div>
              <div style="height:2px;background:linear-gradient(90deg, #2563eb 0%, #93c5fd 100%);margin:12px 0 18px 0;"></div>
            </div>
            <div class="vs-ai-docx-body">${docHtml}</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#vs-ai-docx-btn-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelector('#vs-ai-docx-btn-download').onclick = () => {
      executeSaveToWindowsLocation(docxData, title, 'docx');
    };
    modal.querySelector('#vs-ai-docx-btn-save-client').onclick = () => {
      showSaveClientConfirmationModal(docxData, title, 'docx');
    };
  }

  function showInAppXlsxPreview(xlsxData, title, rawContent, previewData) {
    const existing = document.getElementById('vs-ai-xlsx-preview-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vs-ai-xlsx-preview-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.style.zIndex = '10001';

    const safeTitle = escapeHtml(title || xlsxData.filename || 'Statutory Spreadsheet');
    const downloadUrl = xlsxData.download_url || `/api/ai/exports/${encodeURIComponent(xlsxData.filename)}`;

    let sheets = {};
    let sheetNames = [];
    if (previewData && previewData.sheets) {
      if (Array.isArray(previewData.sheets)) {
        previewData.sheets.forEach(s => {
          const sName = s.name || 'Sheet';
          sheetNames.push(sName);
          const fullSheetRows = [];
          if (s.headers && s.headers.length > 0) fullSheetRows.push(s.headers);
          if (s.rows && Array.isArray(s.rows)) fullSheetRows.push(...s.rows);
          sheets[sName] = fullSheetRows;
        });
      } else {
        sheets = previewData.sheets;
        sheetNames = previewData.sheet_names || Object.keys(sheets);
      }
    }

    let activeSheetIndex = 0;

    modal.innerHTML = `
      <div class="vs-ai-pdf-modal-card vs-ai-preview-card glass">
        <div class="vs-ai-pdf-toolbar">
          <div class="vs-ai-pdf-toolbar-title">
            <span style="font-size:20px;">📊</span>
            <span style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeTitle}</span>
            <span class="vs-ai-chart-badge" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;">Excel Spreadsheet (.xlsx)</span>
          </div>
          <div class="vs-ai-pdf-toolbar-actions">
            <button type="button" class="btn primary btn-sm" id="vs-ai-xlsx-btn-download">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#dl"/></svg>
              <span>Download Excel</span>
            </button>
            <button type="button" class="btn secondary btn-sm" id="vs-ai-xlsx-btn-save-client">
              <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#folder"/></svg>
              <span>Save to Client</span>
            </button>
            <button type="button" class="vs-ai-modal-close" id="vs-ai-xlsx-btn-close" aria-label="Close Preview">✕</button>
          </div>
        </div>
        <div class="vs-ai-xlsx-container">
          <div class="vs-ai-xlsx-sheet-tabs" id="vs-ai-xlsx-tabs"></div>
          <div class="vs-ai-xlsx-grid-wrapper" id="vs-ai-xlsx-grid"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    function renderActiveSheet() {
      const tabsEl = modal.querySelector('#vs-ai-xlsx-tabs');
      const gridEl = modal.querySelector('#vs-ai-xlsx-grid');
      if (!tabsEl || !gridEl) return;

      if (sheetNames.length === 0) {
        tabsEl.style.display = 'none';
        gridEl.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;">No spreadsheet cells found.</div>`;
        return;
      }

      tabsEl.innerHTML = sheetNames.map((sName, idx) => `
        <button type="button" class="vs-ai-sheet-tab ${idx === activeSheetIndex ? 'active' : ''}" data-idx="${idx}">
          <svg class="i" style="width:12px;height:12px;margin-right:4px;" aria-hidden="true"><use href="#doc"/></svg>
          ${escapeHtml(sName)}
        </button>
      `).join('');

      tabsEl.querySelectorAll('.vs-ai-sheet-tab').forEach(tb => {
        tb.onclick = () => {
          activeSheetIndex = parseInt(tb.getAttribute('data-idx') || '0', 10);
          renderActiveSheet();
        };
      });

      const currentName = sheetNames[activeSheetIndex];
      const rows = sheets[currentName] || [];

      if (rows.length === 0) {
        gridEl.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;">Sheet is empty.</div>`;
        return;
      }

      let maxCols = 0;
      rows.forEach(r => { if (r.length > maxCols) maxCols = r.length; });

      const colLabels = [];
      for (let c = 0; c < maxCols; c++) {
        let label = '';
        let n = c;
        while (n >= 0) {
          label = String.fromCharCode(65 + (n % 26)) + label;
          n = Math.floor(n / 26) - 1;
        }
        colLabels.push(label);
      }

      let gridHtml = '<table class="vs-ai-excel-table"><thead><tr><th class="vs-ai-excel-corner"></th>';
      colLabels.forEach(cl => {
        gridHtml += `<th class="vs-ai-excel-col-head">${cl}</th>`;
      });
      gridHtml += '</tr></thead><tbody>';

      rows.forEach((row, rIdx) => {
        const isHeaderCandidate = rIdx === 0;
        gridHtml += `<tr><td class="vs-ai-excel-row-num">${rIdx + 1}</td>`;
        for (let c = 0; c < maxCols; c++) {
          const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
          const isNumeric = val !== '' && !isNaN(val.replace(/[₹$,]/g, '').trim());
          const cellAlign = isNumeric ? 'text-align:right;' : 'text-align:left;';
          const headerWeight = isHeaderCandidate ? 'font-weight:700;background:#f8fafc;' : '';
          gridHtml += `<td class="vs-ai-excel-cell" style="${cellAlign}${headerWeight}">${escapeHtml(val)}</td>`;
        }
        gridHtml += '</tr>';
      });

      gridHtml += '</tbody></table>';
      gridEl.innerHTML = gridHtml;
    }

    renderActiveSheet();

    modal.querySelector('#vs-ai-xlsx-btn-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelector('#vs-ai-xlsx-btn-download').onclick = () => {
      executeSaveToWindowsLocation(xlsxData, title, 'xlsx');
    };
    modal.querySelector('#vs-ai-xlsx-btn-save-client').onclick = () => {
      showSaveClientConfirmationModal(xlsxData, title, 'xlsx');
    };
  }

  function showSaveClientConfirmationModal(fileData, title, fileType = 'pdf') {
    const existing = document.getElementById('vs-ai-save-confirm-modal');
    if (existing) {
      if (window.VSKeyboard && window.VSKeyboard.releaseFocus) {
        window.VSKeyboard.releaseFocus(existing);
      }
      existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'vs-ai-save-confirm-modal';
    modal.className = 'vs-ai-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'vs-ai-save-confirm-title');
    modal.style.zIndex = '10006';
    modal.innerHTML = `
      <div style="background:#ffffff; border-radius:16px; padding:26px 30px; max-width:420px; width:90%; box-shadow:0 24px 50px rgba(15,23,42,0.22); border:1px solid #e2e8f0; text-align:center; animation:vsaiFadeIn 0.2s ease both;">
        <div style="width:54px; height:54px; border-radius:50%; background:#eff6ff; color:#2563eb; display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto; font-size:26px; border:1px solid #bfdbfe;">
          📁
        </div>
        <h3 id="vs-ai-save-confirm-title" style="font-size:17px; font-weight:700; color:#0f172a; margin:0 0 8px 0;">Save to Client</h3>
        <p style="font-size:13.5px; color:#475569; margin:0 0 22px 0; line-height:1.5;">
          Do you really want to save this document to the client?
        </p>
        <div style="display:flex; justify-content:center; gap:12px;">
          <button type="button" class="btn secondary vs-ai-btn-no" style="min-width:96px; padding:8px 18px; font-weight:600;">No</button>
          <button type="button" class="btn primary vs-ai-btn-yes" style="min-width:96px; padding:8px 18px; font-weight:600; background:#2563eb; color:#fff;">Yes</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      if (window.VSKeyboard && window.VSKeyboard.releaseFocus) {
        window.VSKeyboard.releaseFocus(modal);
      }
      modal.remove();
    };

    const noBtn = modal.querySelector('.vs-ai-btn-no');
    const yesBtn = modal.querySelector('.vs-ai-btn-yes');

    noBtn.onclick = () => closeModal();
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    yesBtn.onclick = async () => {
      yesBtn.disabled = true;
      yesBtn.textContent = 'Preparing...';
      try {
        await stageFileAndRedirectToSave(fileData, title, fileType);
        closeModal();
      } catch (err) {
        alert('Could not save file to client: ' + err.message);
        closeModal();
      }
    };

    if (window.VSKeyboard && window.VSKeyboard.trapFocus) {
      window.VSKeyboard.trapFocus(modal, noBtn);
    } else if (noBtn) {
      noBtn.focus();
    }
  }

  async function stageFileAndRedirectToSave(fileData, title, fileType = 'pdf') {
    const filename = fileData.filename;
    if (!filename) throw new Error('Filename missing from generated file');

    const fetchUrl = fileData.download_url || (fileData.artifact_id ? `/api/ai/artifacts/${fileData.artifact_id}/download` : null) || `/api/ai/exports/${encodeURIComponent(filename)}`;
    let res = await fetch(fetchUrl);
    if (!res.ok) {
      // Fallback check to direct exports
      const altUrl = `/api/ai/exports/${encodeURIComponent(filename)}`;
      if (altUrl !== fetchUrl) {
        res = await fetch(altUrl);
      }
    }
    if (!res.ok) throw new Error(`Could not load export file from server (${res.status})`);
    const blob = await res.blob();
    const fileObj = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

    let stagedItem = null;
    if (window.saveStaging) {
      await window.saveStaging.init();
      stagedItem = await window.saveStaging.addFileDirect(fileObj, filename);
    }

    if (typeof selectedFiles !== 'undefined') {
      const isPdf = filename.toLowerCase().endsWith('.pdf') || fileType === 'pdf';
      selectedFiles.push({
        staged_file_id: stagedItem ? stagedItem.staged_file_id : undefined,
        staging_session_id: window.saveStaging ? window.saveStaging.sessionId : undefined,
        name: filename,
        filename: filename,
        size: blob.size,
        fileObj: fileObj,
        is_pdf: isPdf,
        pdf_selected: false,
        badge: stagedItem ? stagedItem.badge : null,
        client_visibility: true
      });
      if (typeof renderSelectedFiles === 'function') {
        renderSelectedFiles();
      }
    }

    document.querySelectorAll('#vs-ai-pdf-preview-modal, #vs-ai-docx-preview-modal, #vs-ai-xlsx-preview-modal, #vs-ai-save-modal, #vs-ai-save-options-modal').forEach(m => m.remove());

    if (typeof navigateTo === 'function') {
      navigateTo('save');
      if (typeof showNativeToast === 'function') {
        showNativeToast(`Pre-filled "${filename}" in Saves tab. Select client and folder to finish saving.`, 'success', 4000);
      }
    }
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
    cleanBase = cleanBase.replace(/(\.(docx|xlsx|pdf|txt|csv))+$/gi, '').trim();
    const safeTitle = escapeHtml(cleanBase || 'Statutory Document');
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

  async function executeSaveToWindowsLocation(fileData, title, fileType = null) {
    let targetExt = fileType ? fileType.replace(/^\./, '').toLowerCase() : '';
    if (!targetExt && fileData && (fileData.format || fileData.artifact_type)) {
      targetExt = String(fileData.format || fileData.artifact_type).toLowerCase();
    }
    if (!targetExt && fileData && fileData.filename) {
      const m = fileData.filename.match(/\.([a-zA-Z0-9]+)$/);
      if (m) targetExt = m[1].toLowerCase();
    }
    if (!targetExt && title) {
      const m = title.match(/\.([a-zA-Z0-9]+)$/);
      if (m) targetExt = m[1].toLowerCase();
    }
    if (!targetExt) targetExt = 'pdf';

    let base = (title || (fileData && (fileData.title || fileData.filename)) || 'VS_AI_Document').trim();
    base = base.replace(/[/\\?%*:|"<>]/g, '_').trim();
    base = base.replace(/(\.(docx|xlsx|pdf|txt|csv))+$/gi, '').trim();
    if (!base) base = 'VS_AI_Document';
    const defaultName = `${base}.${targetExt}`;
    const filenameOnServer = (fileData && fileData.filename) ? fileData.filename : defaultName;
    const artifactId = (fileData && (fileData.artifact_id || fileData.id)) ? String(fileData.artifact_id || fileData.id) : '';

    // 1. Primary Desktop Native Bridge (pywebview WinForms SaveFileDialog)
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.save_file_to_location === 'function') {
      try {
        const pyRes = await window.pywebview.api.save_file_to_location(filenameOnServer, defaultName, artifactId);
        if (pyRes && pyRes.ok) {
          const msg = `✓ Document saved successfully to:\n${pyRes.path}`;
          if (typeof showNativeToast === 'function') {
            showNativeToast(msg, 'success', 5000);
          } else {
            alert(msg);
          }
          return pyRes;
        } else if (pyRes && pyRes.cancelled) {
          return pyRes;
        }
      } catch (pyErr) {
        console.warn('[Download] pywebview save_file_to_location notice, trying server save dialog:', pyErr);
      }
    }

    // 2. Native Server Save Dialog with artifact_id + filename resolution
    try {
      const resp = await fetch('/api/ai/native-save-dialog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_id: artifactId,
          source_filename: filenameOnServer,
          default_name: defaultName,
          ext: targetExt
        })
      });
      const res = await resp.json();
      if (res && res.ok) {
        const msg = `✓ Document saved successfully to:\n${res.path}`;
        if (typeof showNativeToast === 'function') {
          showNativeToast(msg, 'success', 5000);
        } else {
          alert(msg);
        }
        return res;
      } else if (res && res.cancelled) {
        return res;
      } else if (res && res.error && resp.status === 404) {
        const errMsg = `Could not download document: ${res.error}`;
        if (typeof showNativeToast === 'function') {
          showNativeToast(errMsg, 'error', 5000);
        } else {
          alert(errMsg);
        }
        return res;
      }
    } catch (dialogErr) {
      console.warn('[Download] Server save dialog error, falling back to direct stream download:', dialogErr);
    }

    // 3. Verified Blob Download Fallback (works in both WebView2 with ALLOW_DOWNLOADS=True and browsers)
    const downloadUrl = (fileData && fileData.download_url)
      ? fileData.download_url
      : (artifactId ? `/api/ai/artifacts/${encodeURIComponent(artifactId)}/download` : `/api/ai/exports/${encodeURIComponent(filenameOnServer)}?download=1`);

    try {
      const dlResp = await fetch(downloadUrl);
      if (!dlResp.ok) {
        throw new Error(`Server returned HTTP ${dlResp.status}`);
      }
      const blob = await dlResp.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Downloaded file is empty (0 bytes).');
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(blobUrl);
      }, 1500);
      if (typeof showNativeToast === 'function') {
        showNativeToast(`✓ Downloaded "${defaultName}" (${Math.max(1, Math.round(blob.size / 1024))} KB).`, 'success', 4000);
      }
      return { ok: true, filename: defaultName, size_bytes: blob.size };
    } catch (dlErr) {
      const errMsg = `Download failed for "${defaultName}": ${dlErr.message}`;
      if (typeof showNativeToast === 'function') {
        showNativeToast(errMsg, 'error', 5000);
      } else {
        alert(errMsg);
      }
      return { ok: false, error: dlErr.message };
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
          cleanDoc = cleanDoc.replace(/(\.(docx|xlsx|pdf|txt|csv))+$/gi, '').trim();
          const docName = `${cleanDoc || 'VS_AI_Document'}${ext}`;
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
    if (isRequestInFlight && currentAbortController) {
      console.log(`[VS-AI-STREAM] ${Date.now()} controller-aborted in loadConversation`);
      try { currentAbortController.abort(); } catch(e) {}
    }
    isRequestInFlight = false;
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

      if (data.conversation && data.conversation.title) {
        currentConversationTitle = data.conversation.title;
      } else {
        const cachedConv = allConversationsCache.find(c => c.id === convId);
        currentConversationTitle = cachedConv ? cachedConv.title : '';
      }

      if (data.messages && data.messages.length > 0) {
        let prevUserPrompt = '';
        data.messages.forEach(m => {
          if (m.role === 'user') {
            prevUserPrompt = m.content || '';
            appendMessage(m.role, m.content, null, null, null, false);
          } else {
            appendMessage(m.role, m.content, m.meta ? m.meta.citations : null, prevUserPrompt, null, false);
          }
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
    if (isRequestInFlight && currentAbortController) {
      console.log(`[VS-AI-STREAM] ${Date.now()} controller-aborted in startNewChat`);
      try { currentAbortController.abort(); } catch(e) {}
    }
    isRequestInFlight = false;
    cancelAutoRetry();
    currentConvId = null;
    currentConversationTitle = null;
    lastSentPrompt = '';
    lastSentAttachments = [];
    pendingClarificationSubmission = null;
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
    document.querySelectorAll('.vs-ai-interactive-question-box').forEach(qBox => {
      if (typeof qBox._syncClarifAttachments === 'function') {
        qBox._syncClarifAttachments();
      }
    });
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

    document.querySelectorAll('.vs-ai-interactive-question-box').forEach(qBox => {
      if (typeof qBox._syncClarifAttachments === 'function') {
        qBox._syncClarifAttachments();
      }
    });

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

  function renderInteractiveQuestion(rawText) {
    const rawLines = rawText.split('\n').map(l => l.trim());
    const qList = [];
    let currentQ = null;
    let pendingId = null;

    for (const line of rawLines) {
      if (!line) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('id:')) {
        pendingId = line.slice(3).trim();
        if (currentQ && currentQ.options.length === 0 && !currentQ.id) {
          currentQ.id = pendingId;
          pendingId = null;
        }
      } else if (lower.startsWith('question:')) {
        if (currentQ && currentQ.options.length > 0) {
          qList.push(currentQ);
        }
        currentQ = {
          id: pendingId || '',
          title: line.slice(9).trim(),
          options: []
        };
        pendingId = null;
      } else if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
        const opt = line.replace(/^[-*\d.]+\s*/, '').trim();
        if (opt && !opt.toLowerCase().startsWith('other') && !opt.toLowerCase().startsWith('any other')) {
          if (!currentQ) {
            currentQ = { id: pendingId || '', title: 'Clarification / Confirmation Required', options: [] };
            pendingId = null;
          }
          currentQ.options.push(opt);
        }
      } else if (!currentQ) {
        currentQ = { id: pendingId || '', title: line, options: [] };
        pendingId = null;
      }
    }
    if (currentQ && currentQ.options.length > 0) {
      qList.push(currentQ);
    }
    if (qList.length === 0) {
      qList.push({ id: 'q_1', title: 'Clarification / Confirmation Required', options: ['Yes', 'No'] });
    }

    const slides = qList.slice(0, 5);
    const totalSlides = slides.length;
    const boxId = 'vs-ai-qbox-' + Math.random().toString(36).substring(2, 9);

    return `
      <div class="vs-ai-interactive-question-box" id="${boxId}" data-qcount="${totalSlides}" data-active-slide="0">
        <div class="vs-ai-question-slide-header">
          <span class="vs-ai-question-progress-badge">Question 1 of ${totalSlides}</span>
          <div class="vs-ai-question-step-dots" role="tablist" aria-label="Clarification Questions Progress">
            ${slides.map((_, sIdx) => `
              <button type="button" class="vs-ai-question-step-dot ${sIdx === 0 ? 'active' : ''}" data-step="${sIdx}" title="Question ${sIdx + 1} of ${totalSlides}" aria-label="Question ${sIdx + 1} of ${totalSlides}"></button>
            `).join('')}
          </div>
        </div>
        ${slides.map((q, qIdx) => `
          <div class="vs-ai-question-section" data-qidx="${qIdx}" data-qid="${escapeHtml(q.id || ('q_' + (qIdx + 1)))}" aria-hidden="${qIdx === 0 ? 'false' : 'true'}" style="${qIdx === 0 ? '' : 'display:none;'}">
            <div class="vs-ai-question-title">
              <svg class="i" style="width:16px;height:16px;color:#2563eb;flex-shrink:0;" aria-hidden="true"><use href="#ai"/></svg>
              <span>${escapeHtml(q.title)}</span>
            </div>
            <div class="vs-ai-question-options" role="radiogroup" aria-label="${escapeHtml(q.title)}">
              ${q.options.map(opt => `
                <button type="button" class="vs-ai-question-opt-btn" data-val="${escapeHtml(opt)}" role="radio" aria-checked="false" aria-label="${escapeHtml(opt)}">
                  <span class="vs-ai-radio-dot"></span>
                  <span class="vs-ai-opt-text">${escapeHtml(opt)}</span>
                </button>
              `).join('')}
              <div class="vs-ai-question-other-wrap">
                <button type="button" class="vs-ai-question-opt-btn vs-ai-opt-other" data-val="__other__" role="radio" aria-checked="false" aria-label="Any other answer">
                  <span class="vs-ai-radio-dot"></span>
                  <span class="vs-ai-opt-text">Any other answer</span>
                </button>
                <div class="vs-ai-other-specify-label" style="display:none; font-size:12px; font-weight:600; color:#475569; margin:6px 0 2px 4px;">Please specify:</div>
                <input type="text" class="vs-ai-question-other-input" placeholder="Type your custom answer here..." style="display:none;" />
              </div>
            </div>
          </div>
        `).join('')}
        <div class="vs-ai-clarif-upload-bar" style="margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px dashed #93c5fd;border-radius:10px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn secondary btn-sm vs-ai-btn-clarif-upload" style="background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;font-weight:600;">
                <svg class="i" style="width:13px;height:13px;margin-right:4px;" aria-hidden="true"><use href="#clip"/></svg>
                <span>📎 Upload Notice / Reference Document</span>
              </button>
              <span style="font-size:11.5px;color:#64748b;">Attach Notice PDF, GSTR-2B/3B Mismatch, AIS/26AS, or Preferred Format (.docx/.pdf)</span>
            </div>
          </div>
          <div class="vs-ai-clarif-attached-list" style="display:none;flex-wrap:wrap;gap:6px;"></div>
        </div>
        <div class="vs-ai-question-submit-row" style="margin-top:14px;">
          <button type="button" class="btn secondary btn-sm vs-ai-btn-prev-question" style="${totalSlides > 1 ? 'visibility:hidden;' : 'display:none;'}" disabled>
            <span>← Previous</span>
          </button>
          <div class="vs-ai-question-submit-actions">
            <button type="button" class="btn primary btn-sm vs-ai-btn-next-question" style="${totalSlides > 1 ? '' : 'display:none;'}" disabled>
              <span>Continue →</span>
            </button>
            <button type="button" class="btn primary btn-sm vs-ai-btn-submit-choice" style="${totalSlides === 1 ? '' : 'display:none;'}" disabled>
              <span>Submit Answers</span>
              <svg class="i" style="width:12px;height:12px;" aria-hidden="true"><use href="#send"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderMarkdown(md) {
    if (!md) return '';

    const placeholders = [];
    let text = md;

    // 0. Coalesce multiple ```question ... ``` blocks in the same message into a single sequential slide-wise widget
    const questionBlocks = [];
    text = text.replace(/```question\s*([\s\S]*?)```/gi, (match, qCode) => {
      questionBlocks.push(qCode.trim());
      return questionBlocks.length === 1 ? '@@@VSAI_MERGED_QUESTIONS@@@' : '';
    });
    if (questionBlocks.length > 0) {
      const mergedQHtml = renderInteractiveQuestion(questionBlocks.join('\n\n'));
      const qPhIdx = placeholders.length;
      placeholders.push(mergedQHtml);
      text = text.replace('@@@VSAI_MERGED_QUESTIONS@@@', `\n\n@@@VSAI_PH_${qPhIdx}@@@\n\n`);
    }

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

      if (cleanLang === 'question') {
        const qHtml = renderInteractiveQuestion(cleanCode);
        const idx = placeholders.length;
        placeholders.push(qHtml);
        return `\n\n@@@VSAI_PH_${idx}@@@\n\n`;
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
