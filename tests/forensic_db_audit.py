import sqlite3
import hashlib
from pathlib import Path

def audit_db(path_str):
    p = Path(path_str)
    if not p.exists():
        print(f"Path does not exist: {p}")
        return
    data = p.read_bytes()
    sha256 = hashlib.sha256(data).hexdigest()
    print(f"Database: {path_str}")
    print(f"File Size: {len(data):,} bytes")
    print(f"SHA-256: {sha256}")
    
    con = sqlite3.connect(p)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]
    print(f"Total Tables: {len(tables)}")
    
    total_rows = 0
    table_counts = {}
    for t in tables:
        cur.execute(f'SELECT count(1) FROM "{t}"')
        cnt = cur.fetchone()[0]
        table_counts[t] = cnt
        total_rows += cnt
    
    for t, cnt in table_counts.items():
        if cnt > 0:
            print(f"  - {t}: {cnt:,}")
    print(f"TOTAL ROWS: {total_rows:,}")
    return table_counts, total_rows, sha256

if __name__ == '__main__':
    print("=== MIGRATION DATABASE ===")
    mig_counts, mig_total, mig_hash = audit_db("data/vs_database_desktop.db")
    
    print("\n=== ORIGINAL READ-ONLY DATABASE ===")
    orig_counts, orig_total, orig_hash = audit_db("../VS Desktop App/data/vs_database_desktop.db")
    
    print("\n=== DIFFERENCE ANALYSIS ===")
    print(f"SHA-256 Match: {mig_hash == orig_hash}")
    print(f"Row Count Match: {mig_total == orig_total}")
    for t in sorted(set(mig_counts.keys()).union(orig_counts.keys())):
        c1 = mig_counts.get(t, 0)
        c2 = orig_counts.get(t, 0)
        if c1 != c2:
            print(f"  Mismatch in table '{t}': Migration={c1}, Original={c2} (diff={c1-c2})")
