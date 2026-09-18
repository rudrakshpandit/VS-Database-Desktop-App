"""
Durable On-Disk Staging Manager for VS Database (Desktop App)
Maintains persistent staging sessions, manifest.json, and local files.
No large Base64 blobs stored in browser or memory.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StagingReplaceResult(dict):
    """Result dictionary that also supports unpacking as (manifest, new_entry)."""
    def __iter__(self):
        return iter([self["manifest"], self["new_entry"]])


class StagingSessionManager:
    """Manages on-disk staging sessions with atomic manifest updates and file isolation."""

    def __init__(self, base_dir: Path, application_id: str = "vs_desktop_app"):
        self.base_dir = Path(base_dir).resolve()
        self.application_id = application_id
        self.staging_root = self.base_dir / "data" / "staging"
        self.staging_root.mkdir(parents=True, exist_ok=True)

    def _session_dir(self, session_id: str) -> Path:
        safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_"))
        return self.staging_root / safe_id

    def _manifest_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "manifest.json"

    def _load_manifest(self, session_id: str) -> Optional[Dict[str, Any]]:
        mp = self._manifest_path(session_id)
        if not mp.exists():
            return None
        try:
            with open(mp, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _save_manifest(self, session_id: str, manifest: Dict[str, Any]) -> None:
        manifest["updated_at"] = iso_now()
        mp = self._manifest_path(session_id)
        tmp_mp = mp.with_suffix(".tmp")
        with open(tmp_mp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        tmp_mp.replace(mp)

    def get_or_create_session(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Loads an existing session or creates a new one."""
        if session_id:
            manifest = self._load_manifest(session_id)
            if manifest:
                return manifest

        new_id = f"stg_sess_{uuid.uuid4().hex[:12]}"
        sdir = self._session_dir(new_id)
        sdir.mkdir(parents=True, exist_ok=True)
        (sdir / "files").mkdir(exist_ok=True)

        manifest = {
            "session_id": new_id,
            "application_id": self.application_id,
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "files": []
        }
        self._save_manifest(new_id, manifest)
        return manifest

    def create_session(self) -> Dict[str, Any]:
        """Creates a brand new staging session."""
        return self.get_or_create_session(None)

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Loads manifest for the session ID if it exists."""
        return self._load_manifest(session_id)

    def get_file_disk_path(self, session_id: str, staged_file_id: str) -> Optional[Path]:
        """Alias for get_file_path to retrieve on-disk Path."""
        return self.get_file_path(session_id, staged_file_id)

    def add_file(
        self,
        session_id: str,
        original_name: str,
        file_bytes: bytes,
        mime_type: Optional[str] = None,
        client_visibility: bool = True,
        source_url: str = "",
        source_local_path: str = "",
        custom_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Saves a file directly to the session's disk storage and records in manifest."""
        manifest = self.get_or_create_session(session_id)
        sdir = self._session_dir(manifest["session_id"])
        files_dir = sdir / "files"
        files_dir.mkdir(exist_ok=True)

        if isinstance(file_bytes, (str, Path)) and os.path.exists(str(file_bytes)):
            with open(file_bytes, "rb") as bf:
                file_bytes = bf.read()
        elif isinstance(file_bytes, str):
            file_bytes = file_bytes.encode("utf-8")

        staged_id = custom_id or f"stg_{uuid.uuid4().hex}"
        name = os.path.basename(original_name) or "document"
        ext = os.path.splitext(name)[1].lower()
        if not ext:
            ext = ".pdf" if (mime_type == "application/pdf" or file_bytes.startswith(b"%PDF")) else ".bin"
            name = name + ext

        disk_filename = f"{staged_id}{ext}"
        disk_path = files_dir / disk_filename
        with open(disk_path, "wb") as f:
            f.write(file_bytes)

        is_pdf = ext == ".pdf" or file_bytes.startswith(b"%PDF")
        file_entry = {
            "staged_file_id": staged_id,
            "name": name,
            "filename": name,
            "original_name": original_name,
            "disk_filename": disk_filename,
            "size": len(file_bytes),
            "mime_type": mime_type or ("application/pdf" if is_pdf else "application/octet-stream"),
            "is_pdf": is_pdf,
            "is_encrypted": None if is_pdf else False,
            "is_unlocked": not is_pdf,
            "client_visibility": bool(client_visibility),
            "source_url": source_url,
            "source_local_path": source_local_path,
            "status": "pending",
            "badge": "Original",
            "added_at": iso_now(),
            "lineage": []
        }

        manifest["files"].append(file_entry)
        self._save_manifest(manifest["session_id"], manifest)
        return file_entry

    def add_file_from_disk(
        self,
        session_id: str,
        source_path: Path | str,
        original_name: Optional[str] = None,
        mime_type: Optional[str] = None,
        client_visibility: bool = True,
        source_url: str = "",
        custom_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Durably stages a file directly from local disk using chunked streaming.
        ZERO full-file bytes loaded into memory. Scalable to multi-gigabyte files.
        """
        src = Path(source_path).resolve()
        if not src.exists() or not src.is_file():
            raise FileNotFoundError(f"Source file not found: {src}")

        manifest = self.get_or_create_session(session_id)
        sdir = self._session_dir(manifest["session_id"])
        files_dir = sdir / "files"
        files_dir.mkdir(exist_ok=True)

        staged_id = custom_id or f"stg_{uuid.uuid4().hex}"
        name = os.path.basename(original_name or src.name) or "document"
        ext = os.path.splitext(name)[1].lower()
        if not ext:
            ext = src.suffix.lower() or ".bin"
            name = name + ext

        disk_filename = f"{staged_id}{ext}"
        disk_path = files_dir / disk_filename
        tmp_disk_path = files_dir / f"{disk_filename}.tmp"

        with open(src, "rb") as fsrc, open(tmp_disk_path, "wb") as fdst:
            while True:
                chunk = fsrc.read(65536)
                if not chunk:
                    break
                fdst.write(chunk)

        tmp_disk_path.replace(disk_path)
        file_size = disk_path.stat().st_size

        is_pdf = ext == ".pdf"
        if not is_pdf and file_size >= 4:
            try:
                with open(disk_path, "rb") as hf:
                    if hf.read(4) == b"%PDF":
                        is_pdf = True
            except Exception:
                pass

        file_entry = {
            "staged_file_id": staged_id,
            "name": name,
            "filename": name,
            "original_name": original_name or src.name,
            "disk_filename": disk_filename,
            "size": file_size,
            "mime_type": mime_type or ("application/pdf" if is_pdf else "application/octet-stream"),
            "is_pdf": is_pdf,
            "is_encrypted": None if is_pdf else False,
            "is_unlocked": not is_pdf,
            "client_visibility": bool(client_visibility),
            "source_url": source_url,
            "source_local_path": str(src),
            "status": "staged",
            "badge": "Original",
            "added_at": iso_now(),
            "lineage": []
        }

        manifest["files"].append(file_entry)
        self._save_manifest(manifest["session_id"], manifest)
        return file_entry

    def get_file_bytes(self, session_id: str, staged_file_id: str) -> Optional[Tuple[bytes, Dict[str, Any]]]:
        """Returns bytes and file entry for a staged file."""
        manifest = self._load_manifest(session_id)
        if not manifest:
            return None
        file_entry = next((f for f in manifest.get("files", []) if f["staged_file_id"] == staged_file_id), None)
        if not file_entry:
            return None
        disk_path = self._session_dir(session_id) / "files" / file_entry["disk_filename"]
        if not disk_path.exists():
            return None
        return disk_path.read_bytes(), file_entry

    def get_file_path(self, session_id: str, staged_file_id: str) -> Optional[Path]:
        """Returns Path to the staged file on disk."""
        manifest = self._load_manifest(session_id)
        if not manifest:
            return None
        file_entry = next((f for f in manifest.get("files", []) if f["staged_file_id"] == staged_file_id), None)
        if not file_entry:
            return None
        p = self._session_dir(session_id) / "files" / file_entry["disk_filename"]
        return p if p.exists() else None

    def remove_file(self, session_id: str, staged_file_id: str) -> bool:
        """Removes a file from disk and manifest."""
        manifest = self._load_manifest(session_id)
        if not manifest:
            return False
        remaining = []
        found = False
        for f in manifest.get("files", []):
            if f["staged_file_id"] == staged_file_id:
                found = True
                p = self._session_dir(session_id) / "files" / f["disk_filename"]
                try:
                    if p.exists():
                        p.unlink()
                except Exception:
                    pass
            else:
                remaining.append(f)
        if found:
            manifest["files"] = remaining
            self._save_manifest(session_id, manifest)
        return found

    def replace_files_with_processed_result(
        self,
        session_id: str,
        replace_staged_ids: List[str],
        result_filename: Optional[str] = None,
        result_bytes: Optional[bytes] = None,
        badge: str = "✓ PDF Studio",
        lineage_operation: str = "PDF Studio Processing",
        pdf_studio_session_id: Optional[str] = None,
        **kwargs
    ) -> StagingReplaceResult:
        """
        Atomically replaces a list of staged files with a single processed result.
        Other files in the session remain completely untouched at their original indexes.
        """
        manifest = self._load_manifest(session_id)
        if not manifest:
            raise ValueError(f"Staging session {session_id} not found.")

        if not result_filename:
            result_filename = kwargs.get("result_name") or "processed_document.pdf"

        if result_bytes is None:
            res_path = kwargs.get("result_pdf_path")
            if res_path and os.path.exists(str(res_path)):
                with open(res_path, "rb") as rf:
                    result_bytes = rf.read()
            else:
                raise ValueError("result_bytes or valid result_pdf_path must be provided.")

        files_dir = self._session_dir(session_id) / "files"
        files_dir.mkdir(exist_ok=True)

        new_staged_id = f"stg_{uuid.uuid4().hex}"
        ext = os.path.splitext(result_filename)[1].lower() or ".pdf"
        disk_filename = f"{new_staged_id}{ext}"
        disk_path = files_dir / disk_filename

        with open(disk_path, "wb") as f:
            f.write(result_bytes)

        new_entry = {
            "staged_file_id": new_staged_id,
            "name": result_filename,
            "filename": result_filename,
            "original_name": result_filename,
            "disk_filename": disk_filename,
            "size": len(result_bytes),
            "mime_type": "application/pdf",
            "is_pdf": True,
            "is_encrypted": False,
            "is_unlocked": True,
            "client_visibility": True,
            "status": "processed",
            "badge": badge,
            "added_at": iso_now(),
            "pdf_studio_session_id": pdf_studio_session_id,
            "lineage": [
                {
                    "created_from_ids": list(replace_staged_ids),
                    "operation": lineage_operation,
                    "session_id": pdf_studio_session_id,
                    "timestamp": iso_now()
                }
            ]
        }

        new_files_list = []
        replaced_count = 0
        inserted = False

        for f in manifest.get("files", []):
            if f["staged_file_id"] in replace_staged_ids:
                replaced_count += 1
                if not inserted:
                    new_files_list.append(new_entry)
                    inserted = True
                old_path = files_dir / f["disk_filename"]
                try:
                    if old_path.exists():
                        old_path.unlink()
                except Exception:
                    pass
            else:
                new_files_list.append(f)

        if not inserted:
            new_files_list.append(new_entry)

        manifest["files"] = new_files_list
        self._save_manifest(session_id, manifest)
        return StagingReplaceResult({"ok": True, "new_entry": new_entry, "manifest": manifest, "replaced_count": replaced_count})

    def clear_session(self, session_id: str) -> None:
        """Removes the staging session and all its files from disk."""
        sdir = self._session_dir(session_id)
        if sdir.exists():
            shutil.rmtree(sdir, ignore_errors=True)
