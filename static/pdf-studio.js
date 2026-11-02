(function () {
'use strict';

/**
 * VS Database — Studio Subsystem
 * Complete implementation matching UI/Desired/HTML/studioui.html
 * Strictly scoped under #studio-root and #studio-portal.
 * Zero console / sidebar / topbar contamination.
 */

// ============================================================
// DATA-DRIVEN CATEGORIES & TOOLS REGISTRY
// ============================================================
const STUDIO_CATEGORIES = [
  {
    id: "pdf",
    name: "PDF Tools",
    icon: "M6 3h8l4 4v14H6zM14 3v4h4",
    tools: [
      {
        id: "merge",
        name: "Merge PDF",
        desc: "Combine PDFs into one",
        icon: "M6 4v6a4 4 0 004 4h8M14 10l4 4-4 4",
        gradient: "#7f98ff,#4c5fe0",
        minFiles: 2,
        backendTool: "merge_pdf"
      },
      {
        id: "split",
        name: "Split PDF",
        desc: "Pages or page ranges",
        icon: "M12 4v16M5 8l-2 4 2 4M19 8l2 4-2 4",
        gradient: "#ffa561,#f25f22",
        minFiles: 1,
        backendTool: "split_pdf"
      },
      {
        id: "rotate",
        name: "Rotate PDF",
        desc: "Rotate pages 90, 180, 270",
        icon: "M20 12a8 8 0 10-3 6.2M20 5v5h-5",
        gradient: "#c08bff,#7a4be0",
        minFiles: 1,
        backendTool: "rotate_pages"
      },
      {
        id: "compress",
        name: "Compress PDF",
        desc: "Reduce file size",
        icon: "M12 3v7M8 7l4 4 4-4M12 21v-7M8 17l4-4 4 4",
        gradient: "#45e6a6,#0f9a57",
        minFiles: 1,
        backendTool: "compress_pdf"
      },
      {
        id: "unlock",
        name: "Unlock PDF",
        desc: "Remove the password",
        icon: "M7 11V8a5 5 0 019-3M5 11h14v9H5z",
        gradient: "#ff8aa6,#d91f3d",
        minFiles: 1,
        backendTool: "unlock_pdf"
      },
      {
        id: "protect",
        name: "Protect PDF",
        desc: "Secure with a password",
        icon: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
        gradient: "#7f98ff,#3a55d9",
        minFiles: 1,
        backendTool: "lock_pdf"
      },
      {
        id: "extract",
        name: "Extract Pages",
        desc: "Save pages as a new PDF",
        icon: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6",
        gradient: "#8d9bff,#5560d8",
        minFiles: 1,
        backendTool: "extract_pages"
      },
      {
        id: "delete",
        name: "Delete Pages",
        desc: "Remove unwanted pages",
        icon: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
        gradient: "#ff8aa6,#e0245a",
        minFiles: 1,
        backendTool: "delete_pages"
      },
      {
        id: "reorder",
        name: "Reorder Pages",
        desc: "Rearrange the sequence",
        icon: "M8 4v16M5 7l3-3 3 3M16 20V4M13 17l3 3 3-3",
        gradient: "#ffc15f,#e8870a",
        minFiles: 1,
        backendTool: "rearrange_pages"
      },
      {
        id: "watermark",
        name: "Add Watermark",
        desc: "Text or image overlay",
        icon: "M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z",
        gradient: "#5eead0,#17a98e",
        minFiles: 1,
        backendTool: "watermark_pdf"
      },
      {
        id: "numbers",
        name: "Page Numbers",
        desc: "Insert page numbers",
        icon: "M5 4h14v16H5zM10 9l2-2v7",
        gradient: "#6fb4ff,#2756d9",
        minFiles: 1,
        backendTool: "page_numbers"
      },
      {
        id: "images",
        name: "Convert to Images",
        desc: "Export pages as JPG or PNG",
        icon: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01",
        gradient: "#d79bff,#a24be0",
        minFiles: 1,
        backendTool: "convert_images"
      }
    ]
  }
];

const STUDIO_TOOL_ACTIONS = {
  merge: "Merge PDFs",
  split: "Split PDF",
  rotate: "Rotate pages",
  compress: "Compress PDF",
  unlock: "Unlock PDF",
  protect: "Protect PDF",
  extract: "Extract pages",
  delete: "Delete pages",
  reorder: "Apply order",
  watermark: "Add watermark",
  numbers: "Add page numbers",
  images: "Convert to images"
};

const STUDIO_OUTPUT_SUFFIXES = {
  merge: "merge-pdf",
  split: "split-pdf",
  rotate: "rotate-pdf",
  compress: "compress-pdf",
  unlock: "unlock-pdf",
  protect: "protect-pdf",
  extract: "extract-pages",
  delete: "delete-pages",
  reorder: "rearrange-pages",
  watermark: "watermark",
  numbers: "page-numbers",
  images: "images"
};

const STUDIO_ORGANIZER_MODES = {
  delete: "delete",
  extract: "extract",
  reorder: "reorder",
  images: "convert"
};

// ============================================================
// STATE
// ============================================================
let currentCategory = "pdf";
let isCategoryOpen = true;
let currentToolId = "split";
let studioDocs = []; // Array of { id, name, kb, numbered, num, hist, orig, pages: [{ o, rot, imgUrl }], file, sessionId, pageCount }
let activeDocId = null;
let studioZoom = 1.0;
let studioPreviewPage = 0;
let currentPdfSession = null;
let pdfStudioOriginContext = null;
let uidCounter = 1;
let isUploadingDocs = false;

// Organizer State
let M = null;
let modalOpener = null;
let dragIndex = null;

const MODE_DESCS = {
  delete: ["Delete pages", "Tick the pages you want to remove."],
  extract: ["Extract pages", "Tick the pages to save as a new PDF."],
  reorder: ["Reorder pages", "Drag pages into the new order, or focus one and press Alt + arrow keys."],
  convert: ["Convert to images", "Tick the pages to export as images."]
};

const STUDIO_VALUES = {
  mode: "Extract page range",
  angle: "90° clockwise",
  which: "All pages",
  level: "Balanced",
  pos: "Center",
  fmt: "Page 1",
  npos: "Bottom center",
  em: "One combined PDF",
  cf: "JPG",
  dpi: "150 DPI"
};

const STUDIO_SELECTIONS = {
  delete: new Set(),
  extract: new Set(),
  convert: new Set()
};

const STUDIO_INPUTS = {
  rg: "",
  adv: "",
  seq: "",
  pw: "",
  wm: "CONFIDENTIAL",
  ns: "1",
  all: false,
  out: ""
};

// SVG icons
const SVG_TICK = '<svg viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const svgIcon = p => `<svg viewBox="0 0 24 24"><path d="${p}"/></svg>`;

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[c]));
}

function currentDoc() {
  return studioDocs.find(d => d.id === activeDocId) || null;
}

function baseDocName(d) {
  return (d && d.name ? d.name : "document").replace(/\.pdf$/i, "");
}

function getExpectedOutputName(d) {
  if (!d) return "output.pdf";
  const suffix = STUDIO_OUTPUT_SUFFIXES[currentToolId] || currentToolId;
  const ext = currentToolId === "images" ? ".zip" : ".pdf";
  return `${baseDocName(d)}_${suffix}${ext}`;
}

function snapDoc(d) {
  return JSON.stringify({
    p: (d.pages || []).map(p => ({ ...p })),
    n: d.numbered,
    ns: d.numberingSettings || null,
    s: d.num,
    k: d.kb,
    c: d.pageCount,
    v: d.version || 1
  });
}

function restoreDoc(d, snapshotStr) {
  try {
    const o = JSON.parse(snapshotStr);
    d.pages = o.p || [];
    d.numbered = o.n || false;
    d.numberingSettings = o.ns || null;
    d.num = o.s || 1;
    d.kb = o.k || d.kb;
    d.pageCount = o.c || d.pages.length;
    d.version = (o.v || 1) + 1;
  } catch (err) {
    console.warn("Restore snapshot failed:", err);
  }
}

function pushSnapshot(d) {
  if (!d.hist) d.hist = [];
  d.hist.push(snapDoc(d));
}

function parseRange(s, n) {
  s = (s || "").trim();
  if (!s) return { err: "Enter at least one page" };
  const out = new Set();
  for (const part of s.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(t);
    if (!m) return { err: `"${t}" is not a valid page or range` };
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (a < 1 || b < a) return { err: `"${t}" is not a valid range` };
    if (b > n) return { err: `Page ${b} does not exist. This file has ${n} page${n > 1 ? "s" : ""}` };
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return { set: out };
}

// ============================================================
// PORTAL & TOAST
// ============================================================
function ensureStudioPortal() {
  let portal = document.getElementById("studio-portal");
  if (!portal) {
    portal = document.createElement("div");
    portal.id = "studio-portal";
    portal.innerHTML = `
      <div id="gsp" class="glass" role="listbox"></div>
      <div id="mbg">
        <div class="modal glass" role="dialog" aria-modal="true" aria-labelledby="mtl" id="modal">
          <div class="mh">
            <div><h2 id="mtl"></h2><p id="msub"></p></div>
            <button class="xb" id="mx" aria-label="Close">${SVG_CROSS}</button>
          </div>
          <div class="mt" id="mtool"></div>
          <div class="mb"><div class="mg" id="mgrid"></div></div>
          <div class="mf" id="mfoot"></div>
        </div>
      </div>
      <div class="toast glass" id="toast" role="status"></div>
    `;
    document.body.appendChild(portal);
  }
  return portal;
}

let toastTimer = null;
function studioToast(msg) {
  ensureStudioPortal();
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("on");
  }, 2400);
}

