import hashlib
import sqlite3

for path in [
    "D:/AntiGravity Automation/VS Desktop App/data/vs_database_desktop.db",
    "data/vs_database_desktop.db",
    "data/vs_database_desktop_forensic_28rows.db"
]:
    with open(path, "rb") as f:
        h = hashlib.sha256(f.read()).hexdigest()
    conn = sqlite3.connect(path)
    tables = [r[0] for r in conn.execute('SELECT name FROM sqlite_master WHERE type="table" AND name NOT LIKE "sqlite_%"').fetchall()]
    total_rows = sum(conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables)
    print(f"Path: {path}")
    print(f"  SHA-256: {h}")
    print(f"  Tables: {len(tables)}, Total rows: {total_rows}\n")
