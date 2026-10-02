"""Detector getaran rule-based + buffer window per device.

Output status hanya: NORMAL atau ANOMALY_VIBRATION.
Prototype ini belum divalidasi dengan seismometer/dataset gempa,
jadi tidak ada status "gempa terdeteksi".
"""

import threading
from collections import deque

from .. import config
from .features import extract_features
from .preprocessing import preprocess_window

STATUS_NORMAL = "NORMAL"
STATUS_ANOMALY = "ANOMALY_VIBRATION"


def classify(features: dict) -> str:
    """Aturan sederhana: anomali jika RMS ATAU peak melewati threshold.

    Threshold ini hanya parameter eksperimen untuk prototype dan harus
    dikalibrasi menggunakan data nyata.
    """
    if (
        features["rms"] >= config.VIBRATION_RMS_THRESHOLD
        or features["peak"] >= config.VIBRATION_PEAK_THRESHOLD
    ):
        return STATUS_ANOMALY
    return STATUS_NORMAL


class VibrationDetector:
    """Menyimpan window acceleration magnitude per device dan menganalisisnya."""

    def __init__(self) -> None:
        self._buffers: dict[str, deque] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._buffers.clear()

    def is_new_device(self, device_id: str) -> bool:
        with self._lock:
            return device_id not in self._buffers

    def update(self, device_id: str, magnitude: float) -> dict:
        """Tambahkan satu sampel ke window device lalu analisis window-nya."""
        with self._lock:
            buf = self._buffers.setdefault(
                device_id, deque(maxlen=config.WINDOW_SIZE)
            )
            buf.append(magnitude)
            window = list(buf)

        signal = preprocess_window(window)
        features = extract_features(signal)
        ready = len(window) >= config.MIN_SAMPLES_FOR_ANALYSIS
        status = classify(features) if ready else STATUS_NORMAL

        return {
            "rms": features["rms"],
            "peak": features["peak"],
            "status": status,
            "window_samples": len(window),
            "window_ready": ready,
            "features": features,
        }