function promptPageNumberingUpdate() {
  return new Promise(resolve => {
    ensureStudioPortal();
    const portal = document.getElementById("studio-portal");
    let bg = document.getElementById("st-pnum-dialog");
    if (!bg) {
      bg = document.createElement("div");
      bg.id = "st-pnum-dialog";
      bg.style.cssText = "position:fixed;inset:0;z-index:2500;display:grid;place-items:center;background:rgba(20,15,40,0.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity 0.25s;";
      bg.innerHTML = `
        <div class="glass" style="width:min(440px,90vw);padding:26px 28px;border-radius:22px;box-shadow:0 18px 45px rgba(40,25,80,0.28);background:rgba(255,255,255,0.88);display:flex;flex-direction:column;gap:18px;">
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="width:40px;height:40px;border-radius:12px;background:rgba(90,120,255,0.14);display:grid;place-items:center;color:#4c5fe0;flex-shrink:0;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v16H5zM10 9l2-2v7"/></svg>
            </div>
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text,#1e1b4b);">Page Numbers Notice</h3>
              <p style="margin:6px 0 0;font-size:13.5px;color:var(--dim,#6b7280);line-height:1.45;">This task will change your page numbers. Do you want to:</p>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:4px;">
            <button class="btn ghost" id="st-pnum-keep" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;">Keep Same</button>
            <button class="btn" id="st-pnum-update" style="padding:9px 20px;border-radius:10px;font-size:13px;font-weight:600;background:linear-gradient(135deg,#6fb4ff,#2756d9);color:#fff;">Update</button>
          </div>
        </div>
      `;
      portal.appendChild(bg);
    }

    const keepBtn = document.getElementById("st-pnum-keep");
    const updateBtn = document.getElementById("st-pnum-update");

    function cleanup(choice) {
      bg.style.opacity = "0";
      bg.style.pointerEvents = "none";
      if (keepBtn) keepBtn.onclick = null;
      if (updateBtn) updateBtn.onclick = null;
      resolve(choice);
    }

    if (keepBtn) keepBtn.onclick = () => cleanup("keep");
    if (updateBtn) updateBtn.onclick = () => cleanup("update");

    bg.style.pointerEvents = "auto";
    bg.style.opacity = "1";
  });
}

// ============================================================
// GLASS SELECT DROPDOWN (1:1 with studioui.html)
// ============================================================
let gsEl = null;
let gsOpts = [];
let gsAct = 0;
let gsType = "";

function mkSel(el) {
  const id = el.dataset.id;
  const o = el.dataset.opts.split("|");
  const currentVal = STUDIO_VALUES[id] || o[0];
  STUDIO_VALUES[id] = currentVal;

  el.innerHTML = `
    <button type="button" class="gs-btn" role="combobox" aria-haspopup="listbox" aria-expanded="false">
      <span>${escapeHtml(currentVal)}</span>
      <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  `;

  const b = el.querySelector(".gs-btn");
  if (!b) return;

  b.onclick = e => {
    e.stopPropagation();
    if (gsEl === el) {
      gsClose();
    } else {
      gsOpen(el, id, o);
    }
  };

  b.onkeydown = e => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      if (gsEl !== el) gsOpen(el, id, o);
    }
  };
}

