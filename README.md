# Prototype Deteksi Anomali Getaran Berbasis Sensor Accelerometer Smartphone (V1 + User Alert System)

Prototype sistem eksperimen penginderaan getaran (seismic-like vibration) dan sistem peringatan darurat (*user alert system*) terintegrasi. Sistem memanfaatkan smartphone Android sebagai **sensor fisik** untuk mendeteksi getaran secara *realtime*, mengirimkan data ke **server Python (FastAPI)** di PC untuk dianalisis, lalu server menyiarkan (*broadcast*) peringatan ke banyak **perangkat pengguna (User Phones)** secara simultan dengan tampilan visual darurat *fullscreen*, suara sirine alarm, dan getaran.

> [!IMPORTANT]
> **Pernyataan Batasan & Penafian Ilmiah (Disclaimer):**
> 1. Sistem ini **BUKAN** sistem prediksi gempa bumi (tidak dapat memprediksi kapan atau di mana gempa akan terjadi).
> 2. Sistem ini **BUKAN** seismometer profesional dan **BUKAN** pengganti alat pemantau seismik BMKG.
> 3. Istilah *"magnitude"* di dalam server adalah *acceleration magnitude* (\(|a| = \sqrt{x^2+y^2+z^2}\) dalam satuan \(m/s^2\)), **BUKAN** magnitudo skala Richter atau standar gempa BMKG.
> 4. Nilai ambang batas (*threshold*) pada `server/config.py` bersifat eksperimental untuk kebutuhan demonstrasi prototipe laboratorium.

---

## 1. Peran Komponen Sistem

* **Sensor Phone (HP Sensor `/sensor`)**: Perangkat fisik yang diletakkan di permukaan untuk melakukan pengukuran akselerasi 3-sumbu ($X, Y, Z$) melalui `DeviceMotionEvent`.
* **Server PC (Pusat Pemrosesan & Distribusi Alert)**:
  * Memvalidasi sinyal akselerasi dengan Pydantic.
  * Mengeliminasi offset gravitasi pada buffer sliding window.
  * Menghitung parameter getaran (RMS, Peak).
  * Menilai status getaran (`NORMAL` vs `ANOMALY_VIBRATION`).
  * Mengelola **Alert Engine** dengan jeda *cooldown* untuk mencegah spam alarm.
  * Menyiarkan (*broadcast*) notifikasi darurat secara paralel ke seluruh client user yang terhubung.
  * Menyimpan log sampel dan riwayat alert ke database **SQLite**.
* **User Devices (HP User `/user`)**: Perangkat pengguna/masyarakat yang berada dalam posisi siaga (*armed*). Saat anomali getaran terdeteksi, perangkat menampilkan layar peringatan *fullscreen*, menyalakan suara sirine, dan mengaktifkan getaran fisik.

---

## 2. Arsitektur & Alur Data End-to-End

```text
       SMARTPHONE ANDROID (SENSOR NODE)
                     │
                     ▼
          Accelerometer Sensor (Fisik)
                     │
                     ▼
         Browser DeviceMotionEvent
                     │
                     ▼
           Vanilla JavaScript (Web)
                     │
                     ▼ (Format JSON via Wi-Fi)
             WebSocket /ws/sensor
                     │
                     ▼
         PC FASTAPI BACKEND SERVER
                     │
             ┌───────┴───────┐
             ▼               ▼
      Data Validation    Magnitude |a|
      (Pydantic)         (sqrt(x²+y²+z²))
             │               │
             └───────┬───────┘
                     ▼
          Sliding Window Buffer
          (100 sampel terakhir per device)
                     │
                     ▼
             Signal Preprocessing
          (Remove DC Offset/Gravitasi & Smoothing)
                     │
                     ▼
              Feature Extraction
          (RMS, Peak, Min, Max, Peak-to-Peak)
                     │
                     ▼
            Vibration Detector
          (Evaluasi Threshold RMS & Peak)
                     │
             ┌───────┴───────┐
             ▼               ▼
          NORMAL     ANOMALY_VIBRATION
             │               │
             │               ▼
             │      Alert Engine (Cooldown 10s)
             │               │
             │       ┌───────┴───────┐
             │       ▼               ▼
             │   SQLite (alerts)  WebSocket Broadcast (/ws/user)
             │                       │
             │       ┌───────────────┼───────────────┐
             │       ▼               ▼               ▼
             │   USER HP 1       USER HP 2       USER HP 3
             │   (Overlay +      (Overlay +      (Overlay +
             │    Sound + Vib)    Sound + Vib)    Sound + Vib)
             │
             └───────┬───────────────┐
                     ▼               ▼
           SQLite (readings)   WebSocket Response (ke Sensor)
```

