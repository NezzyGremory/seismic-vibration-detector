"""Test API. Jalankan dari root project:  python -m pytest -v"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from server import config, database
from server import main as server_main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Database sementara supaya seismic.db asli tidak tersentuh.
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    server_main.detector.reset()
    server_main._last_status.clear()
    with TestClient(server_main.app) as c:  # memicu lifespan -> init_db()
        yield c


def sample(device="android-test", x=0.12, y=0.08, z=9.72):
    return {"device_id": device, "timestamp": time.time(), "x": x, "y": y, "z": z}


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json() == {"status": "online", "service": "Earthquake & Flood Detection Server"}



def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "healthy"}


def test_post_valid(client):
    r = client.post("/api/sensor", json=sample())
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["device_id"] == "android-test"
    assert abs(body["magnitude"] - 9.7208) < 0.01
    assert body["status"] == "NORMAL"
    assert {"rms", "peak"} <= body.keys()


def test_post_invalid(client):
    bad_type = sample()
    bad_type["x"] = "abc"
    assert client.post("/api/sensor", json=bad_type).status_code == 422

    missing = sample()
    del missing["z"]
    assert client.post("/api/sensor", json=missing).status_code == 422

    no_device = sample()
    del no_device["device_id"]
    assert client.post("/api/sensor", json=no_device).status_code == 422

    broken = client.post(
        "/api/sensor", content="{bukan json", headers={"Content-Type": "application/json"}
    )
    assert broken.status_code == 422


def test_database_saves_data(client):
    before = database.count_readings()
    client.post("/api/sensor", json=sample(x=1.0, y=2.0, z=3.0))
    assert database.count_readings() == before + 1
    row = database.fetch_latest(1)[0]
    assert row["device_id"] == "android-test"
    assert row["x"] == 1.0 and row["y"] == 2.0 and row["z"] == 3.0
    assert row["status"] in ("NORMAL", "ANOMALY_VIBRATION")


def test_detector_changes_to_anomaly(client):
    status = None
    for _ in range(30):  # sinyal tenang
        status = client.post("/api/sensor", json=sample(device="dev-a")).json()["status"]
    assert status == "NORMAL"

    for i in range(30):  # getaran kuat (osilasi di sumbu z)
        z = 9.8 + (4.0 if i % 2 == 0 else -4.0)
        status = client.post("/api/sensor", json=sample(device="dev-a", z=z)).json()["status"]
    assert status == "ANOMALY_VIBRATION"


def test_websocket(client):
    with client.websocket_connect("/ws/sensor") as ws:
        ws.send_json(sample(device="ws-dev", x=0.1, y=0.2, z=9.8))
        data = ws.receive_json()
        assert data["device_id"] == "ws-dev"
        assert data["status"] == "NORMAL"
        assert "magnitude" in data

        ws.send_text("{rusak")  # server tidak boleh crash
        assert ws.receive_json()["success"] is False

        ws.send_json({"device_id": "ws-dev"})
        assert ws.receive_json()["success"] is False

        ws.send_json(sample(device="ws-dev"))  # masih berfungsi
        assert ws.receive_json()["success"] is True


def test_sensor_page(client):
    r = client.get("/sensor")
    assert r.status_code == 200
    assert "EARTHQUAKE SENSOR" in r.text
    assert "waveformCanvas" in r.text


def test_sensor_static_assets(client):
    css_res = client.get("/web/sensor.css")
    assert css_res.status_code == 200
    assert "status-banner" in css_res.text

    js_res = client.get("/web/sensor.js")
    assert js_res.status_code == 200
    assert "DeviceMotionEvent" in js_res.text


def test_user_page(client):
    r = client.get("/user")
    assert r.status_code == 200
    assert "DISASTER MONITORING ALERT" in r.text
    assert "alertOverlay" in r.text



def test_user_static_assets(client):
    css_res = client.get("/web/user.css")
    assert css_res.status_code == 200
    assert "alert-overlay" in css_res.text

    js_res = client.get("/web/user.js")
    assert js_res.status_code == 200
    assert "triggerEmergencyWarning" in js_res.text


def test_api_alerts(client):
    r = client.get("/api/alerts")
    assert r.status_code == 200
    assert "alerts" in r.json()
    assert isinstance(r.json()["alerts"], list)


def test_user_alert_broadcast_and_cooldown(client):
    server_main._last_alert_time = 0.0

    # User terhubung ke /ws/user
    with client.websocket_connect("/ws/user") as user_ws:
        welcome = user_ws.receive_json()
        assert welcome["type"] == "CONNECTION_ESTABLISHED"

        # Hubungkan sensor ke /ws/sensor dan kirim data normal
        with client.websocket_connect("/ws/sensor") as sensor_ws:
            for _ in range(25):
                sensor_ws.send_json(sample(device="sensor-dev", z=9.8))
                sensor_ws.receive_json()

            # Picu getaran anomali
            for i in range(25):
                z = 9.8 + (5.0 if i % 2 == 0 else -5.0)
                sensor_ws.send_json(sample(device="sensor-dev", z=z))
                sensor_res = sensor_ws.receive_json()

            # Pastikan status sensor menjadi ANOMALY_VIBRATION
            assert sensor_res["status"] == "ANOMALY_VIBRATION"

        # User websocket harus menerima broadcast EARTHQUAKE_ALERT
        alert = user_ws.receive_json()
        assert alert["type"] == "EARTHQUAKE_ALERT"
        assert alert["status"] == "ANOMALY_VIBRATION"
        assert alert["source_device"] == "sensor-dev"
        assert "rms" in alert and "peak" in alert

        # Verifikasi data tersimpan di tabel alerts
        res_alerts = client.get("/api/alerts").json()["alerts"]
        assert len(res_alerts) >= 1
        assert res_alerts[0]["source_device"] == "sensor-dev"

        # Uji COOLDOWN: Kirim anomali getaran lagi segera
        # Dalam masa cooldown, alert baru TIDAK boleh dikirim ulang
        sensor_res_again = client.post(
            "/api/sensor",
            json=sample(device="sensor-dev", z=15.0),
        ).json()
        assert sensor_res_again["status"] == "ANOMALY_VIBRATION"


def test_flood_page(client):
    r = client.get("/flood")
    assert r.status_code == 200
    assert "Flood Sensor" in r.text
    assert "Auto Sensor Simulation" in r.text


def test_flood_api_normal(client):
    r = client.post(
        "/api/flood",
        json={
            "device_id": "flood-dev-1",
            "water_level": 20.0,
            "rate_of_rise": 1.0,
            "rainfall": 5.0,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["status"] == "NORMAL"
    assert data["risk_level"] == 0


def test_flood_api_warning_and_critical(client):
    r_warn = client.post(
        "/api/flood",
        json={
            "device_id": "flood-dev-1",
            "water_level": 35.0,
            "rate_of_rise": 3.5,
            "rainfall": 10.0,
        },
    )
    assert r_warn.status_code == 200
    assert r_warn.json()["status"] == "FLOOD_WARNING"

    r_crit = client.post(
        "/api/flood",
        json={
            "device_id": "flood-dev-1",
            "water_level": 85.0,
            "rate_of_rise": 6.0,
            "rainfall": 50.0,
        },
    )
    assert r_crit.status_code == 200
    assert r_crit.json()["status"] == "FLOOD_CRITICAL"
    assert r_crit.json()["risk_level"] == 3


def test_flood_broadcast_and_escalation(client):
    server_main._last_flood_alert_time = 0.0
    server_main._last_flood_alert_level = 0

    with client.websocket_connect("/ws/user") as user_ws:
        user_ws.receive_json()  # CONNECTION_ESTABLISHED

        # Send WARNING (risk level 1) -> Broadcast triggered
        client.post(
            "/api/flood",
            json={
                "device_id": "node-1",
                "water_level": 35.0,
                "rate_of_rise": 3.2,
                "rainfall": 10.0,
            },
        )
        msg1 = user_ws.receive_json()
        assert msg1["type"] == "FLOOD_ALERT"
        assert msg1["status"] == "FLOOD_WARNING"

        # Send CRITICAL (risk level 3 > 1) -> Escalation triggers immediate broadcast even within cooldown
        client.post(
            "/api/flood",
            json={
                "device_id": "node-1",
                "water_level": 82.0,
                "rate_of_rise": 7.0,
                "rainfall": 40.0,
            },
        )
        msg2 = user_ws.receive_json()
        assert msg2["type"] == "FLOOD_ALERT"
        assert msg2["status"] == "FLOOD_CRITICAL"

