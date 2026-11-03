import os
import sys
import sqlite3
import json
import hashlib
import time
from pathlib import Path
from datetime import datetime, timezone

legacy_db_path = Path(r"D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db")
v2_db_path = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db")

def get_hash(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(65536):
            h.update(c)
    return h.hexdigest().upper()

print("=== 1. DATABASE COMPARISON ===")
print("Legacy DB size:", legacy_db_path.stat().st_size, "SHA:", get_hash(legacy_db_path))
print("V2 DB size:    ", v2_db_path.stat().st_size, "SHA:", get_hash(v2_db_path))

with sqlite3.connect(legacy_db_path) as l_con, sqlite3.connect(v2_db_path) as v_con:
    l_tables = set(r[0] for r in l_con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall())
    v_tables = set(r[0] for r in v_con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall())
    
    print("\nLegacy Table Count:", len(l_tables))
    print("V2 Table Count:    ", len(v_tables))
    print("Tables in V2 but not in Legacy:", v_tables - l_tables)
    print("Tables in Legacy but not in V2:", l_tables - v_tables)
    
    all_tables = sorted(list(l_tables | v_tables))
    l_total_rows = 0
    v_total_rows = 0
    diffs = []
    for t in all_tables:
        l_cnt = l_con.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0] if t in l_tables else -1
        v_cnt = v_con.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0] if t in v_tables else -1
        if l_cnt != -1: l_total_rows += l_cnt
        if v_cnt != -1: v_total_rows += v_cnt
        if l_cnt != v_cnt:
            diffs.append((t, l_cnt, v_cnt))
            
    print(f"\nTotal Rows: Legacy = {l_total_rows}, V2 = {v_total_rows} (Diff: {v_total_rows - l_total_rows})")
    print(f"Number of tables with row count differences: {len(diffs)}")
    print("\nTables with row count differences:")
    for t, lc, vc in diffs:
        print(f"  - {t}: Legacy={lc}, V2={vc} (Diff: {vc - lc})")