function gsOpen(el, id, o) {
  gsClose();
  ensureStudioPortal();
  const gsp = document.getElementById("gsp");
  if (!gsp) return;

  gsEl = el;
  gsOpts = o;
  gsAct = Math.max(0, o.indexOf(STUDIO_VALUES[id]));
  gsType = id;

  const b = el.querySelector(".gs-btn");
  if (b) b.setAttribute("aria-expanded", "true");

  gsp.innerHTML = o.map((x, i) => `
    <div class="go ${x === STUDIO_VALUES[id] ? "sl" : ""} ${i === gsAct ? "act" : ""}" role="option" data-i="${i}">
      ${escapeHtml(x)}
      ${x === STUDIO_VALUES[id] ? SVG_TICK : ""}
    </div>
  `).join("");

  const r = b.getBoundingClientRect();
  const width = Math.max(r.width, 180);
  gsp.style.width = width + "px";
  gsp.style.left = Math.min(r.left, window.innerWidth - width - 8) + "px";

  const h = Math.min(280, o.length * 40 + 12);
  const fitsBelow = window.innerHeight - r.bottom >= h + 16;
  gsp.style.top = (fitsBelow ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + "px";

  requestAnimationFrame(() => gsp.classList.add("show"));
}

function gsClose() {
  if (!gsEl) return;
  const b = gsEl.querySelector(".gs-btn");
  if (b) b.setAttribute("aria-expanded", "false");
  const gsp = document.getElementById("gsp");
  if (gsp) gsp.classList.remove("show");
  gsEl = null;
}

function gsPick(i) {
  const id = gsType;
  const el = gsEl;
  const v = gsOpts[i];
  STUDIO_VALUES[id] = v;
  if (el) {
    const span = el.querySelector(".gs-btn span");
    if (span) span.textContent = v;
  }
  gsClose();
  onSelectOption(id);
}

function onSelectOption(id) {
  if (M) {
    renderOrgFoot();
    return;
  }
  if (id === "mode" || id === "fmt" || id === "npos") {
    renderSettingsPanel();
  }
  validateSettings();
}

// Global dismiss listeners for Glass Select
document.addEventListener("click", e => {
  const go = e.target.closest("#gsp .go");
  if (go) {
    gsPick(+go.dataset.i);
    return;
  }
  if (gsEl && !e.target.closest("#gsp") && !e.target.closest(".gs-btn")) {
    gsClose();
  }
});

document.addEventListener("mousemove", e => {
  const go = e.target.closest("#gsp .go");
  if (go && gsEl) {
    gsAct = +go.dataset.i;
    const gsp = document.getElementById("gsp");
    if (gsp) {
      gsp.querySelectorAll(".go").forEach((x, i) => x.classList.toggle("act", i === gsAct));
    }
  }
});

window.addEventListener("scroll", () => {
  if (gsEl) gsClose();
}, true);
window.addEventListener("resize", gsClose);

document.addEventListener("keydown", e => {
  if (gsEl) {
    if (e.key === "Escape") {
      e.preventDefault();
      const b = gsEl.querySelector(".gs-btn");
      gsClose();
      if (b) b.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      gsAct = (gsAct + (e.key === "ArrowDown" ? 1 : -1) + gsOpts.length) % gsOpts.length;
      const gsp = document.getElementById("gsp");
      if (gsp) {
        gsp.querySelectorAll(".go").forEach((x, i) => x.classList.toggle("act", i === gsAct));
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      gsPick(gsAct);
      return;
    }
    if (e.key.length === 1) {
      const idx = gsOpts.findIndex(x => x.toLowerCase().startsWith(e.key.toLowerCase()));
      if (idx >= 0) {
        gsAct = idx;
        const gsp = document.getElementById("gsp");
        if (gsp) {
          gsp.querySelectorAll(".go").forEach((x, k) => x.classList.toggle("act", k === idx));
        }
      }
      return;
    }
  }
});

// ============================================================
// RENDERING: CATEGORY BAR & COLLAPSE
// ============================================================
function renderCategoryBar() {
  const catsEl = document.getElementById("cats");
  const tcolEl = document.getElementById("tcol");
  if (!catsEl) return;

  catsEl.innerHTML = STUDIO_CATEGORIES.map(cat => {
    const isSelected = cat.id === currentCategory;
    const isExpanded = isSelected ? isCategoryOpen : false;
    return `
      <button class="cat ${isSelected ? "on" : ""}" role="tab" data-cat="${cat.id}" aria-selected="${isSelected}" aria-expanded="${isExpanded}">
        <svg viewBox="0 0 24 24"><path d="${cat.icon}"/></svg>
        ${escapeHtml(cat.name)} (${cat.tools.length})
        <svg class="chev" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>
      </button>
    `;
  }).join("");

  if (tcolEl) {
    tcolEl.classList.toggle("closed", !isCategoryOpen);
  }
}

// ============================================================
// RENDERING: 12 TOOL CARDS
// ============================================================
function renderToolCards() {
  const toolsEl = document.getElementById("tools");
  const bannerEl = document.getElementById("banner");
  if (!toolsEl) return;

  const currentCatObj = STUDIO_CATEGORIES.find(c => c.id === currentCategory) || STUDIO_CATEGORIES[0];
  const n = studioDocs.length;

  if (bannerEl) {
    bannerEl.classList.toggle("hide", n > 0);
  }

  toolsEl.innerHTML = currentCatObj.tools.map(t => {
    const isMerge = t.id === "merge";
    const isDis = !n || (isMerge && n < 2);
    const isSelected = currentToolId === t.id;
    const subtext = (isMerge && n === 1) ? "Add one more PDF" : t.desc;

    return `
      <button class="tool ${isSelected ? "on" : ""}" data-tool="${t.id}" ${isDis ? "disabled" : ""} aria-label="${escapeHtml(t.name)}">
        <span class="ti" style="background:linear-gradient(135deg, ${t.gradient})">
          <svg viewBox="0 0 24 24"><path d="${t.icon}"/></svg>
        </span>
        <span>
          <b>${escapeHtml(t.name)}</b>
          <small>${escapeHtml(subtext)}</small>
        </span>
      </button>
    `;
  }).join("");
}

// ============================================================
// RENDERING: TWO-COLUMN WORKSPACE SHELL
// ============================================================
function renderAddFilesPanel() {
  const addp = document.getElementById("addp");
  if (!addp) return;

  const rows = studioDocs.map((d, i) => `
    <div class="fr ${d.id === activeDocId ? "on" : ""}" data-doc-id="${d.id}" tabindex="0" role="button" aria-label="Select ${escapeHtml(d.name)}">
      <span class="pdf">PDF</span>
      <div class="fi">
        <b>${escapeHtml(d.name)}</b>
        <small>${d.kb} KB · ${d.pages.length} page${d.pages.length > 1 ? "s" : ""}</small>
      </div>
      <div class="ctl">
        ${studioDocs.length > 1 ? `
          <button data-action="up" aria-label="Move up" ${i ? "" : "disabled"}>
            <svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>
          </button>
          <button data-action="dn" aria-label="Move down" ${i < studioDocs.length - 1 ? "" : "disabled"}>
            <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        ` : ""}
        <button class="x" data-action="rm" aria-label="Remove">${SVG_CROSS}</button>
      </div>
    </div>
  `).join("");

  addp.innerHTML = `
    <h2>Add Files<small>Max 50 MB</small></h2>
    <div class="drop" id="drop">
      <b>Choose PDF files</b>
      <span>or drag and drop them here</span>
      <button class="btn" id="choose" ${isUploadingDocs ? "disabled" : ""}>
        ${isUploadingDocs ? "Processing..." : "+ Choose files"}
      </button>
      <input type="file" id="fin" accept=".pdf,application/pdf" multiple hidden>
    </div>
    <div class="fl">
      <h3>Selected files (${studioDocs.length})${studioDocs.length ? `<button class="link" id="clr">Clear all</button>` : ""}</h3>
      ${rows || `<div class="none">No files yet.<br>Choose or drop PDF files above to begin.</div>`}
    </div>
  `;
}

function field(id, l, o) {
  return `<div class="fld"><label>${escapeHtml(l)}</label><div class="sel" data-id="${id}" data-opts="${escapeHtml(o)}"></div></div>`;
}

function tfield(id, l, ph, help, type) {
  return `
    <div class="fld">
      <label for="${id}">${escapeHtml(l)}</label>
      <input class="inp" id="${id}" type="${type || "text"}" value="${escapeHtml(STUDIO_INPUTS[id] || "")}" placeholder="${escapeHtml(ph || "")}">
      ${help ? `<small>${escapeHtml(help)}</small>` : ""}
    </div>
  `;
}

function renderSettingsPanel() {
  const setp = document.getElementById("setp");
  if (!setp) return;

  const currentCatObj = STUDIO_CATEGORIES.find(c => c.id === currentCategory) || STUDIO_CATEGORIES[0];
  const toolObj = currentCatObj.tools.find(t => t.id === currentToolId) || currentCatObj.tools[0];
  const d = currentDoc();

  if (!d) {
    setp.innerHTML = `
      <h2>${escapeHtml(toolObj.name)} settings</h2>
      <div class="ph">
        <b>No PDF selected</b>
        Add a PDF to see the tool settings.
      </div>
    `;
    return;
  }

  const n = d.pages.length;
  let fieldsHtml = tfield("out", "Output file name", "", "");
  fieldsHtml = fieldsHtml.replace(`value="${escapeHtml("")}"`, `value="${escapeHtml(STUDIO_INPUTS.out || getExpectedOutputName(d))}"`);

  const tool = currentToolId;
  const mode = STUDIO_ORGANIZER_MODES[tool] || null;

  if (tool === "split") {
    fieldsHtml += field("mode", "Split mode", "Extract page range|Every N pages|Single pages");
    if (STUDIO_VALUES.mode === "Extract page range") {
      fieldsHtml += tfield("rg", "Page range", `e.g. 1-${Math.min(3, n)}`, "Comma-separated pages and ranges.");
    } else if (STUDIO_VALUES.mode === "Every N pages") {
      fieldsHtml += tfield("ns", "Pages per file", "2");
    }
  }

  if (tool === "rotate") {
    fieldsHtml += field("angle", "Angle", "90° clockwise|180°|90° counter-clockwise") +
                  field("which", "Pages", "All pages|Odd pages|Even pages");
  }

  if (tool === "compress") {
    fieldsHtml += field("level", "Compression level", "Light|Balanced|Maximum");
  }

  if (tool === "unlock" || tool === "protect") {
    fieldsHtml += tfield("pw", "Password", "Enter password", "", "password");
  }

  if (tool === "watermark") {
    fieldsHtml += tfield("wm", "Watermark text", "") + field("pos", "Position", "Center|Diagonal|Footer");
  }

  if (tool === "numbers") {
    fieldsHtml += field("fmt", "Format", "1|Page 1|Page 1 of N") +
                  field("npos", "Position", "Bottom center|Bottom right|Top right") +
                  tfield("ns", "Start number", "1");
  }

  if (tool === "merge") {
    fieldsHtml += `
      <div class="fld">
        <small>Files are merged in the order shown in the list (${studioDocs.length} files). Use the arrows to reorder them.</small>
      </div>
    `;
  }

  if (mode) {
    const c = mode === "reorder" ? 0 : (STUDIO_SELECTIONS[mode] ? STUDIO_SELECTIONS[mode].size : 0);
    fieldsHtml += `
      <div class="pickrow">
        <span>${mode === "reorder" ? "Drag pages into the order you want" : c ? c + " of " + n + " pages selected" : "No pages selected yet"}</span>
        <button class="btn" id="pickb">
          ${svgIcon("M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z")}Select pages
        </button>
      </div>
    `;
    if (mode === "reorder") {
      fieldsHtml += tfield("seq", "New page sequence (advanced)", "e.g. 3, 1, 2", "Type every page number once.");
    } else {
      fieldsHtml += tfield("adv", "Pages (advanced)", `e.g. 1-${Math.min(3, n)}, ${n}`, "Stays in sync with the visual selection.");
    }
  }

  const allHtml = studioDocs.length > 1 ? `
    <button class="cbx" role="checkbox" aria-checked="${STUDIO_INPUTS.all}" id="allc" style="margin:2px 0 12px">
      <span class="box">${SVG_TICK}</span>
      <span>Apply the same settings to all ${studioDocs.length} loaded PDFs</span>
    </button>
  ` : "";

  setp.innerHTML = `
    <h2>${escapeHtml(toolObj.name)} settings<span class="ready">Ready</span></h2>
    ${fieldsHtml}
    <div class="err" id="err"></div>
    ${allHtml}
    <button class="btn wide" id="go">
      ${STUDIO_TOOL_ACTIONS[currentToolId] || "Run Tool"}
      <svg class="nudge" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </button>
    <div class="row2">
      <button class="btn ghost" id="undo" ${d.hist && d.hist.length ? "" : "disabled"}>
        ${svgIcon("M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3")}Undo
      </button>
      <button class="btn ghost" id="reset" ${d.hist && d.hist.length ? "" : "disabled"}>
        ${svgIcon("M4 12a8 8 0 108-8M4 4v5h5")}Reset
      </button>
      <button class="btn ghost" id="dl">
        ${svgIcon("M12 4v11M7 11l5 5 5-5M5 20h14")}Download
      </button>
    </div>
    <button class="btn ghost wide" id="save" style="margin-top:8px">
      ${svgIcon("M3 6h7l2 2h9v11H3z")}Save to client
    </button>
  `;

  setp.querySelectorAll(".sel").forEach(mkSel);
  validateSettings();
}

function validateSettings() {
  const d = currentDoc();
  if (!d) return { ok: false, err: "" };
  const n = d.pages.length;
  let e = "";
  let ok = true;
  const tool = currentToolId;
  const mode = STUDIO_ORGANIZER_MODES[tool] || null;

  if (tool === "split" && STUDIO_VALUES.mode === "Extract page range") {
    const r = parseRange(STUDIO_INPUTS.rg, n);
    if (r.err && STUDIO_INPUTS.rg) e = r.err;
    if (r.err) ok = false;
    const rgEl = document.getElementById("rg");
    if (rgEl) rgEl.classList.toggle("bad", !!(STUDIO_INPUTS.rg && r.err));
  }

  if (["delete", "extract", "images"].includes(tool)) {
    if (STUDIO_INPUTS.adv && STUDIO_INPUTS.adv.trim()) {
      const r = parseRange(STUDIO_INPUTS.adv, n);
      if (r.err) {
        e = r.err;
        ok = false;
      }
    }
    const advEl = document.getElementById("adv");
    if (advEl) advEl.classList.toggle("bad", !!e);
    if (!e && mode) {
      const c = STUDIO_SELECTIONS[mode] ? STUDIO_SELECTIONS[mode].size : 0;
      if (!c) ok = false;
      if (tool === "delete" && c >= n) {
        ok = false;
        e = c ? "You can't delete every page." : "";
      }
    }
  }

  if (tool === "reorder") {
    const s = (STUDIO_INPUTS.seq || "").trim();
    if (s) {
      const a = s.split(/[,\s]+/).filter(Boolean).map(Number);
      const okp = a.length === n && new Set(a).size === n && a.every(x => x >= 1 && x <= n);
      if (!okp) {
        e = `Enter each page from 1 to ${n} exactly once.`;
        ok = false;
      }
    } else {
      ok = false;
    }
    const seqEl = document.getElementById("seq");
    if (seqEl) seqEl.classList.toggle("bad", !!e);
  }

  if (["unlock", "protect"].includes(tool) && !STUDIO_INPUTS.pw) {
    ok = false;
  }

  if (tool === "numbers" && !(+STUDIO_INPUTS.ns >= 1)) {
    ok = false;
  }

  const errEl = document.getElementById("err");
  const goBtn = document.getElementById("go");
  const undoBtn = document.getElementById("undo");
  const resetBtn = document.getElementById("reset");

  if (errEl) errEl.textContent = e;
  if (goBtn) goBtn.disabled = !ok;
  if (undoBtn) undoBtn.disabled = !d.hist || !d.hist.length;
  if (resetBtn) resetBtn.disabled = !d.hist || !d.hist.length;

  return { ok, err: e };
}

// ============================================================
// RENDERING: PREVIEW PANEL
// ============================================================
const LINE_WIDTHS = [92, 78, 96, 64, 86, 54, 80];

function renderProceduralLines(d, p) {
  let lines = "";
  for (let k = 0; k < 7; k++) {
    lines += `<div class="ln" style="width:${LINE_WIDTHS[(k + p.o) % 7]}%"></div>`;
  }
  return `
    <div class="pgi">
      <div class="hd"></div>
      <div class="tt">${escapeHtml(baseDocName(d))}</div>
      ${lines}
      <div class="big">${p.o}</div>
    </div>
  `;
}

function renderPageThumbnail(d, p, i) {
  const pageNum = (p && p.o) ? p.o : (i + 1);
  const version = d.version || 1;
  const imgUrl = (d.sessionId)
    ? `/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/page/${pageNum}?dpi=130&t=${version}`
    : (p.imgUrl || "");

  if (imgUrl) {
    return `
      <div class="pg" style="--r:${p.rot || 0}deg" data-page-idx="${i}">
        <img class="real-page-img" src="${imgUrl}" alt="Page ${pageNum}" loading="lazy"
             onerror="this.style.opacity='0.25';">
        ${(!d.sessionId && d.numbered) ? `<div class="pn">${i + (d.num || 1)}</div>` : ""}
      </div>
    `;
  }
  return `
    <div class="pg" style="--r:${p.rot || 0}deg" data-page-idx="${i}">
      <div class="pg-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:rgba(255,255,255,0.4);">Page ${pageNum}</div>
      ${d.numbered ? `<div class="pn">${i + (d.num || 1)}</div>` : ""}
    </div>
  `;
}

function updatePreviewNavButtons() {
  const d = currentDoc();
  if (!d) return;
  const pp = document.getElementById("pp");
  const pnx = document.getElementById("pnx");
  const pn = document.getElementById("pn");
  if (pp) pp.disabled = studioPreviewPage <= 0;
  if (pnx) pnx.disabled = studioPreviewPage >= d.pages.length - 1;
  if (pn) pn.textContent = `Page ${studioPreviewPage + 1} of ${d.pages.length}`;
}

function renderPreviewPanel() {
  const prevp = document.getElementById("prevp");
  if (!prevp) return;

  const d = currentDoc();
  if (!d) {
    prevp.innerHTML = `
      <div class="ph2"><h2>Preview</h2></div>
      <div class="scr">
        <div class="empty">
          <div>
            <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h4"/></svg>
            <b>No PDF selected</b>
            Choose or drop a PDF to preview it and unlock the tools.
          </div>
        </div>
      </div>
    `;
    return;
  }

  const n = d.pages.length;
  studioPreviewPage = Math.max(0, Math.min(studioPreviewPage, n - 1));

  prevp.innerHTML = `
    <div class="ph2">
      <h2>Preview · ${escapeHtml(d.name)}</h2>
      <div class="pc">
        <button id="zo" aria-label="Zoom out">−</button>
        <span id="zv">${Math.round(studioZoom * 100)}%</span>
        <button id="zi" aria-label="Zoom in">+</button>
        <button id="pp" aria-label="Previous page" ${studioPreviewPage <= 0 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span id="pn">Page ${studioPreviewPage + 1} of ${n}</span>
        <button id="pnx" aria-label="Next page" ${studioPreviewPage >= n - 1 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
    <div class="scr" id="scr">
      <div class="pgs" id="pgs" style="--z:${studioZoom}">
        ${d.pages.map((p, i) => `<div data-i="${i}">${renderPageThumbnail(d, p, i)}</div>`).join("")}
      </div>
    </div>
  `;

  updatePreviewNavButtons();
}

function renderStudioAll() {
  renderCategoryBar();
  renderToolCards();
  renderAddFilesPanel();
  renderPreviewPanel();
  renderSettingsPanel();
}

// ============================================================
// PRIMARY ACTION EXECUTION & TOOL ACTIONS
// ============================================================
async function executeStudioTool() {
  const d = currentDoc();
  if (!d || !d.sessionId) {
    studioToast("Please select a document with an active session first.");
    return;
  }

  const valid = validateSettings();
  if (!valid.ok) {
    if (valid.err) studioToast(valid.err);
    return;
  }

  const goBtn = document.getElementById("go");
  if (goBtn) {
    goBtn.disabled = true;
    goBtn.style.opacity = "0.7";
  }

  const t = currentToolId;
  const mode = STUDIO_ORGANIZER_MODES[t] || null;
  const applyAll = STUDIO_INPUTS.all && studioDocs.length > 1;
  const targetDocs = applyAll ? studioDocs : [d];
  const tag = applyAll ? ` (applied to ${studioDocs.length} files)` : "";

  studioToast(`Running ${STUDIO_TOOL_ACTIONS[t]}...`);

  try {
    const apiFn = window.api || (typeof api === "function" ? api : null);
    if (!apiFn) throw new Error("API not available");

    let backendTool = "split_pdf";
    let params = {};

    if (t === "merge") {
      backendTool = "merge_pdf";
      if (studioDocs.length < 2) {
        studioToast("Merge requires at least 2 loaded PDF files.");
        return;
      }
      const otherDocs = studioDocs.filter(sd => sd.id !== d.id);
      const addFiles = [];
      for (const od of otherDocs) {
        if (od.file) {
          const b = await fileToBase64(od.file);
          const cleanB = cleanBase64(b);
          if (cleanB) addFiles.push(cleanB);
        }
      }
      if (!addFiles.length) {
        studioToast("No secondary PDF data found to merge.");
        return;
      }
      params = { additional_files: addFiles, order: "append" };
    } else if (t === "split") {
      backendTool = "split_pdf";
      params = { mode: "extract_range", page_range: STUDIO_INPUTS.rg || "1" };
    } else if (t === "rotate") {
      backendTool = "rotate_pages";
      let angleVal = 90;
      if (STUDIO_VALUES.angle.includes("180")) angleVal = 180;
      else if (STUDIO_VALUES.angle.includes("counter")) angleVal = 270;
      let whichVal = "all";
      if (STUDIO_VALUES.which.includes("Odd")) whichVal = "odd";
      else if (STUDIO_VALUES.which.includes("Even")) whichVal = "even";
      params = { angle: angleVal, which_pages: whichVal };
    } else if (t === "compress") {
      backendTool = "compress_pdf";
      params = { level: (STUDIO_VALUES.level || "balanced").toLowerCase() };
    } else if (t === "unlock") {
      backendTool = "unlock_pdf";
      params = { password: STUDIO_INPUTS.pw || "" };
    } else if (t === "protect") {
      backendTool = "lock_pdf";
      params = { user_password: STUDIO_INPUTS.pw || "", owner_password: STUDIO_INPUTS.pw || "" };
    } else if (t === "extract") {
      backendTool = "split_pdf";
      const selPages = Array.from(STUDIO_SELECTIONS.extract || []).map(i => i + 1);
      const rangeVal = selPages.length ? selPages.join(",") : (STUDIO_INPUTS.adv || "1");
      params = { mode: "extract_range", page_range: rangeVal };
    } else if (t === "delete") {
      backendTool = "delete_pages";
      const delPages = Array.from(STUDIO_SELECTIONS.delete || []).map(i => i + 1);
      const delRange = delPages.length ? delPages.join(",") : (STUDIO_INPUTS.adv || "");
      params = { page_range: delRange };
    } else if (t === "reorder") {
      backendTool = "rearrange_pages";
      const seqArr = (STUDIO_INPUTS.seq || "").split(/[,\s]+/).filter(Boolean).map(Number);
      params = { new_order: seqArr };
    } else if (t === "watermark") {
      backendTool = "watermark_pdf";
      let pos = "center_diagonal";
      if (STUDIO_VALUES.pos === "Center") pos = "center";
      else if (STUDIO_VALUES.pos === "Footer") pos = "bottom";
      params = { text: STUDIO_INPUTS.wm || "CONFIDENTIAL", position: pos, opacity: 0.25, color: "#DC2626" };
    } else if (t === "numbers") {
      backendTool = "add_page_numbers";
      let npos = "bottom_right";
      if (STUDIO_VALUES.npos === "Bottom center") npos = "bottom_center";
      else if (STUDIO_VALUES.npos === "Top right") npos = "top_right";
      let fmt = "Page {n} of {total}";
      if (STUDIO_VALUES.fmt === "1") fmt = "{n}";
      else if (STUDIO_VALUES.fmt === "Page 1") fmt = "Page {n}";
      params = { format: fmt, position: npos, start_number: parseInt(STUDIO_INPUTS.ns) || 1 };
    } else if (t === "images") {
      backendTool = "convert_images";
      params = { format: (STUDIO_VALUES.cf || "png").toLowerCase(), dpi: parseInt(STUDIO_VALUES.dpi) || 150 };
    }

    let shouldUpdateNumbering = false;
    if (d.numbered && d.numberingSettings && ["delete", "reorder", "split", "extract"].includes(t)) {
      const choice = await promptPageNumberingUpdate();
      if (choice === "update") {
        shouldUpdateNumbering = true;
      }
    }
    if (params && typeof params === "object") {
      params.update_numbering = shouldUpdateNumbering;
    }

    for (const doc of targetDocs) {
      if (!doc.sessionId) continue;
      pushSnapshot(doc);

      const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(doc.sessionId)}/execute`, {
        method: "POST",
        body: JSON.stringify({
          tool_id: backendTool,
          parameters: params
        })
      });

      if (resp && resp.ok && resp.session) {
        const sess = resp.session;
        doc.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
        const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
        doc.pageCount = pageCount;
        doc.version = (doc.version || 1) + 1;
        doc.pages = Array.from({ length: pageCount }, (_, i) => ({
          o: i + 1,
          rot: 0,
          imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${doc.version}`
        }));

        if (t === "numbers") {
          doc.numbered = true;
          doc.numberingSettings = { ...params };
        }

        if (t === "images" && resp.result && resp.result.zip_base64) {
          const zipData = "data:application/zip;base64," + resp.result.zip_base64;
          const a = document.createElement("a");
          a.href = zipData;
          a.download = resp.result.zip_filename || `${baseDocName(doc)}_Images.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } else {
        const errMsg = (resp && resp.error) || "Tool execution failed.";
        throw new Error(errMsg);
      }
    }

    studioToast(`${STUDIO_TOOL_ACTIONS[t]} completed${tag}.`);
    STUDIO_INPUTS.adv = "";
    STUDIO_INPUTS.seq = "";
    if (STUDIO_SELECTIONS[mode]) STUDIO_SELECTIONS[mode].clear();
    renderStudioAll();
  } catch (err) {
    console.error("Studio execution error:", err);
    studioToast("Operation failed: " + (err.message || "Unknown error"));
  } finally {
    if (goBtn) {
      goBtn.disabled = false;
      goBtn.style.opacity = "1";
    }
  }
}

async function undoWorkingDoc() {
  const d = currentDoc();
  if (!d || !d.sessionId || !d.hist || !d.hist.length) return;

  try {
    const apiFn = window.api || (typeof api === "function" ? api : null);
    if (!apiFn) return;
    const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/undo`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (resp && resp.ok && resp.session) {
      d.hist.pop();
      const sess = resp.session;
      d.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
      const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
      d.pageCount = pageCount;
      d.version = (d.version || 1) + 1;
      d.pages = Array.from({ length: pageCount }, (_, i) => ({
        o: i + 1,
        rot: 0,
        imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${d.version}`
      }));
      renderStudioAll();
      studioToast(resp.undo?.message || "Undo applied.");
    } else {
      studioToast((resp && resp.error) || "Undo failed.");
    }
  } catch (e) {
    studioToast("Undo error: " + (e.message || e));
  }
}

async function resetWorkingDoc() {
  const d = currentDoc();
  if (!d || !d.sessionId || !d.hist || !d.hist.length) return;

  try {
    const apiFn = window.api || (typeof api === "function" ? api : null);
    if (!apiFn) return;
    const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/reset`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (resp && resp.ok && resp.session) {
      d.hist = [];
      const sess = resp.session;
      d.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
      const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
      d.pageCount = pageCount;
      d.version = (d.version || 1) + 1;
      d.pages = Array.from({ length: pageCount }, (_, i) => ({
        o: i + 1,
        rot: 0,
        imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${d.version}`
      }));
      renderStudioAll();
      studioToast("Reset to original document.");
    } else {
      studioToast((resp && resp.error) || "Reset failed.");
    }
  } catch (e) {
    studioToast("Reset error: " + (e.message || e));
  }
}

async function downloadWorkingDoc() {
  const d = currentDoc();
  if (!d || !d.sessionId) {
    studioToast("No PDF selected to download.");
    return;
  }

  const downloadName = STUDIO_INPUTS.out || getExpectedOutputName(d);

  // 1. Try desktop native Windows Save dialog via backend
  try {
    const apiFn = window.api || (typeof api === "function" ? api : null);
    if (apiFn && d.sessionId) {
      const res = await apiFn("/api/ai/native-save-dialog", {
        method: "POST",
        body: JSON.stringify({
          session_id: d.sessionId,
          default_name: downloadName,
          ext: currentToolId === "images" ? "zip" : "pdf"
        })
      });
      if (res && res.ok && (res.path || res.saved_path)) {
        const dest = res.path || res.saved_path;
        studioToast(`Saved successfully to:\n${dest}`);
        return;
      }
      if (res && res.cancelled) {
        return;
      }
    }
  } catch (err) {
    console.warn("Native save dialog fallback:", err);
  }

  // 2. Direct browser download fallback
  if (d.sessionId) {
    const a = document.createElement("a");
    a.href = `/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/download`;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    studioToast(`Downloading ${downloadName}...`);
  }
}

async function saveToClientWorkflow() {
  const d = currentDoc();
  if (!d || !d.sessionId) {
    studioToast("No PDF selected to save.");
    return;
  }

  studioToast("Applying document to Save Files queue...");

  // 1. Ensure staging coordinator is initialized
  if (window.saveStaging && !window.saveStaging.sessionId) {
    try {
      await window.saveStaging.init();
    } catch (e) {
      console.warn("Staging init error:", e);
    }
  }

  // 2. If opened with saveStaging context (from Save tab)
  if (window.saveStaging && window.saveStaging.activePdfStudioContext) {
    try {
      await window.saveStaging.applyPdfStudioResult(d.sessionId, d.name);
      studioToast("Document returned to Save Files queue.");
      safeNavigate("save");
      return;
    } catch (e) {
      console.warn("Save staging context apply error:", e);
    }
  }

  // 3. Direct transfer to Save Files workspace via backend staging
  try {
    const apiFn = window.api || (typeof api === "function" ? api : null);
    const stagingSessionId = window.saveStaging ? window.saveStaging.sessionId : null;
    if (apiFn && stagingSessionId) {
      const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/apply-to-staging`, {
        method: "POST",
        body: JSON.stringify({
          staging_session_id: stagingSessionId,
          replace_staged_ids: [],
          result_name: d.name
        })
      });
      if (resp && resp.ok && resp.manifest) {
        if (window.saveStaging) {
          window.saveStaging.manifest = resp.manifest;
          window.lastAppliedStagingResult = resp.new_entry;
        }
        studioToast("Document added to Save Files queue.");
        safeNavigate("save");
        return;
      }
    }
  } catch (err) {
    console.error("Save to client error:", err);
    studioToast("Failed to save to client queue: " + (err.message || err));
    return;
  }

  studioToast(`Document "${d.name}" ready in Save Files.`);
  safeNavigate("save");
}

// ============================================================
// PAGE ORGANIZER MODAL (1:1 with studioui.html)
// ============================================================
function openOrg(mode) {
  const d = currentDoc();
  if (!d) return;
  modalOpener = document.activeElement;
  ensureStudioPortal();

  let initialSel = new Set(mode === "reorder" ? [] : STUDIO_SELECTIONS[mode]);
  if (mode !== "reorder" && initialSel.size === 0 && STUDIO_INPUTS.adv) {
    const r = parseRange(STUDIO_INPUTS.adv, d.pages.length);
    if (r.set) initialSel = new Set(r.set);
  }
  let workPages = d.pages.map(p => ({ ...p }));
  if (mode === "reorder" && STUDIO_INPUTS.seq) {
    const seqNums = STUDIO_INPUTS.seq.split(/[,\s]+/).filter(Boolean).map(Number);
    if (seqNums.length === d.pages.length && seqNums.every(n => n >= 1 && n <= d.pages.length)) {
      workPages = seqNums.map(n => ({ ...d.pages[n - 1] }));
    }
  }

  M = {
    mode,
    d,
    work: workPages,
    sel: initialSel,
    last: null,
    busy: false,
    arm: false,
    t: null
  };

  const modal = document.getElementById("modal");
  const mbg = document.getElementById("mbg");
  const mtl = document.getElementById("mtl");
  const msub = document.getElementById("msub");
  const mtool = document.getElementById("mtool");

  if (!modal || !mbg) return;

  modal.className = "modal glass m-" + mode;
  if (mtl) mtl.textContent = MODE_DESCS[mode][0];
  if (msub) msub.textContent = `${d.name} · ${d.pages.length} pages. ${MODE_DESCS[mode][1]}`;

  if (mtool) {
    mtool.innerHTML = mode === "reorder"
      ? `<button class="btn ghost" id="rst">Reset order</button><span class="sp"></span><label>Size<input type="range" id="szr" min="110" max="240" value="150"></label>`
      : `<button class="btn ghost" data-q="all">Select all</button><button class="btn ghost" data-q="none">Clear</button><button class="btn ghost" data-q="inv">Invert</button><button class="btn ghost" data-q="odd">Odd pages</button><button class="btn ghost" data-q="even">Even pages</button><span class="sp"></span><label>Size<input type="range" id="szr" min="110" max="240" value="150"></label>`;
  }

  mbg.classList.add("show");
  renderOrgGrid();
  renderOrgFoot();

  setTimeout(() => {
    const f = document.querySelector("#mgrid .th") || document.getElementById("mx");
    if (f) f.focus();
  }, 320);
}

function closeOrg() {
  if (!M || (M.busy && false)) return;
  const mbg = document.getElementById("mbg");
  if (mbg) mbg.classList.remove("show");
  gsClose();
  if (M && M.t) clearTimeout(M.t);
  M = null;
  if (modalOpener && typeof modalOpener.focus === "function") {
    modalOpener.focus();
  }
}

function renderOrgGrid(keep) {
  if (!M) return;
  const d = M.d;
  const g = document.getElementById("mgrid");
  if (!g) return;

  g.innerHTML = M.work.map((p, i) => `
    <div class="th" role="checkbox" aria-checked="${M.sel.has(i)}" tabindex="0" data-i="${i}" ${M.mode === "reorder" ? 'draggable="true"' : ""}>
      <span class="box">${SVG_TICK}</span>
      ${renderPageThumbnail(d, p, i)}
      <span class="ov">${M.mode === "delete" ? SVG_CROSS : SVG_TICK}</span>
      <div class="cap">
        Page ${M.mode === "reorder" ? i + 1 : p.o}
        ${M.mode === "reorder" && p.o !== i + 1 ? `<i>was ${p.o}</i>` : ""}
      </div>
    </div>
  `).join("");

  if (keep != null) {
    const t = g.querySelector(`.th[data-i="${keep}"]`);
    if (t) {
      t.focus();
      t.classList.add("land");
    }
  }
}

function renderOrgFoot() {
  if (!M) return;
  const f = document.getElementById("mfoot");
  if (!f) return;

  const n = M.work.length;
  const c = M.sel.size;
  const m = M.mode;
  let h = "";

  if (m === "reorder") {
    const ch = M.work.some((p, i) => p.o !== i + 1);
    h = `
      <span class="cnt">${ch ? "Order changed" : "Original order"}${M.d.numbered ? " · page numbers will follow" : ""}</span>
      <button class="btn ghost" id="mc">Cancel</button>
      <button class="btn" id="ma" ${ch ? "" : "disabled"}>Apply order</button>
    `;
  } else {
    h = `<span class="cnt">${c} of ${n} pages selected</span>`;
    if (m === "extract") {
      h += `<div class="sel" data-id="em" data-opts="One combined PDF|One file per page"></div>`;
    }
    if (m === "convert") {
      h += `<div class="sel" data-id="cf" data-opts="JPG|PNG"></div><div class="sel" data-id="dpi" data-opts="72 DPI|150 DPI|300 DPI"></div><div class="prog" id="prog"><i></i></div>`;
    }
    const lab = {
      delete: M.arm ? `Click again to delete ${c}` : `Delete ${c || ""} page${c === 1 ? "" : "s"}`,
      extract: `Extract ${c || ""} page${c === 1 ? "" : "s"}`,
      convert: `Convert ${c || ""} page${c === 1 ? "" : "s"}`
    }[m] || "Confirm";

    const dis = !c || (m === "delete" && c >= n) || M.busy;
    h += `
      <button class="btn ghost" id="mc">Cancel</button>
      <button class="btn ${m === "delete" ? "red" : ""}" id="ma" ${dis ? "disabled" : ""}>${lab}</button>
    `;
  }

  f.innerHTML = h;
  f.querySelectorAll(".sel").forEach(mkSel);
}

function toggleOrgPage(i, shift) {
  if (!M) return;
  if (shift && M.last != null) {
    const a = Math.min(M.last, i);
    const b = Math.max(M.last, i);
    const on = !M.sel.has(i);
    for (let k = a; k <= b; k++) {
      if (on) M.sel.add(k);
      else M.sel.delete(k);
    }
  } else {
    if (M.sel.has(i)) M.sel.delete(i);
    else M.sel.add(i);
  }
  M.last = i;
  M.arm = false;
  if (M.mode !== "reorder") {
    STUDIO_SELECTIONS[M.mode] = new Set(M.sel);
    STUDIO_INPUTS.adv = Array.from(M.sel).sort((a, b) => a - b).map(k => k + 1).join(", ");
  }
  const thEls = document.querySelectorAll("#mgrid .th");
  thEls.forEach((t, k) => t.setAttribute("aria-checked", M.sel.has(k)));
  renderOrgFoot();
}

function moveOrgPage(from, to) {
  if (!M || to < 0 || to >= M.work.length) return;
  const [x] = M.work.splice(from, 1);
  M.work.splice(to, 0, x);
  renderOrgGrid(to);
  renderOrgFoot();
}

function initPortalEvents() {
  const portal = ensureStudioPortal();
  if (portal._portalEventsBound) return;
  portal._portalEventsBound = true;

  const mx = document.getElementById("mx");
  if (mx) mx.onclick = closeOrg;

  const mbg = document.getElementById("mbg");
  if (mbg) {
    mbg.addEventListener("mousedown", e => {
      if (e.target.id === "mbg") closeOrg();
    });
  }

  const mtool = document.getElementById("mtool");
  if (mtool) {
    mtool.addEventListener("click", e => {
      if (!M) return;
      const q = e.target.closest("[data-q]");
      if (q) {
        const k = q.dataset.q;
        if (k === "all") M.sel = new Set(M.work.map((_, i) => i));
        if (k === "none") M.sel = new Set();
        if (k === "inv") M.sel = new Set(M.work.map((_, i) => i).filter(i => !M.sel.has(i)));
        if (k === "odd") M.sel = new Set(M.work.map((_, i) => i).filter(i => i % 2 === 0));
        if (k === "even") M.sel = new Set(M.work.map((_, i) => i).filter(i => i % 2 === 1));
        M.arm = false;
        if (M.mode !== "reorder") {
          STUDIO_SELECTIONS[M.mode] = new Set(M.sel);
          STUDIO_INPUTS.adv = Array.from(M.sel).sort((a, b) => a - b).map(k => k + 1).join(", ");
        }
        document.querySelectorAll("#mgrid .th").forEach((t, i) => t.setAttribute("aria-checked", M.sel.has(i)));
        renderOrgFoot();
      }
      if (e.target.id === "rst") {
        M.work = M.d.pages.map(p => ({ ...p }));
        renderOrgGrid();
        renderOrgFoot();
      }
    });

    mtool.addEventListener("input", e => {
      if (e.target.id === "szr") {
        document.documentElement.style.setProperty("--tw", e.target.value + "px");
      }
    });
  }

  const grid = document.getElementById("mgrid");
  if (grid) {
    grid.addEventListener("click", e => {
      const t = e.target.closest(".th");
      if (t && M && M.mode !== "reorder") {
        toggleOrgPage(+t.dataset.i, e.shiftKey);
      }
    });

    grid.addEventListener("keydown", e => {
      const t = e.target.closest(".th");
      if (!t || !M) return;
      const i = +t.dataset.i;
      if (M.mode === "reorder") {
        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          moveOrgPage(i, i + (e.key === "ArrowRight" ? 1 : -1));
        }
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleOrgPage(i, e.shiftKey);
      }
    });

    grid.addEventListener("dragstart", e => {
      const t = e.target.closest(".th");
      if (!t || !M || M.mode !== "reorder") return;
      dragIndex = +t.dataset.i;
      t.classList.add("drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragIndex);
    });

    grid.addEventListener("dragend", () => {
      dragIndex = null;
      grid.querySelectorAll(".th").forEach(t => t.classList.remove("drag", "dl", "dr"));
    });

    grid.addEventListener("dragover", e => {
      const t = e.target.closest(".th");
      if (!t || dragIndex == null) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      const isLeft = e.clientX < r.left + r.width / 2;
      grid.querySelectorAll(".th").forEach(x => x.classList.remove("dl", "dr"));
      t.classList.add(isLeft ? "dl" : "dr");
      t.dataset.side = isLeft ? "l" : "r";
    });

    grid.addEventListener("drop", e => {
      const t = e.target.closest(".th");
      if (!t || dragIndex == null) return;
      e.preventDefault();
      let j = +t.dataset.i;
      if (t.dataset.side === "r") j++;
      if (dragIndex < j) j--;
      const from = dragIndex;
      dragIndex = null;
      if (from !== j) moveOrgPage(from, j);
      else renderOrgGrid();
    });
  }

  const foot = document.getElementById("mfoot");
  if (foot) {
    foot.addEventListener("click", async e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "mc") closeOrg();
      if (btn.id === "ma" && M) {
        const m = M.mode;
        const d = M.d;

        if (m === "reorder") {
          const newOrder = M.work.map(p => p.o);
          let shouldUpdateNumbering = false;
          if (d.numbered && d.numberingSettings) {
            const choice = await promptPageNumberingUpdate();
            if (choice === "update") shouldUpdateNumbering = true;
          }

          pushSnapshot(d);
          M.busy = true;
          btn.disabled = true;

          try {
            if (d.sessionId) {
              const apiFn = window.api || (typeof api === "function" ? api : null);
              if (apiFn) {
                const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/execute`, {
                  method: "POST",
                  body: JSON.stringify({
                    tool_id: "rearrange_pages",
                    parameters: { new_order: newOrder, update_numbering: shouldUpdateNumbering }
                  })
                });
                if (resp && resp.ok && resp.session) {
                  const sess = resp.session;
                  d.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
                  const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
                  d.pageCount = pageCount;
                  d.version = (d.version || 1) + 1;
                  d.pages = Array.from({ length: pageCount }, (_, i) => ({
                    o: i + 1,
                    rot: 0,
                    imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${d.version}`
                  }));
                } else {
                  throw new Error((resp && resp.error) || "Failed to reorder pages on server.");
                }
              }
            }
            STUDIO_INPUTS.seq = newOrder.join(", ");
            closeOrg();
            STUDIO_SELECTIONS.reorder.clear();
            renderStudioAll();
            studioToast("Order applied" + (shouldUpdateNumbering ? " and page numbers updated." : "."));
          } catch (err) {
            console.error("Reorder execution error:", err);
            studioToast("Failed to reorder pages: " + (err.message || err));
          } finally {
            if (M) M.busy = false;
            btn.disabled = false;
          }
          return;
        }

        if (m === "delete") {
          if (!M.arm) {
            M.arm = true;
            renderOrgFoot();
            clearTimeout(M.t);
            M.t = setTimeout(() => {
              if (M) {
                M.arm = false;
                renderOrgFoot();
              }
            }, 3000);
            return;
          }
          const delIndices = Array.from(M.sel).map(i => i + 1);
          let shouldUpdateNumbering = false;
          if (d.numbered && d.numberingSettings) {
            const choice = await promptPageNumberingUpdate();
            if (choice === "update") shouldUpdateNumbering = true;
          }

          pushSnapshot(d);
          M.busy = true;
          btn.disabled = true;

          try {
            if (d.sessionId) {
              const apiFn = window.api || (typeof api === "function" ? api : null);
              if (apiFn) {
                const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/execute`, {
                  method: "POST",
                  body: JSON.stringify({
                    tool_id: "delete_pages",
                    parameters: { pages: delIndices, update_numbering: shouldUpdateNumbering }
                  })
                });
                if (resp && resp.ok && resp.session) {
                  const sess = resp.session;
                  d.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
                  const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
                  d.pageCount = pageCount;
                  d.version = (d.version || 1) + 1;
                  d.pages = Array.from({ length: pageCount }, (_, i) => ({
                    o: i + 1,
                    rot: 0,
                    imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${d.version}`
                  }));
                } else {
                  throw new Error((resp && resp.error) || "Failed to delete pages on server.");
                }
              }
            }
            const count = delIndices.length;
            STUDIO_INPUTS.adv = "";
            closeOrg();
            STUDIO_SELECTIONS.delete.clear();
            renderStudioAll();
            studioToast(`${count} page${count > 1 ? "s" : ""} deleted` + (shouldUpdateNumbering ? " and page numbers updated." : "."));
          } catch (err) {
            console.error("Delete execution error:", err);
            studioToast("Failed to delete pages: " + (err.message || err));
          } finally {
            if (M) M.busy = false;
            btn.disabled = false;
          }
          return;
        }

        if (m === "extract") {
          const selPages = Array.from(M.sel).map(i => i + 1);
          if (!selPages.length) {
            studioToast("No pages selected to extract.");
            return;
          }
          const rangeStr = selPages.join(",");
          pushSnapshot(d);
          M.busy = true;
          btn.disabled = true;

          try {
            if (d.sessionId) {
              const apiFn = window.api || (typeof api === "function" ? api : null);
              if (apiFn) {
                const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/execute`, {
                  method: "POST",
                  body: JSON.stringify({
                    tool_id: "split_pdf",
                    parameters: { mode: "extract_range", page_range: rangeStr }
                  })
                });
                if (resp && resp.ok && resp.session) {
                  const sess = resp.session;
                  d.kb = Math.max(1, Math.round((sess.current_size || 0) / 1024));
                  const pageCount = (resp.thumbnails && resp.thumbnails.length) ? resp.thumbnails.length : (sess.page_count || 1);
                  d.pageCount = pageCount;
                  d.version = (d.version || 1) + 1;
                  d.pages = Array.from({ length: pageCount }, (_, i) => ({
                    o: i + 1,
                    rot: 0,
                    imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${d.version}`
                  }));
                } else {
                  throw new Error((resp && resp.error) || "Failed to extract pages on server.");
                }
              }
            }
            STUDIO_INPUTS.adv = rangeStr;
            closeOrg();
            STUDIO_SELECTIONS.extract.clear();
            renderStudioAll();
            studioToast(`Extracted ${selPages.length} page${selPages.length > 1 ? "s" : ""}.`);
          } catch (err) {
            console.error("Extract execution error:", err);
            studioToast("Failed to extract pages: " + (err.message || err));
          } finally {
            if (M) M.busy = false;
            btn.disabled = false;
          }
          return;
        }

        if (m === "convert") {
          M.busy = true;
          const pr = document.getElementById("prog");
          if (pr) pr.classList.add("on");
          btn.disabled = true;

          try {
            if (d.sessionId) {
              const apiFn = window.api || (typeof api === "function" ? api : null);
              if (apiFn) {
                const resp = await apiFn(`/api/pdf-studio/sessions/${encodeURIComponent(d.sessionId)}/execute`, {
                  method: "POST",
                  body: JSON.stringify({
                    tool_id: "convert_images",
                    parameters: {
                      format: (STUDIO_VALUES.cf || "png").toLowerCase(),
                      dpi: parseInt(STUDIO_VALUES.dpi) || 150
                    }
                  })
                });
                if (resp && resp.ok && resp.result && resp.result.zip_base64) {
                  const zipData = "data:application/zip;base64," + resp.result.zip_base64;
                  const a = document.createElement("a");
                  a.href = zipData;
                  a.download = resp.result.zip_filename || `${baseDocName(d)}_Images.zip`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }
              }
            }
            closeOrg();
            renderStudioAll();
            studioToast(`Pages converted to ${STUDIO_VALUES.cf || "PNG"}. ZIP downloaded.`);
          } catch (err) {
            console.error("Convert execution error:", err);
            studioToast("Failed to convert pages: " + (err.message || err));
          } finally {
            if (M) M.busy = false;
            btn.disabled = false;
          }
          return;
        }
      }
    });
  }

  // Keyboard trap inside modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && M) {
      e.preventDefault();
      closeOrg();
      return;
    }
    if (e.key === "Tab" && M) {
      const modal = document.getElementById("modal");
      if (!modal) return;
      const focusables = modal.querySelectorAll("button:not(:disabled), [tabindex='0'], input");
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, true);
}

