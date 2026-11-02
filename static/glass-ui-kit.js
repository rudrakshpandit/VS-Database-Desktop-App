/**
 * VS Database — Glass UI Kit & Dropdown Components Engine
 * Extracted & ported from UI/Desired/HTML/Drop down.html & Glass UI Kit - Light.html
 */

(function() {
  'use strict';

  // SVG Helper Constants
  const CHEV_SVG = '<svg class="g-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
  const CK_SVG = '<svg class="g-ck" viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const BX_SVG = '<span class="g-box"><svg viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // File Icons Library
  const FILE_GLYPHS = {
    doc: "M7 8h10M7 12h10M7 16h6",
    pdf: "M12 4l6 15M12 4L6 19M8 14h8",
    xls: "M5 6h14v12H5zM5 12h14M12 6v12",
    ppt: "M12 5a7 7 0 1 0 7 7h-7z",
    txt: "M6 7h12M6 11h12M6 15h8",
    csv: "M5 7h14M5 12h14M5 17h14M10 7v10",
    zip: "M12 4v3M12 9v3M10 14h4v6h-4z",
    img: "M4 18l5-7 4 5 3-3 4 5zM8 7.5h.01",
    play: "M9 6l9 6-9 6z",
    note: "M10 17V6l9-2v11M10 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    code: "M9 7l-5 5 5 5M15 7l5 5-5 5",
    json: "M9 5c-2 0-2 1-2 3s0 4-2 4c2 0 2 2 2 4s0 3 2 3M15 5c2 0 2 1 2 3s0 4 2 4c-2 0-2 2-2 4s0 3-2 3",
    mail: "M4 7h16v11H4zM4 7l8 6 8-6",
    pen: "M5 19l1-5L16 4l4 4L10 18zM14 6l4 4",
    dir: "M4 7h6l2 2h8v9H4z"
  };

  const FILE_CONFIGS = {
    pdf:  { ext: "PDF",  glyph: "pdf",  c1: "#ff6b7a", c2: "#d91f3d" },
    docx: { ext: "DOCX", glyph: "doc",  c1: "#6fb4ff", c2: "#2756d9" },
    doc:  { ext: "DOC",  glyph: "doc",  c1: "#6fb4ff", c2: "#2756d9" },
    xlsx: { ext: "XLSX", glyph: "xls",  c1: "#45e6a6", c2: "#0f9a57" },
    xls:  { ext: "XLS",  glyph: "xls",  c1: "#45e6a6", c2: "#0f9a57" },
    pptx: { ext: "PPTX", glyph: "ppt",  c1: "#ffb85f", c2: "#f25f22" },
    ppt:  { ext: "PPT",  glyph: "ppt",  c1: "#ffb85f", c2: "#f25f22" },
    txt:  { ext: "TXT",  glyph: "txt",  c1: "#c3cdff", c2: "#7685de" },
    csv:  { ext: "CSV",  glyph: "csv",  c1: "#85ecc9", c2: "#25a085" },
    zip:  { ext: "ZIP",  glyph: "zip",  c1: "#ffdc66", c2: "#dc9c0c" },
    rar:  { ext: "RAR",  glyph: "zip",  c1: "#ffdc66", c2: "#dc9c0c" },
    jpg:  { ext: "JPG",  glyph: "img",  c1: "#ff90d8", c2: "#bf45d4" },
    jpeg: { ext: "JPEG", glyph: "img",  c1: "#ff90d8", c2: "#bf45d4" },
    png:  { ext: "PNG",  glyph: "img",  c1: "#c895ff", c2: "#7344de" },
    webp: { ext: "WEBP", glyph: "img",  c1: "#c895ff", c2: "#7344de" },
    mp4:  { ext: "MP4",  glyph: "play", c1: "#ff8080", c2: "#d03285" },
    mp3:  { ext: "MP3",  glyph: "note", c1: "#58e6ff", c2: "#2587de" },
    html: { ext: "HTML", glyph: "code", c1: "#ffa561", c2: "#de4a26" },
    json: { ext: "JSON", glyph: "json", c1: "#ffe46b", c2: "#d49a12" },
    eml:  { ext: "EML",  glyph: "mail", c1: "#74c9ff", c2: "#3578de" },
    dir:  { ext: "DIR",  glyph: "dir",  c1: "#ffd780", c2: "#ee9c33" }
  };

  /**
   * Generates a sleek frosted-glass vector file icon SVG for any file extension.
   * @param {string} fileNameOrExt - E.g. 'report.pdf' or 'pdf'
   * @param {number} [size=32] - Width and height in px
   */
  function renderGlassFileIcon(fileNameOrExt, size = 32) {
    let ext = (fileNameOrExt || '').toLowerCase();
    if (ext.includes('.')) {
      ext = ext.split('.').pop();
    }
    const conf = FILE_CONFIGS[ext] || { ext: ext.toUpperCase().slice(0, 4) || 'FILE', glyph: 'doc', c1: '#94a3b8', c2: '#475569' };
    const k = conf.ext.toLowerCase();
    const glyphPath = FILE_GLYPHS[conf.glyph] || FILE_GLYPHS.doc;

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" class="glass-file-svg" role="img" aria-label="${conf.ext} file" style="flex-shrink:0;">
        <defs>
          <linearGradient id="g-vs-${k}-${size}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${conf.c1}"/>
            <stop offset="1" stop-color="${conf.c2}"/>
          </linearGradient>
        </defs>
        <path d="M14 6H40L52 18V52a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="url(#g-vs-${k}-${size})" fill-opacity=".94" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>
        <path d="M14 6H40L52 18V30C40 22 24 20 10 24V10a4 4 0 0 1 4-4z" fill="#fff" fill-opacity=".18"/>
        <path d="M40 6v8a4 4 0 0 0 4 4h8z" fill="#fff" fill-opacity=".45"/>
        <g transform="translate(19 17)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="${glyphPath}"/>
        </g>
        <rect x="15" y="43" width="34" height="10" rx="5" fill="#000" fill-opacity=".22"/>
        <text x="32" y="50.4" text-anchor="middle" font-family="'Plus Jakarta Sans',sans-serif" font-size="7.5" font-weight="700" fill="#fff">${conf.ext}</text>
      </svg>
    `;
  }

  /**
   * Transforms a native <select> into a Glass UI dropdown component,
   * keeping native select value synchronized for form submissions and onchange listeners.
   */
  function createGlassDropdown(selectEl, options = {}) {
    if (!selectEl || !selectEl.parentElement || (selectEl.dataset && selectEl.dataset.glassDropdownInitialized)) return;
    if (selectEl.dataset) selectEl.dataset.glassDropdownInitialized = 'true';

    const parent = selectEl.parentElement;
    const selectOptions = selectEl.options || [];
    const isSearchable = options.searchable || (selectEl.dataset && selectEl.dataset.searchable === 'true') || selectOptions.length > 8;

    const wrapper = document.createElement('div');
    wrapper.className = 'g-dd' + (options.className ? ' ' + options.className : '');
    if (selectEl.id) wrapper.id = `g-dd-${selectEl.id}`;

    // Read items from select options
    const items = Array.from(selectOptions).map(opt => ({
      v: opt.text || opt.innerText || opt.value || '',
      value: opt.value || '',
      selected: Boolean(opt.selected),
      disabled: Boolean(opt.disabled)
    }));

    let selectedIndex = typeof selectEl.selectedIndex === 'number' ? selectEl.selectedIndex : 0;
    if (selectedIndex < 0 && items.length > 0) selectedIndex = 0;
    let query = '';
    let hlIndex = -1;

    wrapper.innerHTML = `
      <button type="button" class="g-trg" aria-haspopup="listbox" aria-expanded="false">
        <span class="g-val"></span>${CHEV_SVG}
      </button>
      <div class="g-pn">
        ${isSearchable ? `
          <div class="g-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
            <input type="text" placeholder="Type to filter..." aria-label="Filter options" autocomplete="off" />
          </div>
        ` : ''}
        <ul class="g-list" role="listbox"></ul>
      </div>
    `;

    // Hide native select visually but keep it in DOM for values & form events
    selectEl.style.display = 'none';
    parent.insertBefore(wrapper, selectEl.nextSibling);

    const trg = wrapper.querySelector('.g-trg');
    const pn = wrapper.querySelector('.g-pn');
    const list = wrapper.querySelector('.g-list');
    const searchIn = wrapper.querySelector('.g-search input');
    const valSpan = wrapper.querySelector('.g-val');

    function visibleIndices() {
      return items.map((_, i) => i).filter(i => {
        if (!query) return true;
        return items[i].v.toLowerCase().includes(query);
      });
    }

    function paintVal() {
      if (selectedIndex >= 0 && items[selectedIndex]) {
        valSpan.className = 'g-val';
        valSpan.textContent = items[selectedIndex].v;
      } else {
        valSpan.className = 'g-val ph';
        valSpan.textContent = options.placeholder || 'Select...';
      }
    }

    function paintList() {
      const vis = visibleIndices();
      if (vis.length === 0) {
        list.innerHTML = '<li class="g-empty">No matching options</li>';
        return;
      }

      list.innerHTML = items.map((it, i) => {
        if (!vis.includes(i)) return '';
        const isSel = (i === selectedIndex);
        const isHl = (i === hlIndex);
        return `
          <li class="g-it${isHl ? ' hl' : ''}" role="option" aria-selected="${isSel}" data-i="${i}">
            <span class="g-t">${esc(it.v)}</span>
            ${isSel ? CK_SVG : ''}
          </li>
        `;
      }).join('');
    }

    function open(isOpen) {
      if (isOpen) {
        document.querySelectorAll('.g-dd.open').forEach(d => {
          if (d !== wrapper) d.classList.remove('open');
        });
      }
      wrapper.classList.toggle('open', isOpen);
      trg.setAttribute('aria-expanded', isOpen);
      if (isOpen) {
        hlIndex = -1;
        if (searchIn) {
          searchIn.value = '';
          query = '';
          paintList();
          setTimeout(() => searchIn.focus(), 50);
        }
      }
    }

    function pick(i) {
      if (i < 0 || i >= items.length) return;
      selectedIndex = i;
      selectEl.selectedIndex = i;
      // Trigger change on native select
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      open(false);
      paintVal();
      paintList();
      trg.focus();
    }

    trg.onclick = (e) => {
      e.stopPropagation();
      open(!wrapper.classList.contains('open'));
    };

    list.onclick = (e) => {
      const li = e.target.closest('.g-it');
      if (li && li.dataset.i !== undefined) {
        pick(Number(li.dataset.i));
      }
    };

    if (searchIn) {
      searchIn.oninput = () => {
        query = searchIn.value.trim().toLowerCase();
        hlIndex = -1;
        paintList();
      };
    }

    wrapper.onkeydown = (e) => {
      const vis = visibleIndices();
      if (e.key === 'Escape') {
        open(false);
        trg.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!wrapper.classList.contains('open')) {
          open(true);
          return;
        }
        const curr = vis.indexOf(hlIndex);
        const next = e.key === 'ArrowDown' ? curr + 1 : curr - 1;
        const norm = (next + vis.length) % vis.length;
        hlIndex = vis[norm];
        paintList();
        const hlEl = list.querySelector('.g-it.hl');
        if (hlEl) hlEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && wrapper.classList.contains('open') && hlIndex >= 0) {
        e.preventDefault();
        pick(hlIndex);
      }
    };

    // Watch for external changes to selectEl
    selectEl.addEventListener('change', () => {
      selectedIndex = selectEl.selectedIndex;
      paintVal();
      paintList();
    });

    paintVal();
    paintList();
    return wrapper;
  }

  // Global document click closes open dropdowns
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.g-dd.open').forEach(d => {
      if (!d.contains(e.target)) {
        d.classList.remove('open');
        const t = d.querySelector('.g-trg');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  });

  function renderPillSwitch(opts = {}) {
    const id = opts.id ? ` id="${esc(opts.id)}"` : '';
    const cls = opts.className ? ` ${esc(opts.className)}` : '';
    const checked = opts.checked ? ' checked' : '';
    const title = opts.title ? ` title="${esc(opts.title)}"` : '';
    const dataAttrs = opts.dataAttrs || '';
    return `
      <label class="g-pill-sw"${title}>
        <input type="checkbox"${id} class="g-pill-input${cls}"${dataAttrs}${checked} />
        <span class="g-pill-track">
          <span class="g-pill-lbl y">YES</span>
          <span class="g-pill-lbl n">NO</span>
          <span class="g-pill-thumb">
            <svg class="tk" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            <svg class="cr" viewBox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6"/></svg>
          </span>
        </span>
      </label>
    `;
  }

  // Global Hook to enhance all existing or newly added select elements
  function enhanceAllSelects(root = document) {
    root.querySelectorAll('select:not([data-no-glass]):not([data-glass-dropdown-initialized])').forEach(sel => {
      // Don't auto-wrap tiny dynamic selects unless desirable
      createGlassDropdown(sel);
    });
  }

  // Expose API
  window.GlassUI = {
    renderFileIcon: renderGlassFileIcon,
    renderPillSwitch: renderPillSwitch,
    createDropdown: createGlassDropdown,
    enhanceAllSelects: enhanceAllSelects
  };

  // Auto-run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAllSelects());
  } else {
    setTimeout(enhanceAllSelects, 50);
  }

})();
