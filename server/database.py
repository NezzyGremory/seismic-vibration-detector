"""Akses SQLite memakai modul sqlite3 standar (tanpa ORM)."""

import logging
import sqlite3
from contextlib import closing

from . import config

logger = logging.getLogger("seismic")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    acceleration_magnitude REAL NOT NULL,
    rms REAL NOT NULL,
    peak REAL NOT NULL,
    status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts
    ON sensor_readings (device_id, timestamp);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL NOT NULL,
    source_device TEXT NOT NULL,
    status TEXT NOT NULL,
    rms REAL NOT NULL,
    peak REAL NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts
    ON alerts (timestamp);

CREATE TABLE IF NOT EXISTS flood_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    water_level REAL NOT NULL,
    rate_of_rise REAL NOT NULL,
    rainfall REAL NOT NULL,
    status TEXT NOT NULL,
    risk_level INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flood_readings_ts
    ON flood_readings (timestamp);
"""


def _connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Buat file database dan tabel jika belum ada."""
    with closing(_connect()) as conn:
        with conn:
            conn.executescript(_SCHEMA)
    logger.info("DATABASE READY: %s", config.DB_PATH)


def insert_reading(
    device_id: str,
    timestamp: float,
    x: float,
    y: float,
    z: float,
    acceleration_magnitude: float,
    rms: float,
    peak: float,
    status: str,
) -> int:
    """Simpan satu baris. Melempar sqlite3.Error jika gagal."""
    with closing(_connect()) as conn:
        with conn:  # commit otomatis, rollback jika error
            cur = conn.execute(
                """
                INSERT INTO sensor_readings
                (device_id, timestamp, x, y, z,
                 acceleration_magnitude, rms, peak, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (device_id, timestamp, x, y, z,
                 acceleration_magnitude, rms, peak, status),
            )
            return int(cur.lastrowid)


def count_readings() -> int:
    with closing(_connect()) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM sensor_readings").fetchone()[0])


def fetch_latest(limit: int = 10) -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM sensor_readings ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def insert_alert(
    timestamp: float,
    source_device: str,
    status: str,
    rms: float,
    peak: float,
    message: str,
) -> int:
    """Simpan riwayat alert ke tabel alerts. Melempar sqlite3.Error jika gagal."""
    with closing(_connect()) as conn:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO alerts
                (timestamp, source_device, status, rms, peak, message)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (timestamp, source_device, status, rms, peak, message),
            )
            return int(cur.lastrowid)


def count_alerts() -> int:
    with closing(_connect()) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0])


def fetch_latest_alerts(limit: int = 50) -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def save_flood_reading(
    device_id: str,
    timestamp: float,
    water_level: float,
    rate_of_rise: float,
    rainfall: float,
    status: str,
    risk_level: int,
) -> int:
    """Simpan satu baris data sensor banjir. Melempar sqlite3.Error jika gagal."""
    with closing(_connect()) as conn:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO flood_readings
                (device_id, timestamp, water_level, rate_of_rise,
                 rainfall, status, risk_level)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (device_id, timestamp, water_level, rate_of_rise,
                 rainfall, status, risk_level),
            )
            return int(cur.lastrowid)


def get_recent_flood_readings(limit: int = 50) -> list[dict]:
    """Ambil data flood terbaru dari tabel flood_readings."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM flood_readings ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
