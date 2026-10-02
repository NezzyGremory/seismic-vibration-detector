"""Kirim data dummy ke server (hanya library standar Python).

Contoh:
    python test_client.py                  # normal lalu vibration
    python test_client.py --mode normal
    python test_client.py --mode vibration --count 40
    python test_client.py --url http://192.168.1.10:8000
"""

import argparse
import json
import math
import random
import time
import urllib.error
import urllib.request


def make_sample(mode: str, i: int) -> tuple[float, float, float]:
    if mode == "normal":
        # HP diam di meja: gravitasi ~9.8 + noise kecil.
        return (
            random.gauss(0.0, 0.02),
            random.gauss(0.0, 0.02),
            9.8 + random.gauss(0.0, 0.02),
        )
    # Getaran buatan: osilasi besar + noise.
    wave = 3.0 * math.sin(i * 1.2)
    return (
        wave * 0.5 + random.gauss(0.0, 0.1),
        wave * 0.3 + random.gauss(0.0, 0.1),
        9.8 + wave + random.gauss(0.0, 0.1),
    )


def post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url + "/api/sensor",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return {"http_error": exc.code, "body": exc.read().decode()}
    except urllib.error.URLError as exc:
        raise SystemExit(f"Tidak bisa terhubung ke {url}: {exc.reason}")


def run_phase(url: str, device: str, mode: str, count: int, delay: float) -> None:
    print(f"\n=== Fase {mode.upper()} ({count} data) ===")
    for i in range(count):
        x, y, z = make_sample(mode, i)
        res = post(url, {"device_id": device, "timestamp": time.time(), "x": x, "y": y, "z": z})
        print(
            f"{i + 1:3d} | mag={res.get('magnitude')} rms={res.get('rms')} "
            f"peak={res.get('peak')} | {res.get('status', res)}"
        )
        time.sleep(delay)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--device", default="android-test")
    p.add_argument("--mode", choices=["normal", "vibration", "both"], default="both")
    p.add_argument("--count", type=int, default=40)
    p.add_argument("--delay", type=float, default=0.05)
    a = p.parse_args()

    modes = ["normal", "vibration"] if a.mode == "both" else [a.mode]
    for m in modes:
        run_phase(a.url.rstrip("/"), a.device, m, a.count, a.delay)


if __name__ == "__main__":
    main()
