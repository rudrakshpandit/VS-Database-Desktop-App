(function () {
'use strict';

/**
 * VS Database — AI Auto Document Rename UI Controller
 * Version 1.0
 * 
 * Strict Confirmation-Based Workflow:
 * 1. Shows modal with proposed filename, confidence level, rationale breakdown.
 * 2. Highlights potential client mismatch warning if detected.
 * 3. Allows inline editing of the suggested filename.
 * 4. Resolves collisions (Keep Both vs Replace).
 * 5. Full keyboard support: Enter to confirm, Escape to cancel, Tab navigation.
 */

class AiAutoRenameController {
  constructor() {
    this.activeModal = null;
  }

  /**
   * Triggers AI Rename analysis for a document and presents confirmation modal.
   * @param {Object} params
   * @param {string} [params.staged_file_id] - ID of staged file (Save Tab / Studio)
   * @param {string} [params.staging_session_id] - Session ID
   * @param {string} [params.client_file_no] - Client file no if inside Client Explorer
   * @param {string} [params.client_name] - Active client name
   * @param {string} [params.relative_path] - Relative path in Client Explorer
   * @param {string} [params.storage_kind] - 'local' or 'drive'
   * @param {string} [params.original_name] - Original filename fallback
   * @param {Function} [params.onRenamed] - Callback called with { new_filename } on success
   */
  async triggerRename(params = {}) {
    const origName = params.original_name || 'document.pdf';
    
    // Show quick progress toast
    this._showToast(`✨ Analyzing ${origName}...`);

    try {
      const analyzeRes = await api('/api/ai/doc/analyze-rename', {
        method: 'POST',
        body: JSON.stringify({
          staged_file_id: params.staged_file_id,
          staging_session_id: params.staging_session_id,
          client_file_no: params.client_file_no,
          client_name: params.client_name,
          relative_path: params.relative_path,
          storage_kind: params.storage_kind || 'local',
          original_filename: origName
        })
      });

      if (!analyzeRes || !analyzeRes.ok) {
        throw new Error(analyzeRes ? analyzeRes.error : 'Analysis failed');
      }

      // Present confirmation modal to the user
      this.showConfirmationModal({
        analysis: analyzeRes,
        context: params,
        onConfirm: async (finalName, conflictAction) => {
          await this.executeRename({
            ...params,
            new_filename: finalName,
            conflict_action: conflictAction
          });
          if (typeof params.onRenamed === 'function') {
            params.onRenamed(finalName);
          }
        }
      });

    } catch (err) {
      console.error('[AI Rename Error]', err);
      alert(`AI Rename Notice: ${err.message || 'Could not analyze document contents.'}`);
    }
  }

  /**
   * Executes the rename once approved by user.
   */
  async executeRename(payload) {
    this._showToast(`Renaming to ${payload.new_filename}...`);
    const res = await api('/api/ai/doc/confirm-rename', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res || !res.ok) {
      throw new Error(res ? res.error : 'Rename execution failed.');
    }
    this._showToast(`✓ Document renamed to: ${res.new_filename}`, 3500);
    return res;
  }

  /**
   * Renders the Confirmation Modal.
   */
  showConfirmationModal({ analysis, context, onConfirm }) {
    if (this.activeModal) {
      this.closeModal();
    }

    const origName = analysis.original_filename || context.original_name || 'Document.pdf';
    const suggestedName = analysis.proposed_filename || origName;
    const confidence = (analysis.confidence || 'MEDIUM').toUpperCase();
    const isMismatch = Boolean(analysis.client_mismatch);
    const mismatchMsg = analysis.client_mismatch_message || '';
    const breakdown = analysis.breakdown || {};

    let confBadgeClass = 'badge-medium';
    let confLabel = 'Medium Confidence';
    if (confidence === 'HIGH') {
      confBadgeClass = 'badge-high';
      confLabel = 'High Confidence';
    } else if (confidence === 'LOW') {
      confBadgeClass = 'badge-low';
      confLabel = 'Needs Review';
    }

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'ai-rename-modal-overlay';
    modalOverlay.id = 'ai-rename-modal';
    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-modal', 'true');
    modalOverlay.setAttribute('aria-labelledby', 'ai-rename-title');

    modalOverlay.innerHTML = `
      <div class="ai-rename-card glass">
        <!-- Header -->
        <div class="ai-rename-header">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="ai-rename-sparkle-icon">✨</div>
            <div>
              <h3 id="ai-rename-title" style="margin:0;font-size:16px;font-weight:700;color:var(--tx);">AI Document Rename</h3>
              <p style="margin:2px 0 0;font-size:11.5px;color:var(--tx2);">Proposed standard naming based on first 2 pages</p>
            </div>
          </div>
          <span class="ai-rename-conf-badge ${confBadgeClass}">${confLabel}</span>
        </div>

        <!-- Mismatch Alert Banner if detected -->
        ${isMismatch ? `
          <div class="ai-rename-mismatch-banner">
            <span style="font-size:16px;line-height:1;">⚠️</span>
            <div style="font-size:12px;line-height:1.4;">
              <strong>Possible Client Mismatch:</strong><br>
              ${escapeHtml(mismatchMsg)}
            </div>
          </div>
        ` : ''}

        <!-- Breakdown chips -->
        <div class="ai-rename-breakdown-row">
          <span class="ai-tag">📑 <strong>Type:</strong> ${escapeHtml(breakdown.type || 'N/A')}</span>
          <span class="ai-tag">📅 <strong>Period:</strong> ${escapeHtml(breakdown.period || 'N/A')}</span>
          <span class="ai-tag">🏢 <strong>Client:</strong> ${escapeHtml(breakdown.client || 'N/A')}</span>
        </div>

        <!-- Filename Comparison -->
        <div class="ai-rename-fields-group">
          <label class="ai-rename-label">Original Filename:</label>
          <div class="ai-rename-original-box">${escapeHtml(origName)}</div>

          <label class="ai-rename-label" for="ai-rename-input" style="margin-top:12px;display:flex;justify-content:space-between;">
            <span>Suggested Filename:</span>
            <span style="font-weight:400;color:var(--tx2);font-size:11px;">You can edit this name before confirming</span>
          </label>
          <input type="text" id="ai-rename-input" class="ai-rename-input" value="${escapeHtml(suggestedName)}" spellcheck="false" autocomplete="off" />
        </div>

        <!-- Duplicate Collision Policy -->
        <div style="margin-top:10px;font-size:11.5px;color:var(--tx2);display:flex;align-items:center;gap:8px;">
          <span>If target already exists:</span>
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-weight:500;">
            <input type="radio" name="ai-rename-collision" value="keep_both" checked style="accent-color:#2563eb;"> Keep Both (1)
          </label>
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-weight:500;">
            <input type="radio" name="ai-rename-collision" value="replace" style="accent-color:#2563eb;"> Replace
          </label>
        </div>

        <!-- Actions -->
        <div class="ai-rename-actions">
          <button type="button" id="ai-rename-btn-cancel" class="btn" style="min-width:110px;">Keep Original</button>
          <button type="button" id="ai-rename-btn-confirm" class="btn p" style="min-width:120px;background:linear-gradient(135deg, #2563eb, #1d4ed8);font-weight:600;">✓ Rename</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalOverlay);
    this.activeModal = modalOverlay;

    const inputEl = modalOverlay.querySelector('#ai-rename-input');
    const cancelBtn = modalOverlay.querySelector('#ai-rename-btn-cancel');
    const confirmBtn = modalOverlay.querySelector('#ai-rename-btn-confirm');

    // Focus input and select base name
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        const dotIdx = inputEl.value.lastIndexOf('.');
        if (dotIdx > 0) {
          inputEl.setSelectionRange(0, dotIdx);
        } else {
          inputEl.select();
        }
      }
    }, 60);

    // Cancel action
    cancelBtn.onclick = () => {
      this.closeModal();
    };

    // Confirm action
    const handleConfirm = async () => {
      const finalName = (inputEl.value || '').trim();
      if (!finalName) {
        alert('Please enter a valid filename.');
        return;
      }
      const collisionEl = modalOverlay.querySelector('input[name="ai-rename-collision"]:checked');
      const collisionAction = collisionEl ? collisionEl.value : 'keep_both';

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Renaming...';
      try {
        await onConfirm(finalName, collisionAction);
        this.closeModal();
      } catch (e) {
        alert('Rename failed: ' + e.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '✓ Rename';
      }
    };

    confirmBtn.onclick = handleConfirm;

    // Keyboard handlers
    modalOverlay.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeModal();
      } else if (e.key === 'Enter' && e.target === inputEl) {
        e.preventDefault();
        handleConfirm();
      }
    };
  }

  closeModal() {
    if (this.activeModal) {
      this.activeModal.remove();
      this.activeModal = null;
    }
  }

  _showToast(msg, timeout = 2200) {
    let toast = document.getElementById('ai-rename-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ai-rename-toast';
      toast.className = 'ai-rename-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
      }
    }, timeout);
  }
}

window.AiAutoRenameController = AiAutoRenameController;
window.aiAutoRenamer = new AiAutoRenameController();

})();

