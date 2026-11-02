/**
 * VS DATABASE — AUTOMATION WORKSPACE (Frontend Controller)
 * 1. Automation Landing Page (Card A: Bank Statement to Tally, Card B: Ask Tally)
 * 2. Bank Statement to Tally (Guided Stepper, Parsing, Review Table, Bulk Mapping, Posting)
 * 3. Ask Tally (Conversational accounting Q&A grounded with live Tally data & Gemini)
 */

(function () {
  'use strict';

  let currentSubTab = 'landing'; // landing, import, ask-tally
  let tallyStatus = { tally_port_open: false, status_state: 'Checking...', active_company: null };
  let activeCompany = '';
  let availableCompanies = [];
  let availableMasters = { ledgers: [], groups: [], voucher_types: [] };

  // In-progress import session state
  let currentSessionId = null;
  let currentSessionData = null;
  let importStep = 1; // 1: Company & Config, 2: Upload, 3: Review & Map, 4: Confirm & Post
  let sessionTransactions = [];
  let selectedTxnIds = new Set();
  let currentSearchQuery = '';
  let currentDirectionFilter = '';
  let currentStatusFilter = '';

  // Ask Tally chat state
  let askTallySessionId = null;
  let askTallyMessages = [];

  // Synchronized inline Tally logo generator
  function tallyLogo(extraClass = '') {
    return `<img src="tally_logo.png" alt="Tally" class="tally-inline-logo ${extraClass}" />`;
  }

  // =========================================================================
  // MAIN ENTRY POINT (Called from app.js router)
  // =========================================================================
  window.automationPage = function () {
    const content = document.querySelector('#content');
    if (!content) return;

    // 1. Instantly render the automation shell synchronously (0ms, zero flicker)
    renderAutomationShell();

    // 2. Fetch/update Tally connection status in the background
    checkTallyStatus().then(() => {
      updateTallyStatusUI();
    }).catch(() => {});
  };

  async function checkTallyStatus(force = false) {
    try {
      const url = force ? '/api/automation/status?force=1' : '/api/automation/status';
      const res = await api(url);
      if (res && res.ok) {
        tallyStatus = res.status;
        activeCompany = tallyStatus.active_company || activeCompany;
      }
    } catch (e) {
      tallyStatus = { tally_port_open: false, status_state: 'Tally not reachable', recovery_instruction: e.message };
    }
  }

  function updateTallyStatusUI() {
    const pill = document.querySelector('#auto-header-status-pill');
    if (pill) {
      pill.setAttribute('data-t', tallyStatus.recovery_instruction || 'TallyPrime status');
      pill.innerHTML = `
        <span class="auto-status-dot ${tallyStatus.tally_port_open ? '' : 'offline'}"></span>
        <span>${tallyStatus.status_state || 'Tally Checking...'}</span>
      `;
    }
    const dot = document.querySelector('#auto-conn-card-dot');
    if (dot) {
      dot.className = `auto-status-dot ${tallyStatus.tally_port_open ? '' : 'offline'}`;
    }
    const desc = document.querySelector('#auto-conn-card-desc');
    if (desc) {
      desc.textContent = tallyStatus.recovery_instruction || (tallyStatus.tally_port_open ? 'Ready on port 9000' : 'XML Server offline');
    }
    const askTag = document.querySelector('#auto-ask-tally-tag');
    if (askTag) {
      askTag.textContent = tallyStatus.tally_port_open ? '● Connector Online' : '○ Requires Tally XML Port 9000';
    }

    const launchBtn = document.querySelector('#auto-btn-launch-tally');
    if (launchBtn) {
      launchBtn.style.display = (tallyStatus.tally_installed && !tallyStatus.tally_port_open) ? 'inline-flex' : 'none';
    }
    const step1Launch = document.querySelector('#auto-step1-btn-launch-tally');
    if (step1Launch) {
      step1Launch.style.display = (tallyStatus.tally_installed && !tallyStatus.tally_port_open) ? 'inline-flex' : 'none';
    }
  }

  async function launchTallyPrime() {
    showNativeToast('Starting TallyPrime...', 'info');
    try {
      const res = await api('/api/automation/tally/launch', {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (res && res.ok) {
        showNativeToast('TallyPrime launched! Waiting for XML server...', 'info');
        setTimeout(() => performFullTallyRefresh(), 3000);
        setTimeout(() => performFullTallyRefresh(), 7000);
      } else {
        showNativeToast(res.error || 'Could not launch TallyPrime', 'error');
      }
    } catch (e) {
      showNativeToast(`Launch failed: ${e.message}`, 'error');
    }
  }

  async function performFullTallyRefresh(btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.style.opacity = '0.6';
    }
    showNativeToast('Checking Tally & querying loaded companies...', 'info');
    try {
      await checkTallyStatus(true);
      await loadCompaniesList(true);
      updateTallyStatusUI();

      // If Step 1 is active, update dropdown and notice
      const compSelect = document.querySelector('#auto-select-company');
      const compNotice = document.querySelector('#auto-company-detect-notice');
      if (compSelect) {
        if (availableCompanies && availableCompanies.length > 0) {
          compSelect.innerHTML = availableCompanies.map(c => {
            const name = typeof c === 'string' ? c : (c.name || c.Name);
            return `<option value="${escapeHtml(name)}" ${name === activeCompany ? 'selected' : ''}>${escapeHtml(name)}</option>`;
          }).join('');
          if (!activeCompany || !availableCompanies.some(c => (typeof c === 'string' ? c : (c.name || c.Name)) === activeCompany)) {
            const first = availableCompanies[0];
            activeCompany = typeof first === 'string' ? first : (first.name || first.Name);
            compSelect.value = activeCompany;
          }
          if (compNotice) {
            compNotice.innerHTML = `<span style="color:var(--pos, #10b981);font-weight:500;">✓ Detected ${availableCompanies.length} open company in TallyPrime.</span>`;
          }
          await refreshBankAccountsDropdown(document.querySelector('#auto-workspace-body'), activeCompany);
          showNativeToast(`Detected ${availableCompanies.length} open company in TallyPrime!`, 'success');
        } else {
          compSelect.innerHTML = `<option value="">No open companies detected in Tally</option>`;
          if (compNotice) {
            compNotice.innerHTML = tallyStatus.tally_port_open
              ? `<span style="color:var(--warn, #f59e0b);">Tally XML server is running, but no company is currently open. Please open your company in TallyPrime and click Refresh.</span>`
              : `<span style="color:var(--neg, #ef4444);">Tally XML server is offline (Port 9000). Start TallyPrime and ensure XML server is enabled.</span>`;
          }
          showNativeToast(tallyStatus.tally_port_open ? 'Tally is open, but no company loaded.' : 'Tally is offline (Port 9000).', 'warning');
        }
      } else {
        if (availableCompanies && availableCompanies.length > 0) {
          showNativeToast(`Detected ${availableCompanies.length} open company in TallyPrime!`, 'success');
        } else if (tallyStatus.tally_port_open) {
          showNativeToast('Tally XML server online on port 9000 (no company open yet)', 'info');
        } else {
          showNativeToast('Tally XML server offline (Port 9000)', 'warning');
        }
      }
    } catch (err) {
      showNativeToast(`Refresh failed: ${err.message}`, 'error');
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.style.opacity = '1';
      }
    }
  }

  function renderAutomationShell() {
    const content = document.querySelector('#content');
    if (!content) return;

    content.innerHTML = `
      <div class="auto-page-container">
        <!-- Automation Header -->
        <div class="auto-header">
          <div class="auto-header-left">
            <h2 class="auto-title">Automation</h2>
            <p class="auto-subtitle">Deterministic accounting pipelines & AI-grounded Tally copilot</p>
          </div>
          <div class="auto-header-right">
            <div class="pill tip" id="auto-header-status-pill" data-t="${tallyStatus.recovery_instruction || 'TallyPrime status'}">
              <span class="auto-status-dot ${tallyStatus.tally_port_open ? '' : 'offline'}"></span>
              <span>${tallyStatus.status_state || 'Tally Checking...'}</span>
            </div>
          </div>
        </div>

        <!-- Connection Diagnostics Card -->
        <div class="auto-conn-card">
          <div class="auto-conn-status">
            <span class="auto-status-dot ${tallyStatus.tally_port_open ? '' : 'offline'}" id="auto-conn-card-dot"></span>
            <div class="auto-conn-info">
              <h4>${tallyLogo()} Prime Connector</h4>
              <p id="auto-conn-card-desc">${tallyStatus.recovery_instruction || (tallyStatus.tally_port_open ? 'Ready on port 9000' : 'XML Server offline')}</p>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <button type="button" class="btn primary" id="auto-btn-launch-tally" style="display:${(tallyStatus.tally_installed && !tallyStatus.tally_port_open) ? 'inline-flex' : 'none'};font-size:12.5px;padding:6px 12px;align-items:center;gap:5px;">
              🚀 Open TallyPrime
            </button>
            ${currentSubTab !== 'landing' ? `
              <button type="button" class="btn secondary" id="auto-btn-back-landing">
                ← Back to Automation
              </button>
            ` : ''}
            <button type="button" class="btn secondary" id="auto-btn-refresh-conn">
              <svg class="i" style="width:14px;height:14px;"><use href="#refresh"/></svg> Refresh Status
            </button>
          </div>
        </div>

        <!-- Dynamic Body Container -->
        <div id="auto-workspace-body"></div>
      </div>
    `;

    document.querySelector('#auto-btn-refresh-conn')?.addEventListener('click', (e) => {
      performFullTallyRefresh(e.currentTarget);
    });

    document.querySelector('#auto-btn-launch-tally')?.addEventListener('click', () => {
      launchTallyPrime();
    });

    document.querySelector('#auto-btn-back-landing')?.addEventListener('click', () => {
      currentSubTab = 'landing';
      renderAutomationWorkspace();
    });

    renderAutomationWorkspace();
  }

  function renderAutomationWorkspace() {
    const body = document.querySelector('#auto-workspace-body');
    if (!body) return;

    if (currentSubTab === 'landing') {
      renderLandingPage(body);
    } else if (currentSubTab === 'import') {
      renderBankImportWorkflow(body);
    } else if (currentSubTab === 'ask-tally') {
      renderAskTallyChat(body);
    }
  }

  // =========================================================================
  // 1. AUTOMATION LANDING PAGE (CARD A & CARD B)
  // =========================================================================
  function renderLandingPage(container) {
    container.innerHTML = `
      <div class="auto-feature-grid">
        <!-- Card A: Bank Statement to Tally -->
        <div class="auto-feature-card">
          <div>
            <div class="auto-feature-top">
              <div class="auto-feature-icon">🏦</div>
              <div class="auto-feature-meta">
                <h3>Bank Statement to ${tallyLogo()}</h3>
                <p>Convert PDF, Excel (.xlsx/.xls), CSV, or XML statements into validated Tally vouchers. Search, filter, bulk assign ledgers, and post directly to TallyPrime.</p>
              </div>
            </div>
            <div style="font-size:12px;color:var(--tx2);display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
              <span>• Decimal precision & deterministic reconciliation balance check</span>
              <span>• Reusable company-specific mapping rules & continuous learning</span>
              <span>• VS AI multi-tier ledger suggestions with toggle approval</span>
            </div>
          </div>
          <div class="auto-feature-action">
            <span style="font-size:12px;font-weight:600;color:${currentSessionId ? '#2563eb' : 'var(--tx2)'};">
              ${currentSessionId ? '● In-progress import active' : 'Ready to import'}
            </span>
            <button type="button" class="btn primary" id="auto-btn-start-import">
              ${currentSessionId ? 'Resume Import' : 'Get Started'} →
            </button>
          </div>
        </div>

        <!-- Card B: Ask Tally -->
        <div class="auto-feature-card ask-tally">
          <div>
            <div class="auto-feature-top">
              <div class="auto-feature-icon">💬</div>
              <div class="auto-feature-meta">
                <h3>Ask ${tallyLogo()}</h3>
                <p>Natural language accounting intelligence grounded entirely in live Tally data. Inspect Trial Balance, Ledger Balances, P&L, and Outstandings without hallucination.</p>
              </div>
            </div>
            <div style="font-size:12px;color:var(--tx2);display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
              <span>• Read-only safety guardrails (No unconfirmed writes)</span>
              <span>• Reuses configured VS AI engine & credentials</span>
              <span>• Direct tabular & breakdown financial presentation</span>
            </div>
          </div>
          <div class="auto-feature-action">
            <span style="font-size:12px;font-weight:600;color:var(--tx2);" id="auto-ask-tally-tag">
              ${tallyStatus.tally_port_open ? '● Connector Online' : '○ Requires Tally XML Port 9000'}
            </span>
            <button type="button" class="btn primary" id="auto-btn-open-ask-tally">
              Open Ask Tally →
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#auto-btn-start-import')?.addEventListener('click', () => {
      currentSubTab = 'import';
      renderAutomationShell();
      loadCompaniesList().then(() => {
        if (currentSubTab === 'import' && importStep === 1) {
          const body = document.querySelector('#auto-workspace-body');
          if (body) renderStep1(body);
        }
      });
    });

    container.querySelector('#auto-btn-open-ask-tally')?.addEventListener('click', () => {
      currentSubTab = 'ask-tally';
      renderAutomationShell();
      loadCompaniesList();
    });
  }

  async function loadCompaniesList(force = false) {
    try {
      const url = force ? '/api/automation/companies?force=1' : '/api/automation/companies';
      const res = await api(url);
      if (res && res.ok) {
        availableCompanies = res.companies || [];
        if (res.active_company) {
          activeCompany = res.active_company;
        } else if (!activeCompany && availableCompanies.length > 0) {
          activeCompany = typeof availableCompanies[0] === 'string' ? availableCompanies[0] : (availableCompanies[0].name || availableCompanies[0].Name || '');
        }
      }
    } catch (_) {
      availableCompanies = [];
    }
  }

  async function loadCompanyMasters(companyName) {
    if (!companyName) return;
    try {
      const res = await api(`/api/automation/masters?company=${encodeURIComponent(companyName)}`);
      if (res && res.ok) {
        availableMasters = res;
      }
    } catch (_) {
      availableMasters = { ledgers: [], groups: [], voucher_types: [] };
    }
  }

  // =========================================================================
  // 2. BANK STATEMENT TO TALLY (GUIDED WORKFLOW)
  // =========================================================================
  function renderBankImportWorkflow(container) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Stepper Header -->
        <div class="auto-stepper">
          <div class="auto-step-item ${importStep === 1 ? 'active' : (importStep > 1 ? 'completed' : '')}">
            <span class="auto-step-bubble">1</span>
            <span>Company & Bank</span>
          </div>
          <span style="color:var(--line);">───</span>
          <div class="auto-step-item ${importStep === 2 ? 'active' : (importStep > 2 ? 'completed' : '')}">
            <span class="auto-step-bubble">2</span>
            <span>Upload Statement</span>
          </div>
          <span style="color:var(--line);">───</span>
          <div class="auto-step-item ${importStep === 3 ? 'active' : (importStep > 3 ? 'completed' : '')}">
            <span class="auto-step-bubble">3</span>
            <span>Review & Map</span>
          </div>
          <span style="color:var(--line);">───</span>
          <div class="auto-step-item ${importStep === 4 ? 'active' : ''}">
            <span class="auto-step-bubble">4</span>
            <span>Approval & Post</span>
          </div>
        </div>

        <!-- Step Content -->
        <div id="auto-step-container"></div>
      </div>
    `;

    const stepContainer = container.querySelector('#auto-step-container');
    if (importStep === 1) renderStep1(stepContainer);
    else if (importStep === 2) renderStep2(stepContainer);
    else if (importStep === 3) renderStep3(stepContainer);
    else if (importStep === 4) renderStep4(stepContainer);
  }

  let selectedBankLedger = '';

  async function refreshBankAccountsDropdown(container, company) {
    const selectEl = container.querySelector('#auto-select-bank-ledger');
    const hintEl = container.querySelector('#auto-bank-hint');
    if (!selectEl) return;

    if (!company) {
      selectEl.innerHTML = `<option value="">Please select a company first</option>`;
      return;
    }

    try {
      const res = await api(`/api/automation/bank-accounts?company=${encodeURIComponent(company)}`);
      if (res && res.ok && res.bank_accounts && res.bank_accounts.length > 0) {
        selectEl.innerHTML = res.bank_accounts.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)} (Bank Account)</option>`).join('') +
          `<option value="__custom__">+ Enter Custom Ledger Name...</option>`;
        if (selectedBankLedger && res.bank_accounts.includes(selectedBankLedger)) {
          selectEl.value = selectedBankLedger;
        } else {
          selectedBankLedger = res.bank_accounts[0];
          selectEl.value = selectedBankLedger;
        }
        if (hintEl) hintEl.textContent = `Found ${res.bank_accounts.length} bank account(s) in '${company}'.`;
      } else {
        const all = (res?.all_ledgers || []).map(l => typeof l === 'string' ? l : (l.name || l.Name)).filter(Boolean);
        let opts = `<option value="Bank Account">Bank Account (Default)</option>`;
        if (all.length > 0) {
          opts += all.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
        }
        opts += `<option value="__custom__">+ Enter Custom Ledger Name...</option>`;
        selectEl.innerHTML = opts;
        selectedBankLedger = 'Bank Account';
        if (hintEl) hintEl.textContent = `No dedicated bank groups detected; select from master ledgers or enter custom name.`;
      }
    } catch (e) {
      selectEl.innerHTML = `
        <option value="Bank Account">Bank Account (Default)</option>
        <option value="__custom__">+ Enter Custom Ledger Name...</option>
      `;
      selectedBankLedger = 'Bank Account';
      if (hintEl) hintEl.textContent = `Could not query Tally bank accounts: ${e.message}`;
    }
  }

  // STEP 1: Select Company & Bank Ledger
  async function renderStep1(container) {
    if (!activeCompany && availableCompanies.length > 0) {
      const first = availableCompanies[0];
      activeCompany = typeof first === 'string' ? first : (first.name || first.Name);
    }

    container.innerHTML = `
      <div class="auto-panel-card">
        <h3 style="margin:0;font-size:17px;font-weight:700;">Step 1: Select Target Company & Financial Year</h3>
        <p style="margin:0;font-size:13px;color:var(--tx2);">Choose the Tally company where bank vouchers will be imported.</p>
        
        <div class="auto-form-row">
          <div class="auto-form-group" style="flex:1;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label style="font-weight:600;margin:0;">Tally Company *</label>
              <div style="display:flex;gap:6px;align-items:center;">
                <button type="button" class="btn secondary" id="auto-step1-btn-launch-tally" style="font-size:11.5px;padding:3px 8px;display:${(tallyStatus.tally_installed && !tallyStatus.tally_port_open) ? 'inline-flex' : 'none'};align-items:center;gap:4px;">
                  🚀 Open Tally
                </button>
                <button type="button" class="btn secondary" id="auto-step1-btn-refresh-companies" style="font-size:11.5px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;">
                  <svg class="i" style="width:12px;height:12px;"><use href="#refresh"/></svg> Refresh
                </button>
              </div>
            </div>
            <select id="auto-select-company">
              ${availableCompanies.length ? availableCompanies.map(c => {
                const name = typeof c === 'string' ? c : (c.name || c.Name);
                return `<option value="${escapeHtml(name)}" ${name === activeCompany ? 'selected' : ''}>${escapeHtml(name)}</option>`;
              }).join('') : `<option value="">No open companies detected in Tally</option>`}
            </select>
            <div id="auto-company-detect-notice" style="font-size:11.5px;margin-top:4px;">
              ${availableCompanies.length 
                ? `<span style="color:var(--pos, #10b981);font-weight:500;">✓ Detected ${availableCompanies.length} open company in TallyPrime.</span>` 
                : (tallyStatus.tally_port_open 
                  ? `<span style="color:var(--warn, #f59e0b);">Tally XML server is running, but no company is currently open. Please open your company in TallyPrime and click Refresh.</span>` 
                  : `<span style="color:var(--neg, #ef4444);">Tally XML server is offline (Port 9000). Start TallyPrime and ensure XML server is enabled.</span>`)}
            </div>
          </div>
          <div class="auto-form-group" style="flex:1;">
            <label style="font-weight:600;margin-bottom:6px;display:block;">Financial Year *</label>
            <select id="auto-select-fy">
              <option value="2026-27" selected>2026-27</option>
              <option value="2025-26">2025-26</option>
              <option value="2024-25">2024-25</option>
            </select>
          </div>
        </div>

        <div class="auto-form-row">
          <div class="auto-form-group" style="width:100%;">
            <label style="font-weight:600;">Bank Account Ledger in Tally *</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <select id="auto-select-bank-ledger" style="flex:1;">
                <option value="">Fetching bank accounts from Tally...</option>
              </select>
              <input type="text" id="auto-custom-bank-ledger" placeholder="Type custom ledger name..." style="display:none;flex:1;">
            </div>
            <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;" id="auto-bank-hint">
              Auto-detecting bank accounts for '${activeCompany}'...
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button type="button" class="btn primary" id="auto-step1-next">
            Continue to Upload Statement →
          </button>
        </div>
      </div>
    `;

    // Populate bank accounts
    await refreshBankAccountsDropdown(container, activeCompany);

    container.querySelector('#auto-step1-btn-refresh-companies')?.addEventListener('click', (e) => {
      e.preventDefault();
      performFullTallyRefresh(e.currentTarget);
    });

    container.querySelector('#auto-step1-btn-launch-tally')?.addEventListener('click', (e) => {
      e.preventDefault();
      launchTallyPrime();
    });

    container.querySelector('#auto-select-company')?.addEventListener('change', async (e) => {
      activeCompany = e.target.value;
      if (activeCompany) {
        await api('/api/automation/select-company', {
          method: 'POST',
          body: JSON.stringify({ company_name: activeCompany })
        });
        await loadCompanyMasters(activeCompany);
        await refreshBankAccountsDropdown(container, activeCompany);
      }
    });

    container.querySelector('#auto-select-bank-ledger')?.addEventListener('change', (e) => {
      const customInput = container.querySelector('#auto-custom-bank-ledger');
      if (e.target.value === '__custom__') {
        customInput.style.display = 'block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        selectedBankLedger = e.target.value;
      }
    });

    container.querySelector('#auto-step1-next')?.addEventListener('click', async () => {
      const comp = container.querySelector('#auto-select-company')?.value;
      const bankSelect = container.querySelector('#auto-select-bank-ledger');
      const customInput = container.querySelector('#auto-custom-bank-ledger');
      let bankLedger = bankSelect?.value;
      if (bankLedger === '__custom__') {
        bankLedger = customInput?.value?.trim();
      }
      if (!comp && availableCompanies.length > 0) {
        showNativeAlert('Please select a Tally company.');
        return;
      }
      activeCompany = comp || 'Default Company';
      if (!bankLedger) {
        showNativeAlert('Please select or specify the Bank Account Ledger name.');
        return;
      }
      selectedBankLedger = bankLedger;
      if (currentSessionData) {
        currentSessionData.bank_account_ledger = bankLedger;
      }
      importStep = 2;
      renderAutomationWorkspace();
    });
  }

  // STEP 2: Upload Bank Statement
  function renderStep2(container) {
    container.innerHTML = `
      <div class="auto-panel-card">
        <h3 style="margin:0;font-size:17px;font-weight:700;">Step 2: Upload Bank Statement File</h3>
        <p style="margin:0;font-size:13px;color:var(--tx2);">Supported formats: PDF, Excel (.xlsx/.xls), CSV, XML</p>

        <div class="auto-dropzone" id="auto-statement-dropzone">
          <div style="font-size:38px;">📥</div>
          <div style="font-weight:700;font-size:15px;color:var(--tx);">Drag & Drop your bank statement here</div>
          <div style="font-size:12.5px;color:var(--tx2);">or click to browse files from your computer</div>
          <input type="file" id="auto-statement-file-input" accept=".pdf,.xlsx,.xls,.csv,.xml" style="display:none;">
        </div>

        <div id="auto-upload-progress" style="display:none;font-size:13px;color:#2563eb;font-weight:600;text-align:center;">
          Parsing statement and extracting transactions...
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:10px;">
          <button type="button" class="btn secondary" id="auto-step2-back">← Back</button>
        </div>
      </div>
    `;

    const dropzone = container.querySelector('#auto-statement-dropzone');
    const fileInput = container.querySelector('#auto-statement-file-input');
    const progressEl = container.querySelector('#auto-upload-progress');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        handleStatementUpload(e.dataTransfer.files[0], progressEl);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleStatementUpload(e.target.files[0], progressEl);
      }
    });

    container.querySelector('#auto-step2-back')?.addEventListener('click', () => {
      importStep = 1;
      renderAutomationWorkspace();
    });
  }

  async function handleStatementUpload(file, progressEl) {
    if (progressEl) progressEl.style.display = 'block';
    const pb = (typeof showGlassProgressBar === 'function')
      ? showGlassProgressBar({
          title: 'Extracting Bank Statement',
          subtitle: `Parsing transactions from "${file.name}"...`,
          initialPercent: 12
        })
      : null;
    if (pb) pb.simulate(2400, 15, 90);

    try {
      const b64 = await fileToBase64(file);
      const bankLedger = selectedBankLedger || document.querySelector('#auto-select-bank-ledger')?.value || 'Bank Account';
      const fy = document.querySelector('#auto-select-fy')?.value || '2026-27';

      const res = await api('/api/automation/upload-statement', {
        method: 'POST',
        body: JSON.stringify({
          company_name: activeCompany,
          filename: file.name,
          bank_account_ledger: bankLedger,
          financial_year: fy,
          file_base64: b64
        })
      });

      if (!res.ok) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        showNativeAlert(res.error || 'Failed to parse statement', { type: 'error' });
        if (progressEl) progressEl.style.display = 'none';
        return;
      }

      currentSessionId = res.session_id;
      currentSessionData = res;
      if (pb) {
        await pb.finish(`Extracted ${res.transaction_count} transactions successfully!`, 'Extraction Complete');
      } else {
        showNativeToast(`Parsed ${res.transaction_count} transactions successfully!`, 'success');
      }

      // Move to step 3 (Review & Map)
      importStep = 3;
      await fetchSessionTransactions();
      renderAutomationWorkspace();
    } catch (e) {
      const existingPb = document.querySelector('.vs-progress-backdrop');
      if (existingPb) existingPb.remove();
      showNativeAlert(e.message, { type: 'error' });
      if (progressEl) progressEl.style.display = 'none';
    }
  }

  async function fetchSessionTransactions() {
    if (!currentSessionId) return;
    try {
      const queryParams = new URLSearchParams({
        search: currentSearchQuery || '',
        direction: currentDirectionFilter || '',
        status: currentStatusFilter || ''
      });
      const res = await api(`/api/automation/sessions/${currentSessionId}/transactions?${queryParams.toString()}`);
      if (res && res.ok) {
        sessionTransactions = res.transactions || [];
      }
    } catch (e) {
      console.error('Failed to fetch transactions:', e);
    }
  }

  // STEP 3: Transaction Review Table & Bulk Assignment
  function renderStep3(container) {
    const unassignedCount = sessionTransactions.filter(t => !t.assigned_ledger && !t.is_excluded).length;
    const assignedCount = sessionTransactions.filter(t => t.assigned_ledger && !t.is_excluded).length;
    const aiAssignedCount = sessionTransactions.filter(t => t.assigned_ledger && t.is_ai_assigned && !t.is_excluded).length;
    const suggestedPendingCount = sessionTransactions.filter(t => !t.assigned_ledger && t.suggested_ledger && !t.is_excluded).length;
    const diff = currentSessionData?.calculated_difference || 0;

    container.innerHTML = `
      <div class="auto-panel-card" style="padding:18px;">
        <!-- Statement Health Banner -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;background:rgba(255,255,255,0.7);padding:10px 16px;border-radius:var(--r-md);border:1px solid var(--bd);">
          <div style="display:flex;gap:16px;font-size:12.5px;flex-wrap:wrap;">
            <span>Transactions: <b>${sessionTransactions.length}</b></span>
            <span>Debits (Payments): <b>₹${formatCurrency(currentSessionData?.total_debits)}</b></span>
            <span>Credits (Receipts): <b>₹${formatCurrency(currentSessionData?.total_credits)}</b></span>
            <span>Assigned: <b style="color:#047857;">${assignedCount}</b></span>
            <span>AI Assigned: <b style="color:#4338ca;">${aiAssignedCount}</b></span>
            <span>Unassigned: <b style="color:${unassignedCount > 0 ? '#b91c1c' : '#047857'};">${unassignedCount}</b></span>
          </div>
          <div style="font-size:12px;font-weight:600;">
            Reconciliation: <span class="auto-badge ${currentSessionData?.reconciliation_status === 'verified' ? 'high' : 'medium'}">${currentSessionData?.reconciliation_status === 'verified' ? '✓ Reconciled (0 Diff)' : 'Difference: ₹' + formatCurrency(diff)}</span>
          </div>
        </div>

        <!-- Review Toolbar -->
        <div class="auto-toolbar">
          <div class="auto-search-wrap">
            <svg class="i" style="width:14px;height:14px;"><use href="#search"/></svg>
            <input type="text" id="auto-tx-search" placeholder="Search narration, ref, or ledger..." value="${escapeHtml(currentSearchQuery)}">
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="auto-filter-dir" style="padding:6px 10px;border-radius:var(--r-sm);border:1px solid var(--line);font-size:12.5px;">
              <option value="" ${currentDirectionFilter === '' ? 'selected' : ''}>All Directions</option>
              <option value="DEBIT" ${currentDirectionFilter === 'DEBIT' ? 'selected' : ''}>Debits Only (Payments)</option>
              <option value="CREDIT" ${currentDirectionFilter === 'CREDIT' ? 'selected' : ''}>Credits Only (Receipts)</option>
            </select>

            <select id="auto-filter-status" style="padding:6px 10px;border-radius:var(--r-sm);border:1px solid var(--line);font-size:12.5px;">
              <option value="" ${currentStatusFilter === '' ? 'selected' : ''}>All Statuses (${sessionTransactions.length})</option>
              <option value="unassigned" ${currentStatusFilter === 'unassigned' ? 'selected' : ''}>Unassigned (${unassignedCount})</option>
              <option value="assigned" ${currentStatusFilter === 'assigned' ? 'selected' : ''}>Assigned (${assignedCount})</option>
              <option value="ai_assigned" ${currentStatusFilter === 'ai_assigned' ? 'selected' : ''}>AI Assigned (${aiAssignedCount})</option>
            </select>

            <button type="button" class="btn secondary" id="auto-btn-ai-suggest" title="Suggest ledgers using VS AI">
              ✨ VS AI Suggest
            </button>

            ${suggestedPendingCount > 0 ? `
              <button type="button" class="btn secondary" id="auto-btn-accept-all" style="color:#4f46e5;border-color:#c7d2fe;background:#eef2ff;font-weight:600;" title="Accept all VS AI recommendations">
                ✓ Accept All Suggestions (${suggestedPendingCount})
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Bulk Selection Action Bar -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 2px;flex-wrap:wrap;gap:8px;">
          <div style="font-size:13px;font-weight:600;color:var(--tx2);">
            <span id="auto-selected-count">${selectedTxnIds.size}</span> selected of ${sessionTransactions.length}
          </div>
          <div class="auto-bulk-actions">
            ${selectedTxnIds.size > 0 ? `
              <button type="button" class="btn secondary" id="auto-btn-accept-selected" style="color:#4f46e5;border-color:#c7d2fe;background:#eef2ff;font-weight:600;">
                ✓ Accept Selected Suggestions
              </button>
            ` : ''}
            <button type="button" class="btn primary" id="auto-btn-bulk-assign">
              Bulk Assign Ledger ${selectedTxnIds.size > 0 ? `(${selectedTxnIds.size})` : (unassignedCount > 0 ? `(All ${unassignedCount} Unassigned)` : '')}
            </button>
            <button type="button" class="btn secondary" id="auto-btn-select-all">
              ${selectedTxnIds.size === sessionTransactions.length ? 'Deselect All' : 'Select All Filtered'}
            </button>
          </div>
        </div>

        <!-- Transaction Table -->
        <div class="auto-table-wrap">
          <table class="auto-table">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="auto-th-select-all" ${selectedTxnIds.size > 0 && selectedTxnIds.size === sessionTransactions.length ? 'checked' : ''}></th>
                <th>Date</th>
                <th>Narration</th>
                <th>Ref No.</th>
                <th>Debit (₹)</th>
                <th>Credit (₹)</th>
                <th>VS AI Suggestion</th>
                <th>Assigned Ledger</th>
                <th>Voucher</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              ${sessionTransactions.length === 0 ? `
                <tr><td colspan="10" style="text-align:center;padding:30px;color:var(--tx2);">No transactions match your search filter</td></tr>
              ` : sessionTransactions.map(t => {
                const isSel = selectedTxnIds.has(t.transaction_id);
                return `
                  <tr class="${isSel ? 'selected' : ''}" data-id="${t.transaction_id}">
                    <td><input type="checkbox" class="auto-row-checkbox" data-id="${t.transaction_id}" ${isSel ? 'checked' : ''}></td>
                    <td style="white-space:nowrap;font-weight:600;">${t.txn_date || ''}</td>
                    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.original_narration)}">${escapeHtml(t.original_narration)}</td>
                    <td style="font-family:monospace;font-size:11px;">${t.ref_number || '-'}</td>
                    <td style="font-weight:600;color:${t.debit_amount > 0 ? '#b91c1c' : 'inherit'};">${t.debit_amount > 0 ? formatCurrency(t.debit_amount) : '-'}</td>
                    <td style="font-weight:600;color:${t.credit_amount > 0 ? '#047857' : 'inherit'};">${t.credit_amount > 0 ? formatCurrency(t.credit_amount) : '-'}</td>
                    <td>
                      ${t.suggested_ledger ? `
                        <div style="display:inline-flex;align-items:center;gap:6px;">
                          <label class="sw t1 table-toggle" title="${t.is_ai_assigned ? 'Suggestion Accepted (Click to Reject)' : 'Click to Accept Suggestion'}">
                            <input type="checkbox" role="switch" class="auto-suggestion-toggle" data-id="${t.transaction_id}" ${t.is_ai_assigned ? 'checked' : ''}>
                            <span class="track">
                              <span class="lbl y">Yes</span>
                              <span class="lbl n">No</span>
                              <span class="thumb">
                                <svg class="ic tick" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
                                <svg class="ic cross" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
                              </span>
                            </span>
                          </label>
                          <span style="font-size:12px;font-weight:600;color:#4338ca;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="Suggested Head: ${escapeHtml(t.suggested_ledger)} (${escapeHtml(t.suggestion_reason || '')})">
                            💡 ${escapeHtml(t.suggested_ledger)}
                          </span>
                        </div>
                      ` : `
                        <span style="color:var(--tx2);font-size:11.5px;">-</span>
                      `}
                    </td>
                    <td>
                      ${t.assigned_ledger ? `
                        <div style="display:inline-flex;align-items:center;gap:6px;">
                          <span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#047857;background:#ecfdf5;padding:3px 8px;border-radius:6px;border:1px solid #a7f3d0;" title="Assigned ledger">
                            ✓ ${escapeHtml(t.assigned_ledger)}
                          </span>
                          ${t.is_ai_assigned ? `<span class="auto-badge ai-assigned" style="font-size:10px;padding:2px 6px;">AI Assigned</span>` : ''}
                          <button type="button" class="btn secondary auto-btn-assign-single" data-id="${t.transaction_id}" style="padding:2px 6px;font-size:11px;" title="Change Ledger">✎</button>
                        </div>
                      ` : `
                        <div style="display:inline-flex;align-items:center;gap:6px;">
                          <span style="font-weight:600;color:#ef4444;background:#fef2f2;padding:3px 8px;border-radius:6px;border:1px solid #fecaca;font-size:11.5px;">
                            Unassigned
                          </span>
                          <button type="button" class="btn secondary auto-btn-assign-single" data-id="${t.transaction_id}" style="padding:2px 8px;font-size:11px;" title="Assign Ledger">Assign</button>
                        </div>
                      `}
                    </td>
                    <td><span class="auto-badge high">${t.assigned_voucher_type || 'Payment'}</span></td>
                    <td><span class="auto-badge ${(t.confidence_category || '').toLowerCase()}">${t.confidence_category || 'Unassigned'}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Step Navigation Buttons -->
        <div style="display:flex;justify-content:space-between;margin-top:14px;">
          <button type="button" class="btn secondary" id="auto-step3-back">← Back to Upload</button>
          <button type="button" class="btn primary" id="auto-step3-next">
            Continue to Approval & Post →
          </button>
        </div>
      </div>
    `;

    // Bind Table Events
    bindStep3Events(container);
  }

  function bindStep3Events(container) {
    const searchInput = container.querySelector('#auto-tx-search');
    let debounceTimer = null;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        currentSearchQuery = e.target.value;
        await fetchSessionTransactions();
        renderStep3(container);
      }, 250);
    });

    container.querySelector('#auto-filter-dir')?.addEventListener('change', async (e) => {
      currentDirectionFilter = e.target.value;
      await fetchSessionTransactions();
      renderStep3(container);
    });

    container.querySelector('#auto-filter-status')?.addEventListener('change', async (e) => {
      currentStatusFilter = e.target.value;
      await fetchSessionTransactions();
      renderStep3(container);
    });

    // Row selection checkboxes
    container.querySelectorAll('.auto-row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selectedTxnIds.add(id);
        else selectedTxnIds.delete(id);
        updateSelectionState(container);
      });
    });

    // Select All
    container.querySelector('#auto-th-select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        sessionTransactions.forEach(t => selectedTxnIds.add(t.transaction_id));
      } else {
        selectedTxnIds.clear();
      }
      renderStep3(container);
    });

    container.querySelector('#auto-btn-select-all')?.addEventListener('click', () => {
      if (selectedTxnIds.size === sessionTransactions.length) {
        selectedTxnIds.clear();
      } else {
        sessionTransactions.forEach(t => selectedTxnIds.add(t.transaction_id));
      }
      renderStep3(container);
    });

    // Toggle switch handler for single suggestion
    container.querySelectorAll('.auto-suggestion-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const isChecked = e.target.checked;
        try {
          const endpoint = isChecked ? '/api/automation/accept-suggestions' : '/api/automation/reject-suggestions';
          const res = await api(endpoint, {
            method: 'POST',
            body: JSON.stringify({ session_id: currentSessionId, transaction_ids: [id] })
          });
          if (res.ok) {
            showNativeToast(isChecked ? 'VS AI suggestion accepted!' : 'Suggestion rejected', 'info');
            await fetchSessionTransactions();
            renderStep3(container);
          } else {
            e.target.checked = !isChecked;
            showNativeAlert(res.error, { type: 'error' });
          }
        } catch (err) {
          e.target.checked = !isChecked;
          showNativeAlert(err.message, { type: 'error' });
        }
      });
    });

    // Accept Selected Suggestions
    container.querySelector('#auto-btn-accept-selected')?.addEventListener('click', async () => {
      const ids = Array.from(selectedTxnIds);
      if (!ids.length) return;
      try {
        const res = await api('/api/automation/accept-suggestions', {
          method: 'POST',
          body: JSON.stringify({ session_id: currentSessionId, transaction_ids: ids })
        });
        if (res.ok) {
          showNativeToast(`Accepted ${res.assigned_count} selected suggestions!`, 'success');
          await fetchSessionTransactions();
          renderStep3(container);
        } else {
          showNativeAlert(res.error, { type: 'error' });
        }
      } catch (e) {
        showNativeAlert(e.message, { type: 'error' });
      }
    });

    // VS AI Suggestions
    container.querySelector('#auto-btn-ai-suggest')?.addEventListener('click', async () => {
      const pb = (typeof showGlassProgressBar === 'function')
        ? showGlassProgressBar({
            title: 'Running VS AI Recommendations',
            subtitle: 'Analyzing transaction narrations and suggesting Tally ledgers...',
            initialPercent: 12
          })
        : null;
      if (pb) pb.simulate(2200, 15, 90);

      try {
        const res = await api('/api/automation/suggest-ledgers', {
          method: 'POST',
          body: JSON.stringify({
            session_id: currentSessionId,
            company_name: activeCompany,
            auto_assign: false
          })
        });
        if (res.ok) {
          if (pb) {
            await pb.finish(`VS AI recommended ${res.suggested_count || 0} ledgers!`, 'AI Recommendation Complete');
          } else {
            showNativeToast(`Recommended ${res.suggested_count || 0} ledgers via VS AI!`, 'success');
          }
          await fetchSessionTransactions();
          renderStep3(container);
        } else {
          const existingPb = document.querySelector('.vs-progress-backdrop');
          if (existingPb) existingPb.remove();
          showNativeAlert(res.error, { type: 'error' });
        }
      } catch (e) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        showNativeAlert(e.message, { type: 'error' });
      }
    });

    // Accept All Suggestions
    container.querySelector('#auto-btn-accept-all')?.addEventListener('click', async () => {
      showNativeToast('Accepting all suggested ledgers...', 'info');
      try {
        const res = await api('/api/automation/accept-suggestions', {
          method: 'POST',
          body: JSON.stringify({ session_id: currentSessionId })
        });
        if (res.ok) {
          showNativeToast(`Accepted ${res.assigned_count} suggestions into assigned ledgers!`, 'success');
          await fetchSessionTransactions();
          renderStep3(container);
        } else {
          showNativeAlert(res.error, { type: 'error' });
        }
      } catch (e) {
        showNativeAlert(e.message, { type: 'error' });
      }
    });

    // Assign Single Transaction
    container.querySelectorAll('.auto-btn-assign-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        openBulkAssignModal(container, [id]);
      });
    });

    // Bulk Assign Ledger Modal
    container.querySelector('#auto-btn-bulk-assign')?.addEventListener('click', () => {
      openBulkAssignModal(container);
    });

    container.querySelector('#auto-step3-back')?.addEventListener('click', () => {
      importStep = 2;
      renderAutomationWorkspace();
    });

    container.querySelector('#auto-step3-next')?.addEventListener('click', async () => {
      // Validate before proceeding to Step 4
      const val = await api(`/api/automation/sessions/${currentSessionId}/validate`);
      if (!val.ok || !val.is_ready_for_posting) {
        const errs = (val.validation_errors || []).join('\n• ');
        showNativeAlert(`Validation notices:\n• ${errs}\n\nYou can still proceed to preview, but unresolved items must be addressed before posting.`, { type: 'warning' });
      }
      importStep = 4;
      renderAutomationWorkspace();
    });
  }

  function updateSelectionState(container) {
    const countEl = container.querySelector('#auto-selected-count');
    const bulkBtn = container.querySelector('#auto-btn-bulk-assign');
    const unassignedCount = sessionTransactions.filter(t => !t.assigned_ledger && !t.is_excluded).length;
    if (countEl) countEl.textContent = selectedTxnIds.size;
    if (bulkBtn) {
      bulkBtn.textContent = `Bulk Assign Ledger ${selectedTxnIds.size > 0 ? `(${selectedTxnIds.size})` : (unassignedCount > 0 ? `(All ${unassignedCount} Unassigned)` : '')}`;
    }
  }

  async function openBulkAssignModal(parentContainer, targetIds) {
    // Ensure Tally masters are loaded
    if (!availableMasters || !availableMasters.ledgers || availableMasters.ledgers.length === 0) {
      await loadCompanyMasters(activeCompany);
    }
    const masterLedgers = (availableMasters?.ledgers || []).map(l => typeof l === 'string' ? l : (l.name || l.Name)).filter(Boolean);

    const unassignedTxns = sessionTransactions.filter(t => !t.assigned_ledger && !t.is_excluded);
    const idsToAssign = targetIds || (selectedTxnIds.size > 0 ? Array.from(selectedTxnIds) : unassignedTxns.map(t => t.transaction_id));

    if (idsToAssign.length === 0) {
      showNativeAlert('All transactions in this session are already assigned to ledgers.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'vs-native-alert-overlay';
    overlay.innerHTML = `
      <div class="vs-native-alert-card" style="max-width:480px;">
        <div class="vs-native-alert-header">
          <h3>Assign Tally Ledger</h3>
        </div>
        <div style="font-size:13px;color:var(--tx2);margin-bottom:14px;">
          Mapping <b>${idsToAssign.length}</b> transaction(s) to a common Tally ledger for <b>${escapeHtml(activeCompany)}</b>.
        </div>

        <div class="auto-form-group" style="margin-bottom:12px;">
          <label style="font-weight:600;">Select from Tally Accounts Master (${masterLedgers.length} Ledgers):</label>
          <select id="auto-modal-ledger-select" style="width:100%;padding:8px 10px;font-size:13px;border-radius:var(--r-sm);border:1px solid var(--line);">
            <option value="">-- Choose Tally Master Ledger --</option>
            ${masterLedgers.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>

        <div class="auto-form-group" style="margin-bottom:12px;">
          <label style="font-weight:600;">Or Search / Type Ledger Name *</label>
          <input type="text" id="auto-modal-ledger-input" list="auto-modal-ledgers-datalist" placeholder="Search or enter ledger name..." style="width:100%;" autofocus>
          <datalist id="auto-modal-ledgers-datalist">
            ${masterLedgers.map(l => `<option value="${escapeHtml(l)}">`).join('')}
          </datalist>
          <div style="font-size:11.5px;color:var(--tx2);margin-top:4px;">
            Connected live to TallyPrime Accounts Master. Type to filter or choose from the dropdown above.
          </div>
        </div>

        <div class="auto-form-group" style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:500;">
            <input type="checkbox" id="auto-modal-save-rule" checked> Save as auto-matching rule for '${escapeHtml(activeCompany)}'
          </label>
        </div>

        <div class="vs-native-alert-actions">
          <button type="button" class="btn secondary" id="auto-modal-cancel">Cancel</button>
          <button type="button" class="btn primary" id="auto-modal-confirm">Apply Mapping</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const selectEl = overlay.querySelector('#auto-modal-ledger-select');
    const inputEl = overlay.querySelector('#auto-modal-ledger-input');

    selectEl?.addEventListener('change', (e) => {
      if (e.target.value) {
        inputEl.value = e.target.value;
      }
    });

    overlay.querySelector('#auto-modal-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#auto-modal-confirm').onclick = async () => {
      const ledger = inputEl.value.trim();
      const saveRule = overlay.querySelector('#auto-modal-save-rule').checked;
      if (!ledger) {
        showNativeAlert('Please select or specify a Tally ledger name.');
        return;
      }

      overlay.remove();
      showNativeToast(`Assigning '${ledger}' to ${idsToAssign.length} records...`, 'info');

      try {
        const res = await api('/api/automation/bulk-assign', {
          method: 'POST',
          body: JSON.stringify({
            transaction_ids: idsToAssign,
            ledger_name: ledger,
            save_as_rule: saveRule,
            rule_pattern: currentSearchQuery || ledger,
            company_name: activeCompany
          })
        });

        if (res.ok) {
          showNativeToast(`Assigned ${res.assigned_count} transactions!`, 'success');
          selectedTxnIds.clear();
          await fetchSessionTransactions();
          renderStep3(parentContainer);
        } else {
          showNativeAlert(res.error, { type: 'error' });
        }
      } catch (e) {
        showNativeAlert(e.message, { type: 'error' });
      }
    };
  }

  // STEP 4: Approval & Posting
  async function renderStep4(container) {
    const valRes = await api(`/api/automation/sessions/${currentSessionId}/validate`);
    const val = valRes.ok ? valRes : {};
    const vouchers = val.vouchers_preview || [];

    container.innerHTML = `
      <div class="auto-panel-card auto-step4-container">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--tx);">Step 4: Pre-Import Review & Approval</h3>
            <p style="margin:0;font-size:12.5px;color:var(--tx2);">Inspect final voucher details below before creating verified accounting entries in TallyPrime.</p>
          </div>
          <span class="auto-badge ${val.is_ready_for_posting ? 'high' : 'low'}" style="font-size:12px;padding:4px 10px;">
            ${val.is_ready_for_posting ? '✓ Ready for Live Posting' : '⚠️ Action Required'}
          </span>
        </div>

        <!-- KPI Summary Grid -->
        <div class="auto-step4-kpi-grid">
          <div class="auto-step4-kpi-card">
            <span class="auto-step4-kpi-label">Target Company</span>
            <span class="auto-step4-kpi-val" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(val.company_name || activeCompany)}">
              🏢 ${escapeHtml(val.company_name || activeCompany || 'Default')}
            </span>
          </div>
          <div class="auto-step4-kpi-card">
            <span class="auto-step4-kpi-label">Bank Account</span>
            <span class="auto-step4-kpi-val" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(val.bank_account_ledger || '')}">
              🏦 ${escapeHtml(val.bank_account_ledger || 'Not Set')}
            </span>
          </div>
          <div class="auto-step4-kpi-card">
            <span class="auto-step4-kpi-label">Approved Vouchers</span>
            <span class="auto-step4-kpi-val" style="color:#047857;">
              ${val.assigned_count || 0} / ${val.total_transactions || 0}
            </span>
          </div>
          <div class="auto-step4-kpi-card">
            <span class="auto-step4-kpi-label">Total Debits (₹)</span>
            <span class="auto-step4-kpi-val" style="color:#b91c1c;">
              ₹${formatCurrency(val.total_debits || 0)}
            </span>
          </div>
          <div class="auto-step4-kpi-card">
            <span class="auto-step4-kpi-label">Total Credits (₹)</span>
            <span class="auto-step4-kpi-val" style="color:#047857;">
              ₹${formatCurrency(val.total_credits || 0)}
            </span>
          </div>
        </div>

        <!-- Validation warnings if any -->
        ${val.has_edu_date_conflicts ? `
          <div class="notice warning" style="margin:0;padding:12px 16px;font-size:12.5px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;">
            <div style="font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px;">
              ⚠️ Tally Educational Mode Date Conflict (${val.edu_conflicting_count} transactions)
            </div>
            <div style="color:#b45309;margin-top:4px;line-height:1.4;">
              Dates outside the 1st, 2nd, and 31st (such as ${escapeHtml(val.edu_conflicting_dates.slice(0, 3).join(', '))}) will be rejected by Tally Educational Mode.
            </div>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#78350f;cursor:pointer;">
                <input type="checkbox" id="auto-remap-edu-dates-toggle" style="width:16px;height:16px;cursor:pointer;">
                Enable Test Date Remapping (maps voucher dates to 2nd of month for testing; original dates preserved in records)
              </label>
            </div>
          </div>
        ` : ''}

        ${(val.validation_errors || []).filter(e => !e.includes('Educational Mode')).length > 0 ? `
          <div class="notice error" style="margin:0;padding:10px 14px;font-size:12.5px;">
            <b>Validation Notices:</b><br>
            • ${(val.validation_errors || []).filter(e => !e.includes('Educational Mode')).join('<br>• ')}
          </div>
        ` : ''}

        <!-- Scrollable Table of Final Vouchers to Post -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
          <div style="font-size:12.5px;font-weight:700;color:var(--tx);">
            Final Voucher Details to Post (${vouchers.length} records)
          </div>
          <div style="font-size:11.5px;color:var(--tx2);">
            Scroll to preview all verified double-entry vouchers
          </div>
        </div>

        <div class="auto-step4-table-wrap">
          <table class="auto-step4-table">
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th>Date</th>
                <th>Type</th>
                <th>Party Ledger</th>
                <th>Bank Ledger</th>
                <th>Debit (₹)</th>
                <th>Credit (₹)</th>
                <th>Ref No.</th>
                <th>Narration</th>
              </tr>
            </thead>
            <tbody>
              ${vouchers.length === 0 ? `
                <tr><td colspan="9" style="text-align:center;padding:28px;color:var(--tx2);">No approved transactions ready for posting.</td></tr>
              ` : vouchers.map((v, idx) => `
                <tr>
                  <td style="color:var(--tx2);font-weight:600;">${idx + 1}</td>
                  <td style="white-space:nowrap;font-weight:600;">
                    ${v.txn_date}
                    ${!v.is_edu_compatible ? `<span class="auto-badge low" style="font-size:9.5px;padding:1px 4px;margin-left:4px;" title="Unsupported in Tally Educational Mode">EDU!</span>` : ''}
                  </td>
                  <td>
                    <span class="auto-badge ${v.voucher_type === 'Payment' ? 'low' : (v.voucher_type === 'Receipt' ? 'high' : 'medium')}">
                      ${v.voucher_type}
                    </span>
                  </td>
                  <td style="font-weight:600;color:var(--tx);">
                    <span style="display:inline-flex;align-items:center;gap:4px;color:#047857;background:#ecfdf5;padding:2px 6px;border-radius:4px;border:1px solid #a7f3d0;">
                      ✓ ${escapeHtml(v.assigned_ledger)}
                    </span>
                    ${v.is_ai_assigned ? `<span class="auto-badge ai-assigned" style="font-size:9.5px;padding:1px 5px;margin-left:4px;">AI</span>` : ''}
                  </td>
                  <td style="color:var(--tx2);font-weight:500;">${escapeHtml(v.bank_account_ledger)}</td>
                  <td style="font-weight:600;color:${v.debit_amount > 0 ? '#b91c1c' : 'inherit'};">
                    ${v.debit_amount > 0 ? formatCurrency(v.debit_amount) : '-'}
                  </td>
                  <td style="font-weight:600;color:${v.credit_amount > 0 ? '#047857' : 'inherit'};">
                    ${v.credit_amount > 0 ? formatCurrency(v.credit_amount) : '-'}
                  </td>
                  <td style="font-family:monospace;font-size:11px;color:var(--tx2);">${escapeHtml(v.ref_number || '-')}</td>
                  <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2);" title="${escapeHtml(v.original_narration)}">
                    ${escapeHtml(v.original_narration)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Sticky Footer Action Bar -->
        <div class="auto-step4-footer-actions">
          <button type="button" class="btn secondary" id="auto-step4-back">← Back to Review Table</button>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:12px;color:var(--tx2);display:flex;align-items:center;gap:4px;">
              Tally XML Port 9000: <b style="color:${tallyStatus.tally_port_open ? '#10b981' : '#ef4444'}">${tallyStatus.tally_port_open ? 'ONLINE' : 'OFFLINE'}</b>
            </div>
            <button type="button" class="btn primary" id="auto-step4-confirm-post" ${!val.is_ready_for_posting && !val.has_edu_date_conflicts ? 'disabled' : ''}>
              Approve & Post ${val.assigned_count || 0} Vouchers to TallyPrime 🚀
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#auto-step4-back')?.addEventListener('click', () => {
      importStep = 3;
      renderAutomationWorkspace();
    });

    container.querySelector('#auto-step4-confirm-post')?.addEventListener('click', async () => {
      const isRemapChecked = container.querySelector('#auto-remap-edu-dates-toggle')?.checked || false;
      let isEduMode = true;
      let remapEdu = false;
      let confirmedRemap = false;

      if (val.has_edu_date_conflicts) {
        if (isRemapChecked) {
          const consent = await showNativeConfirm(
            `Notice: ${val.edu_conflicting_count} transactions have dates outside 1st, 2nd, and 31st.\n\nYou have enabled Test Date Remapping. Vouchers will be written to Tally with date mapped to the 2nd of the month for test validation.\n\nOriginal dates will be preserved in your database records and noted in voucher narrations.\n\nDo you want to proceed?`,
            { title: 'Consent to Test Date Remapping' }
          );
          if (!consent) return;
          remapEdu = true;
          confirmedRemap = true;
          isEduMode = true;
        } else {
          const proceedLicensed = await showNativeConfirm(
            `Warning: ${val.edu_conflicting_count} transactions have dates that Tally Educational Mode rejects.\n\nIf your Tally instance is running with a valid Silver/Gold License, click OK to proceed.\n\nIf you are running Tally in Educational Mode, click Cancel, then enable 'Test Date Remapping'.`,
            { title: 'Tally License & Date Warning' }
          );
          if (!proceedLicensed) return;
          isEduMode = false;
        }
      } else {
        const confirmed = await showNativeConfirm(
          `Are you sure you want to approve and post ${val.assigned_count} vouchers to company '${val.company_name}'?\n\nThis will write accounting vouchers directly into TallyPrime in automatic verified batches.`,
          { title: 'Confirm Voucher Posting' }
        );
        if (!confirmed) return;
      }

      const totalTarget = val.assigned_count || 0;
      const pb = (typeof showGlassProgressBar === 'function')
        ? showGlassProgressBar({
            title: 'Posting Vouchers to TallyPrime',
            subtitle: 'Processing verified transactions...',
            initialPercent: 0
          })
        : null;

      try {
        let isDone = false;
        let lastRes = null;
        let verifiedCount = 0;

        while (!isDone) {
          const postRes = await api('/api/automation/post-vouchers', {
            method: 'POST',
            body: JSON.stringify({
              session_id: currentSessionId,
              batch_size: 50,
              run_all: false,
              is_educational_mode: isEduMode,
              remap_edu_dates: remapEdu,
              user_confirmed_remap: confirmedRemap
            })
          });

          if (!postRes.ok) {
            throw new Error(postRes.error || 'Posting failed.');
          }

          lastRes = postRes;
          verifiedCount = postRes.verified_total || 0;
          const totalSelected = postRes.total_selected || totalTarget;
          const pct = Math.floor((100 * verifiedCount) / (totalSelected || 1));

          if (pb) {
            try {
              if (typeof pb.update === 'function') {
                pb.update(pct);
              } else if (typeof pb.setPercent === 'function') {
                pb.setPercent(pct);
              }
            } catch (uiErr) {
              console.warn('[Automation] Progress bar UI update warning:', uiErr);
            }
          }

          if (postRes.is_complete || postRes.batch_posted === 0) {
            isDone = true;
          }
        }

        const totalSelected = lastRes?.total_selected || totalTarget;
        const failedTotal = lastRes?.failed_total || (totalSelected - verifiedCount);
        const hasFailures = lastRes?.has_failures || failedTotal > 0;

        if (pb && typeof pb.finish === 'function') {
          try {
            if (hasFailures) {
              await pb.finish(`Posted ${verifiedCount} of ${totalSelected} vouchers (${failedTotal} failed)`, 'Posting Incomplete');
            } else {
              await pb.finish(`Posted ${verifiedCount} vouchers successfully!`, 'Posting Complete');
            }
          } catch (_) {}
        }

        if (verifiedCount === 0) {
          renderFailureView(container, lastRes, val.company_name);
        } else if (hasFailures || verifiedCount < totalSelected) {
          renderPartialPostingView(container, lastRes, verifiedCount, failedTotal, val.company_name);
        } else {
          renderReconciliationView(container, lastRes?.reconciliation, verifiedCount, val.company_name);
        }

      } catch (e) {
        const existingPb = document.querySelector('.vs-progress-backdrop');
        if (existingPb) existingPb.remove();
        showNativeAlert(`Posting failed: ${e.message}`, { type: 'error' });
      }
    });
  }

  function renderFailureView(container, res, companyName) {
    const failedTxns = res?.failed_transactions || [];
    container.innerHTML = `
      <div class="auto-recon-card" style="border:1px solid #fecaca;background:#fff5f5;">
        <div class="auto-recon-header">
          <div>
            <h3 style="margin:0;font-size:18px;font-weight:700;color:#b91c1c;">
              ❌ Voucher Posting Failed
            </h3>
            <p style="margin:4px 0 0 0;font-size:13px;color:var(--tx2);">
              No vouchers were posted to company <b>${escapeHtml(companyName)}</b>. Tally rejected the batch.
            </p>
          </div>
          <span class="auto-badge low" style="font-size:13px;padding:6px 14px;">
            0 Posted
          </span>
        </div>

        <div style="margin-top:16px;">
          <h4 style="margin:0 0 8px 0;font-size:13.5px;color:var(--tx);">Rejection Details:</h4>
          <div class="auto-step4-table-wrap" style="max-height:260px;">
            <table class="auto-step4-table">
              <thead>
                <tr>
                  <th style="width:36px;">#</th>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Debit (₹)</th>
                  <th>Credit (₹)</th>
                  <th>Error Reason</th>
                </tr>
              </thead>
              <tbody>
                ${failedTxns.map(t => `
                  <tr>
                    <td style="font-weight:600;color:var(--tx2);">${t.row_index}</td>
                    <td style="white-space:nowrap;font-weight:600;">${t.txn_date}</td>
                    <td>${escapeHtml(t.assigned_ledger || '-')}</td>
                    <td style="color:${t.debit_amount > 0 ? '#b91c1c' : 'inherit'};font-weight:600;">
                      ${t.debit_amount > 0 ? formatCurrency(t.debit_amount) : '-'}
                    </td>
                    <td style="color:${t.credit_amount > 0 ? '#047857' : 'inherit'};font-weight:600;">
                      ${t.credit_amount > 0 ? formatCurrency(t.credit_amount) : '-'}
                    </td>
                    <td style="color:#b91c1c;font-size:12px;font-weight:500;">
                      ${escapeHtml(t.error || 'Tally rejected voucher')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:18px;">
          <button type="button" class="btn primary" id="auto-btn-failure-back">
            ← Return to Review & Fix
          </button>
        </div>
      </div>
    `;

    container.querySelector('#auto-btn-failure-back')?.addEventListener('click', () => {
      importStep = 3;
      renderAutomationWorkspace();
    });
  }

  function renderPartialPostingView(container, res, verifiedCount, failedCount, companyName) {
    const failedTxns = res?.failed_transactions || [];
    const rec = res?.reconciliation;
    const diff = rec ? rec.difference : 0;

    container.innerHTML = `
      <div class="auto-recon-card">
        <div class="auto-recon-header" style="border-bottom:1px solid #fed7aa;padding-bottom:14px;">
          <div>
            <h3 style="margin:0;font-size:18px;font-weight:700;color:#c2410c;">
              ⚠️ Partial Posting Completed: ${verifiedCount} Posted, ${failedCount} Failed
            </h3>
            <p style="margin:4px 0 0 0;font-size:13px;color:var(--tx2);">
              Target Company: <b>${escapeHtml(companyName)}</b> · Verified: <b>${verifiedCount}</b> · Failed: <b>${failedCount}</b>
            </p>
          </div>
          <span class="auto-badge medium" style="font-size:13px;padding:6px 14px;">
            ⚠️ Partial (${verifiedCount}/${verifiedCount + failedCount})
          </span>
        </div>

        <div style="margin-top:16px;">
          <h4 style="margin:0 0 8px 0;font-size:13.5px;color:var(--tx);">Failed / Rejected Transactions (${failedTxns.length}):</h4>
          <div class="auto-step4-table-wrap" style="max-height:220px;">
            <table class="auto-step4-table">
              <thead>
                <tr>
                  <th style="width:36px;">#</th>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Debit (₹)</th>
                  <th>Credit (₹)</th>
                  <th>Tally Rejection Reason</th>
                </tr>
              </thead>
              <tbody>
                ${failedTxns.map(t => `
                  <tr>
                    <td style="font-weight:600;color:var(--tx2);">${t.row_index}</td>
                    <td style="white-space:nowrap;font-weight:600;">${t.txn_date}</td>
                    <td>${escapeHtml(t.assigned_ledger || '-')}</td>
                    <td style="color:${t.debit_amount > 0 ? '#b91c1c' : 'inherit'};font-weight:600;">
                      ${t.debit_amount > 0 ? formatCurrency(t.debit_amount) : '-'}
                    </td>
                    <td style="color:${t.credit_amount > 0 ? '#047857' : 'inherit'};font-weight:600;">
                      ${t.credit_amount > 0 ? formatCurrency(t.credit_amount) : '-'}
                    </td>
                    <td style="color:#b91c1c;font-size:12px;font-weight:500;">
                      ${escapeHtml(t.error || 'Tally rejected voucher')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${rec ? `
          <div class="auto-recon-grid" style="margin-top:16px;">
            <div class="auto-recon-item">
              <span class="auto-recon-label">Opening Balance</span>
              <span class="auto-recon-val">₹${formatCurrency(rec.opening_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Total Posted Debits</span>
              <span class="auto-recon-val" style="color:#b91c1c;">₹${formatCurrency(rec.total_posted_debits)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Total Posted Credits</span>
              <span class="auto-recon-val" style="color:#047857;">₹${formatCurrency(rec.total_posted_credits)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Expected Balance (Posted)</span>
              <span class="auto-recon-val">₹${formatCurrency(rec.expected_closing_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Live Tally Closing Balance</span>
              <span class="auto-recon-val" style="color:#047857;">₹${formatCurrency(rec.actual_tally_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Unposted Audit Difference</span>
              <span class="auto-recon-val" style="color:#b91c1c;">₹${formatCurrency(diff)}</span>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">
          <button type="button" class="btn secondary" id="auto-btn-partial-retry">
            ← Return to Review Table
          </button>
          <button type="button" class="btn primary" id="auto-btn-recon-done">
            Done & Return to Automation
          </button>
        </div>
      </div>
    `;

    container.querySelector('#auto-btn-partial-retry')?.addEventListener('click', () => {
      importStep = 3;
      renderAutomationWorkspace();
    });

    container.querySelector('#auto-btn-recon-done')?.addEventListener('click', () => {
      currentSessionId = null;
      importStep = 1;
      currentSubTab = 'landing';
      renderAutomationShell();
    });
  }

  function renderReconciliationView(container, rec, postedCount, companyName) {
    const isReconciled = rec ? Boolean(rec.is_reconciled) : false;
    const diff = rec ? rec.difference : 0;

    container.innerHTML = `
      <div class="auto-recon-card" style="${!isReconciled ? 'border:1px solid #fecaca;' : ''}">
        <div class="auto-recon-header">
          <div>
            <h3 style="margin:0;font-size:18px;font-weight:700;color:${isReconciled ? 'var(--tx)' : '#c2410c'};">
              ${isReconciled ? '🎉 Vouchers Posted to TallyPrime Successfully!' : '⚠️ Posting Completed — Reconciliation Required'}
            </h3>
            <p style="margin:4px 0 0 0;font-size:13px;color:var(--tx2);">
              Target Company: <b>${escapeHtml(companyName)}</b> · Total Verified Vouchers: <b>${postedCount}</b>
              ${!isReconciled ? ` · <span style="color:#b91c1c;font-weight:600;">Discrepancy: ₹${formatCurrency(diff)}</span>` : ''}
            </p>
          </div>
          <span class="auto-badge ${isReconciled ? 'high' : 'low'}" style="font-size:13px;padding:6px 14px;${!isReconciled ? 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca;' : ''}">
            ${isReconciled ? '✓ Reconciled (0 Diff)' : 'Reconciliation Required (₹' + formatCurrency(diff) + ' Diff)'}
          </span>
        </div>

        ${!isReconciled ? `
          <div style="margin:16px 0 0 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#991b1b;line-height:1.5;">
            <strong>Audit Discrepancy Notice:</strong> The live Tally closing balance (₹${formatCurrency(rec ? rec.actual_tally_balance : 0)}) differs from the expected closing balance (₹${formatCurrency(rec ? rec.expected_closing_balance : 0)}) by <strong>₹${formatCurrency(diff)}</strong>. All ${postedCount} vouchers were processed, but the live Tally ledger balance does not reconcile with the bank statement. Please verify unposted transactions or opening balances.
          </div>
        ` : ''}

        ${rec ? `
          <div class="auto-recon-grid" style="margin-top:16px;">
            <div class="auto-recon-item">
              <span class="auto-recon-label">Opening Balance</span>
              <span class="auto-recon-val">₹${formatCurrency(rec.opening_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Total Posted Debits</span>
              <span class="auto-recon-val" style="color:#b91c1c;">₹${formatCurrency(rec.total_posted_debits)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Total Posted Credits</span>
              <span class="auto-recon-val" style="color:#047857;">₹${formatCurrency(rec.total_posted_credits)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Expected Closing Balance</span>
              <span class="auto-recon-val">₹${formatCurrency(rec.expected_closing_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Live Tally Closing Balance</span>
              <span class="auto-recon-val" style="color:#047857;">₹${formatCurrency(rec.actual_tally_balance)}</span>
            </div>
            <div class="auto-recon-item">
              <span class="auto-recon-label">Audit Difference</span>
              <span class="auto-recon-val" style="color:${isReconciled ? '#047857' : '#b91c1c'};font-weight:700;">₹${formatCurrency(diff)}</span>
            </div>
          </div>
        ` : `
          <div style="padding:14px;color:var(--tx2);font-size:13px;">
            Reconciliation summary not available.
          </div>
        `}

        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">
          ${!isReconciled ? `
            <button type="button" class="btn secondary" id="auto-btn-recon-review">
              ← Return to Review Table
            </button>
          ` : ''}
          <button type="button" class="btn secondary" id="auto-btn-recon-ask-tally">
            Ask Tally About This Company →
          </button>
          <button type="button" class="btn primary" id="auto-btn-recon-done">
            Done & Return to Automation
          </button>
        </div>
      </div>
    `;

    container.querySelector('#auto-btn-recon-review')?.addEventListener('click', () => {
      importStep = 3;
      renderAutomationWorkspace();
    });

    container.querySelector('#auto-btn-recon-done')?.addEventListener('click', () => {
      currentSessionId = null;
      importStep = 1;
      currentSubTab = 'landing';
      renderAutomationShell();
    });

    container.querySelector('#auto-btn-recon-ask-tally')?.addEventListener('click', () => {
      currentSubTab = 'ask-tally';
      renderAutomationWorkspace();
    });
  }

  // =========================================================================
  // 3. ASK TALLY — READ-ONLY CONVERSATIONAL COPILOT
  // =========================================================================
  function renderAskTallyChat(container) {
    if (!askTallySessionId) {
      askTallySessionId = 'ask_' + (crypto.randomUUID ? crypto.randomUUID().substring(0, 10) : Math.random().toString(36).substring(2, 10));
    }

    container.innerHTML = `
      <div class="auto-chat-box">
        <!-- Chat Header -->
        <div class="auto-chat-header">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">💬</span>
            <div>
              <div style="font-weight:700;font-size:14px;color:var(--tx);display:flex;align-items:center;gap:4px;">Ask ${tallyLogo()} · Read-Only Copilot</div>
              <div style="font-size:11.5px;color:var(--tx2);" id="auto-chat-company-title">Company: <b>${activeCompany || 'Default Company'}</b></div>
            </div>
          </div>
          <div>
            <button type="button" class="btn secondary" id="auto-chat-clear" style="font-size:12px;padding:4px 10px;">
              Clear Chat
            </button>
          </div>
        </div>

        <!-- Chat Messages -->
        <div class="auto-chat-messages" id="auto-chat-msg-list">
          ${askTallyMessages.length === 0 ? `
            <div style="text-align:center;padding:40px 20px;color:var(--tx2);">
              <div style="font-size:36px;margin-bottom:8px;">📊</div>
              <h4 style="margin:0 0 6px 0;color:var(--tx);display:flex;align-items:center;justify-content:center;gap:4px;">Ask questions about your accounts in Tally</h4>
              <p style="margin:0;font-size:12.5px;max-width:380px;margin:0 auto;">Ask questions like <i>"Show me the Trial Balance"</i>, <i>"What are our total receivables?"</i>, or <i>"How much is the balance in HDFC Bank A/c?"</i></p>
            </div>
          ` : askTallyMessages.map(m => `
            <div class="auto-chat-bubble ${m.sender}">
              ${m.sender === 'assistant' ? formatMarkdownSimple(m.content) : escapeHtml(m.content)}
            </div>
          `).join('')}
        </div>

        <!-- Chat Input Bar -->
        <div class="auto-chat-input-bar">
          <input type="text" id="auto-chat-input" placeholder="Ask a question about ${activeCompany || 'accounts'}..." autofocus>
          <button type="button" class="btn primary" id="auto-chat-send" style="border-radius:var(--r-full);padding:8px 18px;">
            Send
          </button>
        </div>
      </div>
    `;

    const inputEl = container.querySelector('#auto-chat-input');
    const sendBtn = container.querySelector('#auto-chat-send');
    const msgList = container.querySelector('#auto-chat-msg-list');

    const handleSend = async () => {
      const q = inputEl.value.trim();
      if (!q) return;
      inputEl.value = '';

      askTallyMessages.push({ sender: 'user', content: q });
      renderChatMessages(msgList);

      // Loading bubble
      askTallyMessages.push({ sender: 'assistant', content: '⏳ Retrieving live data from TallyPrime and preparing answer...' });
      renderChatMessages(msgList);

      try {
        const res = await api('/api/automation/ask-tally', {
          method: 'POST',
          body: JSON.stringify({
            session_id: askTallySessionId,
            company_name: activeCompany,
            query: q
          })
        });

        askTallyMessages.pop(); // Remove loading bubble
        if (res.ok) {
          askTallyMessages.push({ sender: 'assistant', content: res.response_markdown || 'No data found.' });
        } else {
          askTallyMessages.push({ sender: 'assistant', content: `⚠️ Error: ${res.error}` });
        }
      } catch (e) {
        askTallyMessages.pop();
        askTallyMessages.push({ sender: 'assistant', content: `⚠️ Request error: ${e.message}` });
      }

      renderChatMessages(msgList);
    };

    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    });

    container.querySelector('#auto-chat-clear')?.addEventListener('click', () => {
      askTallyMessages = [];
      renderChatMessages(msgList);
    });
  }

  function renderChatMessages(listEl) {
    if (!listEl) return;
    listEl.innerHTML = askTallyMessages.map(m => `
      <div class="auto-chat-bubble ${m.sender}">
        ${m.sender === 'assistant' ? formatMarkdownSimple(m.content) : escapeHtml(m.content)}
      </div>
    `).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================
  function formatCurrency(val) {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMarkdownSimple(str) {
    if (!str) return '';
    let s = escapeHtml(str);
    // Bold
    s = s.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Code block
    s = s.replace(/```([\s\S]*?)```/g, '<pre style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;overflow-x:auto;">$1</pre>');
    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 4px;border-radius:4px;">$1</code>');
    // Line breaks
    s = s.replace(/\n/g, '<br>');
    return s;
  }

})();
