import os
import sqlite3
from pathlib import Path

def inspect_table_payloads():
    db_path = Path("data/vs_database_desktop.db")
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    
    table_sizes = []
    for t in tables:
        if t.startswith("sqlite_"):
            continue
        cols = [r["name"] for r in cur.execute(f"PRAGMA table_info([{t}])").fetchall()]
        if not cols:
            continue
        length_expr = " + ".join([f"COALESCE(length([{c}]), 0)" for c in cols])
        try:
            total_bytes = cur.execute(f"SELECT SUM({length_expr}) FROM [{t}]").fetchone()[0] or 0
            table_sizes.append((t, total_bytes))
        except Exception as e:
            table_sizes.append((t, 0))
    
    table_sizes.sort(key=lambda x: x[1], reverse=True)
    print("--- Table Data Payload Sizes in vs_database_desktop.db ---")
    for t, sz in table_sizes[:15]:
        print(f"  {t}: {sz / (1024*1024):.2f} MB ({sz} bytes)")
    con.close()

if __name__ == "__main__":
    inspect_table_payloads()
