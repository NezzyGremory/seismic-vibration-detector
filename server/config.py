"""Konfigurasi server. Semua parameter yang bisa diubah diletakkan di sini."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Lokasi database SQLite (dibuat otomatis saat server pertama kali jalan).
DB_PATH = Path(os.environ.get("SEISMIC_DB_PATH", BASE_DIR / "data" / "seismic.db"))

# ---------------------------------------------------------------------------
# Data window (per device)
# ---------------------------------------------------------------------------
# Jumlah sampel terakhir yang disimpan di buffer tiap device.
# Contoh: sensor 50 Hz dan WINDOW_SIZE = 100 -> window sekitar 2 detik.
WINDOW_SIZE = 100

# Jumlah sampel minimum sebelum detector boleh menilai ANOMALY_VIBRATION.
# Sebelum itu status selalu NORMAL (window_ready = false).
MIN_SAMPLES_FOR_ANALYSIS = 20

# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------
# True  -> kurangi rata-rata window dari sinyal (menghilangkan komponen DC,
#          termasuk gravitasi bumi ~9.8 m/s^2 jika data accelerationIncludingGravity).
REMOVE_OFFSET = True

# Panjang moving average untuk meredam noise. 1 = tidak ada smoothing.
SMOOTHING_WINDOW = 1

# Nilai |x|, |y|, |z| di atas batas ini dianggap tidak masuk akal (m/s^2)
# dan ditolak dengan HTTP 422. Akselerometer HP umumnya maksimal sekitar 16 g.
MAX_ABS_ACCELERATION = 400.0

# ---------------------------------------------------------------------------
# Threshold detector
# ---------------------------------------------------------------------------
# Threshold ini hanya parameter eksperimen untuk prototype dan harus
# dikalibrasi menggunakan data nyata. Bukan standar BMKG atau standar resmi lain.
# Satuan mengikuti data sensor (m/s^2 untuk DeviceMotionEvent).
VIBRATION_RMS_THRESHOLD = 0.30
VIBRATION_PEAK_THRESHOLD = 1.00

# ---------------------------------------------------------------------------
# Alert System Configuration
# ---------------------------------------------------------------------------
# Cooldown antar alert broadcast (dalam detik).
# Mencegah HP user dibombardir alert setiap sampel selama getaran berlangsung.
ALERT_COOLDOWN = 10.0

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
# False -> log per-sampel dimatikan; hanya log saat status berubah.
LOG_EVERY_SAMPLE = True
