# Prototype Disaster Monitoring System (Gempa & Banjir)
### Realtime Earthquake Vibration Detection & Flood Early Warning System

Prototype sistem monitoring multi-bencana (*Disaster Monitoring System*) terintegrasi yang menggabungkan deteksi anomali getaran seismik (*seismic-like vibration*) menggunakan sensor *accelerometer* smartphone dan simulasi monitoring kenaikan air banjir (*flood early warning*).

Data dikirimkan secara *realtime* ke **Python FastAPI Server** di PC untuk dianalisis, disimpan ke **SQLite**, dan disiarkan (*broadcast*) secara serentak ke perangkat pengguna (**Laptop / HP User**) melalui Web Audio Sirine Nyaring, Vibrate API, dan Notifikasi Sistem OS (PWA & Service Worker).

---

> [!IMPORTANT]
> ### ⚠️ Batasan Ilmiah & Penafian (Disclaimer)
> 1. **Bukan Sistem Prediksi Resmi**: Sistem ini **TIDAK** memprediksi kapan atau di mana gempa dan banjir akan terjadi, melainkan **mendeteksi anomali fisik getaran dan kenaikan air yang sedang berlangsung secara realtime**.
> 2. **Bukan Pengganti BMKG / BNPB**: Sistem ini adalah prototipe penelitian laboratorium IoT dan teknologi web, **BUKAN** seismometer profesional maupun stasiun hidrometeorologi resmi pemerintah.
> 3. **Nilai Ambang Batas Eksperimental**: Nilai *threshold* akselerasi (\(RMS \ge 0.30\ m/s^2\), \(Peak \ge 1.00\ m/s^2\)) dan ketinggian air (\(<30\) cm Normal, \(\ge 30\) cm Waspada, \(\ge 50\) cm Siaga, \(\ge 80\) cm Kritis) bersifat demonstratif untuk keperluan pengujian purwarupa.

---

## 🏗️ Arsitektur Sistem

```text
    ┌──────────────────────┐                     ┌──────────────────────┐
    │  HP 1: SENSOR GEMPA  │                     │  HP 2: SENSOR BANJIR │
    │  (/sensor via Web)   │                     │  (/flood via Web)    │
    │  DeviceMotionEvent   │                     │  Virtual/IoT Node    │
    └──────────┬───────────┘                     └──────────┬───────────┘
               │ WebSocket                                  │ HTTP POST
               ▼                                            ▼
    ┌───────────────────────────────────────────────────────────────────┐
    │                     PUSAT SERVER PC (FASTAPI)                     │
    │  - Sinyal Preprocessing (Remove Offset Gravitasi & Smoothing)     │
    │  - Ekstraksi Fitur Getaran (Magnitude, RMS, Peak, Min, Max)       │
    │  - Mesin Deteksi Gempa (NORMAL vs ANOMALY_VIBRATION)              │
    │  - Mesin Deteksi Banjir (NORMAL, WARNING, ALERT, CRITICAL)        │
    │  - Priority Escalation & Cooldown Engine (Anti-Spam Alert)        │
    │  - Penyimpanan Database SQLite (Readings & Alerts History)        │
    │  - Visual Terminal Activity Logger (Log Aktivitas Terstruktur)    │
    └─────────────────────────────────┬─────────────────────────────────┘
                                      │ WebSocket Broadcast (/ws/user)
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
    ┌──────────────────────┐                      ┌──────────────────────┐
    │  DEVICE 3: HP USER   │                      │  DEVICE 4: LAPTOP    │
    │  (/user via Browser) │                      │  (/user Dashboard)   │
    │  - Fullscreen Visual │                      │  - Fullscreen Visual │
    │  - Sirine Melengking │                      │  - Sirine Melengking │
    │  - Pola Getaran HP   │                      │  - Histori Kejadian  │
    │  - PWA & OS Notif    │                      │  - Status Realtime   │
    └──────────────────────┘                      └──────────────────────┘
```

---

## 📁 Struktur Direktori Project

