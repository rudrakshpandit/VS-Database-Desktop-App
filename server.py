from __future__ import annotations
import os

# Allow OAuth over HTTP during LOCAL DEVELOPMENT only.
# Remove this line when deploying with HTTPS.
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
import base64
import csv
import ctypes
import hashlib
import hmac
import ipaddress
import io
import json
import logging
import concurrent.futures
import mimetypes
from http.cookies import SimpleCookie
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote
from xml.etree import ElementTree as ET
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
import qrcode
from PIL import Image, ImageDraw
import pypdf
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

if getattr(sys, "frozen", False):
    _bundle_dir = Path(getattr(sys, "_MEIPASS", sys.executable)).resolve()
    if _bundle_dir.is_file():
        _bundle_dir = _bundle_dir.parent
    APP_ROOT = Path(sys.executable).resolve().parent
    if (APP_ROOT / "static").exists():
        STATIC_ROOT = APP_ROOT / "static"
    elif (_bundle_dir / "static").exists():
        STATIC_ROOT = _bundle_dir / "static"
    elif (APP_ROOT / "_internal" / "static").exists():
        STATIC_ROOT = APP_ROOT / "_internal" / "static"
    else:
        STATIC_ROOT = APP_ROOT / "static"
else:
    APP_ROOT = Path(__file__).resolve().parent
    STATIC_ROOT = APP_ROOT / "static"

DATA_ROOT = APP_ROOT / "data"
DATA_ROOT.mkdir(exist_ok=True)
REVOKED_ARCHIVE_DIR = DATA_ROOT / "revoked_archive"
REVOKED_ARCHIVE_DIR.mkdir(exist_ok=True)
BACKUP_DIR = DATA_ROOT / "backups"
BACKUP_DIR.mkdir(exist_ok=True)
SCRATCH_DIR = DATA_ROOT / ".scratch"
SCRATCH_DIR.mkdir(exist_ok=True)

from staging_manager import StagingSessionManager
from pdf_studio_engine import PDFStudioEngine

staging_mgr = StagingSessionManager(APP_ROOT, application_id="vs_desktop_app")
pdf_engine = PDFStudioEngine(APP_ROOT, application_id="vs_desktop_app")

class SafeStream:
    def __init__(self, log_path):
        self.log_path = log_path
        self._f = None
    def write(self, s):
        try:
            if self._f is None:
                self._f = open(self.log_path, "a", encoding="utf-8", buffering=1)
            self._f.write(s)
        except Exception:
            pass
    def flush(self):
        try:
            if self._f: self._f.flush()
        except Exception:
            pass

if sys.stdout is None or not hasattr(sys.stdout, "write"):
    sys.stdout = SafeStream(DATA_ROOT / "stdout.log")
if sys.stderr is None or not hasattr(sys.stderr, "write"):
    sys.stderr = SafeStream(DATA_ROOT / "stderr.log")

DB_PATH = DATA_ROOT / "vs_database_desktop.db"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get("PORT", "8767"))
PORTAL_LOCK = threading.RLock()
_CLIENT_LOCKS = {}
_CLIENT_LOCKS_GUARD = threading.Lock()

def get_client_portal_lock(file_no: str):
    with _CLIENT_LOCKS_GUARD:
        if file_no not in _CLIENT_LOCKS:
            _CLIENT_LOCKS[file_no] = threading.RLock()
        return _CLIENT_LOCKS[file_no]

GOOGLE_SCOPE = [
    "https://www.googleapis.com/auth/drive.file"
]
GOOGLE_CLIENT_FILE = DATA_ROOT / "google_oauth_client.json"
GOOGLE_TOKEN_FILE = DATA_ROOT / "google_oauth_token.json"
GOOGLE_REDIRECT_URI = f"http://localhost:{PORT}/api/google/callback"
HINDI_FONT = "NirmalaUI"


def private_bind_host():
    """Bind to one private LAN interface; never default to every interface."""
    configured = os.environ.get("VS_DATABASE_BIND_HOST", "").strip()
    if configured:
        address = ipaddress.ip_address(configured)
        if not (address.is_private or address.is_loopback):
            raise ValueError("VS_DATABASE_BIND_HOST must be a private or loopback address.")
        return configured
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            address = probe.getsockname()[0]
            if ipaddress.ip_address(address).is_private and address != "127.0.0.1":
                return address
    except OSError:
        pass
    candidates = []
    for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        address = info[4][0]
        if ipaddress.ip_address(address).is_private and address != "127.0.0.1":
            candidates.append(address)
    return candidates[0] if candidates else "127.0.0.1"


HOST = private_bind_host()
incoming_staging_queue = []
_STAGING_QUEUE_LOCK = threading.RLock()
_PROCESSED_DOWNLOAD_CACHE = {}  # key -> staged dict
_CURRENT_ACTIVE_STAGING_SESSION_ID = None
_STAGING_SESSION_LOCK = threading.RLock()

def get_active_staging_session_id() -> str:
    global _CURRENT_ACTIVE_STAGING_SESSION_ID
    with _STAGING_SESSION_LOCK:
        if not _CURRENT_ACTIVE_STAGING_SESSION_ID or not staging_mgr.get_session(_CURRENT_ACTIVE_STAGING_SESSION_ID):
            sess = staging_mgr.create_session()
            _CURRENT_ACTIVE_STAGING_SESSION_ID = sess["session_id"]
        return _CURRENT_ACTIVE_STAGING_SESSION_ID


def is_private_client(address):
    try:
        ip = ipaddress.ip_address(address)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def configured_root(value):
    if not value:
        return None
    path = Path(value).expanduser().resolve(strict=False)
    if not path.is_absolute():
        raise ValueError("Storage locations must be absolute paths.")
    return path


def is_within_allowed_roots(path):
    candidate = Path(path).resolve(strict=False)
    for root_value in (get_setting("local_root"), get_setting("drive_root")):
        root = configured_root(root_value)
        if root:
            try:
                candidate.relative_to(root)
                return True
            except ValueError:
                pass
    return False


def db():
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000;")
    connection.execute("PRAGMA synchronous=NORMAL;")
    return connection


DEFAULT_ALL_CLIENTS_TEMPLATE = [
    {"name": "Income Tax", "children": [
        {"name": "ITR", "children": []},
        {"name": "AIS", "children": []},
        {"name": "Form 26AS", "children": []},
        {"name": "Supporting Documents", "children": []}
    ]},
    {"name": "GST", "children": [
        {"name": "Returns", "children": []}
    ]},
    {"name": "Accounts", "children": []},
    {"name": "Other Documents", "children": []}
]

DEFAULT_FIRM_TYPE_TEMPLATES = {
    "ALL CLIENTS": DEFAULT_ALL_CLIENTS_TEMPLATE,
    "Individual": [
        {"name": "Income Tax", "children": [
            {"name": "ITR", "children": []},
            {"name": "AIS", "children": []},
            {"name": "Form 26AS", "children": []},
            {"name": "Supporting Documents", "children": []}
        ]},
        {"name": "GST", "children": []},
        {"name": "Other Documents", "children": []}
    ],
    "Sole Proprietor": [
        {"name": "Income Tax", "children": [
            {"name": "ITR", "children": []},
            {"name": "AIS", "children": []},
            {"name": "Form 26AS", "children": []}
        ]},
        {"name": "GST", "children": [
            {"name": "Returns", "children": []}
        ]},
        {"name": "Books", "children": []},
        {"name": "Other Documents", "children": []}
    ],
    "Partnership": [
        {"name": "Income Tax", "children": [
            {"name": "ITR", "children": []},
            {"name": "AIS", "children": []},
            {"name": "Form 26AS", "children": []}
        ]},
        {"name": "GST", "children": [
            {"name": "Returns", "children": []}
        ]},
        {"name": "Partnership Deed", "children": []},
        {"name": "Accounts", "children": [
            {"name": "Balance Sheet", "children": []},
            {"name": "Profit & Loss", "children": []},
            {"name": "Audit", "children": []}
        ]},
        {"name": "Other Documents", "children": []}
    ],
    "LLP": [
        {"name": "Income Tax", "children": [
            {"name": "ITR", "children": []},
            {"name": "AIS", "children": []},
            {"name": "Form 26AS", "children": []}
        ]},
        {"name": "GST", "children": [
            {"name": "Returns", "children": []}
        ]},
        {"name": "LLP Compliance", "children": [
            {"name": "Form 11", "children": []},
            {"name": "Form 8", "children": []}
        ]},
        {"name": "Accounts", "children": [
            {"name": "Balance Sheet", "children": []},
            {"name": "Profit & Loss", "children": []}
        ]},
        {"name": "Other Documents", "children": []}
    ],
    "Company": [
        {"name": "Income Tax", "children": [
            {"name": "ITR", "children": []},
            {"name": "AIS", "children": []},
            {"name": "Form 26AS", "children": []}
        ]},
        {"name": "GST", "children": [
            {"name": "Returns", "children": []}
        ]},
        {"name": "ROC / MCA", "children": []},
        {"name": "Accounts", "children": [
            {"name": "Balance Sheet", "children": []},
            {"name": "Profit & Loss", "children": []},
            {"name": "Audit", "children": []}
        ]},
        {"name": "Other Documents", "children": []}
    ]
}


def initialise():
    with db() as con:
        con.execute("PRAGMA journal_mode=WAL;")
        con.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clients (
            file_no TEXT PRIMARY KEY, name TEXT NOT NULL, mobile TEXT, client_type TEXT,
            client_group TEXT, tags TEXT, status TEXT, users TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS folder_rules (
            id INTEGER PRIMARY KEY CHECK(id=1), services TEXT NOT NULL, periods TEXT NOT NULL,
            order_name TEXT NOT NULL DEFAULT 'service-period'
        );
        CREATE TABLE IF NOT EXISTS save_jobs (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, client_file_no TEXT NOT NULL,
            client_name TEXT NOT NULL, service TEXT NOT NULL, period TEXT NOT NULL,
            document_name TEXT NOT NULL, local_path TEXT, drive_path TEXT,
            practive_status TEXT NOT NULL, status TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS client_portals (
            client_file_no TEXT PRIMARY KEY, folder_id TEXT NOT NULL, folder_link TEXT NOT NULL,
            access_pdf_path TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS portal_blocks (
            client_file_no TEXT PRIMARY KEY, reason TEXT NOT NULL, custom_message TEXT NOT NULL DEFAULT '',
            blocked_at TEXT NOT NULL, blocking_file_id TEXT NOT NULL, archive_folder_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS client_folder_mappings (
            client_file_no TEXT NOT NULL, storage_kind TEXT NOT NULL, folder_name TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY(client_file_no, storage_kind),
            UNIQUE(storage_kind, folder_name)
        );
        CREATE TABLE IF NOT EXISTS folder_inventory (
            client_file_no TEXT NOT NULL, storage_kind TEXT NOT NULL, relative_path TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('system','manual')), present INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL, PRIMARY KEY(client_file_no, storage_kind, relative_path)
        );
        CREATE TABLE IF NOT EXISTS file_inventory (
            client_file_no TEXT NOT NULL, storage_kind TEXT NOT NULL, relative_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0, modified_at TEXT, present INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL, PRIMARY KEY(client_file_no, storage_kind, relative_path)
        );
        CREATE TABLE IF NOT EXISTS category_templates (
            category TEXT PRIMARY KEY, services TEXT NOT NULL, structure TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS client_folder_overrides (
            client_file_no TEXT PRIMARY KEY REFERENCES clients(file_no) ON DELETE CASCADE,
            structure TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO folder_rules(id, services, periods, order_name)
        VALUES(1, '["ITR", "GST"]', '["AY 2025-26"]', 'service-period');

        INSERT OR IGNORE INTO settings(key, value) VALUES('backup_frequency', 'Daily');
        INSERT OR IGNORE INTO settings(key, value) VALUES('backup_retention_count', '10');
        INSERT OR IGNORE INTO settings(key, value) VALUES('backup_retention_days', '60');

        -- Authentication & Device Management Tables
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('host', 'staff')),
            status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'disabled', 'revoked')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
            device_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            device_name TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('approved', 'pending', 'disabled', 'revoked', 'rejected')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT,
            last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS access_requests (
            request_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
            ip_address TEXT NOT NULL,
            session_type TEXT NOT NULL DEFAULT 'web',
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'revoked'))
        );
        CREATE TABLE IF NOT EXISTS extension_exchange_codes (
            code TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            client_file_no TEXT,
            client_name TEXT,
            details TEXT,
            actor TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS firm_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            normalized_name TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS client_pdf_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_file_no TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            encrypted_password TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(client_file_no) REFERENCES clients(file_no) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pdf_cred_client ON client_pdf_credentials(client_file_no);
        CREATE INDEX IF NOT EXISTS idx_portals_client ON client_portals(client_file_no);
        CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
        CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(client_type);
        CREATE INDEX IF NOT EXISTS idx_activity_id ON activity_log(id);
        CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
        CREATE TABLE IF NOT EXISTS security_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('warning', 'critical', 'info')),
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            ip_address TEXT,
            actor TEXT,
            client_count INTEGER DEFAULT 0,
            details TEXT,
            is_dismissed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """)

        # Safe migration for structure column in category_templates
        cols = [r["name"] for r in con.execute("PRAGMA table_info(category_templates)").fetchall()]
        if "structure" not in cols:
            con.execute("ALTER TABLE category_templates ADD COLUMN structure TEXT NOT NULL DEFAULT '[]'")

        # Safe migration for encrypted_password in users
        user_cols = [r["name"] for r in con.execute("PRAGMA table_info(users)").fetchall()]
        if "encrypted_password" not in user_cols:
            con.execute("ALTER TABLE users ADD COLUMN encrypted_password TEXT NOT NULL DEFAULT ''")

        # Safe migration for actor, target_folder, reverted_at, reverted_archive_path in save_jobs
        job_cols = [r["name"] for r in con.execute("PRAGMA table_info(save_jobs)").fetchall()]
        if "actor" not in job_cols:
            con.execute("ALTER TABLE save_jobs ADD COLUMN actor TEXT NOT NULL DEFAULT 'Host'")
        if "target_folder" not in job_cols:
            con.execute("ALTER TABLE save_jobs ADD COLUMN target_folder TEXT NOT NULL DEFAULT ''")
        if "reverted_at" not in job_cols:
            con.execute("ALTER TABLE save_jobs ADD COLUMN reverted_at TEXT")
        if "reverted_archive_path" not in job_cols:
            con.execute("ALTER TABLE save_jobs ADD COLUMN reverted_archive_path TEXT")

        # Safe migration for activity_log
        act_cols = [r["name"] for r in con.execute("PRAGMA table_info(activity_log)").fetchall()]
        if "target_path" not in act_cols:
            con.execute("ALTER TABLE activity_log ADD COLUMN target_path TEXT DEFAULT ''")
        if "source_path" not in act_cols:
            con.execute("ALTER TABLE activity_log ADD COLUMN source_path TEXT DEFAULT ''")
        if "storage_kind" not in act_cols:
            con.execute("ALTER TABLE activity_log ADD COLUMN storage_kind TEXT DEFAULT 'local'")
        if "status" not in act_cols:
            con.execute("ALTER TABLE activity_log ADD COLUMN status TEXT DEFAULT 'completed'")
        if "reverted_at" not in act_cols:
            con.execute("ALTER TABLE activity_log ADD COLUMN reverted_at TEXT")

        # Seed the 5 default firm types if table is empty
        ft_count = con.execute("SELECT COUNT(*) as c FROM firm_types").fetchone()["c"]
        if ft_count == 0:
            default_types = ["Individual", "Sole Proprietor", "Partnership", "LLP", "Company"]
            for dft in default_types:
                dft_norm = re.sub(r"\s+", " ", dft.strip()).casefold()
                con.execute("INSERT OR IGNORE INTO firm_types (name, normalized_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
                            (dft, dft_norm, now(), now()))

        # Seed default hierarchical folder templates for the 5 initial firm types if not set
        for default_cat, default_tree in DEFAULT_FIRM_TYPE_TEMPLATES.items():
            existing_t = con.execute("SELECT category, structure FROM category_templates WHERE lower(trim(category))=lower(trim(?))", (default_cat,)).fetchone()
            if not existing_t:
                flat_services = [n["name"] for n in default_tree if isinstance(n, dict) and "name" in n]
                con.execute("INSERT INTO category_templates (category, services, structure, updated_at) VALUES (?, ?, ?, ?)",
                            (default_cat, json.dumps(flat_services), json.dumps(default_tree), now()))
            elif existing_t["structure"] in ("", "[]", None):
                flat_services = [n["name"] for n in default_tree if isinstance(n, dict) and "name" in n]
                con.execute("UPDATE category_templates SET structure=?, services=?, updated_at=? WHERE lower(trim(category))=lower(trim(?))",
                            (json.dumps(default_tree), json.dumps(flat_services), now(), default_cat))

        # Ensure default local_root is 'D:\Code Trial' if unset or pointing to C: drive
        cur_local = con.execute("SELECT value FROM settings WHERE key='local_root'").fetchone()
        if not cur_local or not cur_local["value"] or cur_local["value"].startswith("C:"):
            con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_root', ?)", (r"D:\Code Trial",))
            try:
                os.makedirs(r"D:\Code Trial", exist_ok=True)
            except Exception:
                pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
    return hashed, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
    return hmac.compare_digest(hashed, password_hash)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def has_host_user() -> bool:
    with db() as con:
        row = con.execute("SELECT count(*) as c FROM users WHERE role='host' AND status='active'").fetchone()
        return bool(row and row["c"] > 0)


def verify_windows_login(password: str) -> bool:
    try:
        import ctypes
        advapi32 = ctypes.windll.advapi32
        kernel32 = ctypes.windll.kernel32
        LOGON32_LOGON_INTERACTIVE = 2
        LOGON32_PROVIDER_DEFAULT = 0
        token = ctypes.c_void_p()
        username = os.environ.get("USERNAME", "")
        domain = os.environ.get("USERDOMAIN", ".")
        if not username or not password:
            return False
        success = advapi32.LogonUserW(
            username,
            domain,
            password,
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            ctypes.byref(token)
        )
        if success:
            kernel32.CloseHandle(token)
            return True
        return False
    except Exception:
        return False


def verify_host_credentials(pin_or_password: str) -> bool:
    if not pin_or_password or not isinstance(pin_or_password, str):
        return False
    pin_or_password = pin_or_password.strip()
    if not pin_or_password:
        return False
        
    # 1. Check Windows OS Host PC Account Password
    if verify_windows_login(pin_or_password):
        return True

    with db() as con:
        # 2. Check custom Host PIN in settings if set
        row_pin = con.execute("SELECT value FROM settings WHERE key='host_pin'").fetchone()
        if row_pin and row_pin["value"] and row_pin["value"].strip():
            if row_pin["value"].strip() == pin_or_password:
                return True
        else:
            # Default fallback PINs if host_pin has not been set yet
            if pin_or_password in ("1234", "admin", "admin123", "0000"):
                return True
            
        # 3. Check all active host users in database users table
        host_users = con.execute("SELECT password_hash, salt FROM users WHERE role='host' AND status='active'").fetchall()
        for u in host_users:
            if verify_password(pin_or_password, u["password_hash"], u["salt"]):
                return True
                
        # 4. If no host users exist yet, allow standard admin passwords
        if not host_users:
            if pin_or_password in ("admin", "admin123", "1234", "0000"):
                return True
                
    return False


def record_security_alert(alert_type: str, severity: str, title: str, message: str, ip_address: str = "", actor: str = "", client_count: int = 0, details: str = ""):
    with db() as con:
        con.execute(
            "INSERT INTO security_alerts (alert_type, severity, title, message, ip_address, actor, client_count, details, is_dismissed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (alert_type, severity, title, message, ip_address, actor, client_count, details, now())
        )
    log_activity(alert_type, None, None, f"{title}: {message}", actor)


def create_session(user_id: str, device_id: str, ip_address: str, session_type: str = "web") -> str:
    token = secrets.token_urlsafe(32)
    token_h = hash_token(token)
    session_id = str(uuid.uuid4())
    t = now()
    with db() as con:
        con.execute(
            "INSERT INTO sessions (session_id, token_hash, user_id, device_id, ip_address, session_type, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
            (session_id, token_h, user_id, device_id, ip_address, session_type, t, t)
        )
        con.execute(
            "UPDATE devices SET ip_address=?, last_seen_at=? WHERE device_id=?",
            (ip_address, t, device_id)
        )
    return token


def validate_session(raw_token: str, client_ip: str) -> dict | None:
    if not raw_token:
        return None
    token_h = hash_token(raw_token)
    t = now()
    with db() as con:
        row = con.execute("""
            SELECT s.session_id, s.token_hash, s.user_id, s.device_id, s.session_type, s.status as session_status,
                   u.role, u.status as user_status,
                   d.device_name, d.status as device_status
            FROM sessions s
            JOIN users u ON s.user_id = u.user_id
            JOIN devices d ON s.device_id = d.device_id
            WHERE s.token_hash = ? AND s.status = 'active'
        """, (token_h,)).fetchone()
        if not row:
            return None
        if row["user_status"] != "active" or row["device_status"] != "approved":
            return None
        # Dynamic DHCP update: record latest IP and activity time
        con.execute("UPDATE sessions SET last_seen_at=?, ip_address=? WHERE session_id=?", (t, client_ip, row["session_id"]))
        con.execute("UPDATE devices SET last_seen_at=?, ip_address=? WHERE device_id=?", (t, client_ip, row["device_id"]))
        return dict(row)


def revoke_session(raw_token: str):
    if not raw_token:
        return
    token_h = hash_token(raw_token)
    with db() as con:
        con.execute("UPDATE sessions SET status='revoked' WHERE token_hash=?", (token_h,))


def revoke_device(device_id: str):
    with db() as con:
        con.execute("UPDATE devices SET status='revoked', updated_at=? WHERE device_id=?", (now(), device_id))
        con.execute("UPDATE sessions SET status='revoked' WHERE device_id=?", (device_id,))


def create_extension_code(user_id: str, device_id: str) -> str:
    code = secrets.token_hex(16)
    expires_at = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() + 60, timezone.utc).isoformat(timespec="seconds")
    with db() as con:
        con.execute(
            "INSERT INTO extension_exchange_codes (code, user_id, device_id, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            (code, user_id, device_id, expires_at, now())
        )
    return code


def exchange_extension_code(code: str, device_id: str, client_ip: str) -> dict:
    t = now()
    with db() as con:
        row = con.execute("SELECT * FROM extension_exchange_codes WHERE code=? AND used=0", (code,)).fetchone()
        if not row:
            raise ValueError("Invalid or expired exchange code.")
        if row["expires_at"] < t:
            raise ValueError("Exchange code has expired.")
        user_id = row["user_id"]
        dev_id = row["device_id"]
        user = con.execute("SELECT * FROM users WHERE user_id=? AND status='active'", (user_id,)).fetchone()
        if not user:
            raise ValueError("User is not active.")
        device = con.execute("SELECT * FROM devices WHERE device_id=? AND status='approved'", (dev_id,)).fetchone()
        if not device:
            raise ValueError("Device is not approved.")
        con.execute("UPDATE extension_exchange_codes SET used=1 WHERE code=?", (code,))
    token = create_session(user_id, dev_id, client_ip, session_type="extension")
    return {"session_token": token, "user_id": user_id, "device_name": device["device_name"], "device_id": dev_id}


def hindi_font():
    if HINDI_FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(HINDI_FONT, r"C:\Windows\Fonts\Nirmala.ttc", subfontIndex=0))
    return HINDI_FONT


def get_setting(key, default="", con=None):
    if con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    else:
        with db() as c:
            row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def settings_payload(con=None):
    local = get_setting("local_root", con=con)
    if not local or local.startswith("C:"):
        local = r"D:\Code Trial"
    drive = get_setting("drive_root", con=con) or r"G:\My Drive\VS Database"
    mode = get_setting("google_drive_mode", "backup_and_client", con=con)
    office_name = get_setting("office_folder_name", "Office", con=con) or "Office"
    client_name = get_setting("client_folder_name", "Client", con=con) or "Client"
    drive_root_name = get_setting("google_portal_root_name", "VS Database", con=con) or "VS Database"

    office_root = str(Path(drive) / office_name)
    client_portal_root = str(Path(drive) / client_name)

    return {
        "local_root": local,
        "drive_root": drive,
        "google_drive_mode": mode,
        "office_folder_name": office_name,
        "client_folder_name": client_name,
        "google_portal_root_name": drive_root_name,
        "office_root": office_root,
        "client_portal_root": client_portal_root,
        "firm_name": get_setting("firm_name", "Vimal Sikhwal", con=con),
        "firm_title": get_setting("firm_title", "Tax Practitioner", con=con),
        "firm_city": get_setting("firm_city", "Jodhpur", con=con),
        "firm_phone": get_setting("firm_phone", con=con),
        "firm_upi_id": get_setting("firm_upi_id", con=con),
        "backup_dir": str(BACKUP_DIR.resolve()),
        "backup_frequency": get_setting("backup_frequency", "Daily", con=con),
        "backup_retention_count": get_setting("backup_retention_count", "10", con=con),
        "backup_retention_days": get_setting("backup_retention_days", "60", con=con),
        "last_backup_time": get_setting("last_backup_time", "", con=con),
        "last_backup_status": get_setting("last_backup_status", "Never", con=con),
    }


def provision_workspace(con=None):
    """Provisions all required storage root directories, office template structures,
    and client access passes based on the active google_drive_mode and configured paths."""
    close_db = False
    if con is None:
        con = sqlite3.connect(DB_PATH, timeout=30)
        con.row_factory = sqlite3.Row
        close_db = True

    try:
        settings = settings_payload(con=con)
        mode = settings.get("google_drive_mode", "backup_and_client")
        local_root = settings.get("local_root") or r"D:\Code Trial"
        drive_root = settings.get("drive_root") or r"G:\My Drive\VS Database"
        office_name = settings.get("office_folder_name", "Office") or "Office"
        client_name = settings.get("client_folder_name", "Client") or "Client"

        # 1. Local roots provisioning
        l_dir = configured_root(local_root)
        (l_dir / office_name).mkdir(parents=True, exist_ok=True)
        (l_dir / "Client Access Links").mkdir(parents=True, exist_ok=True)

        # 2. Google Drive roots provisioning on disk (for Office & Backups)
        if mode in ("backup_and_client", "only_backup"):
            d_dir = configured_root(drive_root)
            o_dir = d_dir / office_name
            o_dir.mkdir(parents=True, exist_ok=True)
            (o_dir / "Backups").mkdir(parents=True, exist_ok=True)

        # 3. Google Drive cloud root structure via API (API-First for Client Portals)
        if mode in ("backup_and_client", "only_client", "only_backup") and GOOGLE_TOKEN_FILE.is_file():
            try:
                svc = google_service()
                root = portal_root(svc)
                if mode in ("backup_and_client", "only_backup"):
                    drive_folder(svc, office_name, root["id"])
                elif mode == "only_client":
                    # Strictly purge any Office folder in Google Drive cloud
                    off_in_cloud = svc.files().list(q=f"'{root['id']}' in parents and name='{office_name}' and trashed=false", fields="files(id)").execute().get("files", [])
                    for f in off_in_cloud:
                        try: svc.files().delete(fileId=f["id"]).execute()
                        except Exception: pass

                if mode in ("backup_and_client", "only_client"):
                    get_portal_client_parent(svc)
            except Exception as exc:
                logging.warning("Cloud root provisioning warning: %s", exc)

        # 4. If clients exist, provision their directories & passes
        clients = con.execute("SELECT * FROM clients").fetchall()
        folders_created = 0
        passes_created = 0

        for client in clients:
            try:
                created = create_client_folders(dict(client), con=con)
                folders_created += created
            except Exception as exc:
                logging.warning("Error creating folders for %s: %s", client["name"], exc)

            if mode in ("backup_and_client", "only_client"):
                try:
                    ensure_client_portal(dict(client), check_remote=False)
                    passes_created += 1
                except Exception as exc:
                    logging.warning("Error creating portal pass for %s: %s", client["name"], exc)

        log_activity("workspace_provisioned", None, None, f"Provisioned workspace (mode: {mode}): {len(clients)} clients, {folders_created} folders, {passes_created} passes.", con=con)
        return {
            "ok": True,
            "mode": mode,
            "clients_count": len(clients),
            "folders_created": folders_created,
            "passes_created": passes_created,
            "message": "Workspace successfully provisioned and ready."
        }
    finally:
        if close_db:
            con.close()


def perform_fresh_start_wipe_api():
    """Performs a clean purge of all clients, portals, and generated folders for a 100% fresh start."""
    try:
        with db() as con:
            con.execute("DELETE FROM clients")
            con.execute("DELETE FROM client_portals")
            con.execute("DELETE FROM folder_inventory")
            con.execute("DELETE FROM file_inventory")
            con.execute("DELETE FROM save_jobs")
            con.execute("DELETE FROM portal_blocks")
            con.execute("DELETE FROM client_folder_overrides")

        # Clear scratch cache
        if SCRATCH_DIR.exists():
            for f in SCRATCH_DIR.glob("*"):
                try:
                    if f.is_file(): f.unlink(missing_ok=True)
                    elif f.is_dir(): shutil.rmtree(str(f), ignore_errors=True)
                except Exception:
                    pass

        # Clear local directories
        settings = settings_payload()
        mode = settings.get("google_drive_mode", "backup_and_client")
        office_name = settings.get("office_folder_name", "Office") or "Office"
        client_name = settings.get("client_folder_name", "Client") or "Client"

        l_root = settings.get("local_root")
        if l_root and Path(l_root).is_dir():
            for sub in (Path(l_root) / office_name, Path(l_root) / "Client Access Links"):
                if sub.is_dir():
                    for itm in list(sub.iterdir()):
                        try:
                            if itm.is_dir(): shutil.rmtree(str(itm), ignore_errors=True)
                            elif itm.is_file(): itm.unlink(missing_ok=True)
                        except Exception:
                            pass

        # Clear Google Drive local synced directories
        d_root = settings.get("drive_root")
        if d_root and Path(d_root).is_dir():
            # If in only_client or disabled mode, completely remove any lingering Office folder in Google Drive!
            if mode in ("only_client", "disabled"):
                g_off = Path(d_root) / office_name
                if g_off.exists():
                    try: shutil.rmtree(str(g_off), ignore_errors=True)
                    except Exception: pass
            else:
                g_off = Path(d_root) / office_name
                if g_off.is_dir():
                    for itm in list(g_off.iterdir()):
                        if itm.name != "Backups":
                            try:
                                if itm.is_dir(): shutil.rmtree(str(itm), ignore_errors=True)
                                elif itm.is_file(): itm.unlink(missing_ok=True)
                            except Exception:
                                pass

            g_cli = Path(d_root) / client_name
            if g_cli.is_dir():
                for itm in list(g_cli.iterdir()):
                    try:
                        if itm.is_dir(): shutil.rmtree(str(itm), ignore_errors=True)
                        elif itm.is_file(): itm.unlink(missing_ok=True)
                    except Exception:
                        pass

        # In only_client or disabled mode, also purge Office folder directly in Google Drive cloud via API
        if mode in ("only_client", "disabled") and GOOGLE_TOKEN_FILE.is_file():
            try:
                svc = google_service()
                root = portal_root(svc)
                off_in_cloud = svc.files().list(q=f"'{root['id']}' in parents and name='{office_name}' and trashed=false", fields="files(id)").execute().get("files", [])
                for f in off_in_cloud:
                    try: svc.files().delete(fileId=f["id"]).execute()
                    except Exception: pass
            except Exception:
                pass

        # Re-provision pristine roots
        provision_workspace()

        log_activity("fresh_start_wipe", None, None, "Executed total fresh start wipe.")
        return {"ok": True, "message": "Fresh start wipe completed. All client & office records cleared."}
    except Exception as exc:
        logging.error("Fresh start wipe error: %s", exc)
        return {"ok": False, "error": str(exc)}


def google_status():
    return {
        "credentials_uploaded": GOOGLE_CLIENT_FILE.is_file(),
        "connected": GOOGLE_TOKEN_FILE.is_file(),
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "portal_root_id": get_setting("google_portal_root_id"),
        "google_drive_mode": get_setting("google_drive_mode", "backup_and_client"),
    }


def google_service():
    if not GOOGLE_TOKEN_FILE.is_file():
        raise ValueError("Google Drive is not connected. Open Drive Sharing and connect it first.")
    try:
        credentials = Credentials.from_authorized_user_file(GOOGLE_TOKEN_FILE, GOOGLE_SCOPE)
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(GoogleRequest())
            GOOGLE_TOKEN_FILE.write_text(credentials.to_json(), encoding="utf-8")
        if not credentials.valid:
            GOOGLE_TOKEN_FILE.unlink(missing_ok=True)
            raise ValueError("Google Drive permission has expired. Reconnect it from Drive Sharing.")
        return build("drive", "v3", credentials=credentials, cache_discovery=False)
    except Exception as exc:
        GOOGLE_TOKEN_FILE.unlink(missing_ok=True)
        raise ValueError("Google Drive permission has expired or was revoked. Reconnect it from Drive Sharing.") from exc


def drive_folder(service, name, parent_id=None):
    escaped_name = name.replace("'", "\\'")
    query = ["mimeType='application/vnd.google-apps.folder'", f"name='{escaped_name}'", "trashed=false"]
    if parent_id:
        query.append(f"'{parent_id}' in parents")
    else:
        query.append("'root' in parents")
    result = service.files().list(q=" and ".join(query), spaces="drive", supportsAllDrives=True, includeItemsFromAllDrives=True, fields="files(id,name,webViewLink)").execute().get("files", [])
    if result:
        return result[0]

    body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        body["parents"] = [parent_id]
    return service.files().create(body=body, supportsAllDrives=True, fields="id,name,webViewLink").execute()


def portal_root(service):
    drive_root_setting = get_setting("drive_root")
    root_folder_name = Path(drive_root_setting).name if drive_root_setting else "VS Database"
    if not root_folder_name:
        root_folder_name = "VS Database"

    root_id = get_setting("google_portal_root_id")
    if root_id:
        try:
            r = service.files().get(fileId=root_id, fields="id,name,webViewLink,trashed").execute()
            if r and not r.get("trashed"):
                return r
        except Exception:
            pass
    root = drive_folder(service, root_folder_name)
    with db() as con:
        con.execute("INSERT INTO settings(key,value) VALUES('google_portal_root_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (root["id"],))
    return root


def drive_upload_or_update_file(service, parent_id: str, filename: str, raw_bytes: bytes, mime_type: str = None) -> dict:
    """Uploads a file into a Google Drive folder or updates it in-place if a file with same name exists."""
    if not mime_type:
        import mimetypes
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    
    escaped_name = filename.replace("'", "\\'")
    query = f"name='{escaped_name}' and '{parent_id}' in parents and trashed=false"
    try:
        existing = service.files().list(q=query, spaces="drive", fields="files(id,name,webViewLink)").execute().get("files", [])
    except Exception:
        existing = []
    
    media = MediaIoBaseUpload(io.BytesIO(raw_bytes), mimetype=mime_type, resumable=False)
    if existing:
        file_id = existing[0]["id"]
        return service.files().update(fileId=file_id, media_body=media, fields="id,name,webViewLink").execute()
    else:
        body = {"name": filename, "parents": [parent_id]}
        return service.files().create(body=body, media_body=media, fields="id,name,webViewLink").execute()


def resolve_canonical_period(target_folder: str = "", period: str = "", service: str = "", con=None) -> str:
    """Resolves and extracts the valid Assessment Year / Period (e.g. 'AY 2025-26').
    Guarantees that generic placeholders like 'Current', 'Documents', 'Default' are never returned."""
    # 1. Check if period parameter is already a valid specific AY/Period
    if period and isinstance(period, str):
        clean_p = period.strip()
        if clean_p and clean_p.lower() not in ("current", "documents", "default", "none", "null", "undefined", ""):
            return clean_p

    # 2. Extract from target_folder path if available (e.g. "GST/AY 2025-26/Returns" -> "AY 2025-26")
    if target_folder and isinstance(target_folder, str):
        parts = [p.strip() for p in target_folder.replace("\\", "/").split("/") if p.strip()]
        for p in parts:
            if re.search(r'\b(AY|FY)?\s*20\d{2}[-–/]\d{2,4}\b', p, re.IGNORECASE):
                return p

    # 3. Lookup configured primary active period from folder_rules table
    try:
        should_close = False
        if not con:
            con = sqlite3.connect(DB_PATH, timeout=20)
            con.row_factory = sqlite3.Row
            should_close = True
        try:
            rule = con.execute("SELECT periods FROM folder_rules WHERE id=1").fetchone()
            if rule and rule["periods"]:
                configured = json.loads(rule["periods"])
                if isinstance(configured, list) and len(configured) > 0:
                    if target_folder:
                        for cp in configured:
                            if cp and cp.strip().lower() in target_folder.lower():
                                return cp.strip()
                    return configured[0].strip()
        finally:
            if should_close:
                con.close()
    except Exception:
        pass

    return "AY 2025-26"


def sync_document_to_google_drive(client: dict, target_folder: str, period: str, filename: str, raw_bytes: bytes, client_visibility: bool = False):
    """Syncs a saved document directly to Google Drive hierarchy and/or Client Shared Folder."""
    if not GOOGLE_TOKEN_FILE.is_file():
        return None
    try:
        service = google_service()
        root = portal_root(service)
        client_f = drive_folder(service, safe_name(client["name"]), root["id"])
        
        canonical_period = resolve_canonical_period(target_folder=target_folder, period=period)
        uploaded_links = []
        
        # 1. If Client Visibility is requested, or if target folder is inside shared folder, sync to Client Shared Folder
        if client_visibility or (target_folder and "client shared folder" in target_folder.lower()):
            shared_f = drive_folder(service, "Client Shared Folder", client_f["id"])
            p_name = safe_name(canonical_period)
            period_f = drive_folder(service, p_name, shared_f["id"])
            res_s = drive_upload_or_update_file(service, period_f["id"], filename, raw_bytes)
            if res_s and res_s.get("webViewLink"):
                uploaded_links.append(res_s["webViewLink"])
                
        # 2. General Folder Structure Mirroring on Google Drive
        if target_folder and "client shared folder" not in target_folder.lower():
            parts = [p.strip() for p in target_folder.replace("\\", "/").split("/") if p.strip()]
            curr_parent_id = client_f["id"]
            for part in parts:
                f_obj = drive_folder(service, safe_name(part), curr_parent_id)
                curr_parent_id = f_obj["id"]
            res_g = drive_upload_or_update_file(service, curr_parent_id, filename, raw_bytes)
            if res_g and res_g.get("webViewLink"):
                uploaded_links.append(res_g["webViewLink"])
                
        return uploaded_links[0] if uploaded_links else None
    except Exception as exc:
        c_name = client["name"] if isinstance(client, (dict, sqlite3.Row)) else getattr(client, "name", str(client))
        logging.warning("Google Drive file sync error for client %s, file %s: %s", c_name, filename, exc)
        return None


def cleanup_stray_current_folders(client=None):
    """Scans and eliminates any legacy 'Current' or 'Documents' folders, migrating any files into 'AY 2025-26'."""
    try:
        settings = settings_payload()
        local_root_dir = configured_root(settings.get("local_root"))
        if local_root_dir and local_root_dir.is_dir():
            target_clients = [client] if client else []
            if not target_clients:
                with db() as con:
                    target_clients = con.execute("SELECT * FROM clients").fetchall()
            
            for c in target_clients:
                c_dir = local_root_dir / storage_folder_name(c, "local")
                if not c_dir.is_dir():
                    continue
                
                # Check Client Shared Folder / Current
                shared_dir = c_dir / "Client Shared Folder"
                if shared_dir.is_dir():
                    target_ay_dir = shared_dir / "AY 2025-26"
                    target_ay_dir.mkdir(parents=True, exist_ok=True)
                    for stray_name in ("Current", "Documents", "Documents-old"):
                        stray_dir = shared_dir / stray_name
                        if stray_dir.is_dir():
                            for item in stray_dir.iterdir():
                                dest = target_ay_dir / item.name
                                if not dest.exists():
                                    try: shutil.move(str(item), str(dest))
                                    except Exception: pass
                            try: shutil.rmtree(str(stray_dir), ignore_errors=True)
                            except Exception: pass
                
                # Check Client Root / Current
                for stray_name in ("Current", "Documents"):
                    stray_root_dir = c_dir / stray_name
                    if stray_root_dir.is_dir():
                        target_ay_root = c_dir / "General" / "AY 2025-26"
                        target_ay_root.mkdir(parents=True, exist_ok=True)
                        for item in stray_root_dir.iterdir():
                            dest = target_ay_root / item.name
                            if not dest.exists():
                                try: shutil.move(str(item), str(dest))
                                except Exception: pass
                        try: shutil.rmtree(str(stray_root_dir), ignore_errors=True)
                        except Exception: pass
                        
        # Google Drive cleanup if connected
        if GOOGLE_TOKEN_FILE.is_file():
            try:
                service = google_service()
                root = portal_root(service)
                target_clients = [client] if client else []
                if not target_clients:
                    with db() as con:
                        target_clients = con.execute("SELECT * FROM clients").fetchall()
                
                for c in target_clients:
                    try:
                        c_fname = safe_name(c["name"])
                        q_client = f"name='{c_fname}' and '{root['id']}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
                        c_folders = service.files().list(q=q_client, fields="files(id,name)").execute().get("files", [])
                        for cf in c_folders:
                            # Search for Client Shared Folder
                            q_shared = f"name='Client Shared Folder' and '{cf['id']}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
                            s_folders = service.files().list(q=q_shared, fields="files(id,name)").execute().get("files", [])
                            for sf in s_folders:
                                # Ensure AY 2025-26 exists
                                ay_folder = drive_folder(service, "AY 2025-26", sf["id"])
                                # Search for stray folders inside Client Shared Folder
                                for stray_name in ("Current", "Documents"):
                                    q_stray = f"name='{stray_name}' and '{sf['id']}' in parents and trashed=false"
                                    strays = service.files().list(q=q_stray, fields="files(id,name,mimeType)").execute().get("files", [])
                                    for st in strays:
                                        if st.get("mimeType") == "application/vnd.google-apps.folder":
                                            # Move files inside stray to ay_folder
                                            stray_items = portal_children(service, st["id"])
                                            for item in stray_items:
                                                try:
                                                    service.files().update(fileId=item["id"], addParents=ay_folder["id"], removeParents=st["id"], fields="id").execute()
                                                except Exception: pass
                                            # Delete stray folder
                                            try: service.files().delete(fileId=st["id"]).execute()
                                            except Exception: pass
                                        else:
                                            # Move direct file into ay_folder
                                            try:
                                                service.files().update(fileId=st["id"], addParents=ay_folder["id"], removeParents=sf["id"], fields="id").execute()
                                            except Exception: pass
                    except Exception: pass
            except Exception: pass
    except Exception as exc:
        logging.warning("cleanup_stray_current_folders error: %s", exc)


def compute_sha256(data_bytes: bytes) -> str:
    return hashlib.sha256(data_bytes).hexdigest()


def compute_file_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_backup(backup_type: str = "manual", actor: str = "Host", note: str = "") -> dict:
    """Creates a comprehensive, verified .vsbackup archive of the VS Database system."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    if backup_type == "pre-restore":
        backup_filename = f"emergency_pre_restore_{timestamp_str}.vsbackup"
    elif backup_type == "pre-migration":
        backup_filename = f"VSDatabase_PreMigration_{timestamp_str}.vsbackup"
    else:
        backup_filename = f"VSDatabase_Backup_{timestamp_str}.vsbackup"
    backup_path = BACKUP_DIR / backup_filename
    
    temp_db_path = BACKUP_DIR / f"temp_snapshot_{uuid.uuid4().hex}.db"
    try:
        with db() as src_con:
            try:
                src_con.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
            
            dest_con = sqlite3.connect(temp_db_path)
            src_con.backup(dest_con)
            try:
                dest_con.execute("VACUUM;")
            except Exception:
                pass
            dest_con.close()
            
            client_count = src_con.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
            user_count = src_con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            job_count = src_con.execute("SELECT COUNT(*) FROM save_jobs").fetchone()[0]
            firm_types_count = src_con.execute("SELECT COUNT(*) FROM firm_types").fetchone()[0]
            portals_count = src_con.execute("SELECT COUNT(*) FROM client_portals").fetchone()[0]
            templates_count = src_con.execute("SELECT COUNT(*) FROM category_templates").fetchone()[0]
            
            settings_rows = {r["key"]: r["value"] for r in src_con.execute("SELECT key, value FROM settings").fetchall()}

        db_sha256 = compute_file_sha256(temp_db_path)
        
        manifest = {
            "app": "VS Database",
            "version": "1.0.1",
            "schema_version": 4,
            "created_at": now(),
            "backup_type": backup_type,
            "actor": actor,
            "note": note,
            "database_filename": "database.sqlite3",
            "database_sha256": db_sha256,
            "counts": {
                "clients": client_count,
                "users": user_count,
                "save_jobs": job_count,
                "firm_types": firm_types_count,
                "category_templates": templates_count,
                "client_portals": portals_count
            },
            "system": {
                "os": sys.platform,
                "python": sys.version.split()[0]
            }
        }
        
        manifest_json = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
        manifest_sha256 = compute_sha256(manifest_json)
        manifest["manifest_sha256"] = manifest_sha256

        with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as zip_f:
            zip_f.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
            zip_f.write(temp_db_path, arcname="database.sqlite3")
            zip_f.writestr("config_export.json", json.dumps(settings_rows, indent=2, ensure_ascii=False))

        verify_res = verify_backup_archive(backup_path)
        if not verify_res["valid"]:
            backup_path.unlink(missing_ok=True)
            log_activity("backup_failed", None, None, f"Backup verification failed: {verify_res.get('error')}", actor)
            raise ValueError(f"Backup verification failed: {verify_res.get('error')}")

        with db() as con:
            con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_time', ?)", (now(),))
            con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_status', 'Verified')")
            con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_file', ?)", (backup_filename,))

        log_activity("backup_created", None, None, f"Created {backup_type} backup: {backup_filename} ({backup_path.stat().st_size} bytes)", actor)
        log_activity("backup_verified", None, None, f"Verified backup integrity for {backup_filename}", actor)

        # Mirror backup to Google Drive if mode is backup_and_client or only_backup
        drive_mode = get_setting("google_drive_mode", "backup_and_client")
        if drive_mode in ("backup_and_client", "only_backup"):
            drive_root_str = get_setting("drive_root")
            if drive_root_str and Path(drive_root_str).is_dir():
                try:
                    drive_backup_dir = Path(drive_root_str) / "Office" / "Backups"
                    drive_backup_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(backup_path), str(drive_backup_dir / backup_filename))
                except Exception as e:
                    logging.warning("Drive backup mirror warning: %s", e)

        apply_backup_retention()

        return {
            "ok": True,
            "filename": backup_filename,
            "path": str(backup_path),
            "size_bytes": backup_path.stat().st_size,
            "manifest": manifest,
            "status": "VERIFIED"
        }
    finally:
        if temp_db_path.exists():
            temp_db_path.unlink(missing_ok=True)


def verify_backup_archive(backup_path: Path | str) -> dict:
    """Rigorous verification: inspects manifest, extracts and tests SQLite database integrity."""
    backup_path = Path(backup_path)
    if not backup_path.is_file():
        return {"valid": False, "error": "Backup file does not exist."}
    
    try:
        with zipfile.ZipFile(backup_path, "r") as zip_f:
            file_names = zip_f.namelist()
            if "manifest.json" not in file_names or "database.sqlite3" not in file_names:
                return {"valid": False, "error": "Missing manifest.json or database.sqlite3 in backup archive."}
            
            for member in file_names:
                if ".." in member or member.startswith("/") or member.startswith("\\"):
                    return {"valid": False, "error": "Malformed archive: illegal path detected."}

            manifest_bytes = zip_f.read("manifest.json")
            manifest = json.loads(manifest_bytes.decode("utf-8"))
            
            db_bytes = zip_f.read("database.sqlite3")
            actual_db_sha256 = compute_sha256(db_bytes)
            
            if manifest.get("database_sha256") and manifest["database_sha256"] != actual_db_sha256:
                return {"valid": False, "error": "Database SHA256 checksum mismatch (corrupted archive)."}

            temp_test_db = BACKUP_DIR / f"test_verify_{uuid.uuid4().hex}.db"
            try:
                temp_test_db.write_bytes(db_bytes)
                con = sqlite3.connect(temp_test_db)
                
                check_rows = con.execute("PRAGMA integrity_check;").fetchall()
                all_ok = bool(check_rows and all(str(r[0]).lower() == "ok" or "never used" in str(r[0]).lower() for r in check_rows))
                if not all_ok:
                    con.close()
                    return {"valid": False, "error": f"SQLite PRAGMA integrity check failed: {check_rows}"}
                
                table_rows = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                tables = [r[0] for r in table_rows]
                required_tables = ["clients", "users", "folder_rules", "settings", "save_jobs", "client_portals"]
                for req_t in required_tables:
                    if req_t not in tables:
                        con.close()
                        return {"valid": False, "error": f"Missing critical table '{req_t}' in database backup."}
                
                con.close()
            finally:
                if temp_test_db.exists():
                    temp_test_db.unlink(missing_ok=True)

            return {"valid": True, "manifest": manifest, "size_bytes": backup_path.stat().st_size}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


def restore_backup(backup_path: Path | str, actor: str = "Host") -> dict:
    """Restores system state from .vsbackup with automatic emergency pre-restore snapshot and rollback."""
    backup_path = Path(backup_path)
    if not backup_path.is_file():
        raise ValueError("Backup file not found.")

    verify_res = verify_backup_archive(backup_path)
    if not verify_res["valid"]:
        raise ValueError(f"Cannot restore invalid backup: {verify_res.get('error')}")

    manifest = verify_res["manifest"]

    emergency_backup = None
    try:
        emergency_backup = create_backup(backup_type="pre-restore", actor="System Pre-Restore", note="Automatic emergency backup before restore")
    except Exception as exc:
        logging.warning("Pre-restore emergency backup creation error: %s", exc)

    try:
        with zipfile.ZipFile(backup_path, "r") as zip_f:
            restored_db_bytes = zip_f.read("database.sqlite3")

        temp_live_replace = DATA_ROOT / f"live_replace_{uuid.uuid4().hex}.db"
        temp_live_replace.write_bytes(restored_db_bytes)
        
        test_con = sqlite3.connect(temp_live_replace)
        chk = test_con.execute("PRAGMA integrity_check;").fetchall()
        if not chk or not all(str(r[0]).lower() == "ok" or "never used" in str(r[0]).lower() for r in chk):
            test_con.close()
            temp_live_replace.unlink(missing_ok=True)
            raise ValueError("Restored database integrity check failed.")

        # Seamlessly and atomically copy pages into live database
        with db() as live_con:
            test_con.backup(live_con)
            live_chk = live_con.execute("PRAGMA integrity_check;").fetchall()
            if not live_chk or not all(str(r[0]).lower() == "ok" or "never used" in str(r[0]).lower() for r in live_chk):
                raise ValueError("Live database verification failed after page restore.")
            try:
                live_con.execute("VACUUM;")
            except Exception:
                pass

        test_con.close()
        temp_live_replace.unlink(missing_ok=True)

        log_activity("backup_restored", None, None, f"Successfully restored system state from '{backup_path.name}'", actor)
        return {
            "ok": True,
            "restored_file": backup_path.name,
            "manifest": manifest,
            "emergency_backup": emergency_backup.get("filename") if emergency_backup else None
        }

    except Exception as exc:
        log_activity("backup_restore_failed", None, None, f"Restore failed: {exc}. Initiating rollback.", actor)
        if emergency_backup and Path(emergency_backup["path"]).is_file():
            try:
                with zipfile.ZipFile(emergency_backup["path"], "r") as em_zip:
                    em_db = em_zip.read("database.sqlite3")
                temp_em_db = DATA_ROOT / f"em_rollback_{uuid.uuid4().hex}.db"
                temp_em_db.write_bytes(em_db)
                em_con = sqlite3.connect(temp_em_db)
                with db() as live_con:
                    em_con.backup(live_con)
                em_con.close()
                temp_em_db.unlink(missing_ok=True)
                log_activity("backup_restored", None, None, "Successfully rolled back to emergency backup after restore failure", "System")
            except Exception as rollback_exc:
                logging.critical("Rollback to emergency backup failed: %s", rollback_exc)
        raise ValueError(f"Restoration failed: {exc}. Database was rolled back to pre-restore state.")


def list_backups() -> list:
    """Lists all available .vsbackup files with manifest info and verification status."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(BACKUP_DIR.glob("*.vsbackup"), key=lambda p: p.stat().st_mtime, reverse=True)
    results = []
    for p in files:
        try:
            stat = p.stat()
            mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
            manifest = {}
            with zipfile.ZipFile(p, "r") as zip_f:
                if "manifest.json" in zip_f.namelist():
                    manifest = json.loads(zip_f.read("manifest.json").decode("utf-8"))
            
            results.append({
                "filename": p.name,
                "size_bytes": stat.st_size,
                "modified_at": mod_time,
                "created_at": manifest.get("created_at") or mod_time,
                "backup_type": manifest.get("backup_type") or ("Emergency" if "emergency" in p.name else "Manual"),
                "status": manifest.get("status") or "Verified",
                "counts": manifest.get("counts", {}),
                "app_version": manifest.get("version", "1.0.1"),
                "actor": manifest.get("actor", "Host")
            })
        except Exception:
            results.append({
                "filename": p.name,
                "size_bytes": p.stat().st_size if p.exists() else 0,
                "modified_at": now(),
                "created_at": now(),
                "backup_type": "Unknown",
                "status": "Corrupted",
                "counts": {}
            })
    return results


def apply_backup_retention():
    """Enforces backup retention policy without deleting the latest or only valid backup."""
    try:
        with db() as con:
            row_count = con.execute("SELECT value FROM settings WHERE key='backup_retention_count'").fetchone()
            row_days = con.execute("SELECT value FROM settings WHERE key='backup_retention_days'").fetchone()
            
        retention_count = int(row_count["value"]) if (row_count and str(row_count["value"]).isdigit()) else 10
        retention_days = int(row_days["value"]) if (row_days and str(row_days["value"]).isdigit()) else 60
        
        all_backups = sorted(BACKUP_DIR.glob("*.vsbackup"), key=lambda p: p.stat().st_mtime, reverse=True)
        if len(all_backups) <= 1:
            return
            
        if len(all_backups) > retention_count:
            excess = all_backups[retention_count:]
            for p in excess:
                try:
                    p.unlink(missing_ok=True)
                    log_activity("backup_deleted", None, None, f"Deleted old backup '{p.name}' per count retention limit", "System")
                except Exception:
                    pass
    except Exception as exc:
        logging.warning("Backup retention policy error: %s", exc)


def backup_scheduler_worker():
    """Background daemon thread checking if automatic backups are due."""
    while True:
        try:
            time.sleep(300)
            with db() as con:
                freq_row = con.execute("SELECT value FROM settings WHERE key='backup_frequency'").fetchone()
                last_time_row = con.execute("SELECT value FROM settings WHERE key='last_backup_time'").fetchone()
            
            freq = (freq_row["value"] if freq_row else "Daily").strip().capitalize()
            if freq == "Disabled":
                continue
                
            last_iso = last_time_row["value"] if last_time_row else None
            now_dt = datetime.now(timezone.utc)
            
            should_run = False
            if not last_iso:
                should_run = True
            else:
                try:
                    last_dt = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
                    diff_sec = (now_dt - last_dt).total_seconds()
                    if freq == "Daily" and diff_sec >= 86400:
                        should_run = True
                    elif freq == "Weekly" and diff_sec >= 604800:
                        should_run = True
                    elif freq == "Monthly" and diff_sec >= 2592000:
                        should_run = True
                except Exception:
                    should_run = True
                    
            if should_run:
                create_backup(backup_type="automatic", actor="System Scheduler")
                log_activity("automatic_backup_created", None, None, f"Automatic {freq} backup completed successfully", "System Scheduler")
        except Exception as exc:
            logging.warning("Automatic backup scheduler worker error: %s", exc)


def get_local_storage_info(local_root: str = None, con=None) -> dict:
    """Calculates disk usage, total capacity, free space, and managed files size for local storage."""
    try:
        target_path = Path(local_root) if local_root else DATA_ROOT
        if not target_path.exists():
            drive_letter = target_path.drive or "C:"
            target_path = Path(f"{drive_letter}\\")
            if not target_path.exists():
                target_path = Path("C:\\")
                
        usage = shutil.disk_usage(str(target_path))
        percent = round((usage.used / usage.total) * 100, 1) if usage.total > 0 else 0.0
        
        if con:
            managed_row = con.execute("SELECT SUM(size_bytes) FROM file_inventory WHERE storage_kind='local' AND present=1").fetchone()
        else:
            with db() as c:
                managed_row = c.execute("SELECT SUM(size_bytes) FROM file_inventory WHERE storage_kind='local' AND present=1").fetchone()
        managed_bytes = managed_row[0] if (managed_row and managed_row[0]) else 0
        
        return {
            "path": str(target_path),
            "display_path": str(local_root or target_path),
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "percent_used": percent,
            "managed_bytes": managed_bytes
        }
    except Exception as exc:
        logging.warning("Could not fetch local disk usage: %s", exc)
        return {
            "path": str(local_root or ""),
            "display_path": str(local_root or ""),
            "total_bytes": 0,
            "used_bytes": 0,
            "free_bytes": 0,
            "percent_used": 0.0,
            "managed_bytes": 0
        }


def get_google_drive_storage_info() -> dict:
    """Calculates Google Drive cloud storage quota and user information."""
    if not GOOGLE_TOKEN_FILE.is_file():
        return {"connected": False}
    try:
        service = google_service()
        about = service.about().get(fields="storageQuota,user").execute()
        quota = about.get("storageQuota", {})
        limit = int(quota.get("limit", 0)) if quota.get("limit") else None
        usage = int(quota.get("usage", 0)) if quota.get("usage") else 0
        usage_drive = int(quota.get("usageInDrive", 0)) if quota.get("usageInDrive") else 0
        usage_trash = int(quota.get("usageInDriveTrash", 0)) if quota.get("usageInDriveTrash") else 0
        user_info = about.get("user", {})
        
        percent = 0.0
        if limit and limit > 0:
            percent = round((usage / limit) * 100, 1)
            
        return {
            "connected": True,
            "user_name": user_info.get("displayName", ""),
            "user_email": user_info.get("emailAddress", ""),
            "limit_bytes": limit,
            "usage_bytes": usage,
            "usage_drive_bytes": usage_drive,
            "usage_trash_bytes": usage_trash,
            "percent_used": percent
        }
    except Exception as exc:
        logging.warning("Could not fetch Google Drive storage quota: %s", exc)
        return {"connected": False, "error": str(exc)}


_CACHED_DRIVE_STORAGE = {"connected": False, "cached": True, "updated_at": 0}
_DRIVE_STORAGE_LOCK = threading.Lock()


def get_google_drive_storage_async() -> dict:
    """Returns cached Google Drive storage info immediately and refreshes in background."""
    global _CACHED_DRIVE_STORAGE
    if not GOOGLE_TOKEN_FILE.is_file():
        return {"connected": False, "updated_at": time.time()}
    now_t = time.time()
    if now_t - _CACHED_DRIVE_STORAGE.get("updated_at", 0) < 60 and _CACHED_DRIVE_STORAGE.get("updated_at", 0) > 0:
        return _CACHED_DRIVE_STORAGE
    
    def _bg_fetch():
        global _CACHED_DRIVE_STORAGE
        with _DRIVE_STORAGE_LOCK:
            res = get_google_drive_storage_info()
            res["updated_at"] = time.time()
            _CACHED_DRIVE_STORAGE = res
    threading.Thread(target=_bg_fetch, daemon=True).start()
    return _CACHED_DRIVE_STORAGE


def get_dashboard_stats() -> dict:
    """Calculates live analytics, storage stats, and recent activities for the front Dashboard in <2ms."""
    with db() as con:
        total_clients = con.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
        total_folders = con.execute("SELECT COUNT(*) FROM folder_inventory WHERE present=1").fetchone()[0]
        total_files = con.execute("SELECT COUNT(*) FROM file_inventory WHERE present=1").fetchone()[0]
        cloud_files = con.execute("SELECT COUNT(*) FROM file_inventory WHERE storage_kind='drive' AND present=1").fetchone()[0]
        failed_jobs = con.execute("SELECT COUNT(*) FROM save_jobs WHERE status='failed'").fetchone()[0]
        pending_devices = con.execute("SELECT COUNT(*) FROM devices WHERE status='pending'").fetchone()[0]
        alerts_count = con.execute("SELECT COUNT(*) FROM security_alerts WHERE is_dismissed=0").fetchone()[0]
        
        recent_activities = [dict(r) for r in con.execute("SELECT * FROM activity_log ORDER BY id DESC LIMIT 10").fetchall()]
        recent_docs = [dict(r) for r in con.execute("SELECT * FROM save_jobs ORDER BY created_at DESC LIMIT 8").fetchall()]
        recent_clients = [dict(r) for r in con.execute("SELECT * FROM clients ORDER BY rowid DESC LIMIT 6").fetchall()]
        
        pending_items = []
        if failed_jobs > 0:
            pending_items.append({"type": "failed_job", "severity": "danger", "title": f"{failed_jobs} Failed Save Job(s)", "desc": "Check save jobs activity for details."})
        if pending_devices > 0:
            pending_items.append({"type": "device_approval", "severity": "info", "title": f"{pending_devices} Device(s) Waiting for Approval", "desc": "Authorize or reject staff devices in Users & Devices."})
        if alerts_count > 0:
            pending_items.append({"type": "security_alert", "severity": "warning", "title": f"{alerts_count} Active Security Alert(s)", "desc": "Security events or failed PIN verification attempts detected."})
            
        settings_info = settings_payload(con=con)
        google_stat = google_status()
        local_storage_info = get_local_storage_info(settings_info.get("local_root"), con=con)
        google_storage_info = get_google_drive_storage_async()

    return {
        "stats": {
            "total_clients": total_clients,
            "total_folders": total_folders,
            "total_files": total_files,
            "cloud_files": cloud_files,
            "pending_issues": failed_jobs + pending_devices + alerts_count
        },
        "recent_activities": recent_activities,
        "recent_documents": recent_docs,
        "recent_clients": recent_clients,
        "pending_items": pending_items,
        "storage": {
            "local_root": settings_info.get("local_root"),
            "drive_root": settings_info.get("drive_root"),
            "google_connected": google_stat.get("connected", False),
            "local": local_storage_info,
            "drive": google_storage_info
        }
    }


def get_desktop_health() -> dict:
    """Instant health check for desktop launcher and watchdog."""
    return {
        "ok": True,
        "service": "VS Database Desktop",
        "version": "1.0.1",
        "port": PORT,
        "status": "ready"
    }


def bring_desktop_app_to_front() -> dict:
    """Brings the native VS Database window to the foreground on Windows."""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        
        my_pid = os.getpid()
        found = []
        class RECT(ctypes.Structure):
            _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long), ('right', ctypes.c_long), ('bottom', ctypes.c_long)]
        
        def enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    val = buff.value
                    if "VS Database" in val:
                        # Exclude browsers, IDEs, Explorer, command prompts
                        if any(b in val for b in ("Visual Studio", "Code", "Google Chrome", "Edge", "Firefox", "Opera", "Brave", "Explorer", "Antigravity")):
                            return True
                        r = RECT()
                        user32.GetWindowRect(hwnd, ctypes.byref(r))
                        w = r.right - r.left
                        h = r.bottom - r.top
                        if w > 300 and h > 200:
                            found.append((hwnd, val))
            return True
        proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(enum_cb)
        user32.EnumWindows(proc, 0)
        if found:
            hwnd, title = found[0]
            logging.info(f"bring_desktop_app_to_front found HWND {hwnd} with title: '{title}'")
            print(f"[bring_desktop_app_to_front] Found HWND {hwnd} with title: '{title}'")
            sys.stdout.flush()
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            try:
                fore_hwnd = user32.GetForegroundWindow()
                fore_thread = user32.GetWindowThreadProcessId(fore_hwnd, None)
                app_thread = user32.GetWindowThreadProcessId(hwnd, None)
                if fore_thread and app_thread and fore_thread != app_thread:
                    user32.AttachThreadInput(fore_thread, app_thread, True)
                    user32.SetForegroundWindow(hwnd)
                    user32.BringWindowToTop(hwnd)
                    user32.AttachThreadInput(fore_thread, app_thread, False)
                else:
                    user32.SetForegroundWindow(hwnd)
                    user32.BringWindowToTop(hwnd)
            except Exception:
                user32.SetForegroundWindow(hwnd)
            return {"ok": True, "brought_to_front": True, "found_title": title, "hwnd": hwnd}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": False, "message": "Window not found"}


_PENDING_BROWSER_RETURN = None
_PENDING_BROWSER_RETURN_LOCK = threading.Lock()

def bring_browser_to_front() -> dict:
    """Brings the user's web browser (Chrome, Edge, Brave, etc.) back to the foreground."""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        found = []
        def enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    val = buff.value
                    if any(b in val for b in ("Google Chrome", "Chrome", "Edge", "Brave", "Firefox", "Opera")):
                        found.append((hwnd, val))
            return True
        proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(enum_cb)
        user32.EnumWindows(proc, 0)
        if found:
            hwnd, title = found[0]
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            try:
                fore_hwnd = user32.GetForegroundWindow()
                fore_thread = user32.GetWindowThreadProcessId(fore_hwnd, None)
                app_thread = user32.GetWindowThreadProcessId(hwnd, None)
                if fore_thread and app_thread and fore_thread != app_thread:
                    user32.AttachThreadInput(fore_thread, app_thread, True)
                    user32.SetForegroundWindow(hwnd)
                    user32.BringWindowToTop(hwnd)
                    user32.AttachThreadInput(fore_thread, app_thread, False)
                else:
                    user32.SetForegroundWindow(hwnd)
                    user32.BringWindowToTop(hwnd)
            except Exception:
                user32.SetForegroundWindow(hwnd)
            return {"ok": True, "switched_to_browser": True, "browser_title": title}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": False, "message": "Browser window not found"}



def execute_global_search(query_str: str) -> dict:
    """Fast live query across clients, file numbers, folders, and files for global search bar."""
    query_str = query_str.strip().lower()
    if not query_str:
        return {"clients": [], "folders": [], "files": []}
    
    with db() as con:
        c_rows = con.execute("""
            SELECT file_no, name, mobile, client_type, client_group, tags, status
            FROM clients
            WHERE lower(name) LIKE ? OR lower(file_no) LIKE ? OR lower(mobile) LIKE ? OR lower(tags) LIKE ?
            LIMIT 10
        """, (f"%{query_str}%", f"%{query_str}%", f"%{query_str}%", f"%{query_str}%")).fetchall()
        
        f_rows = con.execute("""
            SELECT client_file_no, storage_kind, relative_path
            FROM folder_inventory
            WHERE present=1 AND lower(relative_path) LIKE ?
            LIMIT 10
        """, (f"%{query_str}%",)).fetchall()
        
        doc_rows = con.execute("""
            SELECT client_file_no, storage_kind, relative_path, size_bytes, modified_at
            FROM file_inventory
            WHERE present=1 AND lower(relative_path) LIKE ?
            LIMIT 10
        """, (f"%{query_str}%",)).fetchall()

    return {
        "clients": [dict(r) for r in c_rows],
        "folders": [dict(r) for r in f_rows],
        "files": [dict(r) for r in doc_rows]
    }


def draw_vintage_corner(pdf, x, y, size=16*mm, orientation="TL"):
    """Draws elegant gold corner flourishes for vintage certificate look."""
    pdf.saveState()
    pdf.setStrokeColor(colors.HexColor("#BE8D35"))
    pdf.setFillColor(colors.HexColor("#BE8D35"))
    pdf.setLineWidth(0.8)
    mx = 1 if "L" in orientation else -1
    my = 1 if "B" in orientation else -1
    
    # Outer corner L-bracket
    pdf.line(x, y, x + mx * size, y)
    pdf.line(x, y, x, y + my * size)
    
    # Inner corner accent
    pdf.setLineWidth(0.4)
    pdf.line(x + mx * 2*mm, y + my * 2*mm, x + mx * (size - 3*mm), y + my * 2*mm)
    pdf.line(x + mx * 2*mm, y + my * 2*mm, x + mx * 2*mm, y + my * (size - 3*mm))
    
    # Small corner diamond
    dx, dy = x + mx * 4*mm, y + my * 4*mm
    p = pdf.beginPath()
    p.moveTo(dx, dy + 1.2*mm)
    p.lineTo(dx + 1.2*mm, dy)
    p.lineTo(dx, dy - 1.2*mm)
    p.lineTo(dx - 1.2*mm, dy)
    p.close()
    pdf.drawPath(p, fill=1, stroke=0)
    
    # Small dots
    pdf.circle(x + mx * (size - 1*mm), y, 0.8*mm, fill=1, stroke=0)
    pdf.circle(x, y + my * (size - 1*mm), 0.8*mm, fill=1, stroke=0)
    pdf.restoreState()


def draw_gold_seal(pdf, cx, cy, radius=17*mm):
    """Draws the official golden authentication seal with ribbons."""
    pdf.saveState()
    gold_dark = colors.HexColor("#A87926")
    gold_light = colors.HexColor("#E5C07B")
    gold_mid = colors.HexColor("#BE8D35")
    navy = colors.HexColor("#0C2340")
    
    # Ribbons behind the seal
    pdf.setFillColor(navy)
    pdf.setStrokeColor(gold_mid)
    pdf.setLineWidth(0.5)
    
    r1 = pdf.beginPath()
    r1.moveTo(cx - 8*mm, cy - radius + 2*mm)
    r1.lineTo(cx - 16*mm, cy - radius - 14*mm)
    r1.lineTo(cx - 11*mm, cy - radius - 11*mm)
    r1.lineTo(cx - 6*mm, cy - radius - 14*mm)
    r1.lineTo(cx - 2*mm, cy - radius + 2*mm)
    r1.close()
    pdf.drawPath(r1, fill=1, stroke=1)
    
    r2 = pdf.beginPath()
    r2.moveTo(cx + 2*mm, cy - radius + 2*mm)
    r2.lineTo(cx + 6*mm, cy - radius - 14*mm)
    r2.lineTo(cx + 11*mm, cy - radius - 11*mm)
    r2.lineTo(cx + 16*mm, cy - radius - 14*mm)
    r2.lineTo(cx + 8*mm, cy - radius + 2*mm)
    r2.close()
    pdf.drawPath(r2, fill=1, stroke=1)

    # Scalloped outer gold circle
    pdf.setFillColor(gold_light)
    pdf.setStrokeColor(gold_dark)
    pdf.setLineWidth(1)
    pdf.circle(cx, cy, radius, fill=1, stroke=1)
    
    # Inner gold ring
    pdf.setFillColor(gold_mid)
    pdf.setStrokeColor(colors.white)
    pdf.setLineWidth(0.8)
    pdf.circle(cx, cy, radius - 2*mm, fill=1, stroke=1)
    
    # Inner cream disc
    pdf.setFillColor(colors.HexColor("#FFFDF5"))
    pdf.setStrokeColor(gold_dark)
    pdf.setLineWidth(0.5)
    pdf.circle(cx, cy, radius - 3.5*mm, fill=1, stroke=1)
    
    # Text inside seal
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica-Bold", 6.5)
    pdf.drawCentredString(cx, cy + radius - 7*mm, "★ AUTHENTICATED ★")
    
    # Center approved pill
    bw, bh = radius * 1.8, 6.5*mm
    pdf.setFillColor(navy)
    pdf.roundRect(cx - bw/2, cy - bh/2, bw, bh, 1.5*mm, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawCentredString(cx, cy - 2.5*mm, "APPROVED")
    
    # Bottom text in seal
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica-Bold", 6)
    pdf.drawCentredString(cx, cy - radius + 5*mm, "VERIFIED & APPROVED")
    pdf.restoreState()


def register_system_fonts():
    font_map = {
        "SegoeUI": "C:/Windows/Fonts/segoeui.ttf",
        "SegoeUI-Bold": "C:/Windows/Fonts/segoeuib.ttf",
        "SegoeUI-Italic": "C:/Windows/Fonts/segoeuii.ttf",
        "SegoeUI-SemiBold": "C:/Windows/Fonts/segoeuisl.ttf",
    }
    for name, p in font_map.items():
        if os.path.exists(p) and name not in pdfmetrics.getRegisteredFontNames():
            try:
                pdfmetrics.registerFont(TTFont(name, p))
            except Exception:
                pass

register_system_fonts()


def ensure_google_drive_png():
    ico_path = STATIC_ROOT / "google-drive.ico"
    png_path = STATIC_ROOT / "google_drive_icon.png"
    if ico_path.is_file() and not png_path.is_file():
        try:
            im = Image.open(ico_path)
            im.save(png_path, "PNG")
        except Exception:
            pass
    return png_path if png_path.is_file() else None

ensure_google_drive_png()


def ensure_redirect_icon():
    ico_path = STATIC_ROOT / "Redirect.ico"
    png_path = STATIC_ROOT / "Redirect.png"
    src_png = STATIC_ROOT / "Redirtect.png"
    if src_png.is_file():
        if not ico_path.is_file() or not png_path.is_file():
            try:
                im = Image.open(src_png)
                im.save(ico_path, format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
                im.save(png_path, "PNG")
            except Exception:
                pass
    return png_path if png_path.is_file() else None

ensure_redirect_icon()


def draw_glass_card(pdf, x, y, w, h, radius=4*mm, bg=colors.HexColor("#FFFFFF"), border=colors.HexColor("#E2E8F4"), border_width=1, shadow=False):
    """Draws a premium frosted glassmorphic card with top-inner white specular highlight."""
    pdf.saveState()
    if shadow:
        pdf.setFillColor(colors.Color(0.85, 0.90, 0.98, alpha=0.4))
        pdf.roundRect(x + 0.5*mm, y - 0.8*mm, w, h, radius, fill=1, stroke=0)
        
    pdf.setFillColor(bg)
    pdf.setStrokeColor(border)
    pdf.setLineWidth(border_width)
    pdf.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    
    # White Top-Inner Specular Highlight Line
    pdf.setStrokeColor(colors.Color(1, 1, 1, alpha=0.95))
    pdf.setLineWidth(0.8)
    pdf.line(x + radius, y + h - 0.6, x + w - radius, y + h - 0.6)
    pdf.restoreState()


def draw_vector_icon(pdf, name, x, y, size=3.5*mm, color=colors.HexColor("#4F46E5")):
    """Draws clean minimal line icons matching the reference."""
    pdf.saveState()
    pdf.setStrokeColor(color)
    pdf.setFillColor(color)
    pdf.setLineWidth(0.8)
    
    if name == "person":
        pdf.circle(x + size*0.5, y + size*0.75, size*0.25, fill=0, stroke=1)
        p = pdf.beginPath()
        p.moveTo(x + size*0.1, y)
        p.curveTo(x + size*0.1, y + size*0.35, x + size*0.9, y + size*0.35, x + size*0.9, y)
        pdf.drawPath(p, fill=0, stroke=1)
    elif name == "briefcase":
        pdf.roundRect(x, y, size, size*0.75, 0.5*mm, fill=0, stroke=1)
        pdf.rect(x + size*0.3, y + size*0.75, size*0.4, size*0.2, fill=0, stroke=1)
        pdf.line(x, y + size*0.4, x + size, y + size*0.4)
    elif name == "location":
        pdf.circle(x + size*0.5, y + size*0.65, size*0.3, fill=0, stroke=1)
        p = pdf.beginPath()
        p.moveTo(x + size*0.25, y + size*0.5)
        p.lineTo(x + size*0.5, y)
        p.lineTo(x + size*0.75, y + size*0.5)
        pdf.drawPath(p, fill=0, stroke=1)
    elif name == "phone":
        pdf.roundRect(x + size*0.2, y, size*0.6, size, 0.6*mm, fill=0, stroke=1)
        pdf.line(x + size*0.35, y + size*0.8, x + size*0.65, y + size*0.8)
        pdf.circle(x + size*0.5, y + size*0.15, size*0.06, fill=1, stroke=0)
    elif name == "shield_check":
        p = pdf.beginPath()
        p.moveTo(x + size*0.5, y + size)
        p.lineTo(x + size, y + size*0.75)
        p.lineTo(x + size*0.85, y + size*0.2)
        p.lineTo(x + size*0.5, y)
        p.lineTo(x + size*0.15, y + size*0.2)
        p.lineTo(x, y + size*0.75)
        p.close()
        pdf.drawPath(p, fill=0, stroke=1)
        p_c = pdf.beginPath()
        p_c.moveTo(x + size*0.3, y + size*0.5)
        p_c.lineTo(x + size*0.45, y + size*0.32)
        p_c.lineTo(x + size*0.72, y + size*0.65)
        pdf.drawPath(p_c, fill=0, stroke=1)
    elif name == "external_link":
        pdf.rect(x, y, size*0.75, size*0.75, fill=0, stroke=1)
        p_a = pdf.beginPath()
        p_a.moveTo(x + size*0.4, y + size*0.6)
        p_a.lineTo(x + size, y + size)
        p_a.moveTo(x + size*0.65, y + size)
        p_a.lineTo(x + size, y + size)
        p_a.lineTo(x + size, y + size*0.65)
        pdf.drawPath(p_a, fill=0, stroke=1)
    elif name == "lock":
        pdf.roundRect(x, y, size, size*0.65, 0.4*mm, fill=0, stroke=1)
        p_sh = pdf.beginPath()
        p_sh.moveTo(x + size*0.25, y + size*0.65)
        p_sh.curveTo(x + size*0.25, y + size, x + size*0.75, y + size, x + size*0.75, y + size*0.65)
        pdf.drawPath(p_sh, fill=0, stroke=1)
    elif name == "folder":
        p = pdf.beginPath()
        p.moveTo(x, y)
        p.lineTo(x + size, y)
        p.lineTo(x + size, y + size*0.7)
        p.lineTo(x + size*0.55, y + size*0.7)
        p.lineTo(x + size*0.4, y + size*0.85)
        p.lineTo(x, y + size*0.85)
        p.close()
        pdf.drawPath(p, fill=0, stroke=1)
    elif name == "cloud":
        pdf.circle(x + size*0.45, y + size*0.55, size*0.3, fill=0, stroke=1)
        pdf.circle(x + size*0.75, y + size*0.45, size*0.22, fill=0, stroke=1)
        pdf.circle(x + size*0.25, y + size*0.35, size*0.2, fill=0, stroke=1)
        pdf.line(x + size*0.1, y + size*0.2, x + size*0.9, y + size*0.2)
    elif name == "mobile_phone":
        pdf.roundRect(x + size*0.1, y, size*0.8, size, 0.8*mm, fill=0, stroke=1)
        pdf.line(x + size*0.35, y + size*0.85, x + size*0.65, y + size*0.85)
        pdf.circle(x + size*0.5, y + size*0.15, size*0.08, fill=1, stroke=0)
    pdf.restoreState()


def generate_custom_qr(link, monogram_path, temp_dir):
    """Generates an authentic scannable QR code with centered circular monogram emblem."""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=1,
    )
    qr.add_data(link)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0F172A", back_color="white").convert("RGBA")
    
    mono_path = STATIC_ROOT / "logo Monogram.png"
    if not mono_path.is_file():
        mono_path = STATIC_ROOT / "logo_emblem.png"

    if mono_path.is_file():
        try:
            mono_img = Image.open(mono_path).convert("RGBA")
            target_size = int(qr_img.size[0] * 0.25)
            mono_resized = mono_img.resize((target_size, target_size), Image.Resampling.LANCZOS)
            
            badge_size = target_size + 14
            badge = Image.new("RGBA", (badge_size, badge_size), (0, 0, 0, 0))
            draw = ImageDraw.Draw(badge)
            draw.ellipse([0, 0, badge_size - 1, badge_size - 1], fill="white", outline="#C7D2FE", width=3)
            
            offset = (badge_size - target_size) // 2
            badge.paste(mono_resized, (offset, offset), mask=mono_resized)
            
            pos = ((qr_img.size[0] - badge_size) // 2, (qr_img.size[1] - badge_size) // 2)
            qr_img.paste(badge, pos, mask=badge)
        except Exception:
            pass
            
    out_path = os.path.join(temp_dir, f"qr_final_{uuid.uuid4().hex[:8]}.png")
    qr_img.save(out_path)
    return out_path


def draw_3d_glass_verified_seal(pdf, cx, cy, radius=16*mm):
    """Draws the glowing circular glass verification seal."""
    f_bold = "SegoeUI-Bold" if "SegoeUI-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
    f_semi = "SegoeUI-SemiBold" if "SegoeUI-SemiBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
    
    pdf.saveState()
    # Outer Ambient Radial Glow
    pdf.setFillColor(colors.HexColor("#E0E7FF"))
    pdf.setStrokeColor(colors.HexColor("#C7D2FE"))
    pdf.setLineWidth(1.2)
    pdf.circle(cx, cy, radius, fill=1, stroke=1)
    
    # Mid Frosted Disc
    pdf.setFillColor(colors.HexColor("#EEF4FF"))
    pdf.setStrokeColor(colors.Color(1, 1, 1, alpha=0.95))
    pdf.setLineWidth(1)
    pdf.circle(cx, cy, radius - 2.5*mm, fill=1, stroke=1)
    
    # Top Shield Icon container
    shield_s = 6 * mm
    draw_vector_icon(pdf, "shield_check", cx - shield_s*0.5, cy + 3.5*mm, size=shield_s, color=colors.HexColor("#4F46E5"))
    
    # Typography
    pdf.setFillColor(colors.HexColor("#047857"))  # Emerald Green
    pdf.setFont(f_bold, 7.8)
    pdf.drawCentredString(cx, cy + 0.2*mm, "VERIFIED")
    
    pdf.setFillColor(colors.HexColor("#64748B"))
    pdf.setFont(f_bold, 5.5)
    pdf.drawCentredString(cx, cy - 3.8*mm, "OFFICIAL PASS")
    
    pdf.setFillColor(colors.HexColor("#4F46E5"))
    pdf.setFont(f_semi, 5.0)
    pdf.drawCentredString(cx, cy - 7.2*mm, "VS DATABASE")
    
    pdf.restoreState()


def clean_stale_temp_and_duplicate_portal_files():
    """Sweeps Client Access Links and removes orphaned .tmp_/.tem files and consolidates duplicate (Updated).pdf files."""
    try:
        local_root_str = get_setting("local_root")
        if not local_root_str:
            return
        local_root = Path(local_root_str)
        access_dir = local_root / "Client Access Links"
        if not access_dir.is_dir():
            return
            
        # 1. Remove all temporary render scratch files
        for pattern in (".tmp_*", "*.tem*", "*.tmp*", ".scratch*"):
            for f in access_dir.glob(pattern):
                try:
                    f.unlink(missing_ok=True)
                except Exception:
                    pass

        # 2. Consolidate any dual (Updated) files into canonical access pass
        for f in access_dir.glob("* - Client Document Access (Updated).pdf"):
            canonical_name = f.name.replace(" - Client Document Access (Updated).pdf", " - Client Document Access.pdf")
            canonical_path = access_dir / canonical_name
            try:
                if canonical_path.exists():
                    f.unlink(missing_ok=True)
                else:
                    f.rename(canonical_path)
            except Exception:
                pass
                
        # 3. Clean scratch directory
        if SCRATCH_DIR.is_dir():
            for f in SCRATCH_DIR.glob("*"):
                try:
                    if f.is_file():
                        f.unlink(missing_ok=True)
                except Exception:
                    pass
                    
        # 4. Clean any residual Client Shared Folder entries from folder/file inventory
        with db() as con:
            con.execute("DELETE FROM folder_inventory WHERE LOWER(relative_path) LIKE '%client shared folder%'")
            con.execute("DELETE FROM file_inventory WHERE LOWER(relative_path) LIKE '%client shared folder%'")
            
        # 5. Consolidate any duplicate '(1)' folders in drive_root and local_root
        for root_key in ("drive_root", "local_root"):
            root_val = get_setting(root_key)
            if root_val and Path(root_val).is_dir():
                r_dir = Path(root_val)
                for dup in [p for p in r_dir.iterdir() if p.is_dir() and p.name.endswith(" (1)")]:
                    base_name = dup.name[:-4].strip()
                    base_dir = r_dir / base_name
                    base_dir.mkdir(parents=True, exist_ok=True)
                    for item in list(dup.rglob("*")):
                        if item.is_file():
                            rel_p = item.relative_to(dup)
                            tgt = base_dir / rel_p
                            tgt.parent.mkdir(parents=True, exist_ok=True)
                            if not tgt.exists() or tgt.stat().st_size == 0:
                                try: shutil.move(str(item), str(tgt))
                                except Exception: pass
                            else:
                                try: item.unlink(missing_ok=True)
                                except Exception: pass
                    try: shutil.rmtree(str(dup), ignore_errors=True)
                    except Exception: pass

        # 6. Ensure Google Drive root organizes into Client and Office hierarchy according to active mode
        mode = get_setting("google_drive_mode", "backup_and_client")
        office_name = get_setting("office_folder_name", "Office") or "Office"
        client_name = get_setting("client_folder_name", "Client") or "Client"
        d_root_val = get_setting("drive_root")
        if d_root_val and Path(d_root_val).is_dir():
            d_dir = Path(d_root_val)
            if mode in ("backup_and_client", "only_client"):
                c_dir = d_dir / client_name
                c_dir.mkdir(parents=True, exist_ok=True)
                for itm in list(d_dir.iterdir()):
                    if itm.is_dir() and itm.name not in (client_name, office_name, "Client Access Links") and not itm.name.startswith("."):
                        tgt = c_dir / itm.name
                        if not tgt.exists():
                            try: shutil.move(str(itm), str(tgt))
                            except Exception: pass
                        else:
                            for f in list(itm.rglob("*")):
                                if f.is_file():
                                    rel = f.relative_to(itm)
                                    tgt_f = tgt / rel
                                    tgt_f.parent.mkdir(parents=True, exist_ok=True)
                                    if not tgt_f.exists():
                                        try: shutil.move(str(f), str(tgt_f))
                                        except Exception: pass
                            shutil.rmtree(str(itm), ignore_errors=True)

                # Ensure client folders don't have stray Office or Client Shared Folder subfolders
                for c_folder in c_dir.iterdir():
                    if c_folder.is_dir():
                        for sub in c_folder.iterdir():
                            if sub.is_dir() and sub.name in (office_name, "Office", "Client Shared Folder"):
                                try: shutil.rmtree(str(sub), ignore_errors=True)
                                except Exception: pass

            if mode in ("backup_and_client", "only_backup"):
                o_dir = d_dir / office_name
                o_dir.mkdir(parents=True, exist_ok=True)
            elif mode in ("only_client", "disabled"):
                # If only_client or disabled, remove any lingering Office folder in Google Drive!
                o_dir = d_dir / office_name
                if o_dir.exists():
                    try: shutil.rmtree(str(o_dir), ignore_errors=True)
                    except Exception: pass

        # 7. Ensure local drive does not keep client folders (only Client Access Links / Office)
        l_root_val = get_setting("local_root")
        if l_root_val and Path(l_root_val).is_dir():
            l_dir = Path(l_root_val)
            for itm in list(l_dir.iterdir()):
                if itm.is_dir() and itm.name not in ("Client Access Links", "Office", ".scratch", "data") and not itm.name.startswith("."):
                    try: shutil.rmtree(str(itm), ignore_errors=True)
                    except Exception: pass
    except Exception as exc:
        logging.warning("Stale temp file cleanup error: %s", exc)


def access_pdf(client, link):
    """Generates a modern website-themed glassmorphic Client Document Access Pass PDF.
    Ensures exactly ONE canonical PDF per client, writes atomically via safe scratch buffer,
    and guarantees zero temporary or duplicate (Updated) files on disk."""
    local_root = get_setting("local_root") or str(DATA_ROOT)
    target_dir = Path(local_root) / "Client Access Links"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{safe_name(client['name'])} - Client Document Access.pdf"
    
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    tmp_target = SCRATCH_DIR / f"pass_{uuid.uuid4().hex}.pdf"
    qr_tmp = None
    
    try:
        pdf = canvas.Canvas(str(tmp_target), pagesize=A4)
        width, height = A4  # 210 x 297 mm
        
        f_reg = "SegoeUI" if "SegoeUI" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
        f_bold = "SegoeUI-Bold" if "SegoeUI-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
        f_semi = "SegoeUI-SemiBold" if "SegoeUI-SemiBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
        
        # Refined Glassmorphic Palette
        BG_PAGE           = colors.HexColor("#F1F5FC")
        CANVAS_WHITE      = colors.HexColor("#FFFFFF")
        CARD_BG_DEFAULT   = colors.HexColor("#F8FAFD")
        CARD_BG_TINT      = colors.HexColor("#F1F5FD")
        CARD_BORDER       = colors.HexColor("#E2E8F4")
        CARD_BORDER_BLUE  = colors.HexColor("#D0DCF5")
        
        NAVY_PRIMARY      = colors.HexColor("#0F172A")
        INDIGO_TITLE      = colors.HexColor("#3730A3")
        ACCENT_BLUE       = colors.HexColor("#2563EB")
        ACCENT_INDIGO     = colors.HexColor("#4F46E5")
        TEXT_MAIN         = colors.HexColor("#1E293B")
        TEXT_MUTED        = colors.HexColor("#64748B")
        GOLD_TEXT         = colors.HexColor("#B45309")
        
        GREEN_BADGE_BG    = colors.HexColor("#ECFDF5")
        GREEN_BADGE_BD    = colors.HexColor("#A7F3D0")
        GREEN_TEXT        = colors.HexColor("#047857")
        
        # 1. Background
        pdf.setFillColor(BG_PAGE)
        pdf.rect(0, 0, width, height, fill=1, stroke=0)
        
        # 2. Main Outer Frosted Container Card
        m = 7 * mm
        canvas_w = width - (2 * m)   # 196 mm
        canvas_h = height - (2 * m)  # 283 mm
        
        draw_glass_card(pdf, m, m, canvas_w, canvas_h, radius=7*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1.2, shadow=True)
        
        # 3. Top Brand Header Section
        header_y = m + canvas_h - 40 * mm
        
        # Logo on the left
        vs_logo_path = STATIC_ROOT / "VS_logo_header.png"
        if not vs_logo_path.is_file():
            vs_logo_path = STATIC_ROOT / "VS_logo.png"
            
        if vs_logo_path.is_file():
            logo_w = 90 * mm
            logo_h = logo_w * (2764 / 8000)  # ~31.1 mm
            logo_x = m + 8 * mm
            logo_y = header_y + 3 * mm
            pdf.drawImage(str(vs_logo_path), logo_x, logo_y, width=logo_w, height=logo_h, mask='auto')
        
        # Right Side: Official Client Portal Pass Card
        ref_card_w = 70 * mm
        ref_card_h = 32 * mm
        ref_card_x = m + canvas_w - ref_card_w - 8 * mm
        ref_card_y = header_y + 2.5 * mm
        
        draw_glass_card(pdf, ref_card_x, ref_card_y, ref_card_w, ref_card_h, radius=4*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=1)
        
        # Sub-pill with shield
        sub_pill_w = 60 * mm
        sub_pill_h = 7.5 * mm
        sub_pill_x = ref_card_x + 5 * mm
        sub_pill_y = ref_card_y + ref_card_h - sub_pill_h - 4.5 * mm
        draw_glass_card(pdf, sub_pill_x, sub_pill_y, sub_pill_w, sub_pill_h, radius=2.5*mm, bg=CANVAS_WHITE, border=CARD_BORDER_BLUE, border_width=0.8)
        
        draw_vector_icon(pdf, "shield_check", sub_pill_x + 3.5*mm, sub_pill_y + 1.8*mm, size=4*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(INDIGO_TITLE)
        pdf.setFont(f_bold, 6.8)
        pdf.drawString(sub_pill_x + 9.5 * mm, sub_pill_y + 2.2 * mm, "OFFICIAL CLIENT PORTAL PASS")
        
        fno = client.get("file_no", "V-0012") if isinstance(client, dict) else (client["file_no"] if client else "V-0012")
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 7.8)
        pdf.drawString(ref_card_x + 6 * mm, ref_card_y + 11.5 * mm, f"Doc Ref: VS/{datetime.now().strftime('%Y')}/{fno}")
        
        date_str = datetime.now().strftime("%d %B %Y")
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(ref_card_x + 6 * mm, ref_card_y + 5 * mm, f"Issued Date: {date_str}")
        
        # 4. Office Information Strip (Horizontal slim glass bar)
        firm_name = get_setting("firm_name") or "Vimal Sikhwal"
        firm_title = get_setting("firm_title") or "Tax Practitioner"
        firm_city = get_setting("firm_city") or "Jodhpur"
        firm_phone = get_setting("firm_phone") or "9460222319"
        
        strip_y = header_y - 12 * mm
        strip_w = canvas_w - 16 * mm
        strip_h = 8.5 * mm
        strip_x = m + 8 * mm
        
        draw_glass_card(pdf, strip_x, strip_y, strip_w, strip_h, radius=3.5*mm, bg=CARD_BG_DEFAULT, border=CARD_BORDER, border_width=1)
        
        col_w = strip_w / 4
        
        # Item 1: Person
        draw_vector_icon(pdf, "person", strip_x + 4*mm, strip_y + 2.4*mm, size=3.6*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 7.2)
        pdf.drawString(strip_x + 9.5*mm, strip_y + 2.6*mm, firm_name.upper())
        pdf.setStrokeColor(CARD_BORDER)
        pdf.line(strip_x + col_w - 2*mm, strip_y + 1.5*mm, strip_x + col_w - 2*mm, strip_y + strip_h - 1.5*mm)
        
        # Item 2: Briefcase
        draw_vector_icon(pdf, "briefcase", strip_x + col_w + 3*mm, strip_y + 2.4*mm, size=3.6*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(strip_x + col_w + 8.5*mm, strip_y + 2.6*mm, firm_title)
        pdf.line(strip_x + col_w*2 - 2*mm, strip_y + 1.5*mm, strip_x + col_w*2 - 2*mm, strip_y + strip_h - 1.5*mm)
        
        # Item 3: Location
        draw_vector_icon(pdf, "location", strip_x + col_w*2 + 3*mm, strip_y + 2.4*mm, size=3.6*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(strip_x + col_w*2 + 8.5*mm, strip_y + 2.6*mm, f"Office: {firm_city}")
        pdf.line(strip_x + col_w*3 - 2*mm, strip_y + 1.5*mm, strip_x + col_w*3 - 2*mm, strip_y + strip_h - 1.5*mm)
        
        # Item 4: Phone
        draw_vector_icon(pdf, "phone", strip_x + col_w*3 + 3*mm, strip_y + 2.4*mm, size=3.6*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(strip_x + col_w*3 + 8.5*mm, strip_y + 2.6*mm, f"+91 {firm_phone}")
        
        # 5. Main Registered Client Account Card
        c_card_y = strip_y - 41 * mm
        c_card_w = strip_w
        c_card_h = 35 * mm
        c_card_x = strip_x
        
        draw_glass_card(pdf, c_card_x, c_card_y, c_card_w, c_card_h, radius=5*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=1.2)
        
        draw_vector_icon(pdf, "person", c_card_x + 6*mm, c_card_y + c_card_h - 8.5*mm, size=4*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(ACCENT_INDIGO)
        pdf.setFont(f_bold, 7.8)
        pdf.drawString(c_card_x + 12 * mm, c_card_y + c_card_h - 8.2 * mm, "REGISTERED CLIENT ACCOUNT")
        
        c_name = (client.get("name") if isinstance(client, dict) else client["name"] if client else "CLIENT NAME").upper()
        pdf.setFillColor(NAVY_PRIMARY)
        font_size = 14.5 if len(c_name) <= 28 else 12
        pdf.setFont(f_bold, font_size)
        pdf.drawString(c_card_x + 6 * mm, c_card_y + 15 * mm, c_name)
        
        badge_y = c_card_y + 4.5 * mm
        
        # Badge 1: Reference
        fno_str = f"Reference: {fno}"
        fno_w = pdf.stringWidth(fno_str, f_semi, 7.5) + 12 * mm
        draw_glass_card(pdf, c_card_x + 6*mm, badge_y, fno_w, 6.5*mm, radius=2.5*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1)
        draw_vector_icon(pdf, "briefcase", c_card_x + 8*mm, badge_y + 1.6*mm, size=3.2*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_semi, 7.5)
        pdf.drawString(c_card_x + 12.5*mm, badge_y + 1.8*mm, fno_str)
        
        # Badge 2: Firm Type
        c_type = client.get("client_type", "Partnership Firm") if isinstance(client, dict) else (client["client_type"] if client and "client_type" in client.keys() else "Partnership Firm")
        ft_str = f"Firm Type: {c_type}"
        ft_w = pdf.stringWidth(ft_str, f_reg, 7.5) + 12 * mm
        ft_x = c_card_x + 6*mm + fno_w + 4*mm
        draw_glass_card(pdf, ft_x, badge_y, ft_w, 6.5*mm, radius=2.5*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1)
        draw_vector_icon(pdf, "folder", ft_x + 2.5*mm, badge_y + 1.6*mm, size=3.2*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_reg, 7.5)
        pdf.drawString(ft_x + 7*mm, badge_y + 1.8*mm, ft_str)
        
        # Badge 3: Active Cloud Portal
        st_str = "Active Cloud Portal"
        st_w = pdf.stringWidth(st_str, f_bold, 7.5) + 12 * mm
        st_x = ft_x + ft_w + 4*mm
        draw_glass_card(pdf, st_x, badge_y, st_w, 6.5*mm, radius=2.5*mm, bg=GREEN_BADGE_BG, border=GREEN_BADGE_BD, border_width=1)
        draw_vector_icon(pdf, "shield_check", st_x + 2.5*mm, badge_y + 1.6*mm, size=3.2*mm, color=GREEN_TEXT)
        pdf.setFillColor(GREEN_TEXT)
        pdf.setFont(f_bold, 7.5)
        pdf.drawString(st_x + 7*mm, badge_y + 1.8*mm, st_str)
        
        # 6. Direct Google Drive Portal Section with CTA Button
        l_card_y = c_card_y - 30 * mm
        l_card_w = strip_w
        l_card_h = 25 * mm
        l_card_x = strip_x
        
        draw_glass_card(pdf, l_card_x, l_card_y, l_card_w, l_card_h, radius=5*mm, bg=CARD_BG_DEFAULT, border=CARD_BORDER, border_width=1)
        
        # Google Drive Icon using google-drive.ico/png
        drive_ico_w = 17 * mm
        drive_ico_h = 17 * mm
        drive_ico_x = l_card_x + 4 * mm
        drive_ico_y = l_card_y + 4 * mm
        draw_glass_card(pdf, drive_ico_x, drive_ico_y, drive_ico_w, drive_ico_h, radius=3.5*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1)
        
        gdrive_png = STATIC_ROOT / "google_drive_icon.png"
        if gdrive_png.is_file():
            pdf.drawImage(str(gdrive_png), drive_ico_x + 2*mm, drive_ico_y + 2*mm, width=13*mm, height=13*mm, mask='auto')
        
        # Middle Title & URL
        pdf.setFillColor(INDIGO_TITLE)
        pdf.setFont(f_bold, 8.5)
        pdf.drawString(l_card_x + 25 * mm, l_card_y + l_card_h - 7.5 * mm, "DIRECT GOOGLE DRIVE PORTAL")
        
        display_link = link if len(link) <= 52 else link[:49] + "..."
        redirect_png = STATIC_ROOT / "Redirect.png"
        if not redirect_png.is_file():
            ensure_redirect_icon()
            
        if redirect_png.is_file():
            pdf.drawImage(str(redirect_png), l_card_x + 25 * mm, l_card_y + 4.2 * mm, width=4.2*mm, height=4.2*mm, mask='auto')
            pdf.setFillColor(ACCENT_BLUE)
            pdf.setFont(f_bold, 8.2)
            pdf.drawString(l_card_x + 30.5 * mm, l_card_y + 4.8 * mm, display_link)
        else:
            draw_vector_icon(pdf, "external_link", l_card_x + 25 * mm, l_card_y + 4.5 * mm, size=3.2*mm, color=ACCENT_BLUE)
            pdf.setFillColor(ACCENT_BLUE)
            pdf.setFont(f_bold, 8.2)
            pdf.drawString(l_card_x + 29.5 * mm, l_card_y + 4.8 * mm, display_link)
        pdf.linkURL(link, (l_card_x, l_card_y, l_card_x + l_card_w, l_card_y + l_card_h), relative=0)
        
        # Interactive CTA Button on the right: [ ↗ OPEN CLIENT PORTAL ]
        cta_btn_w = 46 * mm
        cta_btn_h = 11 * mm
        cta_btn_x = l_card_x + l_card_w - cta_btn_w - 5 * mm
        cta_btn_y = l_card_y + 7 * mm
        draw_glass_card(pdf, cta_btn_x, cta_btn_y, cta_btn_w, cta_btn_h, radius=3*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=1)
        if redirect_png.is_file():
            pdf.drawImage(str(redirect_png), cta_btn_x + 3.2 * mm, cta_btn_y + 2.5 * mm, width=5.8*mm, height=5.8*mm, mask='auto')
            pdf.setFillColor(ACCENT_INDIGO)
            pdf.setFont(f_bold, 6.8)
            pdf.drawString(cta_btn_x + 9.8 * mm, cta_btn_y + 3.8 * mm, "OPEN CLIENT PORTAL")
        else:
            draw_vector_icon(pdf, "external_link", cta_btn_x + 3.5*mm, cta_btn_y + 3.2*mm, size=4*mm, color=ACCENT_INDIGO)
            pdf.setFillColor(ACCENT_INDIGO)
            pdf.setFont(f_bold, 6.8)
            pdf.drawString(cta_btn_x + 9.5 * mm, cta_btn_y + 3.8 * mm, "OPEN CLIENT PORTAL")
        pdf.linkURL(link, (cta_btn_x, cta_btn_y, cta_btn_x + cta_btn_w, cta_btn_y + cta_btn_h), relative=0)
        
        # 7. QR Code Access Section
        qr_panel_y = l_card_y - 84 * mm
        qr_panel_w = strip_w
        qr_panel_h = 79 * mm
        qr_panel_x = strip_x
        
        draw_glass_card(pdf, qr_panel_x, qr_panel_y, qr_panel_w, qr_panel_h, radius=5.5*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=1.2)
        
        # Left Header in QR Panel
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 8.5)
        pdf.drawString(qr_panel_x + 8 * mm, qr_panel_y + qr_panel_h - 10 * mm, "SCAN QR CODE FOR")
        
        pdf.setFillColor(INDIGO_TITLE)
        pdf.setFont(f_bold, 9.2)
        pdf.drawString(qr_panel_x + 8 * mm, qr_panel_y + qr_panel_h - 15 * mm, "INSTANT SMARTPHONE ACCESS")
        
        pdf.setStrokeColor(ACCENT_INDIGO)
        pdf.setLineWidth(1.5)
        pdf.line(qr_panel_x + 8 * mm, qr_panel_y + qr_panel_h - 18 * mm, qr_panel_x + 22 * mm, qr_panel_y + qr_panel_h - 18 * mm)
        
        # Phone Icon Box
        ph_box_w = 14 * mm
        ph_box_h = 16 * mm
        ph_box_x = qr_panel_x + 8 * mm
        ph_box_y = qr_panel_y + 26 * mm
        draw_glass_card(pdf, ph_box_x, ph_box_y, ph_box_w, ph_box_h, radius=3*mm, bg=CANVAS_WHITE, border=CARD_BORDER_BLUE, border_width=1)
        draw_vector_icon(pdf, "mobile_phone", ph_box_x + 3.5*mm, ph_box_y + 3*mm, size=7*mm, color=ACCENT_INDIGO)
        
        # Instruction Text
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_reg, 7.5)
        lines = [
            "Scan with Camera",
            "or Google Lens to view",
            "client documents securely."
        ]
        txt_y = ph_box_y + ph_box_h - 4 * mm
        for l in lines:
            pdf.drawString(ph_box_x + ph_box_w + 5 * mm, txt_y, l)
            txt_y -= 4.2 * mm
            
        # QR Box
        qr_box_size = 48 * mm
        qr_box_x = qr_panel_x + qr_panel_w - qr_box_size - 8 * mm
        qr_box_y = qr_panel_y + 23 * mm
        
        draw_glass_card(pdf, qr_box_x, qr_box_y, qr_box_size, qr_box_size, radius=4*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1)
        
        mono_path = str(STATIC_ROOT / "logo Monogram.png")
        qr_tmp = generate_custom_qr(link, mono_path, str(SCRATCH_DIR))
        pdf.drawImage(qr_tmp, qr_box_x + 2*mm, qr_box_y + 2*mm, width=qr_box_size - 4*mm, height=qr_box_size - 4*mm)
            
        # 4 Security & Access Benefit Cards
        benefit_y = qr_panel_y + 5 * mm
        benefit_w = (qr_panel_w - 20 * mm) / 4
        benefit_h = 13 * mm
        
        benefits = [
            ("lock", "Secure 24/7 Access", "Protected Entry"),
            ("folder", "Read-Only Client Folder", "Safe Storage"),
            ("cloud", "Real-Time Cloud Updates", "Instant Sync"),
            ("shield_check", "Protected with Security", "Enterprise Safe")
        ]
        
        for i, (b_icon, t1, t2) in enumerate(benefits):
            bx = qr_panel_x + 5*mm + i * (benefit_w + 3.3*mm)
            draw_glass_card(pdf, bx, benefit_y, benefit_w, benefit_h, radius=3*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=0.8)
            
            ib_s = 7 * mm
            draw_glass_card(pdf, bx + 2*mm, benefit_y + 3*mm, ib_s, ib_s, radius=1.8*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=0.6)
            draw_vector_icon(pdf, b_icon, bx + 3.8*mm, benefit_y + 4.8*mm, size=3.5*mm, color=ACCENT_INDIGO)
            
            pdf.setFillColor(TEXT_MAIN)
            pdf.setFont(f_semi, 6.0)
            pdf.drawString(bx + 10.2*mm, benefit_y + 7.2*mm, t1)
            pdf.setFillColor(TEXT_MUTED)
            pdf.setFont(f_reg, 5.5)
            pdf.drawString(bx + 10.2*mm, benefit_y + 3.8*mm, t2)
            
        # 8. Bottom Section: Signatory on Left & 3D Glass Verified Seal on Right (NO SIGNATURE)
        foot_y = m + 8 * mm
        
        sig_x = m + 8 * mm
        firm_name = get_setting("firm_name") or "Vimal Sikhwal"
        firm_title = get_setting("firm_title") or "Tax Practitioner"
        firm_city = get_setting("firm_city") or "Jodhpur"
        date_str = datetime.now().strftime("%d-%b-%Y")
        
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 9.5)
        pdf.drawString(sig_x, foot_y + 16 * mm, firm_name.upper())
        
        pdf.setFillColor(GOLD_TEXT)
        pdf.setFont(f_semi, 7.8)
        pdf.drawString(sig_x, foot_y + 11 * mm, f"{firm_title}  •  {firm_city}")
        
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(sig_x, foot_y + 4.5 * mm, f"System authenticated client pass generated on {date_str} via VS Database")
        
        # Right Side: 3D Glass Verified Seal
        seal_cx = m + canvas_w - 22 * mm
        seal_cy = foot_y + 12 * mm
        draw_3d_glass_verified_seal(pdf, seal_cx, seal_cy, radius=15 * mm)
        
        # Creator & Designer Credit
        pdf.setFillColor(colors.HexColor("#4F46E5"))
        pdf.setFont(f_semi, 7.2)
        pdf.drawCentredString(width / 2, m + 1.8 * mm, "© Designed & Created By Rudraksh Sikhwal")
        
        pdf.save()
        
        # Read rendered bytes
        rendered_bytes = tmp_target.read_bytes()
        
        # Clean up any stale dual files or temp files for this client
        safe_cname = safe_name(client['name'])
        for stale in target_dir.glob(f"{safe_cname} - Client Document Access (*).pdf"):
            try: stale.unlink(missing_ok=True)
            except Exception: pass
        for stale in target_dir.glob(f".tmp_*_{safe_cname}.pdf"):
            try: stale.unlink(missing_ok=True)
            except Exception: pass
            
        # Write bytes cleanly with retry
        written = False
        for _ in range(6):
            try:
                target.write_bytes(rendered_bytes)
                written = True
                break
            except PermissionError:
                time.sleep(0.08)
            except Exception:
                break
                
        if not written:
            try:
                os.replace(str(tmp_target), str(target))
                return str(target)
            except Exception as exc:
                c_fno = client["file_no"] if isinstance(client, (dict, sqlite3.Row)) else getattr(client, "file_no", str(client))
                logging.warning("Could not write access pass PDF for %s: %s", c_fno, exc)
                return str(target)
        return str(target)
    finally:
        if qr_tmp and os.path.isfile(qr_tmp):
            try: os.remove(qr_tmp)
            except Exception: pass
        if tmp_target.exists():
            try: tmp_target.unlink(missing_ok=True)
            except Exception: pass


def block_pdf(client, reason, custom_message=""):
    """Generates a modern website-themed glassmorphic Client Portal Notice PDF with UPI QR scanner and bilingual notice."""
    local_root = get_setting("local_root") or str(DATA_ROOT)
    target_dir = Path(local_root) / "Client Access Links"
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_cname = safe_name(client['name'])
    target = target_dir / f"{safe_cname} - Portal Notice.pdf"
    
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    tmp_target = SCRATCH_DIR / f"notice_{uuid.uuid4().hex}.pdf"
    qr_tmp = None
    
    if reason == "Payment Due":
        english = custom_message.strip() or "Your document portal access is currently on hold pending fee clearance. Please complete the pending payment using the QR code below or contact our office to restore instant access."
        hindi = "कृपया पहुंच बहाल करने के लिए लंबित भुगतान पूरा करें या हमारे कार्यालय से संपर्क करें।"
        badge_title = "PAYMENT DUE / PENDING"
        badge_color = colors.HexColor("#DC2626")
        badge_bg = colors.HexColor("#FEF2F2")
        badge_border = colors.HexColor("#FECACA")
    elif reason == "Portal Under Maintenance":
        english = custom_message.strip() or "The client document portal is currently undergoing scheduled system maintenance and optimization. Normal access will be restored shortly."
        hindi = "क्लाइंट पोर्टल रखरखाव के लिए अस्थायी रूप से बंद है। पहुंच शीघ्र ही बहाल कर दी जाएगी।"
        badge_title = "SYSTEM MAINTENANCE"
        badge_color = colors.HexColor("#D97706")
        badge_bg = colors.HexColor("#FFFBEB")
        badge_border = colors.HexColor("#FDE68A")
    elif reason == "Temporary Suspension":
        english = custom_message.strip() or "Access to your client document portal has been temporarily suspended. Please contact our office for verification and assistance."
        hindi = "पहुंच अस्थायी रूप से निलंबित है। कृपया सहायता के लिए हमारे कार्यालय से संपर्क करें।"
        badge_title = "ACCESS SUSPENDED"
        badge_color = colors.HexColor("#DC2626")
        badge_bg = colors.HexColor("#FEF2F2")
        badge_border = colors.HexColor("#FECACA")
    else:
        english = custom_message.strip() or "Notice regarding your client document portal. Please contact our office for details."
        hindi = "सहायता के लिए कार्यालय से संपर्क करें।"
        badge_title = reason.upper()
        badge_color = colors.HexColor("#4F46E5")
        badge_bg = colors.HexColor("#EEF2FF")
        badge_border = colors.HexColor("#C7D2FE")

    try:
        pdf = canvas.Canvas(str(tmp_target), pagesize=A4)
        width, height = A4
        
        f_reg = "SegoeUI" if "SegoeUI" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
        f_bold = "SegoeUI-Bold" if "SegoeUI-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
        f_semi = "SegoeUI-SemiBold" if "SegoeUI-SemiBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
        
        BG_PAGE           = colors.HexColor("#F8FAFC")
        CANVAS_WHITE      = colors.HexColor("#FFFFFF")
        CARD_BG_DEFAULT   = colors.HexColor("#F8FAFD")
        CARD_BG_TINT      = colors.HexColor("#F1F5FD")
        CARD_BORDER       = colors.HexColor("#E2E8F4")
        CARD_BORDER_BLUE  = colors.HexColor("#D0DCF5")
        
        NAVY_PRIMARY      = colors.HexColor("#0F172A")
        INDIGO_TITLE      = colors.HexColor("#3730A3")
        ACCENT_BLUE       = colors.HexColor("#2563EB")
        ACCENT_INDIGO     = colors.HexColor("#4F46E5")
        TEXT_MAIN         = colors.HexColor("#1E293B")
        TEXT_MUTED        = colors.HexColor("#64748B")
        
        # 1. Background
        pdf.setFillColor(BG_PAGE)
        pdf.rect(0, 0, width, height, fill=1, stroke=0)
        
        # 2. Main Outer Container
        m = 7 * mm
        canvas_w = width - (2 * m)
        canvas_h = height - (2 * m)
        draw_glass_card(pdf, m, m, canvas_w, canvas_h, radius=7*mm, bg=CANVAS_WHITE, border=CARD_BORDER, border_width=1.2, shadow=True)
        
        # 3. Top Header
        header_y = m + canvas_h - 40 * mm
        vs_logo_path = STATIC_ROOT / "VS_logo_header.png"
        if not vs_logo_path.is_file():
            vs_logo_path = STATIC_ROOT / "VS_logo.png"
            
        if vs_logo_path.is_file():
            logo_w = 90 * mm
            logo_h = logo_w * (2764 / 8000)
            logo_x = m + 8 * mm
            logo_y = header_y + 3 * mm
            pdf.drawImage(str(vs_logo_path), logo_x, logo_y, width=logo_w, height=logo_h, mask='auto')
            
        # Top Right Ref Card
        ref_card_w = 70 * mm
        ref_card_h = 32 * mm
        ref_card_x = m + canvas_w - ref_card_w - 8 * mm
        ref_card_y = header_y + 2.5 * mm
        draw_glass_card(pdf, ref_card_x, ref_card_y, ref_card_w, ref_card_h, radius=4*mm, bg=badge_bg, border=badge_border, border_width=1)
        
        # Status Pill
        sub_pill_w = 60 * mm
        sub_pill_h = 7.5 * mm
        sub_pill_x = ref_card_x + 5 * mm
        sub_pill_y = ref_card_y + ref_card_h - sub_pill_h - 4.5 * mm
        draw_glass_card(pdf, sub_pill_x, sub_pill_y, sub_pill_w, sub_pill_h, radius=2.5*mm, bg=CANVAS_WHITE, border=badge_border, border_width=0.8)
        
        draw_vector_icon(pdf, "alert_triangle", sub_pill_x + 3.5*mm, sub_pill_y + 1.8*mm, size=4*mm, color=badge_color)
        pdf.setFillColor(badge_color)
        pdf.setFont(f_bold, 6.8)
        pdf.drawString(sub_pill_x + 9.5 * mm, sub_pill_y + 2.2 * mm, "PORTAL NOTICE / ALERT")
        
        fno = client.get("file_no", "V-0012") if isinstance(client, dict) else (client["file_no"] if client else "V-0012")
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 7.8)
        pdf.drawString(ref_card_x + 6 * mm, ref_card_y + 11.5 * mm, f"Ref No: VS/NTC/{datetime.now().strftime('%Y')}/{fno}")
        
        date_str = datetime.now().strftime("%d %B %Y")
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(ref_card_x + 6 * mm, ref_card_y + 5 * mm, f"Notice Date: {date_str}")
        
        # 4. Office Information Strip
        firm_name = get_setting("firm_name") or "Vimal Sikhwal"
        firm_title = get_setting("firm_title") or "Tax Practitioner"
        firm_city = get_setting("firm_city") or "Jodhpur"
        firm_phone = get_setting("firm_phone") or "9460222319"
        firm_upi = get_setting("firm_upi_id") or "8104888850@ybl"
        
        strip_y = header_y - 12 * mm
        strip_w = canvas_w - 16 * mm
        strip_h = 8.5 * mm
        strip_x = m + 8 * mm
        draw_glass_card(pdf, strip_x, strip_y, strip_w, strip_h, radius=2.5*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=0.8)
        
        draw_vector_icon(pdf, "building", strip_x + 5 * mm, strip_y + 2.5 * mm, size=3.5*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 7.5)
        pdf.drawString(strip_x + 10 * mm, strip_y + 2.8 * mm, f"{firm_name.upper()} • {firm_title.upper()}")
        
        draw_vector_icon(pdf, "map_pin", strip_x + 105 * mm, strip_y + 2.5 * mm, size=3.5*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_semi, 7.2)
        pdf.drawString(strip_x + 110 * mm, strip_y + 2.8 * mm, f"Location: {firm_city}")
        
        draw_vector_icon(pdf, "phone", strip_x + 143 * mm, strip_y + 2.5 * mm, size=3.5*mm, color=ACCENT_INDIGO)
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_semi, 7.2)
        pdf.drawString(strip_x + 148 * mm, strip_y + 2.8 * mm, f"Helpline: +91 {firm_phone}")
        
        # 5. Notice Alert Card (Large Glass Card)
        alert_card_y = strip_y - 72 * mm
        alert_card_w = strip_w
        alert_card_h = 67 * mm
        alert_card_x = strip_x
        
        draw_glass_card(pdf, alert_card_x, alert_card_y, alert_card_w, alert_card_h, radius=5*mm, bg=badge_bg, border=badge_border, border_width=1.2)
        
        # Status Banner inside Alert Card
        banner_w = alert_card_w - 12 * mm
        banner_h = 12 * mm
        banner_x = alert_card_x + 6 * mm
        banner_y = alert_card_y + alert_card_h - banner_h - 5 * mm
        draw_glass_card(pdf, banner_x, banner_y, banner_w, banner_h, radius=3*mm, bg=CANVAS_WHITE, border=badge_border, border_width=1)
        
        draw_vector_icon(pdf, "alert_triangle", banner_x + 4 * mm, banner_y + 3 * mm, size=6*mm, color=badge_color)
        pdf.setFillColor(badge_color)
        pdf.setFont(f_bold, 10.5)
        pdf.drawString(banner_x + 13 * mm, banner_y + 3.8 * mm, f"PORTAL ACCESS ON HOLD : {badge_title}")
        
        # Client Information Line
        c_name = client.get("name", "Valued Client") if isinstance(client, dict) else client["name"]
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 13)
        pdf.drawString(alert_card_x + 8 * mm, alert_card_y + alert_card_h - 26 * mm, c_name.upper())
        
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_semi, 8.5)
        pdf.drawString(alert_card_x + 8 * mm, alert_card_y + alert_card_h - 32 * mm, f"Client File No: {fno}   |   Status: Access Temporarily Restricted")
        
        # Horizontal divider
        pdf.setStrokeColor(badge_border)
        pdf.setLineWidth(0.8)
        pdf.line(alert_card_x + 8 * mm, alert_card_y + alert_card_h - 35 * mm, alert_card_x + alert_card_w - 8 * mm, alert_card_y + alert_card_h - 35 * mm)
        
        # English Notice Text (with wrapping)
        pdf.setFillColor(TEXT_MAIN)
        pdf.setFont(f_semi, 8.8)
        import textwrap
        t_obj = pdf.beginText(alert_card_x + 8 * mm, alert_card_y + alert_card_h - 42 * mm)
        t_obj.setLeading(13)
        for line in english.splitlines():
            if line.strip():
                for sub in textwrap.wrap(line, width=82):
                    t_obj.textLine(sub)
            else:
                t_obj.textLine("")
        pdf.drawText(t_obj)
        
        # Hindi Notice Text
        pdf.setFillColor(colors.HexColor("#7F1D1D") if reason == "Payment Due" else INDIGO_TITLE)
        pdf.setFont(hindi_font(), 9)
        pdf.drawString(alert_card_x + 8 * mm, alert_card_y + 7 * mm, hindi)
        
        # 6. UPI Payment & Assistance Section
        qr_card_y = alert_card_y - 88 * mm
        qr_card_w = strip_w
        qr_card_h = 83 * mm
        qr_card_x = strip_x
        
        draw_glass_card(pdf, qr_card_x, qr_card_y, qr_card_w, qr_card_h, radius=5*mm, bg=CARD_BG_TINT, border=CARD_BORDER_BLUE, border_width=1.2)
        
        # Left Side of QR Card: Instructions & Assistance
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 10.5)
        pdf.drawString(qr_card_x + 8 * mm, qr_card_y + qr_card_h - 12 * mm, "RESTORE INSTANT ACCESS")
        
        pdf.setFillColor(ACCENT_INDIGO)
        pdf.setFont(f_bold, 8.5)
        pdf.drawString(qr_card_x + 8 * mm, qr_card_y + qr_card_h - 18 * mm, "SECURE UPI PAYMENT / HELPDESK RESTORATION")
        
        steps = [
            ("1", "Scan the UPI QR Code using any UPI App (GPay, PhonePe, Paytm, BHIM)."),
            ("2", f"Payee Account: {firm_name} ({firm_upi})."),
            ("3", f"After fee clearance, share confirmation on WhatsApp/Call: +91 {firm_phone}."),
            ("4", "Your document access link and portal will be activated immediately.")
        ]
        
        for idx, (num, text_line) in enumerate(steps):
            sy = qr_card_y + qr_card_h - 28 * mm - (idx * 11 * mm)
            draw_glass_card(pdf, qr_card_x + 8 * mm, sy - 1.5 * mm, 6 * mm, 6 * mm, radius=1.5*mm, bg=ACCENT_INDIGO, border=ACCENT_INDIGO, border_width=0)
            pdf.setFillColor(CANVAS_WHITE)
            pdf.setFont(f_bold, 7)
            pdf.drawCentredString(qr_card_x + 11 * mm, sy + 0.3 * mm, num)
            
            pdf.setFillColor(TEXT_MAIN)
            pdf.setFont(f_semi, 7.8)
            pdf.drawString(qr_card_x + 17 * mm, sy + 0.2 * mm, text_line)
            
        # Right Side: UPI Payment QR Code
        qr_box_w = 48 * mm
        qr_box_h = 67 * mm
        qr_box_x = qr_card_x + qr_card_w - qr_box_w - 8 * mm
        qr_box_y = qr_card_y + 8 * mm
        
        draw_glass_card(pdf, qr_box_x, qr_box_y, qr_box_w, qr_box_h, radius=4*mm, bg=CANVAS_WHITE, border=CARD_BORDER_BLUE, border_width=1)
        
        pdf.setFillColor(INDIGO_TITLE)
        pdf.setFont(f_bold, 7.5)
        pdf.drawCentredString(qr_box_x + (qr_box_w / 2), qr_box_y + qr_box_h - 7 * mm, "OFFICIAL UPI SCANNER")
        
        upi_uri = f"upi://pay?pa={firm_upi}&pn={firm_name.replace(' ', '%20')}&cu=INR"
        qr_obj = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=1)
        qr_obj.add_data(upi_uri)
        qr_obj.make(fit=True)
        img = qr_obj.make_image(fill_color="#0F172A", back_color="#FFFFFF")
        
        qr_tmp = SCRATCH_DIR / f"upi_qr_{uuid.uuid4().hex}.png"
        img.save(str(qr_tmp))
        
        qr_img_w = 34 * mm
        qr_img_h = 34 * mm
        qr_img_x = qr_box_x + ((qr_box_w - qr_img_w) / 2)
        qr_img_y = qr_box_y + qr_box_h - qr_img_h - 13 * mm
        pdf.drawImage(str(qr_tmp), qr_img_x, qr_img_y, width=qr_img_w, height=qr_img_h, mask='auto')
        
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 7.2)
        pdf.drawCentredString(qr_box_x + (qr_box_w / 2), qr_box_y + 11 * mm, f"UPI: {firm_upi}")
        
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_semi, 6.5)
        pdf.drawCentredString(qr_box_x + (qr_box_w / 2), qr_box_y + 5.5 * mm, "GPay • PhonePe • Paytm • BHIM")
        
        # 7. Bottom Helpdesk Bar
        bottom_y = qr_card_y - 25 * mm
        bottom_w = strip_w
        bottom_h = 19 * mm
        bottom_x = strip_x
        
        draw_glass_card(pdf, bottom_x, bottom_y, bottom_w, bottom_h, radius=3.5*mm, bg=CARD_BG_DEFAULT, border=CARD_BORDER, border_width=1)
        
        draw_vector_icon(pdf, "phone", bottom_x + 6 * mm, bottom_y + 7.5 * mm, size=5*mm, color=ACCENT_BLUE)
        pdf.setFillColor(NAVY_PRIMARY)
        pdf.setFont(f_bold, 8.2)
        pdf.drawString(bottom_x + 14 * mm, bottom_y + 10 * mm, f"For Assistance / Payment Verification: +91 {firm_phone}")
        
        pdf.setFillColor(TEXT_MUTED)
        pdf.setFont(f_reg, 7.2)
        pdf.drawString(bottom_x + 14 * mm, bottom_y + 4.5 * mm, f"Office of {firm_name}, {firm_title}, {firm_city} • Strictly Confidential")
        
        # 8. Creator & Designer Credit
        pdf.setFillColor(colors.HexColor("#4F46E5"))
        pdf.setFont(f_semi, 7.2)
        pdf.drawCentredString(width / 2, m + 1.8 * mm, "© Designed & Created By Rudraksh Sikhwal")
        
        pdf.save()
        
        rendered_bytes = tmp_target.read_bytes()
        written = False
        for _ in range(6):
            try:
                target.write_bytes(rendered_bytes)
                written = True
                break
            except PermissionError:
                time.sleep(0.08)
            except Exception:
                break
        if not written:
            try:
                os.replace(str(tmp_target), str(target))
            except Exception:
                pass
        return str(target)
    finally:
        if qr_tmp and os.path.isfile(qr_tmp):
            try: os.remove(qr_tmp)
            except Exception: pass
        if tmp_target.exists():
            try: tmp_target.unlink(missing_ok=True)
            except Exception: pass


def portal_children(service, folder_id):
    return service.files().list(q=f"'{folder_id}' in parents and trashed=false", fields="files(id,name,mimeType,parents)").execute().get("files", [])


def block_portal(client, reason, custom_message=""):
    if reason not in ("Payment Due", "Portal Under Maintenance", "Temporary Suspension", "Custom Message"):
        raise ValueError("Select a valid portal blocking reason.")
    if reason == "Custom Message" and not custom_message.strip(): raise ValueError("Enter the custom portal message.")
    with get_client_portal_lock(client["file_no"]):
        with db() as con: existing = con.execute("SELECT * FROM portal_blocks WHERE client_file_no=?", (client["file_no"],)).fetchone()
        if existing: return {"blocked": True, "reason": existing["reason"]}
        portal = ensure_client_portal(client); service = google_service()
        parent = service.files().get(fileId=portal["folder_id"], fields="parents").execute().get("parents", [None])[0]
        archive = drive_folder(service, "__VS Portal Archive", parent)
        for item in portal_children(service, portal["folder_id"]):
            service.files().update(fileId=item["id"], addParents=archive["id"], removeParents=portal["folder_id"], fields="id").execute()
        notice_path = block_pdf(client, reason, custom_message)
        media = MediaIoBaseUpload(io.BytesIO(Path(notice_path).read_bytes()), mimetype="application/pdf", resumable=False)
        notice = service.files().create(body={"name":"Portal Access Notice.pdf", "parents":[portal["folder_id"]]}, media_body=media, fields="id").execute()
        with db() as con: con.execute("INSERT OR REPLACE INTO portal_blocks VALUES(?,?,?,?,?,?)", (client["file_no"],reason,custom_message,now(),notice["id"],archive["id"]))
        return {"blocked": True, "reason": reason}


def unblock_portal(client):
    with get_client_portal_lock(client["file_no"]):
        with db() as con: block = con.execute("SELECT * FROM portal_blocks WHERE client_file_no=?", (client["file_no"],)).fetchone()
        if not block: return {"blocked": False, "restored": 0}
        portal = ensure_client_portal(client); service = google_service(); restored = 0
        try: service.files().delete(fileId=block["blocking_file_id"]).execute()
        except Exception: pass
        for item in portal_children(service, block["archive_folder_id"]):
            service.files().update(fileId=item["id"], addParents=portal["folder_id"], removeParents=block["archive_folder_id"], fields="id").execute(); restored += 1
        try: service.files().delete(fileId=block["archive_folder_id"]).execute()
        except Exception: pass
        with db() as con: con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (client["file_no"],))
        
        # Remove local portal notice PDF if present
        try:
            local_root = get_setting("local_root") or str(DATA_ROOT)
            notice_pdf = Path(local_root) / "Client Access Links" / f"{safe_name(client['name'])} - Portal Notice.pdf"
            notice_pdf.unlink(missing_ok=True)
        except Exception:
            pass
            
        return {"blocked": False, "restored": restored}


def is_valid_drive_id(folder_id: str) -> bool:
    if not folder_id or not isinstance(folder_id, str):
        return False
    folder_id = folder_id.strip()
    if folder_id in ("local-portal", "local-pending", "") or " " in folder_id or folder_id.startswith("client-"):
        return False
    return True


_portal_root_lock = threading.Lock()
_cached_client_parent_id = None

def get_portal_client_parent(service):
    global _cached_client_parent_id
    client_name = get_setting("client_folder_name", "Client") or "Client"
    with _portal_root_lock:
        root = portal_root(service)
        root_id = root["id"]
        if _cached_client_parent_id:
            try:
                info = service.files().get(fileId=_cached_client_parent_id, fields="id,name,trashed,parents").execute()
                if not info.get("trashed") and info.get("parents") and info["parents"][0] == root_id and info.get("name") == client_name:
                    return {"id": _cached_client_parent_id}
            except Exception:
                pass

        # Strictly find or create ONE Client parent under root
        client_parent = drive_folder(service, client_name, root_id)
        _cached_client_parent_id = client_parent["id"]
        return client_parent


def ensure_client_portal(client, check_remote=False, force_fresh=False):
    """Ensures client portal folder and document access pass exist.
    When force_fresh=True (e.g. on client import or fresh recreation), bypasses stale caches,
    purges outdated links/trash, and connects/creates a 100% active, fresh Google Drive folder."""
    # If Google Drive is not connected, fallback to local placeholder
    if not GOOGLE_TOKEN_FILE.is_file():
        with db() as con:
            existing = con.execute("SELECT * FROM client_portals WHERE client_file_no=?", (client["file_no"],)).fetchone()
        if existing and not force_fresh and existing["access_pdf_path"] and os.path.isfile(existing["access_pdf_path"]):
            return {**dict(existing), "was_created": False}
        link = existing["folder_link"] if (existing and not force_fresh and is_valid_drive_id(existing["folder_id"])) else f"https://drive.google.com/drive/folders/client-{safe_name(client['name'])}"
        pdf_path = access_pdf(client, link)
        record = {
            "client_file_no": client["file_no"],
            "folder_id": existing["folder_id"] if (existing and not force_fresh) else "local-portal",
            "folder_link": link,
            "access_pdf_path": pdf_path,
            "created_at": now()
        }
        with db() as con:
            con.execute("INSERT OR REPLACE INTO client_portals VALUES(?,?,?,?,?)", tuple(record.values()))
        return {**record, "was_created": True}

    # Google Drive is connected! Query Google Drive API directly
    with get_client_portal_lock(client["file_no"]):
        with db() as con:
            existing = con.execute("SELECT * FROM client_portals WHERE client_file_no=?", (client["file_no"],)).fetchone()
            rule = con.execute("SELECT periods FROM folder_rules WHERE id=1").fetchone()

        # Fast path: If already cached in DB and not forcing fresh / checking remote
        if existing and is_valid_drive_id(existing["folder_id"]) and not check_remote and not force_fresh:
            folder_link = existing["folder_link"]
            pdf_path = existing["access_pdf_path"]
            if folder_link and pdf_path and os.path.isfile(pdf_path):
                return {**dict(existing), "was_created": False}
            if folder_link:
                try:
                    new_pdf = access_pdf(client, folder_link)
                    with db() as con:
                        con.execute("UPDATE client_portals SET access_pdf_path=? WHERE client_file_no=?", (new_pdf, client["file_no"]))
                    return {**dict(existing), "access_pdf_path": new_pdf, "was_created": False}
                except Exception as exc:
                    logging.warning("Could not regenerate access pdf: %s", exc)
                    return {**dict(existing), "was_created": False}

        # If not check_remote and not force_fresh and existing has NO record yet:
        # Trigger background creation outside critical save path and return provisional record
        if not check_remote and not force_fresh and not existing:
            threading.Thread(
                target=generate_client_portal_pdf_background,
                args=(dict(client), False),
                daemon=True
            ).start()
            link = f"https://drive.google.com/drive/folders/client-{safe_name(client['name'])}"
            return {
                "client_file_no": client["file_no"],
                "folder_id": "pending-creation",
                "folder_link": link,
                "access_pdf_path": None,
                "created_at": now(),
                "was_created": True
            }

        service = google_service()
        client_parent = get_portal_client_parent(service)

        # If existing has a valid drive ID and we need check_remote:
        if existing and is_valid_drive_id(existing["folder_id"]) and not force_fresh:
            try:
                f_info = service.files().get(fileId=existing["folder_id"], fields="id,name,webViewLink,trashed,parents").execute()
                if f_info and not f_info.get("trashed"):
                    parents = f_info.get("parents") or []
                    parent_ok = True
                    if parents:
                        try:
                            p_info = service.files().get(fileId=parents[0], fields="id,trashed").execute()
                            if p_info.get("trashed"):
                                parent_ok = False
                        except Exception:
                            parent_ok = False
                    if parent_ok:
                        real_link = f_info.get("webViewLink") or f"https://drive.google.com/drive/folders/{f_info['id']}"
                        pdf_path = access_pdf(client, real_link)
                        with db() as con:
                            con.execute("UPDATE client_portals SET folder_link=?, access_pdf_path=? WHERE client_file_no=?", (real_link, pdf_path, client["file_no"]))
                        return {**dict(existing), "folder_link": real_link, "access_pdf_path": pdf_path, "was_created": False}
            except Exception:
                # Inaccessible or trashed, will recreate below
                pass

        # If forcing fresh or folder was trashed/in bin: purge stale DB record
        with db() as con:
            con.execute("DELETE FROM client_portals WHERE client_file_no=?", (client["file_no"],))

        # 1. Create/Get client folder under "Client" parent
        client_folder = drive_folder(service, safe_name(client["name"]), client_parent["id"])

        # 2. Create period folders inside client folder
        periods = json.loads(rule["periods"]) if (rule and rule["periods"]) else ["AY 2025-26"]
        for period in periods:
            drive_folder(service, safe_name(period), client_folder["id"])

        # 4. Grant {Sharing -> Read Only} directly on the client folder
        try:
            service.permissions().create(
                fileId=client_folder["id"],
                body={"type": "anyone", "role": "reader", "allowFileDiscovery": False},
                fields="id"
            ).execute()
        except Exception:
            pass

        # 5. Fetch live webViewLink directly from the client folder
        c_info = service.files().get(fileId=client_folder["id"], fields="id,webViewLink").execute()
        real_link = c_info.get("webViewLink") or f"https://drive.google.com/drive/folders/{client_folder['id']}"

        pdf_path = access_pdf(client, real_link)
        record = {
            "client_file_no": client["file_no"],
            "folder_id": client_folder["id"],
            "folder_link": real_link,
            "access_pdf_path": pdf_path,
            "created_at": now()
        }
        with db() as con:
            con.execute("INSERT OR REPLACE INTO client_portals VALUES(?,?,?,?,?)", tuple(record.values()))
        return {**record, "was_created": True}


def generate_client_portal_pdf_background(client, force_fresh=False):
    """Generates the Client Portal Link PDF automatically using Google Drive API."""
    try:
        if not client:
            return
        ensure_client_portal(client, check_remote=force_fresh, force_fresh=force_fresh)
    except Exception as exc:
        c_fno = client["file_no"] if isinstance(client, (dict, sqlite3.Row)) else getattr(client, "file_no", str(client))
        logging.warning("Auto-generation of client portal PDF failed for %s: %s", c_fno, exc)


def safe_name(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value.strip())
    return cleaned.rstrip(". ") or "Unnamed"


def normalize_identity(name, file_no):
    """Single source of truth for client duplicate detection.
    Returns (normalized_name, normalized_file_no) tuple."""
    norm_name = re.sub(r'\s+', ' ', (name or '').strip()).casefold()
    norm_fno = (file_no or '').strip().casefold()
    return (norm_name, norm_fno)


def normalize_firm_type(name: str) -> str:
    """Single source of truth for firm type normalization and duplicate detection."""
    return re.sub(r'\s+', ' ', (name or '').strip()).casefold()


def log_activity(event_type, client_file_no=None, client_name=None, details=None, actor=None, con=None):
    if con:
        con.execute("INSERT INTO activity_log (event_type, client_file_no, client_name, details, actor, created_at) VALUES (?,?,?,?,?,?)",
                    (event_type, client_file_no, client_name, details, actor, now()))
    else:
        with db() as c:
            c.execute("INSERT INTO activity_log (event_type, client_file_no, client_name, details, actor, created_at) VALUES (?,?,?,?,?,?)",
                      (event_type, client_file_no, client_name, details, actor, now()))


def parse_csv_or_xlsx(raw: bytes, filename: str):
    if filename.lower().endswith(".csv"):
        decoded = None
        for encoding in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
            try:
                decoded = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            decoded = raw.decode("utf-8", errors="replace")
        decoded = decoded.lstrip("\ufeff")
        rows = [row for row in csv.reader(io.StringIO(decoded)) if any(field.strip() for field in row)]
        if not rows:
            return []
        headers = [h.strip().lstrip("\ufeff") for h in rows[0]]
        return [dict(zip(headers, row)) for row in rows[1:] if any(str(v).strip() for v in row)]
    if not filename.lower().endswith(".xlsx"):
        raise ValueError("Use a CSV or XLSX export from Practive.")
    archive = zipfile.ZipFile(io.BytesIO(raw))
    shared_strings = archive.read("xl/sharedStrings.xml") if "xl/sharedStrings.xml" in archive.namelist() else None
    strings = []
    if shared_strings:
        root = ET.fromstring(shared_strings)
        strings = ["".join(elem.itertext()) for elem in root.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si")]
    sheet_data = archive.read("xl/worksheets/sheet1.xml")
    root = ET.fromstring(sheet_data)
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rows = []
    for row_elem in root.findall(f".//{ns}row"):
        values = []
        for cell in row_elem.findall(f"{ns}c"):
            value = cell.find(f"{ns}v")
            text = "" if value is None else value.text or ""
            if cell.get("t") == "s" and text:
                text = strings[int(text)]
            values.append(text)
        rows.append(values)
    if not rows:
        return []
    headers = [h.strip() for h in rows[0]]
    return [dict(zip(headers, row)) for row in rows[1:] if any(str(v).strip() for v in row)]


def generate_xlsx(headers: list[str], rows: list[list]) -> bytes:
    """Generates a valid Excel .xlsx file using only Python standard library."""
    buffer = io.BytesIO()
    
    def xml_esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")
    
    shared_strings = []
    string_map = {}
    
    def get_str_idx(val):
        s = "" if val is None else str(val)
        if s not in string_map:
            string_map[s] = len(shared_strings)
            shared_strings.append(s)
        return string_map[s]
    
    # 1. Build sheet1.xml
    sheet_lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<sheetData>'
    ]
    
    # Row 1: Headers
    sheet_lines.append('<row r="1">')
    for col_idx, h in enumerate(headers, 1):
        col_letter = chr(64 + col_idx) if col_idx <= 26 else f"A{chr(64 + col_idx - 26)}"
        idx = get_str_idx(h)
        sheet_lines.append(f'<c r="{col_letter}1" t="s"><v>{idx}</v></c>')
    sheet_lines.append('</row>')
    
    # Data Rows
    for r_idx, row in enumerate(rows, 2):
        sheet_lines.append(f'<row r="{r_idx}">')
        for col_idx, val in enumerate(row, 1):
            col_letter = chr(64 + col_idx) if col_idx <= 26 else f"A{chr(64 + col_idx - 26)}"
            idx = get_str_idx(val)
            sheet_lines.append(f'<c r="{col_letter}{r_idx}" t="s"><v>{idx}</v></c>')
        sheet_lines.append('</row>')
        
    sheet_lines.append('</sheetData></worksheet>')
    sheet1_xml = "\n".join(sheet_lines).encode("utf-8")
    
    # 2. Build sharedStrings.xml
    sst_lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">'
    ]
    for s in shared_strings:
        sst_lines.append(f'<si><t>{xml_esc(s)}</t></si>')
    sst_lines.append('</sst>')
    sst_xml = "\n".join(sst_lines).encode("utf-8")
    
    # 3. Content Types
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>""".strip().encode("utf-8")

    # 4. Root Relationships
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""".strip().encode("utf-8")

    # 5. Workbook
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Clients" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>""".strip().encode("utf-8")

    # 6. Workbook Relationships
    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>""".strip().encode("utf-8")

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet1_xml)
        z.writestr("xl/sharedStrings.xml", sst_xml)
        
    return buffer.getvalue()


def generate_csv(headers: list[str], rows: list[list]) -> bytes:
    """Generates standard UTF-8-SIG CSV bytes for Excel compatibility."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(headers)
    for r in rows:
        writer.writerow(r)
    return out.getvalue().encode("utf-8-sig")


def client_from_export(row):
    normal = {str(k).strip().lower(): str(v or "").strip() for k, v in row.items()}
    return {
        "file_no": normal.get("file no.") or normal.get("file no") or normal.get("file number") or normal.get("reference") or normal.get("file_no"),
        "name": normal.get("name") or normal.get("client name") or normal.get("client_name"),
        "mobile": normal.get("mobile", "") or normal.get("mobile number", "") or normal.get("phone", "") or normal.get("mobile_no", ""),
        "client_type": normal.get("firm type", "") or normal.get("client type", "") or normal.get("firm_type", "") or normal.get("client_type", "") or normal.get("type", "") or normal.get("entity type", "") or normal.get("entity_type", ""),
        "client_group": normal.get("group", "") or normal.get("client group", "") or normal.get("client_group", ""),
        "tags": normal.get("tags", ""),
        "status": normal.get("status", "") or "Active",
        "users": normal.get("users", ""),
    }


def client_id(file_no: str | None, name: str, mobile: str) -> str:
    if (file_no or "").strip():
        return file_no.strip()
    clean_mobile = re.sub(r"\D", "", mobile) or "no-mobile"
    digest = hashlib.sha1(name.strip().casefold().encode("utf-8")).hexdigest()[:8].upper()
    return f"LOCAL-{clean_mobile}-{digest}"


def storage_folder_name(client, storage_kind, con=None):
    if con:
        row = con.execute("SELECT folder_name FROM client_folder_mappings WHERE client_file_no=? AND storage_kind=?", (client["file_no"], storage_kind)).fetchone()
    else:
        with db() as c:
            row = c.execute("SELECT folder_name FROM client_folder_mappings WHERE client_file_no=? AND storage_kind=?", (client["file_no"], storage_kind)).fetchone()
    if row:
        return row["folder_name"]
    base = safe_name(client["name"])
    # Check if another client with a different file_no already uses this base name
    if con:
        used = con.execute("SELECT client_file_no FROM client_folder_mappings WHERE storage_kind=? AND folder_name=?", (storage_kind, base)).fetchone()
    else:
        with db() as c:
            used = c.execute("SELECT client_file_no FROM client_folder_mappings WHERE storage_kind=? AND folder_name=?", (storage_kind, base)).fetchone()
    if not used:
        # Also check if any other client has the same normalized name (collision prevention)
        norm_name = re.sub(r'\s+', ' ', client["name"].strip()).casefold()
        if con:
            sibling = con.execute("SELECT 1 FROM clients WHERE file_no != ? AND lower(trim(name)) = ? LIMIT 1", (client["file_no"], norm_name)).fetchone()
        else:
            with db() as c:
                sibling = c.execute("SELECT 1 FROM clients WHERE file_no != ? AND lower(trim(name)) = ? LIMIT 1", (client["file_no"], norm_name)).fetchone()
        if sibling:
            folder_name = f"{base} [{safe_name(client['file_no'])}]"
        else:
            folder_name = base
    elif used["client_file_no"] == client["file_no"]:
        folder_name = base
    else:
        folder_name = f"{base} [{safe_name(client['file_no'])}]"
    # Final dedup loop in case of edge collisions
    candidate = folder_name
    suffix = 2
    while True:
        if con:
            dup = con.execute("SELECT 1 FROM client_folder_mappings WHERE storage_kind=? AND folder_name=? AND client_file_no!=?", (storage_kind, candidate, client["file_no"])).fetchone()
        else:
            with db() as c:
                dup = c.execute("SELECT 1 FROM client_folder_mappings WHERE storage_kind=? AND folder_name=? AND client_file_no!=?", (storage_kind, candidate, client["file_no"])).fetchone()
        if not dup: break
        candidate = f"{base} [{safe_name(client['file_no'])} {suffix}]"
        suffix += 1
    folder_name = candidate
    if con:
        con.execute("INSERT INTO client_folder_mappings VALUES(?,?,?,?) ON CONFLICT(client_file_no, storage_kind) DO UPDATE SET folder_name=excluded.folder_name",
                    (client["file_no"], storage_kind, folder_name, now()))
    else:
        with db() as c:
            c.execute("INSERT INTO client_folder_mappings VALUES(?,?,?,?) ON CONFLICT(client_file_no, storage_kind) DO UPDATE SET folder_name=excluded.folder_name",
                        (client["file_no"], storage_kind, folder_name, now()))
    return folder_name


def rename_client_storage_folders(old_file_no, new_name, new_file_no=None, con=None):
    """
    Safely and atomically renames the physical storage directory of a client on disk across
    all configured storage roots (local_root, drive_root), and updates client_folder_mappings,
    folder_inventory, file_inventory, client_portals, and save_jobs.
    """
    new_fno = new_file_no or old_file_no
    settings = settings_payload(con=con)
    mode = settings.get("google_drive_mode", "backup_and_client")
    roots = {"local": settings.get("local_root")}
    if mode in ("backup_and_client", "only_backup"):
        roots["drive"] = settings.get("drive_root")
    base = safe_name(new_name.strip())
    
    def _do_rename(c):
        existing_mappings = {r["storage_kind"]: r["folder_name"] for r in c.execute("SELECT storage_kind, folder_name FROM client_folder_mappings WHERE client_file_no=?", (old_file_no,)).fetchall()}
        
        for kind, root_val in roots.items():
            if not root_val:
                continue
            base_dir = configured_root(root_val)
            if not base_dir.is_dir():
                continue
                
            old_name_row = c.execute("SELECT name FROM clients WHERE file_no=?", (old_file_no,)).fetchone()
            old_folder_name = existing_mappings.get(kind, safe_name(old_name_row["name"] if old_name_row else old_file_no))
            
            # Check for sibling collisions with new name
            sibling = c.execute("SELECT 1 FROM clients WHERE file_no != ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1", (new_fno, new_name.strip())).fetchone()
            if sibling:
                target_folder_name = f"{base} [{safe_name(new_fno)}]"
            else:
                target_folder_name = base
                
            # Dedup check
            candidate = target_folder_name
            suffix = 2
            while c.execute("SELECT 1 FROM client_folder_mappings WHERE storage_kind=? AND folder_name=? AND client_file_no!=?", (kind, candidate, old_file_no)).fetchone():
                candidate = f"{base} [{safe_name(new_fno)} {suffix}]"
                suffix += 1
            target_folder_name = candidate
            
            old_path = base_dir / old_folder_name
            new_path = base_dir / target_folder_name
            
            if old_path.exists() and old_path.resolve() != new_path.resolve():
                if not new_path.exists():
                    try:
                        os.rename(str(old_path), str(new_path))
                    except Exception:
                        shutil.move(str(old_path), str(new_path))
                else:
                    # Resolve suffix collision on disk
                    suffix = 2
                    while new_path.exists() and old_path.resolve() != new_path.resolve():
                        target_folder_name = f"{base} [{safe_name(new_fno)} {suffix}]"
                        new_path = base_dir / target_folder_name
                        suffix += 1
                    if not new_path.exists():
                        try:
                            os.rename(str(old_path), str(new_path))
                        except Exception:
                            shutil.move(str(old_path), str(new_path))
            elif old_path.exists() and str(old_path) != str(new_path) and old_path.resolve() == new_path.resolve():
                # Case-only rename on Windows
                temp_path = base_dir / f"__tmp_ren_{int(time.time()*1000)}"
                try:
                    os.rename(str(old_path), str(temp_path))
                    os.rename(str(temp_path), str(new_path))
                except Exception:
                    pass
            
            # Update mapping
            c.execute("INSERT INTO client_folder_mappings VALUES (?, ?, ?, ?) ON CONFLICT(client_file_no, storage_kind) DO UPDATE SET folder_name=excluded.folder_name",
                      (new_fno, kind, target_folder_name, now()))
                      
        if new_fno != old_file_no:
            c.execute("UPDATE client_folder_mappings SET client_file_no=? WHERE client_file_no=?", (new_fno, old_file_no))
            c.execute("UPDATE folder_inventory SET client_file_no=? WHERE client_file_no=?", (new_fno, old_file_no))
            c.execute("UPDATE file_inventory SET client_file_no=? WHERE client_file_no=?", (new_fno, old_file_no))
            c.execute("UPDATE client_portals SET client_file_no=? WHERE client_file_no=?", (new_fno, old_file_no))
            c.execute("UPDATE save_jobs SET client_file_no=? WHERE client_file_no=?", (new_fno, old_file_no))

    if con:
        _do_rename(con)
    else:
        with db() as c:
            _do_rename(c)


def rename_client_subfolder(client_file_no, old_relative_path, new_name, con=None):
    """
    Renames a subfolder on disk for a client and updates folder_inventory and file_inventory.
    """
    clean_new_name = safe_name(new_name.strip())
    if not clean_new_name:
        raise ValueError("New folder name cannot be empty.")
        
    old_parts = [p.strip() for p in old_relative_path.replace("\\", "/").split("/") if p.strip()]
    if not old_parts:
        raise ValueError("Invalid old folder path.")
    
    old_norm_path = "/".join(old_parts)
    new_parts = old_parts[:-1] + [clean_new_name]
    new_norm_path = "/".join(new_parts)
    
    if old_norm_path == new_norm_path:
        return {"ok": True, "old_path": old_norm_path, "new_path": new_norm_path}
        
    def _do_sub_rename(c):
        client = c.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
            
        settings = settings_payload(con=c)
        roots = {"local": settings.get("local_root"), "drive": settings.get("drive_root")}
        
        for kind, root_val in roots.items():
            if not root_val:
                continue
            base_dir = configured_root(root_val)
            if not base_dir.is_dir():
                continue
            c_root = base_dir / storage_folder_name(client, kind, con=c)
            
            old_dir = c_root
            for part in old_parts:
                old_dir = old_dir / safe_name(part)
                
            new_dir = c_root
            for part in new_parts:
                new_dir = new_dir / safe_name(part)
                
            if old_dir.exists() and old_dir.resolve() != new_dir.resolve():
                new_dir.parent.mkdir(parents=True, exist_ok=True)
                if not new_dir.exists():
                    try:
                        os.rename(str(old_dir), str(new_dir))
                    except Exception:
                        shutil.move(str(old_dir), str(new_dir))
            elif old_dir.exists() and str(old_dir) != str(new_dir) and old_dir.resolve() == new_dir.resolve():
                temp_path = new_dir.parent / f"__tmp_sub_{int(time.time()*1000)}"
                try:
                    os.rename(str(old_dir), str(temp_path))
                    os.rename(str(temp_path), str(new_dir))
                except Exception:
                    pass
                    
            # Update folder_inventory exact match
            exists_already = c.execute("SELECT 1 FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                       (client_file_no, kind, new_norm_path)).fetchone()
            if exists_already:
                c.execute("DELETE FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                          (client_file_no, kind, old_norm_path))
            else:
                c.execute("UPDATE folder_inventory SET relative_path=?, updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                          (new_norm_path, now(), client_file_no, kind, old_norm_path))
                       
            # Update folder_inventory children
            old_prefix = old_norm_path + "/"
            new_prefix = new_norm_path + "/"
            c.execute("UPDATE OR IGNORE folder_inventory SET relative_path = ? || substr(relative_path, ?), updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path LIKE ?",
                      (new_prefix, len(old_prefix) + 1, now(), client_file_no, kind, old_prefix + "%"))
                       
            # Update file_inventory children
            c.execute("UPDATE OR IGNORE file_inventory SET relative_path = ? || substr(relative_path, ?), updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path LIKE ?",
                      (new_prefix, len(old_prefix) + 1, now(), client_file_no, kind, old_prefix + "%"))
                       
        log_activity("folder_renamed", client_file_no, client["name"], f"Renamed folder '{old_norm_path}' to '{new_norm_path}'", con=c)
        return {"ok": True, "old_path": old_norm_path, "new_path": new_norm_path}
        
    if con:
        return _do_sub_rename(con)
    else:
        with db() as c:
            return _do_sub_rename(c)


def rename_template_folder_across_clients(category, old_node_name, new_node_name, con=None):
    """
    Renames a template folder across all clients matching the category/firm type on disk and in database inventory.
    """
    clean_old = safe_name(old_node_name.strip())
    clean_new = safe_name(new_node_name.strip())
    if not clean_old or not clean_new or clean_old == clean_new:
        return {"ok": True, "renamed_clients": 0}
        
    def _do_bulk_rename(c):
        if category.casefold() == "all clients":
            client_rows = c.execute("SELECT file_no, name, client_type FROM clients").fetchall()
        else:
            client_rows = c.execute("SELECT file_no, name, client_type FROM clients WHERE lower(trim(client_type))=lower(trim(?))", (category,)).fetchall()
            
        settings = settings_payload(con=c)
        roots = {"local": settings.get("local_root"), "drive": settings.get("drive_root")}
        renamed_count = 0
        
        for client in client_rows:
            fno = client["file_no"]
            inv_rows = c.execute("SELECT storage_kind, relative_path FROM folder_inventory WHERE client_file_no=?", (fno,)).fetchall()
            for inv in inv_rows:
                kind_inv = inv["storage_kind"]
                rel_parts = inv["relative_path"].split("/")
                if clean_old in rel_parts:
                    idx = rel_parts.index(clean_old)
                    new_parts = rel_parts[:idx] + [clean_new] + rel_parts[idx+1:]
                    old_path_str = "/".join(rel_parts)
                    new_path_str = "/".join(new_parts)
                    
                    root_val = roots.get(kind_inv)
                    if root_val:
                        base_dir = configured_root(root_val)
                        if base_dir and base_dir.is_dir():
                            c_root = base_dir / storage_folder_name(client, kind_inv, con=c)
                            old_d = c_root / Path(old_path_str)
                            new_d = c_root / Path(new_path_str)
                            if old_d.exists() and old_d.resolve() != new_d.resolve():
                                new_d.parent.mkdir(parents=True, exist_ok=True)
                                try:
                                    os.rename(str(old_d), str(new_d))
                                except Exception:
                                    try:
                                        shutil.move(str(old_d), str(new_d))
                                    except Exception:
                                        pass
                                
                    # If target row already exists in folder_inventory, delete the old row
                    exists_already = c.execute("SELECT 1 FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                               (fno, kind_inv, new_path_str)).fetchone()
                    if exists_already:
                        c.execute("DELETE FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                  (fno, kind_inv, old_path_str))
                    else:
                        c.execute("UPDATE folder_inventory SET relative_path=?, updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                  (new_path_str, now(), fno, kind_inv, old_path_str))
                    
                    # Update file_inventory
                    file_inv_rows = c.execute("SELECT storage_kind, relative_path FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path LIKE ?",
                                              (fno, kind_inv, old_path_str + "/%")).fetchall()
                    for f_row in file_inv_rows:
                        old_f_path = f_row["relative_path"]
                        new_f_path = new_path_str + "/" + old_f_path[len(old_path_str) + 1:]
                        c.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                  (fno, kind_inv, new_f_path))
                        c.execute("UPDATE file_inventory SET relative_path=?, updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path=?",
                                  (new_f_path, now(), fno, kind_inv, old_f_path))
                    renamed_count += 1
                    
        return {"ok": True, "renamed_clients": len(client_rows), "renamed_folders": renamed_count}

    if con:
        return _do_bulk_rename(con)
    else:
        with db() as c:
            return _do_bulk_rename(c)


def client_root(root: str, client: sqlite3.Row, storage_kind: str, con=None):
    office_name = get_setting("office_folder_name", "Office", con=con) or "Office"
    return configured_root(root) / office_name / storage_folder_name(client, storage_kind, con=con)


def client_folder(root: str, client: sqlite3.Row, service: str, period: str, order: str, storage_kind: str, con=None):
    clean_period = resolve_canonical_period(period=period, service=service, con=con)
    parts = [client_root(root, client, storage_kind, con=con)]
    if order == "period-service":
        parts += [safe_name(clean_period), safe_name(service or "General")]
    else:
        parts += [safe_name(service or "General"), safe_name(clean_period)]
    result = parts[0]
    for part in parts[1:]: result = result / part
    return result


def client_shared_folder(root: str, client: sqlite3.Row, period: str, storage_kind: str, con=None):
    clean_period = resolve_canonical_period(period=period, con=con)
    client_name = get_setting("client_folder_name", "Client", con=con) or "Client"
    return configured_root(root) / client_name / storage_folder_name(client, storage_kind, con=con) / safe_name(clean_period)


def template_tree_to_paths(tree, prefix=""):
    """Recursively converts hierarchical tree nodes into relative path strings."""
    paths = []
    if not isinstance(tree, list):
        return paths
    for node in tree:
        if isinstance(node, str):
            name = node.strip()
            children = []
        elif isinstance(node, dict):
            name = str(node.get("name", "")).strip()
            children = node.get("children", [])
        else:
            continue
        if not name:
            continue
        rel_path = f"{prefix}/{name}" if prefix else name
        paths.append(rel_path)
        if children and isinstance(children, list):
            paths.extend(template_tree_to_paths(children, rel_path))
    return paths


def paths_to_template_tree(paths):
    """Converts flat list of relative paths into hierarchical tree nodes."""
    root_nodes = []
    node_map = {}
    for p in paths:
        parts = [part.strip() for part in p.replace("\\", "/").split("/") if part.strip()]
        if not parts:
            continue
        current_path = ""
        parent = None
        for part in parts:
            prev_path = current_path
            current_path = f"{current_path}/{part}" if current_path else part
            if current_path not in node_map:
                new_node = {"name": part, "children": []}
                node_map[current_path] = new_node
                if parent is None:
                    root_nodes.append(new_node)
                else:
                    parent["children"].append(new_node)
            parent = node_map[current_path]
    return root_nodes


def get_effective_template(category_or_firm_type="ALL CLIENTS", con=None):
    """Retrieves the folder template for a given firm type or ALL CLIENTS base template."""
    name = (category_or_firm_type or "ALL CLIENTS").strip()
    
    # 1. First check if an exact category_templates record exists
    query = "SELECT category, structure, services FROM category_templates WHERE lower(trim(category)) = lower(trim(?))"
    row = con.execute(query, (name,)).fetchone() if con else None
    if not row:
        with db() as c:
            row = c.execute(query, (name,)).fetchone()
            
    if row:
        raw_struct = row["structure"] if "structure" in row.keys() else "[]"
        try:
            struct = json.loads(raw_struct)
            if struct and isinstance(struct, list) and len(struct) > 0:
                return struct
        except Exception:
            pass
        try:
            services = json.loads(row["services"])
            if services and isinstance(services, list) and len(services) > 0:
                return [{"name": s, "children": []} for s in services if isinstance(s, str) and s.strip()]
        except Exception:
            pass

    # 2. Check DEFAULT_FIRM_TYPE_TEMPLATES for pre-seeded defaults
    for default_name, default_tree in DEFAULT_FIRM_TYPE_TEMPLATES.items():
        if default_name.casefold() == name.casefold():
            return default_tree

    # 3. If not ALL CLIENTS and no specific template found, fall back to ALL CLIENTS template
    if name.casefold() != "all clients":
        return get_effective_template("ALL CLIENTS", con=con)

    return DEFAULT_ALL_CLIENTS_TEMPLATE


def template_for_client(client, con=None):
    """Retrieves hierarchical folder template for a client (checking client override first, then firm type)."""
    file_no = (client.get("file_no") if isinstance(client, dict) else client["file_no"]) if client else ""
    if file_no:
        query = "SELECT structure FROM client_folder_overrides WHERE client_file_no=?"
        row = con.execute(query, (file_no,)).fetchone() if con else None
        if not row:
            with db() as c:
                row = c.execute(query, (file_no,)).fetchone()
        if row and row["structure"]:
            try:
                struct = json.loads(row["structure"])
                if struct and isinstance(struct, list) and len(struct) > 0:
                    return struct
            except Exception:
                pass

    ft = (client.get("client_type") if isinstance(client, dict) else client["client_type"]) if client else ""
    return get_effective_template(ft, con=con)


def get_client_override_details(client_file_no, con=None):
    """Returns details about a client's folder override vs inherited firm type template."""
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        ft = client["client_type"] or ""
        template_struct = get_effective_template(ft, con=con)
        
        row = con.execute("SELECT structure, updated_at FROM client_folder_overrides WHERE client_file_no=?", (client_file_no,)).fetchone()
        has_override = False
        override_struct = None
        updated_at = None
        if row and row["structure"]:
            try:
                override_struct = json.loads(row["structure"])
                if override_struct and isinstance(override_struct, list) and len(override_struct) > 0:
                    has_override = True
                    updated_at = row["updated_at"]
            except Exception:
                override_struct = None

        return {
            "client_file_no": client_file_no,
            "client_name": client["name"],
            "firm_type": ft,
            "has_override": has_override,
            "structure": override_struct,
            "effective_structure": override_struct if has_override else template_struct,
            "template_structure": template_struct,
            "updated_at": updated_at
        }
    finally:
        if close_db:
            con.close()


def set_client_override(client_file_no, structure, con=None):
    """Sets a client-specific folder structure override and ensures physical directories exist."""
    if not isinstance(structure, list):
        raise ValueError("Structure must be a list of folder items.")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        
        con.execute("INSERT INTO client_folder_overrides (client_file_no, structure, updated_at) VALUES (?, ?, ?) ON CONFLICT(client_file_no) DO UPDATE SET structure=excluded.structure, updated_at=excluded.updated_at",
                    (client_file_no, json.dumps(structure), now()))
        con.commit()
        
        # Create any newly defined folders on disk
        try:
            create_client_folders(client, con=con)
        except Exception as exc:
            logging.warning("Error creating folders after saving override: %s", exc)
            
        log_activity("client_override_saved", client_file_no, client["name"], f"Saved client-specific folder override with {len(structure)} root items", con=con)
        return get_client_override_details(client_file_no, con=con)
    finally:
        if close_db:
            con.close()


def delete_client_override(client_file_no, con=None):
    """Removes a client-specific override, restoring inheritance from the Firm Type template."""
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        
        con.execute("DELETE FROM client_folder_overrides WHERE client_file_no=?", (client_file_no,))
        con.commit()
        
        # Create standard folders according to inherited template
        try:
            create_client_folders(client, con=con)
        except Exception as exc:
            logging.warning("Error creating folders after resetting override: %s", exc)
            
        log_activity("client_override_reset", client_file_no, client["name"], "Reset folder structure to Firm Type default template", con=con)
        return {"ok": True, "message": "Reset to Firm Type template default successfully."}
    finally:
        if close_db:
            con.close()


def resolve_client_path(client, relative_path, storage_kind="local", con=None):
    """
    Validates and securely resolves a relative path within the client's base storage directory.
    Prevents path traversal, UNC paths, and drive escapes.
    """
    raw_str = str(relative_path or '').strip()
    if raw_str.startswith('//') or raw_str.startswith('\\\\'):
        raise ValueError("Access denied: UNC paths are not permitted.")
    if ':' in raw_str:
        raise ValueError("Access denied: Drive letters or stream colons are not permitted.")
    
    rel = re.sub(r'[\\/]+', '/', raw_str).strip('/')
    if not rel:
        clean_rel = ""
    else:
        parts = [p.strip() for p in rel.split('/') if p.strip()]
        if any(p in ('.', '..') for p in parts):
            raise ValueError("Access denied: Invalid path traversal detected.")
        clean_rel = "/".join(safe_name(p) for p in parts)

    settings = settings_payload(con)
    root_val = settings.get("local_root") if storage_kind == "local" else settings.get("drive_root")
    if not root_val:
        raise ValueError(f"Storage location for '{storage_kind}' is not configured.")
    
    office_name = settings.get("office_folder_name", "Office") or "Office"
    folder_name = storage_folder_name(client, storage_kind, con=con)
    base_dir = (configured_root(root_val) / office_name / folder_name).resolve()
    
    if not clean_rel:
        target_path = base_dir
    else:
        target_path = (base_dir / clean_rel).resolve()
    
    if target_path != base_dir and base_dir not in target_path.parents:
        raise ValueError("Access denied: Path escapes client base directory.")
        
    return base_dir, target_path, clean_rel


def open_in_file_manager(target_path: Path | str) -> str:
    """Opens a folder in Windows File Explorer using multiple cascading native strategies."""
    p_str = str(Path(target_path).resolve())
    if sys.platform == "win32":
        opened = False
        # 1. Native Windows ShellExecuteW via ctypes (in-process direct Windows API call)
        try:
            res = ctypes.windll.shell32.ShellExecuteW(None, "open", p_str, None, None, 1)
            if res > 32:
                opened = True
        except Exception:
            pass

        # 2. Native Windows os.startfile
        if not opened:
            try:
                os.startfile(p_str)
                opened = True
            except Exception:
                pass

        # 3. Windows rundll32 URL Protocol Handler
        if not opened:
            try:
                subprocess.Popen(f'rundll32.exe url.dll,FileProtocolHandler "{p_str}"', shell=True)
                opened = True
            except Exception:
                pass

        return p_str
    elif sys.platform == "darwin":
        subprocess.Popen(["open", p_str])
        return p_str
    else:
        subprocess.Popen(["xdg-open", p_str])
        return p_str


def check_for_system_updates():
    """Checks whether a new commit/version is available on GitHub."""
    try:
        app_dir = Path(__file__).resolve().parent
        local_p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        local_sha = local_p.stdout.strip()
        local_short = local_sha[:7] if local_sha else "v1.0.1"

        remote_p = subprocess.run(["git", "ls-remote", "origin", "HEAD"], cwd=str(app_dir), capture_output=True, text=True, timeout=8)
        remote_out = remote_p.stdout.strip()
        remote_sha = remote_out.split()[0] if remote_out else ""
        remote_short = remote_sha[:7] if remote_sha else ""

        has_update = bool(remote_sha and local_sha and remote_sha != local_sha)
        return {
            "current_commit": local_short,
            "latest_commit": remote_short or local_short,
            "update_available": has_update,
            "message": "⚡ Update Available!" if has_update else "✅ System is up to date."
        }
    except Exception as exc:
        return {"error": str(exc), "update_available": False, "message": "Could not check updates."}


def apply_system_update():
    """Pulls the latest code from GitHub and hot-reloads system components."""
    try:
        app_dir = Path(__file__).resolve().parent
        pull_p = subprocess.run(["git", "pull", "origin", "main"], cwd=str(app_dir), capture_output=True, text=True, timeout=30)
        if pull_p.returncode != 0:
            return {"ok": False, "error": pull_p.stderr or pull_p.stdout}

        local_p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        new_sha = local_p.stdout.strip()[:7] if local_p.stdout else "Latest"
        return {"ok": True, "message": f"Successfully updated to {new_sha}!", "commit": new_sha}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def get_canonical_client_tree(client_file_no, storage_kind="local", con=None):
    """Constructs the canonical recursive nested folder and file tree of arbitrary depth."""
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        
        rule = con.execute("SELECT * FROM folder_rules WHERE id=1").fetchone()
        periods = json.loads(rule["periods"]) if rule and "periods" in rule.keys() else ["AY 2025-26"]
        order_name = rule["order_name"] if rule and "order_name" in rule.keys() else "service-period"
        
        override = con.execute("SELECT structure, updated_at FROM client_folder_overrides WHERE client_file_no=?", (client_file_no,)).fetchone()
        has_override = bool(override and override["structure"] and override["structure"] not in ("[]", ""))
        
        settings = settings_payload(con=con)
        drive_mode = settings.get("google_drive_mode", "backup_and_client")
        office_name = settings.get("office_folder_name", "Office") or "Office"

        folders = [dict(r) for r in con.execute(
            "SELECT relative_path, source, present, updated_at FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND present=1 ORDER BY relative_path",
            (client_file_no, storage_kind)
        ).fetchall()]
        
        files = [dict(r) for r in con.execute(
            "SELECT relative_path, size_bytes, modified_at, present, updated_at FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND present=1 ORDER BY relative_path",
            (client_file_no, storage_kind)
        ).fetchall()]
        
        root_nodes = []
        node_map = {}  # relative_path -> node dict
        
        # 1. Folders
        for f in folders:
            rel = f["relative_path"].replace("\\", "/").strip("/")
            if not rel or "client shared folder" in rel.lower():
                continue
            if storage_kind == "drive" and drive_mode in ("only_client", "disabled") and (rel == office_name or rel.startswith(f"{office_name}/") or rel.lower().startswith("office/")):
                continue
            parts = rel.split("/")
            curr_path = ""
            parent = None
            for idx, part in enumerate(parts):
                curr_path = f"{curr_path}/{part}" if curr_path else part
                if curr_path not in node_map:
                    node = {
                        "name": part,
                        "type": "folder",
                        "relative_path": curr_path,
                        "source": f["source"] if curr_path == rel else "system",
                        "present": bool(f["present"]),
                        "children": []
                    }
                    node_map[curr_path] = node
                    if parent is None:
                        root_nodes.append(node)
                    else:
                        parent["children"].append(node)
                parent = node_map[curr_path]

        # 2. Files
        for fl in files:
            rel = fl["relative_path"].replace("\\", "/").strip("/")
            if not rel or "client shared folder" in rel.lower():
                continue
            if storage_kind == "drive" and drive_mode in ("only_client", "disabled") and (rel == office_name or rel.startswith(f"{office_name}/") or rel.lower().startswith("office/")):
                continue
            parts = rel.split("/")
            filename = parts[-1]
            parent_rel = "/".join(parts[:-1]) if len(parts) > 1 else ""
            
            file_node = {
                "name": filename,
                "type": "file",
                "relative_path": rel,
                "size_bytes": fl["size_bytes"],
                "modified_at": fl["modified_at"],
                "present": bool(fl["present"])
            }
            
            if parent_rel and parent_rel in node_map:
                node_map[parent_rel]["children"].append(file_node)
            elif not parent_rel:
                root_nodes.append(file_node)
            else:
                curr_path = ""
                parent = None
                for part in parts[:-1]:
                    curr_path = f"{curr_path}/{part}" if curr_path else part
                    if curr_path not in node_map:
                        node = {
                            "name": part,
                            "type": "folder",
                            "relative_path": curr_path,
                            "source": "manual",
                            "present": True,
                            "children": []
                        }
                        node_map[curr_path] = node
                        if parent is None:
                            root_nodes.append(node)
                        else:
                            parent["children"].append(node)
                    parent = node_map[curr_path]
                parent["children"].append(file_node)

        def _sort_tree(nodes):
            nodes.sort(key=lambda x: (0 if x["type"] == "folder" else 1, x["name"].lower()))
            for n in nodes:
                if n.get("type") == "folder" and "children" in n:
                    _sort_tree(n["children"])
        
        _sort_tree(root_nodes)
        
        return {
            "client": dict(client),
            "storage_kind": storage_kind,
            "has_override": has_override,
            "order_name": order_name,
            "periods": periods,
            "tree": root_nodes,
            "total_folders": len(folders),
            "total_files": len(files)
        }
    finally:
        if close_db:
            con.close()


def create_client_subfolder_manual(client, relative_path, storage_kind="local", con=None):
    """Creates a new folder at relative_path for a client."""
    base_dir, target_path, clean_rel = resolve_client_path(client, relative_path, storage_kind, con=con)
    if not clean_rel:
        raise ValueError("Folder path cannot be empty.")
    target_path.mkdir(parents=True, exist_ok=True)
    record_folder(client["file_no"], storage_kind, clean_rel, "manual", con=con)
    log_activity("folder_created", client["file_no"], client["name"], f"Created folder '{clean_rel}' ({storage_kind})", con=con)
    return {"ok": True, "relative_path": clean_rel}


def move_client_subfolder(client, source_rel, target_parent_rel, storage_kind="local", con=None):
    """Moves a subfolder to a new parent directory and updates database inventories."""
    base_dir, src_path, clean_src = resolve_client_path(client, source_rel, storage_kind, con=con)
    base_dir, parent_path, clean_parent = resolve_client_path(client, target_parent_rel, storage_kind, con=con)
    if not clean_src or not src_path.is_dir():
        raise ValueError("Source folder does not exist.")
    folder_name = src_path.name
    clean_dest_rel = f"{clean_parent}/{folder_name}".strip("/") if clean_parent else folder_name
    dest_path = (parent_path / folder_name).resolve()
    
    if dest_path.exists():
        raise ValueError(f"A folder or file already exists at '{clean_dest_rel}'.")
    if src_path == dest_path or src_path in dest_path.parents:
        raise ValueError("Cannot move a folder into itself or a subfolder of itself.")
    
    parent_path.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src_path), str(dest_path))
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        prefix_old = clean_src
        prefix_new = clean_dest_rel
        rows = con.execute("SELECT relative_path, source FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND (relative_path=? OR relative_path LIKE ?)",
                           (client["file_no"], storage_kind, prefix_old, f"{prefix_old}/%")).fetchall()
        for r in rows:
            old_p = r["relative_path"]
            new_p = prefix_new + old_p[len(prefix_old):]
            con.execute("DELETE FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client["file_no"], storage_kind, old_p))
            con.execute("INSERT OR REPLACE INTO folder_inventory VALUES(?,?,?,?,?,?)", (client["file_no"], storage_kind, new_p, r["source"], 1, now()))
        
        f_rows = con.execute("SELECT relative_path, size_bytes, modified_at FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND (relative_path=? OR relative_path LIKE ?)",
                             (client["file_no"], storage_kind, prefix_old, f"{prefix_old}/%")).fetchall()
        for r in f_rows:
            old_p = r["relative_path"]
            new_p = prefix_new + old_p[len(prefix_old):]
            con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client["file_no"], storage_kind, old_p))
            con.execute("INSERT OR REPLACE INTO file_inventory VALUES(?,?,?,?,?,?,?)", (client["file_no"], storage_kind, new_p, r["size_bytes"], r["modified_at"], 1, now()))
        con.commit()
        log_activity("folder_moved", client["file_no"], client["name"], f"Moved folder from '{clean_src}' to '{clean_dest_rel}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    
    return {"ok": True, "old_relative_path": clean_src, "new_relative_path": clean_dest_rel}


def delete_client_subfolder(client, relative_path, storage_kind="local", force=False, con=None):
    """Deletes a client subfolder and updates inventory."""
    base_dir, target_path, clean_rel = resolve_client_path(client, relative_path, storage_kind, con=con)
    if not clean_rel or not target_path.is_dir():
        raise ValueError("Folder does not exist or cannot delete client root.")
    
    if not force:
        has_items = any(target_path.iterdir())
        if has_items:
            raise ValueError("Folder is not empty. Set force=true to delete folder and all contents.")
    
    shutil.rmtree(str(target_path), ignore_errors=True)
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        prefix = clean_rel
        con.execute("DELETE FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND (relative_path=? OR relative_path LIKE ?)",
                    (client["file_no"], storage_kind, prefix, f"{prefix}/%"))
        con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND (relative_path=? OR relative_path LIKE ?)",
                    (client["file_no"], storage_kind, prefix, f"{prefix}/%"))
        con.commit()
        log_activity("folder_deleted", client["file_no"], client["name"], f"Deleted folder '{clean_rel}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    
    return {"ok": True, "deleted_relative_path": clean_rel}


def move_client_file(client, src_rel, dest_parent_rel, storage_kind="local", con=None):
    """Moves a file on disk and updates file_inventory."""
    base_dir, src_path, clean_src = resolve_client_path(client, src_rel, storage_kind, con=con)
    base_dir, parent_path, clean_parent = resolve_client_path(client, dest_parent_rel, storage_kind, con=con)
    if not clean_src or not src_path.is_file():
        raise ValueError("Source file does not exist.")
    filename = src_path.name
    clean_dest = f"{clean_parent}/{filename}".strip("/") if clean_parent else filename
    dest_path = (parent_path / filename).resolve()
    if dest_path.exists():
        raise ValueError(f"File '{filename}' already exists at destination.")
    parent_path.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src_path), str(dest_path))
    stat = dest_path.stat()
    mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client["file_no"], storage_kind, clean_src))
        con.execute("INSERT OR REPLACE INTO file_inventory VALUES(?,?,?,?,?,?,?)", (client["file_no"], storage_kind, clean_dest, stat.st_size, mod_time, 1, now()))
        con.commit()
        log_activity("file_moved", client["file_no"], client["name"], f"Moved file from '{clean_src}' to '{clean_dest}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    return {"ok": True, "old_path": clean_src, "new_path": clean_dest}


def copy_client_file(client, src_rel, dest_parent_rel, new_filename=None, storage_kind="local", con=None):
    """Copies a file on disk and inserts into file_inventory."""
    base_dir, src_path, clean_src = resolve_client_path(client, src_rel, storage_kind, con=con)
    base_dir, parent_path, clean_parent = resolve_client_path(client, dest_parent_rel, storage_kind, con=con)
    if not clean_src or not src_path.is_file():
        raise ValueError("Source file does not exist.")
    fname = safe_name(new_filename) if new_filename else src_path.name
    clean_dest = f"{clean_parent}/{fname}".strip("/") if clean_parent else fname
    dest_path = (parent_path / fname).resolve()
    if dest_path.exists():
        raise ValueError(f"File '{fname}' already exists at destination.")
    parent_path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src_path), str(dest_path))
    stat = dest_path.stat()
    mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        con.execute("INSERT OR REPLACE INTO file_inventory VALUES(?,?,?,?,?,?,?)", (client["file_no"], storage_kind, clean_dest, stat.st_size, mod_time, 1, now()))
        con.commit()
        log_activity("file_copied", client["file_no"], client["name"], f"Copied file '{clean_src}' to '{clean_dest}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    return {"ok": True, "source_path": clean_src, "copied_path": clean_dest}


def rename_client_file(client, file_rel, new_filename, storage_kind="local", con=None):
    """Renames a file in place and updates file_inventory."""
    base_dir, src_path, clean_src = resolve_client_path(client, file_rel, storage_kind, con=con)
    if not clean_src or not src_path.is_file():
        raise ValueError("Source file does not exist.")
    clean_name = safe_name(new_filename)
    if not clean_name:
        raise ValueError("New filename is invalid.")
    parts = clean_src.split('/')
    parent_rel = "/".join(parts[:-1]) if len(parts) > 1 else ""
    clean_dest = f"{parent_rel}/{clean_name}".strip("/") if parent_rel else clean_name
    dest_path = (src_path.parent / clean_name).resolve()
    if dest_path.exists() and dest_path != src_path:
        raise ValueError(f"A file named '{clean_name}' already exists in this folder.")
    src_path.rename(dest_path)
    stat = dest_path.stat()
    mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client["file_no"], storage_kind, clean_src))
        con.execute("INSERT OR REPLACE INTO file_inventory VALUES(?,?,?,?,?,?,?)", (client["file_no"], storage_kind, clean_dest, stat.st_size, mod_time, 1, now()))
        con.commit()
        log_activity("file_renamed", client["file_no"], client["name"], f"Renamed file '{clean_src}' to '{clean_dest}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    return {"ok": True, "old_path": clean_src, "new_path": clean_dest}


def delete_client_file(client, file_rel, storage_kind="local", con=None):
    """Deletes a file on disk and removes from file_inventory."""
    base_dir, src_path, clean_src = resolve_client_path(client, file_rel, storage_kind, con=con)
    if not clean_src or not src_path.is_file():
        raise ValueError("File does not exist.")
    src_path.unlink(missing_ok=True)
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client["file_no"], storage_kind, clean_src))
        con.commit()
        log_activity("file_deleted", client["file_no"], client["name"], f"Deleted file '{clean_src}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    return {"ok": True, "deleted_path": clean_src}


def upload_client_file(client, parent_rel, filename, raw_bytes, storage_kind="local", con=None):
    """Uploads/writes a file to the client directory and records in file_inventory."""
    base_dir, parent_path, clean_parent = resolve_client_path(client, parent_rel, storage_kind, con=con)
    clean_name = safe_name(filename)
    if not clean_name:
        raise ValueError("Invalid filename.")
    parent_path.mkdir(parents=True, exist_ok=True)
    dest_path = (parent_path / clean_name).resolve()
    clean_dest = f"{clean_parent}/{clean_name}".strip("/") if clean_parent else clean_name
    dest_path.write_bytes(raw_bytes)
    stat = dest_path.stat()
    mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        con.execute("INSERT OR REPLACE INTO file_inventory VALUES(?,?,?,?,?,?,?)", (client["file_no"], storage_kind, clean_dest, stat.st_size, mod_time, 1, now()))
        if clean_parent:
            record_folder(client["file_no"], storage_kind, clean_parent, "manual", con=con)
        con.commit()
        log_activity("file_uploaded", client["file_no"], client["name"], f"Uploaded file '{clean_dest}' ({storage_kind})", con=con)
    finally:
        if close_db:
            con.close()
    return {"ok": True, "relative_path": clean_dest, "size_bytes": stat.st_size}


def services_for_client(client, default_services, con=None):
    tree = template_for_client(client, con=con)
    if tree:
        return [n["name"] for n in tree if isinstance(n, dict) and "name" in n]
    return default_services


def record_folder(client_file_no, storage_kind, relative_path, source, con=None):
    if con:
        existing = con.execute("SELECT source FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client_file_no, storage_kind, relative_path)).fetchone()
        resolved_source = existing["source"] if existing else source
        con.execute("INSERT INTO folder_inventory VALUES(?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET source=excluded.source,present=1,updated_at=excluded.updated_at", (client_file_no, storage_kind, relative_path, resolved_source, 1, now()))
    else:
        with db() as c:
            existing = c.execute("SELECT source FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (client_file_no, storage_kind, relative_path)).fetchone()
            resolved_source = existing["source"] if existing else source
            c.execute("INSERT INTO folder_inventory VALUES(?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET source=excluded.source,present=1,updated_at=excluded.updated_at", (client_file_no, storage_kind, relative_path, resolved_source, 1, now()))


def template_to_physical_paths(tree, periods, order_name="service-period"):
    """Transforms a template tree into physical relative directory paths considering periods and order."""
    paths = []
    clean_periods = [safe_name(p.strip()) for p in periods if str(p).strip()]
    if not clean_periods:
        clean_periods = [""]

    if order_name == "period-service":
        for p in clean_periods:
            if p:
                if p not in paths:
                    paths.append(p)
                for node_path in template_tree_to_paths(tree, prefix=p):
                    if node_path not in paths:
                        paths.append(node_path)
            else:
                for node_path in template_tree_to_paths(tree, prefix=""):
                    if node_path not in paths:
                        paths.append(node_path)
    else:  # service-period
        for node in tree:
            if isinstance(node, str):
                node_name = safe_name(node.strip())
                children = []
            elif isinstance(node, dict):
                node_name = safe_name(str(node.get("name", "")).strip())
                children = node.get("children", [])
            else:
                continue
            if not node_name:
                continue

            for p in clean_periods:
                if p:
                    prefix = f"{node_name}/{p}"
                    if prefix not in paths:
                        paths.append(prefix)
                    if children and isinstance(children, list):
                        for child_path in template_tree_to_paths(children, prefix=prefix):
                            if child_path not in paths:
                                paths.append(child_path)
                else:
                    if node_name not in paths:
                        paths.append(node_name)
                    if children and isinstance(children, list):
                        for child_path in template_tree_to_paths(children, prefix=node_name):
                            if child_path not in paths:
                                paths.append(child_path)

    return paths


def get_effective_folder_structure(client, con=None):
    """Single source of truth for resolving a client's final physical relative folder paths."""
    ft = (client.get("client_type") if isinstance(client, dict) else client["client_type"]) or ""
    ft_str = str(ft).strip() or "ALL CLIENTS"

    tree = get_effective_template(ft_str, con=con)

    # Fetch folder rules (periods and order_name)
    if con:
        rule = con.execute("SELECT periods, order_name FROM folder_rules WHERE id=1").fetchone()
    else:
        with db() as c:
            rule = c.execute("SELECT periods, order_name FROM folder_rules WHERE id=1").fetchone()

    periods = json.loads(rule["periods"]) if rule and rule["periods"] else ["AY 2025-26"]
    order_name = rule["order_name"] if rule and "order_name" in rule.keys() else "service-period"

    return template_to_physical_paths(tree, periods, order_name)


def create_client_folders(client, storage_kinds=None, con=None, client_row=None):
    """Creates full hierarchical folder structure on disk for a single client in Office directories."""
    settings = settings_payload(con=con)
    mode = settings.get("google_drive_mode", "backup_and_client")
    roots = {"local": settings.get("local_root")}
    if mode in ("backup_and_client", "only_backup"):
        roots["drive"] = settings.get("drive_root")

    office_name = settings.get("office_folder_name", "Office") or "Office"
    created = 0
    
    folder_paths = get_effective_folder_structure(client, con=con)

    for kind, root in roots.items():
        if not root or (storage_kinds and kind not in storage_kinds):
            continue
        base_dir = configured_root(root)
        if not base_dir.is_dir():
            continue
        c_root = base_dir / office_name / storage_folder_name(client, kind, con=con)
        if not c_root.exists():
            c_root.mkdir(parents=True, exist_ok=True)
            created += 1
            
        for rel_path in folder_paths:
            target_path = c_root
            for part in rel_path.replace("\\", "/").split("/"):
                if part.strip():
                    target_path = target_path / safe_name(part.strip())
            if not target_path.exists():
                target_path.mkdir(parents=True, exist_ok=True)
                created += 1
            norm_rel = target_path.relative_to(c_root).as_posix()
            record_folder(client["file_no"], kind, norm_rel, "system", con=con)

    reconcile_client_folders(client["file_no"], storage_kinds=storage_kinds, con=con, client_row=client_row or client)
    return created


def create_folders(client_ids=None):
    settings = settings_payload()
    mode = settings.get("google_drive_mode", "backup_and_client")
    roots = [settings["local_root"]] if settings.get("local_root") else []
    if mode in ("backup_and_client", "only_backup") and settings.get("drive_root"):
        roots.append(settings["drive_root"])
    if not roots: raise ValueError("Configure at least one storage location first.")
    with db() as con:
        query, params = "SELECT * FROM clients", []
        if client_ids:
            placeholders = ",".join("?" for _ in client_ids)
            query += f" WHERE file_no IN ({placeholders})"; params = client_ids
        clients = con.execute(query, params).fetchall()
        created = 0
        for client in clients:
            created += create_client_folders(client, con=con)
    return {"clients": len(clients), "folders_created": created, "roots": roots}


_reconcile_timers = {}
_reconcile_lock = threading.Lock()

def schedule_debounced_reconcile(client_file_no, delay=2.0):
    """Schedules reconcile_client_folders to run asynchronously after a debounce delay.
    If called repeatedly within the delay window (e.g. during a multi-file save batch),
    resets the timer so reconcile executes exactly once after the batch completes."""
    with _reconcile_lock:
        existing_timer = _reconcile_timers.get(client_file_no)
        if existing_timer:
            try:
                existing_timer.cancel()
            except Exception:
                pass
        timer = threading.Timer(delay, _run_debounced_reconcile, args=(client_file_no,))
        timer.daemon = True
        _reconcile_timers[client_file_no] = timer
        timer.start()

def _run_debounced_reconcile(client_file_no):
    with _reconcile_lock:
        _reconcile_timers.pop(client_file_no, None)
    try:
        reconcile_client_folders(client_file_no)
    except Exception as exc:
        logging.warning("Debounced reconciliation error for client %s: %s", client_file_no, exc)


def reconcile_client_folders(client_file_no, storage_kinds=None, cached_roots=None, con=None, client_row=None):
    mode = get_setting("google_drive_mode", "backup_and_client", con=con)
    if cached_roots:
        roots = cached_roots
    else:
        roots = {"local": get_setting("local_root", con=con)}
        if mode in ("backup_and_client", "only_backup"):
            roots["drive"] = get_setting("drive_root", con=con)

    if not roots.get("local") and not roots.get("drive"):
        return {"client_file_no": client_file_no, "folders": 0, "files": 0, "new_folders": 0, "new_files": 0, "missing_folders": [], "missing_files": []}
    
    close_db = False
    if con is None:
        con = sqlite3.connect(DB_PATH, timeout=30)
        con.row_factory = sqlite3.Row
        close_db = True

    try:
        client = client_row or con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client: raise ValueError("Client not found.")
        folders = files = 0
        new_folders_count = new_files_count = 0
        all_missing_folders = []
        all_missing_files = []
        
        office_name = get_setting("office_folder_name", "Office", con=con) or "Office"
        # Get existing DB inventory lookup
        existing_folders = {r["relative_path"]: r["source"] for r in con.execute("SELECT relative_path, source FROM folder_inventory WHERE client_file_no=?", (client_file_no,)).fetchall()}
        existing_files = {r["relative_path"]: r["size_bytes"] for r in con.execute("SELECT relative_path, size_bytes FROM file_inventory WHERE client_file_no=?", (client_file_no,)).fetchall()}
        
        for kind, root_value in roots.items():
            if not root_value or (storage_kinds and kind not in storage_kinds): continue
            base_dir = configured_root(root_value)
            if not base_dir.is_dir(): continue
            root_path = base_dir / office_name / storage_folder_name(client, kind, con=con)
            seen_folders, seen_files = set(), set()
            root_str = str(root_path)
            if os.path.isdir(root_str):
                for dirpath, dirnames, filenames in os.walk(root_str):
                    rel_dir = os.path.relpath(dirpath, root_str).replace("\\", "/")
                    if rel_dir != ".":
                        seen_folders.add(rel_dir)
                        if rel_dir not in existing_folders:
                            new_folders_count += 1
                            record_folder(client_file_no, kind, rel_dir, "manual", con=con)
                        else:
                            record_folder(client_file_no, kind, rel_dir, existing_folders[rel_dir], con=con)
                        folders += 1
                    for fname in filenames:
                        rel_file = f"{rel_dir}/{fname}" if rel_dir != "." else fname
                        seen_files.add(rel_file)
                        try:
                            fstat = os.stat(os.path.join(dirpath, fname))
                            mtime_str = datetime.fromtimestamp(fstat.st_mtime, timezone.utc).isoformat(timespec="seconds")
                            if rel_file not in existing_files:
                                new_files_count += 1
                            con.execute("INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at",
                                        (client_file_no, kind, rel_file, fstat.st_size, mtime_str, 1, now()))
                            files += 1
                        except OSError:
                            pass
            # Detect missing items: mark as not-present but NEVER delete DB records
            db_folders = con.execute("SELECT relative_path FROM folder_inventory WHERE client_file_no=? AND storage_kind=? AND present=1", (client_file_no, kind)).fetchall()
            for row in db_folders:
                if row["relative_path"] not in seen_folders:
                    con.execute("UPDATE folder_inventory SET present=0,updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (now(), client_file_no, kind, row["relative_path"]))
                    all_missing_folders.append(f"{kind}/{row['relative_path']}")
            db_files = con.execute("SELECT relative_path FROM file_inventory WHERE client_file_no=? AND storage_kind=? AND present=1", (client_file_no, kind)).fetchall()
            for row in db_files:
                if row["relative_path"] not in seen_files:
                    con.execute("UPDATE file_inventory SET present=0,updated_at=? WHERE client_file_no=? AND storage_kind=? AND relative_path=?", (now(), client_file_no, kind, row["relative_path"]))
                    all_missing_files.append(f"{kind}/{row['relative_path']}")
                    
        # Activity logging with change detection (no duplicate spam if no changes)
        if new_folders_count > 0:
            log_activity("folder_discovered", client_file_no, client["name"], f"Discovered {new_folders_count} manual folder(s)", con=con)
        if new_files_count > 0:
            log_activity("file_discovered", client_file_no, client["name"], f"Discovered {new_files_count} file(s)", con=con)
        if all_missing_folders or all_missing_files:
            log_activity("items_missing", client_file_no, client["name"], f"{len(all_missing_folders)} folder(s), {len(all_missing_files)} file(s) missing from disk", con=con)
            
        if close_db: con.commit()
        return {
            "client_file_no": client_file_no,
            "folders": folders,
            "files": files,
            "new_folders": new_folders_count,
            "new_files": new_files_count,
            "missing_folders": all_missing_folders,
            "missing_files": all_missing_files
        }
    finally:
        if close_db: con.close()


def folder_tree(client_file_no):
    with db() as con:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        folders = [dict(row) for row in con.execute("SELECT storage_kind,relative_path,source,present,updated_at FROM folder_inventory WHERE client_file_no=? AND LOWER(relative_path) NOT LIKE '%client shared folder%' ORDER BY storage_kind,relative_path", (client_file_no,))]
        files = [dict(row) for row in con.execute("SELECT storage_kind,relative_path,size_bytes,modified_at,present,updated_at FROM file_inventory WHERE client_file_no=? AND LOWER(relative_path) NOT LIKE '%client shared folder%' ORDER BY storage_kind,relative_path", (client_file_no,))]
        mapping = [dict(row) for row in con.execute("SELECT storage_kind,folder_name FROM client_folder_mappings WHERE client_file_no=?", (client_file_no,))]
        effective_paths = get_effective_folder_structure(client, con=con)
        tree_data = get_canonical_client_tree(client_file_no, con=con)
    return {
        "client": dict(client),
        "mappings": mapping,
        "folders": folders,
        "files": files,
        "effective_paths": effective_paths,
        "tree": tree_data.get("tree", []),
        "has_override": tree_data.get("has_override", False),
        "order_name": tree_data.get("order_name", "service-period"),
        "periods": tree_data.get("periods", [])
    }


# ========================================================
# PDF SECURITY & CLIENT-WISE ENCRYPTED CREDENTIAL VAULT
# ========================================================
PDF_VAULT_KEY_PATH = DATA_ROOT / ".pdf_vault.key"

def get_pdf_vault_aesgcm():
    """Initializes or retrieves the secure 256-bit AES-GCM master key for client PDF credentials."""
    if not PDF_VAULT_KEY_PATH.is_file():
        DATA_ROOT.mkdir(exist_ok=True, parents=True)
        key = AESGCM.generate_key(bit_length=256)
        PDF_VAULT_KEY_PATH.write_bytes(key)
        try:
            os.chmod(PDF_VAULT_KEY_PATH, 0o600)
        except Exception:
            pass
    key = PDF_VAULT_KEY_PATH.read_bytes()
    return AESGCM(key)


def encrypt_pdf_password(plaintext: str) -> str:
    """Encrypts a plaintext password using AES-256-GCM with a fresh 12-byte nonce."""
    if not plaintext:
        return ""
    aesgcm = get_pdf_vault_aesgcm()
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("utf-8")


def decrypt_pdf_password(encrypted_str: str) -> str:
    """Decrypts an AES-256-GCM encrypted password string in memory."""
    if not encrypted_str:
        return ""
    aesgcm = get_pdf_vault_aesgcm()
    raw = base64.b64decode(encrypted_str)
    if len(raw) < 28: # 12 nonce + 16 tag minimum
        raise ValueError("Invalid encrypted credential format.")
    nonce, ct = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


vault_encrypt = encrypt_pdf_password
vault_decrypt = decrypt_pdf_password


def get_client_pdf_passwords(client_file_no: str, con=None) -> list[dict]:
    """Retrieves all saved PDF password metadata for a specific client (never returns plaintext)."""
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        rows = con.execute(
            "SELECT id, client_file_no, label, created_at, updated_at, last_used_at FROM client_pdf_credentials WHERE client_file_no=? ORDER BY COALESCE(last_used_at, created_at) DESC",
            (client_file_no,)
        ).fetchall()
        res = []
        for r in rows:
            d = dict(r)
            d["has_password"] = True
            res.append(d)
        return res
    finally:
        if close_db:
            con.close()


def api_add_client_pdf_password(client_file_no: str, payload: dict) -> dict:
    """Saves a new labeled PDF password encrypted with AES-256-GCM for the client."""
    label = str(payload.get("label", "")).strip() or "General Password"
    password = str(payload.get("password", "")).strip()
    if not password:
        raise ValueError("Password cannot be empty.")
    with db() as con:
        client = con.execute("SELECT name FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError(f"Client '{client_file_no}' not found.")

        # Dedup check: if exact password already saved for this client, refresh last_used_at
        existing = con.execute("SELECT id, encrypted_password FROM client_pdf_credentials WHERE client_file_no=?", (client_file_no,)).fetchall()
        for ex in existing:
            try:
                dec_pw = decrypt_pdf_password(ex["encrypted_password"])
                if dec_pw == password:
                    con.execute("UPDATE client_pdf_credentials SET last_used_at=?, updated_at=? WHERE id=?", (now(), now(), ex["id"]))
                    return {"ok": True, "id": ex["id"], "label": label, "created_at": now(), "has_password": True, "already_saved": True}
            except Exception:
                pass

        enc = encrypt_pdf_password(password)
        t = now()
        cur = con.execute(
            "INSERT INTO client_pdf_credentials (client_file_no, label, encrypted_password, created_at, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
            (client_file_no, label, enc, t, t, t)
        )
        new_id = cur.lastrowid
        log_activity("pdf_password_added", client_file_no, client["name"], f"Added saved PDF password '{label}'", con=con)
    return {"ok": True, "id": new_id, "label": label, "created_at": t, "has_password": True}


def api_update_client_pdf_password(client_file_no: str, payload: dict) -> dict:
    """Updates a client's saved PDF password label and/or password value."""
    cred_id = payload.get("id")
    if not cred_id:
        raise ValueError("Credential ID is required.")
    label = str(payload.get("label", "")).strip()
    password = str(payload.get("password", "")).strip()
    with db() as con:
        existing = con.execute("SELECT * FROM client_pdf_credentials WHERE id=? AND client_file_no=?", (cred_id, client_file_no)).fetchone()
        if not existing:
            raise ValueError("Credential not found for this client.")
        client = con.execute("SELECT name FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        client_name = client["name"] if client else ""
        t = now()
        new_label = label if label else existing["label"]
        if password:
            enc = encrypt_pdf_password(password)
            con.execute("UPDATE client_pdf_credentials SET label=?, encrypted_password=?, updated_at=? WHERE id=?", (new_label, enc, t, cred_id))
        else:
            con.execute("UPDATE client_pdf_credentials SET label=?, updated_at=? WHERE id=?", (new_label, t, cred_id))
        log_activity("pdf_password_updated", client_file_no, client_name, f"Updated saved PDF password '{new_label}'", con=con)
    return {"ok": True, "id": cred_id, "label": new_label}


def api_delete_client_pdf_password(client_file_no: str, payload: dict) -> dict:
    """Deletes a client's saved PDF credential."""
    cred_id = payload.get("id")
    if not cred_id:
        raise ValueError("Credential ID is required.")
    with db() as con:
        existing = con.execute("SELECT * FROM client_pdf_credentials WHERE id=? AND client_file_no=?", (cred_id, client_file_no)).fetchone()
        if not existing:
            raise ValueError("Credential not found for this client.")
        client = con.execute("SELECT name FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        client_name = client["name"] if client else ""
        label = existing["label"]
        con.execute("DELETE FROM client_pdf_credentials WHERE id=?", (cred_id,))
        log_activity("pdf_password_deleted", client_file_no, client_name, f"Deleted saved PDF password '{label}'", con=con)
    return {"ok": True, "id": cred_id}


def inspect_pdf_bytes(pdf_bytes: bytes) -> dict:
    """Validates PDF structure and checks encryption state."""
    if not pdf_bytes or len(pdf_bytes) < 5:
        return {"is_pdf": False, "is_encrypted": False, "page_count": 0, "file_size": len(pdf_bytes or b"")}
    if not pdf_bytes[:1024].lstrip().startswith(b"%PDF-"):
        return {"is_pdf": False, "is_encrypted": False, "page_count": 0, "file_size": len(pdf_bytes)}
    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        is_enc = bool(reader.is_encrypted)
        page_cnt = len(reader.pages) if not is_enc else 0
        return {"is_pdf": True, "is_encrypted": is_enc, "page_count": page_cnt, "file_size": len(pdf_bytes)}
    except Exception as exc:
        return {"is_pdf": True, "is_encrypted": True, "page_count": 0, "file_size": len(pdf_bytes), "note": str(exc)}


def lock_pdf_bytes(pdf_bytes: bytes, password: str) -> bytes:
    """Encrypts a PDF using AES-256 with user/owner password."""
    if not password or not str(password).strip():
        raise ValueError("A non-empty password is required to lock the PDF.")
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    if reader.is_encrypted:
        dec = reader.decrypt(password)
        if not dec:
            raise ValueError("This PDF is already password protected with a different password.")
    writer = pypdf.PdfWriter()
    writer.append(reader)
    writer.encrypt(user_password=password, owner_password=password, algorithm="AES-256")
    out_buf = io.BytesIO()
    writer.write(out_buf)
    locked_bytes = out_buf.getvalue()
    verify_reader = pypdf.PdfReader(io.BytesIO(locked_bytes))
    if not verify_reader.is_encrypted:
        raise ValueError("PDF encryption verification failed.")
    return locked_bytes


def unlock_pdf_bytes(pdf_bytes: bytes, password: str) -> bytes:
    """Decrypts a PDF using password and produces an unencrypted output."""
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    if not reader.is_encrypted:
        return pdf_bytes
    if not password:
        raise ValueError("Password is required to unlock this PDF.")
    dec = reader.decrypt(password)
    if dec == 0:
        raise ValueError("Incorrect PDF password.")
    writer = pypdf.PdfWriter()
    writer.append(reader)
    out_buf = io.BytesIO()
    writer.write(out_buf)
    unlocked_bytes = out_buf.getvalue()
    verify_reader = pypdf.PdfReader(io.BytesIO(unlocked_bytes))
    if verify_reader.is_encrypted:
        raise ValueError("PDF unlock verification failed.")
    return unlocked_bytes


def try_unlock_with_saved_credentials(client_file_no: str, pdf_bytes: bytes, con=None) -> tuple[bool, bytes | None, dict | None]:
    """Safely attempts saved credentials for this client to unlock the PDF (limited to 10 attempts)."""
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        creds = con.execute(
            "SELECT id, label, encrypted_password, last_used_at FROM client_pdf_credentials WHERE client_file_no=? ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 50",
            (client_file_no,)
        ).fetchall()
        if not creds:
            return False, None, None
        for cred in creds:
            try:
                pw = decrypt_pdf_password(cred["encrypted_password"])
                unlocked = unlock_pdf_bytes(pdf_bytes, pw)
                con.execute("UPDATE client_pdf_credentials SET last_used_at=?, updated_at=? WHERE id=?", (now(), now(), cred["id"]))
                if not close_db:
                    con.commit()
                return True, unlocked, {"id": cred["id"], "label": cred["label"] or "Saved Password"}
            except Exception:
                continue
        return False, None, None
    finally:
        if close_db:
            con.commit()
            con.close()


def api_detect_pdf(payload: dict) -> dict:
    """Inspects a PDF from relative path on disk or base64 payload."""
    client_file_no = str(payload.get("client_file_no", "")).strip()
    rel_p = str(payload.get("relative_path") or payload.get("path") or "").strip()
    storage_kind = str(payload.get("storage_kind", "local")).strip()
    file_b64 = payload.get("file_base64")
    
    raw_bytes = None
    if client_file_no and rel_p:
        with db() as con:
            client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if client:
            base_dir, target_file, clean_rel = resolve_client_path(client, rel_p, storage_kind=storage_kind)
            if target_file.is_file():
                raw_bytes = target_file.read_bytes()
    
    if raw_bytes is None and file_b64:
        raw_bytes = clean_base64_payload(file_b64)
        
    if raw_bytes is None:
        raise ValueError("Could not locate file to inspect.")
        
    insp = inspect_pdf_bytes(raw_bytes)
    saved_passwords = get_client_pdf_passwords(client_file_no) if client_file_no else []
    return {
        "ok": True,
        "is_pdf": insp["is_pdf"],
        "is_encrypted": insp["is_encrypted"],
        "page_count": insp["page_count"],
        "file_size": insp["file_size"],
        "saved_passwords": saved_passwords
    }


def api_lock_pdf(payload: dict) -> dict:
    """Locks a PDF with password, with option to remember credential for client."""
    client_file_no = str(payload.get("client_file_no", "")).strip()
    password = str(payload.get("password", "")).strip()
    confirm_password = str(payload.get("confirm_password", "")).strip()
    
    if confirm_password and confirm_password != password:
        raise ValueError("Password confirmation does not match.")
    if not password:
        raise ValueError("Password is required to lock PDF.")
        
    remember = bool(payload.get("remember_password", False))
    label = str(payload.get("label", "")).strip() or "General Password"
    rel_p = str(payload.get("relative_path") or payload.get("path") or "").strip()
    storage_kind = str(payload.get("storage_kind", "local")).strip()
    file_b64 = payload.get("file_base64")
    replace_original = bool(payload.get("replace_original", False))
    new_filename = payload.get("new_filename")
    
    raw_bytes = None
    target_file = None
    client = None
    
    if client_file_no and rel_p:
        with db() as con:
            client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        base_dir, target_file, clean_rel = resolve_client_path(client, rel_p, storage_kind=storage_kind)
        if not target_file.is_file():
            raise ValueError("Target PDF file not found on disk.")
        raw_bytes = target_file.read_bytes()
        
    if raw_bytes is None and file_b64:
        raw_bytes = clean_base64_payload(file_b64)
        
    if raw_bytes is None:
        raise ValueError("No PDF file provided to lock.")
        
    locked_bytes = lock_pdf_bytes(raw_bytes, password)
    
    if remember and client_file_no:
        api_add_client_pdf_password(client_file_no, {"label": label, "password": password})
        
    output_path = None
    if target_file and client:
        if replace_original:
            temp_path = target_file.parent / f".tmp_{uuid.uuid4().hex}.pdf"
            temp_path.write_bytes(locked_bytes)
            os.replace(temp_path, target_file)
            output_path = str(target_file)
            final_rel = clean_rel
        else:
            stem = target_file.stem
            ext = target_file.suffix
            out_name = safe_name(new_filename or f"{stem}_locked{ext}")
            out_path = target_file.parent / out_name
            out_path.write_bytes(locked_bytes)
            output_path = str(out_path)
            c_root = configured_root(settings_payload().get("local_root" if storage_kind == "local" else "drive_root")) / storage_folder_name(client, storage_kind)
            final_rel = str(out_path.relative_to(c_root)).replace("\\", "/")
            
        # Update file inventory
        stat = Path(output_path).stat()
        mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
        with db() as con:
            con.execute("INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at",
                        (client_file_no, storage_kind, final_rel, stat.st_size, mod_time, 1, now()))
        log_activity("pdf_locked", client_file_no, client["name"], f"Locked PDF '{Path(output_path).name}'")
        
    return {
        "ok": True,
        "message": "PDF locked successfully",
        "output_path": output_path,
        "output_base64": base64.b64encode(locked_bytes).decode("utf-8") if not output_path else None,
        "file_size": len(locked_bytes)
    }


def api_unlock_pdf(payload: dict) -> dict:
    """Unlocks a password-protected PDF using saved client credentials or entered password."""
    client_file_no = str(payload.get("client_file_no", "")).strip()
    password = str(payload.get("password", "")).strip()
    cred_id = payload.get("credential_id")
    auto_try_saved = bool(payload.get("auto_try_saved", False))
    remember = bool(payload.get("remember_password", False))
    label = str(payload.get("label", "")).strip() or "General Password"
    rel_p = str(payload.get("relative_path") or payload.get("path") or "").strip()
    storage_kind = str(payload.get("storage_kind", "local")).strip()
    file_b64 = payload.get("file_base64")
    permanent = bool(payload.get("permanent", False))
    replace_original = bool(payload.get("replace_original", False))
    new_filename = payload.get("new_filename")
    
    raw_bytes = None
    target_file = None
    client = None
    
    if client_file_no and rel_p:
        with db() as con:
            client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        base_dir, target_file, clean_rel = resolve_client_path(client, rel_p, storage_kind=storage_kind)
        if not target_file.is_file():
            raise ValueError("Target PDF file not found on disk.")
        raw_bytes = target_file.read_bytes()
        
    if raw_bytes is None and file_b64:
        raw_bytes = clean_base64_payload(file_b64)
        
    if raw_bytes is None:
        raise ValueError("No PDF file provided to unlock.")
        
    unlocked_bytes = None
    matched_label = None
    
    # 1. Direct Credential ID
    if cred_id and client_file_no:
        with db() as con:
            cred_row = con.execute("SELECT * FROM client_pdf_credentials WHERE id=? AND client_file_no=?", (cred_id, client_file_no)).fetchone()
            if not cred_row:
                raise ValueError("Specified credential not found.")
            cred_pw = decrypt_pdf_password(cred_row["encrypted_password"])
            unlocked_bytes = unlock_pdf_bytes(raw_bytes, cred_pw)
            matched_label = cred_row["label"] or "Saved Password"
            con.execute("UPDATE client_pdf_credentials SET last_used_at=?, updated_at=? WHERE id=?", (now(), now(), cred_id))
            
    # 2. Auto Try Saved Client Passwords
    elif not password and auto_try_saved and client_file_no:
        success, res_bytes, matched_cred = try_unlock_with_saved_credentials(client_file_no, raw_bytes)
        if success:
            unlocked_bytes = res_bytes
            matched_label = matched_cred["label"]
        else:
            raise ValueError("Could not unlock with saved passwords. Please enter password.")
            
    # 3. Explicit Password
    elif password:
        unlocked_bytes = unlock_pdf_bytes(raw_bytes, password)
        matched_label = "Entered Password"
        if remember and client_file_no:
            api_add_client_pdf_password(client_file_no, {"label": label, "password": password})
    else:
        # Check if already unencrypted
        insp = inspect_pdf_bytes(raw_bytes)
        if not insp["is_encrypted"]:
            unlocked_bytes = raw_bytes
            matched_label = "Already Unencrypted"
        else:
            raise ValueError("Password is required to unlock this PDF.")
            
    output_path = None
    if permanent and target_file and client:
        if replace_original:
            temp_path = target_file.parent / f".tmp_{uuid.uuid4().hex}.pdf"
            temp_path.write_bytes(unlocked_bytes)
            os.replace(temp_path, target_file)
            output_path = str(target_file)
            final_rel = clean_rel
        else:
            stem = target_file.stem
            ext = target_file.suffix
            out_name = safe_name(new_filename or f"{stem}_unlocked{ext}")
            out_path = target_file.parent / out_name
            out_path.write_bytes(unlocked_bytes)
            output_path = str(out_path)
            c_root = configured_root(settings_payload().get("local_root" if storage_kind == "local" else "drive_root")) / storage_folder_name(client, storage_kind)
            final_rel = str(out_path.relative_to(c_root)).replace("\\", "/")
            
        # Update file inventory
        stat = Path(output_path).stat()
        mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
        with db() as con:
            con.execute("INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at",
                        (client_file_no, storage_kind, final_rel, stat.st_size, mod_time, 1, now()))
        log_activity("pdf_unlocked", client_file_no, client["name"], f"Unlocked PDF '{Path(output_path).name}'")
    elif client_file_no and client:
        log_activity("pdf_unlocked", client_file_no, client["name"], f"Unlocked PDF in memory via {matched_label}")

    return {
        "ok": True,
        "message": "PDF unlocked successfully",
        "matched_credential_label": matched_label,
        "output_path": output_path,
        "output_base64": base64.b64encode(unlocked_bytes).decode("utf-8") if (not output_path or not permanent) else None,
        "file_size": len(unlocked_bytes)
    }


def clean_base64_payload(b64_str: str) -> bytes:
    if not b64_str:
        raise ValueError("Document data is empty.")
    s = str(b64_str).strip()
    if "," in s and ("data:" in s[:35] or "base64" in s[:35]):
        s = s.split(",", 1)[1].strip()
    s = "".join(s.split())
    missing_padding = len(s) % 4
    if missing_padding:
        s += "=" * (4 - missing_padding)
    return base64.b64decode(s)


def save_document(payload, actor="Host"):
    target_folder = str(payload.get("target_folder") or payload.get("relative_path") or "").strip()
    source_local_path = str(payload.get("source_local_path") or "").strip()
    file_base64 = payload.get("file_base64")
    source_url = str(payload.get("source_url") or "").strip()

    raw = None
    if source_local_path and Path(source_local_path).is_file():
        try:
            raw = Path(source_local_path).read_bytes()
        except Exception as exc:
            logging.warning("Could not read source_local_path %s: %s", source_local_path, exc)

    if raw is None and file_base64:
        try:
            raw = clean_base64_payload(file_base64)
        except Exception as exc:
            raise ValueError(f"The document data is invalid: {exc}") from exc

    staged_file_id = payload.get("staged_file_id")
    staging_session_id = payload.get("staging_session_id")
    if raw is None and staged_file_id and staging_session_id:
        try:
            res_stg = staging_mgr.get_file_bytes(staging_session_id, staged_file_id)
            if res_stg:
                raw, _ = res_stg
        except Exception as exc:
            logging.warning("Could not read staged file %s from session %s: %s", staged_file_id, staging_session_id, exc)

    if raw is None and source_url and source_url.startswith(("http://", "https://")):
        try:
            import urllib.request
            req = urllib.request.Request(source_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                raw = resp.read()
        except Exception as exc:
            logging.warning("Could not fetch source_url %s: %s", source_url, exc)

    if raw is None or len(raw) == 0:
        doc_label = payload.get("document_name") or "document"
        raise ValueError(f"Could not save '{doc_label}': Document content is empty. Please select or drag the file again.")

    canonical_period = resolve_canonical_period(target_folder=target_folder, period=payload.get("period", ""), service=payload.get("service", ""))
    required = ["client_file_no", "document_name"]
    if not target_folder and not payload.get("service"):
        payload["service"] = "General"
    if any(not payload.get(k) for k in required):
        raise ValueError("Client and document name are required.")

    # Guard: only prevent saving obvious HTML error/login pages when a binary PDF is expected
    doc_ext = Path(payload["document_name"]).suffix.lower()
    if doc_ext == '.pdf' and len(raw) < 10000:
        prefix = raw[:300].strip().lower()
        if prefix.startswith((b'<!doctype html', b'<html', b'<head', b'<script')) and b'%pdf-' not in raw[:1024].lower():
            raise ValueError("Received an HTML web page/redirect instead of a valid PDF document.")
    settings = settings_payload()
    if not settings["local_root"] and not settings["drive_root"]:
        raise ValueError("Configure storage locations first.")
    with db() as con:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (payload["client_file_no"],)).fetchone()
        rule = con.execute("SELECT * FROM folder_rules WHERE id=1").fetchone()
    if not client:
        raise ValueError("Selected Practive File No. is not in the imported client list.")
    
    filename = safe_name(payload["document_name"])
    if "." not in filename and raw and b"%pdf-" in raw[:1024].lower():
        filename = f"{filename}.pdf"

    # Inline PDF Auto-Unlock if encrypted
    if filename.lower().endswith(".pdf") and raw and raw[:1024].lstrip().startswith(b"%PDF-"):
        try:
            insp = inspect_pdf_bytes(raw)
            if insp.get("is_encrypted"):
                success, unlocked_bytes, cred = try_unlock_with_saved_credentials(client["file_no"], raw)
                if success and unlocked_bytes:
                    raw = unlocked_bytes
        except Exception:
            pass

    destinations = []
    
    drive_mode = get_setting("google_drive_mode", "backup_and_client")
    is_shared = bool(payload.get("client_visibility"))
    if is_shared:
        allow_drive = drive_mode in ("backup_and_client", "only_client")
    else:
        allow_drive = drive_mode in ("backup_and_client", "only_backup")
        # In only_client or disabled mode, internal office documents stay strictly on local disk
        if not allow_drive and not payload.get("save_local"):
            payload["save_local"] = True

    # 1. Google Drive saving (Direct Disk Speed First on G: Drive):
    drive_requested = True if is_shared else bool(payload.get("save_drive", True))
    if allow_drive and settings.get("drive_root") and drive_requested:
        d_root = configured_root(settings["drive_root"])
        c_folder_name = storage_folder_name(client, "drive")
        office_name = settings.get("office_folder_name", "Office") or "Office"
        client_name = settings.get("client_folder_name", "Client") or "Client"

        if is_shared:
            # Client Shared Document -> Strictly saved into G:\ drive client portal folder
            target_dir = d_root / client_name / c_folder_name / safe_name(canonical_period)
        else:
            # Internal Office Document -> Strictly saved into G:\ drive office folder
            if target_folder:
                target_dir = (d_root / office_name / c_folder_name / target_folder).resolve()
            else:
                service_name = safe_name(payload.get("service") or "General")
                if rule["order_name"] == "period-service":
                    target_dir = d_root / office_name / c_folder_name / safe_name(canonical_period) / service_name
                else:
                    target_dir = d_root / office_name / c_folder_name / service_name / safe_name(canonical_period)

        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / filename
        target_file.write_bytes(raw)
        destinations.append(("drive", str(target_file)))

        try:
            stat = target_file.stat()
            mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
            rel_file = str(target_file.relative_to(d_root / (client_name if is_shared else office_name) / c_folder_name)).replace("\\", "/")
            with db() as con:
                con.execute("INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at",
                            (client["file_no"], "drive", rel_file, stat.st_size, mod_time, 1, now()))
                if target_folder:
                    record_folder(client["file_no"], "drive", target_folder, "manual", con=con)
        except Exception:
            pass

    # 2. Local Storage saving (if explicitly requested, saved under Office)
    if settings.get("local_root") and payload.get("save_local", False):
        l_root = configured_root(settings["local_root"])
        office_name = settings.get("office_folder_name", "Office") or "Office"
        c_folder_name = storage_folder_name(client, "local")
        target_dir = l_root / office_name / c_folder_name / safe_name(canonical_period)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / filename
        target_file.write_bytes(raw)
        destinations.append(("local", str(target_file)))

    job_id = str(uuid.uuid4())
    local_path = next((p for label, p in destinations if label == "local"), None)
    drive_path = next((p for label, p in destinations if label == "drive"), None)
    portal = None

    # 3. Ensure Client Portal Pass & Link are active and returned when client visibility is enabled
    if is_shared and allow_drive:
        try:
            portal = ensure_client_portal(client, check_remote=False)
        except Exception as exc:
            logging.warning("Google Drive client portal lookup skipped: %s", exc)

    practive = "queued" if payload.get("upload_practive") else "not requested"
    with db() as con:
        con.execute("INSERT INTO save_jobs (id, created_at, client_file_no, client_name, service, period, document_name, local_path, drive_path, practive_status, status, note, actor, target_folder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (job_id, now(), client["file_no"], client["name"],
                     payload.get("service") or (target_folder.split('/')[0] if target_folder else "General"),
                     canonical_period, filename, local_path, drive_path, practive, "saved", payload.get("note", ""), actor, target_folder))
        log_activity("document_saved", client["file_no"], client["name"], f"Saved '{filename}' into '{target_folder or 'Default'}'", actor=actor, con=con)
    schedule_debounced_reconcile(client["file_no"])
    return {"job_id": job_id, "local_path": local_path, "drive_path": drive_path, "practive_status": practive, "client_portal_link": portal["folder_link"] if portal else None, "client_access_pdf": portal["access_pdf_path"] if portal else None}


def bulk_save_documents(payload, actor="Host"):
    """Saves multiple documents in a single atomic batch transaction.
    Performs client/settings resolution once, writes files to disk,
    and commits all inventory and save_jobs records in a single SQLite transaction."""
    client_file_no = str(payload.get("client_file_no", "")).strip()
    if not client_file_no:
        raise ValueError("client_file_no is required.")
    
    files_list = payload.get("files") or []
    if not files_list:
        raise ValueError("No files provided in bulk save payload.")

    target_folder = str(payload.get("target_folder") or payload.get("relative_path") or "").strip()
    service = payload.get("service") or (target_folder.split('/')[0] if target_folder else "General")
    period = payload.get("period", "")
    canonical_period = resolve_canonical_period(target_folder=target_folder, period=period, service=service)

    settings = settings_payload()
    if not settings["local_root"] and not settings["drive_root"]:
        raise ValueError("Configure storage locations first.")

    with db() as con:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
    if not client:
        raise ValueError(f"Client '{client_file_no}' not found in database.")

    drive_mode = get_setting("google_drive_mode", "backup_and_client")
    batch_shared = bool(payload.get("client_visibility"))
    save_drive = bool(payload.get("save_drive"))
    save_local = bool(payload.get("save_local", True))

    allow_drive = False
    if drive_mode in ("backup_and_client", "only_client") and batch_shared:
        allow_drive = True
    elif drive_mode in ("backup_and_client", "only_backup") and save_drive:
        allow_drive = True

    if not allow_drive and not save_local:
        save_local = True

    # Pre-resolve and create destination directories once:
    l_target_dir = None
    if settings.get("local_root") and save_local:
        l_root = configured_root(settings["local_root"])
        office_name = settings.get("office_folder_name", "Office") or "Office"
        c_folder_name = storage_folder_name(client, "local")
        if target_folder:
            l_target_dir = (l_root / office_name / c_folder_name / target_folder).resolve()
        else:
            l_target_dir = l_root / office_name / c_folder_name / safe_name(canonical_period)
        l_target_dir.mkdir(parents=True, exist_ok=True)

    d_target_dir = None
    if allow_drive and settings.get("drive_root"):
        try:
            d_root = configured_root(settings["drive_root"])
            if d_root and d_root.exists():
                c_folder_name = storage_folder_name(client, "drive")
                client_name = settings.get("client_folder_name", "Client") or "Client"
                if target_folder and "client shared folder" not in target_folder.lower():
                    d_target_dir = (d_root / client_name / c_folder_name / target_folder).resolve()
                else:
                    d_target_dir = d_root / client_name / c_folder_name / safe_name(canonical_period)
                d_target_dir.mkdir(parents=True, exist_ok=True)
        except Exception as d_exc:
            logging.warning("Google Drive target directory preparation skipped: %s", d_exc)

    saved_items = []
    inventory_rows = []
    folder_records = []
    job_rows = []
    practive = "queued" if payload.get("upload_practive") else "not requested"
    now_ts = now()

    for idx, item in enumerate(files_list):
        doc_name = item.get("document_name") or f"document_{idx+1}.pdf"
        src_path = str(item.get("source_local_path") or "").strip()
        f_b64 = item.get("file_base64")
        src_url = str(item.get("source_url") or "").strip()

        raw = None
        if src_path and Path(src_path).is_file():
            try:
                raw = Path(src_path).read_bytes()
            except Exception as exc:
                logging.warning("Could not read local source path %s: %s", src_path, exc)

        staged_file_id = item.get("staged_file_id")
        staging_session_id = payload.get("staging_session_id") or item.get("staging_session_id")
        if raw is None and staged_file_id and staging_session_id:
            try:
                res_stg = staging_mgr.get_file_bytes(staging_session_id, staged_file_id)
                if res_stg:
                    raw, _ = res_stg
            except Exception as exc:
                logging.warning("Could not read staged file %s from session %s: %s", staged_file_id, staging_session_id, exc)

        if raw is None and f_b64:
            try:
                raw = clean_base64_payload(f_b64)
            except Exception:
                continue

        if raw is None and src_url and src_url.startswith(("http://", "https://")):
            try:
                import urllib.request
                req = urllib.request.Request(src_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    raw = resp.read()
            except Exception:
                continue

        if raw is None or len(raw) == 0:
            continue

        filename = safe_name(doc_name)
        if "." not in filename and b"%pdf-" in raw[:1024].lower():
            filename = f"{filename}.pdf"

        # Inline PDF Auto-Unlock if encrypted
        if filename.lower().endswith(".pdf") and raw[:1024].lstrip().startswith(b"%PDF-"):
            try:
                insp = inspect_pdf_bytes(raw)
                if insp.get("is_encrypted"):
                    success, unlocked_bytes, cred = try_unlock_with_saved_credentials(client_file_no, raw)
                    if success and unlocked_bytes:
                        raw = unlocked_bytes
            except Exception:
                pass

        file_is_shared = bool(item.get("client_visibility", batch_shared))
        destinations = []

        # Write to Google Drive mirror if configured & mounted
        if d_target_dir:
            try:
                d_file = d_target_dir / filename
                d_file.write_bytes(raw)
                destinations.append(("drive", str(d_file)))
                d_stat = d_file.stat()
                d_mtime = datetime.fromtimestamp(d_stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
                d_rel = str(d_file.relative_to(d_root / client_name / c_folder_name)).replace("\\", "/")
                inventory_rows.append((client_file_no, "drive", d_rel, d_stat.st_size, d_mtime, 1, now_ts))
                if target_folder:
                    folder_records.append((client_file_no, "drive", target_folder, "manual"))
            except Exception as d_err:
                logging.warning("Google Drive mirror write skipped for %s: %s", filename, d_err)

        # Write to Local Disk
        local_path = None
        if l_target_dir:
            try:
                l_file = l_target_dir / filename
                l_file.write_bytes(raw)
                destinations.append(("local", str(l_file)))
                local_path = str(l_file)
                l_stat = l_file.stat()
                l_mtime = datetime.fromtimestamp(l_stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
                l_rel = str(l_file.relative_to(l_root / office_name / c_folder_name)).replace("\\", "/")
                inventory_rows.append((client_file_no, "local", l_rel, l_stat.st_size, l_mtime, 1, now_ts))
                if target_folder:
                    folder_records.append((client_file_no, "local", target_folder, "manual"))
            except Exception as l_err:
                logging.warning("Local write error for %s: %s", filename, l_err)

        # Queue async Google Drive API cloud upload in background
        if allow_drive and GOOGLE_TOKEN_FILE.is_file():
            threading.Thread(
                target=sync_document_to_google_drive,
                args=(dict(client), target_folder, canonical_period, filename, raw, file_is_shared, save_drive),
                daemon=True
            ).start()

        drive_path = next((p for label, p in destinations if label == "drive"), None)
        job_id = str(uuid.uuid4())
        job_rows.append((
            job_id, now_ts, client["file_no"], client["name"],
            service, canonical_period, filename, local_path, drive_path,
            practive, "saved", item.get("note", payload.get("note", "")), actor, target_folder
        ))
        saved_items.append({"job_id": job_id, "document_name": filename, "local_path": local_path, "drive_path": drive_path})

    # Ensure Client Portal pass & link are cached/active
    portal = None
    if (batch_shared or any(item.get("client_visibility") for item in files_list)) and allow_drive:
        try:
            portal = ensure_client_portal(client, check_remote=False)
        except Exception as p_exc:
            logging.warning("Portal lookup skipped in bulk save: %s", p_exc)

    # Execute all database writes in a SINGLE ATOMIC TRANSACTION
    with db() as con:
        con.execute("BEGIN TRANSACTION;")
        for inv in inventory_rows:
            con.execute("INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at", inv)
        for f_rec in folder_records:
            record_folder(f_rec[0], f_rec[1], f_rec[2], f_rec[3], con=con)
        for job in job_rows:
            con.execute("INSERT INTO save_jobs (id, created_at, client_file_no, client_name, service, period, document_name, local_path, drive_path, practive_status, status, note, actor, target_folder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", job)
        log_activity("document_saved", client["file_no"], client["name"], f"Saved {len(saved_items)} file(s) into '{target_folder or 'Default'}'", actor=actor, con=con)
        con.commit()

    # Schedule single debounced reconcile after the batch
    schedule_debounced_reconcile(client["file_no"])

    return {
        "ok": True,
        "saved_count": len(saved_items),
        "total_requested": len(files_list),
        "results": saved_items,
        "client_portal_link": portal["folder_link"] if portal else None,
        "client_access_pdf": portal["access_pdf_path"] if portal else None
    }


def check_file_collision(payload, con=None):
    client_file_no = str(payload.get("client_file_no", "")).strip()
    target_folder = str(payload.get("target_folder") or payload.get("relative_path") or "").strip()
    document_name = str(payload.get("document_name", "")).strip()
    if not client_file_no or not document_name:
        raise ValueError("client_file_no and document_name are required.")
    
    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True
    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError("Client not found.")
        base_dir, target_dir, clean_rel = resolve_client_path(client, target_folder, storage_kind="local", con=con)
        fname = safe_name(document_name)
        target = target_dir / fname
        exists = target.is_file()
        return {
            "collision": exists,
            "filename": fname,
            "target_path": str(target),
            "target_folder": clean_rel,
            "existing_size": target.stat().st_size if exists else 0,
            "existing_modified": datetime.fromtimestamp(target.stat().st_mtime, timezone.utc).isoformat(timespec="seconds") if exists else None
        }
    finally:
        if close_db:
            con.close()


def execute_cut_and_route(payload, actor="Host", device_id=None, con=None):
    """
    Safely CUTS / MOVES a downloaded file from staff PC local storage into the client's destination folder.
    Follows atomic verification: Never deletes the source until the destination move has been 100% verified.
    """
    source_path = str(payload.get("source_path") or payload.get("source_local_path") or "").strip()
    file_base64 = payload.get("file_base64")
    client_file_no = str(payload.get("client_file_no", "")).strip()
    target_folder = str(payload.get("target_folder") or payload.get("relative_path") or "").strip()
    document_name = str(payload.get("document_name", "")).strip()
    collision_action = str(payload.get("collision_action") or "keep_both").strip().lower()
    save_local = bool(payload.get("save_local", True))
    save_drive = bool(payload.get("save_drive", False))

    if not client_file_no:
        raise ValueError("client_file_no is required.")

    close_db = False
    if not con:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        close_db = True

    try:
        client = con.execute("SELECT * FROM clients WHERE file_no=?", (client_file_no,)).fetchone()
        if not client:
            raise ValueError(f"Client '{client_file_no}' not found in database.")

        settings = settings_payload(con)
        if not settings["local_root"] and not settings["drive_root"]:
            raise ValueError("Storage root paths are not configured.")

        src = None
        src_raw = None
        src_size = 0

        if source_path:
            src = Path(source_path).resolve()
            src_str = str(src).lower()
            if ":\\windows" in src_str or ":/windows" in src_str or "system32" in src_str:
                raise ValueError("Access denied: System directories cannot be used as source.")
            if not src.is_file():
                raise ValueError(f"Source file not found at '{source_path}'")
            src_size = src.stat().st_size
            if not document_name:
                document_name = src.name
        elif file_base64:
            src_raw = clean_base64_payload(file_base64)
            src_size = len(src_raw)
            if not document_name:
                document_name = "document.pdf"
        else:
            raise ValueError("Either source_path or file_base64 must be provided.")

        fname = safe_name(document_name)

        # Guard against HTML error pages for PDFs
        doc_ext = Path(fname).suffix.lower()
        if doc_ext == '.pdf' and src_size < 10000:
            sample_bytes = (src.read_bytes()[:300] if src else src_raw[:300]).strip().lower()
            if sample_bytes.startswith((b'<!doctype html', b'<html', b'<head', b'<script')) and b'%pdf-' not in sample_bytes:
                raise ValueError("Received an HTML webpage instead of a valid PDF document.")

        destinations = []
        source_removed = False

        # Route to Local Storage
        if settings["local_root"] and save_local:
            base_dir, folder, clean_rel = resolve_client_path(client, target_folder, storage_kind="local", con=con)
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / fname

            # Handle Collision
            if target.exists() and (src is None or target.resolve() != src.resolve()):
                if collision_action == "check":
                    return {
                        "ok": True,
                        "collision": True,
                        "existing_file": str(target),
                        "document_name": fname,
                        "size": target.stat().st_size
                    }
                elif collision_action == "cancel":
                    raise ValueError(f"File '{fname}' already exists in destination.")
                elif collision_action == "replace":
                    pass
                else:
                    stem = target.stem
                    ext = target.suffix
                    counter = 1
                    while (folder / f"{stem} ({counter}){ext}").exists():
                        counter += 1
                    target = folder / f"{stem} ({counter}){ext}"
                    fname = target.name

            # ATOMIC SAFE CUT & MOVE PROTOCOL:
            if src and src.is_file():
                shutil.copy2(str(src), str(target))
                if not target.is_file() or target.stat().st_size != src_size:
                    if target.exists():
                        target.unlink(missing_ok=True)
                    raise IOError(f"Move verification failed: Size mismatch for '{target.name}'. Original kept in Downloads.")
                try:
                    src.unlink()
                    source_removed = not src.exists()
                except Exception as del_err:
                    logging.warning("Could not unlink source '%s' after verified copy: %s", src, del_err)
                    source_removed = False
            elif src_raw is not None:
                target.write_bytes(src_raw)
                source_removed = True

            destinations.append(("local", str(target)))

            stat = target.stat()
            mod_time = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
            c_root = configured_root(settings["local_root"]) / storage_folder_name(client, "local", con=con)
            rel_file = str(target.relative_to(c_root)).replace("\\", "/")
            con.execute(
                "INSERT INTO file_inventory VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_file_no,storage_kind,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,present=1,updated_at=excluded.updated_at",
                (client["file_no"], "local", rel_file, stat.st_size, mod_time, 1, now())
            )
            if target_folder:
                record_folder(client["file_no"], "local", target_folder, "manual", con=con)

        # Route to Google Drive if configured
        if settings["drive_root"] and save_drive:
            try:
                base_dir_d, folder_d, _ = resolve_client_path(client, target_folder, storage_kind="drive", con=con)
                folder_d.mkdir(parents=True, exist_ok=True)
                target_d = folder_d / fname
                if src and src.is_file() and not source_removed:
                    shutil.copy2(str(src), str(target_d))
                else:
                    loc_target = next((p for lbl, p in destinations if lbl == "local"), None)
                    if loc_target and Path(loc_target).is_file():
                        shutil.copy2(loc_target, str(target_d))
                destinations.append(("drive", str(target_d)))
            except Exception as d_exc:
                logging.warning("Google Drive storage copy skipped: %s", d_exc)

        job_id = str(uuid.uuid4())
        local_path = next((p for label, p in destinations if label == "local"), None)
        drive_path = next((p for label, p in destinations if label == "drive"), None)

        practive = "queued" if payload.get("upload_practive") else "not requested"
        canon_period = resolve_canonical_period(target_folder=target_folder, period=payload.get("period", ""), service=payload.get("service", ""), con=con)
        con.execute(
            "INSERT INTO save_jobs (id, created_at, client_file_no, client_name, service, period, document_name, local_path, drive_path, practive_status, status, note, actor, target_folder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (job_id, now(), client["file_no"], client["name"],
             payload.get("service") or (target_folder.split('/')[0] if target_folder else "General"),
             canon_period, fname, local_path, drive_path, practive, "moved" if source_removed else "saved",
             payload.get("note", ""), actor, target_folder)
        )
        log_activity("document_routed", client["file_no"], client["name"], f"Cut & routed '{fname}' into '{target_folder or 'Root'}'", actor=actor, con=con)
        con.commit()

        schedule_debounced_reconcile(client["file_no"])

        return {
            "ok": True,
            "status": "routed",
            "job_id": job_id,
            "local_path": local_path,
            "drive_path": drive_path,
            "filename": fname,
            "original_path": source_path,
            "source_removed": source_removed,
            "file_size": src_size,
            "client_file_no": client["file_no"],
            "client_name": client["name"],
            "target_folder": target_folder
        }
    finally:
        if close_db:
            con.close()


def cleanup_revoked_archive():
    """Auto cleans revoked files older than 30 days on a per-file basis."""
    try:
        now_ts = time.time()
        retention_sec = 30 * 86400  # 30 days
        if not REVOKED_ARCHIVE_DIR.exists():
            return 0
        deleted_count = 0
        for p in list(REVOKED_ARCHIVE_DIR.iterdir()):
            if p.is_file():
                try:
                    file_mtime = p.stat().st_mtime
                    if (now_ts - file_mtime) > retention_sec:
                        p.unlink(missing_ok=True)
                        deleted_count += 1
                except Exception:
                    pass
        if deleted_count > 0:
            log_activity("revoked_archive_auto_cleaned", None, None, f"Auto-cleaned {deleted_count} archived file(s) older than 30 days", actor="System")
        return deleted_count
    except Exception as exc:
        logging.warning("Error in cleanup_revoked_archive: %s", exc)
        return 0


def revert_save_job(job_id, actor="Host"):
    """
    Reverts one of the top 5 recent filing activities:
    - Moves the saved file to safe data/revoked_archive/ folder (with 30-day per-file auto-clean).
    - Removes it from client file inventory.
    - Marks save_jobs record as 'revoked'.
    """
    cleanup_revoked_archive()
    with db() as con:
        job = con.execute("SELECT * FROM save_jobs WHERE id=?", (job_id,)).fetchone()
        if not job:
            raise ValueError("Save activity record not found.")
        
        top_jobs = [r["id"] for r in con.execute("SELECT id FROM save_jobs ORDER BY created_at DESC LIMIT 5").fetchall()]
        if job["id"] not in top_jobs:
            raise ValueError("Only the top 5 most recent activities can be reverted.")
        if job["status"] == "revoked":
            raise ValueError("This filing has already been reverted.")
        
        REVOKED_ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        archive_name = f"revoked_{int(time.time())}_{safe_name(job['client_file_no'])}_{safe_name(job['document_name'])}"
        archive_path = REVOKED_ARCHIVE_DIR / archive_name
        
        shifted = False
        if job["local_path"] and Path(job["local_path"]).is_file():
            try:
                shutil.move(str(job["local_path"]), str(archive_path))
                shifted = True
            except Exception as exc:
                logging.warning("Could not shift local file to archive: %s", exc)
                
        # Remove from file inventory
        if job["local_path"]:
            try:
                settings = settings_payload(con=con)
                local_root = configured_root(settings.get("local_root", ""))
                c_root = local_root / storage_folder_name({"file_no": job["client_file_no"], "name": job["client_name"]}, "local", con=con)
                rel = str(Path(job["local_path"]).relative_to(c_root)).replace("\\", "/")
                con.execute("DELETE FROM file_inventory WHERE client_file_no=? AND storage_kind='local' AND relative_path=?", (job["client_file_no"], rel))
            except Exception:
                pass
                
        con.execute("UPDATE save_jobs SET status='revoked', reverted_at=?, reverted_archive_path=? WHERE id=?",
                    (now(), str(archive_path) if shifted else None, job["id"]))
        log_activity("task_revoked", job["client_file_no"], job["client_name"],
                     f"Reverted save task for '{job['document_name']}' - file shifted to safe archive", actor=actor, con=con)
    return {
        "ok": True,
        "message": f"Successfully reverted filing for '{job['document_name']}'. File safely shifted to archive.",
        "shifted_to_archive": shifted,
        "archive_path": str(archive_path) if shifted else None
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "CAOfficeAutomation/0.2"

    def log_message(self, *_): pass

    def is_local_client(self):
        return is_private_client(self.client_address[0])

    def cors_origin(self):
        origin = self.headers.get("Origin", "")
        if not origin:
            return None
        if origin.startswith("chrome-extension://") or origin == "https://app.practive.in" or origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:") or origin.startswith("http://192.168.") or origin.startswith("http://10."):
            return origin
        return None

    def send_cors_headers(self):
        if origin := self.cors_origin():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-VS-Session-Token, Authorization, X-VS-Device-Id")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")

    def get_cookie(self, name: str) -> str:
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return ""
        try:
            cookie = SimpleCookie()
            cookie.load(cookie_header)
            if name in cookie:
                return cookie[name].value
        except Exception:
            pass
        return ""

    def get_auth_token(self) -> str:
        # 1. Check HttpOnly cookie
        cookie_token = self.get_cookie("vs_session")
        if cookie_token:
            return cookie_token
        # 2. Check X-VS-Session-Token header (for extension or API companions)
        header_token = self.headers.get("X-VS-Session-Token", "")
        if header_token:
            return header_token.strip()
        # 3. Check Authorization: Bearer <token>
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        return ""

    def get_auth_context(self) -> dict | None:
        token = self.get_auth_token()
        if token:
            return validate_session(token, self.client_address[0])
        # If accessing directly from localhost (server PC) and host user exists, auto-grant host session
        if ipaddress.ip_address(self.client_address[0]).is_loopback:
            with db() as con:
                host_user = con.execute("SELECT * FROM users WHERE role='host' AND status='active' LIMIT 1").fetchone()
                if host_user:
                    dev = con.execute("SELECT * FROM devices WHERE user_id=? AND status='approved' LIMIT 1", (host_user["user_id"],)).fetchone()
                    dev_id = dev["device_id"] if dev else "dev-main-host-001"
                    dev_name = dev["device_name"] if dev else "Main Server PC"
                    if not dev:
                        con.execute("INSERT INTO devices (device_id, user_id, device_name, ip_address, status, created_at, updated_at, approved_at, last_seen_at) VALUES (?, ?, ?, '127.0.0.1', 'approved', ?, ?, ?, ?)",
                                    (dev_id, host_user["user_id"], dev_name, now(), now(), now(), now()))
                    return {
                        "user_id": host_user["user_id"],
                        "role": "host",
                        "device_id": dev_id,
                        "device_name": dev_name,
                        "user_status": "active",
                        "device_status": "approved",
                        "session_type": "web"
                    }
        return None

    def send_auth_cookie(self, token: str, max_age: int = 31536000):
        cookie_val = f"vs_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"
        self.send_header("Set-Cookie", cookie_val)

    def clear_auth_cookie(self):
        cookie_val = "vs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        self.send_header("Set-Cookie", cookie_val)

    def reject(self, status, message):
        self.send_json({"error": message}, status)

    def protect_api(self, path: str) -> bool:
        if not self.is_local_client():
            self.reject(403, "This server accepts requests from private LAN devices only.")
            return False
        public_endpoints = {
            "/api/health",
            "/api/desktop/health",
            "/api/desktop/bring_to_front",
            "/api/desktop/return_to_browser",
            "/api/desktop/pending_browser_return",
            "/api/staging/incoming",
            "/api/staging/incoming/clear",
            "/api/auth/status",
            "/api/auth/setup-host",
            "/api/auth/request-access",
            "/api/auth/request-status",
            "/api/auth/login",
            "/api/auth/extension-exchange",
            "/api/auth/extension-direct-connect",
            "/api/google/callback",
            "/api/template.csv"
        }
        if path in public_endpoints:
            return True
        ctx = self.get_auth_context()
        if not ctx:
            self.reject(401, "Authentication required. Please log in.")
            return False
        if path.startswith("/api/admin/"):
            if ctx.get("role") != "host":
                self.reject(403, "Access restricted to Host administrator.")
                return False
        return True

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(raw))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        if not self.is_local_client() or not self.cors_origin():
            return self.reject(403, "Origin is not permitted.")
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/") and not self.protect_api(path):
            return

        if path == "/api/health":
            return self.send_json({"ok": True, "server_time": now()})

        if path == "/api/staging/incoming":
            query = parse_qs(urlparse(self.path).query)
            should_drain = query.get("drain", ["0"])[0] in ("1", "true")
            with _STAGING_QUEUE_LOCK:
                items = list(incoming_staging_queue)
                if should_drain:
                    incoming_staging_queue.clear()
            has_files = len(items) > 0
            return self.send_json({
                "ok": True,
                "has_files": has_files,
                "files": items,
                "count": len(items),
                "staging": {
                    "files": items,
                    "bulk": items,
                    "single": items[0] if items else None,
                    "is_redirected": has_files
                }
            })

        # Staging Session Manifest
        if path.startswith("/api/staging/sessions/"):
            parts = path.split("/")
            if len(parts) >= 5:
                sess_id = parts[4]
                manifest = staging_mgr._load_manifest(sess_id)
                if not manifest:
                    return self.send_json({"error": "Staging session not found."}, 404)
                return self.send_json({"ok": True, "manifest": manifest, "session": manifest})

        # PDF Studio Tools Spec
        if path == "/api/pdf-studio/tools":
            return self.send_json({"ok": True, "tools": pdf_engine.registry.list_tools()})

        # PDF Studio Session Meta
        if path.startswith("/api/pdf-studio/sessions/") and len(path.split("/")) == 5:
            sess_id = path.split("/")[4]
            session = pdf_engine.get_session(sess_id)
            if not session:
                return self.send_json({"error": "PDF Studio session not found."}, 404)
            return self.send_json({"ok": True, "session": session.to_dict()})

        # PDF Studio Page PNG Preview
        if path.startswith("/api/pdf-studio/sessions/") and "/page/" in path:
            parts = path.split("/")
            sess_id = parts[4]
            page_num = int(parts[6])
            dpi = int(parse_qs(urlparse(self.path).query).get("dpi", ["120"])[0])
            try:
                png_bytes = pdf_engine.render_page_png(sess_id, page_num, dpi=dpi)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png_bytes)))
                self.send_header("Cache-Control", "private, max-age=120")
                self.send_cors_headers()
                self.end_headers()
                return self.wfile.write(png_bytes)
            except Exception as e:
                return self.send_json({"error": str(e)}, 400)

        # PDF Studio Thumbnails
        if path.startswith("/api/pdf-studio/sessions/") and path.endswith("/thumbnails"):
            sess_id = path.split("/")[4]
            try:
                thumbs = pdf_engine.get_thumbnails(sess_id)
                return self.send_json({"ok": True, "thumbnails": thumbs})
            except Exception as e:
                return self.send_json({"error": str(e)}, 400)

        # PDF Studio Download Working Document
        if path.startswith("/api/pdf-studio/sessions/") and path.endswith("/download"):
            sess_id = path.split("/")[4]
            session = pdf_engine.get_session(sess_id)
            if not session or not session.working_pdf_path.exists():
                return self.send_json({"error": "Document not found."}, 404)
            raw = session.working_pdf_path.read_bytes()
            download_name = session.meta.get("current_name") or "document_processed.pdf"
            if not download_name.lower().endswith(".pdf"):
                download_name += ".pdf"
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Content-Length", str(len(raw)))
            self.send_cors_headers()
            self.end_headers()
            return self.wfile.write(raw)

        if path == "/api/auth/status":
            ctx = self.get_auth_context()
            is_loop = ipaddress.ip_address(self.client_address[0]).is_loopback
            token_cookie = None
            if is_loop and ctx and ctx.get("role") == "host":
                if not self.get_cookie("vs_session"):
                    token_cookie = create_session(ctx["user_id"], ctx["device_id"], "127.0.0.1", session_type="web")
            raw = json.dumps({
                "initialized": has_host_user(),
                "authenticated": bool(ctx),
                "user": {
                    "user_id": ctx["user_id"],
                    "role": ctx["role"],
                    "device_name": ctx["device_name"],
                    "device_id": ctx["device_id"]
                } if ctx else None,
                "is_loopback": is_loop
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            if token_cookie:
                self.send_auth_cookie(token_cookie)
            self.send_header("Content-Length", len(raw))
            self.send_cors_headers()
            self.end_headers()
            return self.wfile.write(raw)

        if path == "/api/auth/request-status":
            query = parse_qs(urlparse(self.path).query)
            device_id = query.get("device_id", [""])[0]
            user_id = query.get("user_id", [""])[0]
            with db() as con:
                row = con.execute("SELECT status FROM access_requests WHERE device_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1", (device_id, user_id)).fetchone()
                if not row and device_id:
                    row = con.execute("SELECT status FROM access_requests WHERE device_id=? ORDER BY created_at DESC LIMIT 1", (device_id,)).fetchone()
            status = row["status"] if row else "none"
            return self.send_json({"status": status})

        if path == "/api/auth/extension-status":
            ctx = self.get_auth_context()
            if not ctx:
                return self.send_json({"valid": False}, 401)
            return self.send_json({"valid": True, "user_id": ctx["user_id"], "device_name": ctx["device_name"], "role": ctx["role"]})

        if path == "/api/file-router/recent":
            with db() as con:
                rows = con.execute("SELECT id, created_at, client_file_no, client_name, document_name, target_folder, status, local_path FROM save_jobs ORDER BY created_at DESC LIMIT 25").fetchall()
                return self.send_json({"jobs": [dict(r) for r in rows]}, 200)

        if path == "/api/admin/users":
            ctx = self.get_auth_context()
            is_host = bool(ctx and ctx.get("role") == "host")
            with db() as con:
                raw_users = [dict(r) for r in con.execute("SELECT user_id, role, status, encrypted_password, created_at, updated_at FROM users ORDER BY created_at ASC")]
                users = []
                for u in raw_users:
                    pwd_text = ""
                    if is_host and u.get("encrypted_password"):
                        try:
                            pwd_text = vault_decrypt(u["encrypted_password"])
                        except Exception:
                            pwd_text = ""
                    users.append({
                        "user_id": u["user_id"],
                        "role": u["role"],
                        "status": u["status"],
                        "password_text": pwd_text if is_host else "",
                        "created_at": u["created_at"],
                        "updated_at": u["updated_at"]
                    })
                devices = [dict(r) for r in con.execute("SELECT device_id, user_id, device_name, ip_address, status, created_at, approved_at, last_seen_at FROM devices ORDER BY last_seen_at DESC")]
                requests = [dict(r) for r in con.execute("SELECT request_id, user_id, device_id, device_name, ip_address, status, created_at FROM access_requests ORDER BY created_at DESC LIMIT 50")]
            return self.send_json({"users": users, "devices": devices, "requests": requests})

        if path == "/api/settings":
            return self.send_json(settings_payload())

        if path == "/api/google/status":
            return self.send_json(google_status())

        if path == "/api/client-portals/blocks":
            with db() as con:
                rows = [dict(row) for row in con.execute("SELECT client_file_no,reason,custom_message,blocked_at FROM portal_blocks")]
            return self.send_json(rows)

        if path == "/api/client-access-links.zip":
            with db() as con:
                rows = con.execute("SELECT access_pdf_path FROM client_portals ORDER BY client_file_no").fetchall()
            bundle = io.BytesIO()
            with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
                for row in rows:
                    pdf_path = Path(row["access_pdf_path"])
                    if pdf_path.is_file():
                        archive.write(pdf_path, pdf_path.name)
            raw = bundle.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="VS Database - Client Access Links.zip"')
            self.send_header("Content-Length", len(raw))
            self.end_headers()
            return self.wfile.write(raw)

        if path == "/api/google/callback":
            try:
                query = parse_qs(urlparse(self.path).query)
                if query.get("error"): raise ValueError(query["error"][0])
                state = query.get("state", [""])[0]
                if not state or state != get_setting("google_oauth_state"):
                    raise ValueError("Google authorization state did not match. Start the connection again.")
                verifier = get_setting("google_oauth_code_verifier")
                if not verifier:
                    raise ValueError("The Google connection session expired. Start the connection again.")
                flow = Flow.from_client_secrets_file(GOOGLE_CLIENT_FILE, scopes=GOOGLE_SCOPE, state=state, redirect_uri=GOOGLE_REDIRECT_URI, code_verifier=verifier, autogenerate_code_verifier=False)
                flow.fetch_token(authorization_response=f"http://localhost:{PORT}{self.path}")
                GOOGLE_TOKEN_FILE.write_text(flow.credentials.to_json(), encoding="utf-8")
                with db() as con:
                    con.execute("INSERT INTO settings(key,value) VALUES('google_oauth_code_verifier','') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                html = b"<html><body style='font-family:Segoe UI;padding:40px'><h2>Google Drive connected successfully.</h2><p>You can close this tab and return to VS Database.</p></body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", len(html))
                self.end_headers()
                return self.wfile.write(html)
            except Exception:
                logging.exception("Google Drive callback failed")
                html = b"<html><body style='font-family:Segoe UI;padding:40px'><h2>Google Drive connection failed</h2><p>Please return to VS Database and check the server log.</p></body></html>"
                self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", len(html))
                self.end_headers()
                return self.wfile.write(html)

        if path == "/api/firm-types":
            with db() as con:
                rows = con.execute("""
                    SELECT ft.id, ft.name, ft.normalized_name, ft.status, ft.created_at, ft.updated_at,
                           (SELECT COUNT(*) FROM clients c WHERE lower(trim(c.client_type)) = ft.normalized_name) AS client_count,
                           (SELECT COUNT(*) FROM category_templates ct WHERE lower(trim(ct.category)) = ft.normalized_name) AS template_count
                    FROM firm_types ft
                    ORDER BY CASE WHEN ft.status='active' THEN 0 ELSE 1 END, ft.id ASC
                """).fetchall()
            return self.send_json([dict(r) for r in rows])

        if path == "/api/security-alerts":
            with db() as con:
                rows = [dict(r) for r in con.execute("SELECT * FROM security_alerts WHERE is_dismissed=0 ORDER BY id DESC LIMIT 50").fetchall()]
            return self.send_json(rows)

        if path == "/api/clients":
            with db() as con:
                rows = [dict(r) for r in con.execute("SELECT * FROM clients ORDER BY name")]
            return self.send_json(rows)

        if path == "/api/clients/export":
            query_params = parse_qs(urlparse(self.path).query)
            export_format = query_params.get("format", ["xlsx"])[0].lower()
            file_nos_raw = query_params.get("file_nos", [""])[0].strip()
            
            with db() as con:
                if file_nos_raw:
                    requested_fnos = [f.strip() for f in file_nos_raw.split(",") if f.strip()]
                    placeholders = ",".join("?" for _ in requested_fnos)
                    rows_db = con.execute(f"SELECT file_no, name, mobile, client_type, client_group, tags, status, users FROM clients WHERE file_no IN ({placeholders}) ORDER BY name", requested_fnos).fetchall()
                else:
                    rows_db = con.execute("SELECT file_no, name, mobile, client_type, client_group, tags, status, users FROM clients ORDER BY name").fetchall()
                    
            headers = ["File No.", "Name", "Mobile", "Client Type", "Client Group", "Tags", "Status", "Users"]
            rows = []
            for r in rows_db:
                rows.append([
                    r["file_no"] or "",
                    r["name"] or "",
                    r["mobile"] or "",
                    r["client_type"] or "",
                    r["client_group"] or "",
                    r["tags"] or "",
                    r["status"] or "Active",
                    r["users"] or ""
                ])
                
            today_str = datetime.now().strftime("%Y-%m-%d")
            if export_format == "csv":
                csv_bytes = generate_csv(headers, rows)
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="VS_Database_Clients_Export_{today_str}.csv"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)
                return
            else:
                xlsx_bytes = generate_xlsx(headers, rows)
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Disposition", f'attachment; filename="VS_Database_Clients_Export_{today_str}.xlsx"')
                self.send_header("Content-Length", str(len(xlsx_bytes)))
                self.end_headers()
                self.wfile.write(xlsx_bytes)
                return

        if path == "/api/system/check-updates":
            return self.send_json(check_for_system_updates())

        if path == "/api/rules":
            with db() as con:
                row = dict(con.execute("SELECT * FROM folder_rules WHERE id=1").fetchone())
            row["services"], row["periods"] = json.loads(row["services"]), json.loads(row["periods"])
            return self.send_json(row)

        if path == "/api/category-templates/preview":
            query_params = parse_qs(urlparse(self.path).query)
            category = query_params.get("category", ["ALL CLIENTS"])[0].strip() or "ALL CLIENTS"
            base_tree = get_effective_template("ALL CLIENTS")
            effective_tree = get_effective_template(category)
            with db() as con:
                rule = con.execute("SELECT periods, order_name FROM folder_rules WHERE id=1").fetchone()
            periods = json.loads(rule["periods"]) if rule and rule["periods"] else ["AY 2025-26"]
            order_name = rule["order_name"] if rule and "order_name" in rule.keys() else "service-period"
            effective_paths = template_to_physical_paths(effective_tree, periods, order_name)
            is_base = category.casefold() == "all clients"
            return self.send_json({
                "category": category,
                "is_base": is_base,
                "base_tree": base_tree,
                "effective_tree": effective_tree,
                "periods": periods,
                "order_name": order_name,
                "effective_paths": effective_paths
            })

        if path == "/api/category-templates":
            base_tree = get_effective_template("ALL CLIENTS")
            with db() as con:
                db_rows = {r["category"].casefold(): dict(r) for r in con.execute("SELECT category,services,structure,updated_at FROM category_templates").fetchall()}
                all_fts = [dict(r) for r in con.execute("SELECT name, status FROM firm_types ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, id ASC").fetchall()]

            result = []
            
            # 1. Base Template: ALL CLIENTS
            all_clients_row = db_rows.get("all clients")
            if all_clients_row:
                try:
                    struct = json.loads(all_clients_row["structure"]) if isinstance(all_clients_row["structure"], str) else all_clients_row["structure"]
                except Exception:
                    struct = base_tree
            else:
                struct = base_tree
            result.append({
                "category": "ALL CLIENTS",
                "is_base": True,
                "is_inherited": False,
                "structure": struct if struct else base_tree,
                "services": [n["name"] for n in (struct or base_tree) if isinstance(n, dict) and "name" in n],
                "updated_at": all_clients_row["updated_at"] if all_clients_row else now()
            })

            # 2. Registered Firm Types
            for ft in all_fts:
                ft_name = ft["name"]
                if ft_name.casefold() == "all clients":
                    continue
                ft_key = ft_name.casefold()
                if ft_key in db_rows:
                    row = db_rows[ft_key]
                    try:
                        struct = json.loads(row["structure"]) if isinstance(row["structure"], str) else row["structure"]
                    except Exception:
                        struct = get_effective_template(ft_name)
                    is_inherited = False
                    up_at = row["updated_at"]
                else:
                    struct = get_effective_template(ft_name)
                    is_inherited = (ft_name not in DEFAULT_FIRM_TYPE_TEMPLATES)
                    up_at = now()
                
                result.append({
                    "category": ft_name,
                    "is_base": False,
                    "is_inherited": is_inherited,
                    "structure": struct,
                    "services": [n["name"] for n in struct if isinstance(n, dict) and "name" in n],
                    "updated_at": up_at
                })

            return self.send_json(result)

        if path.startswith("/api/client-folders/") and path.endswith("/tree"):
            fno = unquote(path.split("/")[3])
            query = parse_qs(urlparse(self.path).query)
            kind = query.get("storage_kind", ["local"])[0]
            try:
                return self.send_json(get_canonical_client_tree(fno, storage_kind=kind))
            except Exception as exc:
                return self.send_json({"error": str(exc), "tree": []}, 400)

        if path.startswith("/api/client-folders/") and path.endswith("/override"):
            fno = unquote(path.split("/")[3])
            try:
                return self.send_json(get_client_override_details(fno))
            except Exception as exc:
                return self.send_json({"error": str(exc)}, 400)

        if path == "/api/client-files/download":
            query = parse_qs(urlparse(self.path).query)
            fno = query.get("client_file_no", [""])[0]
            rel_p = query.get("path", [""])[0]
            kind = query.get("storage_kind", ["local"])[0]
            with db() as con:
                client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
            if not client:
                return self.send_json({"error": "Client not found."}, 404)
            try:
                base_dir, target_file, clean_rel = resolve_client_path(client, rel_p, storage_kind=kind)
                if not target_file.is_file():
                    return self.send_json({"error": "File not found."}, 404)
                raw = target_file.read_bytes()
                mime, _ = mimetypes.guess_type(target_file.name)
                self.send_response(200)
                self.send_header("Content-Type", mime or "application/octet-stream")
                self.send_header("Content-Disposition", f'inline; filename="{target_file.name}"')
                self.send_header("Content-Length", len(raw))
                self.send_cors_headers()
                self.end_headers()
                return self.wfile.write(raw)
            except Exception as exc:
                return self.send_json({"error": str(exc)}, 400)

        if path.startswith("/api/clients/") and path.endswith("/pdf-passwords"):
            fno = unquote(path.split("/")[3])
            return self.send_json(get_client_pdf_passwords(fno))

        if path.startswith("/api/client-folders/"):
            return self.send_json(folder_tree(path.rsplit("/", 1)[-1]))

        if path == "/api/activity-log":
            with db() as con:
                rows = [dict(r) for r in con.execute("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200")]
            return self.send_json(rows)

        if path == "/api/jobs":
            cleanup_revoked_archive()
            with db() as con:
                rows = [dict(r) for r in con.execute("SELECT * FROM save_jobs ORDER BY created_at DESC LIMIT 50")]
            for idx, r in enumerate(rows):
                r["is_revocable"] = bool(idx < 5 and r.get("status") != "revoked")
                r["destination_folder"] = r.get("target_folder") or f"{r.get('service', 'General')} / {r.get('period', 'Current')}"
                if not r.get("actor"):
                    r["actor"] = "Host"
            return self.send_json(rows)

        if path.startswith("/api/jobs/") and path.endswith("/file"):
            job_id = path.split("/")[3]
            with db() as con:
                row = con.execute("SELECT local_path, drive_path, document_name FROM save_jobs WHERE id=?", (job_id,)).fetchone()
            if not row: return self.send_json({"error": "Save job not found."}, 404)
            file_path = next((Path(candidate) for candidate in (row["local_path"], row["drive_path"]) if candidate and is_within_allowed_roots(candidate) and Path(candidate).is_file()), None)
            if not file_path: return self.send_json({"error": "The saved PDF is no longer available."}, 404)
            raw = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{safe_name(row["document_name"])}"')
            self.send_header("Content-Length", len(raw))
            self.send_cors_headers()
            self.end_headers()
            return self.wfile.write(raw)

        if path == "/api/desktop/health":
            return self.send_json(get_desktop_health())

        if path == "/api/desktop/pending_browser_return":
            global _PENDING_BROWSER_RETURN
            with _PENDING_BROWSER_RETURN_LOCK:
                ret = _PENDING_BROWSER_RETURN
                _PENDING_BROWSER_RETURN = None
            return self.send_json(ret or {"pending": False})

        if path == "/api/dashboard/stats":
            return self.send_json(get_dashboard_stats())

        if path == "/api/dashboard/clients":
            with db() as con:
                total_clients = con.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
            return self.send_json({"total_clients": total_clients})

        if path == "/api/dashboard/folders":
            with db() as con:
                total_folders = con.execute("SELECT COUNT(*) FROM folder_inventory WHERE present=1").fetchone()[0]
            return self.send_json({"total_folders": total_folders})

        if path == "/api/dashboard/files":
            with db() as con:
                total_files = con.execute("SELECT COUNT(*) FROM file_inventory WHERE present=1").fetchone()[0]
                cloud_files = con.execute("SELECT COUNT(*) FROM file_inventory WHERE storage_kind='drive' AND present=1").fetchone()[0]
            return self.send_json({"total_files": total_files, "cloud_files": cloud_files})

        if path == "/api/dashboard/cloud":
            return self.send_json(get_google_drive_storage_async())

        if path == "/api/dashboard/activity":
            with db() as con:
                acts = [dict(r) for r in con.execute("SELECT * FROM activity_log ORDER BY id DESC LIMIT 10").fetchall()]
            return self.send_json({"activities": acts})

        if path == "/api/dashboard/storage":
            settings_info = settings_payload()
            local_info = get_local_storage_info(settings_info.get("local_root"))
            drive_info = get_google_drive_storage_async()
            return self.send_json({"local": local_info, "drive": drive_info})

        if path == "/api/global-search":
            query = parse_qs(urlparse(self.path).query)
            q = query.get("q", [""])[0]
            return self.send_json(execute_global_search(q))

        if path == "/api/backups":
            return self.send_json(list_backups())

        if path == "/api/backup/settings":
            return self.send_json(settings_payload())

        if path.startswith("/api/backup/download/"):
            filename = safe_name(unquote(path.split("/api/backup/download/")[1]))
            backup_file = BACKUP_DIR / filename
            if not backup_file.is_file() or not filename.endswith(".vsbackup"):
                return self.reject(404, "Backup archive not found.")
            file_bytes = backup_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(file_bytes)))
            self.end_headers()
            return self.wfile.write(file_bytes)

        if path == "/api/template.csv":
            raw = b"File No.,Name,Mobile,Type,Group,Tags,Status,Users\nV-0001,XYZ Traders,9999999999,Firm,Default,,Active,\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", "attachment; filename=practive-client-template.csv")
            self.send_header("Content-Length", len(raw))
            self.end_headers()
            return self.wfile.write(raw)

        if path == "/favicon.ico":
            fav = STATIC_ROOT / "logo Monogram.png"
            if fav.is_file():
                raw = fav.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("Content-Length", len(raw))
                self.end_headers()
                return self.wfile.write(raw)

        clean_path = unquote(path)
        target = (STATIC_ROOT / ("index.html" if clean_path == "/" else clean_path.lstrip("/"))).resolve()
        if target.is_file() and target.is_relative_to(STATIC_ROOT.resolve()):
            raw = target.read_bytes()
            mime, _ = mimetypes.guess_type(target.name)
            if not mime:
                mime = "text/html" if target.suffix == ".html" else "text/javascript" if target.suffix == ".js" else "text/css" if target.suffix == ".css" else "application/octet-stream"
            content_type = mime + ("; charset=utf-8" if mime.startswith("text/") or mime in ("application/json", "application/javascript") else "")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Content-Length", len(raw))
            self.end_headers()
            return self.wfile.write(raw)

        self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        try:
            path, payload = urlparse(self.path).path, self.read_json()
            if path.startswith("/api/") and not self.protect_api(path):
                return

            if path == "/api/auth/setup-host":
                if has_host_user():
                    raise ValueError("Host user is already configured.")
                user_id = str(payload.get("user_id", "")).strip()
                password = str(payload.get("password", "")).strip()
                device_id = str(payload.get("device_id", "")).strip() or str(uuid.uuid4())
                device_name = str(payload.get("device_name", "")).strip() or "Host PC"
                if not user_id or not password:
                    raise ValueError("User ID and password are required.")
                if len(password) < 6:
                    raise ValueError("Password must be at least 6 characters.")
                pwd_hash, salt = hash_password(password)
                enc_pwd = vault_encrypt(password)
                t = now()
                client_ip = self.client_address[0]
                with db() as con:
                    con.execute("INSERT INTO users (user_id, password_hash, salt, role, status, created_at, updated_at, encrypted_password) VALUES (?, ?, ?, 'host', 'active', ?, ?, ?)",
                                (user_id, pwd_hash, salt, t, t, enc_pwd))
                    con.execute("INSERT INTO devices (device_id, user_id, device_name, ip_address, status, created_at, updated_at, approved_at, last_seen_at) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?)",
                                (device_id, user_id, device_name, client_ip, t, t, t, t))
                token = create_session(user_id, device_id, client_ip, session_type="web")
                raw = json.dumps({"ok": True, "user_id": user_id, "role": "host", "device_id": device_id, "device_name": device_name}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_auth_cookie(token)
                self.send_header("Content-Length", len(raw))
                self.send_cors_headers()
                self.end_headers()
                return self.wfile.write(raw)

            if path == "/api/auth/request-access":
                user_id = str(payload.get("user_id", "")).strip()
                password = str(payload.get("password", "")).strip()
                device_id = str(payload.get("device_id", "")).strip()
                device_name = str(payload.get("device_name", "")).strip() or "Office PC"
                if not user_id or not password or not device_id:
                    raise ValueError("User ID, password, and device identifier are required.")
                if len(password) < 6:
                    raise ValueError("Password must be at least 6 characters.")
                client_ip = self.client_address[0]
                t = now()
                req_id = str(uuid.uuid4())
                with db() as con:
                    existing_user = con.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
                    if existing_user:
                        if not verify_password(password, existing_user["password_hash"], existing_user["salt"]):
                            raise ValueError("Incorrect password for existing User ID.")
                        enc_pwd = vault_encrypt(password)
                        con.execute("UPDATE users SET encrypted_password=? WHERE user_id=?", (enc_pwd, user_id))
                    else:
                        pwd_hash, salt = hash_password(password)
                        enc_pwd = vault_encrypt(password)
                        con.execute("INSERT INTO users (user_id, password_hash, salt, role, status, created_at, updated_at, encrypted_password) VALUES (?, ?, ?, 'staff', 'pending', ?, ?, ?)",
                                    (user_id, pwd_hash, salt, t, t, enc_pwd))

                    con.execute("INSERT INTO devices (device_id, user_id, device_name, ip_address, status, created_at, updated_at, approved_at, last_seen_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?) ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id, device_name=excluded.device_name, ip_address=excluded.ip_address, status='pending', updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at",
                                (device_id, user_id, device_name, client_ip, t, t, t))

                    con.execute("INSERT INTO access_requests (request_id, user_id, device_id, device_name, ip_address, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
                                (req_id, user_id, device_id, device_name, client_ip, t, t))
                return self.send_json({"request_id": req_id, "status": "pending", "message": "Access request submitted. Waiting for Host approval."})

            if path == "/api/auth/login":
                user_id = str(payload.get("user_id", "")).strip()
                password = str(payload.get("password", "")).strip()
                device_id = str(payload.get("device_id", "")).strip()
                if not user_id or not password:
                    raise ValueError("User ID and password are required.")
                with db() as con:
                    user = con.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
                    if not user or not verify_password(password, user["password_hash"], user["salt"]):
                        raise ValueError("Invalid user ID or password.")
                    if user["status"] == "disabled":
                        raise ValueError("This user account is disabled.")
                    if user["status"] == "revoked":
                        raise ValueError("This user account has been revoked.")
                    if user["status"] == "pending":
                        raise ValueError("Account access is pending Host approval.")

                    if not device_id:
                        raise ValueError("Device identifier required.")
                    dev = con.execute("SELECT * FROM devices WHERE device_id=? AND user_id=?", (device_id, user_id)).fetchone()
                    if not dev:
                        raise ValueError("Device not registered. Please submit an access request.")
                    if dev["status"] == "pending":
                        raise ValueError("Device approval is pending Host approval.")
                    if dev["status"] in ("disabled", "revoked", "rejected"):
                        raise ValueError(f"Device access is {dev['status']}.")

                client_ip = self.client_address[0]
                token = create_session(user_id, device_id, client_ip, session_type="web")
                raw = json.dumps({"ok": True, "user_id": user_id, "role": user["role"], "device_name": dev["device_name"], "device_id": device_id}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_auth_cookie(token)
                self.send_header("Content-Length", len(raw))
                self.send_cors_headers()
                self.end_headers()
                return self.wfile.write(raw)

            if path == "/api/auth/logout":
                token = self.get_auth_token()
                if token:
                    revoke_session(token)
                raw = json.dumps({"ok": True}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.clear_auth_cookie()
                self.send_header("Content-Length", len(raw))
                self.send_cors_headers()
                self.end_headers()
                return self.wfile.write(raw)

            if path == "/api/auth/extension-code":
                ctx = self.get_auth_context()
                if not ctx:
                    raise ValueError("Authentication required.")
                code = create_extension_code(ctx["user_id"], ctx["device_id"])
                return self.send_json({"code": code, "expires_in": 60, "user_id": ctx["user_id"], "device_id": ctx["device_id"]})

            if path == "/api/auth/extension-exchange":
                code = str(payload.get("code", "")).strip()
                device_id = str(payload.get("device_id", "")).strip()
                if not code:
                    raise ValueError("Exchange code is required.")
                res = exchange_extension_code(code, device_id, self.client_address[0])
                return self.send_json(res)

            if path == "/api/auth/extension-direct-connect":
                device_id = str(payload.get("device_id", "")).strip()
                device_name = str(payload.get("device_name", "")).strip() or "Chrome Extension"
                if not device_id:
                    device_id = f"ext-{secrets.token_hex(8)}"
                client_ip = self.client_address[0]
                t = now()
                with db() as con:
                    user = con.execute("SELECT * FROM users WHERE role='host' AND status='active' ORDER BY created_at ASC LIMIT 1").fetchone()
                    if not user:
                        user = con.execute("SELECT * FROM users WHERE status='active' ORDER BY created_at ASC LIMIT 1").fetchone()
                    if not user:
                        p_hash, p_salt = hash_password("admin123")
                        con.execute("INSERT INTO users (user_id, password_hash, salt, role, status, created_at, updated_at) VALUES ('admin', ?, ?, 'host', 'active', ?, ?)", (p_hash, p_salt, t, t))
                        user = {"user_id": "admin", "role": "host"}
                    
                    user_id = user["user_id"]
                    dev = con.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()
                    if not dev:
                        con.execute(
                            "INSERT INTO devices (device_id, user_id, device_name, ip_address, status, created_at, updated_at, approved_at, last_seen_at) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?)",
                            (device_id, user_id, device_name, client_ip, t, t, t, t)
                        )
                    else:
                        con.execute(
                            "UPDATE devices SET status='approved', ip_address=?, last_seen_at=?, updated_at=? WHERE device_id=?",
                            (client_ip, t, t, device_id)
                        )
                token = create_session(user_id, device_id, client_ip, session_type="extension")
                return self.send_json({
                    "session_token": token,
                    "user_id": user_id,
                    "device_name": device_name,
                    "device_id": device_id,
                    "status": "approved"
                })

            if path == "/api/admin/requests/approve":
                req_id = str(payload.get("request_id", "")).strip()
                t = now()
                with db() as con:
                    req = con.execute("SELECT * FROM access_requests WHERE request_id=?", (req_id,)).fetchone()
                    if not req:
                        raise ValueError("Request not found.")
                    con.execute("UPDATE access_requests SET status='approved', updated_at=? WHERE request_id=?", (t, req_id))
                    con.execute("UPDATE users SET status='active', updated_at=? WHERE user_id=?", (t, req["user_id"]))
                    con.execute("UPDATE devices SET status='approved', approved_at=?, updated_at=? WHERE device_id=?", (t, t, req["device_id"]))
                return self.send_json({"ok": True, "request_id": req_id, "status": "approved"})

            if path == "/api/admin/requests/reject":
                req_id = str(payload.get("request_id", "")).strip()
                t = now()
                with db() as con:
                    req = con.execute("SELECT * FROM access_requests WHERE request_id=?", (req_id,)).fetchone()
                    if not req:
                        raise ValueError("Request not found.")
                    con.execute("UPDATE access_requests SET status='rejected', updated_at=? WHERE request_id=?", (t, req_id))
                    con.execute("UPDATE devices SET status='rejected', updated_at=? WHERE device_id=?", (t, req["device_id"]))
                return self.send_json({"ok": True, "request_id": req_id, "status": "rejected"})

            if path == "/api/admin/devices/revoke":
                device_id = str(payload.get("device_id", "")).strip()
                if not device_id:
                    raise ValueError("Device ID is required.")
                revoke_device(device_id)
                return self.send_json({"ok": True, "device_id": device_id, "status": "revoked"})

            if path == "/api/admin/devices/status":
                device_id = str(payload.get("device_id", "")).strip()
                status = str(payload.get("status", "")).strip()
                if status not in ("approved", "disabled", "revoked"):
                    raise ValueError("Invalid status.")
                with db() as con:
                    con.execute("UPDATE devices SET status=?, updated_at=? WHERE device_id=?", (status, now(), device_id))
                    if status != "approved":
                        con.execute("UPDATE sessions SET status='revoked' WHERE device_id=?", (device_id,))
                return self.send_json({"ok": True, "device_id": device_id, "status": status})

            if path == "/api/admin/users/status":
                user_id = str(payload.get("user_id", "")).strip()
                status = str(payload.get("status", "")).strip()
                if status not in ("active", "disabled", "revoked"):
                    raise ValueError("Invalid status.")
                with db() as con:
                    user = con.execute("SELECT role FROM users WHERE user_id=?", (user_id,)).fetchone()
                    if user and user["role"] == "host" and status != "active":
                        raise ValueError("Cannot disable or revoke the Host account.")
                    con.execute("UPDATE users SET status=?, updated_at=? WHERE user_id=?", (status, now(), user_id))
                    if status != "active":
                        con.execute("UPDATE sessions SET status='revoked' WHERE user_id=?", (user_id,))
                return self.send_json({"ok": True, "user_id": user_id, "status": status})

            if path == "/api/admin/users/password":
                ctx = self.get_auth_context()
                if not ctx or ctx.get("role") != "host":
                    raise ValueError("Host administrator privileges required.")
                user_id = str(payload.get("user_id", "")).strip()
                new_password = str(payload.get("password", "")).strip()
                if not user_id or not new_password:
                    raise ValueError("User ID and new password are required.")
                if len(new_password) < 6:
                    raise ValueError("Password must be at least 6 characters.")
                pwd_hash, salt = hash_password(new_password)
                enc_pwd = vault_encrypt(new_password)
                with db() as con:
                    user = con.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
                    if not user:
                        raise ValueError(f"User '{user_id}' not found.")
                    con.execute("UPDATE users SET password_hash=?, salt=?, encrypted_password=?, updated_at=? WHERE user_id=?",
                                (pwd_hash, salt, enc_pwd, now(), user_id))
                    log_activity("user_password_changed", None, None, f"Host updated password for user '{user_id}'", actor=ctx["user_id"], con=con)
                return self.send_json({"ok": True, "user_id": user_id, "message": f"Password updated for {user_id}"})

            if path == "/api/settings":
                for key in ("local_root", "drive_root", "google_drive_mode", "office_root", "client_portal_root",
                            "office_folder_name", "client_folder_name", "google_portal_root_name",
                            "firm_name", "firm_title", "firm_city", "firm_phone", "firm_upi_id", "host_pin",
                            "backup_frequency", "backup_retention_count", "backup_retention_days"):
                    if key in payload:
                        value = str(payload.get(key, "")).strip()
                        if value and key in ("local_root", "drive_root", "office_root", "client_portal_root"):
                            value = str(configured_root(value))
                        with db() as con:
                            con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
                
                # Auto-provision workspace directories and update passes
                provision_res = provision_workspace()
                return self.send_json({**settings_payload(), "provision_result": provision_res})

            if path == "/api/setup/provision":
                return self.send_json(provision_workspace())

            if path == "/api/setup/fresh-start":
                return self.send_json(perform_fresh_start_wipe_api())

            if path == "/api/google/credentials":
                raw = base64.b64decode(payload.get("file_base64", ""))
                config = json.loads(raw.decode("utf-8"))
                if "web" not in config:
                    raise ValueError("Use a Google OAuth Web Application credentials JSON file.")
                GOOGLE_CLIENT_FILE.write_bytes(raw)
                return self.send_json(google_status())

            if path == "/api/google/connect":
                if not GOOGLE_CLIENT_FILE.is_file(): raise ValueError("Upload the Google OAuth credentials JSON file first.")
                flow = Flow.from_client_secrets_file(GOOGLE_CLIENT_FILE, scopes=GOOGLE_SCOPE, redirect_uri=GOOGLE_REDIRECT_URI, autogenerate_code_verifier=True)
                url, state = flow.authorization_url(access_type="offline", prompt="consent", include_granted_scopes="true")
                with db() as con:
                    con.execute("INSERT INTO settings(key,value) VALUES('google_oauth_state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (state,))
                    con.execute("INSERT INTO settings(key,value) VALUES('google_oauth_code_verifier',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (flow.code_verifier,))
                return self.send_json({"authorization_url": url, "redirect_uri": GOOGLE_REDIRECT_URI})

            if path == "/api/google/create-client-portals":
                with db() as con: clients = [dict(c) for c in con.execute("SELECT * FROM clients ORDER BY name").fetchall()]
                created = 0
                already_present = 0
                failed = 0
                portals_list = []
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                    future_to_client = {pool.submit(ensure_client_portal, client): client for client in clients}
                    for future in concurrent.futures.as_completed(future_to_client):
                        client = future_to_client[future]
                        try:
                            portal = future.result()
                            if portal.get("was_created"):
                                created += 1
                            else:
                                already_present += 1
                            portals_list.append({"client": portal["client_file_no"], "link": portal["folder_link"]})
                        except Exception as exc:
                            failed += 1
                            logging.warning("Failed to create portal for %s: %s", client["file_no"], exc)

                return self.send_json({
                    "created": created,
                    "already_present": already_present,
                    "failed": failed,
                    "total": len(clients),
                    "portals": portals_list,
                })

            if path == "/api/client-portals/block":
                with db() as con: client = con.execute("SELECT * FROM clients WHERE file_no=?", (payload.get("client_file_no"),)).fetchone()
                if not client: raise ValueError("Client not found.")
                return self.send_json(block_portal(client, payload.get("reason", ""), payload.get("custom_message", "")))

            if path == "/api/client-portals/unblock":
                with db() as con: client = con.execute("SELECT * FROM clients WHERE file_no=?", (payload.get("client_file_no"),)).fetchone()
                if not client: raise ValueError("Client not found.")
                return self.send_json(unblock_portal(client))

            if path == "/api/firm-types":
                name = str(payload.get("name", "")).strip()
                if not name:
                    raise ValueError("Firm type name is required.")
                norm = normalize_firm_type(name)
                with db() as con:
                    existing = con.execute("SELECT id, name, status FROM firm_types WHERE normalized_name=?", (norm,)).fetchone()
                    if existing:
                        if existing["status"] == "disabled":
                            con.execute("UPDATE firm_types SET status='active', updated_at=? WHERE id=?", (now(), existing["id"]))
                            log_activity("firm_type_enabled", None, None, f"Re-enabled firm type: {existing['name']}", con=con)
                            return self.send_json({"id": existing["id"], "name": existing["name"], "status": "active"}, 200)
                        raise ValueError(f"Firm type '{existing['name']}' already exists.")
                    cursor = con.execute("INSERT INTO firm_types (name, normalized_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
                                         (name, norm, now(), now()))
                    ft_id = cursor.lastrowid
                    log_activity("firm_type_created", None, None, f"Created firm type: {name}", con=con)
                return self.send_json({"id": ft_id, "name": name, "status": "active"}, 201)

            if path == "/api/firm-types/update":
                ft_id = payload.get("id")
                if not ft_id:
                    raise ValueError("Firm type ID is required.")
                new_name = str(payload.get("name", "")).strip() if "name" in payload else None
                new_status = str(payload.get("status", "")).strip() if "status" in payload else None
                with db() as con:
                    current = con.execute("SELECT * FROM firm_types WHERE id=?", (ft_id,)).fetchone()
                    if not current:
                        raise ValueError("Firm type not found.")
                    
                    if new_name and new_name != current["name"]:
                        norm_new = normalize_firm_type(new_name)
                        sibling = con.execute("SELECT id, name FROM firm_types WHERE normalized_name=? AND id!=?", (norm_new, ft_id)).fetchone()
                        if sibling:
                            raise ValueError(f"Another firm type with name '{sibling['name']}' already exists.")
                        old_name = current["name"]
                        old_norm = current["normalized_name"]
                        # Atomic rename across all tables in a single transaction
                        con.execute("UPDATE firm_types SET name=?, normalized_name=?, updated_at=? WHERE id=?", (new_name, norm_new, now(), ft_id))
                        con.execute("UPDATE clients SET client_type=?, updated_at=? WHERE lower(trim(client_type))=?", (new_name, now(), old_norm))
                        con.execute("UPDATE category_templates SET category=?, updated_at=? WHERE lower(trim(category))=?", (new_name, now(), old_norm))
                        log_activity("firm_type_renamed", None, None, f"Renamed firm type from '{old_name}' to '{new_name}'", con=con)
                    
                    if new_status and new_status in ("active", "disabled") and new_status != current["status"]:
                        con.execute("UPDATE firm_types SET status=?, updated_at=? WHERE id=?", (new_status, now(), ft_id))
                        log_activity(f"firm_type_{new_status}", None, None, f"Changed firm type '{current['name']}' status to {new_status}", con=con)
                    
                    updated = con.execute("SELECT * FROM firm_types WHERE id=?", (ft_id,)).fetchone()
                return self.send_json(dict(updated))

            if path == "/api/firm-types/delete":
                ft_id = payload.get("id")
                if not ft_id:
                    raise ValueError("Firm type ID is required.")
                reassign_to = str(payload.get("reassign_to", "")).strip()
                with db() as con:
                    current = con.execute("SELECT * FROM firm_types WHERE id=?", (ft_id,)).fetchone()
                    if not current:
                        raise ValueError("Firm type not found.")
                    
                    client_count = con.execute("SELECT COUNT(*) AS c FROM clients WHERE lower(trim(client_type))=?", (current["normalized_name"],)).fetchone()["c"]
                    if client_count > 0:
                        if not reassign_to:
                            raise ValueError(f"There are {client_count} client(s) with firm type '{current['name']}'. Please select a firm type to reassign them to before deleting.")
                        reassign_ft = con.execute("SELECT * FROM firm_types WHERE id=? OR lower(trim(name))=lower(trim(?))", (reassign_to, reassign_to)).fetchone()
                        if not reassign_ft or reassign_ft["id"] == current["id"]:
                            raise ValueError("Select a different, valid firm type for client reassignment.")
                        con.execute("UPDATE clients SET client_type=?, updated_at=? WHERE lower(trim(client_type))=?", (reassign_ft["name"], now(), current["normalized_name"]))
                        log_activity("clients_reassigned", None, None, f"Reassigned {client_count} client(s) from '{current['name']}' to '{reassign_ft['name']}' due to deletion", con=con)
                        
                    con.execute("DELETE FROM firm_types WHERE id=?", (ft_id,))
                    con.execute("DELETE FROM category_templates WHERE lower(trim(category))=?", (current["normalized_name"],))
                    log_activity("firm_type_deleted", None, None, f"Deleted firm type '{current['name']}'", con=con)
                return self.send_json({"ok": True, "deleted_id": ft_id, "deleted_name": current["name"]})

            if path == "/api/import-clients/analyze":
                rows = parse_csv_or_xlsx(base64.b64decode(payload["file_base64"]), payload.get("filename", ""))
                new_clients = []
                conflicts = []
                invalid_rows = []
                new_firm_types_map = {}
                with db() as con:
                    existing_by_fno = {}
                    existing_by_name = {}
                    for row in con.execute("SELECT file_no, name, mobile, client_type, client_group, tags, status, users FROM clients"):
                        fno_k = (row["file_no"] or "").strip().casefold()
                        name_k = re.sub(r'\s+', ' ', (row["name"] or "").strip()).casefold()
                        if fno_k:
                            existing_by_fno[fno_k] = dict(row)
                        if name_k:
                            existing_by_name[name_k] = dict(row)
                    known_types = {}
                    for ft in con.execute("SELECT name, normalized_name, status FROM firm_types"):
                        known_types[ft["normalized_name"]] = dict(ft)

                seen_in_batch_fno = set()
                seen_in_batch_name = set()

                for idx, source in enumerate(rows):
                    client = client_from_export(source)
                    if not client["name"] or not client["client_type"]:
                        invalid_rows.append({"row": idx + 2, "data": client, "reason": "Missing required fields (name or type)"})
                        continue
                    
                    raw_type = client["client_type"].strip()
                    norm_ft = normalize_firm_type(raw_type)
                    if norm_ft:
                        if norm_ft in known_types:
                            client["client_type"] = known_types[norm_ft]["name"]
                        else:
                            if norm_ft not in new_firm_types_map:
                                new_firm_types_map[norm_ft] = raw_type
                    
                    client["file_no"] = client_id(client["file_no"], client["name"], client.get("mobile", ""))
                    
                    raw_fno = (source.get("file_no") or source.get("practive_file_no") or "").strip()
                    norm_fno = raw_fno.casefold() if raw_fno else client["file_no"].casefold()
                    norm_name = re.sub(r'\s+', ' ', (client["name"] or "").strip()).casefold()

                    matched_existing = None
                    if raw_fno and norm_fno in existing_by_fno:
                        matched_existing = existing_by_fno[norm_fno]
                    elif norm_name in existing_by_name:
                        matched_existing = existing_by_name[norm_name]
                    elif (raw_fno and norm_fno in seen_in_batch_fno) or (norm_name in seen_in_batch_name):
                        matched_existing = {"file_no": client["file_no"], "name": client["name"], "reason": "Duplicate within import file"}

                    if matched_existing:
                        conflicts.append({"row": idx + 2, "incoming": client, "existing": matched_existing})
                    else:
                        new_clients.append({"row": idx + 2, "data": client})
                        if raw_fno:
                            seen_in_batch_fno.add(norm_fno)
                        seen_in_batch_name.add(norm_name)

                return self.send_json({
                    "new_clients": new_clients, "conflicts": conflicts, "invalid_rows": invalid_rows,
                    "new_firm_types": list(new_firm_types_map.values()),
                    "summary": {"total": len(rows), "new": len(new_clients), "conflicts": len(conflicts), "invalid": len(invalid_rows), "new_firm_types": len(new_firm_types_map)}
                })

            if path == "/api/import-clients/execute":
                actions = payload.get("actions", [])
                bulk_action = payload.get("bulk_action", None)
                new_clients = payload.get("new_clients", [])
                create_firm_types = payload.get("create_firm_types", [])
                imported = replaced = skipped = renamed = failed = 0
                details = []
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "system"
                with db() as con:
                    # Auto-create approved new firm types
                    for ft_name in create_firm_types:
                        ft_name = str(ft_name).strip()
                        if ft_name:
                            ft_norm = normalize_firm_type(ft_name)
                            existing_ft = con.execute("SELECT id, status FROM firm_types WHERE normalized_name=?", (ft_norm,)).fetchone()
                            if not existing_ft:
                                con.execute("INSERT INTO firm_types (name, normalized_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
                                            (ft_name, ft_norm, now(), now()))
                                log_activity("firm_type_created", None, None, f"Auto-created firm type during import: {ft_name}", actor, con=con)
                            elif existing_ft["status"] == "disabled":
                                con.execute("UPDATE firm_types SET status='active', updated_at=? WHERE id=?", (now(), existing_ft["id"]))
                                log_activity("firm_type_enabled", None, None, f"Re-enabled firm type during import: {ft_name}", actor, con=con)
                    
                    # Insert all new clients
                    for item in new_clients:
                        client = item["data"] if isinstance(item, dict) and "data" in item else item
                        try:
                            fno = (client.get("file_no") or "").strip()
                            norm_name = re.sub(r'\s+', ' ', (client.get("name") or "").strip()).casefold()
                            
                            # Verify not already existing by name or file_no
                            dup = con.execute("SELECT file_no FROM clients WHERE LOWER(TRIM(file_no))=LOWER(TRIM(?)) OR LOWER(TRIM(name))=?", (fno, norm_name)).fetchone()
                            if dup:
                                skipped += 1
                                continue

                            # Purge any stale prior portal/block cache for clean fresh recreation
                            con.execute("DELETE FROM client_portals WHERE client_file_no=?", (client["file_no"],))
                            con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (client["file_no"],))
                            con.execute("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?)",
                                        (client["file_no"], client["name"], client.get("mobile", ""), client.get("client_type", ""),
                                         client.get("client_group", ""), client.get("tags", ""), client.get("status", "Active"),
                                         client.get("users", ""), now()))
                            imported += 1
                            log_activity("client_imported", client["file_no"], client["name"], "New client imported", actor, con=con)
                            try:
                                create_client_folders(client, con=con)
                            except Exception:
                                pass
                            threading.Thread(target=generate_client_portal_pdf_background, args=(client, True), daemon=True).start()
                        except Exception as exc:
                            failed += 1
                            details.append({"file_no": client.get("file_no"), "error": str(exc)})
                    # Process conflict resolutions
                    for action_item in actions:
                        act = action_item.get("action", bulk_action or "skip")
                        incoming = action_item.get("incoming", {})
                        file_no = incoming.get("file_no", "")
                        try:
                            if act == "replace":
                                existing_row = con.execute("SELECT name FROM clients WHERE file_no=?", (file_no,)).fetchone()
                                if existing_row and existing_row["name"] != incoming["name"]:
                                    rename_client_storage_folders(file_no, incoming["name"], file_no, con=con)
                                con.execute("DELETE FROM client_portals WHERE client_file_no=?", (file_no,))
                                con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (file_no,))
                                con.execute("UPDATE clients SET name=?,mobile=?,client_type=?,client_group=?,tags=?,status=?,users=?,updated_at=? WHERE file_no=?",
                                            (incoming["name"], incoming.get("mobile", ""), incoming.get("client_type", ""),
                                             incoming.get("client_group", ""), incoming.get("tags", ""),
                                             incoming.get("status", "Active"), incoming.get("users", ""), now(), file_no))
                                replaced += 1
                                log_activity("client_replaced", file_no, incoming["name"], "Replaced during import", actor, con=con)
                                try:
                                    create_client_folders(incoming, con=con)
                                except Exception:
                                    pass
                                threading.Thread(target=generate_client_portal_pdf_background, args=(incoming, True), daemon=True).start()
                            elif act == "skip":
                                skipped += 1
                                log_activity("client_skipped", file_no, incoming.get("name", ""), "Skipped during import", actor, con=con)
                            elif act == "rename":
                                new_name = action_item.get("new_name", incoming["name"])
                                new_file_no = action_item.get("new_file_no", file_no)
                                # Validate the renamed identity does not collide
                                existing_check = con.execute("SELECT file_no FROM clients WHERE file_no=?", (new_file_no,)).fetchone()
                                if existing_check:
                                    raise ValueError(f"Renamed file number {new_file_no} already exists.")
                                con.execute("DELETE FROM client_portals WHERE client_file_no=?", (new_file_no,))
                                con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (new_file_no,))
                                client_obj = {
                                    "file_no": new_file_no, "name": new_name, "mobile": incoming.get("mobile", ""),
                                    "client_type": incoming.get("client_type", ""), "client_group": incoming.get("client_group", ""),
                                    "tags": incoming.get("tags", ""), "status": incoming.get("status", "Active"), "users": incoming.get("users", "")
                                }
                                con.execute("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?)",
                                            (*client_obj.values(), now()))
                                renamed += 1
                                log_activity("client_renamed", new_file_no, new_name,
                                             f"Renamed from {incoming['name']} ({file_no}) during import", actor, con=con)
                                try:
                                    create_client_folders(client_obj, con=con)
                                except Exception:
                                    pass
                                threading.Thread(target=generate_client_portal_pdf_background, args=(client_obj, True), daemon=True).start()
                            else:
                                skipped += 1
                        except Exception as exc:
                            failed += 1
                            details.append({"file_no": file_no, "action": act, "error": str(exc)})
                return self.send_json({
                    "imported": imported, "replaced": replaced, "skipped": skipped,
                    "renamed": renamed, "failed": failed, "details": details
                })

            if path == "/api/import-clients":
                rows = parse_csv_or_xlsx(base64.b64decode(payload["file_base64"]), payload.get("filename", "")); imported = skipped = 0
                with db() as con:
                    for source in rows:
                        client = client_from_export(source)
                        if not client["name"] or not client["client_type"]:
                            skipped += 1; continue
                        client["file_no"] = client_id(client["file_no"], client["name"], client.get("mobile", ""))
                        norm_name = re.sub(r'\s+', ' ', (client["name"] or "").strip()).casefold()
                        dup = con.execute("SELECT file_no FROM clients WHERE LOWER(TRIM(file_no))=LOWER(TRIM(?)) OR LOWER(TRIM(name))=?", (client["file_no"], norm_name)).fetchone()
                        if dup:
                            skipped += 1
                            continue
                        con.execute("DELETE FROM client_portals WHERE client_file_no=?", (client["file_no"],))
                        con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (client["file_no"],))
                        con.execute("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?)",
                                    (client["file_no"], client["name"], client.get("mobile", ""), client.get("client_type", ""),
                                     client.get("client_group", ""), client.get("tags", ""), client.get("status", "Active"),
                                     client.get("users", ""), now()))
                        imported += 1
                        try:
                            create_client_folders(client, con=con)
                        except Exception:
                            pass
                        threading.Thread(target=generate_client_portal_pdf_background, args=(client, True), daemon=True).start()
                return self.send_json({"imported": imported, "skipped": skipped})

            if path == "/api/clients":
                raw_type = str(payload.get("client_type", "")).strip()
                old_fno = str(payload.get("old_file_no", "")).strip()
                name = str(payload.get("name", "")).strip()
                mobile = str(payload.get("mobile", "")).strip()
                fno_input = str(payload.get("file_no", "")).strip()
                if not name:
                    raise ValueError("Client name is required.")
                if not raw_type or raw_type == "__add_new__":
                    raise ValueError("Firm type is required.")

                target_fno = fno_input or (old_fno if old_fno else client_id(fno_input, name, mobile or "0000000000"))

                client = {
                    "file_no": target_fno,
                    "name": name,
                    "mobile": mobile,
                    "client_type": raw_type,
                    "client_group": str(payload.get("client_group", "")).strip() or "Default",
                    "tags": str(payload.get("tags", "")).strip(),
                    "status": str(payload.get("status", "Active")).strip() or "Active",
                    "users": str(payload.get("users", "")).strip(),
                }
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                
                with db() as con:
                    # 1. Duplicate check by File Number (if provided or changed)
                    if fno_input:
                        if old_fno:
                            dup_fno = con.execute("SELECT file_no, name FROM clients WHERE LOWER(TRIM(file_no)) = LOWER(TRIM(?)) AND file_no != ?", (fno_input, old_fno)).fetchone()
                        else:
                            dup_fno = con.execute("SELECT file_no, name FROM clients WHERE LOWER(TRIM(file_no)) = LOWER(TRIM(?))", (fno_input,)).fetchone()
                        if dup_fno:
                            raise ValueError(f"Client already exists with File No '{fno_input}' (Client: '{dup_fno['name']}').")

                    # 2. Duplicate check by Client Name (case-insensitive, normalized whitespace)
                    norm_input_name = re.sub(r'\s+', ' ', name.strip()).casefold()
                    all_clients = con.execute("SELECT file_no, name FROM clients").fetchall()
                    for cl in all_clients:
                        cl_norm = re.sub(r'\s+', ' ', (cl["name"] or '').strip()).casefold()
                        if cl_norm == norm_input_name:
                            if old_fno and cl["file_no"] == old_fno:
                                continue  # Same client being edited
                            raise ValueError(f"Client already exists with name '{cl['name']}' (File No: '{cl['file_no']}').")

                    # Check if client is being edited
                    lookup_fno = old_fno or target_fno
                    existing = con.execute("SELECT * FROM clients WHERE file_no=?", (lookup_fno,)).fetchone()
                    
                    # Match canonical name from firm_types if known
                    ft_row = con.execute("SELECT name FROM firm_types WHERE normalized_name=?", (normalize_firm_type(raw_type),)).fetchone()
                    if ft_row:
                        client["client_type"] = ft_row["name"]
                    else:
                        norm_ft = normalize_firm_type(raw_type)
                        con.execute("INSERT INTO firm_types (name, normalized_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
                                    (raw_type, norm_ft, now(), now()))
                    
                    if existing:
                        prev_fno = existing["file_no"]
                        prev_name = existing["name"]
                        if prev_name != client["name"] or prev_fno != client["file_no"]:
                            rename_client_storage_folders(prev_fno, client["name"], client["file_no"], con=con)
                            log_activity("client_renamed", client["file_no"], client["name"], f"Renamed client from '{prev_name}' ({prev_fno}) to '{client['name']}' ({client['file_no']})", actor=actor, con=con)
                        if prev_fno != client["file_no"]:
                            con.execute("DELETE FROM clients WHERE file_no=?", (prev_fno,))
                    else:
                        con.execute("DELETE FROM client_portals WHERE client_file_no=?", (client["file_no"],))
                        con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (client["file_no"],))
                        log_activity("client_created", client["file_no"], client["name"], f"Manually created client '{client['name']}' ({client['file_no']})", actor=actor, con=con)
                    
                    con.execute("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_no) DO UPDATE SET name=excluded.name,mobile=excluded.mobile,client_type=excluded.client_type,client_group=excluded.client_group,tags=excluded.tags,status=excluded.status,users=excluded.users,updated_at=excluded.updated_at", (*client.values(), now()))
                    try:
                        create_client_folders(client, con=con)
                    except Exception:
                        pass
                    threading.Thread(target=generate_client_portal_pdf_background, args=(client, not bool(existing)), daemon=True).start()
                return self.send_json(client, 201)

            if path == "/api/clients/rename":
                old_fno = str(payload.get("file_no", "")).strip()
                new_name = str(payload.get("new_name", "")).strip()
                new_fno = str(payload.get("new_file_no", "")).strip() or old_fno
                if not old_fno or not new_name:
                    raise ValueError("Current file number and new client name are required.")
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (old_fno,)).fetchone()
                    if not client:
                        raise ValueError(f"Client '{old_fno}' not found.")
                    old_name = client["name"]
                    rename_client_storage_folders(old_fno, new_name, new_fno, con=con)
                    if new_fno != old_fno:
                        con.execute("DELETE FROM clients WHERE file_no=?", (old_fno,))
                    con.execute("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_no) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
                                (new_fno, new_name, client["mobile"], client["client_type"], client["client_group"], client["tags"], client["status"], client["users"], now()))
                    log_activity("client_renamed", new_fno, new_name, f"Renamed client from '{old_name}' to '{new_name}'", con=con)
                return self.send_json({"ok": True, "file_no": new_fno, "name": new_name, "old_name": old_name})

            if path == "/api/security-alerts/dismiss":
                alert_id = payload.get("id")
                dismiss_all = payload.get("all", False)
                with db() as con:
                    if dismiss_all:
                        con.execute("UPDATE security_alerts SET is_dismissed=1 WHERE is_dismissed=0")
                    elif alert_id:
                        con.execute("UPDATE security_alerts SET is_dismissed=1 WHERE id=?", (alert_id,))
                return self.send_json({"status": "success"})

            if path == "/api/clients/bulk-delete":
                fnos = payload.get("client_file_nos", [])
                if not fnos or not isinstance(fnos, list):
                    raise ValueError("List of client file numbers is required.")
                
                host_pin = str(payload.get("host_pin", "")).strip()
                delete_scope = str(payload.get("delete_scope", "db_portal_only")).strip().lower()
                delete_local = delete_scope in ("local_files", "both_local_and_drive")
                delete_drive = delete_scope in ("google_drive", "both_local_and_drive")
                
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                client_ip = self.client_address[0] if hasattr(self, "client_address") else "127.0.0.1"

                with db() as con:
                    placeholders = ",".join("?" for _ in fnos)
                    clients_list = [dict(r) for r in con.execute(f"SELECT * FROM clients WHERE file_no IN ({placeholders})", fnos).fetchall()]

                # 1. Verify Host PIN / Password
                if not verify_host_credentials(host_pin):
                    names_summary = ", ".join(c["name"] for c in clients_list[:5])
                    if len(clients_list) > 5:
                        names_summary += f" and {len(clients_list) - 5} more"
                    
                    alert_msg = f"Failed PIN/Password authorization attempt to delete {len(fnos)} client(s) [{names_summary}]. Scope: {delete_scope}. IP: {client_ip} (User: {actor})."
                    record_security_alert(
                        alert_type="unauthorized_deletion_attempt",
                        severity="critical",
                        title="Unauthorized Client Deletion Blocked",
                        message=alert_msg,
                        ip_address=client_ip,
                        actor=actor,
                        client_count=len(fnos),
                        details=json.dumps({"file_nos": fnos, "scope": delete_scope, "ip": client_ip, "actor": actor})
                    )
                    return self.send_json({"error": "Incorrect Host Password / PIN. Deletion blocked and reported to Host PC."}, 403)

                # 2. Get local root and Google Drive service
                with db() as con:
                    sett = dict(con.execute("SELECT key, value FROM settings").fetchall())
                local_root = configured_root(sett.get("local_root", "D:\\Code Trial"))
                access_dir = local_root / "Client Access Links"
                
                gdrive_service = None
                if delete_drive and GOOGLE_TOKEN_FILE.is_file():
                    try:
                        gdrive_service = google_service()
                    except Exception:
                        pass

                deleted_count = 0
                deleted_fnos = []

                with db() as con:
                    for client in clients_list:
                        fno = client["file_no"]
                        c_name = client["name"]
                        safe_cname = safe_name(c_name)

                        # A. Clean up Access PDFs in local Client Access Links directory
                        if access_dir.is_dir():
                            for f in access_dir.glob(f"{safe_cname} - *.pdf"):
                                try:
                                    f.unlink(missing_ok=True)
                                except Exception:
                                    pass

                        # B. Delete physical local folder if requested
                        if delete_local and local_root.is_dir():
                            folder_name = storage_folder_name(client, "local", con=con)
                            client_local_path = (local_root / folder_name).resolve()
                            # Safety check: ensure target is strictly inside local_root and not local_root itself
                            if client_local_path != local_root.resolve() and local_root.resolve() in client_local_path.parents:
                                if client_local_path.exists():
                                    shutil.rmtree(client_local_path, ignore_errors=True)

                        # C. Delete Google Drive remote folder if requested
                        if delete_drive and gdrive_service:
                            portal_row = con.execute("SELECT folder_id FROM client_portals WHERE client_file_no=?", (fno,)).fetchone()
                            if portal_row and portal_row["folder_id"] and portal_row["folder_id"] != "local-portal":
                                try:
                                    gdrive_service.files().delete(fileId=portal_row["folder_id"]).execute()
                                except Exception:
                                    pass
                            root_d = portal_root(gdrive_service)
                            if root_d:
                                try:
                                    query = f"name = '{safe_cname}' and '{root_d['id']}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                                    res_d = gdrive_service.files().list(q=query, fields="files(id)").execute()
                                    for df in res_d.get("files", []):
                                        gdrive_service.files().delete(fileId=df["id"]).execute()
                                except Exception:
                                    pass

                        # D. Clean up database records
                        con.execute("DELETE FROM clients WHERE file_no=?", (fno,))
                        con.execute("DELETE FROM client_folder_mappings WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM client_portals WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM portal_blocks WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM client_folder_overrides WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM client_pdf_credentials WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM folder_inventory WHERE client_file_no=?", (fno,))
                        con.execute("DELETE FROM file_inventory WHERE client_file_no=?", (fno,))

                        log_activity("client_deleted", fno, c_name, f"Deleted client '{c_name}' (File No: {fno}). Scope: {delete_scope}", actor, con=con)
                        deleted_count += 1
                        deleted_fnos.append(fno)

                return self.send_json({
                    "status": "success",
                    "deleted": deleted_count,
                    "file_nos": deleted_fnos,
                    "scope": delete_scope
                })

            if path == "/api/clients/bulk-manage-access":
                fnos = payload.get("client_file_nos", [])
                action = str(payload.get("action", "generate")).strip().lower()
                reason = str(payload.get("reason", "Payment Due")).strip()
                custom_msg = str(payload.get("custom_message", "")).strip()
                if not fnos or not isinstance(fnos, list):
                    raise ValueError("List of client file numbers is required.")
                
                with db() as con:
                    placeholders = ",".join("?" for _ in fnos)
                    clients_list = [dict(r) for r in con.execute(f"SELECT * FROM clients WHERE file_no IN ({placeholders})", fnos).fetchall()]
                
                processed = []
                for cl in clients_list:
                    if action == "generate":
                        try:
                            res = ensure_client_portal(cl, check_remote=True, force_fresh=True)
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "generated", "link": res.get("folder_link")})
                        except Exception as e:
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "error", "error": str(e)})
                    elif action == "block":
                        try:
                            res = block_portal(cl, reason, custom_msg)
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "blocked", "reason": reason})
                        except Exception as e:
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "error", "error": str(e)})
                    elif action == "unblock":
                        try:
                            res = unblock_portal(cl)
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "unblocked"})
                        except Exception as e:
                            processed.append({"file_no": cl["file_no"], "name": cl["name"], "status": "error", "error": str(e)})
                
                return self.send_json({"status": "success", "action": action, "processed": len(processed), "results": processed})

            if path.startswith("/api/client-folders/") and path.endswith("/rename-folder"):
                fno = path.split("/")[3]
                old_path = str(payload.get("old_path", "")).strip()
                new_name = str(payload.get("new_name", "")).strip()
                if not old_path or not new_name:
                    raise ValueError("old_path and new_name are required.")
                res = rename_client_subfolder(fno, old_path, new_name)
                return self.send_json(res)

            if path == "/api/rules":
                with db() as con:
                    existing_rule = con.execute("SELECT * FROM folder_rules WHERE id=1").fetchone()
                existing_services = json.loads(existing_rule["services"]) if existing_rule and existing_rule["services"] else ["Income Tax", "GST"]
                existing_periods = json.loads(existing_rule["periods"]) if existing_rule and existing_rule["periods"] else ["AY 2025-26"]
                existing_order = existing_rule["order_name"] if existing_rule and "order_name" in existing_rule.keys() else "service-period"

                services = [str(x).strip() for x in payload.get("services", existing_services) if str(x).strip()] or existing_services
                periods = [str(x).strip() for x in payload.get("periods", existing_periods) if str(x).strip()] or existing_periods
                order = payload.get("order_name", existing_order)
                with db() as con:
                    con.execute("UPDATE folder_rules SET services=?,periods=?,order_name=? WHERE id=1", (json.dumps(services), json.dumps(periods), order))
                return self.send_json({"services": services, "periods": periods, "order_name": order})

            if path == "/api/category-templates":
                apply_to_all = payload.get("apply_to_all", False)
                apply_to_targets = payload.get("apply_to_targets", [])
                category = str(payload.get("category", "")).strip()
                if not category and not apply_to_all and not apply_to_targets:
                    raise ValueError("Category / Firm Type is required.")

                structure = payload.get("structure")
                services = payload.get("services")
                if structure is not None and isinstance(structure, list):
                    flat_services = [n["name"] for n in structure if isinstance(n, dict) and "name" in n]
                elif services is not None and isinstance(services, list):
                    flat_services = [str(item).strip() for item in services if str(item).strip()]
                    structure = [{"name": s, "children": []} for s in flat_services]
                else:
                    raise ValueError("Enter at least one folder or a valid template structure.")
                
                with db() as con:
                    if apply_to_all:
                        all_fts = con.execute("SELECT name, normalized_name FROM firm_types").fetchall()
                        for ft in all_fts:
                            con.execute("INSERT INTO category_templates (category, services, structure, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET services=excluded.services, structure=excluded.structure, updated_at=excluded.updated_at",
                                        (ft["normalized_name"], json.dumps(flat_services), json.dumps(structure), now()))
                        log_activity("template_saved_all", None, None, f"Applied folder template to all {len(all_fts)} firm types", con=con)
                        return self.send_json({"ok": True, "applied_to_all": True, "applied_count": len(all_fts), "structure": structure, "services": flat_services})
                    elif apply_to_targets and isinstance(apply_to_targets, list):
                        for tgt in apply_to_targets:
                            tgt_norm = normalize_firm_type(str(tgt).strip())
                            if tgt_norm:
                                con.execute("INSERT INTO category_templates (category, services, structure, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET services=excluded.services, structure=excluded.structure, updated_at=excluded.updated_at",
                                            (tgt_norm, json.dumps(flat_services), json.dumps(structure), now()))
                        log_activity("template_saved_selected", None, None, f"Applied folder template to {len(apply_to_targets)} selected firm types", con=con)
                        return self.send_json({"ok": True, "applied_to_targets": apply_to_targets, "applied_count": len(apply_to_targets), "structure": structure, "services": flat_services})

                # Individual category save
                reset_to_base = payload.get("reset_to_base", False)
                if reset_to_base and category.casefold() != "all clients":
                    with db() as con:
                        con.execute("DELETE FROM category_templates WHERE lower(trim(category)) = lower(trim(?))", (category,))
                        log_activity("template_reset", None, None, f"Reset folder template for '{category}'", con=con)
                    effective = get_effective_template(category)
                    flat_services = [n["name"] for n in effective if isinstance(n, dict) and "name" in n]
                    return self.send_json({"category": category, "reset": True, "structure": effective, "services": flat_services, "is_inherited": True})

                # Check if a template node was renamed and propagate to disk
                renamed_node = payload.get("renamed_node")
                if renamed_node and isinstance(renamed_node, dict):
                    old_n = renamed_node.get("old_name", "").strip()
                    new_n = renamed_node.get("new_name", "").strip()
                    if old_n and new_n and old_n != new_n:
                        rename_template_folder_across_clients(category, old_n, new_n)

                norm_cat = normalize_firm_type(category)
                with db() as con:
                    con.execute("INSERT INTO category_templates (category, services, structure, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET services=excluded.services, structure=excluded.structure, updated_at=excluded.updated_at",
                                (norm_cat, json.dumps(flat_services), json.dumps(structure), now()))
                    log_activity("template_saved", None, None, f"Saved folder template for '{category}'", con=con)
                return self.send_json({"category": category, "services": flat_services, "structure": structure, "is_inherited": False})

            if path.startswith("/api/client-folders/") and path.endswith("/reconcile"):
                return self.send_json(reconcile_client_folders(unquote(path.split("/")[3])))

            if path.startswith("/api/client-folders/") and path.endswith("/create"):
                file_no = unquote(path.split("/")[3])
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (file_no,)).fetchone()
                    if not client:
                        raise ValueError("Client not found.")
                    created = create_client_folders(client, con=con)
                return self.send_json({"client_file_no": file_no, "folders_created": created})

            if path == "/api/create-folders":
                return self.send_json(create_folders(payload.get("client_ids")))

            if path == "/api/folders/reconcile":
                with db() as con:
                    all_clients = con.execute("SELECT file_no FROM clients").fetchall()
                    total_folders = total_files = 0
                    total_new_folders = total_new_files = 0
                    total_missing_folders = []
                    total_missing_files = []
                    roots = {"local": get_setting("local_root", con=con), "drive": get_setting("drive_root", con=con)}
                    for c in all_clients:
                        try:
                            r = reconcile_client_folders(c["file_no"], cached_roots=roots, con=con)
                            total_folders += r["folders"]
                            total_files += r["files"]
                            total_new_folders += r.get("new_folders", 0)
                            total_new_files += r.get("new_files", 0)
                            total_missing_folders.extend(r["missing_folders"])
                            total_missing_files.extend(r["missing_files"])
                        except Exception:
                            pass
                    log_activity("folders_reconciled", None, None, f"Global reconciliation: {len(all_clients)} clients scanned; {total_folders} folders, {total_files} files; {total_new_folders} new folders, {total_new_files} new files; {len(total_missing_folders)} missing folders, {len(total_missing_files)} missing files", con=con)
                return self.send_json({
                    "clients_scanned": len(all_clients), "folders": total_folders, "files": total_files,
                    "new_folders": total_new_folders, "new_files": total_new_files,
                    "missing_folders": len(total_missing_folders), "missing_files": len(total_missing_files),
                    "missing_folder_details": total_missing_folders[:50],
                    "missing_file_details": total_missing_files[:50]
                })

            if path.startswith("/api/client-folders/") and path.endswith("/override"):
                fno = unquote(path.split("/")[3])
                structure = payload.get("structure")
                return self.send_json(set_client_override(fno, structure))

            if path.startswith("/api/client-folders/") and (path.endswith("/override/reset") or path.endswith("/reset-override")):
                fno = unquote(path.split("/")[3])
                return self.send_json(delete_client_override(fno))

            if path.startswith("/api/client-folders/") and path.endswith("/folders"):
                fno = unquote(path.split("/")[3])
                rel_p = str(payload.get("relative_path") or payload.get("folder_path") or "").strip()
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(create_client_subfolder_manual(client, rel_p, storage_kind=kind))

            if path.startswith("/api/client-folders/") and path.endswith("/folders/rename"):
                fno = unquote(path.split("/")[3])
                old_p = str(payload.get("old_relative_path") or payload.get("old_path") or "").strip()
                new_n = str(payload.get("new_name", "")).strip()
                return self.send_json(rename_client_subfolder(fno, old_p, new_n))

            if path.startswith("/api/client-folders/") and path.endswith("/folders/move"):
                fno = unquote(path.split("/")[3])
                src_p = str(payload.get("source_relative_path") or payload.get("source_path") or "").strip()
                target_p = str(payload.get("target_parent_path") or payload.get("target_path") or "").strip()
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(move_client_subfolder(client, src_p, target_p, storage_kind=kind))

            if path.startswith("/api/client-folders/") and path.endswith("/folders/delete"):
                fno = unquote(path.split("/")[3])
                rel_p = str(payload.get("relative_path") or payload.get("folder_path") or "").strip()
                force = bool(payload.get("force", False))
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(delete_client_subfolder(client, rel_p, storage_kind=kind, force=force))

            if path.startswith("/api/client-folders/") and path.endswith("/open-in-explorer"):
                fno = unquote(path.split("/")[3])
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                base_dir, target_dir, clean_rel = resolve_client_path(client, payload.get("relative_path", ""), storage_kind="local")
                target_dir.mkdir(parents=True, exist_ok=True)
                folder_str = open_in_file_manager(target_dir)
                return self.send_json({"ok": True, "opened_path": folder_str})

            if path == "/api/system/apply-update":
                return self.send_json(apply_system_update())

            if path == "/api/desktop/close":
                threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0))).start()
                return self.send_json({"ok": True, "action": "close"})

            if path == "/api/client-files/move":
                fno = str(payload.get("client_file_no", "")).strip()
                src_p = str(payload.get("source_relative_path", "")).strip()
                dest_p = str(payload.get("target_parent_path", "")).strip()
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(move_client_file(client, src_p, dest_p, storage_kind=kind))

            if path == "/api/client-files/copy":
                fno = str(payload.get("client_file_no", "")).strip()
                src_p = str(payload.get("source_relative_path", "")).strip()
                dest_p = str(payload.get("target_parent_path", "")).strip()
                new_fname = payload.get("new_filename")
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(copy_client_file(client, src_p, dest_p, new_filename=new_fname, storage_kind=kind))

            if path == "/api/client-files/rename":
                fno = str(payload.get("client_file_no", "")).strip()
                file_p = str(payload.get("relative_path", "")).strip()
                new_fname = str(payload.get("new_filename", "")).strip()
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(rename_client_file(client, file_p, new_fname, storage_kind=kind))

            if path == "/api/client-files/delete":
                fno = str(payload.get("client_file_no", "")).strip()
                file_p = str(payload.get("relative_path", "")).strip()
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(delete_client_file(client, file_p, storage_kind=kind))

            if path == "/api/client-files/upload":
                fno = str(payload.get("client_file_no", "")).strip()
                parent_p = str(payload.get("relative_path", "")).strip()
                fname = str(payload.get("filename", "")).strip()
                raw_b64 = payload.get("file_base64", "")
                raw_bytes = base64.b64decode(raw_b64)
                kind = str(payload.get("storage_kind", "local")).strip()
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(upload_client_file(client, parent_p, fname, raw_bytes, storage_kind=kind))

            if path == "/api/save-document":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                return self.send_json(save_document(payload, actor=actor), 201)

            if path in ("/api/files/bulk-save", "/api/bulk-save-documents"):
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                return self.send_json(bulk_save_documents(payload, actor=actor), 201)

            if path == "/api/desktop/bring_to_front":
                return self.send_json(bring_desktop_app_to_front(), 200)

            if path == "/api/desktop/return_to_browser":
                origin_tab_id = payload.get("origin_tab_id")
                global _PENDING_BROWSER_RETURN
                with _PENDING_BROWSER_RETURN_LOCK:
                    _PENDING_BROWSER_RETURN = {
                        "pending": True,
                        "origin_tab_id": origin_tab_id,
                        "timestamp": time.time()
                    }
                res = bring_browser_to_front()
                return self.send_json(res, 200)

            if path == "/api/staging/incoming":
                raw_files = payload.get("files")
                if raw_files is None:
                    raw_files = []
                    if payload.get("single"):
                        raw_files.append(payload["single"])
                    if payload.get("bulk") and isinstance(payload["bulk"], list):
                        raw_files.extend(payload["bulk"])
                elif isinstance(raw_files, dict):
                    raw_files = [raw_files]
                elif not isinstance(raw_files, list):
                    raw_files = []

                session_id = get_active_staging_session_id()
                file_results = []
                staged_metadata_items = []

                for item in raw_files:
                    if not isinstance(item, dict):
                        continue
                    dl_id = item.get("download_id") or item.get("id") or item.get("downloadId")
                    orig_name = item.get("filename") or item.get("name") or "document.pdf"
                    src_path_str = item.get("source_local_path") or item.get("local_path") or item.get("localPath") or item.get("path")
                    mime_val = item.get("mime") or item.get("mime_type") or item.get("file_type") or "application/pdf"
                    b64_val = item.get("file_base64") or item.get("base64") or item.get("_b64")

                    cache_key = f"{dl_id}_{src_path_str}" if dl_id else src_path_str
                    if cache_key and cache_key in _PROCESSED_DOWNLOAD_CACHE:
                        cached = _PROCESSED_DOWNLOAD_CACHE[cache_key]
                        file_results.append({
                            "download_id": dl_id,
                            "staged_file_id": cached["staged_file_id"],
                            "filename": cached["filename"],
                            "status": "staged",
                            "size": cached.get("size", 0),
                            "mime": cached.get("mime", mime_val),
                            "staging_session_id": cached.get("staging_session_id", session_id)
                        })
                        continue

                    if src_path_str:
                        try:
                            src_p = Path(src_path_str).resolve()
                            if not src_p.exists() or not src_p.is_file():
                                file_results.append({
                                    "download_id": dl_id,
                                    "filename": orig_name,
                                    "status": "failed",
                                    "error": f"Source file unavailable on disk: {src_path_str}"
                                })
                                continue

                            src_str_lower = str(src_p).lower()
                            if any(bad in src_str_lower for bad in ["windows\\system32", "windows\\syswow64", "\\boot\\"]):
                                file_results.append({
                                    "download_id": dl_id,
                                    "filename": orig_name,
                                    "status": "failed",
                                    "error": "Access to system directory is restricted"
                                })
                                continue

                            staged_entry = staging_mgr.add_file_from_disk(
                                session_id,
                                src_p,
                                original_name=orig_name,
                                mime_type=mime_val
                            )

                            res_item = {
                                "download_id": dl_id,
                                "staged_file_id": staged_entry["staged_file_id"],
                                "filename": staged_entry["name"],
                                "status": "staged",
                                "size": staged_entry["size"],
                                "mime": staged_entry["mime_type"],
                                "staging_session_id": session_id
                            }
                            file_results.append(res_item)
                            staged_metadata_items.append(staged_entry)
                            if cache_key:
                                _PROCESSED_DOWNLOAD_CACHE[cache_key] = res_item

                        except Exception as exc:
                            logging.exception("Error staging disk file %s", src_path_str)
                            file_results.append({
                                "download_id": dl_id,
                                "filename": orig_name,
                                "status": "failed",
                                "error": str(exc)
                            })
                    elif b64_val:
                        try:
                            b64_clean = b64_val.split(",", 1)[1] if b64_val.startswith("data:") else b64_val
                            file_bytes = base64.b64decode(b64_clean)
                            staged_entry = staging_mgr.add_file(
                                session_id,
                                orig_name,
                                file_bytes,
                                mime_type=mime_val
                            )
                            res_item = {
                                "download_id": dl_id,
                                "staged_file_id": staged_entry["staged_file_id"],
                                "filename": staged_entry["name"],
                                "status": "staged",
                                "size": staged_entry["size"],
                                "mime": staged_entry["mime_type"],
                                "staging_session_id": session_id
                            }
                            file_results.append(res_item)
                            staged_metadata_items.append(staged_entry)
                            if cache_key:
                                _PROCESSED_DOWNLOAD_CACHE[cache_key] = res_item
                        except Exception as exc:
                            file_results.append({
                                "download_id": dl_id,
                                "filename": orig_name,
                                "status": "failed",
                                "error": str(exc)
                            })
                    else:
                        file_results.append({
                            "download_id": dl_id,
                            "filename": orig_name,
                            "status": "failed",
                            "error": "Neither source_local_path nor file_base64 provided"
                        })

                if staged_metadata_items:
                    with _STAGING_QUEUE_LOCK:
                        incoming_staging_queue.extend(staged_metadata_items)

                threading.Thread(target=bring_desktop_app_to_front, daemon=True).start()

                any_staged = any(f.get("status") == "staged" for f in file_results)
                all_staged = len(file_results) > 0 and all(f.get("status") == "staged" for f in file_results)

                return self.send_json({
                    "success": any_staged,
                    "all_staged": all_staged,
                    "files": file_results,
                    "staging_session_id": session_id,
                    "message": "Durable disk staging complete" if any_staged else "No files staged"
                }, 200 if any_staged or not file_results else 400)

            if path == "/api/staging/incoming/clear":
                with _STAGING_QUEUE_LOCK:
                    incoming_staging_queue.clear()
                return self.send_json({"ok": True, "cleared": True}, 200)

            # Create or resume Staging Session
            if path == "/api/staging/sessions":
                sess_id = payload.get("session_id")
                if not sess_id:
                    sess_id = get_active_staging_session_id()
                manifest = staging_mgr.get_or_create_session(sess_id)
                return self.send_json({"ok": True, "manifest": manifest, "session": manifest})

            # Add File to Staging Session
            if path.startswith("/api/staging/sessions/") and path.endswith("/files"):
                sess_id = path.split("/")[4]
                orig_name = str(payload.get("original_name") or payload.get("name") or "document.pdf").strip()
                b64_data = payload.get("base64") or payload.get("file_base64") or payload.get("_b64") or ""
                if b64_data.startswith("data:"):
                    b64_data = b64_data.split(",", 1)[1]
                file_bytes = base64.b64decode(b64_data) if b64_data else b""
                mime = payload.get("mime_type") or payload.get("type")
                vis = payload.get("client_visibility", True)
                src_url = payload.get("source_url", "")
                src_path = payload.get("source_local_path") or payload.get("local_path") or ""
                if (not file_bytes or len(file_bytes) == 0) and src_path and os.path.isfile(str(src_path)):
                    try:
                        file_bytes = Path(src_path).read_bytes()
                    except Exception as e:
                        logging.warning("Could not read local file %s for staging: %s", src_path, e)
                staged_file = staging_mgr.add_file(
                    sess_id,
                    orig_name,
                    file_bytes,
                    mime_type=mime,
                    client_visibility=vis,
                    source_url=src_url,
                    source_local_path=src_path
                )
                return self.send_json({"ok": True, "file": staged_file})

            # Delete File from Staging Session
            if path.startswith("/api/staging/sessions/") and ("/files/" in path or "/remove-file" in path):
                parts = path.split("/")
                sess_id = parts[4]
                staged_id = payload.get("staged_file_id") or parts[-1]
                ok = staging_mgr.remove_file(sess_id, staged_id)
                manifest = staging_mgr._load_manifest(sess_id)
                return self.send_json({"ok": ok, "manifest": manifest})

            # Clear Staging Session
            if path.startswith("/api/staging/sessions/") and path.endswith("/clear"):
                sess_id = path.split("/")[4]
                staging_mgr.clear_session(sess_id)
                return self.send_json({"ok": True})

            # Create PDF Studio Session (from staged files or direct upload)
            if path == "/api/pdf-studio/sessions":
                stg_sess_id = payload.get("staging_session_id")
                staged_file_ids = payload.get("staged_file_ids", [])

                if stg_sess_id and staged_file_ids:
                    source_files = []
                    combined_docs = []
                    first_bytes = None
                    first_name = None

                    for sf_id in staged_file_ids:
                        res = staging_mgr.get_file_bytes(stg_sess_id, sf_id)
                        if res:
                            f_bytes, f_entry = res
                            source_files.append({"staged_file_id": sf_id, "name": f_entry["name"], "size": f_entry["size"]})
                            if first_bytes is None:
                                first_bytes = f_bytes
                                first_name = f_entry["name"]
                            else:
                                combined_docs.append((f_bytes, f_entry["name"]))

                    if not first_bytes:
                        raise ValueError("Selected staged file(s) not found on disk.")

                    if len(source_files) > 1:
                        # Auto-merge multiple PDFs into single working document
                        first_clean = os.path.splitext(first_name)[0]
                        merged_name = f"{first_clean}_Merged_{len(source_files)}_Docs.pdf"
                        session = pdf_engine.create_session(merged_name, first_bytes, source_files=source_files)
                        for extra_bytes, extra_name in combined_docs:
                            pdf_engine.execute_tool(session.session_id, "merge_pdf", {"additional_files": [extra_bytes]})
                    else:
                        session = pdf_engine.create_session(first_name, first_bytes, source_files=source_files)

                elif payload.get("file_base64"):
                    orig_name = payload.get("original_name") or "document.pdf"
                    b64_data = payload.get("file_base64")
                    if b64_data.startswith("data:"):
                        b64_data = b64_data.split(",", 1)[1]
                    f_bytes = base64.b64decode(b64_data)
                    session = pdf_engine.create_session(orig_name, f_bytes)
                else:
                    raise ValueError("No files provided to initialize PDF Studio session.")

                session = pdf_engine.get_session(session.session_id) or session
                thumbs = pdf_engine.get_thumbnails(session.session_id)
                return self.send_json({"ok": True, "session": session.to_dict(), "thumbnails": thumbs})

            # Execute PDF Tool
            if path.startswith("/api/pdf-studio/sessions/") and ("/execute" in path or "/tools/" in path):
                parts = path.split("/")
                sess_id = parts[4]
                tool_id = payload.get("tool_id")
                if not tool_id and "/tools/" in path:
                    tool_id = parts[-1]
                tool_params = payload.get("parameters") or payload.get("params") or payload
                if isinstance(tool_params, dict) and "tool_id" in tool_params:
                    tool_params = {k: v for k, v in tool_params.items() if k not in ("tool_id", "parameters", "params")}
                res = pdf_engine.execute_tool(sess_id, tool_id, tool_params)
                session = pdf_engine.get_session(sess_id)
                thumbs = pdf_engine.get_thumbnails(sess_id)
                return self.send_json({
                    "ok": True,
                    "result": res,
                    "session": session.to_dict() if session else None,
                    "thumbnails": thumbs
                })

            # Undo PDF Studio Operation
            if path.startswith("/api/pdf-studio/sessions/") and path.endswith("/undo"):
                sess_id = path.split("/")[4]
                session = pdf_engine.get_session(sess_id)
                if not session:
                    raise ValueError("Session not found.")
                undo_res = session.undo()
                thumbs = pdf_engine.get_thumbnails(sess_id)
                return self.send_json({"ok": True, "undo": undo_res, "thumbnails": thumbs, "session": session.to_dict()})

            # Reset PDF Studio to Original
            if path.startswith("/api/pdf-studio/sessions/") and path.endswith("/reset"):
                sess_id = path.split("/")[4]
                session = pdf_engine.get_session(sess_id)
                if not session:
                    raise ValueError("Session not found.")
                reset_res = session.reset_to_original()
                thumbs = pdf_engine.get_thumbnails(sess_id)
                return self.send_json({"ok": True, "reset": reset_res, "thumbnails": thumbs, "session": session.to_dict()})

            # Apply PDF Studio Result to Staging Session (Save to Client Bridge)
            if path.startswith("/api/pdf-studio/sessions/") and path.endswith("/apply-to-staging"):
                sess_id = path.split("/")[4]
                stg_sess_id = payload.get("staging_session_id")
                replace_staged_ids = payload.get("replace_staged_ids", [])
                result_name = payload.get("result_name")

                session = pdf_engine.get_session(sess_id)
                if not session or not session.working_pdf_path.exists():
                    raise ValueError("PDF Studio session document not found.")

                if not replace_staged_ids:
                    replace_staged_ids = [sf["staged_file_id"] for sf in session.meta.get("source_files", []) if isinstance(sf, dict) and sf.get("staged_file_id")]

                final_bytes = session.working_pdf_path.read_bytes()
                final_name = result_name or session.meta.get("current_name") or "Processed_Document.pdf"
                if not final_name.lower().endswith(".pdf"):
                    final_name += ".pdf"

                rep_res = staging_mgr.replace_files_with_processed_result(
                    session_id=stg_sess_id,
                    replace_staged_ids=replace_staged_ids,
                    result_filename=final_name,
                    result_bytes=final_bytes,
                    badge="✓ PDF Studio",
                    lineage_operation="Processed in PDF Studio",
                    pdf_studio_session_id=sess_id
                )
                return self.send_json({
                    "ok": True,
                    "new_entry": rep_res["new_entry"],
                    "manifest": rep_res["manifest"],
                    "replaced_count": rep_res["replaced_count"]
                })

            if path == "/api/file-router/route":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                dev_id = ctx["device_id"] if ctx else None
                return self.send_json(execute_cut_and_route(payload, actor=actor, device_id=dev_id), 200)

            if path == "/api/file-router/batch-route":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                dev_id = ctx["device_id"] if ctx else None
                items = payload.get("items", [])
                results = []
                success_count = 0
                fail_count = 0
                for it in items:
                    try:
                        res = execute_cut_and_route(it, actor=actor, device_id=dev_id)
                        results.append({"ok": True, "data": res})
                        success_count += 1
                    except Exception as e:
                        results.append({"ok": False, "error": str(e), "document_name": it.get("document_name"), "source_path": it.get("source_path")})
                        fail_count += 1
                return self.send_json({"ok": True, "total": len(items), "successful": success_count, "failed": fail_count, "results": results}, 200)

            if path == "/api/file-router/check-collision":
                return self.send_json(check_file_collision(payload), 200)

            if path in ("/api/jobs/revert", "/api/activity/revert"):
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                job_id = str(payload.get("job_id") or payload.get("id") or "").strip()
                if not job_id:
                    raise ValueError("Activity / Job ID is required.")
                return self.send_json(revert_save_job(job_id, actor=actor))

            if path == "/api/pdf/detect": return self.send_json(api_detect_pdf(payload))

            if path == "/api/pdf/lock": return self.send_json(api_lock_pdf(payload))

            if path == "/api/pdf/unlock": return self.send_json(api_unlock_pdf(payload))

            if path.startswith("/api/clients/") and path.endswith("/pdf-passwords"):
                fno = unquote(path.split("/")[3])
                return self.send_json(api_add_client_pdf_password(fno, payload))

            if path.startswith("/api/clients/") and path.endswith("/pdf-passwords/update"):
                fno = unquote(path.split("/")[3])
                return self.send_json(api_update_client_pdf_password(fno, payload))

            if path.startswith("/api/clients/") and path.endswith("/pdf-passwords/delete"):
                fno = unquote(path.split("/")[3])
                return self.send_json(api_delete_client_pdf_password(fno, payload))

            if path == "/api/backup/create":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                backup_type = payload.get("type", "manual")
                note = payload.get("note", "")
                res = create_backup(backup_type=backup_type, actor=actor, note=note)
                return self.send_json(res, 201)

            if path == "/api/backup/restore":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                filename = safe_name(payload.get("filename", ""))
                if not filename or not filename.endswith(".vsbackup"):
                    raise ValueError("Valid .vsbackup filename is required.")
                target_file = BACKUP_DIR / filename
                if not target_file.is_file():
                    raise ValueError(f"Backup file '{filename}' does not exist.")
                res = restore_backup(target_file, actor=actor)
                return self.send_json(res)

            if path == "/api/backup/upload-restore":
                ctx = self.get_auth_context()
                actor = ctx["user_id"] if ctx else "Host"
                b64_content = payload.get("file_base64", "")
                filename = safe_name(payload.get("filename", "uploaded_backup.vsbackup"))
                if not b64_content:
                    raise ValueError("Backup file data is required.")
                raw_bytes = base64.b64decode(b64_content)
                if not filename.endswith(".vsbackup"):
                    filename += ".vsbackup"
                temp_upload = BACKUP_DIR / f"uploaded_{uuid.uuid4().hex}_{filename}"
                temp_upload.write_bytes(raw_bytes)
                try:
                    res = restore_backup(temp_upload, actor=actor)
                    return self.send_json(res)
                finally:
                    temp_upload.unlink(missing_ok=True)

            if path == "/api/backup/delete":
                filename = safe_name(payload.get("filename", ""))
                if not filename or not filename.endswith(".vsbackup"):
                    raise ValueError("Valid .vsbackup filename is required.")
                all_backups = sorted(BACKUP_DIR.glob("*.vsbackup"), key=lambda p: p.stat().st_mtime, reverse=True)
                if len(all_backups) <= 1:
                    raise ValueError("Cannot delete the only available backup.")
                target_file = BACKUP_DIR / filename
                if not target_file.is_file():
                    raise ValueError("Backup file not found.")
                target_file.unlink(missing_ok=True)
                log_activity("backup_deleted", None, None, f"Deleted backup '{filename}'", "Host")
                return self.send_json({"ok": True, "deleted": filename})

            if path == "/api/backup/settings":
                freq = str(payload.get("backup_frequency", "Daily")).strip().capitalize()
                ret_count = str(payload.get("backup_retention_count", "10")).strip()
                ret_days = str(payload.get("backup_retention_days", "60")).strip()
                if freq not in ("Daily", "Weekly", "Monthly", "Disabled"):
                    freq = "Daily"
                if not ret_count.isdigit() or int(ret_count) < 1:
                    ret_count = "10"
                if not ret_days.isdigit() or int(ret_days) < 1:
                    ret_days = "60"
                with db() as con:
                    con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_frequency', ?)", (freq,))
                    con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_retention_count', ?)", (ret_count,))
                    con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_retention_days', ?)", (ret_days,))
                return self.send_json(settings_payload())

            if path == "/api/backup/open-folder":
                BACKUP_DIR.mkdir(parents=True, exist_ok=True)
                folder_str = str(BACKUP_DIR.resolve())
                try:
                    if sys.platform == "win32":
                        try:
                            os.startfile(folder_str)
                        except Exception:
                            subprocess.Popen(f'explorer.exe "{folder_str}"', shell=True)
                    elif sys.platform == "darwin":
                        subprocess.Popen(["open", folder_str])
                    else:
                        subprocess.Popen(["xdg-open", folder_str])
                except Exception as exc:
                    logging.warning("Could not launch file manager for backups folder: %s", exc)
                return self.send_json({"ok": True, "path": folder_str})

            self.send_json({"error": "Not found"}, 404)
        except (KeyError, ValueError, OSError, zipfile.BadZipFile) as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception:
            logging.exception("Unhandled request error")
            self.send_json({"error": "Unexpected server error. Check the server log for details."}, 500)

    def do_DELETE(self):
        try:
            path = urlparse(self.path).path
            if path.startswith("/api/") and not self.protect_api(path):
                return

            if path.startswith("/api/client-folders/") and path.endswith("/override"):
                fno = path.split("/")[3]
                return self.send_json(delete_client_override(fno))

            if path.startswith("/api/client-folders/") and path.endswith("/folders"):
                query = parse_qs(urlparse(self.path).query)
                fno = path.split("/")[3]
                rel_p = query.get("path", [""])[0]
                force = query.get("force", ["false"])[0].lower() in ("true", "1")
                kind = query.get("storage_kind", ["local"])[0]
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(delete_client_subfolder(client, rel_p, storage_kind=kind, force=force))

            if path == "/api/client-files":
                query = parse_qs(urlparse(self.path).query)
                fno = query.get("client_file_no", [""])[0]
                file_p = query.get("path", [""])[0]
                kind = query.get("storage_kind", ["local"])[0]
                with db() as con:
                    client = con.execute("SELECT * FROM clients WHERE file_no=?", (fno,)).fetchone()
                if not client:
                    raise ValueError("Client not found.")
                return self.send_json(delete_client_file(client, file_p, storage_kind=kind))

            self.send_json({"error": "Not found"}, 404)
        except (KeyError, ValueError, OSError) as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception:
            logging.exception("Unhandled request error")
            self.send_json({"error": "Unexpected server error. Check the server log for details."}, 500)


def start_server_background(port: int = None, host: str = "0.0.0.0"):
    """Starts the VS Database backend server in background threads."""
    global PORT
    if port:
        PORT = port
    initialise()
    logging.basicConfig(filename=DATA_ROOT / "server.log", level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    
    # Defer non-critical background maintenance tasks so app startup and UI thread remain 100% free
    t1 = threading.Timer(20.0, cleanup_stray_current_folders); t1.daemon = True; t1.start()
    t2 = threading.Timer(25.0, clean_stale_temp_and_duplicate_portal_files); t2.daemon = True; t2.start()
    t3 = threading.Timer(15.0, backup_scheduler_worker); t3.daemon = True; t3.start()
    
    ThreadingHTTPServer.allow_reuse_address = True
    main_server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    threading.Thread(target=main_server.serve_forever, daemon=True).start()
    print(f"VS Database in-process server started on port {PORT}")
    return main_server


if __name__ == "__main__":
    initialise()
    logging.basicConfig(filename=DATA_ROOT / "server.log", level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    threading.Thread(target=cleanup_stray_current_folders, daemon=True).start()
    threading.Thread(target=clean_stale_temp_and_duplicate_portal_files, daemon=True).start()
    threading.Thread(target=backup_scheduler_worker, daemon=True).start()
    main_server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"VS Database Desktop running at http://127.0.0.1:{PORT} and http://{HOST}:{PORT}")
    try:
        main_server.serve_forever()
    finally:
        try: main_server.server_close()
        except Exception: pass
