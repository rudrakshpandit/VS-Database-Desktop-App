"""
VS Database — PDF Studio Engine (Desktop Application)
Tool-Based PDF Processing Subsystem powered by PyMuPDF (fitz) and Pillow.
Designed for Human UI & Future VS AI Tool Calling.
"""
from __future__ import annotations

import base64
import gc
import io
import json
import os
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

try:
    import pymupdf
except (ModuleNotFoundError, ImportError):
    import site
    import sys
    try:
        user_sp = site.getusersitepackages()
        if user_sp and os.path.exists(user_sp) and user_sp not in sys.path:
            sys.path.append(user_sp)
    except Exception:
        pass
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        py_roaming = os.path.join(appdata, "Python")
        if os.path.exists(py_roaming):
            for entry in os.listdir(py_roaming):
                sp = os.path.join(py_roaming, entry, "site-packages")
                if os.path.exists(sp) and sp not in sys.path:
                    sys.path.append(sp)
    for pdir in [r"C:\Python314\Lib\site-packages", r"C:\Python313\Lib\site-packages", r"C:\Python312\Lib\site-packages", r"C:\Python314"]:
        if os.path.exists(pdir) and pdir not in sys.path:
            sys.path.append(pdir)

    try:
        import pymupdf
    except (ModuleNotFoundError, ImportError):
        try:
            import fitz as pymupdf
        except (ModuleNotFoundError, ImportError):
            pymupdf = None

from PIL import Image


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hex_to_rgb_float(hex_str: str) -> Tuple[float, float, float]:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join(c * 2 for c in hex_str)
    if len(hex_str) != 6:
        return (0.8, 0.2, 0.2)
    try:
        r = int(hex_str[0:2], 16) / 255.0
        g = int(hex_str[2:4], 16) / 255.0
        b = int(hex_str[4:6], 16) / 255.0
        return (r, g, b)
    except Exception:
        return (0.8, 0.2, 0.2)


def parse_page_ranges(range_str: str, max_pages: int) -> List[int]:
    """Parses range strings like '1-3, 5, 8-10' into 1-based unique page numbers."""
    pages = set()
    parts = [p.strip() for p in range_str.split(",") if p.strip()]
    for part in parts:
        if "-" in part:
            bounds = [b.strip() for b in part.split("-") if b.strip()]
            if len(bounds) == 2 and bounds[0].isdigit() and bounds[1].isdigit():
                start, end = int(bounds[0]), int(bounds[1])
                if start <= end:
                    for p in range(start, end + 1):
                        if 1 <= p <= max_pages:
                            pages.add(p)
        elif part.isdigit():
            p = int(part)
            if 1 <= p <= max_pages:
                pages.add(p)
    return sorted(list(pages))


_SESSION_LOCKS: Dict[str, threading.RLock] = {}
_SESSION_LOCKS_GUARD = threading.Lock()


def get_session_lock(session_id: str) -> threading.RLock:
    with _SESSION_LOCKS_GUARD:
        if session_id not in _SESSION_LOCKS:
            _SESSION_LOCKS[session_id] = threading.RLock()
        return _SESSION_LOCKS[session_id]


def safe_atomic_replace(src: Path, dst: Path, retries: int = 10, delay: float = 0.05) -> None:
    """Safely replaces dst with src on Windows, handling file locks, indexing, and antivirus scans."""
    for attempt in range(retries):
        try:
            src.replace(dst)
            return
        except (PermissionError, OSError) as exc:
            gc.collect()
            time.sleep(delay * (attempt + 1))
            if attempt == retries - 1:
                # Direct stream copy fallback
                try:
                    with open(src, "rb") as s, open(dst, "wb") as d:
                        shutil.copyfileobj(s, d)
                    src.unlink(missing_ok=True)
                    return
                except Exception:
                    raise exc


def safe_copy_file(src: Path, dst: Path, retries: int = 10, delay: float = 0.05) -> None:
    """Copies src to dst on Windows safely with retry backoff and fallback."""
    for attempt in range(retries):
        try:
            shutil.copy2(src, dst)
            return
        except (PermissionError, OSError) as exc:
            gc.collect()
            time.sleep(delay * (attempt + 1))
            if attempt == retries - 1:
                try:
                    with open(src, "rb") as s, open(dst, "wb") as d:
                        shutil.copyfileobj(s, d)
                    return
                except Exception:
                    raise exc


