/**
 * VS Database - Page Hook (MAIN World Execution Context)
 * Runs at document_start in the webpage's own execution environment.
 * Intercepts blob creation, delays blob revocation, intercepts programmatic anchor clicks,
 * and bridges in-memory documents/blobs to the extension content script.
 */
(function() {
  'use strict';

  if (window.__VS_PAGE_HOOK_INITIALIZED__) return;
  window.__VS_PAGE_HOOK_INITIALIZED__ = true;

  // Blob storage registry: url -> { blob, timestamp }
  const blobRegistry = new Map();

  // Periodic cleanup of stale blobs (older than 10 minutes)
  setInterval(() => {
    const now = Date.now();
    for (const [url, item] of blobRegistry.entries()) {
      if (now - item.timestamp > 600000) {
        blobRegistry.delete(url);
      }
    }
  }, 60000);

  /**
   * Helper: Convert Blob to base64 string using FileReader
   */
  function readBlobAsBase64(blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === 'string') {
            const commaIdx = result.indexOf(',');
            resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
          } else {
            resolve('');
          }
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Determine whether a Blob represents a document (PDF, Excel, CSV, Word, Zip, or > 512 bytes)
   */
  function isDocumentBlob(blob) {
    if (!blob) return false;
    const type = (blob.type || '').toLowerCase();
    if (/pdf|spreadsheet|excel|csv|msword|wordprocessingml|officedocument|zip|octet-stream|text\/plain/i.test(type)) {
      return true;
    }
    if (typeof blob.size === 'number' && blob.size > 512) {
      if (!type.startsWith('audio/') && !type.startsWith('video/')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine clean document filename from attributes or URL
   */
  function resolveDocumentFilename(anchor, href, fallback = 'document.pdf') {
    let name = (anchor.getAttribute('download') || anchor.download || '').trim();
    if (!name && href) {
      try {
        const parsed = new URL(href, window.location.href);
        const pathSeg = parsed.pathname.split('/').filter(Boolean).pop();
        if (pathSeg && /\.[a-z0-9]{2,5}$/i.test(pathSeg)) {
          name = decodeURIComponent(pathSeg);
        }
      } catch (_) {}
    }
    if (!name) {
      const anchorText = (anchor.innerText || anchor.title || anchor.getAttribute('aria-label') || '').trim();
      if (anchorText && anchorText.length < 80) {
        name = `${anchorText.replace(/[^a-z0-9._ -]/gi, '_')}.pdf`;
      }
    }
    return name || fallback;
  }

  // ========================================================
  // 1. HOOK URL.createObjectURL
  // ========================================================
  const origCreateObjectURL = URL.createObjectURL;
  if (typeof origCreateObjectURL === 'function') {
    URL.createObjectURL = function(obj) {
      const url = origCreateObjectURL.call(URL, obj);
      try {
        if (obj instanceof Blob || (obj && typeof obj.size === 'number')) {
          if (isDocumentBlob(obj)) {
            blobRegistry.set(url, {
              blob: obj,
              timestamp: Date.now()
            });
          }
        }
      } catch (err) {
        console.debug('[VS Hook] createObjectURL error:', err);
      }
      return url;
    };
  }

  // ========================================================
  // 2. HOOK URL.revokeObjectURL
  // Delay revocation by 45 seconds so extension has ample time to read binary data
  // ========================================================
  const origRevokeObjectURL = URL.revokeObjectURL;
  if (typeof origRevokeObjectURL === 'function') {
    URL.revokeObjectURL = function(url) {
      try {
        setTimeout(() => {
          try {
            origRevokeObjectURL.call(URL, url);
          } catch (_) {}
          try {
            blobRegistry.delete(url);
          } catch (_) {}
        }, 45000);
      } catch (_) {
        try {
          origRevokeObjectURL.call(URL, url);
        } catch (_) {}
      }
    };
  }

  // ========================================================
  // 3. HOOK HTMLAnchorElement.prototype.click
  // Detect programmatic or user clicks on download/blob anchors
  // ========================================================
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(...args) {
    try {
      const anchor = this;
      const href = anchor.href || anchor.getAttribute('href') || '';
      const downloadAttr = anchor.download || anchor.getAttribute('download') || '';
      const isBlob = href.startsWith('blob:');
      const isData = href.startsWith('data:');
      const isHttp = /^https?:/i.test(href);
      const hasDownload = Boolean(downloadAttr);

      if (isBlob || isData || hasDownload || (isHttp && /\.(pdf|xlsx|xls|csv|zip|docx|doc)(\?.*)?$/i.test(href))) {
        const filename = resolveDocumentFilename(anchor, href, 'document.pdf');

        if (isBlob) {
          const entry = blobRegistry.get(href);
          if (entry && entry.blob) {
            readBlobAsBase64(entry.blob).then((base64Data) => {
              window.postMessage({
                type: 'VS_PAGE_BLOB_CAPTURED',
                url: href,
                filename: filename,
                base64: base64Data,
                size: entry.blob.size,
                mime: entry.blob.type || 'application/pdf'
              }, '*');
            }).catch(() => {});
          } else {
            // Blob URL not in registry: fetch within page context while URL is still valid
            fetch(href)
              .then(res => res.blob())
              .then(async (blob) => {
                const base64Data = await readBlobAsBase64(blob);
                window.postMessage({
                  type: 'VS_PAGE_BLOB_CAPTURED',
                  url: href,
                  filename: filename,
                  base64: base64Data,
                  size: blob.size,
                  mime: blob.type || 'application/pdf'
                }, '*');
              })
              .catch(() => {});
          }
        } else if (isData) {
          try {
            const commaIdx = href.indexOf(',');
            const base64Data = commaIdx !== -1 ? href.slice(commaIdx + 1) : '';
            const match = href.match(/^data:([^;,]+)/);
            const mime = match ? match[1] : 'application/octet-stream';
            const size = Math.round((base64Data.length * 3) / 4);
            window.postMessage({
              type: 'VS_PAGE_BLOB_CAPTURED',
              url: href.length > 200 ? href.slice(0, 200) + '...' : href,
              filename: filename,
              base64: base64Data,
              size: size,
              mime: mime
            }, '*');
          } catch (_) {}
        } else if (isHttp || hasDownload) {
          // If anchor points to http/https or relative URL, fetch in page context with user credentials
          fetch(href, { credentials: 'include' })
            .then(res => {
              if (!res.ok) throw new Error('Fetch failed: ' + res.status);
              return res.blob();
            })
            .then(async (blob) => {
              if (isDocumentBlob(blob)) {
                const base64Data = await readBlobAsBase64(blob);
                window.postMessage({
                  type: 'VS_PAGE_BLOB_CAPTURED',
                  url: href,
                  filename: filename,
                  base64: base64Data,
                  size: blob.size,
                  mime: blob.type || 'application/pdf'
                }, '*');
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.debug('[VS Hook] Anchor click intercept error:', err);
    }
    return origAnchorClick.apply(this, args);
  };

  // ========================================================
  // 4. HOOK window.showSaveFilePicker (File System Access API)
  // ========================================================
  if (typeof window.showSaveFilePicker === 'function') {
    const origShowSaveFilePicker = window.showSaveFilePicker;
    window.showSaveFilePicker = async function(options) {
      try {
        window.postMessage({
          type: 'VS_FILE_SYSTEM_PICKER_TRIGGERED',
          suggestedName: options?.suggestedName || ''
        }, '*');
      } catch (err) {
        console.debug('[VS Hook] showSaveFilePicker intercept error:', err);
      }
      return origShowSaveFilePicker.apply(this, arguments);
    };
  }

  // ========================================================
  // 5. HOOK navigator.msSaveOrOpenBlob (Legacy Fallback)
  // ========================================================
  if (navigator && typeof navigator.msSaveOrOpenBlob === 'function') {
    const origMsSave = navigator.msSaveOrOpenBlob;
    navigator.msSaveOrOpenBlob = function(blob, defaultName) {
      try {
        readBlobAsBase64(blob).then(b64 => {
          window.postMessage({
            type: 'VS_PAGE_BLOB_CAPTURED',
            url: 'blob:msSaveOrOpenBlob',
            filename: defaultName || 'document.pdf',
            base64: b64,
            size: blob.size,
            mime: blob.type || 'application/octet-stream'
          }, '*');
        }).catch(() => {});
      } catch (_) {}
      return origMsSave.apply(this, arguments);
    };
  }

})();
