/**
 * VS Database — Save Tab Durable Disk Staging Coordinator (Desktop Application)
 * Coordinates persistent on-disk staging sessions with Save Tab & PDF Studio.
 * Zero browser memory bloat: holds lightweight metadata only.
 */
class SaveStagingCoordinator {
  constructor(applicationId = 'vs_desktop_app') {
    this.applicationId = applicationId;
    this.storageKey = `vs_staging_session_${applicationId}`;
    this.sessionId = sessionStorage.getItem(this.storageKey) || null;
    this.manifest = { session_id: null, files: [] };
    this.activePdfStudioContext = null;
    this.isInitialized = false;
  }

  async init() {
    try {
      const res = await api('/api/staging/sessions', {
        method: 'POST',
        body: JSON.stringify({ session_id: this.sessionId })
      });
      if (res && res.ok && res.manifest) {
        this.manifest = res.manifest;
        this.sessionId = res.manifest.session_id;
        sessionStorage.setItem(this.storageKey, this.sessionId);
      }
    } catch (e) {
      console.warn('[Staging] Failed to init session:', e);
    }
    this.isInitialized = true;
    return this.manifest;
  }

  getFiles() {
    return this.manifest.files || [];
  }

  getSelectedPdfs() {
    return (this.manifest.files || []).filter(f => f.is_pdf && f.pdf_selected);
  }

  toggleFilePdfSelection(stagedFileId, forceVal) {
    const file = (this.manifest.files || []).find(f => f.staged_file_id === stagedFileId);
    if (file && file.is_pdf) {
      file.pdf_selected = (forceVal !== undefined) ? forceVal : !file.pdf_selected;
    }
    return this.getSelectedPdfs();
  }

  async addFileDirect(fileObj, customName) {
    if (!this.isInitialized) await this.init();
    const b64 = await fileToBase64(fileObj);
    const origName = customName || fileObj.name || 'document.pdf';
    const res = await api(`/api/staging/sessions/${encodeURIComponent(this.sessionId)}/files`, {
      method: 'POST',
      body: JSON.stringify({
        original_name: origName,
        base64: b64,
        type: fileObj.type || 'application/pdf',
        size: fileObj.size || 0
      })
    });
    if (res && res.ok && res.file) {
      res.file.pdf_selected = false;
      this.manifest.files.push(res.file);
      return res.file;
    }
    throw new Error('Failed to stage file on disk.');
  }

  async removeFile(stagedFileId) {
    try {
      const res = await api(`/api/staging/sessions/${encodeURIComponent(this.sessionId)}/remove-file`, {
        method: 'POST',
        body: JSON.stringify({ staged_file_id: stagedFileId })
      });
      if (res && res.manifest) {
        this.manifest = res.manifest;
      } else {
        this.manifest.files = (this.manifest.files || []).filter(f => f.staged_file_id !== stagedFileId);
      }
    } catch (e) {
      this.manifest.files = (this.manifest.files || []).filter(f => f.staged_file_id !== stagedFileId);
    }
  }

  async clearSession() {
    if (this.sessionId) {
      try {
        await api(`/api/staging/sessions/${encodeURIComponent(this.sessionId)}/clear`, {
          method: 'POST',
          body: '{}'
        });
      } catch (_) {}
    }
    this.manifest.files = [];
    sessionStorage.removeItem(this.storageKey);
    this.sessionId = null;
    await this.init();
  }

  async openPdfStudioWithSelected() {
    const selectedPdfs = this.getSelectedPdfs();
    if (!selectedPdfs.length) {
      throw new Error('Please select at least one PDF file using the checkbox.');
    }

    const stagedIds = selectedPdfs.map(f => f.staged_file_id);
    const res = await api('/api/pdf-studio/sessions', {
      method: 'POST',
      timeout: 60000,
      body: JSON.stringify({
        staging_session_id: this.sessionId,
        staged_file_ids: stagedIds
      })
    });

    if (res && res.ok && res.session) {
      this.activePdfStudioContext = {
        staging_session_id: this.sessionId,
        staged_file_ids: stagedIds,
        pdf_studio_session_id: res.session.session_id,
        initial_file_count: stagedIds.length
      };
      if (typeof window.openPdfStudioSession === 'function') {
        window.openPdfStudioSession(res.session, res.thumbnails, this.activePdfStudioContext);
      } else {
        safeNavigate('pdf-studio');
      }
      return res.session;
    }
    throw new Error(res.error || 'Failed to initialize PDF Studio session.');
  }

  async applyPdfStudioResult(pdfSessionId, resultName) {
    if (!this.activePdfStudioContext) {
      throw new Error('No active PDF Studio context.');
    }
    const { staging_session_id, staged_file_ids } = this.activePdfStudioContext;
    const res = await api(`/api/pdf-studio/sessions/${encodeURIComponent(pdfSessionId)}/apply-to-staging`, {
      method: 'POST',
      timeout: 60000,
      body: JSON.stringify({
        staging_session_id,
        replace_staged_ids: staged_file_ids,
        result_name: resultName
      })
    });

    if (res && res.ok && res.manifest) {
      this.manifest = res.manifest;
      this.activePdfStudioContext = null;
      window.lastAppliedStagingResult = res.new_entry;
      safeNavigate('save');
      return res;
    }
    throw new Error(res.error || 'Failed to apply PDF Studio result.');
  }
}

function safeNavigate(page) {
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

// Global coordinator singleton for Desktop App
window.saveStaging = new SaveStagingCoordinator('vs_desktop_app');
