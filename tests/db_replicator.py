"""
Database Replication & Isolation Harness for VS Database 2.0 Tauri Migration.

Ensures strict zero-mutation isolation of the primary database during automated test
runs, integration QA, and benchmarks by leveraging SQLite's Online Backup API.
"""

from __future__ import annotations
import sqlite3
import hashlib
import os
import gc
import tempfile
import logging
from pathlib import Path
from contextlib import contextmanager
from typing import Generator

logger = logging.getLogger("vs_database.replicator")

DEFAULT_PRIMARY_DB = Path(__file__).resolve().parent / "data" / "vs_database_desktop.db"


def calculate_sha256(path: Path) -> str:
    """Calculates SHA-256 hash of a file for integrity verification."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_test_replica(
    source_db: Path | str | None = None,
    target_db: Path | str | None = None
) -> Path:
    """
    Creates an isolated replica of the primary SQLite database using SQLite's native
    Online Backup API.
    
    Guarantees:
    1. Source database is opened exclusively with '?mode=ro' (strict read-only).
    2. Works seamlessly in WAL mode without tearing or incomplete WAL state.
    3. Guarantees 0 byte mutations to the source database.
    """
    src_path = Path(source_db) if source_db else DEFAULT_PRIMARY_DB
    if not src_path.exists():
        raise FileNotFoundError(f"Primary database not found at {src_path}")

    if target_db is None:
        temp_dir = tempfile.mkdtemp(prefix="vs_db_test_")
        dst_path = Path(temp_dir) / "test_vs_database.db"
    else:
        dst_path = Path(target_db)
        if dst_path.exists():
            try:
                dst_path.unlink()
            except OSError:
                pass
        dst_path.parent.mkdir(parents=True, exist_ok=True)

    # Open source in strict read-only mode via URI
    src_uri = f"file:{src_path.resolve().as_posix()}?mode=ro"
    src_conn = sqlite3.connect(src_uri, uri=True)
    dst_conn = sqlite3.connect(dst_path)

    try:
        # SQLite Online Backup API copies pages consistently
        src_conn.backup(dst_conn, pages=100)
    finally:
        dst_conn.close()
        src_conn.close()

    logger.info(f"Created isolated test replica at: {dst_path}")
    return dst_path


@contextmanager
def isolated_test_db(
    source_db: Path | str | None = None
) -> Generator[Path, None, None]:
    """
    Context manager yielding an isolated test database clone that is
    automatically cleaned up upon exit.
    """
    src_path = Path(source_db) if source_db else DEFAULT_PRIMARY_DB
    initial_hash = calculate_sha256(src_path)

    tmpdir_obj = tempfile.TemporaryDirectory(prefix="vs_qa_env_", ignore_cleanup_errors=True)
    tmpdir = Path(tmpdir_obj.name)
    test_db = tmpdir / "test_replica.db"
    create_test_replica(src_path, test_db)
    
    # Set environment variable for test processes
    old_env = os.environ.get("VS_DATABASE_PATH")
    os.environ["VS_DATABASE_PATH"] = str(test_db)
    
    try:
        yield test_db
    finally:
        if old_env is not None:
            os.environ["VS_DATABASE_PATH"] = old_env
        else:
            os.environ.pop("VS_DATABASE_PATH", None)

        # Force garbage collection to release open handles on Windows
        gc.collect()

        # Clean up temporary directory
        try:
            tmpdir_obj.cleanup()
        except Exception:
            pass

        # Assert that source database was never touched
        final_hash = calculate_sha256(src_path)
        if initial_hash != final_hash:
            raise RuntimeError(
                f"CRITICAL: Primary database {src_path} was mutated during test execution! "
                f"Initial: {initial_hash}, Final: {final_hash}"
            )


if __name__ == "__main__":
    print(f"Testing replication harness against: {DEFAULT_PRIMARY_DB}")
    with isolated_test_db() as isolated_path:
        print(f"Isolated replica created at: {isolated_path}")
        print(f"Replica file size: {isolated_path.stat().st_size:,} bytes")
        
        # Test destructive write in replica
        con = sqlite3.connect(isolated_path)
        try:
            con.execute("DELETE FROM activity_log;")
            con.execute("INSERT INTO settings (key, value) VALUES ('qa_run_test', '1');")
            con.commit()
            print("Successfully performed destructive writes on isolated replica.")
        finally:
            con.close()
            
    print("Verification complete. Primary database integrity confirmed intact.")