// ============================================================
// FILE UPLOAD & BACKEND SESSION INITIALIZATION
// ============================================================
function cleanBase64(data) {
  if (!data || typeof data !== "string") return "";
  const commaIdx = data.indexOf(",");
  return commaIdx !== -1 ? data.substring(commaIdx + 1) : data;
}

function fileToBase64(file) {
  if (!file) return Promise.resolve("");
  if (file._b64) return Promise.resolve(cleanBase64(file._b64));
  if (file.base64) return Promise.resolve(cleanBase64(file.base64));
  if (file.file_base64) return Promise.resolve(cleanBase64(file.file_base64));
  if (typeof file === "string") return Promise.resolve(cleanBase64(file));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(cleanBase64(reader.result || ""));
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

async function createBackendPdfSession(file, b64Data) {
  const apiFn = window.api || (typeof api === "function" ? api : null);
  if (!apiFn) throw new Error("API client not available");
  const cleanB64 = cleanBase64(b64Data);
  if (!cleanB64) {
    throw new Error("Could not read file data.");
  }
  const res = await apiFn("/api/pdf-studio/sessions", {
    method: "POST",
    body: JSON.stringify({
      file_base64: cleanB64,
      original_name: file.name
    })
  });
  if (res && res.ok && res.session) {
    return res;
  }
  const err = (res && res.error) || "Server returned invalid session response.";
  throw new Error(err);
}

async function addIncomingFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => /pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!files.length) {
    studioToast("Please select valid PDF documents.");
    return;
  }

  const MAX_SIZE = 50 * 1024 * 1024;
  for (const f of files) {
    if (f.size > MAX_SIZE) {
      studioToast(`"${f.name}" exceeds the 50 MB limit.`);
      return;
    }
  }

  isUploadingDocs = true;
  renderAddFilesPanel();
  studioToast(`Adding ${files.length} document${files.length > 1 ? "s" : ""}...`);

  let addedCount = 0;
  for (const f of files) {
    try {
      const b64 = await fileToBase64(f);
      const sessRes = await createBackendPdfSession(f, b64);
      if (sessRes && sessRes.session) {
        const sess = sessRes.session;
        const pageCount = sess.page_count || 1;
        const version = 1;
        const pages = Array.from({ length: pageCount }, (_, i) => ({
          o: i + 1,
          rot: 0,
          imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(sess.session_id)}/page/${i + 1}?dpi=130&t=${version}`
        }));

        const docEntry = {
          id: uidCounter++,
          name: sess.current_name || f.name,
          kb: Math.max(1, Math.round((sess.current_size || f.size) / 1024)),
          numbered: false,
          num: 1,
          hist: [],
          file: f,
          sessionId: sess.session_id,
          pageCount: pageCount,
          version: version,
          pages: pages
        };
        docEntry.orig = snapDoc(docEntry);
        studioDocs.push(docEntry);
        if (!activeDocId) {
          activeDocId = docEntry.id;
        }
        addedCount++;
      }
    } catch (e) {
      console.error("Session init failed for", f.name, e);
      studioToast(`Failed to load "${f.name}": ${e.message || e}`);
    }
  }

  isUploadingDocs = false;
  studioPreviewPage = 0;
  renderStudioAll();
  if (addedCount > 0) {
    studioToast(`Added ${addedCount} document${addedCount > 1 ? "s" : ""} to Studio.`);
  }
}

// ============================================================
// EVENT DELEGATION & ACTIONS
// ============================================================
function initStudioEvents() {
  const root = document.getElementById("studio-root");
  if (!root || root._studioEventsBound) return;
  root._studioEventsBound = true;

  // Click Delegation
  root.addEventListener("click", e => {
    // Category click
    const catBtn = e.target.closest("[data-cat]");
    if (catBtn) {
      const catId = catBtn.dataset.cat;
      if (catId === currentCategory) {
        isCategoryOpen = !isCategoryOpen;
      } else {
        currentCategory = catId;
        isCategoryOpen = true;
        const catObj = STUDIO_CATEGORIES.find(c => c.id === currentCategory);
        if (catObj && catObj.tools.length) {
          currentToolId = catObj.tools[0].id;
        }
      }
      renderCategoryBar();
      renderToolCards();
      renderSettingsPanel();
      return;
    }

    // Tool click
    const toolBtn = e.target.closest(".tool[data-tool]");
    if (toolBtn && !toolBtn.disabled) {
      currentToolId = toolBtn.dataset.tool;
      renderToolCards();
      renderSettingsPanel();
      return;
    }

    // Selected file row click or row action buttons
    const fr = e.target.closest(".fr");
    if (fr) {
      const actBtn = e.target.closest("button[data-action]");
      const docId = +fr.dataset.docId;
      const idx = studioDocs.findIndex(d => d.id === docId);

      if (actBtn) {
        const action = actBtn.dataset.action;
        if (action === "rm") {
          studioDocs.splice(idx, 1);
          if (activeDocId === docId) {
            activeDocId = studioDocs[0] ? studioDocs[0].id : null;
          }
          studioPreviewPage = 0;
          if (currentToolId === "merge" && studioDocs.length < 2) {
            currentToolId = "split";
          }
          renderStudioAll();
          return;
        } else if (action === "up" && idx > 0) {
          [studioDocs[idx - 1], studioDocs[idx]] = [studioDocs[idx], studioDocs[idx - 1]];
          renderStudioAll();
          return;
        } else if (action === "dn" && idx < studioDocs.length - 1) {
          [studioDocs[idx + 1], studioDocs[idx]] = [studioDocs[idx], studioDocs[idx + 1]];
          renderStudioAll();
          return;
        }
      }

      if (activeDocId !== docId) {
        activeDocId = docId;
        studioPreviewPage = 0;
        renderStudioAll();
      }
      return;
    }

    // Buttons
    const btn = e.target.closest("button, .link");
    if (!btn) return;

    if (btn.id === "choose") {
      const fin = document.getElementById("fin");
      if (fin) fin.click();
    } else if (btn.id === "clr") {
      studioDocs = [];
      activeDocId = null;
      currentToolId = "split";
      renderStudioAll();
    } else if (btn.id === "allc" || btn.closest("#allc")) {
      STUDIO_INPUTS.all = !STUDIO_INPUTS.all;
      const allc = document.getElementById("allc");
      if (allc) allc.setAttribute("aria-checked", STUDIO_INPUTS.all);
    } else if (btn.id === "go") {
      executeStudioTool();
    } else if (btn.id === "undo") {
      undoWorkingDoc();
    } else if (btn.id === "reset") {
      resetWorkingDoc();
    } else if (btn.id === "dl") {
      downloadWorkingDoc();
    } else if (btn.id === "save") {
      saveToClientWorkflow();
    } else if (btn.id === "pickb") {
      const mode = STUDIO_ORGANIZER_MODES[currentToolId];
      if (mode) openOrg(mode);
    } else if (btn.id === "zo" || btn.id === "zi") {
      studioZoom = Math.max(0.6, Math.min(1.35, studioZoom + (btn.id === "zi" ? 0.15 : -0.15)));
      const pgs = document.getElementById("pgs");
      const zv = document.getElementById("zv");
      if (pgs) pgs.style.setProperty("--z", studioZoom);
      if (zv) zv.textContent = Math.round(studioZoom * 100) + "%";
    } else if (btn.id === "pp" || btn.id === "pnx") {
      const d = currentDoc();
      if (!d) return;
      studioPreviewPage = Math.max(0, Math.min(d.pages.length - 1, studioPreviewPage + (btn.id === "pnx" ? 1 : -1)));
      const targetPageEl = document.querySelector(`#pgs [data-i="${studioPreviewPage}"]`);
      if (targetPageEl) targetPageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      updatePreviewNavButtons();
    }
  });

  // Dynamic input handling
  root.addEventListener("input", e => {
    const id = e.target.id;
    if (id in STUDIO_INPUTS && id !== "all") {
      STUDIO_INPUTS[id] = e.target.value;
      if (id === "adv") {
        const d = currentDoc();
        if (d) {
          const mode = STUDIO_ORGANIZER_MODES[currentToolId] || null;
          if (mode && STUDIO_SELECTIONS[mode]) {
            const r = parseRange(e.target.value, d.pages.length);
            if (r.set) {
              STUDIO_SELECTIONS[mode] = r.set;
              const pr = root.querySelector(".pickrow span");
              if (pr) pr.textContent = `${r.set.size} of ${d.pages.length} pages selected`;
            }
          }
        }
      }
      if (id === "out") return;
      validateSettings();
    }
  });

  // Continuous Scroll Sync on Preview Container
  root.addEventListener("scroll", e => {
    if (e.target.id === "scr") {
      const d = currentDoc();
      if (!d || !d.pages || !d.pages.length) return;
      const s = e.target;
      const y = s.scrollTop + s.clientHeight * 0.35;
      let k = 0;
      const pageEls = root.querySelectorAll("#pgs [data-i]");
      pageEls.forEach(c => {
        if (c.offsetTop - s.offsetTop <= y) {
          k = +c.dataset.i;
        }
      });
      if (k !== studioPreviewPage) {
        studioPreviewPage = k;
        updatePreviewNavButtons();
      }
    }
  }, true);

  // Keyboard shortcuts and accessibility for Studio
  root.addEventListener("keydown", e => {
    // Ctrl+O / Cmd+O: Choose/Open Files
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      const fin = document.getElementById("fin");
      if (fin) fin.click();
      return;
    }

    // Ctrl+Enter / Cmd+Enter: Run primary action
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const goBtn = document.getElementById("go");
      if (goBtn && !goBtn.disabled) goBtn.click();
      return;
    }

    // Ctrl+Z / Cmd+Z: Undo (outside inputs)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      const undoBtn = document.getElementById("undo");
      if (undoBtn && !undoBtn.disabled) undoBtn.click();
      return;
    }

    // File list keyboard navigation
    if (e.target.classList && e.target.classList.contains("fr")) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.target.click();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = e.target.nextElementSibling;
        if (next && next.classList.contains("fr")) next.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = e.target.previousElementSibling;
        if (prev && prev.classList.contains("fr")) prev.focus();
      }
    }
  });

  // File Input Handler
  root.addEventListener("change", e => {
    if (e.target.id === "fin" && e.target.files) {
      addIncomingFiles(e.target.files);
      e.target.value = "";
    }
  });

  // Drag and Drop on drop zone
  root.addEventListener("dragover", e => {
    const drop = e.target.closest("#drop");
    if (drop) {
      e.preventDefault();
      drop.classList.add("over");
    }
  });

  root.addEventListener("dragleave", e => {
    const drop = e.target.closest("#drop");
    if (drop) {
      drop.classList.remove("over");
    }
  });

  root.addEventListener("drop", e => {
    const drop = e.target.closest("#drop");
    if (drop) {
      e.preventDefault();
      drop.classList.remove("over");
      if (e.dataTransfer && e.dataTransfer.files) {
        addIncomingFiles(e.dataTransfer.files);
      }
    }
  });
}

