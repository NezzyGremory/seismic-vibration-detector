"""FastAPI server untuk prototype deteksi getaran (V1).

Jalankan dari folder root project:
    uvicorn server.main:app --host 0.0.0.0 --port 8000
"""

import json
import logging
import sqlite3
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import config, database
from .detection.detector import VibrationDetector
from .detection.features import acceleration_magnitude
from .schemas import SensorReading, SensorResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("seismic")

detector = VibrationDetector()
_last_status: dict[str, str] = {}

# Daftar WebSocket user yang sedang terhubung untuk menerima broadcast alert
connected_users: set[WebSocket] = set()
_last_alert_time: float = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    logger.info("SERVER STARTED")
    yield
    logger.info("SERVER STOPPED")


app = FastAPI(title="Earthquake Detection Server", lifespan=lifespan)

# CORS middleware untuk akses prototype dari browser HP via LAN
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount direktori web untuk static files (sensor.css, sensor.js)
WEB_DIR = config.BASE_DIR / "web"
if WEB_DIR.exists():
    app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")


def process_reading(reading: SensorReading) -> dict:
    """Alur: magnitude -> window -> fitur -> deteksi -> simpan ke SQLite.

    Melempar sqlite3.Error jika penyimpanan gagal (ditangani pemanggil).
    """
    if detector.is_new_device(reading.device_id):
        logger.info("DEVICE CONNECTED: %s", reading.device_id)

    magnitude = acceleration_magnitude(reading.x, reading.y, reading.z)
    if config.LOG_EVERY_SAMPLE:
        logger.info("DATA RECEIVED: %s", reading.device_id)

    result = detector.update(reading.device_id, magnitude)

    changed = _last_status.get(reading.device_id) != result["status"]
    _last_status[reading.device_id] = result["status"]
    if config.LOG_EVERY_SAMPLE or changed:
        logger.info("ANALYSIS COMPLETED")
        logger.info("STATUS: %s", result["status"])

    database.insert_reading(
        device_id=reading.device_id,
        timestamp=reading.timestamp,
        x=reading.x,
        y=reading.y,
        z=reading.z,
        acceleration_magnitude=magnitude,
        rms=result["rms"],
        peak=result["peak"],
        status=result["status"],
    )

    return {
        "success": True,
        "device_id": reading.device_id,
        "magnitude": round(magnitude, 4),
        "rms": round(result["rms"], 4),
        "peak": round(result["peak"], 4),
        "status": result["status"],
        "window_samples": result["window_samples"],
        "window_ready": result["window_ready"],
    }


async def broadcast_alert(alert_data: dict) -> None:
    """Broadcast payload alert ke seluruh client user yang terhubung."""
    if not connected_users:
        return

    dead_connections = set()
    for ws in list(connected_users):
        try:
            await ws.send_json(alert_data)
        except Exception as exc:
            logger.warning("Gagal mengirim alert ke user websocket: %s", exc)
            dead_connections.add(ws)

    for ws in dead_connections:
        connected_users.discard(ws)


async def check_and_trigger_alert(reading: SensorReading, result: dict) -> None:
    """Evaluasi status deteksi getaran dan cooldown untuk mengirimkan broadcast alert."""
    global _last_alert_time

    # PENTING: Alert HANYA dipicu jika deteksi menghasilkan ANOMALY_VIBRATION
    if result.get("status") != "ANOMALY_VIBRATION":
        return

    now = time.time()
    elapsed = now - _last_alert_time
    if elapsed < config.ALERT_COOLDOWN:
        logger.info(
            "ALERT COOLDOWN AKTIF (%.1fs tersisa). Alert tidak dikirim ulang.",
            config.ALERT_COOLDOWN - elapsed,
        )
        return

    _last_alert_time = now
    message = "Anomali getaran terdeteksi"

    try:
        database.insert_alert(
            timestamp=reading.timestamp,
            source_device=reading.device_id,
            status=result["status"],
            rms=result["rms"],
            peak=result["peak"],
            message=message,
        )
    except sqlite3.Error as exc:
        logger.error("DATABASE INSERT ALERT ERROR: %s", exc)

    alert_payload = {
        "type": "EARTHQUAKE_ALERT",
        "status": "ANOMALY_VIBRATION",
        "message": message,
        "timestamp": reading.timestamp,
        "source_device": reading.device_id,
        "rms": round(result["rms"], 4),
        "peak": round(result["peak"], 4),
    }

    logger.info(
        "BROADCAST ALERT to %d users (Device: %s, RMS: %.4f, Peak: %.4f)",
        len(connected_users),
        reading.device_id,
        result["rms"],
        result["peak"],
    )
    await broadcast_alert(alert_payload)


