"""
FastAPI server untuk prototype deteksi getaran dan monitoring banjir.

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
from .detection.flood_detector import detect_flood
from .schemas import (
    FloodSensorData,
    SensorReading,
    SensorResponse,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

logger = logging.getLogger("seismic")


# ============================================================
# EARTHQUAKE DETECTOR
# ============================================================

detector = VibrationDetector()

_last_status: dict[str, str] = {}


# ============================================================
# USER WEBSOCKET CONNECTIONS
# ============================================================

# Daftar WebSocket user yang sedang terhubung
# untuk menerima broadcast alert.
connected_users: set[WebSocket] = set()


_last_alert_time: float = 0.0

# ============================================================
# FLOOD ALERT STATE
# ============================================================

# Cooldown dan level terakhir untuk sistem banjir.
# Level: NORMAL=0, WARNING=1, ALERT=2, CRITICAL=3
_last_flood_alert_time: float = 0.0
_last_flood_alert_level: int = 0



# ============================================================
# APPLICATION LIFESPAN
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()

    logger.info("SERVER STARTED")

    yield

    logger.info("SERVER STOPPED")


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="Earthquake & Flood Detection Server",
    lifespan=lifespan,
)


# ============================================================
# CORS
# ============================================================

# CORS middleware untuk akses prototype
# dari browser HP melalui LAN.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# STATIC WEB FILES
# ============================================================

# Mount direktori web untuk static files.
WEB_DIR = config.BASE_DIR / "web"

if WEB_DIR.exists():
    app.mount(
        "/web",
        StaticFiles(directory=WEB_DIR),
        name="web",
    )


# ============================================================
# EARTHQUAKE PROCESSING
# ============================================================

def process_reading(reading: SensorReading) -> dict:
    """
    Alur sistem gempa:

    accelerometer
        ↓
    magnitude
        ↓
    window
        ↓
    fitur
        ↓
    deteksi
        ↓
    SQLite
    """

    if detector.is_new_device(reading.device_id):
        logger.info(
            "DEVICE CONNECTED: %s",
            reading.device_id,
        )

    magnitude = acceleration_magnitude(
        reading.x,
        reading.y,
        reading.z,
    )

    if config.LOG_EVERY_SAMPLE:
        logger.info(
            "DATA RECEIVED: %s",
            reading.device_id,
        )

    result = detector.update(
        reading.device_id,
        magnitude,
    )

    changed = (
        _last_status.get(reading.device_id)
        != result["status"]
    )

    _last_status[reading.device_id] = result["status"]

    if config.LOG_EVERY_SAMPLE or changed:
        logger.info("ANALYSIS COMPLETED")

        logger.info(
            "STATUS: %s",
            result["status"],
        )

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


# ============================================================
# ALERT BROADCAST
# ============================================================

async def broadcast_alert(alert_data: dict) -> None:
    """
    Broadcast payload alert ke seluruh client
    user yang sedang terhubung.
    """

    if not connected_users:
        return

    dead_connections = set()

    for ws in list(connected_users):
        try:
            await ws.send_json(alert_data)

        except Exception as exc:
            logger.warning(
                "Gagal mengirim alert ke user websocket: %s",
                exc,
            )

            dead_connections.add(ws)

    for ws in dead_connections:
        connected_users.discard(ws)


# ============================================================
# EARTHQUAKE ALERT
# ============================================================

async def check_and_trigger_alert(
    reading: SensorReading,
    result: dict,
) -> None:
    """
    Evaluasi status deteksi getaran dan cooldown
    untuk mengirimkan broadcast alert gempa.
    """

    global _last_alert_time

    # Alert hanya dipicu jika deteksi menghasilkan
    # ANOMALY_VIBRATION.
    if result.get("status") != "ANOMALY_VIBRATION":
        return

    now = time.time()

    elapsed = now - _last_alert_time

    if elapsed < config.ALERT_COOLDOWN:
        logger.info(
            "ALERT COOLDOWN AKTIF (%.1fs tersisa). "
            "Alert tidak dikirim ulang.",
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
        logger.error(
            "DATABASE INSERT ALERT ERROR: %s",
            exc,
        )

    alert_payload = {
        "type": "EARTHQUAKE_ALERT",
        "status": "ANOMALY_VIBRATION",
        "message": message,
        "timestamp": reading.timestamp,
        "source_device": reading.device_id,
        "rms": round(result["rms"], 4),
        "peak": round(result["peak"], 4),
    }

    logger.warning(
        "\n" + "=" * 65 + "\n"
        "⚠️ [LOG AKTIVITAS: PERINGATAN ANOMALI GETARAN GEMPA DIKIRIM]\n"
        f"   • Sumber Sensor   : {reading.device_id}\n"
        f"   • Status Deteksi  : ANOMALY_VIBRATION (Getaran Abnormal)\n"
        f"   • Nilai RMS       : {result['rms']:.4f} m/s²\n"
        f"   • Nilai Peak      : {result['peak']:.4f} m/s²\n"
        f"   • Target Siaran   : {len(connected_users)} Client User (HP/Laptop Terhubung)\n"
        + "=" * 65
    )

    await broadcast_alert(alert_payload)



# ============================================================
# FLOOD ALERT
# ============================================================

async def check_and_trigger_flood_alert(
    data: "FloodSensorData",
    result: "FloodResult",  # type: ignore[name-defined]  # noqa
) -> None:
    """
    Evaluasi status deteksi banjir dengan cooldown dan
    priority escalation untuk broadcast alert.

    Alert hanya dikirim jika:
    - Status bukan NORMAL, DAN
    - risk_level LEBIH BESAR dari level sebelumnya
      (escalasi: WARNING → ALERT → CRITICAL),
      ATAU sudah melewati FLOOD_ALERT_COOLDOWN sejak
      alert terakhir pada level yang sama.
    """

    global _last_flood_alert_time, _last_flood_alert_level

    if result.risk_level == 0:
        # Status NORMAL — reset level tracker tapi jangan kirim alert.
        _last_flood_alert_level = 0
        return

    now = time.time()
    elapsed = now - _last_flood_alert_time

    # Kirim alert jika:
    # (a) risk_level meningkat (escalasi), ATAU
    # (b) sudah lewat cooldown sejak alert sebelumnya.
    escalated = result.risk_level > _last_flood_alert_level
    cooled_down = elapsed >= config.FLOOD_ALERT_COOLDOWN

    if not escalated and not cooled_down:
        logger.info(
            "FLOOD ALERT COOLDOWN AKTIF (%.1fs tersisa, level=%d). "
            "Alert tidak dikirim ulang.",
            config.FLOOD_ALERT_COOLDOWN - elapsed,
            _last_flood_alert_level,
        )
        return

    _last_flood_alert_time = now
    _last_flood_alert_level = result.risk_level

    status_deskripsi = {
        "FLOOD_WARNING": "WASPADA (Kenaikan Air Mulai Terdeteksi)",
        "FLOOD_ALERT": "SIAGA (Potensi Genangan & Banjir Luas)",
        "FLOOD_CRITICAL": "BAHAYA KRITIS (Ketinggian Air Melampaui Batas Aman)",
    }.get(result.status, result.status)

    alert_payload = {
        "type": "FLOOD_ALERT",
        "status": result.status,
        "message": result.message,
        "timestamp": now,
        "source_device": data.device_id,
        "water_level": data.water_level,
        "rate_of_rise": data.rate_of_rise,
        "rainfall": data.rainfall,
        "risk_level": result.risk_level,
    }

    logger.warning(
        "\n" + "=" * 65 + "\n"
        "🌊 [LOG AKTIVITAS: PERINGATAN DINI BANJIR DIKIRIM]\n"
        f"   • Sumber Sensor   : {data.device_id}\n"
        f"   • Jenis Peringatan: {result.status}\n"
        f"   • Kategori Bahaya : {status_deskripsi}\n"
        f"   • Tingkat Risiko  : Level {result.risk_level} / 3\n"
        f"   • Ketinggian Air  : {data.water_level:.1f} cm\n"
        f"   • Kenaikan Air    : {data.rate_of_rise:.1f} cm/jam\n"
        f"   • Curah Hujan     : {data.rainfall:.1f} mm/jam\n"
        f"   • Target Siaran   : {len(connected_users)} Client User (HP/Laptop Terhubung)\n"
        + "=" * 65
    )

    await broadcast_alert(alert_payload)




# ============================================================
# BASIC ROUTES
# ============================================================

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "Earthquake & Flood Detection Server",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


# ============================================================
# WEB PAGES
# ============================================================

@app.get("/sensor", include_in_schema=False)
def sensor_page():
    """
    Menyajikan halaman web sensor accelerometer
    untuk browser HP Android.
    """

    html_path = (
        config.BASE_DIR
        / "web"
        / "sensor.html"
    )

    return FileResponse(html_path)


@app.get("/flood", include_in_schema=False)
def flood_page():
    """
    Menyajikan halaman virtual sensor
    untuk monitoring banjir.
    """

    html_path = (
        config.BASE_DIR
        / "web"
        / "flood.html"
    )

    return FileResponse(html_path)


@app.get("/user", include_in_schema=False)
def user_page():
    """
    Menyajikan halaman web penerima peringatan
    gempa/getaran dan banjir.
    """

    html_path = (
        config.BASE_DIR
        / "web"
        / "user.html"
    )

    return FileResponse(html_path)


# ============================================================
# ALERT HISTORY
# ============================================================

@app.get("/api/alerts")
def get_alerts():
    """
    Mengambil riwayat alert terbaru dari SQLite.
    """

    try:
        alerts = database.fetch_latest_alerts(
            limit=50
        )

        return {
            "alerts": alerts
        }

    except sqlite3.Error as exc:
        logger.error(
            "DATABASE FETCH ALERTS ERROR: %s",
            exc,
        )

        return JSONResponse(
            status_code=500,
            content={
                "alerts": [],
                "error": f"Database error: {exc}",
            },
        )


# ============================================================
# EARTHQUAKE API
# ============================================================

@app.post(
    "/api/sensor",
    response_model=SensorResponse,
)
async def post_sensor(
    reading: SensorReading,
):
    """
    Endpoint sensor accelerometer gempa.
    """

    try:
        result = process_reading(reading)

        await check_and_trigger_alert(
            reading,
            result,
        )

        return result

    except sqlite3.Error as exc:
        logger.error(
            "DATABASE ERROR: %s",
            exc,
        )

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": f"Database error: {exc}",
            },
        )


# ============================================================
# FLOOD API
# ============================================================

@app.post("/api/flood")
async def post_flood(
    data: FloodSensorData,
):
    """
    Menerima data virtual sensor banjir,
    analisis status, simpan ke SQLite, dan
    broadcast alert ke user jika diperlukan.
    """

    result = detect_flood(
        water_level=data.water_level,
        rate_of_rise=data.rate_of_rise,
        rainfall=data.rainfall,
    )

    status_tag = {
        "NORMAL": "🟢 NORMAL (Aman)",
        "FLOOD_WARNING": "🟡 FLOOD_WARNING (Waspada)",
        "FLOOD_ALERT": "🟠 FLOOD_ALERT (Siaga)",
        "FLOOD_CRITICAL": "🔴 FLOOD_CRITICAL (Bahaya Kritis)",
    }.get(result.status, result.status)

    logger.info(
        f"[AKTIVITAS SENSOR BANJIR] Device: {data.device_id} | "
        f"Ketinggian: {data.water_level:.1f} cm | Naik: {data.rate_of_rise:.1f} cm/h | "
        f"Hujan: {data.rainfall:.1f} mm/h | Status: {status_tag} (Risiko: {result.risk_level}/3)"
    )


    try:
        database.save_flood_reading(
            device_id=data.device_id,
            timestamp=time.time(),
            water_level=data.water_level,
            rate_of_rise=data.rate_of_rise,
            rainfall=data.rainfall,
            status=result.status,
            risk_level=result.risk_level,
        )
    except sqlite3.Error as exc:
        logger.error("DATABASE FLOOD SAVE ERROR: %s", exc)

    await check_and_trigger_flood_alert(data, result)

    return {
        "success": True,
        "device_id": data.device_id,
        "sensor_type": data.sensor_type,
        "water_level": data.water_level,
        "rate_of_rise": data.rate_of_rise,
        "rainfall": data.rainfall,
        "status": result.status,
        "message": result.message,
        "risk_level": result.risk_level,
    }



# ============================================================
# EARTHQUAKE SENSOR WEBSOCKET
# ============================================================

@app.websocket("/ws/sensor")
async def ws_sensor(
    websocket: WebSocket,
):
    await websocket.accept()

    logger.info(
        "SENSOR WEBSOCKET CONNECTED"
    )

    try:

        while True:

            raw = await websocket.receive_text()

            # ------------------------------------------------
            # JSON PARSING
            # ------------------------------------------------

            try:
                payload = json.loads(raw)

            except json.JSONDecodeError:

                await websocket.send_json(
                    {
                        "success": False,
                        "error": "JSON tidak valid",
                    }
                )

                continue

            # ------------------------------------------------
            # VALIDATION
            # ------------------------------------------------

            try:

                reading = SensorReading.model_validate(
                    payload
                )

            except ValidationError as exc:

                errors = [
                    {
                        "field": ".".join(
                            str(p)
                            for p in e["loc"]
                        ),
                        "message": e["msg"],
                    }
                    for e in exc.errors()
                ]

                await websocket.send_json(
                    {
                        "success": False,
                        "error": "Data tidak valid",
                        "details": errors,
                    }
                )

                continue

            # ------------------------------------------------
            # PROCESSING
            # ------------------------------------------------

            try:

                result = process_reading(
                    reading
                )

                await check_and_trigger_alert(
                    reading,
                    result,
                )

            except sqlite3.Error as exc:

                logger.error(
                    "DATABASE ERROR: %s",
                    exc,
                )

                await websocket.send_json(
                    {
                        "success": False,
                        "error": f"Database error: {exc}",
                    }
                )

                continue

            await websocket.send_json(
                result
            )

    except WebSocketDisconnect:

        logger.info(
            "SENSOR WEBSOCKET DISCONNECTED"
        )

    except Exception as exc:

        # Jangan sampai server crash
        logger.error(
            "SENSOR WEBSOCKET ERROR: %s",
            exc,
        )


# ============================================================
# USER WEBSOCKET
# ============================================================

@app.websocket("/ws/user")
async def ws_user(
    websocket: WebSocket,
):
    """
    WebSocket endpoint untuk HP User
    penerima peringatan.
    """

    await websocket.accept()

    connected_users.add(websocket)

    logger.info(
        "USER WEBSOCKET CONNECTED "
        "(Total User: %d)",
        len(connected_users),
    )

    try:

        # Kirim salam selamat datang
        # dan konfirmasi status sistem.
        await websocket.send_json(
            {
                "type": "CONNECTION_ESTABLISHED",
                "message": (
                    "Terhubung ke "
                    "Earthquake & Flood Alert System"
                ),
                "total_users": len(
                    connected_users
                ),
            }
        )

        while True:

            # Tetap listen
            # untuk ping / pong heartbeat.
            data = await websocket.receive_text()

            try:

                msg = json.loads(data)

                if msg.get("action") == "ping":

                    await websocket.send_json(
                        {
                            "type": "pong"
                        }
                    )

            except Exception:
                pass

    except WebSocketDisconnect:

        logger.info(
            "USER WEBSOCKET DISCONNECTED"
        )

    except Exception as exc:

        logger.error(
            "USER WEBSOCKET ERROR: %s",
            exc,
        )

    finally:

        connected_users.discard(
            websocket
        )

        logger.info(
            "USER WEBSOCKET CLEANED "
            "(Sisa User: %d)",
            len(connected_users),
        )