// ============================================================
// MAIN MOUNT & GLOBAL EXPORTS
// ============================================================
async function pdfStudioPage() {
  ensureStudioPortal();
  initPortalEvents();

  const content = document.getElementById("content");
  if (!content) return;

  content.innerHTML = `
    <main id="studio-root">
      <div class="shead">
        <div>
          <h1>Studio</h1>
          <p>Organize, convert, secure, and edit PDF documents with ease</p>
        </div>
        <span class="tag">&ldquo; Same Files. A Smarter Way.<sup>&reg;</sup> &rdquo;</span>
      </div>
      <section class="cbar glass" aria-label="Tool categories">
        <div class="cats" id="cats" role="tablist"></div>
        <p class="chint">Select a tool to apply transformations</p>
        <div class="banner" id="banner">
          <svg viewBox="0 0 24 24"><path d="M12 8v5M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z"/></svg>
          Add a PDF to unlock the tools.
        </div>
      </section>
      <div class="tcollapse" id="tcol">
        <div>
          <div class="tools" id="tools"></div>
        </div>
      </div>
      <div class="work">
        <div class="left">
          <div class="panel glass" id="addp"></div>
          <div class="panel glass" id="setp"></div>
        </div>
        <div class="panel glass prev" id="prevp"></div>
      </div>
    </main>
  `;

  initStudioEvents();
  renderStudioAll();
}

