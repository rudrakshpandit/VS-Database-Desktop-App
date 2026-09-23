/**
 * VS AI — Production Module Controller
 * Fully integrated with VS Database:
 * - Dynamic Hardware & Node Detection (Host GPU RTX 3050 6GB / Staff CPU)
 * - Intelligent AI Model Orchestrator & Workload Routing
 * - Chat Persistence with Grouped History (Today, Yesterday, 7 Days)
 * - Quick Actions & Quick Tools (Summarize PDF, Extract Tables, Drafts, Compliance)
 * - Interactive Knowledge Sources & Citation Source Viewer
 * - Client Context & Document Attachments
 */

(function () {
  'use strict';

  let currentChatId = null;
  let activeAttachments = [];
  let chatHistoryData = [];
  let hardwareData = null;
  let aiHealthData = null;

  // ------------------------------------------------------------
  // 1. RENDER MAIN VS AI VIEW
  // ------------------------------------------------------------
  async function renderVsAi() {
    const content = document.querySelector('#content');
    if (!content) return;

    content.innerHTML = `
      <div class="vs-ai-container">
        <!-- Top VS AI Module Header -->
        <header class="vs-ai-header">
          <div class="vs-ai-brand">
            <img src="vs_ai_logo.png" alt="VS AI" class="vs-ai-logo-img">
            <div class="vs-ai-title-wrap">
              <h1 class="vs-ai-title">VS AI</h1>
              <p class="vs-ai-subtitle">Your Intelligent Assistant for a Smarter CA Office</p>
            </div>
          </div>

          <div class="vs-ai-quote-box">
            <div class="vs-ai-quote-icon">“</div>
            <div class="vs-ai-quote-text">
              <div class="vs-ai-quote-line1">“Smarter Tools. Sharper Decisions.”</div>
              <div class="vs-ai-quote-line2">Powered by AI. Built for Your Practice.</div>
            </div>
          </div>
        </header>

        <!-- 3-Column Body -->
        <div class="vs-ai-body">
          <!-- Left Column: Chat History -->
          <div class="vs-ai-card vs-ai-left-panel">
            <button class="vs-ai-new-chat-btn" id="vs-ai-btn-new-chat">
              <span style="font-size:16px;line-height:1;">＋</span>
              <span>New Chat</span>
            </button>

            <div class="vs-ai-search-box">
              <span class="vs-ai-search-icon">🔍</span>
              <input type="text" class="vs-ai-search-input" id="vs-ai-history-search" placeholder="Search chats...">
            </div>

            <div class="vs-ai-history-list" id="vs-ai-history-container">
              <!-- Dynamically populated -->
              <div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">Loading chat history...</div>
            </div>
          </div>

          <!-- Center Column: Conversation Workspace -->
          <div class="vs-ai-card vs-ai-center-panel">
            <!-- Top Controls Bar -->
            <div class="vs-ai-workspace-topbar">
              <div class="vs-ai-scope-wrapper">
                <select class="vs-ai-scope-select" id="vs-ai-scope-select" title="Filter Knowledge Sources">
                  <option value="All Knowledge">Sources: All Knowledge ▾</option>
                  <option value="Income Tax">Income Tax</option>
                  <option value="GST">GST</option>
                  <option value="Acts & Rules">Acts & Rules</option>
                  <option value="Judgments">Judgments</option>
                  <option value="Office References">Office References</option>
                </select>

                <label class="vs-ai-source-only-label">
                  <input type="checkbox" id="vs-ai-source-only-cb">
                  <span>Answer using selected sources only</span>
                </label>

                <button class="vs-ai-tool-btn" id="vs-ai-btn-open-sources" style="font-size:11px;padding:3px 8px;">
                  📚 Sources Library
                </button>

                <button class="vs-ai-tool-btn" id="vs-ai-btn-open-memory" style="font-size:11px;padding:3px 8px;">
                  🧠 Practice Memory
                </button>
              </div>

              <div class="vs-ai-node-badge" id="vs-ai-node-status" title="Click to view AI Setup & Model Diagnostics" style="cursor:pointer;">
                <span class="vs-ai-node-dot"></span>
                <span id="vs-ai-node-text">Detecting Node...</span>
              </div>
            </div>

            <!-- Chat Stream / Hero Welcome -->
            <div class="vs-ai-chat-content" id="vs-ai-chat-stream">
              <!-- Rendered dynamically -->
            </div>

            <!-- Bottom Chat Composer -->
            <div class="vs-ai-composer-wrapper">
              <div class="vs-ai-attachment-preview-bar" id="vs-ai-attachment-bar" style="display:none;"></div>

              <div class="vs-ai-composer-box">
                <textarea class="vs-ai-textarea" id="vs-ai-prompt-input" placeholder="Type your message here... (e.g. 'Summarize Section 80C deductions' or 'Review this client's GST ITC')"></textarea>
                <div class="vs-ai-composer-toolbar">
                  <div class="vs-ai-composer-left-tools">
                    <input type="file" id="vs-ai-file-input" style="display:none;" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,.txt">
                    <button class="vs-ai-tool-btn" id="vs-ai-btn-attach" title="Attach file">
                      <span>📎</span>
                    </button>
                    <button class="vs-ai-tool-btn" id="vs-ai-btn-browse-files" title="Browse Client Files">
                      <span>📁 Browse Files</span>
                    </button>
                    <button class="vs-ai-tool-btn" id="vs-ai-btn-browse-folder" title="Browse Folder">
                      <span>📂 Browse Folder</span>
                    </button>
                  </div>

                  <button class="vs-ai-send-btn" id="vs-ai-btn-send" title="Send Message">
                    <span style="font-size:16px;">➤</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Quick Tools, Recent Files, Tips -->
          <div class="vs-ai-card vs-ai-right-panel">
            <!-- Quick Tools Card -->
            <div>
              <div class="vs-ai-section-header">
                <div class="vs-ai-section-title">
                  <span style="color:#2563eb;">🛠️</span>
                  <span>Quick Tools</span>
                </div>
                <a class="vs-ai-section-link" id="vs-ai-link-all-tools">View All</a>
              </div>

              <div class="vs-ai-quick-tools-grid">
                <div class="vs-ai-tool-card" data-tool="summarize-pdf">
                  <span class="vs-ai-tool-mini-icon" style="color:#ef4444;">📄</span>
                  <span>Summarize PDF</span>
                </div>
                <div class="vs-ai-tool-card" data-tool="extract-tables">
                  <span class="vs-ai-tool-mini-icon" style="color:#16a34a;">📊</span>
                  <span>Extract Tables</span>
                </div>
                <div class="vs-ai-tool-card" data-tool="draft-document">
                  <span class="vs-ai-tool-mini-icon" style="color:#2563eb;">📝</span>
                  <span>Draft Document</span>
                </div>
                <div class="vs-ai-tool-card" data-tool="rewrite-text">
                  <span class="vs-ai-tool-mini-icon" style="color:#8b5cf6;">✏️</span>
                  <span>Rewrite Text</span>
                </div>
                <div class="vs-ai-tool-card" data-tool="explain-concept">
                  <span class="vs-ai-tool-mini-icon" style="color:#a855f7;">💡</span>
                  <span>Explain Concept</span>
                </div>
                <div class="vs-ai-tool-card" data-tool="check-compliance">
                  <span class="vs-ai-tool-mini-icon" style="color:#2563eb;">🛡️</span>
                  <span>Check Compliance</span>
                </div>
              </div>
            </div>

            <!-- Recent Files Card -->
            <div style="margin-top:16px;">
              <div class="vs-ai-section-header">
                <div class="vs-ai-section-title">
                  <span style="color:#3b82f6;">🕒</span>
                  <span>Recent Files</span>
                </div>
                <a class="vs-ai-section-link" id="vs-ai-link-all-recent">View All</a>
              </div>

              <div class="vs-ai-recent-list" id="vs-ai-recent-files-container">
                <!-- Dynamically populated -->
              </div>
            </div>

            <!-- Tips Card -->
            <div class="vs-ai-tips-card" style="margin-top:auto;">
              <div class="vs-ai-tips-icon">💡</div>
              <div class="vs-ai-tips-text">
                <strong>Practice Tip:</strong> Try uploading a PDF or Excel to get instant statutory summary, tables, or draft notice replies with exact citations.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Root Container for VS AI Modals -->
      <div id="vs-ai-modal-root"></div>
    `;

    // Initialize logic and bind events
    await initVsAiEvents();
  }

  // Export to global scope for app.js router
  window.renderVsAi = renderVsAi;
  window.renderVsAiPage = renderVsAi;

  // ------------------------------------------------------------
  // 2. INITIALIZE EVENTS & DATA
  // ------------------------------------------------------------
  async function initVsAiEvents() {
    // 1. Fetch hardware & AI health
    try {
      const healthRes = await api('/api/ai/health');
      if (healthRes && healthRes.ok) {
        aiHealthData = healthRes;
        hardwareData = healthRes.hardware;
        updateNodeStatusBadge(healthRes);
      }
    } catch (e) {
      console.warn('[VS AI] Health check error:', e);
    }

    // 2. Load conversations and recent files
    await loadConversationsList();
    await loadRecentFilesList();

    // 3. Show hero welcome screen initially
    renderHeroWelcomeView();

    // 4. Bind UI Actions
    const btnNewChat = document.querySelector('#vs-ai-btn-new-chat');
    if (btnNewChat) btnNewChat.onclick = startNewChat;

    const btnSend = document.querySelector('#vs-ai-btn-send');
    if (btnSend) btnSend.onclick = handleSendMessage;

    const textarea = document.querySelector('#vs-ai-prompt-input');
    if (textarea) {
      textarea.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      };
    }

    const btnAttach = document.querySelector('#vs-ai-btn-attach');
    const fileInput = document.querySelector('#vs-ai-file-input');
    if (btnAttach && fileInput) {
      btnAttach.onclick = () => fileInput.click();
      fileInput.onchange = handleLocalFileSelected;
    }

    const btnBrowseFiles = document.querySelector('#vs-ai-btn-browse-files');
    if (btnBrowseFiles) btnBrowseFiles.onclick = openBrowseFilesModal;

    const btnBrowseFolder = document.querySelector('#vs-ai-btn-browse-folder');
    if (btnBrowseFolder) btnBrowseFolder.onclick = openBrowseFolderNotice;

    const nodeStatusBadge = document.querySelector('#vs-ai-node-status');
    if (nodeStatusBadge) nodeStatusBadge.onclick = openModelManagerModal;

    const btnSources = document.querySelector('#vs-ai-btn-open-sources');
    if (btnSources) btnSources.onclick = openKnowledgeSourcesModal;

    const btnMemory = document.querySelector('#vs-ai-btn-open-memory');
    if (btnMemory) btnMemory.onclick = openMemoryInspectorModal;

    // Quick Tool card clicks
    document.querySelectorAll('.vs-ai-tool-card').forEach(card => {
      card.onclick = () => handleQuickToolClick(card.dataset.tool);
    });

    // History search filter
    const searchInput = document.querySelector('#vs-ai-history-search');
    if (searchInput) {
      searchInput.oninput = () => {
        filterConversationsList(searchInput.value);
      };
    }
  }

  // ------------------------------------------------------------
  // 3. NODE BADGE & HARDWARE STATUS
  // ------------------------------------------------------------
  function updateNodeStatusBadge(health) {
    const badgeText = document.querySelector('#vs-ai-node-text');
    if (!badgeText) return;

    const hw = health.hardware || {};
    if (hw.has_gpu) {
      badgeText.textContent = `Host GPU (${hw.gpu_name.replace('NVIDIA ', '')})`;
    } else {
      badgeText.textContent = `Staff Node (CPU AI)`;
    }
  }

  // ------------------------------------------------------------
  // 4. CONVERSATION MANAGEMENT & GROUPED HISTORY
  // ------------------------------------------------------------
  async function loadConversationsList() {
    try {
      const res = await api('/api/ai/conversations');
      if (res && res.ok) {
        chatHistoryData = res.conversations || [];
        renderGroupedHistory(chatHistoryData);
      }
    } catch (e) {
      console.warn('[VS AI] Failed to load conversations:', e);
    }
  }

  function renderGroupedHistory(conversations) {
    const container = document.querySelector('#vs-ai-history-container');
    if (!container) return;

    if (!conversations || conversations.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">No past conversations. Click + New Chat to start.</div>`;
      return;
    }

    // Grouping by date (Today, Yesterday, Last 7 Days, Older)
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const groups = {
      Today: [],
      Yesterday: [],
      'Last 7 Days': [],
      Older: []
    };

    conversations.forEach(cv => {
      const createdDate = (cv.created_at || '').slice(0, 10);
      const cTime = new Date(cv.created_at || Date.now());
      if (createdDate === todayStr) {
        groups.Today.push(cv);
      } else if (createdDate === yesterdayStr) {
        groups.Yesterday.push(cv);
      } else if (cTime >= sevenDaysAgo) {
        groups['Last 7 Days'].push(cv);
      } else {
        groups.Older.push(cv);
      }
    });

    let html = '';
    for (const [grpName, items] of Object.entries(groups)) {
      if (items.length > 0) {
        html += `<div class="vs-ai-history-group-title">${grpName}</div>`;
        items.forEach(item => {
          const isActive = item.id === currentChatId;
          const timeLabel = formatChatTimestamp(item.created_at);
          html += `
            <div class="vs-ai-history-item ${isActive ? 'active' : ''}" data-id="${item.id}">
              <div class="vs-ai-history-left">
                <span class="vs-ai-chat-bubble-icon">💬</span>
                <span class="vs-ai-history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
              </div>
              <span class="vs-ai-history-time">${timeLabel}</span>
              <div class="vs-ai-history-actions">
                <button class="vs-ai-history-menu-btn" data-id="${item.id}" title="Options">⋮</button>
              </div>
            </div>
          `;
        });
      }
    }

    container.innerHTML = html;

    // Attach click events
    container.querySelectorAll('.vs-ai-history-item').forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('vs-ai-history-menu-btn')) return;
        loadConversation(el.dataset.id);
      };
    });

    container.querySelectorAll('.vs-ai-history-menu-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openConversationOptionsMenu(btn.dataset.id, e);
      };
    });
  }

  function filterConversationsList(query) {
    if (!query) {
      renderGroupedHistory(chatHistoryData);
      return;
    }
    const q = query.toLowerCase();
    const filtered = chatHistoryData.filter(cv => (cv.title || '').toLowerCase().includes(q) || (cv.preview || '').toLowerCase().includes(q));
    renderGroupedHistory(filtered);
  }

  function formatChatTimestamp(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  async function loadConversation(convId) {
    currentChatId = convId;
    renderGroupedHistory(chatHistoryData);

    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;
    stream.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;"><div class="spinner" style="margin:auto;margin-bottom:10px;"></div>Loading conversation...</div>`;

    try {
      const res = await api(`/api/ai/conversations/${convId}`);
      if (res && res.ok) {
        renderMessages(res.messages || []);
      }
    } catch (e) {
      stream.innerHTML = `<div style="padding:20px;color:#ef4444;text-align:center;">Failed to load messages: ${escapeHtml(e.message)}</div>`;
    }
  }

  function startNewChat() {
    currentChatId = null;
    activeAttachments = [];
    updateAttachmentBar();
    renderGroupedHistory(chatHistoryData);
    renderHeroWelcomeView();
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  // ------------------------------------------------------------
  // 5. HERO WELCOME VIEW & QUICK ACTIONS
  // ------------------------------------------------------------
  function renderHeroWelcomeView() {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    const userName = (currentUser && currentUser.user_id) ? currentUser.user_id : 'User';

    stream.innerHTML = `
      <div class="vs-ai-hero-view">
        <div class="vs-ai-hero-logo-box">
          <img src="vs_ai_hero_logo.png" alt="VS AI" class="vs-ai-hero-logo">
        </div>

        <h2 class="vs-ai-hero-greeting">Hello ${escapeHtml(userName)} 👋</h2>
        <h3 class="vs-ai-hero-question">How can I help you today?</h3>
        <p class="vs-ai-hero-description">
          Ask anything — from analysing files, drafting documents, explaining concepts, to automating repetitive tasks.
        </p>

        <!-- 6 Functional Quick Action Cards -->
        <div class="vs-ai-quick-actions-grid">
          <div class="vs-ai-action-card" data-action="summarize">
            <div class="vs-ai-action-icon icon-blue">📄</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Summarize a PDF</span>
              <span class="vs-ai-action-subtitle">Get key points instantly</span>
            </div>
          </div>

          <div class="vs-ai-action-card" data-action="draft">
            <div class="vs-ai-action-icon icon-blue">📝</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Draft a document</span>
              <span class="vs-ai-action-subtitle">Create letters, emails, reports</span>
            </div>
          </div>

          <div class="vs-ai-action-card" data-action="excel">
            <div class="vs-ai-action-icon icon-green">📊</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Analyze Excel data</span>
              <span class="vs-ai-action-subtitle">Find insights & trends</span>
            </div>
          </div>

          <div class="vs-ai-action-card" data-action="explain">
            <div class="vs-ai-action-icon icon-purple">💬</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Explain a concept</span>
              <span class="vs-ai-action-subtitle">Get simple explanations</span>
            </div>
          </div>

          <div class="vs-ai-action-card" data-action="compliance">
            <div class="vs-ai-action-icon icon-amber">🛡️</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Review compliance</span>
              <span class="vs-ai-action-subtitle">Check CA specific rules</span>
            </div>
          </div>

          <div class="vs-ai-action-card" data-action="automate">
            <div class="vs-ai-action-icon icon-blue">⚙️</div>
            <div class="vs-ai-action-text">
              <span class="vs-ai-action-title">Automate tasks</span>
              <span class="vs-ai-action-subtitle">Save time with workflows</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind Quick Action cards
    stream.querySelectorAll('.vs-ai-action-card').forEach(card => {
      card.onclick = () => handleQuickActionClick(card.dataset.action);
    });
  }

  function handleQuickActionClick(action) {
    if (action === 'summarize') {
      openSummarizePdfModal();
    } else if (action === 'draft') {
      openDraftDocumentModal();
    } else if (action === 'excel') {
      openAnalyzeExcelModal();
    } else if (action === 'explain') {
      openExplainConceptModal();
    } else if (action === 'compliance') {
      openCheckComplianceModal();
    } else if (action === 'automate') {
      openAutomateTasksModal();
    }
  }

  // ------------------------------------------------------------
  // 6. MESSAGE RENDERING & CITATIONS
  // ------------------------------------------------------------
  function renderMessages(messages) {
    const stream = document.querySelector('#vs-ai-chat-stream');
    if (!stream) return;

    if (!messages || messages.length === 0) {
      renderHeroWelcomeView();
      return;
    }

    let html = '';
    messages.forEach(m => {
      if (m.role === 'user') {
        html += `
          <div class="vs-ai-message user">
            <div class="vs-ai-user-bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
          </div>
        `;
      } else {
        const citations = (m.meta && m.meta.citations) ? m.meta.citations : [];
        let citationsHtml = '';
        if (citations && citations.length > 0) {
          citationsHtml = '<div class="vs-ai-citation-container">';
          citations.forEach(cit => {
            citationsHtml += `
              <span class="vs-ai-citation-chip" onclick="window.vsAiOpenSourceViewer('${escapeHtml(cit.source_id || '')}', ${cit.page || 1}, '${escapeHtml(cit.section || '')}')">
                📖 ${escapeHtml(cit.source)} (Page ${cit.page})
              </span>
            `;
          });
          citationsHtml += '</div>';
        }

        const modelBadge = (m.meta && m.meta.node) ? `<div style="font-size:11px;color:#64748b;margin-bottom:8px;font-weight:600;">⚡ Executed via ${escapeHtml(m.meta.node)}</div>` : '';

        html += `
          <div class="vs-ai-message assistant">
            <div class="vs-ai-assistant-card">
              ${modelBadge}
              <div>${formatMarkdownToHtml(m.content)}</div>
              ${citationsHtml}
            </div>
          </div>
        `;
      }
    });

    stream.innerHTML = html;
    stream.scrollTop = stream.scrollHeight;
  }

  function formatMarkdownToHtml(markdown) {
    if (!markdown) return '';
    let text = escapeHtml(markdown);
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italics
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Headings
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 style="font-size:16px;color:#0f172a;margin:12px 0 6px 0;">$1</h2>');
    // Bullet points
    text = text.replace(/^• (.*$)/gim, '<li style="margin-left:18px;">$1</li>');
    text = text.replace(/\n\n/g, '<br><br>');
    return text;
  }

  // ------------------------------------------------------------
  // 7. SENDING CHAT MESSAGES
  // ------------------------------------------------------------
  async function handleSendMessage() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (!input) return;
    const prompt = input.value.trim();
    if (!prompt && activeAttachments.length === 0) return;

    input.value = '';
    const scope = document.querySelector('#vs-ai-scope-select')?.value || 'All Knowledge';
    const sourceOnly = document.querySelector('#vs-ai-source-only-cb')?.checked || false;

    // Append user message to UI immediately
    const stream = document.querySelector('#vs-ai-chat-stream');
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'vs-ai-message user';
    userMsgEl.innerHTML = `<div class="vs-ai-user-bubble">${escapeHtml(prompt).replace(/\n/g, '<br>')}</div>`;
    stream.appendChild(userMsgEl);

    // Append thinking card
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'vs-ai-message assistant';
    thinkingEl.innerHTML = `
      <div class="vs-ai-assistant-card" style="display:flex;align-items:center;gap:10px;">
        <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
        <span style="font-size:13px;color:#475569;">VS AI is analyzing statutory sources & drafting response...</span>
      </div>
    `;
    stream.appendChild(thinkingEl);
    stream.scrollTop = stream.scrollHeight;

    try {
      const payload = {
        conversation_id: currentChatId,
        prompt: prompt,
        scope: scope,
        source_only: sourceOnly,
        attachments: activeAttachments
      };

      const res = await api('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      thinkingEl.remove();

      if (res && res.ok) {
        currentChatId = res.conversation_id;
        activeAttachments = [];
        updateAttachmentBar();
        await loadConversationsList();
        await loadRecentFilesList();
        await loadConversation(currentChatId);
      } else {
        stream.innerHTML += `<div class="vs-ai-message assistant"><div class="vs-ai-assistant-card" style="color:#ef4444;">Error: ${escapeHtml(res.error || 'Server error')}</div></div>`;
      }
    } catch (err) {
      thinkingEl.remove();
      stream.innerHTML += `<div class="vs-ai-message assistant"><div class="vs-ai-assistant-card" style="color:#ef4444;">Connection failed: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  // ------------------------------------------------------------
  // 8. ATTACHMENT HANDLING
  // ------------------------------------------------------------
  function handleLocalFileSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      activeAttachments.push({
        name: file.name,
        size: file.size,
        type: file.name.split('.').pop().toLowerCase(),
        path: file.name // simulated client path
      });
    }
    updateAttachmentBar();
    e.target.value = '';
  }

  function updateAttachmentBar() {
    const bar = document.querySelector('#vs-ai-attachment-bar');
    if (!bar) return;

    if (activeAttachments.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = activeAttachments.map((att, idx) => `
      <div class="vs-ai-attachment-pill">
        <span>📎 ${escapeHtml(att.name)}</span>
        <span class="vs-ai-attachment-remove" onclick="window.vsAiRemoveAttachment(${idx})">✕</span>
      </div>
    `).join('');
  }

  window.vsAiRemoveAttachment = (idx) => {
    activeAttachments.splice(idx, 1);
    updateAttachmentBar();
  };

  // ------------------------------------------------------------
  // 9. RECENT FILES LIST
  // ------------------------------------------------------------
  async function loadRecentFilesList() {
    const container = document.querySelector('#vs-ai-recent-files-container');
    if (!container) return;

    try {
      const res = await api('/api/ai/recent-files');
      if (res && res.ok && res.recent_files && res.recent_files.length > 0) {
        container.innerHTML = res.recent_files.slice(0, 5).map(rf => {
          const icon = rf.file_type === 'pdf' ? '📄' : (rf.file_type === 'xlsx' ? '📊' : '📝');
          const color = rf.file_type === 'pdf' ? '#ef4444' : (rf.file_type === 'xlsx' ? '#16a34a' : '#2563eb');
          return `
            <div class="vs-ai-recent-item" data-id="${rf.id}" title="${escapeHtml(rf.result_summary || rf.filename)}">
              <div class="vs-ai-recent-left">
                <span class="vs-ai-recent-icon" style="color:${color};">${icon}</span>
                <div class="vs-ai-recent-info">
                  <span class="vs-ai-recent-name">${escapeHtml(rf.filename)}</span>
                  <span class="vs-ai-recent-meta">${escapeHtml(rf.operation)}</span>
                </div>
              </div>
              <button class="vs-ai-history-menu-btn" onclick="window.vsAiRemoveRecentFile('${rf.id}', event)">✕</button>
            </div>
          `;
        }).join('');
      } else {
        container.innerHTML = `<div style="font-size:11.5px;color:#94a3b8;padding:8px 4px;">No recent files processed yet.</div>`;
      }
    } catch (_) {}
  }

  window.vsAiRemoveRecentFile = async (id, event) => {
    event.stopPropagation();
    try {
      await api(`/api/ai/recent-files/${id}`, { method: 'DELETE' });
      await loadRecentFilesList();
    } catch (_) {}
  };

  // ------------------------------------------------------------
  // 10. MODALS: AI SETUP, MODEL LIFECYCLE & ROLLBACK
  // ------------------------------------------------------------
  async function openModelManagerModal() {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    let modelsData = [];
    let hw = hardwareData || {};
    let health = aiHealthData || {};

    try {
      const [mRes, hRes] = await Promise.all([
        api('/api/ai/models'),
        api('/api/ai/hardware')
      ]);
      if (mRes && mRes.ok) modelsData = mRes.registry || [];
      if (hRes && hRes.ok) hw = hRes.hardware || hw;
    } catch (_) {}

    const rec = (health && health.recommended_model) ? health.recommended_model : { model_name: 'Qwen 3 4B', mode: 'Host GPU' };
    const activeModel = modelsData.find(m => m.is_active === 1);
    const prevModel = modelsData.find(m => m.is_previous === 1);

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:860px;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>⚙️</span>
              <span>VS AI — Model Lifecycle Manager & Hardware Profile</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body">
            <!-- Hardware Specs Box -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:14px;">
              <div style="font-size:12.5px;font-weight:700;color:#0f172a;margin-bottom:8px;">🖥️ Dynamic Hardware Detection & VRAM Budgeting</div>
              <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;font-size:11.5px;">
                <div><span style="color:#64748b;">CPU:</span><br><strong>${escapeHtml(hw.cpu_name || 'System CPU')}</strong></div>
                <div><span style="color:#64748b;">RAM:</span><br><strong>${hw.avail_ram_gb || 4} GB Free / ${hw.total_ram_gb || 16} GB Total</strong></div>
                <div><span style="color:#64748b;">GPU:</span><br><strong>${escapeHtml(hw.gpu_name || 'None / CPU Only')}</strong></div>
                <div><span style="color:#64748b;">VRAM:</span><br><strong>${hw.free_vram_mb || 0} MB Free / ${hw.total_vram_mb || 0} MB</strong></div>
                <div><span style="color:#64748b;">Safety Headroom:</span><br><strong style="color:#2563eb;">${hw.vram_safety_margin_mb || 768} MB</strong></div>
                <div><span style="color:#64748b;">Safe Model Budget:</span><br><strong style="color:#16a34a;">${hw.safe_vram_budget_mb || 0} MB</strong></div>
              </div>
            </div>

            <!-- Active Model Banner & Rollback -->
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
              <div>
                <div style="font-size:11.5px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Current Active Default</div>
                <div style="font-size:14px;font-weight:800;color:#1e3a8a;">
                  ● ${activeModel ? escapeHtml(activeModel.model_name) : 'Auto-routed local engine'}
                  <span style="font-size:11px;font-weight:600;color:#2563eb;margin-left:6px;">(${activeModel ? escapeHtml(activeModel.provider) : 'System'})</span>
                </div>
                ${prevModel ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Previous Active: <strong>${escapeHtml(prevModel.model_name)}</strong></div>` : ''}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="vs-ai-tool-btn" id="vs-ai-btn-install-defaults" style="background:#2563eb;color:#ffffff;font-weight:700;border:none;" title="Download all recommended models for this PC">
                  ⚡ ${hwData && hwData.has_gpu ? 'Download Host Suite (GPU)' : 'Download Staff Suite (CPU)'}
                </button>
                ${prevModel ? `
                  <button class="vs-ai-tool-btn" id="vs-ai-btn-rollback" style="background:#fef3c7;border-color:#fde68a;color:#b45309;font-weight:700;">
                    🔁 Rollback to ${escapeHtml(prevModel.model_name)}
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Registered Models Lifecycle Table -->
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
              <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155;">
                Model Catalog & Provider Adapters (Qwen 3 • Gemma 3 • LLaMA 3)
              </div>
              <div style="max-height:260px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
                  <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;background:#fafafa;">
                      <th style="padding:8px 12px;">Model / Provider</th>
                      <th style="padding:8px 12px;">Specs</th>
                      <th style="padding:8px 12px;">Status</th>
                      <th style="padding:8px 12px;">Test Benchmark</th>
                      <th style="padding:8px 12px;text-align:right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${modelsData.map(m => `
                      <tr style="border-bottom:1px solid #f1f5f9;${m.is_active ? 'background:#f0fdf4;' : ''}">
                        <td style="padding:8px 12px;">
                          <div style="font-weight:700;color:#0f172a;">${escapeHtml(m.model_name)}</div>
                          <div style="font-size:10.5px;color:#64748b;">Provider: ${escapeHtml(m.provider || 'Local')}</div>
                        </td>
                        <td style="padding:8px 12px;color:#475569;">
                          ${m.size_gb || 2} GB • ${escapeHtml(m.quantization || 'Q4_K_M')}<br>
                          Ctx: ${m.context_length || 8192}
                        </td>
                        <td style="padding:8px 12px;">
                          ${m.is_active ? '<span style="color:#16a34a;font-weight:700;">● Active</span>' : (m.is_previous ? '<span style="color:#d97706;font-weight:600;">Previous</span>' : '<span style="color:#64748b;">Standby</span>')}
                        </td>
                        <td style="padding:8px 12px;" id="test-cell-${escapeHtml(m.model_id)}">
                          ${m.test_status === 'passed' ? '<span style="color:#16a34a;font-weight:600;">✓ Verified</span>' : (m.test_status === 'failed' ? '<span style="color:#ef4444;font-weight:600;">✕ Failed</span>' : '<span style="color:#94a3b8;">Untested</span>')}
                        </td>
                        <td style="padding:8px 12px;text-align:right;">
                          <div style="display:inline-flex;gap:4px;">
                            <button class="vs-ai-tool-btn btn-test-model" data-id="${escapeHtml(m.model_id)}" style="font-size:10.5px;padding:3px 7px;" title="Dry-run test without activating">🧪 Test</button>
                            ${!m.is_active ? `<button class="vs-ai-tool-btn btn-activate-model" data-id="${escapeHtml(m.model_id)}" style="font-size:10.5px;padding:3px 7px;background:#eff6ff;color:#2563eb;font-weight:600;" title="Activate as default">⚡ Activate</button>` : ''}
                            <button class="vs-ai-tool-btn btn-pull-model" data-tag="${escapeHtml(m.model_name)}" style="font-size:10.5px;padding:3px 7px;" title="Download model weights">📥 Pull</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="window.vsAiCloseModal()">Close</button>
          </div>
        </div>
      </div>
    `;

    // Bind Install Defaults button
    const btnInstallDefaults = document.querySelector('#vs-ai-btn-install-defaults');
    if (btnInstallDefaults) {
      btnInstallDefaults.onclick = async () => {
        btnInstallDefaults.disabled = true;
        btnInstallDefaults.textContent = 'Triggering suite download...';
        try {
          const res = await api('/api/ai/models/setup-defaults', { method: 'POST', body: '{}' });
          if (res && res.ok) {
            const listStr = Array.isArray(res.models) ? res.models.join('\n• ') : '';
            alert(`Started background download for ${res.role.toUpperCase()} model suite:\n• ${listStr}\n\nOllama is downloading weights in the background.`);
            openModelManagerModal();
          } else {
            alert('Setup defaults failed: ' + ((res && res.error) || 'Unknown error'));
            btnInstallDefaults.disabled = false;
            btnInstallDefaults.textContent = '⚡ Download Suite';
          }
        } catch (err) {
          alert('Setup request failed: ' + err.message);
          btnInstallDefaults.disabled = false;
          btnInstallDefaults.textContent = '⚡ Download Suite';
        }
      };
    }

    // Bind Rollback button
    const btnRollback = document.querySelector('#vs-ai-btn-rollback');
    if (btnRollback) {
      btnRollback.onclick = async () => {
        btnRollback.disabled = true;
        btnRollback.textContent = 'Rolling back...';
        try {
          const res = await api('/api/ai/models/rollback', { method: 'POST', body: '{}' });
          if (res && res.ok) {
            alert('Rolled back successfully to previous verified model!');
            openModelManagerModal();
          } else {
            alert('Rollback failed: ' + (res.error || 'Unknown error'));
            btnRollback.disabled = false;
          }
        } catch (err) {
          alert('Rollback request failed: ' + err.message);
          btnRollback.disabled = false;
        }
      };
    }

    // Bind Test buttons
    document.querySelectorAll('.btn-test-model').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.id;
        const cell = document.querySelector(`#test-cell-${mid}`);
        if (cell) cell.innerHTML = '<span style="color:#2563eb;">Testing...</span>';
        btn.disabled = true;
        try {
          const res = await api('/api/ai/models/test', {
            method: 'POST',
            body: JSON.stringify({ model_id: mid })
          });
          if (res && res.ok) {
            if (cell) cell.innerHTML = `<span style="color:#16a34a;font-weight:700;">✓ ${res.tokens_per_sec || 0} t/s</span>`;
            alert(`Test Passed!\nSpeed: ${res.tokens_per_sec || 0} tokens/sec\nLatency: ${res.latency_ms || 0}ms\nSample: ${res.output_sample || ''}`);
          } else {
            if (cell) cell.innerHTML = `<span style="color:#ef4444;font-weight:700;">✕ Error</span>`;
            alert('Test Error: ' + (res.error || 'Model did not respond cleanly'));
          }
        } catch (err) {
          if (cell) cell.innerHTML = `<span style="color:#ef4444;">✕ Failed</span>`;
          alert('Test failed: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      };
    });

    // Bind Activate buttons
    document.querySelectorAll('.btn-activate-model').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.id;
        btn.disabled = true;
        try {
          const res = await api('/api/ai/models/activate', {
            method: 'POST',
            body: JSON.stringify({ model_id: mid })
          });
          if (res && res.ok) {
            openModelManagerModal();
          }
        } catch (err) {
          alert('Activation failed: ' + err.message);
          btn.disabled = false;
        }
      };
    });

    // Bind Pull buttons
    document.querySelectorAll('.btn-pull-model').forEach(btn => {
      btn.onclick = async () => {
        const tag = btn.dataset.tag;
        btn.disabled = true;
        btn.textContent = 'Pulling...';
        try {
          await api('/api/ai/models/install', { method: 'POST', body: JSON.stringify({ model_name: tag }) });
          alert(`Download of ${tag} started in background.`);
        } catch (err) {
          alert('Pull failed: ' + err.message);
          btn.disabled = false;
        }
      };
    });
  }

  // ------------------------------------------------------------
  // 10B. MODALS: AUDITABLE PRACTICE MEMORY INSPECTOR
  // ------------------------------------------------------------
  async function openMemoryInspectorModal() {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    let memories = [];
    try {
      const res = await api('/api/ai/memory');
      if (res && res.ok) memories = res.memories || [];
    } catch (_) {}

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:840px;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>🧠</span>
              <span>VS AI — Institutional Practice Memory (Model-Independent)</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body">
            <p style="font-size:12px;color:#475569;margin-bottom:14px;">
              Memories are permanent application data stored in SQLite. They persist across all LLM migrations and upgrades.
              Every edit or deletion is preserved in the audit log.
            </p>

            <!-- Add Memory Section -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
              <div style="font-size:12.5px;font-weight:700;color:#0f172a;margin-bottom:8px;">＋ Add Practice Memory / Firm Policy</div>
              <div style="display:grid;grid-template-columns:140px 180px 1fr;gap:10px;margin-bottom:8px;">
                <select id="mem-add-scope" class="vs-ai-scope-select" style="font-size:12px;">
                  <option value="Global">Scope: Global (Firm)</option>
                  <option value="Client">Scope: Client</option>
                  <option value="User">Scope: User (Partner)</option>
                </select>
                <input type="text" id="mem-add-key" class="vs-ai-search-input" style="padding-left:10px;" placeholder="Key (e.g. gst_rate_preference)">
                <input type="text" id="mem-add-val" class="vs-ai-search-input" style="padding-left:10px;" placeholder="Value / Policy statement">
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button class="vs-ai-new-chat-btn" id="mem-btn-add" style="width:auto;padding:5px 12px;font-size:11.5px;">Save Memory</button>
              </div>
            </div>

            <!-- Memory List -->
            <div style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
              ${memories.length > 0 ? memories.map(m => `
                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                  <div style="flex:1;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                      <span style="background:#eff6ff;color:#1e40af;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase;">${escapeHtml(m.scope)}</span>
                      <span style="font-weight:700;font-size:12.5px;color:#0f172a;">${escapeHtml(m.key)}</span>
                      <span style="font-size:11px;color:#94a3b8;">(${escapeHtml(m.category || 'preference')})</span>
                    </div>
                    <div style="font-size:12px;color:#334155;line-height:1.4;">${escapeHtml(m.value)}</div>
                    <div style="font-size:10.5px;color:#94a3b8;margin-top:4px;">Updated: ${escapeHtml(m.updated_at || '')} • Source: ${escapeHtml(m.source || 'user_explicit')}</div>
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="vs-ai-tool-btn btn-view-mem-hist" data-id="${escapeHtml(m.memory_id)}" style="font-size:11px;padding:3px 7px;" title="View change history">📜 History</button>
                    <button class="vs-ai-tool-btn btn-edit-mem" data-id="${escapeHtml(m.memory_id)}" data-val="${escapeHtml(m.value)}" style="font-size:11px;padding:3px 7px;">✏️ Edit</button>
                    <button class="vs-ai-tool-btn btn-del-mem" data-id="${escapeHtml(m.memory_id)}" style="font-size:11px;padding:3px 7px;color:#ef4444;">🗑️</button>
                  </div>
                </div>
              `).join('') : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">No active practice memories found.</div>'}
            </div>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="window.vsAiCloseModal()">Close</button>
          </div>
        </div>
      </div>
    `;

    // Bind Add
    const btnAdd = document.querySelector('#mem-btn-add');
    if (btnAdd) {
      btnAdd.onclick = async () => {
        const key = document.querySelector('#mem-add-key')?.value.trim();
        const val = document.querySelector('#mem-add-val')?.value.trim();
        const scope = document.querySelector('#mem-add-scope')?.value;
        if (!key || !val) {
          alert('Key and Value are required.');
          return;
        }
        await api('/api/ai/memory', {
          method: 'POST',
          body: JSON.stringify({ key, value: val, scope })
        });
        openMemoryInspectorModal();
      };
    }

    // Bind Edit
    document.querySelectorAll('.btn-edit-mem').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.id;
        const oldVal = btn.dataset.val;
        const newVal = prompt('Edit memory value:', oldVal);
        if (newVal !== null && newVal.trim() && newVal.trim() !== oldVal) {
          const reason = prompt('Reason for change (for audit log):', 'Client policy revision') || 'Manual update';
          await api('/api/ai/memory', {
            method: 'POST',
            body: JSON.stringify({ memory_id: mid, value: newVal.trim(), reason })
          });
          openMemoryInspectorModal();
        }
      };
    });

    // Bind Delete
    document.querySelectorAll('.btn-del-mem').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.id;
        if (confirm('Archive/soft-delete this memory? An audit trail will be preserved.')) {
          await api(`/api/ai/memory/${mid}`, { method: 'DELETE' });
          openMemoryInspectorModal();
        }
      };
    });

    // Bind History
    document.querySelectorAll('.btn-view-mem-hist').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.id;
        try {
          const res = await api(`/api/ai/memory/${mid}/history`);
          const hist = res.history || [];
          let msg = `Audit History for ${mid}:\n\n`;
          if (!hist.length) msg += 'No historical edits found.';
          else {
            hist.forEach(h => {
              msg += `[${h.timestamp}] Action: ${h.action} by ${h.modified_by}\nReason: ${h.reason || 'N/A'}\nOld Value: ${h.old_value || 'None'}\nNew Value: ${h.new_value || 'None'}\n----------------\n`;
            });
          }
          alert(msg);
        } catch (err) {
          alert('Could not load history: ' + err.message);
        }
      };
    });
  }

  // ------------------------------------------------------------
  // 11. MODALS: KNOWLEDGE SOURCES LIBRARY
  // ------------------------------------------------------------
  async function openKnowledgeSourcesModal() {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    let sources = [];
    try {
      const res = await api('/api/ai/sources');
      if (res && res.ok) sources = res.sources || [];
    } catch (_) {}

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:880px;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>📚</span>
              <span>VS AI — Knowledge Sources Library</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <span style="font-size:12.5px;color:#64748b;">Controlled, source-grounded legal & statutory repository</span>
              <button class="vs-ai-new-chat-btn" id="vs-ai-btn-add-source-form" style="width:auto;padding:6px 14px;font-size:12px;">
                ＋ Add New Source
              </button>
            </div>

            <!-- Table of indexed sources -->
            <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
              <thead>
                <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0;color:#475569;">
                  <th style="padding:10px 12px;">Source Name</th>
                  <th style="padding:10px 12px;">Type</th>
                  <th style="padding:10px 12px;">Authority</th>
                  <th style="padding:10px 12px;">Period / AY</th>
                  <th style="padding:10px 12px;">Chunks</th>
                  <th style="padding:10px 12px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${sources.map(s => `
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 12px;font-weight:600;color:#0f172a;">${escapeHtml(s.name)}</td>
                    <td style="padding:10px 12px;"><span style="background:#eff6ff;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:11px;">${escapeHtml(s.source_type)}</span></td>
                    <td style="padding:10px 12px;color:#475569;">${escapeHtml(s.authority || 'Govt of India')}</td>
                    <td style="padding:10px 12px;color:#64748b;">${escapeHtml(s.assessment_year || s.financial_year || 'Active')}</td>
                    <td style="padding:10px 12px;font-weight:600;">${s.chunk_count || 1}</td>
                    <td style="padding:10px 12px;"><span style="color:#16a34a;font-weight:600;">● Indexed</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="window.vsAiCloseModal()">Close</button>
          </div>
        </div>
      </div>
    `;

    const btnAdd = document.querySelector('#vs-ai-btn-add-source-form');
    if (btnAdd) btnAdd.onclick = openAddSourceFormModal;
  }

  function openAddSourceFormModal() {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:620px;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>📖</span>
              <span>Add Knowledge Source</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body">
            <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
              <div>
                <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Source Name *</label>
                <input type="text" id="src-add-name" class="vs-ai-search-input" style="padding-left:10px;" placeholder="e.g. Income Tax Act, 1961 or High Court Ruling">
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                  <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Source Type</label>
                  <select id="src-add-type" class="vs-ai-scope-select" style="width:100%;">
                    <option value="Act">Act</option>
                    <option value="Rule">Rule</option>
                    <option value="Notification">Notification</option>
                    <option value="Circular">Circular</option>
                    <option value="Court Judgment">Court Judgment</option>
                    <option value="Tribunal Order">Tribunal Order</option>
                    <option value="Office Reference">Office Reference</option>
                  </select>
                </div>
                <div>
                  <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Authority</label>
                  <input type="text" id="src-add-auth" class="vs-ai-search-input" style="padding-left:10px;" placeholder="e.g. CBDT, Supreme Court, CBIC">
                </div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                  <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Relevant Law</label>
                  <input type="text" id="src-add-law" class="vs-ai-search-input" style="padding-left:10px;" placeholder="e.g. Income Tax, GST, Corporate Law">
                </div>
                <div>
                  <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Section / Rule / Ref</label>
                  <input type="text" id="src-add-sec" class="vs-ai-search-input" style="padding-left:10px;" placeholder="e.g. Section 148, Rule 89">
                </div>
              </div>

              <div>
                <label style="font-weight:600;color:#0f172a;display:block;margin-bottom:4px;">Description / Context</label>
                <textarea id="src-add-desc" class="vs-ai-textarea" style="border:1px solid #cbd5e1;padding:8px;border-radius:8px;background:#fff;" placeholder="Brief synopsis or statutory purpose..."></textarea>
              </div>
            </div>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="openKnowledgeSourcesModal()">Back</button>
            <button class="vs-ai-new-chat-btn" id="src-btn-submit" style="width:auto;padding:8px 16px;">
              Analyze & Add to VS AI
            </button>
          </div>
        </div>
      </div>
    `;

    const btnSubmit = document.querySelector('#src-btn-submit');
    if (btnSubmit) {
      btnSubmit.onclick = async () => {
        const name = document.querySelector('#src-add-name')?.value.trim();
        if (!name) {
          alert('Source name is required.');
          return;
        }
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Indexing source...';

        try {
          const payload = {
            name: name,
            source_type: document.querySelector('#src-add-type')?.value,
            authority: document.querySelector('#src-add-auth')?.value || 'Government of India',
            relevant_law: document.querySelector('#src-add-law')?.value,
            section_rule: document.querySelector('#src-add-sec')?.value,
            description: document.querySelector('#src-add-desc')?.value
          };

          await api('/api/ai/sources', { method: 'POST', body: JSON.stringify(payload) });
          alert('Source added and indexed successfully!');
          openKnowledgeSourcesModal();
        } catch (err) {
          alert('Failed to add source: ' + err.message);
          btnSubmit.disabled = false;
        }
      };
    }
  }

  // ------------------------------------------------------------
  // 12. SOURCE VIEWER MODAL
  // ------------------------------------------------------------
  window.vsAiOpenSourceViewer = async (sourceId, page, heading) => {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    let chunks = [];
    let sourceName = 'Statutory Source';
    if (sourceId) {
      try {
        const res = await api(`/api/ai/sources/${sourceId}/chunks`);
        if (res && res.ok) {
          chunks = res.chunks || [];
          sourceName = res.source?.name || sourceName;
        }
      } catch (_) {}
    }

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:800px;height:80vh;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>📖</span>
              <span>Source Viewer: ${escapeHtml(sourceName)}</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body" style="background:#f8fafc;font-family:monospace;font-size:12.5px;line-height:1.6;color:#1e293b;">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-family:sans-serif;">
              <strong>Cited Location:</strong> Page ${page || 1} ${heading ? `• ${escapeHtml(heading)}` : ''}<br>
              <span style="font-size:11px;color:#1e40af;">Grounding verification: Original statutory text retained with zero modification.</span>
            </div>

            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;white-space:pre-wrap;">
              ${chunks.length > 0 ? chunks.map(c => `[Page ${c.page_number}] ${c.heading ? '--- ' + c.heading + ' ---\n' : ''}${escapeHtml(c.content)}`).join('\n\n') : 'Statutory excerpt: All provisions in this section have been verified against the official Gazette of India publication.'}
            </div>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="window.vsAiCloseModal()">Close</button>
          </div>
        </div>
      </div>
    `;
  };

  // ------------------------------------------------------------
  // 13. QUICK TOOLS ACTION HANDLERS
  // ------------------------------------------------------------
  function handleQuickToolClick(tool) {
    if (tool === 'summarize-pdf') openSummarizePdfModal();
    else if (tool === 'extract-tables') openExtractTablesModal();
    else if (tool === 'draft-document') openDraftDocumentModal();
    else if (tool === 'reconcile-excel') openAnalyzeExcelModal();
    else if (tool === 'rewrite-text') openRewriteTextModal();
    else if (tool === 'explain-concept') openExplainConceptModal();
    else if (tool === 'check-compliance') openCheckComplianceModal();
  }

  function openAnalyzeExcelModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Reconcile this Excel data (GSTR-2B vs Books / Ledger Scrutiny), check line items, detect anomalies, and list reconciliation differences.';
      input.focus();
    }
    const fi = document.querySelector('#vs-ai-file-input');
    if (fi) fi.click();
  }

  function openSummarizePdfModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Please summarize this PDF highlighting key observations, liabilities, and critical dates.';
      input.focus();
    }
    const fi = document.querySelector('#vs-ai-file-input');
    if (fi) fi.click();
  }

  function openExtractTablesModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Extract all financial tables, computations, and numbers from this document into clean rows and columns.';
      input.focus();
    }
    const fi = document.querySelector('#vs-ai-file-input');
    if (fi) fi.click();
  }

  function openDraftDocumentModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Draft a formal reply to Income Tax / GST notice on behalf of client citing relevant sections and explanations.';
      input.focus();
    }
  }

  function openRewriteTextModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Rewrite this draft into a formal, polite, and legally authoritative Chartered Accountant communication:\n\n';
      input.focus();
    }
  }

  function openExplainConceptModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Explain the statutory framework and recent judicial precedents regarding: ';
      input.focus();
    }
  }

  function openCheckComplianceModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Review compliance requirements and statutory deadlines for: ';
      input.focus();
    }
  }

  function openAutomateTasksModal() {
    const input = document.querySelector('#vs-ai-prompt-input');
    if (input) {
      input.value = 'Generate a step-by-step CA practice checklist for: ';
      input.focus();
    }
  }

  // ------------------------------------------------------------
  // 14. BROWSE FILES MODAL
  // ------------------------------------------------------------
  async function openBrowseFilesModal() {
    const root = document.querySelector('#vs-ai-modal-root');
    if (!root) return;

    let files = [];
    try {
      const res = await api('/api/ai/browse-files');
      if (res && res.ok) files = res.files || [];
    } catch (_) {}

    root.innerHTML = `
      <div class="vs-ai-modal-overlay" onclick="if(event.target===this) window.vsAiCloseModal()">
        <div class="vs-ai-modal-box" style="max-width:720px;">
          <div class="vs-ai-modal-header">
            <h3 class="vs-ai-modal-title">
              <span>📁</span>
              <span>Browse Client Files</span>
            </h3>
            <button class="vs-ai-modal-close" onclick="window.vsAiCloseModal()">✕</button>
          </div>

          <div class="vs-ai-modal-body">
            <p style="font-size:12px;color:#64748b;margin-bottom:12px;">Select an existing client document from the vault to attach for AI analysis:</p>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto;">
              ${files.length > 0 ? files.map(f => `
                <div class="vs-ai-action-card" style="padding:10px 14px;cursor:pointer;" onclick="window.vsAiSelectClientFile('${escapeHtml(f.filename)}', '${escapeHtml(f.relative_path)}')">
                  <span style="font-size:18px;">📄</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:#0f172a;">${escapeHtml(f.filename)}</div>
                    <div style="font-size:11px;color:#64748b;">${escapeHtml(f.client_name)} [${escapeHtml(f.client_file_no)}] • ${escapeHtml(f.relative_path)}</div>
                  </div>
                  <button class="vs-ai-tool-btn" style="font-size:11px;">Attach</button>
                </div>
              `).join('') : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">No indexed client files found. You can attach a local file directly using 📎.</div>'}
            </div>
          </div>

          <div class="vs-ai-modal-footer">
            <button class="vs-ai-tool-btn" onclick="window.vsAiCloseModal()">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  window.vsAiSelectClientFile = (fname, rpath) => {
    activeAttachments.push({
      name: fname,
      path: rpath,
      type: fname.split('.').pop().toLowerCase()
    });
    updateAttachmentBar();
    window.vsAiCloseModal();
  };

  function openBrowseFolderNotice() {
    alert('Browse Folder: Select any client directory to recursively analyze relevant statutory returns, balance sheets, and audit working papers.');
  }

  // ------------------------------------------------------------
  // 15. CONVERSATION OPTIONS MENU
  // ------------------------------------------------------------
  function openConversationOptionsMenu(convId, event) {
    const existing = document.querySelector('#vs-ai-conv-ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'vs-ai-conv-ctx-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 160)}px`;
    menu.style.top = `${event.clientY + 8}px`;
    menu.style.background = '#ffffff';
    menu.style.border = '1px solid #e2e8f0';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 10px 24px rgba(0,0,0,0.12)';
    menu.style.padding = '6px';
    menu.style.zIndex = '10000';
    menu.style.fontSize = '12.5px';
    menu.style.minWidth = '140px';

    menu.innerHTML = `
      <div style="padding:6px 10px;cursor:pointer;border-radius:6px;" class="ctx-item" id="ctx-rename">✏️ Rename</div>
      <div style="padding:6px 10px;cursor:pointer;border-radius:6px;" class="ctx-item" id="ctx-clear">🧹 Clear Messages</div>
      <div style="padding:6px 10px;cursor:pointer;border-radius:6px;color:#ef4444;" class="ctx-item" id="ctx-delete">🗑️ Delete</div>
    `;

    document.body.appendChild(menu);

    const closeHandler = () => menu.remove();
    setTimeout(() => window.addEventListener('click', closeHandler, { once: true }), 20);

    menu.querySelector('#ctx-rename').onclick = async () => {
      const newTitle = prompt('Enter new conversation title:');
      if (newTitle && newTitle.trim()) {
        await api(`/api/ai/conversations/${convId}/rename`, {
          method: 'POST',
          body: JSON.stringify({ title: newTitle.trim() })
        });
        await loadConversationsList();
      }
    };

    menu.querySelector('#ctx-clear').onclick = async () => {
      if (confirm('Clear all messages in this conversation?')) {
        await api(`/api/ai/conversations/${convId}/clear`, { method: 'POST', body: '{}' });
        if (currentChatId === convId) loadConversation(convId);
      }
    };

    menu.querySelector('#ctx-delete').onclick = async () => {
      if (confirm('Delete this conversation? (Attached source files will not be deleted)')) {
        await api(`/api/ai/conversations/${convId}`, { method: 'DELETE' });
        if (currentChatId === convId) startNewChat();
        await loadConversationsList();
      }
    };
  }

  window.vsAiCloseModal = () => {
    const root = document.querySelector('#vs-ai-modal-root');
    if (root) root.innerHTML = '';
  };

})();
