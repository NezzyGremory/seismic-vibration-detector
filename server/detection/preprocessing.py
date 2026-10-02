"""Preprocessing sederhana untuk window data accelerometer."""

import numpy as np

from .. import config


def to_clean_array(values) -> np.ndarray:
    """Ubah input menjadi array float 1-D dan buang nilai NaN/inf."""
    try:
        arr = np.asarray(values, dtype=float).ravel()
    except (TypeError, ValueError):
        return np.array([], dtype=float)
    return arr[np.isfinite(arr)]


def remove_offset(samples: np.ndarray) -> np.ndarray:
    """Kurangi rata-rata window dari tiap sampel.

    Fungsi: filter high-pass paling sederhana. Komponen yang konstan/lambat
    (termasuk gravitasi bumi ~9.8 m/s^2 pada accelerationIncludingGravity,
    dan kemiringan HP) hilang, sehingga yang tersisa adalah getaran dinamis.
    """
    if samples.size == 0:
        return samples
    return samples - samples.mean()


def moving_average(samples: np.ndarray, window: int) -> np.ndarray:
    """Moving average (low-pass sederhana) untuk meredam noise frekuensi tinggi.

    Panjang output = len(samples) - window + 1 (mode 'valid', tanpa efek tepi).
    """
    if window <= 1 or samples.size < window:
        return samples
    kernel = np.ones(window) / window
    return np.convolve(samples, kernel, mode="valid")


def preprocess_window(values) -> np.ndarray:
    """Pipeline: bersihkan -> (opsional) hilangkan offset -> (opsional) smoothing."""
    arr = to_clean_array(values)
    if config.REMOVE_OFFSET:
        arr = remove_offset(arr)
    arr = moving_average(arr, config.SMOOTHING_WINDOW)
    return arr
