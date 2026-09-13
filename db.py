"""
ZDownloader PRO — Persistent SQLite Storage
Stores download history, queue status, and metadata safely across restarts.
"""

import sqlite3
import time
from pathlib import Path

DB_FILE = None


def get_db_path(data_dir: Path) -> Path:
    global DB_FILE
    if DB_FILE is None:
        DB_FILE = data_dir / "zdownloader.db"
    return DB_FILE


def get_connection(data_dir: Path = None):
    if data_dir is not None:
        db_path = get_db_path(data_dir)
    elif DB_FILE is not None:
        db_path = DB_FILE
    else:
        db_path = Path(__file__).resolve().parent / "zdownloader.db"

    conn = sqlite3.connect(str(db_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(data_dir: Path):
    """Initializes SQLite database and tables."""
    get_db_path(data_dir)
    with get_connection(data_dir) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT DEFAULT '',
                status TEXT DEFAULT 'starting',
                progress REAL DEFAULT 0,
                speed TEXT DEFAULT '',
                eta TEXT DEFAULT '',
                filename TEXT DEFAULT '',
                file_path TEXT DEFAULT '',
                file_size TEXT DEFAULT '',
                raw_size INTEGER DEFAULT 0,
                quality TEXT DEFAULT 'best',
                is_audio INTEGER DEFAULT 0,
                thumbnail TEXT DEFAULT '',
                error TEXT DEFAULT '',
                created_at REAL,
                completed_at REAL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)")
        conn.commit()


def db_insert_job(job_id: str, url: str, quality: str = "best", is_audio: bool = False, title: str = "", thumbnail: str = ""):
    """Inserts a new job record."""
    try:
        with get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO downloads (
                    id, url, quality, is_audio, title, thumbnail, status, progress, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'starting', 0, ?)
            """, (job_id, url, quality, 1 if is_audio else 0, title, thumbnail, time.time()))
            conn.commit()
    except Exception as e:
        print(f"[DB Error] insert_job: {e}")


def db_update_job(job_id: str, **kwargs):
    """Updates job fields dynamically."""
    if not kwargs:
        return
    try:
        fields = []
        values = []
        for k, v in kwargs.items():
            fields.append(f"{k} = ?")
            values.append(v)
        values.append(job_id)

        sql = f"UPDATE downloads SET {', '.join(fields)} WHERE id = ?"
        with get_connection() as conn:
            conn.execute(sql, values)
            conn.commit()
    except Exception as e:
        print(f"[DB Error] update_job: {e}")


def db_get_job(job_id: str):
    """Fetches single job by ID."""
    try:
        with get_connection() as conn:
            cursor = conn.execute("SELECT * FROM downloads WHERE id = ?", (job_id,))
            row = cursor.fetchone()
            if row:
                d = dict(row)
                d["file"] = d.get("file_path", "")
                return d
    except Exception as e:
        print(f"[DB Error] get_job: {e}")
    return None


def db_get_history(limit: int = 100):
    """Retrieves download history sorted by newest first."""
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?",
                (limit,)
            )
            return [dict(r) for r in cursor.fetchall()]
    except Exception as e:
        print(f"[DB Error] get_history: {e}")
        return []


def db_delete_record(job_id: str):
    """Deletes record by ID."""
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM downloads WHERE id = ?", (job_id,))
            conn.commit()
    except Exception as e:
        print(f"[DB Error] delete_record: {e}")


def db_delete_by_filename(filename: str):
    """Deletes record by filename."""
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM downloads WHERE filename = ?", (filename,))
            conn.commit()
    except Exception as e:
        print(f"[DB Error] delete_by_filename: {e}")