class PDFStudioSession:
    """Manages an isolated PDF Studio session with non-destructive working copies and undo checkpoints."""

    MAX_CHECKPOINTS = 5

    def __init__(self, session_dir: Path, session_id: str, application_id: str = "vs_desktop_app"):
        self.session_dir = Path(session_dir).resolve()
        self.session_id = session_id
        self.application_id = application_id
        self.checkpoints_dir = self.session_dir / "checkpoints"
        self.checkpoints_dir.mkdir(parents=True, exist_ok=True)
        self.meta_file = self.session_dir / "meta.json"
        self.original_pdf_path = self.session_dir / "original.pdf"
        self.working_pdf_path = self.session_dir / "working.pdf"
        self.meta = self._load_meta()

    @property
    def working_copy_path(self) -> Path:
        return self.working_pdf_path

    @property
    def page_count(self) -> int:
        return self.meta.get("page_count", 0)

    def _load_meta(self) -> Dict[str, Any]:
        if self.meta_file.exists():
            try:
                with open(self.meta_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "session_id": self.session_id,
            "application_id": self.application_id,
            "original_name": "document.pdf",
            "current_name": "document.pdf",
            "source_files": [],
            "original_size": 0,
            "current_size": 0,
            "page_count": 0,
            "is_encrypted": False,
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "history": [],
            "checkpoint_stack": []
        }

    def save_meta(self) -> None:
        self.meta["updated_at"] = iso_now()
        tmp = self.meta_file.with_suffix(f".tmp_{uuid.uuid4().hex[:6]}")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.meta, f, indent=2, ensure_ascii=False)
        safe_atomic_replace(tmp, self.meta_file)

    def read_working_bytes(self) -> bytes:
        """Reads working.pdf bytes into memory immediately, releasing disk handle."""
        with open(self.working_pdf_path, "rb") as f:
            return f.read()

    def open_working_doc(self) -> pymupdf.Document:
        """Opens a PyMuPDF Document backed by in-memory bytes to ensure 0 open OS file handles."""
        raw = self.read_working_bytes()
        return pymupdf.open(stream=raw, filetype="pdf")

    def update_working_pdf(self, new_bytes: bytes, tool_id: str, title: str, details: str, stats_diff: str = "") -> None:
        """Atomically and safely updates working.pdf and pushes a checkpoint."""
        tmp_target = self.working_pdf_path.with_suffix(f".{tool_id}_{uuid.uuid4().hex[:6]}.tmp")
        with open(tmp_target, "wb") as f:
            f.write(new_bytes)
        safe_atomic_replace(tmp_target, self.working_pdf_path)
        self.push_checkpoint(tool_id, title, details, stats_diff=stats_diff)

    def refresh_stats(self) -> None:
        if self.working_pdf_path.exists():
            self.meta["current_size"] = self.working_pdf_path.stat().st_size
            try:
                raw = self.read_working_bytes()
                doc = pymupdf.open(stream=raw, filetype="pdf")
                self.meta["page_count"] = len(doc)
                self.meta["is_encrypted"] = bool(doc.is_encrypted)
                doc.close()
            except Exception:
                pass
        if self.original_pdf_path.exists():
            self.meta["original_size"] = self.original_pdf_path.stat().st_size
        self.save_meta()

    def push_checkpoint(self, tool_id: str, title: str, details: str, stats_diff: str = "") -> None:
        """Saves current working PDF to checkpoint stack and registers history item."""
        if not self.working_pdf_path.exists():
            return

        step_num = len(self.meta.get("checkpoint_stack", [])) + 1
        cp_filename = f"step_{step_num:03d}_{uuid.uuid4().hex[:6]}.pdf"
        cp_path = self.checkpoints_dir / cp_filename
        safe_copy_file(self.working_pdf_path, cp_path)

        stack = self.meta.setdefault("checkpoint_stack", [])
        stack.append(cp_filename)

        # Prune oldest checkpoints if stack exceeds maximum
        while len(stack) > self.MAX_CHECKPOINTS:
            oldest = stack.pop(0)
            old_file = self.checkpoints_dir / oldest
            try:
                if old_file.exists():
                    old_file.unlink()
            except Exception:
                pass

        hist_item = {
            "id": f"hist_{uuid.uuid4().hex[:8]}",
            "timestamp": iso_now(),
            "tool_id": tool_id,
            "title": title,
            "details": details,
            "stats_diff": stats_diff,
            "checkpoint": cp_filename
        }
        self.meta.setdefault("history", []).append(hist_item)
        self.refresh_stats()

    def undo(self) -> Dict[str, Any]:
        """Restores the previous checkpoint."""
        stack = self.meta.get("checkpoint_stack", [])
        if not stack:
            raise ValueError("No previous checkpoints available to undo.")

        last_cp = stack.pop()
        last_file = self.checkpoints_dir / last_cp
        try:
            if last_file.exists():
                last_file.unlink()
        except Exception:
            pass

        if stack:
            target_cp = stack[-1]
            target_file = self.checkpoints_dir / target_cp
            safe_copy_file(target_file, self.working_pdf_path)
        else:
            safe_copy_file(self.original_pdf_path, self.working_pdf_path)

        if self.meta.get("history"):
            removed_hist = self.meta["history"].pop()
        else:
            removed_hist = None

        self.refresh_stats()
        return {
            "ok": True,
            "message": "Undone successfully.",
            "remaining_checkpoints": len(stack),
            "removed_history": removed_hist,
            "meta": self.to_dict()
        }

    def reset_to_original(self) -> Dict[str, Any]:
        """Reverts the working copy back to the immutable original copy."""
        if not self.original_pdf_path.exists():
            raise ValueError("Original document not found.")

        safe_copy_file(self.original_pdf_path, self.working_pdf_path)
        for cp in self.meta.get("checkpoint_stack", []):
            try:
                (self.checkpoints_dir / cp).unlink(missing_ok=True)
            except Exception:
                pass

        self.meta["checkpoint_stack"] = []
        self.meta["history"] = [
            {
                "id": f"hist_{uuid.uuid4().hex[:8]}",
                "timestamp": iso_now(),
                "tool_id": "reset_to_original",
                "title": "Reset to Original",
                "details": "Restored working copy to initial uploaded document.",
                "stats_diff": ""
            }
        ]
        self.refresh_stats()
        return {"ok": True, "message": "Reset to original successfully.", "meta": self.to_dict()}

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.meta)

    def close(self) -> None:
        """Cleans up temporary checkpoint files when session is finished."""
        if self.checkpoints_dir.exists():
            shutil.rmtree(self.checkpoints_dir, ignore_errors=True)

    def get_thumbnails(self, dpi: int = 40) -> List[Dict[str, Any]]:
        """Generates lightweight base64 PNG thumbnails for all pages."""
        if not self.working_pdf_path.exists():
            return []
        try:
            doc = pymupdf.open(str(self.working_pdf_path))
            thumbnails = []
            is_locked = doc.needs_pass or doc.is_encrypted
            for idx in range(len(doc)):
                page_num = idx + 1
                if is_locked:
                    thumbnails.append({"page_num": page_num, "width": 120, "height": 160, "is_locked": True, "data_url": ""})
                else:
                    page = doc[idx]
                    pix = page.get_pixmap(dpi=dpi)
                    b64_img = base64.b64encode(pix.tobytes("png")).decode("ascii")
                    thumbnails.append({
                        "page_num": page_num,
                        "width": pix.width,
                        "height": pix.height,
                        "rotation": page.rotation,
                        "is_locked": False,
                        "data_url": f"data:image/png;base64,{b64_img}"
                    })
            doc.close()
            return thumbnails
        except Exception:
            return []

    def __iter__(self):
        """Allows unpacking as (session, thumbnails)."""
        return iter([self, self.get_thumbnails()])


