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
        "ai_provider": "VS AI Engine (Cloud Accelerated)",
        "active_model": "VS AI Fast Core"
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


def clean_model_response(text: str) -> str:
    """Strips internal reasoning tokens, leaked chain-of-thought, and thinking tags."""
    if not text:
        return ""
    # 1. Strip explicit <thought>...</thought> tags
    cleaned = re.sub(r'<thought>[\s\S]*?</thought>', '', text, flags=re.IGNORECASE)
    # 2. Strip thinking markdown block markers if present
    cleaned = re.sub(r'```(?:thought|thinking)[\s\S]*?```', '', cleaned, flags=re.IGNORECASE)
    # 3. Strip monologue/reasoning prefixes if the model leaked its internal check before responding
    monologue_pattern = r'^(?:\s*Wait,\s+I\s+should\s+check|\s*Let\'s\s+provide|\s*Response\s+Construction:|\s*Thinking\s+Process:)[\s\S]*?(?=(?:###\s+[A-Z]|\*\*|\b[A-Z][a-zA-Z\s]{2,20}:|\n\n[1-9]\.))'
    cleaned = re.sub(monologue_pattern, '', cleaned, flags=re.IGNORECASE)
    # 4. Clean any residual "This is the correct, authoritative, and helpful way to respond."
    cleaned = re.sub(r'This is the correct, authoritative, and helpful way to respond\.\s*', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


# ============================================================
# 2. VS AI ENGINE API PROVIDER
# ============================================================

class GeminiProvider:
    """Direct, lightweight HTTPS connector for the VS AI Statutory Intelligence Engine."""

    DEFAULT_MODEL = "gemini-flash-lite-latest"
    FALLBACK_MODELS = [
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-pro-latest"
    ]
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
        """Queries models API to discover the latest operational Flash model."""
        if not api_key:
            return None
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                available = []
                for m in data.get("models", []):
                    name = m.get("name", "").replace("models/", "")
                    methods = m.get("supportedGenerationMethods", [])
                    if "generateContent" in methods:
                        available.append(name)
                for pref in self.FALLBACK_MODELS:
                    if pref in available:
                        self.set_active_model(pref)
                        return pref
                if available:
                    self.set_active_model(available[0])
                    return available[0]
        except Exception as exc:
            logger.debug(f"Dynamic model discovery notice: {exc}")
        return self.DEFAULT_MODEL

    def get_api_key(self) -> Optional[str]:
        """Retrieves VS AI API Key from settings, env, or Google OAuth."""
        env_key = os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("VS_AI_KEY", "").strip()
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
        """Retrieves active Google OAuth access token if connected with AI scopes."""
        token_path = self.db_path.parent / "google_oauth_token.json"
        if not token_path.is_file():
            return None
        try:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request as GoogleRequest
            creds = Credentials.from_authorized_user_file(token_path)
            # Only use if scopes contain Generative AI or Cloud Platform
            valid_ai_scope = any("generative-language" in s or "cloud-platform" in s for s in (creds.scopes or []))
            if not valid_ai_scope:
                return None
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
            "provider": "VS AI",
            "active_model": "VS AI Fast Core",
            "has_api_key": bool(api_key),
            "has_oauth": bool(oauth_token),
            "status": "Ready" if has_auth else "Key Required",
            "message": "VS AI Engine Connected & Operational" if has_auth else "Please enter your VS AI Key in Settings"
        }
        return res

    def _build_payload(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2
    ) -> Dict[str, Any]:
        """Constructs standardized Gemini API JSON payload."""
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
                raw_b64 = att.get("base64_data", "")
                if "," in raw_b64 and raw_b64.startswith("data:"):
                    raw_b64 = raw_b64.split(",", 1)[1]

                mime = att.get("mime_type", "").lower()
                name = att.get("name", "Document")

                if mime == "application/pdf" and raw_b64:
                    current_parts.append({
                        "inline_data": {
                            "mime_type": "application/pdf",
                            "data": raw_b64
                        }
                    })
                elif (mime.startswith("image/") or name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))) and raw_b64:
                    img_mime = mime if mime.startswith("image/") else "image/png"
                    current_parts.append({
                        "inline_data": {
                            "mime_type": img_mime,
                            "data": raw_b64
                        }
                    })
                elif att.get("text"):
                    current_parts.append({"text": f"--- ATTACHED FILE ({name}):\n{att['text']}\n---"})
                elif raw_b64 and not mime.startswith("image/"):
                    try:
                        decoded_text = base64.b64decode(raw_b64).decode("utf-8", errors="ignore")
                        if len(decoded_text.strip()) > 0:
                            current_parts.append({"text": f"--- ATTACHED FILE ({name}):\n{decoded_text[:120000]}\n---"})
                    except Exception:
                        pass

        current_parts.append({"text": prompt})
        contents.append({"role": "user", "parts": current_parts})

        payload: Dict[str, Any] = {
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
        return payload

    def generate_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2
    ) -> Dict[str, Any]:
        """Executes a completion request against the VS AI Engine with automatic backoff retry."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()

        if not api_key and not oauth_token:
            return {
                "ok": False,
                "error": "VS AI key is not configured. Please add your key in VS AI Settings (click the settings gear or status badge)."
            }

        headers = {"Content-Type": "application/json"}
        if oauth_token and not api_key:
            headers["Authorization"] = f"Bearer {oauth_token}"

        payload = self._build_payload(prompt, system_instruction, history, attachments, temperature)
        payload_bytes = json.dumps(payload).encode("utf-8")

        active_model = self.get_active_model()
        candidates = [active_model]
        for fb in self.FALLBACK_MODELS:
            if fb not in candidates:
                candidates.append(fb)

        last_error = ""

        for candidate in candidates:
            if api_key:
                model_url = f"{self.API_BASE}/{candidate}:generateContent?key={api_key}"
            else:
                model_url = f"{self.API_BASE}/{candidate}:generateContent"

            for attempt in range(2):
                try:
                    req = urllib.request.Request(model_url, data=payload_bytes, headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        if resp.status == 200:
                            data = json.loads(resp.read().decode("utf-8"))
                            text = ""
                            cands = data.get("candidates", [])
                            if cands and "content" in cands[0]:
                                parts = cands[0]["content"].get("parts", [])
                                text = "".join([p.get("text", "") for p in parts if not p.get("thought", False)])
                                text = clean_model_response(text)
                            if candidate != active_model:
                                self.set_active_model(candidate)
                            return {"ok": True, "text": text, "model": candidate}
                except urllib.error.HTTPError as h_err:
                    try:
                        err_detail = json.loads(h_err.read().decode("utf-8"))
                        msg = err_detail.get("error", {}).get("message", str(h_err))
                    except Exception:
                        msg = str(h_err)
                    last_error = msg

                    if h_err.code in (500, 502, 503, 504, 429, 404) or "demand" in msg.lower() or "exhausted" in msg.lower() or "rate" in msg.lower() or "internal" in msg.lower():
                        logger.info(f"Model {candidate} busy/throttled ({h_err.code}: {msg}). Trying next candidate...")
                        if attempt == 0:
                            time.sleep(0.3)
                            continue
                        break

                    return {"ok": False, "error": f"VS AI notice ({h_err.code}): {msg}"}
                except Exception as exc:
                    last_error = str(exc)
                    if "timed out" in str(exc).lower():
                        if attempt == 0:
                            time.sleep(0.4)
                            continue
                        break
                    return {"ok": False, "error": f"Failed to connect to VS AI service: {str(exc)}"}

        return {
            "ok": False,
            "error": f"VS AI servers are currently experiencing peak demand across model pools ({last_error}). Please click 'Retry Query' below to resend."
        }

    def stream_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2
    ):
        """Streams completion tokens using Server-Sent Events from streamGenerateContent."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()

        if not api_key and not oauth_token:
            yield {
                "type": "error",
                "error": "VS AI key is not configured. Please add your key in VS AI Settings (click the settings gear or status badge)."
            }
            return

        headers = {"Content-Type": "application/json"}
        if oauth_token and not api_key:
            headers["Authorization"] = f"Bearer {oauth_token}"

        payload = self._build_payload(prompt, system_instruction, history, attachments, temperature)
        payload_bytes = json.dumps(payload).encode("utf-8")

        active_model = self.get_active_model()
        candidates = [active_model]
        for fb in self.FALLBACK_MODELS:
            if fb not in candidates:
                candidates.append(fb)

        last_error = ""

        for candidate in candidates:
            if api_key:
                model_url = f"{self.API_BASE}/{candidate}:streamGenerateContent?alt=sse&key={api_key}"
            else:
                model_url = f"{self.API_BASE}/{candidate}:streamGenerateContent?alt=sse"

            token_yielded = False
            try:
                req = urllib.request.Request(
                    model_url,
                    data=payload_bytes,
                    headers=headers,
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        for raw_line in resp:
                            line = raw_line.decode("utf-8", errors="replace").strip()
                            if not line.startswith("data:"):
                                continue
                            data_json = line[5:].strip()
                            if not data_json or data_json == "[DONE]":
                                continue
                            try:
                                d = json.loads(data_json)
                            except Exception:
                                continue

                            cands = d.get("candidates", [])
                            if cands and "content" in cands[0]:
                                parts = cands[0]["content"].get("parts", [])
                                for p in parts:
                                    if p.get("thought", False):
                                        continue
                                    t = p.get("text", "")
                                    if t:
                                        token_yielded = True
                                        yield {"type": "token", "delta": t, "model": candidate}

                        if token_yielded:
                            if candidate != active_model:
                                self.set_active_model(candidate)
                            yield {"type": "done", "model": candidate}
                            return

            except urllib.error.HTTPError as h_err:
                try:
                    err_detail = json.loads(h_err.read().decode("utf-8"))
                    msg = err_detail.get("error", {}).get("message", str(h_err))
                except Exception:
                    msg = str(h_err)
                last_error = f"HTTP {h_err.code}: {msg}"
                logger.info(f"Model {candidate} stream notice ({last_error}). Trying next fallback candidate...")
                if token_yielded:
                    yield {"type": "done", "model": candidate}
                    return
                continue
            except Exception as exc:
                last_error = str(exc)
                logger.info(f"Model {candidate} stream error ({last_error}). Trying next fallback candidate...")
                if token_yielded:
                    yield {"type": "done", "model": candidate}
                    return
                continue

        yield {
            "type": "error",
            "error": f"VS AI servers are currently experiencing peak demand across model pools ({last_error}). Please click 'Retry Query' below to resend."
        }

    def generate_json(self, prompt: str, system_instruction: Optional[str] = None) -> Dict[str, Any]:
        """Calls VS AI with strict JSON response configuration across fallback models."""
        api_key = self.get_api_key()
        oauth_token = self.get_oauth_token()

        if not api_key and not oauth_token:
            return {"ok": False, "error": "VS AI key is not configured"}

        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }
        if system_instruction:
            payload["system_instruction"] = {"parts": [{"text": system_instruction}]}

        active_model = self.get_active_model()
        candidates = [active_model]
        for fb in self.FALLBACK_MODELS:
            if fb not in candidates:
                candidates.append(fb)

        last_error = ""

        for candidate in candidates:
            if api_key:
                model_url = f"{self.API_BASE}/{candidate}:generateContent?key={api_key}"
            else:
                model_url = f"{self.API_BASE}/{candidate}:generateContent"

            for attempt in range(2):
                try:
                    req = urllib.request.Request(model_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        text = data["candidates"][0]["content"]["parts"][0]["text"]
                        if candidate != active_model:
                            self.set_active_model(candidate)
                        return {"ok": True, "data": json.loads(text), "model": candidate}
                except urllib.error.HTTPError as h_err:
                    try:
                        err_detail = json.loads(h_err.read().decode("utf-8"))
                        msg = err_detail.get("error", {}).get("message", str(h_err))
                    except Exception:
                        msg = str(h_err)
                    last_error = msg

                    if h_err.code in (503, 429, 404) or "demand" in msg.lower() or "exhausted" in msg.lower():
                        if attempt == 0:
                            time.sleep(0.5)
                            continue
                        break
                    return {"ok": False, "error": f"VS AI notice ({h_err.code}): {msg}"}
                except Exception as exc:
                    last_error = str(exc)
                    if attempt == 0:
                        time.sleep(0.5)
                        continue
                    break

        return {"ok": False, "error": f"VS AI engine busy: {last_error}"}


# ============================================================
# 3. STATUTORY RAG & KNOWLEDGE BASE ENGINE (Sources/)
# ============================================================

class KnowledgeBaseEngine:
    """Manages indexing and high-precision section-aware retrieval of statutory sources."""

    def __init__(self, db_path: Path):
        self.db_path = db_path

    def _ensure_tables(self, con):
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_sources (
                source_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                authority TEXT,
                relevant_law TEXT,
                source_type TEXT,
                section_rule TEXT,
                created_at TEXT
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_source_versions (
                version_id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                version_label TEXT,
                file_path TEXT,
                file_hash TEXT,
                file_size INTEGER,
                created_at TEXT
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_source_chunks (
                chunk_id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                version_id TEXT NOT NULL,
                heading TEXT,
                page_number INTEGER,
                content TEXT NOT NULL,
                token_count INTEGER,
                created_at TEXT
            )
        """)
        con.commit()

    def index_sources_folder(self, sources_dir: Path) -> int:
        """Discovers and indexes all statutory PDF acts, rules, and case laws from Sources/."""
        if not sources_dir.exists():
            return 0

        t_now = time.strftime("%Y-%m-%d %H:%M:%S")
        indexed_count = 0

        with sqlite3.connect(self.db_path, timeout=15) as con:
            con.row_factory = sqlite3.Row
            self._ensure_tables(con)
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
                    if "2025" in name_lower and ("income" in name_lower or "tax" in name_lower) and "rule" not in name_lower:
                        act_name = "Income-tax Act, 2025 (Act No. 30 of 2025)"
                        law_type = "Income Tax"
                        src_type = "Act"
                        authority = "Ministry of Law and Justice, Government of India"
                    elif ("2026" in name_lower or "2025" in name_lower) and "rule" in name_lower and ("income" in name_lower or "tax" in name_lower):
                        act_name = "Income-tax Rules, 2026"
                        law_type = "Income Tax"
                        src_type = "Rules"
                        authority = "Central Board of Direct Taxes, Ministry of Finance"
                    elif "income-tax" in name_lower or "income_tax" in name_lower:
                        act_name = "Income-tax Act, 1961 (Legacy Direct Tax Statute)"
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

        wants_1961 = any(k in q_clean for k in ("1961", "old act", "legacy", "previous act", "prior to 2025", "earlier act", "past act"))
        order_clause = "ORDER BY (CASE WHEN s.name LIKE '%1961%' THEN 0 ELSE 1 END), c.page_number ASC" if wants_1961 else "ORDER BY (CASE WHEN s.name LIKE '%2025%' OR s.name LIKE '%2026%' THEN 0 ELSE 1 END), c.page_number ASC"

        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            self._ensure_tables(con)

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
                    {order_clause}
                    LIMIT 50
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
                        {order_clause}
                        LIMIT 60
                    """
                    rows = con.execute(query_sql, params).fetchall()
                else:
                    rows = con.execute(f"""
                        SELECT c.chunk_id, c.source_id, c.version_id, c.page_number, c.heading, c.content,
                               s.name as source_name, s.source_type, s.relevant_law, s.section_rule
                        FROM ai_source_chunks c
                        JOIN ai_sources s ON c.source_id = s.source_id
                        WHERE 1=1 {scope_clause}
                        {order_clause}
                        LIMIT 50
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

            # Apply Income Tax Act version prioritization
            source_name_lower = (r["source_name"] or "").lower()
            is_2025 = "2025" in source_name_lower or "2026" in source_name_lower
            is_1961 = "1961" in source_name_lower

            if wants_1961:
                if is_1961:
                    score += 80
            else:
                # Default: Income-tax Act, 2025 and Income-tax Rules, 2026 take precedence
                if is_2025:
                    score += 100
                elif is_1961:
                    score -= 20

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
    output_dir: Optional[Path] = None,
    **kwargs
) -> Dict[str, Any]:
    """Generates an authoritative, beautifully styled PDF legal opinion using ReportLab."""
    import vs_ai_doc_generator
    return vs_ai_doc_generator.export_ai_opinion_pdf(
        title=title,
        content=content,
        citations=citations,
        client_name=client_name,
        output_dir=output_dir,
        **kwargs
    )


# ============================================================
# 6. CENTRAL AI ORCHESTRATOR
# ============================================================

class AIModelOrchestrator:
    """Central manager handling RAG grounding, prompt composition, and Gemini execution."""

    def generate_chat_title(self, prompt: str, assistant_response: str = "") -> str:
        """Generates an executive, professional 3-6 word title for a conversation or document."""
        # 1. Check if assistant response starts with a clear markdown heading
        if assistant_response:
            for line in assistant_response.splitlines()[:6]:
                line = line.strip()
                if line.startswith("#"):
                    clean_h = re.sub(r'^[#\s*]+', '', line).strip()
                    clean_h = re.sub(r'[*_`]', '', clean_h).strip()
                    clean_h = re.sub(r'^\d+\.\s*', '', clean_h).strip()
                    if 4 < len(clean_h) < 55 and not clean_h.lower().startswith(("table", "note", "disclaimer", "overview of", "analysis of", "schedule")):
                        return clean_h

        # 2. Use Gemini Flash Lite for instantaneous executive title generation
        title_prompt = f"""Generate a concise, professional title (3 to 6 words maximum) for this Chartered Accountant / Tax Advisory conversation.
Rules:
- Title Case only
- No quotation marks, no punctuation, no conversational preamble
- Capture the specific business / statutory subject matter (e.g., 'Footwear Manufacturing Accounts & GST' or 'Section 194BB Horse Racing TDS Advisory')

USER INQUIRY:
{prompt[:350]}

TITLE:"""
        try:
            res = self.gemini.generate_content(title_prompt, temperature=0.1)
            if res.get("ok"):
                raw_title = res.get("text", "").strip().splitlines()[0]
                raw_title = re.sub(r'["\'\*\#\`\:\.]', '', raw_title).strip()
                if 3 < len(raw_title) < 60:
                    return raw_title
        except Exception as e:
            logger.debug(f"AI auto-rename notice: {e}")

        # 3. Fallback heuristic
        clean_p = re.sub(r'^(?:generate|create|draft|explain|what is|tell me|give me|how to)\s+(?:a\s+|an\s+|the\s+)?', '', prompt.splitlines()[0], flags=re.I).strip()
        clean_p = re.sub(r'[\\/*?:"<>|]', '', clean_p).strip()
        clean_p = re.sub(r'\s+', ' ', clean_p)
        return clean_p[:40].title() if clean_p else "Statutory Advisory Brief"

    @staticmethod
    def is_statutory_inquiry(prompt: str) -> bool:
        """Determines if the prompt explicitly inquires about statutory legal provisions, Acts, rules, or rulings."""
        p = prompt.lower()
        statutory_patterns = [
            r'\bsec(?:tion)?\.?\s*\d+',
            r'\brule\s*\d+',
            r'\bclauses?\s*\d+',
            r'\bschedules?\s*\d+',
            r'\bact\b',
            r'\bstatut',
            r'\bincome\s*tax\b',
            r'\bgst\b|\bcgst\b|\bsgst\b|\bigst\b',
            r'\btds\b|\btcs\b',
            r'\bprovisions?\b',
            r'\bpenalt(?:y|ies)\b',
            r'\bassessment\b',
            r'\bappeals?\b',
            r'\bscrutin(?:y|ies)\b',
            r'\bnotice\b',
            r'\bcircular\b',
            r'\bnotifications?\b',
            r'\bexemptions?\b',
            r'\bdeductions?\b',
            r'\b80c\b|\b80d\b|\b115bac\b|\b194[a-z]?\b|\b44ab\b|\b44ad\b|\b54[a-z]?\b|\b148\b|\b147\b|\b143\b|\b271\b',
            r'\bcase\s*laws?\b|\brulings?\b|\bprecedents?\b',
            r'\bjudg(?:e)?ments?\b',
            r'\btribunals?\b|\bitat\b|\bnclt\b',
            r'\bhigh\s*court\b|\bsupreme\s*court\b',
            r'\bfinance\s*act\b',
            r'\bcompanies\s*act\b'
        ]
        return any(re.search(pat, p) for pat in statutory_patterns)

    def build_system_instruction(self, source_only: bool, has_attachments: bool, is_statutory: bool) -> str:
        """Builds context-adaptive system instructions tailored to whether files or statutes are targeted."""
        instructions = [
            "You are 'VS AI', an authoritative, highly capable legal, tax, and practice copilot designed for "
            "Chartered Accountants, Tax Practitioners, and Corporate Advisors."
        ]

        if has_attachments:
            instructions.append(
                "ATTACHED FILES / USER DOCUMENTS:\n"
                "- One or more files/documents have been uploaded by the user.\n"
                "- Your primary objective is to analyze, extract data from, summarize, or advise based on the attached document(s).\n"
                "- Adhere strictly to the facts, figures, financial statements, and text found in the attached files."
            )

        instructions.append(
            "COMPREHENSIVE STATUTORY KNOWLEDGE & ZERO-REFUSAL DIRECT ANSWERS:\n"
            "- You possess exhaustive mastery of Indian Tax Laws: the new Income-tax Act, 2025 (Act No. 30 of 2025), "
            "Income-tax Rules, 2026, the legacy Income-tax Act, 1961, the CGST Act, 2017, IGST Act, and relevant Case Laws/Rulings.\n"
            "- The provided reference excerpts (if present) are supplementary aids for page-exact citations. "
            "If a queried section or topic (e.g., Section 194BB, Section 80C, Section 194C, Section 115BAC, etc.) is not present in the excerpts, "
            "NEVER state 'NOT FOUND IN PROVIDED TEXT' and NEVER refuse to answer. "
            "Seamlessly provide a complete, authoritative, and accurate legal analysis from your extensive tax law knowledge.\n"
            "- NEVER output internal reasoning, thinking monologue, audit of chunks, or 'Response Construction' headers. "
            "Deliver clean, authoritative, immediate professional advice."
        )

        if is_statutory or source_only:
            instructions.append(
                "STATUTORY APPLICABILITY & DIRECT TAX CITATIONS:\n"
                "1. DEFAULT INCOME TAX STATUTE: By default, interpret, reason, and cite the new **Income-tax Act, 2025 (Act No. 30 of 2025)** "
                "and the **Income-tax Rules, 2026** as the primary governing direct tax law in India.\n"
                "2. LEGACY 1961 ACT: When the user refers to the legacy law, historic assessment years, or well-known sections (e.g. Section 194BB TDS on horse racing/lottery, Section 80C, Section 54), "
                "clearly explain the position under the Income-tax Act, 1961 and compare/clarify its status or equivalent regime under the Income-tax Act, 2025.\n"
                "3. GST & CORPORATE LAW: Ground queries in the Central Goods and Services Tax Act, 2017 (CGST Act), SGST Acts, CGST Rules, and Companies Act, 2013.\n"
                "4. STRICT CITATIONS: Accurately cite the exact Section, Sub-section, Clause, Rule, or Schedule."
            )
        else:
            instructions.append(
                "PRACTICE ADVISORY & PROFESSIONAL DRAFTING:\n"
                "- Answer the user's inquiry directly, clearly, and practically.\n"
                "- If drafting client communications, emails, advisory notes, computations, or explanations, maintain a polished, professional tone."
            )

        instructions.append(
            "TABLES, SPREADSHEETS & WORD DOCUMENT STRUCTURING:\n"
            "- When presenting calculations, comparisons, tax slabs, rate schedules, penalty tariffs, turnover brackets, deductions, financial statements, computations, or structured records:\n"
            "  * ALWAYS format them as structured Markdown tables with clear column headers (using '| Header 1 | Header 2 |' syntax) and proper numeric/currency alignments.\n"
            "  * The desktop application automatically converts your Markdown tables into formatted Microsoft Excel (.xlsx) workbooks and Microsoft Word (.docx) documents.\n"
            "- When visual trends or distributions are requested or beneficial, provide a visual chart using a ```chart code block.\n"
            "- When processes, corporate structures, litigation appeals hierarchies, or transaction workflows are requested or beneficial, provide a Mermaid diagram using a ```mermaid code block (e.g. flowchart TD or sequenceDiagram). The app natively compiles and renders Mermaid diagrams into interactive visual graphics."
        )

        instructions.append(
            "FORMATTING GUIDELINE:\n"
            "- Structure your response cleanly using concise headings, bold key terms, and bullet points.\n"
            "- Avoid unnecessary fluff; provide sharp, actionable professional output."
        )

        return "\n\n".join(instructions)

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

        has_attachments = bool(attachments and len(attachments) > 0)
        is_statutory = self.is_statutory_inquiry(prompt)
        should_retrieve_statutes = source_only or is_statutory

        retrieved_chunks = []
        if should_retrieve_statutes:
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
            client_info = f"CLIENT CONTEXT: Name: {client_context.get('name', 'N/A')}, File No: {client_context.get('file_no', 'N/A')}, PAN: {client_context.get('pan', 'N/A')}"

        full_prompt = prompt
        if grounding_text or client_info:
            parts = []
            if client_info:
                parts.append(client_info.strip())
            if grounding_text:
                parts.append(f"[SUPPLEMENTARY STATUTORY EXCERPTS (Cite if relevant, but answer from full statutory knowledge)]:\n{grounding_text.strip()}")
            parts.append(f"USER QUERY: {prompt}")
            full_prompt = "\n\n".join(parts)

        system_instruction = self.build_system_instruction(
            source_only=source_only,
            has_attachments=has_attachments,
            is_statutory=is_statutory
        )

        # 3. Call Gemini
        res = self.gemini.generate_content(
            prompt=full_prompt,
            system_instruction=system_instruction,
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
            "provider": "VS AI",
            "latency_ms": latency_ms
        }

    def route_and_stream(
        self,
        prompt: str,
        conversation_id: str,
        scope: str = "All Knowledge",
        source_only: bool = False,
        attachments: Optional[List[Dict[str, Any]]] = None,
        client_context: Optional[Dict[str, Any]] = None,
        history: Optional[List[Dict[str, str]]] = None
    ):
        """Runs RAG search, formats statutory context, and streams Gemini tokens via generator."""
        t_start = time.time()

        has_attachments = bool(attachments and len(attachments) > 0)
        is_statutory = self.is_statutory_inquiry(prompt)
        should_retrieve_statutes = source_only or is_statutory

        retrieved_chunks = []
        if should_retrieve_statutes:
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
            client_info = f"CLIENT CONTEXT: Name: {client_context.get('name', 'N/A')}, File No: {client_context.get('file_no', 'N/A')}, PAN: {client_context.get('pan', 'N/A')}"

        full_prompt = prompt
        if grounding_text or client_info:
            parts = []
            if client_info:
                parts.append(client_info.strip())
            if grounding_text:
                parts.append(f"[SUPPLEMENTARY STATUTORY EXCERPTS (Cite if relevant, but answer from full statutory knowledge)]:\n{grounding_text.strip()}")
            parts.append(f"USER QUERY: {prompt}")
            full_prompt = "\n\n".join(parts)

        system_instruction = self.build_system_instruction(
            source_only=source_only,
            has_attachments=has_attachments,
            is_statutory=is_statutory
        )

        # Yield grounding metadata event first
        active_model = self.gemini.get_active_model()
        yield {
            "type": "meta",
            "citations": citations,
            "model": active_model
        }

        # 3. Stream from Gemini
        accumulated_text = []
        used_model = active_model

        for event in self.gemini.stream_content(
            prompt=full_prompt,
            system_instruction=system_instruction,
            history=history,
            attachments=attachments
        ):
            ev_type = event.get("type")
            if ev_type == "token":
                accumulated_text.append(event.get("delta", ""))
                used_model = event.get("model", used_model)
                yield event
            elif ev_type == "done":
                used_model = event.get("model", used_model)
            elif ev_type == "error":
                yield event
                return

        latency_ms = round((time.time() - t_start) * 1000, 2)
        full_text = clean_model_response("".join(accumulated_text))

        yield {
            "type": "done",
            "full_text": full_text,
            "citations": citations,
            "model": used_model,
            "latency_ms": latency_ms
        }


# Global Engine Singleton Factory
_GLOBAL_AI_ENGINE = None
_GLOBAL_AI_LOCK = threading.Lock()

def get_ai_engine(db_path: Union[str, Path] = None) -> AIModelOrchestrator:
    global _GLOBAL_AI_ENGINE
    if db_path is None:
        db_path = Path(__file__).resolve().parent / "data" / "office_database.db"
    else:
        db_path = Path(db_path)

    with _GLOBAL_AI_LOCK:
        if _GLOBAL_AI_ENGINE is None:
            _GLOBAL_AI_ENGINE = AIModelOrchestrator(db_path)
            # Trigger background indexing of Sources/ folder
            sources_dir = Path(__file__).resolve().parent / "Sources"
            if not sources_dir.exists():
                sources_dir = db_path.parent.parent / "Sources"
            threading.Thread(
                target=_GLOBAL_AI_ENGINE.kb.index_sources_folder,
                args=(sources_dir,),
                daemon=True,
                name="AI-Sources-Indexer"
            ).start()
        return _GLOBAL_AI_ENGINE