function safeNavigate(page) {
  if (typeof window.safeNavigate === "function" && window.safeNavigate !== safeNavigate) {
    window.safeNavigate(page);
    return;
  }
  if (typeof window.navigateTo === "function") {
    window.navigateTo(page);
    return;
  }
  window.location.hash = page;
}

window.openPdfStudioSession = function(session, thumbnails, originContext) {
  currentPdfSession = session;
  pdfStudioOriginContext = originContext || null;

  if (session && session.current_name) {
    const pages = (thumbnails || []).map((t, idx) => ({
      o: idx + 1,
      rot: 0,
      imgUrl: t.url || `/api/pdf-studio/sessions/${encodeURIComponent(session.session_id)}/page/${idx + 1}`
    }));

    studioDocs = [{
      id: uidCounter++,
      name: session.current_name,
      kb: Math.max(1, Math.round((session.current_size || 0) / 1024)),
      numbered: false,
      num: 1,
      hist: [],
      pages: pages.length ? pages : Array.from({ length: session.page_count || 1 }, (_, i) => ({
        o: i + 1,
        rot: 0,
        imgUrl: `/api/pdf-studio/sessions/${encodeURIComponent(session.session_id)}/page/${i + 1}`
      })),
      sessionId: session.session_id,
      pageCount: session.page_count
    }];
    studioDocs[0].orig = snapDoc(studioDocs[0]);
    activeDocId = studioDocs[0].id;
    studioPreviewPage = 0;
  }

  safeNavigate("studio");
};

// Global handlers for universal drag & drop routing into Studio
window.openUploadedPdfInStudio = async function(file) {
  await addIncomingFiles([file]);
};

window.openPdfStudioWithFiles = async function(files) {
  await addIncomingFiles(files);
};

// Global exports
window.pdfStudioPage = pdfStudioPage;
window.STUDIO_CATEGORIES = STUDIO_CATEGORIES;
window.STUDIO_TOOLS = STUDIO_CATEGORIES[0].tools;
window.studioToast = studioToast;
window.ensureStudioPortal = ensureStudioPortal;

})();

