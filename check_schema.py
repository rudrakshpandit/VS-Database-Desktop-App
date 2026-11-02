"""
Inspect database schema and tables
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def check_db(rel_path):
    p = ROOT / rel_path
    if not p.exists():
        print(f"File not found: {p}")
        return
    try:
        conn = sqlite3.connect(p)
        cur = conn.cursor()
        cur.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name;")
        tables = cur.fetchall()
        print(f"\n=== {rel_path} ({len(tables)} tables/views) ===")
        for t in tables:
            cur.execute(f"PRAGMA table_info('{t[0]}')")
            cols = [c[1] for c in cur.fetchall()]
            print(f"  [{t[1]}] {t[0]} ({len(cols)} columns: {', '.join(cols[:6])}{'...' if len(cols) > 6 else ''})")
    except Exception as e:
        print(f"=== {rel_path} (Error: {e}) ===")

check_db("data/vs_database_desktop.db")
check_db("data/office_automation.db")
check_db("data/office_database.db")