```text
earthquake-detection/
├── server/
│   ├── __init__.py
│   ├── main.py              # Server FastAPI, WebSockets, REST API, & Broadcast Engine
│   ├── config.py            # Konfigurasi threshold, window buffer, & cooldown
│   ├── database.py          # SQLite schema & CRUD (sensor_readings, alerts, flood_readings)
│   ├── schemas.py           # Validasi data sensor Pydantic (strict type & range check)
│   └── detection/
│       ├── __init__.py
│       ├── preprocessing.py # Eliminasi DC offset gravitasi bumi & filter smoothing
│       ├── features.py      # Ekstraksi fitur RMS, Peak, & Magnitude akselerasi
│       ├── detector.py      # Logika deteksi getaran gempa bumi
│       └── flood_detector.py# Logika klasifikasi tingkat bahaya banjir
├── web/
│   ├── sensor.html          # Web client accelerometer HP Android
│   ├── sensor.css           # Styling dark mode sensor gempa
│   ├── sensor.js            # Client JavaScript accelerometer (DeviceMotion & Canvas Waveform)
│   ├── flood.html           # Web virtual sensor & simulasi kenaikan air banjir
│   ├── flood.css            # Styling dashboard sensor banjir
│   ├── flood.js             # Kontrol manual & auto sensor simulation kenaikan air
│   ├── user.html            # Web receiver peringatan bencana untuk pengguna
│   ├── user.css             # Styling mobile-responsive & fullscreen emergency overlay
│   ├── user.js              # Receiver logic (Audio Synthesizer nyaring, getaran, & auto-connect)
│   ├── sw.js                # Service Worker untuk notifikasi sistem background OS
│   └── manifest.json        # Web App Manifest untuk PWA (Add to Home Screen)
├── data/
│   └── seismic.db           # Database SQLite (terbuat otomatis saat server berjalan)
├── tests/
│   └── test_api.py          # 17 Unit test otomatis (FastAPI, SQLite, Gempa, & Banjir)
├── test_client.py           # Script simulasi client WebSocket data dummy
├── requirements.txt         # Daftar dependensi resmi Python
└── README.md                # Dokumentasi panduan lengkap
```

---

## 💻 Panduan Instalasi (Installation)

### 1. Prasyarat Sistem
- **Python**: Versi 3.10 atau yang lebih baru.
- **Sistem Operasi**: Windows, macOS, atau Linux.
- **Koneksi Jaringan**: Seluruh perangkat (PC server, HP, dan Laptop) harus terhubung pada **jaringan Wi-Fi / Hotspot lokal yang sama**.

### 2. Kloning / Buka Direktori Project
Buka PowerShell atau Terminal di direktori project:
```powershell
cd c:\Users\Lenovo\Documents\earthquake-detection
```

### 3. Buat dan Aktifkan Virtual Environment
```powershell
# Membuat virtual environment
python -m venv venv

# Mengaktifkan di Windows PowerShell:
.\venv\Scripts\Activate.ps1

# (Jika di Command Prompt):
# .\venv\Scripts\activate.bat

# (Jika di Linux / macOS):
# source venv/bin/activate
```

### 4. Instalasi Dependensi
Instal seluruh paket yang tertera di `requirements.txt`:
```powershell
pip install -r requirements.txt
```

### 5. Verifikasi Pengujian (Unit Tests)
Jalankan test suite untuk memastikan seluruh sistem siap tanpa kendala:
```powershell
.\venv\Scripts\python.exe -m pytest -q
```
*Pastikan seluruh **17 tests passed**.*

---

## 🚀 Cara Menjalankan Server

1. **Jalankan Uvicorn FastAPI Server pada Host `0.0.0.0`**:
   ```powershell
   uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. **Ketahui Alamat IP PC Server Anda**:
   Buka terminal PowerShell baru dan jalankan:
   ```powershell
   ipconfig
   ```
   Cari alamat **IPv4 Address** pada adaptor Wi-Fi yang aktif (misalnya: `192.168.43.17`).

---

## 📱 Skenario Demo 3 Device (HP, PC, Laptop)

Untuk demonstrasi presentasi laboratorium, gunakan skema berikut:

### Peran Device:
* **DEVICE 1 (PC)**: Menjalankan Server FastAPI (`uvicorn`) sebagai pusat analisis data dan pemantauan log terminal.
* **DEVICE 2 (LAPTOP / HP USER)**: Sebagai **Penerima Peringatan** (`http://192.168.43.17:8000/user`).
* **DEVICE 3 (HP ANDROID)**: Sebagai **Sensor Lapangan** (Gempa di `/sensor` atau Banjir di `/flood`).

---

### Langkah Pengujian 1: Simulasi Deteksi Getaran Gempa

1. **Persiapan Device Penerima (Laptop / HP User)**:
   - Buka browser: `http://192.168.43.17:8000/user`
   - Sistem akan **otomatis terhubung (CONNECTED)**.
   - Klik tombol **🔔 AKTIFKAN PERINGATAN (ARM SYSTEM)**.
