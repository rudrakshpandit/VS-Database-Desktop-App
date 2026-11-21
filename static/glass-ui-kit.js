/**
 * VS Database — Glass UI Kit & Dropdown Components Engine
 * Ported & Enhanced from UI/Desired/HTML/glass-dropdowns.html
 * Enforcing: Panel opacity = 15% (--dd-po: 0.15), Line thickness = 4px (--dd-lw: 4px), Style = Glass (data-style="glass")
 */

(function() {
  'use strict';

  // Apply default specs to document root
  try {
    document.documentElement.style.setProperty('--dd-po', '0.15');
    document.documentElement.style.setProperty('--dd-lw', '4px');
    document.documentElement.setAttribute('data-style', 'glass');
  } catch (_) {}

  // SVG Helper Constants
  const CHEV_SVG = '<svg class="g-chev chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
  const CK_SVG = '<svg class="g-ck ck" viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const BX_SVG = '<span class="g-box box"><svg viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Common SVG Icons for Category 2 (Icon + Description)
  const SVG_ICONS = {
    folder: '<svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v9H4z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    'hard-drive': '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 13h20"/><circle cx="6" cy="16" r="1"/><circle cx="10" cy="16" r="1"/></svg>',
    'cloud-drive': '<svg viewBox="0 0 24 24" style="stroke:#2563eb;"><path d="M12 2L2 19h20L12 2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 13h10" stroke="currentColor" stroke-width="2"/></svg>',
    'cloud-sync': '<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    ban: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  };

  // Helper for firm type letter initials [P, L, C, +]
  function getFirmTypeInitial(name) {
    if (!name) return 'F';
    const trimmed = String(name).trim();
    if (trimmed === '__add_new__' || trimmed.startsWith('+')) return '+';
    const n = trimmed.toLowerCase();
    if (n.includes('proprietor')) return 'P';
    if (n.includes('partner')) return 'P';
    if (n.includes('llp')) return 'L';
    if (n.includes('pvt') || n.includes('private') || n.includes('ltd') || n.includes('company') || n.includes('corp')) return 'C';
    if (n.includes('trust')) return 'T';
    if (n.includes('society')) return 'S';
    if (n.includes('huf')) return 'H';
    return trimmed.charAt(0).toUpperCase();
  }

  // Registry for the 14 classified dropdowns
  const DROPDOWN_SPECS = {
    // -------------------------------------------------------------
    // Category 1: Basic select
    // -------------------------------------------------------------
    'manual-mobile-cc': {
      category: 1,
      type: 'basic',
      compact: true,
      tint: '124,104,214',
      placeholder: '+91'
    },
    'auto-select-fy': {
      category: 1,
      type: 'basic',
      tint: '15,23,42',
      placeholder: 'Select FY...'
    },

    // -------------------------------------------------------------
    // Category 2: Icon + description
    // -------------------------------------------------------------
    'manual-type': {
      category: 2,
      type: 'icon-desc',
      tint: '154,92,255',
      initialBadge: true,
      placeholder: 'Select Firm Type...',
      descriptions: {
        'proprietorship': 'Sole Proprietorship Entity',
        'partnership': 'Partnership Firm',
        'llp': 'Limited Liability Partnership',
        'private limited': 'Private Corporate Entity',
        'private limited company': 'Private Corporate Entity',
        'limited company': 'Public Corporate Entity',
        'trust': 'Registered Charitable/Family Trust',
        'society': 'Registered Non-profit Society',
        'huf': 'Hindu Undivided Family',
        '__add_new__': 'Register new custom firm type'
      }
    },
    'order': {
      category: 2,
      type: 'icon-desc',
      tint: '91,124,255',
      placeholder: 'Select folder order...',
      itemOverrides: {
        'service-period': {
          icon: 'folder',
          desc: 'Group by Service, then Period (e.g. GST / 2024-25)'
        },
        'period-service': {
          icon: 'calendar',
          desc: 'Group by Period, then Service (e.g. 2024-25 / GST)'
        }
      }
    },
    'save-storage-kind': {
      category: 2,
      type: 'icon-desc',
      tint: '91,124,255',
      placeholder: 'Select storage...',
      itemOverrides: {
        'local': {
          icon: 'hard-drive',
          desc: 'Store documents directly on local disk'
        },
        'drive': {
          icon: 'cloud-drive',
          desc: 'Sync documents to Google Drive client portal'
        }
      }
    },
    'drive-usage-mode': {
      category: 2,
      type: 'icon-desc',
      tint: '91,124,255',
      placeholder: 'Select Google Drive mode...',
      itemOverrides: {
        'backup_and_client': {
          icon: 'cloud-sync',
          desc: 'Client Document Portals and System Backups'
        },
        'only_client': {
          icon: 'users',
          desc: 'Dedicated exclusively to Client Portals'
        },
        'only_backup': {
          icon: 'shield',
          desc: 'Dedicated exclusively to Automated Backups'
        },
        'disabled': {
          icon: 'ban',
          desc: 'Disable Google Drive cloud sync'
        }
      }
    },

    // -------------------------------------------------------------
    // Category 3: Status with dots
    // -------------------------------------------------------------
    'manual-status': {
      category: 3,
      type: 'status',
      tint: '31,207,147',
      placeholder: 'Select status...',
      dots: {
        'active': '#1fcf93',
        'inactive': '#ff5d86'
      }
    },
    'backup-freq-select': {
      category: 3,
      type: 'status',
      tint: '31,207,147',
      placeholder: 'Select schedule...',
      dots: {
        'daily': '#1fcf93',
        'weekly': '#5b7cff',
        'monthly': '#ffb020',
        'disabled': '#ff5d86'
      }
    },
    'auto-filter-dir': {
      category: 3,
      type: 'status',
      tint: '15,23,42',
      placeholder: 'All Directions',
      dots: {
        '': '#64748b',
        'debit': '#b91c1c',
        'credit': '#15803d'
      }
    },
    'auto-filter-status': {
      category: 3,
      type: 'status',
      tint: '15,23,42',
      showBadges: true,
      placeholder: 'All Statuses',
      dots: {
        '': '#64748b',
        'unassigned': '#b45309',
        'assigned': '#15803d',
        'ai_assigned': '#0f172a'
      }
    },

    // -------------------------------------------------------------
    // Category 5: Searchable with live filter
    // -------------------------------------------------------------
    'client': {
      category: 5,
      type: 'searchable',
      search: true,
      tint: '91,124,255',
      placeholder: 'Select client...',
      searchPlaceholder: 'Search client by name or file no...'
    },
    'auto-select-company': {
      category: 5,
      type: 'searchable',
      search: true,
      tint: '15,23,42',
      placeholder: 'Select Tally company...',
      searchPlaceholder: 'Search Tally company...'
    },
    'auto-select-bank-ledger': {
      category: 5,
      type: 'searchable',
      search: true,
      tint: '15,23,42',
      placeholder: 'Select Bank Account in Tally...',
      searchPlaceholder: 'Search bank ledger...'
    },
    'auto-modal-ledger-select': {
      category: 5,
      type: 'searchable',
      search: true,
      tint: '15,23,42',
      placeholder: '-- Choose Tally Master Ledger --',
      searchPlaceholder: 'Search master ledgers...'
    }
  };

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

  /**
   * Transforms a native <select> into a high-fidelity Glass UI dropdown.
   * Full two-way synchronization:
   * - user picks in glass dropdown -> updates select.value, select.selectedIndex, triggers onchange and change/input events.
   * - JS sets select.value or select.innerHTML -> glass dropdown automatically rebuilds and refreshes.
   */
  function createGlassDropdown(selectEl, customOptions = {}) {
    if (!selectEl || !selectEl.parentElement) return null;

    // If already initialized, update and return existing wrapper
    if (selectEl._glassDropdown) {
      selectEl._glassDropdown.rebuild();
      return selectEl._glassDropdown.wrapper;
    }

    const selectId = selectEl.id || '';
    const spec = DROPDOWN_SPECS[selectId] || {};
    const opts = Object.assign({}, spec, customOptions);

    const isSearchable = Boolean(opts.search || (selectEl.dataset && selectEl.dataset.searchable === 'true') || selectEl.options.length > 8);
    const category = opts.category || (isSearchable ? 5 : 1);
    const isCompact = Boolean(opts.compact || (selectEl.classList && typeof selectEl.classList.contains === 'function' && selectEl.classList.contains('compact-cc')) || selectId === 'manual-mobile-cc');

    // Create custom wrapper
    const wrapper = document.createElement('div');
    let wrapperClasses = ['g-dd', 'vs-dd', 'dd'];
    if (isCompact) wrapperClasses.push('g-dd-compact');
    if (isSearchable) wrapperClasses.push('g-dd-searchable');
    if (category === 2) wrapperClasses.push('g-dd-cat2');
    if (category === 3) wrapperClasses.push('g-dd-cat3');
    if (opts.className) wrapperClasses.push(opts.className);

    wrapper.className = wrapperClasses.join(' ');
    wrapper.setAttribute('data-style', 'glass');
    if (selectId) wrapper.id = `g-dd-${selectId}`;

    // Read items & metadata from native select
    let items = [];
    let selectedIndex = 0;
    let query = '';
    let hlIndex = -1;

    function parseItem(opt, idx) {
      const val = opt.value;
      const rawText = opt.text || opt.innerText || val || '';
      let displayLabel = rawText;
      let badge = '';
      let desc = '';
      let color = '';
      let iconSvg = '';
      let iconText = '';

      // Check category-specific metadata
      if (category === 1) {
        // Basic select
      } else if (category === 2) {
        // Icon + description
        if (opts.initialBadge) {
          iconText = getFirmTypeInitial(val || rawText);
        }
        if (opts.descriptions) {
          const lk = (val || rawText).toLowerCase();
          desc = opts.descriptions[lk] || opts.descriptions[val] || '';
        }
        if (opts.itemOverrides && opts.itemOverrides[val]) {
          const ov = opts.itemOverrides[val];
          if (ov.desc) desc = ov.desc;
          if (ov.icon && SVG_ICONS[ov.icon]) iconSvg = SVG_ICONS[ov.icon];
          if (ov.iconText) iconText = ov.iconText;
        }
      } else if (category === 3) {
        // Status dots
        const lk = (val || '').toLowerCase();
        if (opts.dots) {
          color = opts.dots[lk] !== undefined ? opts.dots[lk] : (opts.dots[val] || opts.dots['']);
        }
        if (!color) {
          if (lk.includes('active') || lk.includes('credit') || lk.includes('daily') || lk.includes('assign')) color = '#1fcf93';
          else if (lk.includes('inactive') || lk.includes('debit') || lk.includes('disabled')) color = '#ff5d86';
          else if (lk.includes('weekly')) color = '#5b7cff';
          else if (lk.includes('monthly') || lk.includes('unassign')) color = '#ffb020';
          else color = '#9a5cff';
        }
        // Extract count badge if formatted like "All Statuses (12)"
        if (opts.showBadges || rawText.includes('(')) {
          const m = rawText.match(/^(.*?)\s*\(([0-9]+)\)$/);
          if (m) {
            displayLabel = m[1].trim();
            badge = m[2];
          }
        }
      }

      return {
        v: rawText,
        value: val,
        label: displayLabel,
        badge: badge,
        desc: desc,
        color: color,
        iconSvg: iconSvg,
        iconText: iconText,
        selected: Boolean(opt.selected),
        disabled: Boolean(opt.disabled),
        optRef: opt
      };
    }

    function readOptions() {
      items = Array.from(selectEl.options || []).map(parseItem);
      selectedIndex = selectEl.selectedIndex >= 0 ? selectEl.selectedIndex : 0;
      if (selectedIndex >= items.length && items.length > 0) selectedIndex = 0;
    }

    readOptions();

    const tintColor = opts.tint || '91,124,255';
    const searchPh = opts.searchPlaceholder || 'Type to filter...';

    wrapper.innerHTML = `
      <button type="button" class="g-trg trg" aria-haspopup="listbox" aria-expanded="false">
        <span class="g-val val"></span>${CHEV_SVG}
      </button>
      <div class="g-pn pn">
        ${isSearchable ? `
          <div class="g-search search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
            <input type="text" placeholder="${esc(searchPh)}" aria-label="Filter options" autocomplete="off" />
          </div>
        ` : ''}
        <div class="g-lw lw gs fd" style="--t:${tintColor}">
          <ul class="g-list list" role="listbox"></ul>
          <div class="g-sbar sbar" aria-hidden="true"><i></i></div>
        </div>
      </div>
    `;

    // Hide native select visually
    selectEl.style.display = 'none';
    if (selectEl.dataset) selectEl.dataset.glassDropdownInitialized = 'true';
    selectEl.parentElement.insertBefore(wrapper, selectEl.nextSibling);

    const trg = wrapper.querySelector('.g-trg');
    const pn = wrapper.querySelector('.g-pn');
    const lw = wrapper.querySelector('.g-lw');
    const list = wrapper.querySelector('.g-list');
    const bar = wrapper.querySelector('.g-sbar');
    const th = bar ? bar.querySelector('i') : null;
    const searchIn = wrapper.querySelector('.g-search input') || wrapper.querySelector('input');
    const valSpan = wrapper.querySelector('.g-val');

    function visibleIndices() {
      return items.map((_, i) => i).filter(i => {
        if (!query) return true;
        const it = items[i];
        return (it.v && it.v.toLowerCase().includes(query)) ||
               (it.value && it.value.toLowerCase().includes(query)) ||
               (it.desc && it.desc.toLowerCase().includes(query));
      });
    }

    function paintVal() {
      const it = (selectedIndex >= 0 && items[selectedIndex]) ? items[selectedIndex] : null;
      if (!it || (!it.value && !it.v && items.length > 1)) {
        valSpan.className = 'g-val val ph';
        valSpan.textContent = opts.placeholder || 'Select...';
        return;
      }

      valSpan.className = 'g-val val';
      let html = '';

      if (category === 3 && it.color) {
        html += `<span class="g-dot dot" style="color:${it.color};background:${it.color};display:inline-block;margin-right:8px;"></span>`;
      } else if (category === 2) {
        if (it.iconSvg) {
          html += `<span class="g-mi-icon" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;">${it.iconSvg}</span>`;
        } else if (it.iconText) {
          html += `<span class="g-lt lt" style="width:22px;height:22px;font-size:11px;display:inline-grid;place-items:center;margin-right:6px;border-radius:6px;">${esc(it.iconText)}</span>`;
        }
      }

      html += `<span class="g-val-text">${esc(it.label || it.v)}</span>`;
      if (it.badge) {
        html += `<span class="g-count-badge">${esc(it.badge)}</span>`;
      }
      valSpan.innerHTML = html;
    }

    function paintList() {
      const vis = visibleIndices();
      if (vis.length === 0) {
        list.innerHTML = '<li class="g-empty empty">No matching options</li>';
        refreshScroll();
        return;
      }

      list.innerHTML = items.map((it, i) => {
        if (!vis.includes(i)) return '';
        const isSel = (i === selectedIndex);
        const isHl = (i === hlIndex);

        let lead = '';
        if (category === 3 && it.color) {
          lead = `<span class="g-dot dot" style="color:${it.color};background:${it.color};"></span>`;
        } else if (category === 2) {
          if (it.iconSvg) {
            lead = `<span class="g-mi-icon">${it.iconSvg}</span>`;
          } else if (it.iconText) {
            lead = `<span class="g-lt lt">${esc(it.iconText)}</span>`;
          }
        }

        const sub = it.desc ? `<small>${esc(it.desc)}</small>` : '';
        const badgeHtml = it.badge ? `<span class="g-count-badge">${esc(it.badge)}</span>` : '';

        return `
          <li class="g-it it${isHl ? ' hl' : ''}" role="option" aria-selected="${isSel}" data-i="${i}">
            ${lead}
            <span class="g-t t">${esc(it.label || it.v)}${badgeHtml}${sub}</span>
            ${isSel ? CK_SVG : ''}
          </li>
        `;
      }).join('');

      refreshScroll();
    }

    function refreshScroll() {
      if (!list || !lw) return;
      const ft = list.scrollTop > 2;
      const fb = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
      lw.style.setProperty('--ft', ft ? '22px' : '0px');
      lw.style.setProperty('--fb', fb ? '22px' : '0px');

      if (bar && th) {
        const h = list.clientHeight;
        const sh = list.scrollHeight;
        if (sh <= h + 2) {
          bar.style.display = 'none';
          return;
        }
        bar.style.display = '';
        const tr = bar.clientHeight;
        const tl = Math.max(30, Math.min(42, tr * (h / sh)));
        const mx = tr - tl;
        const p = (sh > h) ? (list.scrollTop / (sh - h)) : 0;
        th.style.height = tl + 'px';
        th.style.transform = `translateY(${p * mx}px)`;
      }
    }

    function open(isOpen) {
      if (isOpen) {
        document.querySelectorAll('.g-dd.open, .vs-dd.open, .dd.open').forEach(d => {
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
          setTimeout(() => searchIn.focus(), 40);
        } else {
          paintList();
        }
        setTimeout(refreshScroll, 30);
      }
    }

    function pick(i) {
      if (i < 0 || i >= items.length) return;
      const it = items[i];
      if (it.disabled) return;

      selectedIndex = i;
      selectEl.selectedIndex = i;
      selectEl.value = it.value;

      // Trigger change and onchange
      if (typeof selectEl.onchange === 'function') {
        try { selectEl.onchange(new Event('change', { bubbles: true })); } catch (_) {}
      }
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));

      open(false);
      paintVal();
      paintList();
      trg.focus();
    }

    function syncFromSelect() {
      let idx = selectEl.selectedIndex;
      if (idx < 0 && selectEl.value) {
        idx = items.findIndex(it => it.value === selectEl.value);
      }
      if (idx >= 0 && idx < items.length) {
        selectedIndex = idx;
      }
      paintVal();
      paintList();
    }

    function rebuildItems() {
      readOptions();
      paintVal();
      paintList();
    }

    // Event listeners
    trg.onclick = (e) => {
      e.stopPropagation();
      open(!wrapper.classList.contains('open'));
    };

    list.onclick = (e) => {
      const li = e.target.closest('.g-it, .it');
      const idx = li ? (li.dataset && li.dataset.i !== undefined ? li.dataset.i : li.getAttribute('data-i')) : null;
      if (idx !== null && idx !== undefined) {
        pick(Number(idx));
      }
    };

    if (searchIn) {
      searchIn.oninput = () => {
        query = searchIn.value.trim().toLowerCase();
        const vis = visibleIndices();
        hlIndex = vis.length > 0 ? vis[0] : -1;
        paintList();
      };
    }

    let scrollDebounce;
    list.addEventListener('scroll', () => {
      lw.classList.add('scrolling');
      clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => lw.classList.remove('scrolling'), 800);
      refreshScroll();
    });

    // Liquid glass scrollbar drag physics
    if (bar && th) {
      let isDragging = false;
      let y0 = 0;
      let s0 = 0;

      const onPointerMove = (ev) => {
        if (!isDragging) return;
        const h = list.clientHeight;
        const sh = list.scrollHeight;
        const tr = bar.clientHeight;
        const tl = th.offsetHeight;
        const mx = tr - tl;
        if (mx > 0) {
          list.scrollTop = s0 + (ev.clientY - y0) * (sh - h) / mx;
        }
      };

      const onPointerUp = (ev) => {
        if (!isDragging) return;
        isDragging = false;
        bar.classList.remove('drag');
        try { th.releasePointerCapture(ev.pointerId); } catch (_) {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      th.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { th.setPointerCapture(e.pointerId); } catch (_) {}
        y0 = e.clientY;
        s0 = list.scrollTop;
        isDragging = true;
        bar.classList.add('drag');
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });

      bar.addEventListener('pointerdown', (e) => {
        if (e.target === th) return;
        const r = th.getBoundingClientRect();
        list.scrollBy({ top: (e.clientY < r.top ? -1 : 1) * list.clientHeight * 0.8, behavior: 'smooth' });
      });

      bar.addEventListener('wheel', (e) => {
        e.preventDefault();
        list.scrollTop += e.deltaY;
      }, { passive: false });
    }

    // Keyboard navigation
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
        if (vis.length === 0) return;
        const curr = vis.indexOf(hlIndex);
        const next = e.key === 'ArrowDown' ? curr + 1 : curr - 1;
        const norm = (next + vis.length) % vis.length;
        hlIndex = vis[norm];
        paintList();
        const hlEl = list.querySelector('.g-it.hl, .it.hl');
        if (hlEl) hlEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && wrapper.classList.contains('open') && hlIndex >= 0) {
        e.preventDefault();
        pick(hlIndex);
      }
    };

    // Watch for direct events on selectEl
    selectEl.addEventListener('change', syncFromSelect);
    selectEl.addEventListener('input', syncFromSelect);

    // Watch for dynamic DOM changes (e.g. innerHTML replacement, new option elements)
    const domObserver = new MutationObserver(() => {
      rebuildItems();
    });
    domObserver.observe(selectEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['selected', 'value', 'disabled']
    });

    // Intercept programmatic .value and .selectedIndex setter calls on selectEl
    try {
      const origValDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      const origIdxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

      Object.defineProperty(selectEl, 'value', {
        get() {
          return origValDesc ? origValDesc.get.call(this) : this.getAttribute('value');
        },
        set(newVal) {
          if (origValDesc) origValDesc.set.call(this, newVal);
          syncFromSelect();
        },
        configurable: true
      });

      Object.defineProperty(selectEl, 'selectedIndex', {
        get() {
          return origIdxDesc ? origIdxDesc.get.call(this) : -1;
        },
        set(newIdx) {
          if (origIdxDesc) origIdxDesc.set.call(this, newIdx);
          syncFromSelect();
        },
        configurable: true
      });
    } catch (_) {}

    // Store controller reference for external sync & teardown
    selectEl._glassDropdown = {
      wrapper: wrapper,
      sync: syncFromSelect,
      rebuild: rebuildItems,
      open: () => open(true),
      close: () => open(false),
      destroy: () => {
        domObserver.disconnect();
        wrapper.remove();
        selectEl.style.display = '';
        delete selectEl._glassDropdown;
      }
    };

    paintVal();
    paintList();
    return wrapper;
  }

  // Global document click closes open dropdowns
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.g-dd.open, .vs-dd.open, .dd.open').forEach(d => {
      if (!d.contains(e.target)) {
        d.classList.remove('open');
        const t = d.querySelector('.g-trg, .trg');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Global Hook to enhance all existing or newly added select elements
  function enhanceAllSelects(root = document) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('select:not([data-no-glass]):not([data-glass-dropdown-initialized])').forEach(sel => {
      createGlassDropdown(sel);
    });
  }

  // Auto-observer for newly added selects in the document
  let autoEnhanceDebounce;
  const bodyObserver = new MutationObserver(() => {
    clearTimeout(autoEnhanceDebounce);
    autoEnhanceDebounce = setTimeout(() => {
      enhanceAllSelects(document.body);
    }, 40);
  });

  if (document.body) {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Expose GlassUI Global API
  window.GlassUI = {
    renderFileIcon: renderGlassFileIcon,
    renderPillSwitch: renderPillSwitch,
    createDropdown: createGlassDropdown,
    enhanceAllSelects: enhanceAllSelects,
    specs: DROPDOWN_SPECS
  };

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAllSelects());
  } else {
    setTimeout(enhanceAllSelects, 30);
  }

})();