@app.get("/")
def root():
    return {"status": "online", "service": "Earthquake Detection Server"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/sensor", include_in_schema=False)
def sensor_page():
    """Menyajikan halaman web sensor accelerometer untuk browser HP Android."""
    html_path = config.BASE_DIR / "web" / "sensor.html"
    return FileResponse(html_path)


@app.get("/user", include_in_schema=False)
def user_page():
    """Menyajikan halaman web penerima peringatan gempa/getaran untuk HP User."""
    html_path = config.BASE_DIR / "web" / "user.html"
    return FileResponse(html_path)


@app.get("/api/alerts")
def get_alerts():
    """Mengambil riwayat alert getaran terbaru dari database SQLite."""
    try:
        alerts = database.fetch_latest_alerts(limit=50)
        return {"alerts": alerts}
    except sqlite3.Error as exc:
        logger.error("DATABASE FETCH ALERTS ERROR: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"alerts": [], "error": f"Database error: {exc}"},
        )


@app.post("/api/sensor", response_model=SensorResponse)
async def post_sensor(reading: SensorReading):
    # Validasi gagal / JSON rusak -> FastAPI otomatis membalas HTTP 422.
    try:
        result = process_reading(reading)
        await check_and_trigger_alert(reading, result)
        return result
    except sqlite3.Error as exc:
        logger.error("DATABASE ERROR: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": f"Database error: {exc}"},
        )


@app.websocket("/ws/sensor")
async def ws_sensor(websocket: WebSocket):
    await websocket.accept()
    logger.info("SENSOR WEBSOCKET CONNECTED")
    try:
        while True:
            raw = await websocket.receive_text()

            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"success": False, "error": "JSON tidak valid"}
                )
                continue

            try:
                reading = SensorReading.model_validate(payload)
            except ValidationError as exc:
                errors = [
                    {"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]}
                    for e in exc.errors()
                ]
                await websocket.send_json(
                    {"success": False, "error": "Data tidak valid", "details": errors}
                )
                continue

            try:
                result = process_reading(reading)
                await check_and_trigger_alert(reading, result)
            except sqlite3.Error as exc:
                logger.error("DATABASE ERROR: %s", exc)
                await websocket.send_json(
                    {"success": False, "error": f"Database error: {exc}"}
                )
                continue

            await websocket.send_json(result)

    except WebSocketDisconnect:
        logger.info("SENSOR WEBSOCKET DISCONNECTED")
    except Exception as exc:  # jangan sampai server crash
        logger.error("SENSOR WEBSOCKET ERROR: %s", exc)


@app.websocket("/ws/user")
async def ws_user(websocket: WebSocket):
    """WebSocket endpoint untuk HP User penerima peringatan getaran."""
    await websocket.accept()
    connected_users.add(websocket)
    logger.info("USER WEBSOCKET CONNECTED (Total User: %d)", len(connected_users))
    try:
        # Kirim salam selamat datang & konfirmasi status sistem
        await websocket.send_json({
            "type": "CONNECTION_ESTABLISHED",
            "message": "Terhubung ke Earthquake Alert System",
            "total_users": len(connected_users),
        })

        while True:
            # Tetap listen (ping / pong heartbeat)
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("action") == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                pass

    except WebSocketDisconnect:
        logger.info("USER WEBSOCKET DISCONNECTED")
    except Exception as exc:
        logger.error("USER WEBSOCKET ERROR: %s", exc)
    finally:
        connected_users.discard(websocket)
        logger.info("USER WEBSOCKET CLEANED (Sisa User: %d)", len(connected_users))
