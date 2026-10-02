"""Perhitungan fitur dari window sinyal (NumPy)."""

import math

import numpy as np


def acceleration_magnitude(x: float, y: float, z: float) -> float:
    """Acceleration magnitude = sqrt(x^2 + y^2 + z^2).

    CATATAN: jika data berasal dari accelerationIncludingGravity, gravitasi
    bumi (~9.8 m/s^2) ikut masuk ke nilai ini, sehingga HP yang diam pun
    menghasilkan magnitude sekitar 9.8. Ini BUKAN magnitudo gempa
    (skala Richter/Mw); hanya besaran percepatan/getaran.
    """
    return math.sqrt(x * x + y * y + z * z)


def extract_features(samples) -> dict:
    """Hitung fitur statistik dasar. Input: array 1-D (sebaiknya sudah dipreprocess).

    Mudah dipakai ulang sebagai input machine learning nantinya.
    """
    arr = np.asarray(samples, dtype=float).ravel()
    if arr.size == 0:
        return {
            "mean": 0.0, "std": 0.0, "rms": 0.0, "min": 0.0, "max": 0.0,
            "peak_to_peak": 0.0, "energy": 0.0, "peak": 0.0,
        }
    return {
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "rms": float(np.sqrt(np.mean(arr ** 2))),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "peak_to_peak": float(arr.max() - arr.min()),
        "energy": float(np.sum(arr ** 2)),
        # amplitudo puncak absolut (dipakai detector)
        "peak": float(np.max(np.abs(arr))),
    }
