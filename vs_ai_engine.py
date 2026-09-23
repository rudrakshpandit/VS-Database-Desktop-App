# -*- coding: utf-8 -*-
"""
VS AI — Intelligent Statutory & CA Practice Assistant Engine
Powered by Google Gemini API + Local Statutory RAG (Income Tax, GST, Case Laws) + PDF Studio Engine
"""
from __future__ import annotations

import os
import sys
import re
import json
import time
import uuid
import shutil
import base64
import hashlib
import sqlite3
import logging
import platform
import threading
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Safe import for PyMuPDF (fitz)
try:
    import pymupdf as fitz
except (ModuleNotFoundError, ImportError):
    try:
        import fitz
    except (ModuleNotFoundError, ImportError):
        fitz = None

logger = logging.getLogger("VS_AI_Engine")
logger.setLevel(logging.INFO)


# ============================================================
# 1. HARDWARE & STATUS DISCOVERY
# ============================================================

def detect_system_hardware() -> Dict[str, Any]:
    """Lightweight system diagnostics for the UI."""
    res = {
        "os": platform.platform(),
        "cpu_name": platform.processor() or "Multi-Core CPU",
        "cpu_cores": os.cpu_count() or 4,
        "total_ram_gb": 8.0,
        "avail_ram_gb": 4.0,
        "ai_provider": "Google Gemini API (Cloud Serverless)",
        "active_model": "gemini-3.6-flash"
    }
    if sys.platform == "win32":
        try:
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('sullAvailExtendedVirtual', ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            res["total_ram_gb"] = round(stat.ullTotalPhys / (1024 ** 3), 1)
            res["avail_ram_gb"] = round(stat.ullAvailPhys / (1024 ** 3), 1)
        except Exception:
            pass
    return res


# ============================================================
# 2. GOOGLE GEMINI API PROVIDER
# ============================================================

class GeminiProvider:
    """Direct, lightweight HTTPS connector to Google Gemini 3.6 / Flash."""

    DEFAULT_MODEL = "gemini-3.6-flash"
    FALLBACK_MODEL = "gemini-3.7-flash"
    API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._cached_key = None
        self._key_lock = threading.Lock()
        self._active_model = self.DEFAULT_MODEL

    def get_active_model(self) -> str:
        """Returns the configured or discovered active Gemini model."""
        with self._key_lock:
            try:
                with sqlite3.connect(self.db_path, timeout=5) as con:
                    row = con.execute("SELECT value FROM settings WHERE key='gemini_model'").fetchone()
                    if row and row[0] and row[0].strip():
                        return row[0].strip()
            except Exception:
                pass
        return self._active_model or self.DEFAULT_MODEL

    def set_active_model(self, model: str):
        self._active_model = model.strip()
        with self._key_lock:
            try:
                with sqlite3.connect(self.db_path, timeout=5) as con:
                    con.execute(
                        "INSERT INTO settings(key, value) VALUES('gemini_model', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (model.strip(),)
                    )
            except Exception:
                pass

    def discover_active_model(self, api_key: str) -> Optional[str]:
        """Queries Google Gemini models API to discover the latest operational Flash model."""
        if not api_key:
            return None
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = []
                for m in data.get("models", []):
                    name = m.get("name", "").replace("models/", "")
                    methods = m.get("supportedGenerationMethods", [])
                    if (
                        "generateContent" in methods
                        and "flash" in name.lower()
                        and "image" not in name.lower()
                        and "tts" not in name.lower()
                        and "transcribe" not in name.lower()
                        and "preview" not in name.lower()
                    ):
                        candidates.append(name)
                # Prioritize gemini-3.6-flash if present
                if "gemini-3.6-flash" in candidates:
                    chosen = "gemini-3.6-flash"
                elif candidates:
                    chosen = candidates[0]
                else:
                    chosen = self.DEFAULT_MODEL
                self.set_active_model(chosen)
                return chosen
        except Exception as exc:
            logger.debug(f"Dynamic model discovery notice: {exc}")
            return None

    def get_api_key(self) -> Optional[str]:
        """Retrieves Gemini API Key from settings, env, or Google OAuth."""
        env_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if env_key:
            return env_key

        with self._key_lock:
            try:
                with sqlite3.connect(self.db_path, timeout=5) as con:
                    row = con.execute("SELECT value FROM settings WHERE key='gemini_api_key'").fetchone()
                    if row and row[0] and row[0].strip():
                        return row[0].strip()
            except Exception:
                pass
        return None

    def set_api_key(self, api_key: str):
        with self._key_lock:
            with sqlite3.connect(self.db_path, timeout=5) as con:
                con.execute(
                    "INSERT INTO settings(key, value) VALUES('gemini_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (api_key.strip(),)
                )

    def get_oauth_token(self) -> Optional[str]:
        """Retrieves active Google OAuth access token if connected for Google Drive."""
        token_path = self.db_path.parent / "google_oauth_token.json"
        if not token_path.is_file():
            return None
        try:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request as GoogleRequest
            creds = Credentials.from_authorized_user_file(token_path)
            if creds.expired and creds.refresh_token:
                creds.refresh(GoogleRequest())
                token_path.write_text(creds.to_json(), encoding="utf-8")
            if creds.valid:
                return creds.token
        except Exception as exc:
            logger.debug(f"OAuth token check notice: {exc}")
        return None

    def check_health(self) -> Dict[str, Any]:
        """Validates API Key readiness and connectivity."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()
        has_auth = bool(api_key or oauth_token)
        model = self.get_active_model()

        res = {
            "online": has_auth,
            "provider": "Google Gemini",
            "active_model": model,
            "has_api_key": bool(api_key),
            "has_oauth": bool(oauth_token),
            "status": "Ready" if has_auth else "API Key Required",
            "message": f"Connected to Gemini ({model})" if has_auth else "Please enter your Gemini API key in Settings"
        }
        return res

    def generate_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2
    ) -> Dict[str, Any]:
        """Executes a completion request against Google Gemini."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()

        if not api_key and not oauth_token:
            return {
                "ok": False,
                "error": "Gemini API key is not configured. Please add your key in VS AI Settings (click the settings gear or status badge)."
            }

        headers = {"Content-Type": "application/json"}
        model = self.get_active_model()
        if api_key:
            url = f"{self.API_BASE}/{model}:generateContent?key={api_key}"
        else:
            url = f"{self.API_BASE}/{model}:generateContent"
            headers["Authorization"] = f"Bearer {oauth_token}"

        contents = []

        # Previous conversation turns if provided
        if history:
            for turn in history[-10:]:
                role = "user" if turn.get("role") == "user" else "model"
                contents.append({
                    "role": role,
                    "parts": [{"text": turn.get("content", "")}]
                })

        # Current user turn parts
        current_parts = []
        if attachments:
            for att in attachments:
                if att.get("mime_type", "").startswith("image/"):
                    current_parts.append({
                        "inline_data": {
                            "mime_type": att.get("mime_type", "image/png"),
                            "data": att.get("base64_data", "")
                        }
                    })
                elif att.get("text"):
                    current_parts.append({"text": f"--- ATTACHMENT ({att.get('name', 'Doc')}):\n{att['text']}\n---"})

        current_parts.append({"text": prompt})
        contents.append({"role": "user", "parts": current_parts})

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 4096
            }
        }

        if system_instruction:
            payload["system_instruction"] = {
                "parts": [{"text": system_instruction}]
            }

        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    text = ""
                    cands = data.get("candidates", [])
                    if cands and "content" in cands[0]:
                        parts = cands[0]["content"].get("parts", [])
                        text = "".join([p.get("text", "") for p in parts])
                    return {"ok": True, "text": text, "model": model}
        except urllib.error.HTTPError as h_err:
            try:
                err_detail = json.loads(h_err.read().decode("utf-8"))
                msg = err_detail.get("error", {}).get("message", str(h_err))
            except Exception:
                msg = str(h_err)

            # Auto-healing: If model not found or deprecated (404), discover active model & retry
            if (h_err.code == 404 or "no longer available" in msg.lower() or "not found" in msg.lower()) and api_key:
                new_model = self.discover_active_model(api_key)
                if new_model and new_model != model:
                    logger.info("Auto-switching Gemini model from %s to %s and retrying...", model, new_model)
                    try:
                        retry_url = f"{self.API_BASE}/{new_model}:generateContent?key={api_key}"
                        retry_req = urllib.request.Request(retry_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
                        with urllib.request.urlopen(retry_req, timeout=30) as r_resp:
                            if r_resp.status == 200:
                                r_data = json.loads(r_resp.read().decode("utf-8"))
                                r_text = ""
                                r_cands = r_data.get("candidates", [])
                                if r_cands and "content" in r_cands[0]:
                                    r_parts = r_cands[0]["content"].get("parts", [])
                                    r_text = "".join([p.get("text", "") for p in r_parts])
                                return {"ok": True, "text": r_text, "model": new_model}
                    except Exception as retry_exc:
                        logger.warning("Gemini retry failed: %s", retry_exc)

            return {"ok": False, "error": f"Gemini API error ({h_err.code}): {msg}"}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to connect to Gemini: {str(exc)}"}

    def generate_json(self, prompt: str, system_instruction: Optional[str] = None) -> Dict[str, Any]:
        """Calls Gemini with strict JSON response configuration."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()

        if not api_key and not oauth_token:
            return {"ok": False, "error": "Gemini API key not configured"}

        headers = {"Content-Type": "application/json"}
        model = self.get_active_model()
        if api_key:
            url = f"{self.API_BASE}/{model}:generateContent?key={api_key}"
        else:
            url = f"{self.API_BASE}/{model}:generateContent"
            headers["Authorization"] = f"Bearer {oauth_token}"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }
        if system_instruction:
            payload["system_instruction"] = {"parts": [{"text": system_instruction}]}

        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return {"ok": True, "data": json.loads(text), "model": model}
        except urllib.error.HTTPError as h_err:
            try:
                err_detail = json.loads(h_err.read().decode("utf-8"))
                msg = err_detail.get("error", {}).get("message", str(h_err))
            except Exception:
                msg = str(h_err)

            if (h_err.code == 404 or "no longer available" in msg.lower() or "not found" in msg.lower()) and api_key:
                new_model = self.discover_active_model(api_key)
                if new_model and new_model != model:
                    try:
                        retry_url = f"{self.API_BASE}/{new_model}:generateContent?key={api_key}"
                        retry_req = urllib.request.Request(retry_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
                        with urllib.request.urlopen(retry_req, timeout=20) as r_resp:
                            r_data = json.loads(r_resp.read().decode("utf-8"))
                            r_text = r_data["candidates"][0]["content"]["parts"][0]["text"]
                            return {"ok": True, "data": json.loads(r_text), "model": new_model}
                    except Exception as retry_exc:
                        logger.warning("Gemini JSON retry failed: %s", retry_exc)
            return {"ok": False, "error": f"Gemini API error ({h_err.code}): {msg}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


# ============================================================
# 3. STATUTORY RAG & KNOWLEDGE BASE ENGINE (Sources/)
# ============================================================

class KnowledgeBaseEngine:
    """Manages indexing and high-precision section-aware retrieval of statutory sources."""

    def __init__(self, db_path: Path):
        self.db_path = db_path

    def index_sources_folder(self, sources_dir: Path) -> int:
        """Discovers and indexes all statutory PDF acts, rules, and case laws from Sources/."""
        if not sources_dir.exists():
            return 0

        t_now = time.strftime("%Y-%m-%d %H:%M:%S")
        indexed_count = 0

        with sqlite3.connect(self.db_path, timeout=15) as con:
            con.row_factory = sqlite3.Row
            existing_hashes = {r["file_hash"] for r in con.execute("SELECT file_hash FROM ai_source_versions WHERE file_hash IS NOT NULL AND file_hash != ''").fetchall()}

            pdf_files = list(sources_dir.glob("*.pdf")) + list(sources_dir.glob("*.PDF"))
            # Include subdirectories (e.g. Rajasthan GST Case Laws)
            for sub in sources_dir.iterdir():
                if sub.is_dir():
                    pdf_files.extend(list(sub.glob("*.pdf")) + list(sub.glob("*.PDF")))

            for pdf_file in pdf_files:
                try:
                    f_bytes = pdf_file.read_bytes()
                    f_hash = hashlib.sha256(f_bytes).hexdigest()
                    if f_hash in existing_hashes:
                        continue

                    if not fitz:
                        break

                    doc = fitz.open(str(pdf_file))
                    source_id = f"src_{hashlib.md5(pdf_file.stem.encode('utf-8')).hexdigest()[:16]}"
                    ver_id = f"ver_{source_id}"

                    # Detect Act / Source characteristics
                    name_lower = pdf_file.name.lower()
                    if "income-tax" in name_lower or "income_tax" in name_lower:
                        act_name = "Income Tax Act, 1961"
                        law_type = "Income Tax"
                        src_type = "Act"
                        authority = "Ministry of Finance, Government of India"
                    elif "cgst-rules" in name_lower:
                        act_name = "Central Goods and Services Tax Rules, 2017"
                        law_type = "GST"
                        src_type = "Rules"
                        authority = "CBIC, Ministry of Finance"
                    elif "cgst" in name_lower:
                        act_name = "Central Goods and Services Tax Act, 2017"
                        law_type = "GST"
                        src_type = "Act"
                        authority = "Government of India"
                    elif "rajasthan" in name_lower and "rules" in name_lower:
                        act_name = "Rajasthan Goods and Services Tax Rules, 2017"
                        law_type = "GST"
                        src_type = "Rules"
                        authority = "Government of Rajasthan"
                    elif "rajasthan" in name_lower:
                        act_name = "Rajasthan Goods and Services Tax Act, 2017"
                        law_type = "GST"
                        src_type = "Act"
                        authority = "Government of Rajasthan"
                    elif "aaar" in name_lower or "order" in name_lower or "case laws" in str(pdf_file).lower():
                        act_name = f"GST AAAR Ruling: {pdf_file.stem.replace('_', ' ').replace('-', ' ').title()}"
                        law_type = "GST"
                        src_type = "Judgment"
                        authority = "Appellate Authority for Advance Ruling (AAAR)"
                    else:
                        act_name = pdf_file.stem.replace("_", " ").title()
                        law_type = "Statutory Law"
                        src_type = "Act"
                        authority = "Statutory Authority"

                    con.execute("""
                        INSERT OR REPLACE INTO ai_sources (
                            source_id, name, source_type, authority, relevant_law, section_rule,
                            status, description, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'All Sections', 'indexed', ?, ?, ?)
                    """, (source_id, act_name, src_type, authority, law_type, f"Statutory PDF ({len(doc)} pages)", t_now, t_now))

                    con.execute("""
                        INSERT OR REPLACE INTO ai_source_versions (
                            version_id, source_id, version_name, status, file_path, file_hash, created_at
                        ) VALUES (?, ?, 'Primary Version', 'active', ?, ?, ?)
                    """, (ver_id, source_id, str(pdf_file), f_hash, t_now))

                    # Index pages / sections (capped at max 400 pages per source to optimize startup)
                    max_p = min(len(doc), 400)
                    for pno in range(max_p):
                        page = doc[pno]
                        txt = (page.get_text("text") or "").strip()
                        if len(txt) < 40:
                            continue

                        # Section header extraction heuristic
                        lines = [l.strip() for l in txt.split("\n") if l.strip()]
                        heading = lines[0] if lines else f"Page {pno + 1}"
                        for l in lines[:5]:
                            if any(k in l.lower() for k in ("section ", "sec. ", "rule ", "order ", "article ")):
                                heading = l[:90]
                                break

                        chunk_id = f"chk_{source_id}_{pno + 1}"
                        c_hash = hashlib.sha256(txt.encode("utf-8")).hexdigest()
                        con.execute("""
                            INSERT OR REPLACE INTO ai_source_chunks (
                                chunk_id, source_id, version_id, page_number, heading, content, chunk_hash, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, (chunk_id, source_id, ver_id, pno + 1, heading, txt, c_hash, t_now))

                    existing_hashes.add(f_hash)
                    indexed_count += 1
                except Exception as exc:
                    logger.debug(f"Error indexing {pdf_file.name}: {exc}")

        return indexed_count

    def retrieve_relevant_chunks(self, query: str, scope: str = "All Knowledge", limit: int = 5) -> List[Dict[str, Any]]:
        """High-precision statutory section & keyword retrieval."""
        q_clean = query.lower()

        # Extract explicit section references (e.g. 80C, 43B(h), 115BAC, 16(2), 271AAB, Rule 86B)
        sec_matches = re.findall(r'(?:(?:sec(?:tion)?|u/s|s\.)\s*([0-9]+[a-z]{0,4}(?:\([0-9a-z]+\))?))|\b([0-9]+[a-z]{1,4}(?:\([0-9a-z]+\))?)\b', q_clean)
        target_sections = set()
        for m in sec_matches:
            s = (m[0] or m[1] or "").strip().lower()
            if s and (not s.isdigit() or len(s) >= 2):
                target_sections.add(s)

        LEGAL_STOPWORDS = {
            "explain", "statutory", "framework", "recent", "judicial", "precedent", "precedents",
            "regarding", "deduction", "deductions", "under", "section", "sections", "act", "acts",
            "income", "tax", "taxes", "law", "laws", "court", "ruling", "rulings", "order", "orders",
            "rule", "rules", "provision", "provisions", "what", "which", "how", "why", "when",
            "where", "with", "from", "that", "this", "about", "india", "indian", "applicable", "details"
        }
        words = [t for t in re.findall(r'\b[a-z0-9\(\)\-]{3,}\b', q_clean) if t not in LEGAL_STOPWORDS]

        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row

            scope_clause = ""
            scope_param = []
            if scope == "Income Tax":
                scope_clause = "AND s.relevant_law = 'Income Tax'"
            elif scope == "GST":
                scope_clause = "AND s.relevant_law = 'GST'"
            elif scope == "Judgments":
                scope_clause = "AND s.source_type = 'Judgment'"

            if target_sections:
                where_parts = []
                params = []
                for sec in target_sections:
                    where_parts.append("(c.heading LIKE ? OR c.content LIKE ?)")
                    params.extend([f"%{sec}%", f"%{sec}%"])
                query_sql = f"""
                    SELECT c.chunk_id, c.source_id, c.version_id, c.page_number, c.heading, c.content,
                           s.name as source_name, s.source_type, s.relevant_law, s.section_rule
                    FROM ai_source_chunks c
                    JOIN ai_sources s ON c.source_id = s.source_id
                    WHERE ({' OR '.join(where_parts)}) {scope_clause}
                    LIMIT 30
                """
                rows = con.execute(query_sql, params).fetchall()
            else:
                where_parts = []
                params = []
                for w in words[:4]:
                    where_parts.append("(c.heading LIKE ? OR c.content LIKE ?)")
                    params.extend([f"%{w}%", f"%{w}%"])
                if where_parts:
                    query_sql = f"""
                        SELECT c.chunk_id, c.source_id, c.version_id, c.page_number, c.heading, c.content,
                               s.name as source_name, s.source_type, s.relevant_law, s.section_rule
                        FROM ai_source_chunks c
                        JOIN ai_sources s ON c.source_id = s.source_id
                        WHERE ({' OR '.join(where_parts)}) {scope_clause}
                        LIMIT 40
                    """
                    rows = con.execute(query_sql, params).fetchall()
                else:
                    rows = con.execute(f"""
                        SELECT c.chunk_id, c.source_id, c.version_id, c.page_number, c.heading, c.content,
                               s.name as source_name, s.source_type, s.relevant_law, s.section_rule
                        FROM ai_source_chunks c
                        JOIN ai_sources s ON c.source_id = s.source_id
                        WHERE 1=1 {scope_clause}
                        LIMIT 30
                    """).fetchall()

            scored = []
            for r in rows:
                content_lower = (r["content"] or "").lower()
                heading_lower = (r["heading"] or "").lower()
                all_text = f"{heading_lower} {content_lower}"

                score = 0
                for sec in target_sections:
                    if sec in heading_lower:
                        score += 60
                    elif re.search(r'\b' + re.escape(sec) + r'\b', all_text):
                        score += 35

                for w in words:
                    if w in heading_lower:
                        score += 15
                    elif w in content_lower:
                        score += 3

                if score > 0 or not target_sections:
                    scored.append((score, dict(r)))

            scored.sort(key=lambda x: x[0], reverse=True)
            return [s[1] for s in scored[:limit]]


# ============================================================
# 4. HYBRID AUTO AI DOCUMENT RENAMER (Regex + Gemini Flash)
# ============================================================

class AutoDocRenamer:
    """
    Tier 1: Instant Local Regex inspection (< 15ms) for standard digital tax forms.
    Tier 2: Gemini Flash Multimodal fallback (~0.6s) for scanned notices, letters, orders.
    """

    def __init__(self, gemini: GeminiProvider):
        self.gemini = gemini

    @staticmethod
    def _clean_name(name: str) -> str:
        name = re.sub(r'[\\/*?:"<>|]', '_', name)
        name = re.sub(r'\s+', '_', name)
        return name.strip('._')

    def rename_document(
        self,
        file_path: str,
        client_name: Optional[str] = None,
        client_pan: Optional[str] = None
    ) -> Dict[str, Any]:
        p = Path(file_path)
        if not p.is_file():
            return {"ok": False, "error": f"File not found: {file_path}"}

        ext = p.suffix.lower()
        if ext not in (".pdf", ".png", ".jpg", ".jpeg"):
            return {"ok": False, "error": f"Unsupported file format: {ext}"}

        # ---------------------------------------------------------
        # TIER 1: INSTANT LOCAL REGEX (10ms)
        # ---------------------------------------------------------
        if ext == ".pdf" and fitz:
            try:
                doc = fitz.open(str(p))
                sample_text = ""
                for pno in range(min(2, len(doc))):
                    sample_text += " " + (doc[pno].get_text("text") or "")
                sample_clean = re.sub(r'\s+', ' ', sample_text).strip()

                if len(sample_clean) > 80:
                    tier1_result = self._try_local_regex(sample_clean, client_name, client_pan)
                    if tier1_result:
                        tier1_result["method"] = "local_regex_instant"
                        tier1_result["suggested_filename"] = self._clean_name(tier1_result["suggested_filename"]) + ".pdf"
                        return {"ok": True, **tier1_result}
            except Exception as e:
                logger.debug(f"Local regex inspection exception: {e}")

        # ---------------------------------------------------------
        # TIER 2: GEMINI FLASH VISION / MULTIMODAL FALLBACK
        # ---------------------------------------------------------
        return self._try_gemini_vision(p, client_name, client_pan)

    def _try_local_regex(self, text: str, client_name: Optional[str], client_pan: Optional[str]) -> Optional[Dict[str, Any]]:
        t_low = text.lower()

        # Extract PAN (ABCDE1234F)
        pan_match = re.search(r'\b([a-z]{5}[0-9]{4}[a-z])\b', text, re.IGNORECASE)
        pan = pan_match.group(1).upper() if pan_match else (client_pan or "")

        # Extract AY (e.g. 2024-25, 2025-26)
        ay_match = re.search(r'(?:assessment\s*year|a\.y\.|ay)\s*[:\-]?\s*([0-9]{4}[\-\/][0-9]{2,4})', text, re.IGNORECASE)
        ay = ay_match.group(1).replace("/", "-") if ay_match else ""

        # Extract Period / Month for GST
        period_match = re.search(r'(?:period|return\s*period|tax\s*period)\s*[:\-]?\s*([a-z]{3,9}\s*[0-9]{4})', text, re.IGNORECASE)
        gst_period = period_match.group(1).replace(" ", "_").title() if period_match else ""

        # Extract GSTIN
        gstin_match = re.search(r'\b([0-9]{2}[a-z]{5}[0-9]{4}[a-z]{1}[1-9a-z]{1}z[0-9a-z]{1})\b', text, re.IGNORECASE)
        gstin = gstin_match.group(1).upper() if gstin_match else ""

        # 1. ITR Acknowledgement / ITR-V
        if "indian income tax return acknowledgement" in t_low or "itr-v" in t_low or "itrv" in t_low:
            itr_form = "ITR"
            f_match = re.search(r'\b(itr\-[1-7])\b', text, re.IGNORECASE)
            if f_match: itr_form = f_match.group(1).upper()
            period_str = f"AY_{ay}" if ay else "Ack"
            id_str = f"_{pan}" if pan else ""
            return {
                "doc_type": "ITR Acknowledgement",
                "period": ay,
                "suggested_filename": f"{itr_form}_{period_str}{id_str}"
            }

        # 2. Form 26AS
        if "form 26as" in t_low or "annual tax statement" in t_low:
            period_str = f"AY_{ay}" if ay else ""
            id_str = f"_{pan}" if pan else ""
            return {
                "doc_type": "Form 26AS",
                "period": ay,
                "suggested_filename": f"Form_26AS_{period_str}{id_str}"
            }

        # 3. Form 16 / 16A
        if "form no. 16a" in t_low or "form 16a" in t_low:
            return {
                "doc_type": "Form 16A",
                "period": ay,
                "suggested_filename": f"Form_16A_AY_{ay}_{pan}" if ay and pan else f"Form_16A_{pan}"
            }
        elif "form no. 16" in t_low or "form 16" in t_low:
            return {
                "doc_type": "Form 16",
                "period": ay,
                "suggested_filename": f"Form_16_AY_{ay}_{pan}" if ay and pan else f"Form_16_{pan}"
            }

        # 4. GSTR-3B
        if "gstr-3b" in t_low or "gstr 3b" in t_low:
            period_str = gst_period or "Summary"
            id_str = f"_{gstin}" if gstin else ""
            return {
                "doc_type": "GSTR-3B Return",
                "period": gst_period,
                "suggested_filename": f"GSTR3B_{period_str}{id_str}"
            }

        # 5. GSTR-1
        if "gstr-1" in t_low or "gstr 1" in t_low:
            period_str = gst_period or "Summary"
            id_str = f"_{gstin}" if gstin else ""
            return {
                "doc_type": "GSTR-1 Return",
                "period": gst_period,
                "suggested_filename": f"GSTR1_{period_str}{id_str}"
            }

        # 6. Challan 280 / Advance Tax
        if "challan no./itns 280" in t_low or "challan 280" in t_low or "advance tax" in t_low:
            return {
                "doc_type": "Advance Tax Challan 280",
                "period": ay,
                "suggested_filename": f"Challan_280_AY_{ay}_{pan}" if ay and pan else "Advance_Tax_Challan_280"
            }

        # 7. Intimation u/s 143(1)
        if "143(1)" in t_low or "intimation u/s 143(1)" in t_low:
            return {
                "doc_type": "Intimation u/s 143(1)",
                "period": ay,
                "suggested_filename": f"Notice_Sec143_1_AY_{ay}_{pan}" if ay and pan else "Notice_Sec143_1"
            }

        return None

    def _try_gemini_vision(self, p: Path, client_name: Optional[str], client_pan: Optional[str]) -> Dict[str, Any]:
        """Renders page 1 thumbnail and asks Gemini Flash to identify and rename."""
        prompt = (
            "Analyze this Indian legal / tax / office document image and identify:\n"
            "1. Document Type (e.g. ITR-V, GSTR-3B, Form 16, GST Notice ASMT-10, Appeal Order, Bank Statement, Tax Invoice, Advance Tax Challan)\n"
            "2. Assessment Year or Return Period\n"
            "3. Client Name or PAN / GSTIN\n"
            "4. Suggested standard filename strictly in format: [DocType]_[Period]_[EntityIdentifier].pdf\n\n"
            "Respond strictly in JSON format matching this schema:\n"
            "{\"doc_type\": \"...\", \"period\": \"...\", \"entity\": \"...\", \"suggested_filename\": \"...\", \"confidence\": 0.95}"
        )

        img_b64 = None
        if p.suffix.lower() == ".pdf" and fitz:
            try:
                doc = fitz.open(str(p))
                if len(doc) > 0:
                    page = doc[0]
                    pix = page.get_pixmap(dpi=150)
                    img_bytes = pix.tobytes("jpeg")
                    img_b64 = base64.b64encode(img_bytes).decode("utf-8")
            except Exception:
                pass
        elif p.suffix.lower() in (".png", ".jpg", ".jpeg"):
            try:
                img_b64 = base64.b64encode(p.read_bytes()).decode("utf-8")
            except Exception:
                pass

        if not img_b64:
            # Fallback to pure text extraction
            text_snip = ""
            if p.suffix.lower() == ".pdf" and fitz:
                try:
                    doc = fitz.open(str(p))
                    text_snip = doc[0].get_text("text")[:2000]
                except Exception:
                    pass
            prompt += f"\n\nDocument Text Sample:\n{text_snip}"
            res = self.gemini.generate_json(prompt, system_instruction="You are an expert Indian CA office document naming assistant.")
        else:
            attachments = [{"mime_type": "image/jpeg", "base64_data": img_b64}]
            res_content = self.gemini.generate_content(
                prompt + "\nOutput strictly valid JSON only.",
                attachments=attachments,
                system_instruction="You are an expert Indian CA office document naming assistant. Output strictly valid JSON."
            )
            if res_content.get("ok"):
                raw_text = res_content.get("text", "").strip()
                # Parse markdown code fences if any
                clean_json = re.sub(r'^```json\s*', '', raw_text)
                clean_json = re.sub(r'\s*```$', '', clean_json).strip()
                try:
                    res = {"ok": True, "data": json.loads(clean_json)}
                except Exception:
                    res = {"ok": False, "error": "Invalid JSON response from vision model"}
            else:
                res = res_content

        if res.get("ok") and "data" in res:
            d = res["data"]
            sug = d.get("suggested_filename") or f"{d.get('doc_type', 'Document')}_{d.get('period', 'General')}"
            sug = self._clean_name(sug)
            if not sug.lower().endswith(p.suffix.lower()):
                sug += p.suffix.lower()
            return {
                "ok": True,
                "method": "gemini_flash_vision",
                "doc_type": d.get("doc_type", "Document"),
                "period": d.get("period", ""),
                "entity": d.get("entity", ""),
                "suggested_filename": sug,
                "confidence": d.get("confidence", 0.9)
            }

        return {
            "ok": False,
            "error": res.get("error", "Could not classify document via Gemini")
        }


# ============================================================
# 5. PDF STUDIO EXPORT BRIDGE (ReportLab Branded PDFs)
# ============================================================

def export_ai_opinion_pdf(
    title: str,
    content: str,
    citations: Optional[List[Dict[str, Any]]] = None,
    client_name: Optional[str] = None,
    output_dir: Optional[Path] = None
) -> Dict[str, Any]:
    """Generates an authoritative, beautifully styled PDF legal opinion using ReportLab."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
    except ImportError:
        return {"ok": False, "error": "ReportLab is not installed."}

    if not output_dir:
        output_dir = Path.cwd() / "data" / "ai_exports"
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = f"VS_AI_Legal_Opinion_{int(time.time())}.pdf"
    pdf_path = output_dir / filename

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=22 * mm
    )

    styles = getSampleStyleSheet()

    # Custom Typography Palette
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=6
    )
    meta_style = ParagraphStyle(
        'DocMeta',
        fontName='Helvetica',
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=14
    )
    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=15,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=8
    )
    callout_style = ParagraphStyle(
        'DocCallout',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#1e3a8a"),
        backColor=colors.HexColor("#eff6ff"),
        borderColor=colors.HexColor("#3b82f6"),
        borderWidth=1,
        borderPadding=8,
        spaceAfter=10
    )
    h2_style = ParagraphStyle(
        'DocH2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#1e40af"),
        spaceBefore=12,
        spaceAfter=6
    )

    story = []

    # 1. Header & Title Banner
    story.append(Paragraph("VS DATABASE & TAX PRACTICE SUITE", meta_style))
    story.append(Paragraph(title or "Statutory Analysis & Advisory Brief", title_style))
    date_str = time.strftime("%d %B %Y")
    client_str = f" | Client: {client_name}" if client_name else ""
    story.append(Paragraph(f"Date: {date_str}{client_str} | Generated by VS AI Statutory Copilot", meta_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563eb"), spaceAfter=14))

    # 2. Content Formatting
    for block in content.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith("## ") or block.startswith("### "):
            header_txt = block.lstrip("#").strip()
            story.append(Paragraph(header_txt, h2_style))
        elif block.startswith("> ") or "section " in block.lower() and len(block) < 300:
            callout_txt = block.lstrip("> ").strip()
            story.append(Paragraph(callout_txt, callout_style))
        else:
            # Clean markdown bold/italic tags for ReportLab
            clean_txt = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', block)
            clean_txt = re.sub(r'\*(.*?)\*', r'<i>\1</i>', clean_txt)
            clean_txt = clean_txt.replace("\n", "<br/>")
            story.append(Paragraph(clean_txt, body_style))

    # 3. Statutory Citations Table
    if citations:
        story.append(Spacer(1, 10))
        story.append(Paragraph("<b>Statutory Sources & Precedents Cited</b>", h2_style))
        table_data = [["Source Statute / Ruling", "Provision / Section", "Reference Page"]]
        for c in citations:
            table_data.append([
                Paragraph(c.get("source", "Act"), body_style),
                Paragraph(c.get("section", "-"), body_style),
                Paragraph(str(c.get("page", 1)), body_style)
            ])
        t = Table(table_data, colWidths=[80 * mm, 60 * mm, 30 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(t)

    story.append(Spacer(1, 15))
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#cbd5e1"), spaceAfter=8))
    story.append(Paragraph("<i>This advisory analysis is digitally compiled for Chartered Accountancy practice reference. Please cross-verify with original gazette notifications before filing statutory submissions.</i>", meta_style))

    doc.build(story)
    return {"ok": True, "file_path": str(pdf_path), "filename": filename}


# ============================================================
# 6. CENTRAL AI ORCHESTRATOR
# ============================================================

class AIModelOrchestrator:
    """Central manager handling RAG grounding, prompt composition, and Gemini execution."""

    SYSTEM_PROMPT = (
        "You are 'VS AI', an authoritative, highly intelligent AI Legal and Tax Assistant built specifically for "
        "Indian Chartered Accountants, Tax Practitioners, and Corporate Advisors.\n\n"
        "Your core expertise covers:\n"
        "- Income-tax Act, 1961, Income Tax Rules, and relevant judicial precedents (ITAT, High Courts, Supreme Court).\n"
        "- Central Goods and Services Tax Act, 2017 (CGST Act), SGST Acts, CGST Rules, and AAAR/AAR rulings.\n"
        "- Companies Act, 2013 and ROC compliances.\n"
        "- Drafting representation letters, appeals, and notice replies.\n\n"
        "STRICT GROUNDING & CITATION GUIDELINES:\n"
        "1. Strictly cite the exact Section, Sub-section, Clause, Rule, or Notification number when answering.\n"
        "2. Ground your reasoning in the provided STATUTORY CHUNKS from the firm's knowledge library.\n"
        "3. If an answer cannot be deduced with certainty from authentic statutes, clearly state the ambiguity and recommend official departmental circulars.\n"
        "4. Format replies cleanly using clear headings, bold statutory terms, and concise bullet points."
    )

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.gemini = GeminiProvider(db_path)
        self.kb = KnowledgeBaseEngine(db_path)
        self.renamer = AutoDocRenamer(self.gemini)

    def route_and_execute(
        self,
        prompt: str,
        conversation_id: str,
        scope: str = "All Knowledge",
        source_only: bool = False,
        attachments: Optional[List[Dict[str, Any]]] = None,
        client_context: Optional[Dict[str, Any]] = None,
        history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """Runs RAG search, formats statutory context, and queries Gemini."""
        t_start = time.time()

        # 1. Retrieve Statutory Grounding Chunks
        retrieved_chunks = self.kb.retrieve_relevant_chunks(prompt, scope=scope, limit=4)
        grounding_text = ""
        citations = []

        if retrieved_chunks:
            grounding_text = "### AUTHENTIC STATUTORY KNOWLEDGE CHUNKS:\n"
            for c in retrieved_chunks:
                grounding_text += f"\n[SOURCE: {c['source_name']} | Section/Heading: {c['heading']} | Page {c['page_number']}]\n{c['content']}\n"
                citations.append({
                    "source": c["source_name"],
                    "section": c["heading"],
                    "page": c["page_number"],
                    "chunk_id": c["chunk_id"]
                })

        # 2. Build Injected Prompt
        client_info = ""
        if client_context:
            client_info = f"\nCLIENT CONTEXT: Name: {client_context.get('name', 'N/A')}, File No: {client_context.get('file_no', 'N/A')}, PAN: {client_context.get('pan', 'N/A')}\n"

        full_prompt = prompt
        if grounding_text:
            full_prompt = f"{grounding_text}\n{client_info}\nUSER INQUIRY: {prompt}"

        # 3. Call Gemini
        res = self.gemini.generate_content(
            prompt=full_prompt,
            system_instruction=self.SYSTEM_PROMPT,
            history=history,
            attachments=attachments
        )

        latency_ms = round((time.time() - t_start) * 1000, 2)

        if not res.get("ok"):
            return {
                "ok": False,
                "error": res.get("error", "AI generation failed"),
                "latency_ms": latency_ms
            }

        return {
            "ok": True,
            "answer": res.get("text", ""),
            "citations": citations,
            "model": res.get("model", self.gemini.get_active_model()),
            "provider": "Google Gemini",
            "latency_ms": latency_ms
        }


# Global Engine Singleton Factory
_GLOBAL_AI_ENGINE = None
_GLOBAL_AI_LOCK = threading.Lock()

def get_ai_engine(db_path: Path) -> AIModelOrchestrator:
    global _GLOBAL_AI_ENGINE
    with _GLOBAL_AI_LOCK:
        if _GLOBAL_AI_ENGINE is None:
            _GLOBAL_AI_ENGINE = AIModelOrchestrator(db_path)
            # Trigger background indexing of Sources/ folder
            sources_dir = db_path.parent.parent / "Sources"
            threading.Thread(
                target=_GLOBAL_AI_ENGINE.kb.index_sources_folder,
                args=(sources_dir,),
                daemon=True,
                name="AI-Sources-Indexer"
            ).start()
        return _GLOBAL_AI_ENGINE