---

## 3. Struktur Direktori Terbaru

```text
earthquake-detection/
├── server/
│   ├── __init__.py
│   ├── main.py              # Endpoint Sensor, User WebSocket, Alert Engine, & Static Serving
│   ├── config.py            # Konfigurasi window, threshold, & ALERT_COOLDOWN
│   ├── database.py          # SQLite schema (sensor_readings & alerts)
│   ├── schemas.py           # Validasi skema Pydantic
│   └── detection/
│       ├── __init__.py
│       ├── preprocessing.py # Pembersihan sinyal & eliminasi offset gravitasi
│       ├── features.py      # Ekstraksi fitur RMS, Peak, dll.
│       └── detector.py      # Logika status NORMAL vs ANOMALY_VIBRATION
├── web/
│   ├── sensor.html          # Antarmuka web mobile-first sensor HP
│   ├── sensor.css           # Styling dark mode sensor
│   ├── sensor.js            # Client JavaScript Sensor (DeviceMotion, Canvas, WebSocket)
│   ├── user.html            # Antarmuka web penerima peringatan User
│   ├── user.css             # Styling dashboard user & fullscreen emergency overlay
│   ├── user.js              # Client JavaScript User (Audio Siren, Vibration, WebSocket)
│   └── assets/              # Aset pendukung (audio alert)
├── data/
│   └── seismic.db           # Database SQLite (dibuat otomatis)
├── tests/
│   └── test_api.py          # 13 Unit test FastAPI, WebSocket, Alert Engine, & Cooldown
├── test_client.py           # Script client simulasi data dummy
├── requirements.txt         # Daftar pustaka Python
├── .gitignore
└── README.md
```

---

## 4. Cara Menjalankan Server di PC

1. **Buka PowerShell dan aktifkan Virtual Environment**:
   ```powershell
   cd c:\Users\Lenovo\Documents\earthquake-detection
   .\venv\Scripts\Activate.ps1
   ```

2. **Jalankan FastAPI Server pada Host `0.0.0.0`**:
   ```powershell
   uvicorn server.main:app --host 0.0.0.0 --port 8000
   ```

3. **Cari IP Address PC Anda**:
   Buka terminal PowerShell baru dan ketik:
   ```powershell
   ipconfig
   ```
   Cari baris `IPv4 Address` pada adaptor Wi-Fi yang aktif (misalnya `192.168.43.17`).

---

## 5. Cara Mengakses dari HP Android

Pastikan seluruh HP dan PC terhubung pada **jaringan Wi-Fi / Hotspot yang sama**.

### A. Membuka Halaman Sensor (HP Pengukur):
Buka di browser HP pertama:
```text
http://192.168.43.17:8000/sensor
```
1. Masukkan Server IP `192.168.43.17` dan Port `8000`.
2. Klik **HUBUNGKAN WEBSOCKET** (Status: `● CONNECTED`).
3. Klik **AKTIFKAN SENSOR** (Status: `● ACTIVE`).
*(Catatan: Jika sensor terblokir di Chrome Android karena HTTP, buka `chrome://flags`, cari `Insecure origins treated as secure`, aktifkan dan masukkan `http://192.168.43.17:8000`, lalu Relaunch; atau gunakan browser Firefox Android).*

### B. Membuka Halaman User Alert (HP Pengguna / Penerima):
Buka di browser HP kedua (atau tab browser PC/HP lain):
```text
http://192.168.43.17:8000/user
```
1. Masukkan Server IP `192.168.43.17` dan Port `8000`.
2. Klik **HUBUNGKAN KE SERVER** (Status: `● CONNECTED`).
3. Klik tombol hijau **🔔 AKTIFKAN PERINGATAN (ARM SYSTEM)**.
   * Tombol ini membuka izin browser untuk memutar suara sirine dan getaran secara otomatis saat sinyal bahaya tiba.
   * Status sistem berubah menjadi `● ARMED`.

---

## 6. Skenario Pengujian (Demonstrasi Laboratorium)