class ToolResult(dict):
    """Dict subclass that allows dot-notation attribute access."""
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"'ToolResult' object has no attribute '{name}'")
    def __setattr__(self, name, value):
        self[name] = value


class PDFToolRegistry:
    """Central registry of production PDF tools for Human UI & VS AI."""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir).resolve() if base_dir else Path(__file__).resolve().parent
        self._tools: Dict[str, Dict[str, Any]] = {}
        self._handlers: Dict[str, Callable] = {}
        self._register_default_tools()

    def register(
        self,
        tool_id: str,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        handler: Callable
    ) -> None:
        self._tools[tool_id] = {
            "tool_id": tool_id,
            "name": name,
            "description": description,
            "parameters": parameters
        }
        self._handlers[tool_id] = handler

    def get_tool_spec(self, tool_id: str) -> Optional[Dict[str, Any]]:
        return self._tools.get(tool_id)

    def list_tools(self) -> List[Dict[str, Any]]:
        return list(self._tools.values())

    def execute(self, session: PDFStudioSession, tool_id: str, params: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> ToolResult:
        handler = self._handlers.get(tool_id)
        if not handler:
            aliases = {
                "watermark": "watermark_pdf",
                "watermark_pages": "watermark_pdf",
                "rotate": "rotate_pages",
                "rotate_pdf": "rotate_pages",
                "compress": "compress_pdf",
                "rearrange": "rearrange_pages",
                "rearrange_pdf": "rearrange_pages",
                "lock": "lock_pdf",
                "unlock": "unlock_pdf",
                "split": "split_pdf",
                "merge": "merge_pdf",
                "delete": "delete_pages",
                "delete_page": "delete_pages",
                "insert": "insert_pages",
                "insert_page": "insert_pages",
            }
            if tool_id in aliases:
                handler = self._handlers.get(aliases[tool_id])
        if not handler:
            raise ValueError(f"Tool '{tool_id}' not found in PDF Tool Registry.")
        res = handler(session, params, context or {})
        return ToolResult(res) if isinstance(res, dict) else res

    # =========================================================================
    # TOOL DEFINITIONS & HANDLERS
    # =========================================================================
    def _register_default_tools(self) -> None:
        # 1. LOCK PDF
        self.register(
            tool_id="lock_pdf",
            name="Lock PDF",
            description="Encrypt a PDF document with standard AES-256 password protection.",
            parameters={
                "type": "object",
                "properties": {
                    "user_password": {"type": "string", "description": "Password required to open the PDF."},
                    "owner_password": {"type": "string", "description": "Optional administrative owner password."},
                    "save_to_client_vault": {"type": "boolean", "description": "Whether to save password in client vault."},
                    "client_file_no": {"type": "string", "description": "Client file number for vault storage."},
                    "credential_label": {"type": "string", "description": "Label for the saved credential."}
                },
                "required": ["user_password"]
            },
            handler=self._handle_lock_pdf
        )

        # 2. UNLOCK PDF
        self.register(
            tool_id="unlock_pdf",
            name="Unlock PDF",
            description="Decrypt a password-protected PDF document.",
            parameters={
                "type": "object",
                "properties": {
                    "password": {"type": "string", "description": "Password to unlock the document."},
                    "credential_id": {"type": "integer", "description": "Credential ID from client vault."}
                }
            },
            handler=self._handle_unlock_pdf
        )

        # 3. MERGE PDF
        self.register(
            tool_id="merge_pdf",
            name="Merge PDF",
            description="Merge secondary PDF documents into the current working PDF.",
            parameters={
                "type": "object",
                "properties": {
                    "additional_files": {
                        "type": "array",
                        "description": "List of file paths, base64 strings, or staged file IDs to merge.",
                        "items": {"type": "string"}
                    },
                    "order": {"type": "string", "enum": ["append", "prepend"], "description": "Merge position."}
                }
            },
            handler=self._handle_merge_pdf
        )

        # 4. SPLIT PDF
        self.register(
            tool_id="split_pdf",
            name="Split PDF",
            description="Extract specific page ranges or selected pages into a new working PDF.",
            parameters={
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "enum": ["extract_range", "extract_selected"], "description": "Split mode."},
                    "page_range": {"type": "string", "description": "Comma-separated ranges, e.g., '1-3, 5, 8-10'."},
                    "selected_pages": {"type": "array", "items": {"type": "integer"}, "description": "List of 1-based page numbers."}
                },
                "required": ["mode"]
            },
            handler=self._handle_split_pdf
        )

        # 5. ROTATE PAGES
        self.register(
            tool_id="rotate_pages",
            name="Rotate Pages",
            description="Rotate specific or all pages by 90, 180, or 270 degrees clockwise.",
            parameters={
                "type": "object",
                "properties": {
                    "angle": {"type": "integer", "enum": [90, 180, 270, -90], "description": "Rotation angle."},
                    "pages": {
                        "oneOf": [
                            {"type": "string", "enum": ["all"]},
                            {"type": "array", "items": {"type": "integer"}}
                        ],
                        "description": "'all' or array of 1-based page numbers."
                    }
                },
                "required": ["angle"]
            },
            handler=self._handle_rotate_pages
        )

        # 6. REARRANGE PAGES
        self.register(
            tool_id="rearrange_pages",
            name="Rearrange Pages",
            description="Reorder pages in the document according to a specified sequence.",
            parameters={
                "type": "object",
                "properties": {
                    "new_order": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Array of 1-based page numbers representing the new desired order (e.g. [3, 1, 2])."
                    }
                },
                "required": ["new_order"]
            },
            handler=self._handle_rearrange_pages
        )

        # 7. DELETE PAGES
        self.register(
            tool_id="delete_pages",
            name="Delete Pages",
            description="Delete specific pages from the document.",
            parameters={
                "type": "object",
                "properties": {
                    "pages": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Array of 1-based page numbers to delete."
                    },
                    "page_range": {"type": "string", "description": "Optional page range string like '2, 4-6'."}
                }
            },
            handler=self._handle_delete_pages
        )

        # 8. INSERT PAGES
        self.register(
            tool_id="insert_pages",
            name="Insert Pages",
            description="Insert pages from another PDF into the current document.",
            parameters={
                "type": "object",
                "properties": {
                    "source_bytes": {"type": "string", "description": "Base64 encoded source PDF or server file path."},
                    "position": {"type": "string", "enum": ["start", "end", "before_page", "after_page"], "description": "Insertion placement."},
                    "target_page": {"type": "integer", "description": "1-based target page for before/after insertion."}
                },
                "required": ["source_bytes", "position"]
            },
            handler=self._handle_insert_pages
        )

        # 9. WATERMARK PDF
        self.register(
            tool_id="watermark_pdf",
            name="Watermark PDF",
            description="Apply text watermark with custom rotation, opacity, font size, and color.",
            parameters={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Watermark text (e.g. 'CONFIDENTIAL', 'DRAFT')."},
                    "position": {
                        "type": "string",
                        "enum": ["center_diagonal", "center_horizontal", "top_header", "bottom_footer"],
                        "description": "Placement layout."
                    },
                    "font_size": {"type": "integer", "description": "Font size in points (default 42)."},
                    "opacity": {"type": "number", "description": "Opacity between 0.05 and 1.0 (default 0.25)."},
                    "rotation": {"type": "number", "description": "Rotation angle in degrees (default 45)."},
                    "color": {"type": "string", "description": "Hex color string (e.g. '#DC2626')."},
                    "pages": {
                        "oneOf": [
                            {"type": "string", "enum": ["all"]},
                            {"type": "array", "items": {"type": "integer"}}
                        ]
                    }
                },
                "required": ["text"]
            },
            handler=self._handle_watermark_pdf
        )

        # 10. COMPRESS PDF
        self.register(
            tool_id="compress_pdf",
            name="Compress PDF",
            description="Optimize and reduce file size with low, balanced, or high compression levels.",
            parameters={
                "type": "object",
                "properties": {
                    "level": {"type": "string", "enum": ["low", "balanced", "high"], "description": "Compression intensity."}
                },
                "required": ["level"]
            },
            handler=self._handle_compress_pdf
        )

    # =========================================================================
    # TOOL HANDLERS IMPLEMENTATION
    # =========================================================================
    def _handle_lock_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        user_pw = str(params.get("user_password") or params.get("password") or "").strip()
        if not user_pw:
            raise ValueError("Password cannot be empty.")
        owner_pw = str(params.get("owner_password", "")).strip() or user_pw

        doc = session.open_working_doc()
        perm_val = params.get("permissions")
        try:
            perm = int(perm_val) if perm_val is not None else (pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_PRINT)
        except (ValueError, TypeError):
            perm = pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_PRINT

        locked_bytes = doc.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw=user_pw,
            owner_pw=owner_pw,
            permissions=perm
        )
        doc.close()

        session.update_working_pdf(locked_bytes, "lock_pdf", "Locked PDF", "Applied AES-256 encryption.")
        return {"ok": True, "message": "PDF encrypted with AES-256 successfully."}

    def _handle_unlock_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        pw = str(params.get("password", "")).strip()
        doc = session.open_working_doc()
        if not doc.is_encrypted and not doc.needs_pass:
            doc.close()
            return {"ok": True, "message": "Document is not password protected."}

        auth = doc.authenticate(pw)
        if auth <= 0:
            doc.close()
            raise ValueError("Incorrect PDF password.")

        unlocked_bytes = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_NONE)
        doc.close()

        session.update_working_pdf(unlocked_bytes, "unlock_pdf", "Unlocked PDF", "Removed password protection.")
        return {"ok": True, "message": "PDF unlocked successfully."}

    def _handle_merge_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        additional_files = params.get("additional_files") or params.get("files") or []
        if not additional_files:
            raise ValueError("No secondary PDFs provided for merge.")

        order = params.get("order", "append")
        doc = session.open_working_doc()
        merged_count = 0

        for raw_item in additional_files:
            item = raw_item.get("data") or raw_item.get("bytes") or raw_item if isinstance(raw_item, dict) else raw_item
            src_doc = None
            try:
                if isinstance(item, (bytes, bytearray)):
                    src_doc = pymupdf.open(stream=item, filetype="pdf")
                elif isinstance(item, str) and os.path.exists(item):
                    with open(item, "rb") as f:
                        f_raw = f.read()
                    src_doc = pymupdf.open(stream=f_raw, filetype="pdf")
                elif isinstance(item, str) and item.startswith("data:application/pdf;base64,"):
                    raw = base64.b64decode(item.split(",", 1)[1])
                    src_doc = pymupdf.open(stream=raw, filetype="pdf")
                elif isinstance(item, str) and len(item) > 100:
                    try:
                        raw = base64.b64decode(item)
                        src_doc = pymupdf.open(stream=raw, filetype="pdf")
                    except Exception:
                        pass
                if src_doc:
                    if order == "prepend":
                        doc.insert_pdf(src_doc, start_at=0)
                    else:
                        doc.insert_pdf(src_doc)
                    merged_count += 1
            finally:
                if src_doc:
                    src_doc.close()

        merged_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(merged_bytes, "merge_pdf", "Merged PDFs", f"Merged {merged_count} additional PDF(s).")
        return {"ok": True, "message": f"Successfully merged {merged_count} PDF(s)."}

    def _handle_split_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        mode = params.get("mode", "extract_range")
        doc = session.open_working_doc()
        total_pages = len(doc)

        if mode == "extract_range" or "range" in mode:
            range_str = str(params.get("page_range") or params.get("ranges") or "").strip()
            pages = parse_page_ranges(range_str, total_pages)
        else:
            pages = [p for p in params.get("selected_pages", []) if 1 <= p <= total_pages]

        if not pages:
            doc.close()
            raise ValueError("No valid pages selected for extraction.")

        zero_indexed = [p - 1 for p in pages]
        doc.select(zero_indexed)
        split_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(split_bytes, "split_pdf", "Extracted Pages", f"Extracted {len(pages)} page(s) ({', '.join(str(p) for p in pages[:8])}{'...' if len(pages) > 8 else ''}).")
        return {"ok": True, "message": f"Extracted {len(pages)} page(s).", "pages_extracted": pages}

    def _handle_rotate_pages(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        angle = int(params.get("angle", 90))
        target_pages = params.get("pages", "all")

        doc = session.open_working_doc()
        total_pages = len(doc)

        if target_pages == "all":
            indices = list(range(total_pages))
        elif isinstance(target_pages, list):
            indices = [p - 1 for p in target_pages if 1 <= p <= total_pages]
        else:
            indices = list(range(total_pages))

        for idx in indices:
            page = doc[idx]
            page.set_rotation((page.rotation + angle) % 360)

        rot_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(rot_bytes, "rotate_pages", "Rotated Pages", f"Rotated {len(indices)} page(s) by {angle}°.")
        return {"ok": True, "message": f"Rotated {len(indices)} page(s) by {angle}°."}

    def _handle_rearrange_pages(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        new_order = params.get("new_order", [])
        if not new_order or not isinstance(new_order, list):
            raise ValueError("new_order array is required.")

        doc = session.open_working_doc()
        total_pages = len(doc)

        zero_indexed = [int(p) - 1 for p in new_order if 1 <= int(p) <= total_pages]
        if len(zero_indexed) != total_pages:
            doc.close()
            raise ValueError(f"new_order must contain all {total_pages} pages.")

        doc.select(zero_indexed)
        rearranged_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(rearranged_bytes, "rearrange_pages", "Rearranged Pages", f"Reordered {len(new_order)} pages.")
        return {"ok": True, "message": "Pages reordered successfully."}

    def _handle_delete_pages(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        doc = session.open_working_doc()
        total_pages = len(doc)

        pages = params.get("pages", [])
        if not pages and params.get("page_range"):
            pages = parse_page_ranges(str(params["page_range"]), total_pages)

        if not pages:
            doc.close()
            raise ValueError("No pages specified for deletion.")

        valid_pages = sorted(list(set(int(p) for p in pages if 1 <= int(p) <= total_pages)))
        if len(valid_pages) >= total_pages:
            doc.close()
            raise ValueError("Cannot delete all pages in document.")

        zero_indexed = [p - 1 for p in valid_pages]
        doc.delete_pages(zero_indexed)
        del_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(del_bytes, "delete_pages", "Deleted Pages", f"Removed {len(valid_pages)} page(s) ({', '.join(str(p) for p in valid_pages)}).")
        return {"ok": True, "message": f"Deleted {len(valid_pages)} page(s).", "remaining_pages": total_pages - len(valid_pages)}

    def _handle_insert_pages(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        src_raw = params.get("source_bytes") or params.get("source_pdf_bytes") or params.get("bytes") or ""
        if not src_raw:
            raise ValueError("source_bytes is required.")

        src_doc = None
        if isinstance(src_raw, (bytes, bytearray)):
            src_doc = pymupdf.open(stream=src_raw, filetype="pdf")
        elif isinstance(src_raw, str) and os.path.exists(src_raw):
            with open(src_raw, "rb") as f:
                raw = f.read()
            src_doc = pymupdf.open(stream=raw, filetype="pdf")
        elif isinstance(src_raw, str) and src_raw.startswith("data:application/pdf;base64,"):
            raw = base64.b64decode(src_raw.split(",", 1)[1])
            src_doc = pymupdf.open(stream=raw, filetype="pdf")
        else:
            raw = base64.b64decode(src_raw)
            src_doc = pymupdf.open(stream=raw, filetype="pdf")

        pos = params.get("position", "end")
        target_page = int(params.get("target_page", 1))

        doc = session.open_working_doc()
        total_pages = len(doc)

        if pos == "start":
            insert_idx = 0
        elif pos == "end":
            insert_idx = total_pages
        elif pos == "before_page":
            insert_idx = max(0, min(target_page - 1, total_pages))
        elif pos == "after_page":
            insert_idx = max(0, min(target_page, total_pages))
        else:
            insert_idx = total_pages

        doc.insert_pdf(src_doc, start_at=insert_idx)
        added_count = len(src_doc)
        src_doc.close()

        res_bytes = doc.tobytes()
        doc.close()

        session.update_working_pdf(res_bytes, "insert_pages", "Inserted Pages", f"Inserted {added_count} page(s) at position {pos}.")
        return {"ok": True, "message": f"Inserted {added_count} page(s)."}

    def _handle_watermark_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        wm_type = str(params.get("watermark_type", "")).strip().lower()
        if not wm_type:
            wm_type = "image" if (params.get("image_asset") or params.get("image_bytes") or params.get("image_data")) else "text"

        target_pages = params.get("pages", "all")
        doc = session.open_working_doc()
        total_pages = len(doc)

        if target_pages == "all":
            indices = list(range(total_pages))
        elif isinstance(target_pages, list):
            indices = [p - 1 for p in target_pages if 1 <= p <= total_pages]
        elif isinstance(target_pages, int):
            indices = [target_pages - 1] if 1 <= target_pages <= total_pages else list(range(total_pages))
        else:
            indices = list(range(total_pages))

        if not indices:
            doc.close()
            raise ValueError("No valid pages selected for watermark.")

        if wm_type == "image":
            # --- Image / Logo Watermark ---
            opacity = max(0.05, min(1.0, float(params.get("opacity", 0.25))))
            position = str(params.get("position", "center")).lower()
            scale_val = params.get("scale") or params.get("size", "medium")

            scale_map = {"small": 0.25, "medium": 0.45, "large": 0.70, "fit": 0.90}
            if isinstance(scale_val, str) and scale_val in scale_map:
                scale_ratio = scale_map[scale_val]
            else:
                try:
                    scale_ratio = max(0.1, min(1.0, float(scale_val)))
                except (ValueError, TypeError):
                    scale_ratio = 0.45

            # Resolve image bytes from asset or uploaded data
            img_bytes = None
            asset_name = params.get("image_asset")
            if asset_name:
                asset_key = str(asset_name).lower().strip()
                static_candidates = [
                    getattr(self, "base_dir", Path(__file__).resolve().parent) / "static",
                    Path(__file__).resolve().parent / "static",
                    Path(r"D:\AntiGravity Automation\VS_Desktop_App Old\static")
                ]
                asset_files = {
                    "vs_logo": "logo.png",
                    "logo": "logo.png",
                    "vs_database_logo": "logo.png",
                    "vs_emblem": "logo_emblem.png",
                    "emblem": "logo_emblem.png",
                    "monogram": "logo_emblem.png",
                    "vs_header": "VS_logo_header.png",
                    "header": "VS_logo_header.png",
                    "vs_logo_full": "VS_logo.png"
                }
                target_filename = asset_files.get(asset_key, f"{asset_key}.png")
                for s_dir in static_candidates:
                    p = s_dir / target_filename
                    if p.exists():
                        img_bytes = p.read_bytes()
                        break
                    p_fallback = s_dir / "logo.png"
                    if p_fallback.exists() and not img_bytes:
                        img_bytes = p_fallback.read_bytes()

            if not img_bytes:
                raw_img = params.get("image_bytes") or params.get("image_data") or params.get("image")
                if isinstance(raw_img, (bytes, bytearray)):
                    img_bytes = bytes(raw_img)
                elif isinstance(raw_img, str) and raw_img.startswith("data:image"):
                    img_bytes = base64.b64decode(raw_img.split(",", 1)[1])
                elif isinstance(raw_img, str) and len(raw_img) > 50:
                    try:
                        img_bytes = base64.b64decode(raw_img)
                    except Exception:
                        if os.path.exists(raw_img):
                            img_bytes = Path(raw_img).read_bytes()
                elif isinstance(raw_img, str) and os.path.exists(raw_img):
                    img_bytes = Path(raw_img).read_bytes()

            if not img_bytes:
                # Default fallback: VS Database Logo
                fallback_paths = [
                    Path(__file__).resolve().parent / "static" / "logo.png",
                    Path(r"D:\AntiGravity Automation\VS_Desktop_App Old\static\logo.png")
                ]
                for fp in fallback_paths:
                    if fp.exists():
                        img_bytes = fp.read_bytes()
                        break

            if not img_bytes:
                doc.close()
                raise ValueError("Image source could not be resolved for image watermark.")

            # Load & process image with PIL
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
            if pil_img.width > 1200 or pil_img.height > 1200:
                pil_img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)

            # Apply opacity to alpha channel
            r, g, b, a = pil_img.split()
            a = a.point(lambda p: int(p * opacity))
            pil_img = Image.merge("RGBA", (r, g, b, a))

            out_img = io.BytesIO()
            pil_img.save(out_img, format="PNG")
            wm_png_bytes = out_img.getvalue()

            img_w, img_h = pil_img.width, pil_img.height
            aspect = img_h / img_w

            for idx in indices:
                page = doc[idx]
                pw, ph = page.rect.width, page.rect.height

                target_w = pw * scale_ratio
                target_h = target_w * aspect
                if target_h > ph * 0.85:
                    target_h = ph * 0.85
                    target_w = target_h / aspect

                margin = 30
                if position in ("center", "center_horizontal", "center_diagonal"):
                    cx, cy = pw / 2, ph / 2
                    x = cx - target_w / 2
                    y = cy - target_h / 2
                elif position in ("top_right", "header_right"):
                    x = pw - target_w - margin
                    y = margin
                elif position in ("top_left", "header_left"):
                    x = margin
                    y = margin
                elif position in ("bottom_right", "footer_right"):
                    x = pw - target_w - margin
                    y = ph - target_h - margin
                elif position in ("bottom_left", "footer_left"):
                    x = margin
                    y = ph - target_h - margin
                elif position == "top_header":
                    x = (pw - target_w) / 2
                    y = 25
                elif position == "bottom_footer":
                    x = (pw - target_w) / 2
                    y = ph - target_h - 25
                else:
                    x = (pw - target_w) / 2
                    y = (ph - target_h) / 2

                rect = pymupdf.Rect(x, y, x + target_w, y + target_h)
                page.insert_image(rect, stream=wm_png_bytes, keep_proportion=True, overlay=True)

            wm_bytes = doc.tobytes()
            doc.close()
            session.update_working_pdf(wm_bytes, "watermark_pdf", "Applied Image Watermark", f"Image watermark applied to {len(indices)} page(s).")
            return {"ok": True, "message": f"Image watermark applied to {len(indices)} page(s)."}

        else:
            # --- Text Watermark ---
            text = str(params.get("text", "")).strip()
            if not text:
                raise ValueError("Watermark text is required.")

            position = params.get("position", "center_diagonal")
            font_size = int(params.get("font_size", 42))
            opacity = max(0.05, min(1.0, float(params.get("opacity", 0.25))))
            rotation = float(params.get("rotation", 45 if position == "center_diagonal" else 0))
            color_rgb = hex_to_rgb_float(str(params.get("color", "#DC2626")))

            font = pymupdf.Font("helv")
            text_len = font.text_length(text, fontsize=font_size)

            for idx in indices:
                page = doc[idx]
                w, h = page.rect.width, page.rect.height

                if position == "center_diagonal":
                    cx, cy = w / 2, h / 2
                    p = pymupdf.Point(cx - text_len / 2, cy)
                    morph = (pymupdf.Point(cx, cy), pymupdf.Matrix(rotation))
                    page.insert_text(p, text, fontname="helv", fontsize=font_size, color=color_rgb, morph=morph, fill_opacity=opacity)
                elif position == "center_horizontal":
                    cx, cy = w / 2, h / 2
                    p = pymupdf.Point(cx - text_len / 2, cy)
                    page.insert_text(p, text, fontname="helv", fontsize=font_size, color=color_rgb, fill_opacity=opacity)
                elif position == "top_header":
                    p = pymupdf.Point(w / 2 - text_len / 2, 40)
                    page.insert_text(p, text, fontname="helv", fontsize=font_size, color=color_rgb, fill_opacity=opacity)
                elif position == "bottom_footer":
                    p = pymupdf.Point(w / 2 - text_len / 2, h - 30)
                    page.insert_text(p, text, fontname="helv", fontsize=font_size, color=color_rgb, fill_opacity=opacity)

            wm_bytes = doc.tobytes()
            doc.close()

            session.update_working_pdf(wm_bytes, "watermark_pdf", "Applied Text Watermark", f"Text watermark '{text}' applied to {len(indices)} page(s).")
            return {"ok": True, "message": f"Text watermark applied to {len(indices)} page(s)."}

    def _handle_compress_pdf(self, session: PDFStudioSession, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        level = params.get("level") or params.get("preset", "balanced")
        if level in ("medium", "standard"):
            level = "balanced"
        before_size = session.working_pdf_path.stat().st_size

        doc = session.open_working_doc()

        if level == "high":
            try:
                for page in doc:
                    image_list = page.get_images()
                    for img_info in image_list:
                        xref = img_info[0]
                        base_image = doc.extract_image(xref)
                        if base_image and base_image.get("image"):
                            img_bytes = base_image["image"]
                            pil_img = Image.open(io.BytesIO(img_bytes))
                            if pil_img.width > 1200 or pil_img.height > 1200:
                                pil_img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
                                out_io = io.BytesIO()
                                pil_img.convert("RGB").save(out_io, format="JPEG", quality=75, optimize=True)
                                doc.update_stream(xref, out_io.getvalue())
            except Exception:
                pass

            comp_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
        elif level == "balanced":
            comp_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
        else:  # low
            comp_bytes = doc.tobytes(garbage=3, deflate=True)

        doc.close()

        after_size = len(comp_bytes)
        saved_bytes = max(0, before_size - after_size)
        pct = round((saved_bytes / before_size * 100), 1) if before_size > 0 else 0.0

        diff_str = f"Reduced from {before_size/1024:.1f} KB to {after_size/1024:.1f} KB (-{pct}%)"
        session.update_working_pdf(comp_bytes, "compress_pdf", "Compressed PDF", f"Mode: {level.capitalize()} • {diff_str}", stats_diff=f"-{pct}%")
        return {
            "ok": True,
            "message": f"Compressed ({level.capitalize()}): {diff_str}",
            "level": level,
            "before_size": before_size,
            "after_size": after_size,
            "saved_bytes": saved_bytes,
            "saved_percent": pct
        }


class PDFStudioEngine:
    """Core PDF Studio Subsystem Engine managing sessions and operations."""

    def __init__(self, base_dir: Path, application_id: str = "vs_desktop_app"):
        self.base_dir = Path(base_dir).resolve()
        self.application_id = application_id
        self.sessions_dir = self.base_dir / "data" / "pdf_studio_sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.registry = PDFToolRegistry(base_dir=self.base_dir)

    def create_session(
        self,
        original_name: Optional[str] = None,
        file_bytes: Optional[bytes] = None,
        source_files: Optional[List[Dict[str, Any]]] = None,
        source_file_paths: Optional[List[Any]] = None,
        original_filename: Optional[str] = None
    ) -> PDFStudioSession:
        """Initializes an isolated session with an untouched original and active working copy."""
        if source_file_paths:
            if not original_name and original_filename:
                original_name = original_filename
            if not original_name and source_file_paths:
                original_name = Path(source_file_paths[0]).name
            if source_files is None:
                source_files = [{"name": Path(p).name, "path": str(p)} for p in source_file_paths]
            if len(source_file_paths) == 1:
                file_bytes = Path(source_file_paths[0]).read_bytes()
            else:
                merged_doc = pymupdf.open()
                for sp in source_file_paths:
                    d = pymupdf.open(str(sp))
                    merged_doc.insert_pdf(d)
                    d.close()
                file_bytes = merged_doc.tobytes()
                merged_doc.close()

        if file_bytes is None:
            raise ValueError("file_bytes or source_file_paths must be provided.")
        if not original_name:
            original_name = original_filename or "document.pdf"

        session_id = f"pdf_sess_{uuid.uuid4().hex[:12]}"
        sdir = self.sessions_dir / session_id
        sdir.mkdir(parents=True, exist_ok=True)

        session = PDFStudioSession(sdir, session_id, self.application_id)

        with open(session.original_pdf_path, "wb") as f:
            f.write(file_bytes)
        with open(session.working_pdf_path, "wb") as f:
            f.write(file_bytes)

        session.meta["original_name"] = original_name
        session.meta["current_name"] = original_name
        session.meta["source_files"] = source_files or [{"name": original_name, "size": len(file_bytes)}]
        session.refresh_stats()

        session.meta["history"].append({
            "id": f"hist_{uuid.uuid4().hex[:8]}",
            "timestamp": iso_now(),
            "tool_id": "open_document",
            "title": "Document Opened",
            "details": f"Loaded '{original_name}' ({len(file_bytes)/1024:.1f} KB, {session.meta['page_count']} pages).",
            "stats_diff": ""
        })
        session.save_meta()
        return session

    def delete_session(self, session_id: str) -> bool:
        """Deletes the PDF Studio session directory and all its files."""
        safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_"))
        sdir = self.sessions_dir / safe_id
        if sdir.exists():
            shutil.rmtree(sdir, ignore_errors=True)
            return True
        return False

    def get_session(self, session_id: str) -> Optional[PDFStudioSession]:
        safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_"))
        sdir = self.sessions_dir / safe_id
        if not sdir.exists() or not (sdir / "working.pdf").exists():
            return None
        return PDFStudioSession(sdir, safe_id, self.application_id)

    def render_page_png(self, session_id: str, page_num: int, dpi: int = 120) -> bytes:
        """Renders on-demand high-resolution PNG bytes for a single page using in-memory streams to avoid Windows file locks."""
        session = self.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")

        with get_session_lock(session_id):
            doc = session.open_working_doc()
            if doc.needs_pass or doc.is_encrypted:
                doc.close()
                img = Image.new("RGB", (400, 300), color=(245, 245, 248))
                out = io.BytesIO()
                img.save(out, format="PNG")
                return out.getvalue()

            if not (1 <= page_num <= len(doc)):
                doc.close()
                raise ValueError(f"Page {page_num} out of bounds (1-{len(doc)}).")

            page = doc[page_num - 1]
            pix = page.get_pixmap(dpi=dpi)
            png_bytes = pix.tobytes("png")
            doc.close()
            return png_bytes

    def get_thumbnails(self, session_id: str, dpi: int = 45) -> List[Dict[str, Any]]:
        """Generates instantaneous thumbnail descriptors with lazy on-demand page preview URLs."""
        session = self.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")

        with get_session_lock(session_id):
            doc = session.open_working_doc()
            thumbnails = []
            is_locked = doc.needs_pass or doc.is_encrypted

            for idx in range(len(doc)):
                page_num = idx + 1
                if is_locked:
                    thumbnails.append({
                        "page_num": page_num,
                        "width": 120,
                        "height": 160,
                        "is_locked": True,
                        "data_url": ""
                    })
                else:
                    page = doc[idx]
                    rect = page.rect
                    page_url = f"/api/pdf-studio/sessions/{session_id}/page/{page_num}?dpi={dpi}"
                    thumbnails.append({
                        "page_num": page_num,
                        "width": int(rect.width),
                        "height": int(rect.height),
                        "rotation": page.rotation,
                        "is_locked": False,
                        "url": page_url,
                        "data_url": page_url
                    })

            doc.close()
            return thumbnails

    def execute_tool(self, session_id: str, tool_id: str, params: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")
        with get_session_lock(session_id):
            return self.registry.execute(session, tool_id, params, context)

    def undo(self, session_id: str) -> Dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")
        with get_session_lock(session_id):
            return session.undo()

    def reset_to_original(self, session_id: str) -> Dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")
        with get_session_lock(session_id):
            return session.reset_to_original()

