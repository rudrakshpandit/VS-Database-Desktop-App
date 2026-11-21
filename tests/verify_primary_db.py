import hashlib
import sqlite3

db_path = "data/vs_database_desktop.db"
with open(db_path, "rb") as f:
    h = hashlib.sha256(f.read()).hexdigest()

print("SHA-256:", h)

conn = sqlite3.connect(db_path)
tables = [r[0] for r in conn.execute('SELECT name FROM sqlite_master WHERE type="table" AND name NOT LIKE "sqlite_%"').fetchall()]
total_rows = sum(conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables)
print("Tables count:", len(tables))
print("Total rows:", total_rows)