```text
[Langkah 1] Hubungkan HP Sensor (/sensor) -> Status NORMAL (Diam di meja)
                 │
[Langkah 2] Hubungkan 1 atau lebih HP User (/user) -> Klik AKTIFKAN PERINGATAN (ARMED)
                 │
[Langkah 3] Ketuk / getarkan meja di dekat HP Sensor
                 │
[Langkah 4] Server mendeteksi ANOMALY_VIBRATION
                 │
[Langkah 5] Seluruh HP User serentak memicu FULLSCREEN WARNING + SUARA SIRINE + GETARAN
                 │
[Langkah 6] Tekan "MATIKAN SUARA" untuk membisukan audio tanpa menutup warning
                 │
[Langkah 7] Tekan "SAYA MENGERTI" untuk mereset tampilan kembali ke posisi ARMED
```

1. **Uji Kondisi Normal**:
   * Letakkan HP Sensor secara diam dan stabil di atas meja.
   * Dashboard Sensor menampilkan status `NORMAL`.
   * Dashboard User tetap tenang menampilkan status `SYSTEM ARMED (MONITORING)`. Tidak ada suara atau peringatan yang muncul.
2. **Uji Simulasi Getaran / Anomali**:
   * Ketuk atau goyangkan permukaan meja di dekat HP Sensor secara aman.
   * Nilai RMS dan Peak pada server melampaui batas threshold.
   * Status pada HP Sensor seketika berubah menjadi `ANOMALY VIBRATION`.
   * **Server Alert Engine langsung membroadcast sinyal peringatan ke seluruh HP User**.
   * Di layar seluruh HP User:
     * Muncul **Layar Peringatan Fullscreen Merah Berkedip** bertuliskan:
       ```text
       ⚠️ WARNING GEMPA
       ANOMALI GETARAN TERDETEKSI
       Sistem menerima indikasi getaran abnormal dari sensor.
       Sumber Sensor: android-xxx
       Waktu: 23:21:47
       ```
     * Browser memainkan **suara sirine darurat** berulang.
     * Ponsel **bergetar secara berkala**.
3. **Uji Mekanisme Cooldown (Anti-Spam Alert)**:
   * Jika getaran berlangsung terus-menerus selama beberapa detik, server **tidak akan membroadcast puluhan kali**.
   * Parameter `ALERT_COOLDOWN = 10.0` detik menjaga agar HP User tidak dibombardir audio berulang pada setiap sampel getaran.
4. **Uji Reset Alert**:
   * Pengguna dapat menekan tombol **🔇 MATIKAN SUARA** untuk menghentikan bunyi sirine sementara layar tetap menampilkan peringatan.
   * Pengguna menekan tombol **✓ SAYA MENGERTI** untuk menutup overlay peringatan. Sistem kembali siaga (`ARMED`) dan WebSocket tetap terhubung untuk menerima alert berikutnya.

---

## 7. Format Protokol Komunikasi WebSocket

### Payload Alert Broadcast (Server -> HP User):
```json
{
  "type": "EARTHQUAKE_ALERT",
  "status": "ANOMALY_VIBRATION",
  "message": "Anomali getaran terdeteksi",
  "timestamp": 1727885100.245,
  "source_device": "android-a83f21",
  "rms": 0.8542,
  "peak": 1.4218
}
```

### Riwayat Alert (Endpoint `GET /api/alerts`):
```json
{
  "alerts": [
    {
      "id": 1,
      "timestamp": 1727885100.245,
      "source_device": "android-a83f21",
      "status": "ANOMALY_VIBRATION",
      "rms": 0.8542,
      "peak": 1.4218,
      "message": "Anomali getaran terdeteksi"
    }
  ]
}
```

---

## 8. Menjalankan Unit Test Otomatis

Seluruh modul backend, validasi Pydantic, algoritma deteksi, database SQLite, endpoint `/sensor`, `/user`, `/api/alerts`, serta logika broadcast dan cooldown diuji secara otomatis:

```powershell
python -m pytest -v
```

Hasil verifikasi:
```text
tests/test_api.py::test_root PASSED
tests/test_api.py::test_health PASSED
tests/test_api.py::test_post_valid PASSED
tests/test_api.py::test_post_invalid PASSED
tests/test_api.py::test_database_saves_data PASSED
tests/test_api.py::test_detector_changes_to_anomaly PASSED
tests/test_api.py::test_websocket PASSED
tests/test_api.py::test_sensor_page PASSED
tests/test_api.py::test_sensor_static_assets PASSED
tests/test_api.py::test_user_page PASSED
tests/test_api.py::test_user_static_assets PASSED
tests/test_api.py::test_api_alerts PASSED
tests/test_api.py::test_user_alert_broadcast_and_cooldown PASSED
======================== 13 passed in 2.67s ========================
```
Semua test sukses tanpa error.