2. **Persiapan HP Sensor Gempa**:
   - Buka di HP Android: `http://192.168.43.17:8000/sensor`
   - Klik **HUBUNGKAN WEBSOCKET** lalu klik **AKTIFKAN SENSOR**.
3. **Simulasi Anomali Getaran**:
   - Goyangkan HP Sensor dengan kuat atau ketuk meja di dekat HP.
   - Status sensor di HP berubah menjadi `ANOMALY_VIBRATION`.
4. **Hasil pada Device User**:
   - Seketika muncul **Layar Penuh Darurat Merah: "WARNING GEMPA - ANOMALI GETARAN TERDETEKSI"**.
   - Bunyi **sirine darurat berulang**.
   - HP bergetar secara berkala.
   - Terminal VS Code di PC mencatat banner log anomali getaran.

---

### Langkah Pengujian 2: Simulasi Deteksi Kenaikan Air Banjir

1. **Buka Virtual Sensor Banjir**:
   - Buka browser di HP atau tab PC lain: `http://192.168.43.17:8000/flood`
2. **Jalankan Mode Auto Simulation**:
   - Klik tombol **▶ START AUTO SIMULATION**.
   - Sensor virtual akan mengirim kenaikan air otomatis: 20cm → 25cm → 31cm → 50cm → 80cm secara bertahap (~1 detik per interval).
3. **Hasil pada Device User & Server**:
   - **Tingkat Waspada (31 cm)**: Layar User memunculkan status kuning **"PERINGATAN BANJIR (FLOOD WARNING)"**.
   - **Tingkat Siaga (50 cm)**: Terekspansi langsung menjadi status oranye **"SIAGA BANJIR (FLOOD ALERT)"**.
   - **Tingkat Kritis (80 cm)**: Terekspansi menjadi layar merah darurat **"BAHAYA BANJIR KRITIS (FLOOD CRITICAL)"** diiringi **sirine nada tinggi 1250 Hz (Square Wave) yang sangat nyaring**!
   - Terminal VS Code menampilkan rincian kenaikan muka air dan status bahaya.

---

## 🔔 Fitur Unggulan Mobile & Background Notifications

1. **Heads-up Floating Notification (PWA & Service Worker)**:
   - Dilengkapi `sw.js` dan `manifest.json`.
   - Jika HP User sedang berada di home screen atau membuka aplikasi lain, Android akan memunculkan spanduk notifikasi darurat melayang di atas layar.
   - Menyentuh notifikasi tersebut akan langsung membuka browser dan memunculkan tampilan layar penuh peringatan seketika.
2. **Screen Wake Lock API**:
   - Saat tombol **ARM SYSTEM** diaktifkan, layar HP dicegah mati/sleep otomatis agar perangkat siap dijadikan layar monitor peringatan darurat 24/7 di atas meja.
3. **Priority Escalation Cooldown Engine**:
   - Mencegah spam notifikasi berulang jika kondisi stabil.
   - Namun jika tingkat keparahan meningkat (misal: dari *Warning* naik ke *Critical*), sistem akan **langsung membroadcast alert seketika tanpa tertahan cooldown**.

---

## 📊 Daftar Endpoint API & WebSocket

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/` | Status online server |
| `GET` | `/health` | Health check endpoint |
| `GET` | `/sensor` | Antarmuka web sensor accelerometer HP Android |
| `GET` | `/flood` | Antarmuka web virtual sensor & simulasi banjir |
| `GET` | `/user` | Dashboard web penerima peringatan dini darurat |
| `GET` | `/api/alerts` | Mengambil riwayat alert terbaru dari database SQLite |
| `POST` | `/api/sensor` | Input data accelerometer gempa via REST API |
| `POST` | `/api/flood` | Input data ketinggian air banjir via REST API |
| `WS` | `/ws/sensor` | Kanal streaming realtime sensor accelerometer |
| `WS` | `/ws/user` | Kanal broadcast peringatan dini ke seluruh device user |

---

## 📜 Lisensi & Catatan Akademik
Proyek ini dikembangkan sebagai prototipe riset dan demonstrasi sistem informasi pemantauan bencana terpadu berbasis Internet of Things (IoT) dan Web Platform. Bebas digunakan dan dikembangkan untuk keperluan akademik, penelitian, dan edukasi kebencanaan.

