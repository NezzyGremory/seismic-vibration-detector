/**
 * Earthquake Vibration Sensor - Prototype Client (Vanilla JS)
 *
 * Alur:
 * Android Accelerometer -> DeviceMotionEvent -> JSON Payload -> WebSocket -> FastAPI Server -> Response
 *
 * Catatan Ilmiah:
 * - acceleration: Percepatan linier (tanpa gravitasi, jika didukung OS).
 * - accelerationIncludingGravity: Mengandung komponen gravitasi bumi (~9.8 m/s^2).
 *   Server FastAPI akan melakukan preprocessing (remove offset/DC component) untuk
 *   menghilangkan pengaruh gravitasi pada sliding window.
 * - Prototype ini BUKAN seismometer profesional dan TIDAK untuk prediksi gempa.
 */

(() => {
    "use strict";

    // -------------------------------------------------------------------------
    // 1. Inisialisasi State & Elemen DOM
    // -------------------------------------------------------------------------
    const state = {
        deviceId: "",
        ws: null,
        wsConnected: false,
        sensorActive: false,
        sensorMode: "Unknown",
        sampleCount: 0,
        sampleCountWindow: 0,
        currentSamplingRate: 0.0,
        lastSampleTimestamp: 0,
        targetIntervalMs: 33, // ~30 samples/second (30 Hz)
        lastSendTime: 0,
        recentLatencyMs: null,
        // Buffer untuk sliding window visualisasi canvas (150 sampel)
        waveBuffer: [],
        maxWaveSamples: 150,
        animFrameId: null,
    };

    // DOM Elements
    const dom = {
        // Status & Alerts
        statusBanner: document.getElementById("statusBanner"),
        statusBannerText: document.getElementById("statusBannerText"),
        errorAlert: document.getElementById("errorAlert"),
        alertTitle: document.getElementById("alertTitle"),
        alertMessage: document.getElementById("alertMessage"),
        alertCloseBtn: document.getElementById("alertCloseBtn"),

        // Config & Connection
        serverIp: document.getElementById("serverIp"),
        serverPort: document.getElementById("serverPort"),
        deviceIdDisplay: document.getElementById("deviceIdDisplay"),
        regenIdBtn: document.getElementById("regenIdBtn"),
        connectBtn: document.getElementById("connectBtn"),
        wsDot: document.getElementById("wsDot"),
        wsStatusText: document.getElementById("wsStatusText"),
        sensorDot: document.getElementById("sensorDot"),
        sensorStatusText: document.getElementById("sensorStatusText"),

        // Sensor Controls
        sensorModeBadge: document.getElementById("sensorModeBadge"),
        sensorToggleBtn: document.getElementById("sensorToggleBtn"),

        // Live Acceleration Display
        accelX: document.getElementById("accelX"),
        accelY: document.getElementById("accelY"),
        accelZ: document.getElementById("accelZ"),

        // Server Analysis Results
        serverStatusVal: document.getElementById("serverStatusVal"),
        serverRmsVal: document.getElementById("serverRmsVal"),
        serverPeakVal: document.getElementById("serverPeakVal"),
        serverMagVal: document.getElementById("serverMagVal"),
        windowSamplesVal: document.getElementById("windowSamplesVal"),
        windowReadyVal: document.getElementById("windowReadyVal"),

        // Streaming Stats
        sampleCountVal: document.getElementById("sampleCountVal"),
        sampleRateVal: document.getElementById("sampleRateVal"),

        // Debug Panel
        toggleDebugBtn: document.getElementById("toggleDebugBtn"),
        debugPanel: document.getElementById("debugPanel"),
        dbgWsUrl: document.getElementById("dbgWsUrl"),
        dbgMotionSupport: document.getElementById("dbgMotionSupport"),
        dbgSensorMode: document.getElementById("dbgSensorMode"),
        dbgLatency: document.getElementById("dbgLatency"),
        dbgLastReceived: document.getElementById("dbgLastReceived"),

        // Canvas
        canvas: document.getElementById("waveformCanvas"),
    };

    const ctx = dom.canvas.getContext("2d");

    // -------------------------------------------------------------------------
    // 2. Helper & Device ID Management
    // -------------------------------------------------------------------------
    function generateDeviceId() {
        const rand = Math.random().toString(36).substring(2, 8);
        return `android-${rand}`;
    }

    function initDeviceId() {
        let savedId = localStorage.getItem("seismic_device_id");
        if (!savedId) {
            savedId = generateDeviceId();
            localStorage.setItem("seismic_device_id", savedId);
        }
        state.deviceId = savedId;
        dom.deviceIdDisplay.textContent = savedId;
    }

    function initConnectionInputs() {
        // Auto-detect host IP dari URL browser
        const currentHost = window.location.hostname || "127.0.0.1";
        const currentPort = window.location.port || "8000";

        const savedIp = localStorage.getItem("seismic_server_ip") || currentHost;
        const savedPort = localStorage.getItem("seismic_server_port") || currentPort;

        dom.serverIp.value = savedIp;
        dom.serverPort.value = savedPort;
    }

    function showAlert(title, message) {
        dom.alertTitle.textContent = title;
        dom.alertMessage.textContent = message;
        dom.errorAlert.style.display = "flex";
    }

    function hideAlert() {
        dom.errorAlert.style.display = "none";
    }

    // -------------------------------------------------------------------------
    // 3. WebSocket Manager
    // -------------------------------------------------------------------------
    function connectWebSocket() {
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            disconnectWebSocket();
            return;
        }

        const ip = dom.serverIp.value.trim();
        const port = dom.serverPort.value.trim();

        if (!ip || !port) {
            showAlert("Input Tidak Lengkap", "Silakan masukkan IP dan Port server.");
            return;
        }

        localStorage.setItem("seismic_server_ip", ip);
        localStorage.setItem("seismic_server_port", port);

        const wsUrl = `ws://${ip}:${port}/ws/sensor`;
        dom.dbgWsUrl.textContent = wsUrl;

        updateWsStatus("CONNECTING...", "connecting");
        dom.connectBtn.disabled = true;
        hideAlert();

        try {
            state.ws = new WebSocket(wsUrl);
        } catch (err) {
            updateWsStatus("ERROR", "disconnected");
            showAlert("Koneksi Gagal", `Gagal menginisialisasi WebSocket ke ${wsUrl}: ${err.message}`);
            dom.connectBtn.disabled = false;
            return;
        }

        state.ws.onopen = () => {
            state.wsConnected = true;
            updateWsStatus("CONNECTED", "connected");
            dom.connectBtn.textContent = "PUTUSKAN WEBSOCKET";
            dom.connectBtn.classList.remove("btn-primary");
            dom.connectBtn.classList.add("btn-danger");
            dom.connectBtn.disabled = false;
            dom.sensorToggleBtn.disabled = false;
        };

        state.ws.onmessage = (event) => {
            handleServerMessage(event.data);
        };

        state.ws.onerror = (err) => {
            console.error("WebSocket Error:", err);
            showAlert(
                "WebSocket Error",
                `Tidak dapat terhubung ke ${wsUrl}. Pastikan server berjalan dan HP berada di jaringan Wi-Fi yang sama.`
            );
        };

        state.ws.onclose = () => {
            state.wsConnected = false;
            updateWsStatus("DISCONNECTED", "disconnected");
            dom.connectBtn.textContent = "HUBUNGKAN WEBSOCKET";
            dom.connectBtn.classList.remove("btn-danger");
            dom.connectBtn.classList.add("btn-primary");
            dom.connectBtn.disabled = false;

            if (state.sensorActive) {
                stopSensor();
            }
            dom.sensorToggleBtn.disabled = true;
        };
    }

    function disconnectWebSocket() {
        if (state.sensorActive) {
            stopSensor();
        }
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        state.wsConnected = false;
        updateWsStatus("DISCONNECTED", "disconnected");
    }

    function updateWsStatus(text, statusClass) {
        dom.wsStatusText.textContent = text;
        dom.wsDot.className = `dot ${statusClass}`;
    }

    // -------------------------------------------------------------------------
    // 4. Server Message Handler (Response FastAPI)
    // -------------------------------------------------------------------------
    function handleServerMessage(rawText) {
        try {
            const res = JSON.parse(rawText);

            if (state.lastSendTime > 0) {
                const latency = Math.round(performance.now() - state.lastSendTime);
                dom.dbgLatency.textContent = `${latency} ms`;
            }
            dom.dbgLastReceived.textContent = new Date().toLocaleTimeString();

            if (!res.success) {
                console.warn("Server warning:", res.error || res.details);
                return;
            }

            // Update UI hasil analisis dari server
            dom.serverMagVal.textContent = `${Number(res.magnitude).toFixed(4)} m/s²`;
            dom.serverRmsVal.textContent = `${Number(res.rms).toFixed(4)} m/s²`;
            dom.serverPeakVal.textContent = `${Number(res.peak).toFixed(4)} m/s²`;
            dom.windowSamplesVal.textContent = res.window_samples;
            dom.windowReadyVal.textContent = res.window_ready ? "YA (Buffer Siap)" : "MENUNGGU BUFFER";

            // Status Getaran: NORMAL atau ANOMALY_VIBRATION
            // PENTING: Jangan tampilkan "EARTHQUAKE DETECTED"
            if (res.status === "ANOMALY_VIBRATION") {
                dom.statusBanner.className = "status-banner status-anomaly";
                dom.statusBannerText.textContent = "ANOMALY VIBRATION";
                dom.serverStatusVal.className = "metric-value status-text-anomaly";
                dom.serverStatusVal.textContent = "ANOMALY VIBRATION";
            } else {
                dom.statusBanner.className = "status-banner status-normal";
                dom.statusBannerText.textContent = "NORMAL";
                dom.serverStatusVal.className = "metric-value status-text-normal";
                dom.serverStatusVal.textContent = "NORMAL";
            }
        } catch (err) {
            console.error("Gagal parse response server:", err, rawText);
        }
    }

    // -------------------------------------------------------------------------
    // 5. Sensor Handling (DeviceMotionEvent)
    // -------------------------------------------------------------------------
    async function toggleSensor() {
        if (state.sensorActive) {
            stopSensor();
        } else {
            await startSensor();
        }
    }

    async function startSensor() {
        if (!state.wsConnected) {
            showAlert("WebSocket Belum Terhubung", "Harap hubungkan WebSocket terlebih dahulu.");
            return;
        }

        // Cek dukungan DeviceMotionEvent
        if (!window.DeviceMotionEvent) {
            dom.dbgMotionSupport.textContent = "TIDAK DIDUKUNG / DIBLOKIR HTTP";
            const isHttp = window.location.protocol === "http:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
            if (isHttp) {
                showAlert(
                    "Sensor Diblokir Browser (Wajib HTTPS / Flags)",
                    "Google Chrome Android memblokir sensor pada HTTP lokal. Solusi termudah: 1) Di Chrome buka chrome://flags, cari 'Insecure origins treated as secure', Enable dan isi http://" + window.location.host + ", lalu Relaunch; ATAU 2) Buka web ini menggunakan browser Firefox Android."
                );
            } else {
                showAlert(
                    "Sensor Tidak Didukung",
                    "Browser atau perangkat ini tidak mendukung DeviceMotionEvent API."
                );
            }
            return;
        }
        dom.dbgMotionSupport.textContent = "DIDUKUNG";

        // iOS 13+ / browser modern dengan permission request
        if (typeof DeviceMotionEvent.requestPermission === "function") {
            try {
                const permissionState = await DeviceMotionEvent.requestPermission();
                if (permissionState !== "granted") {
                    showAlert(
                        "Izin Sensor Ditolak",
                        "Sensor permission denied. Please allow motion sensor access in your browser."
                    );
                    return;
                }
            } catch (err) {
                showAlert(
                    "Error Izin Sensor",
                    `Gagal meminta izin sensor: ${err.message}`
                );
                return;
            }
        }

        window.addEventListener("devicemotion", handleMotionEvent, { passive: true });
        state.sensorActive = true;
        dom.sensorDot.className = "dot active";
        dom.sensorStatusText.textContent = "ACTIVE";
        dom.sensorToggleBtn.textContent = "HENTIKAN SENSOR";
        dom.sensorToggleBtn.classList.remove("btn-success");
        dom.sensorToggleBtn.classList.add("btn-danger");
        hideAlert();

        // Safety timeout: jika dalam 2.5 detik belum ada data masuk sama sekali
        setTimeout(() => {
            if (state.sensorActive && state.sampleCount === 0) {
                showAlert(
                    "Sensor Tidak Merespons",
                    "Tidak ada data gerak diterima. Pastikan sensor HP aktif dan browser tidak memblokir sensor (beberapa browser mewajibkan HTTPS untuk akses sensor di luar localhost)."
                );
            }
        }, 2500);
    }

    function stopSensor() {
        window.removeEventListener("devicemotion", handleMotionEvent);
        state.sensorActive = false;
        dom.sensorDot.className = "dot inactive";
        dom.sensorStatusText.textContent = "INACTIVE";
        dom.sensorToggleBtn.textContent = "AKTIFKAN SENSOR";
        dom.sensorToggleBtn.classList.remove("btn-danger");
        dom.sensorToggleBtn.classList.add("btn-success");
    }

    /**
     * Handler event DeviceMotionEvent
     *
     * Prioritas:
     * 1. event.acceleration (linier tanpa gravitasi)
     * 2. event.accelerationIncludingGravity (mengandung gravitasi ~9.8 m/s^2)
     */
    function handleMotionEvent(event) {
        const now = performance.now();

        // Throttle agar sampling rate stabil (~30 Hz)
        if (now - state.lastSampleTimestamp < state.targetIntervalMs) {
            return;
        }
        state.lastSampleTimestamp = now;

        let x = null;
        let y = null;
        let z = null;
        let mode = "";

        // 1. Prioritaskan acceleration jika tersedia dan memiliki data valid
        if (
            event.acceleration &&
            event.acceleration.x !== null &&
            !isNaN(event.acceleration.x)
        ) {
            x = event.acceleration.x;
            y = event.acceleration.y;
            z = event.acceleration.z;
            mode = "acceleration (Linear)";
        }
        // 2. Fallback ke accelerationIncludingGravity jika linear tidak ada
        // Catatan: accelerationIncludingGravity mengandung gravitasi bumi (~9.8 m/s^2).
        // Server FastAPI melakukan preprocessing untuk membuang rata-rata (DC offset/gravity)
        // pada sliding window, sehingga aman digunakan.
        else if (
            event.accelerationIncludingGravity &&
            event.accelerationIncludingGravity.x !== null &&
            !isNaN(event.accelerationIncludingGravity.x)
        ) {
            x = event.accelerationIncludingGravity.x;
            y = event.accelerationIncludingGravity.y;
            z = event.accelerationIncludingGravity.z;
            mode = "accelerationIncludingGravity (With Gravity)";
        } else {
            // Data sensor null / belum siap
            return;
        }

        // Validasi angka tidak NaN atau null
        if (x === null || y === null || z === null || isNaN(x) || isNaN(y) || isNaN(z)) {
            return;
        }

        if (state.sensorMode !== mode) {
            state.sensorMode = mode;
            dom.sensorModeBadge.textContent = mode;
            dom.dbgSensorMode.textContent = mode;
        }

        // Tampilkan nilai di UI
        dom.accelX.textContent = (x >= 0 ? "+" : "") + x.toFixed(3);
        dom.accelY.textContent = (y >= 0 ? "+" : "") + y.toFixed(3);
        dom.accelZ.textContent = (z >= 0 ? "+" : "") + z.toFixed(3);

        // Tambahkan ke wave buffer untuk visualisasi
        addWaveSample(x, y, z);

        // Kirim via WebSocket ke FastAPI jika koneksi terbuka
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            const timestampSeconds = Date.now() / 1000.0;
            const payload = {
                device_id: state.deviceId,
                timestamp: timestampSeconds,
                x: Number(x.toFixed(4)),
                y: Number(y.toFixed(4)),
                z: Number(z.toFixed(4)),
            };

            state.lastSendTime = performance.now();
            state.ws.send(JSON.stringify(payload));

            state.sampleCount++;
            state.sampleCountWindow++;
            dom.sampleCountVal.textContent = state.sampleCount.toLocaleString();
        }
    }

    // -------------------------------------------------------------------------
    // 6. Sampling Rate Calculation (Setiap 1 detik)
    // -------------------------------------------------------------------------
    setInterval(() => {
        state.currentSamplingRate = state.sampleCountWindow;
        dom.sampleRateVal.textContent = `${state.currentSamplingRate.toFixed(1)} Hz`;
        state.sampleCountWindow = 0;
    }, 1000);

    // -------------------------------------------------------------------------
    // 7. Visualisasi Waveform Canvas (Vanilla HTML Canvas)
    // -------------------------------------------------------------------------
    function addWaveSample(x, y, z) {
        state.waveBuffer.push({ x, y, z });
        if (state.waveBuffer.length > state.maxWaveSamples) {
            state.waveBuffer.shift();
        }
    }

    function resizeCanvas() {
        const rect = dom.canvas.parentElement.getBoundingClientRect();
        dom.canvas.width = rect.width * (window.devicePixelRatio || 1);
        dom.canvas.height = 180 * (window.devicePixelRatio || 1);
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }

    function renderWaveform() {
        const width = dom.canvas.parentElement.clientWidth;
        const height = 180;
        const midY = height / 2;

        ctx.clearRect(0, 0, width, height);

        // Garis Grid & Nol Baseline
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 1;

        // Grid horizontal
        ctx.beginPath();
        ctx.moveTo(0, midY - 40);
        ctx.lineTo(width, midY - 40);
        ctx.moveTo(0, midY + 40);
        ctx.lineTo(width, midY + 40);
        ctx.stroke();

        // Baseline Nol
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        const buffer = state.waveBuffer;
        const n = buffer.length;

        if (n >= 2) {
            const stepX = width / (state.maxWaveSamples - 1);
            const scaleY = 6.0; // Faktor amplifikasi visual

            // Gambar Sumbu X (Merah / Coral)
            drawAxisLine(buffer, (s) => s.x, "#f87171", width, midY, stepX, scaleY);

            // Gambar Sumbu Y (Hijau / Emerald)
            drawAxisLine(buffer, (s) => s.y, "#34d399", width, midY, stepX, scaleY);

            // Gambar Sumbu Z (Biru / Cyan)
            // Kurangi ~9.8 jika mode with-gravity agar tampil di sekitar garis tengah
            const isGrav = state.sensorMode.includes("Gravity");
            drawAxisLine(
                buffer,
                (s) => (isGrav ? s.z - 9.8 : s.z),
                "#38bdf8",
                width,
                midY,
                stepX,
                scaleY
            );
        }

        state.animFrameId = requestAnimationFrame(renderWaveform);
    }

    function drawAxisLine(buffer, selector, color, totalWidth, midY, stepX, scaleY) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        const offsetStart = state.maxWaveSamples - buffer.length;

        for (let i = 0; i < buffer.length; i++) {
            const px = (offsetStart + i) * stepX;
            const val = selector(buffer[i]);
            const py = midY - val * scaleY;

            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }

    // -------------------------------------------------------------------------
    // 8. Event Listeners & Bootstrapping
    // -------------------------------------------------------------------------
    dom.connectBtn.addEventListener("click", connectWebSocket);
    dom.sensorToggleBtn.addEventListener("click", toggleSensor);

    dom.regenIdBtn.addEventListener("click", () => {
        if (state.sensorActive) {
            showAlert("Perhatian", "Hentikan sensor terlebih dahulu sebelum mengubah Device ID.");
            return;
        }
        const newId = generateDeviceId();
        state.deviceId = newId;
        localStorage.setItem("seismic_device_id", newId);
        dom.deviceIdDisplay.textContent = newId;
    });

    dom.alertCloseBtn.addEventListener("click", hideAlert);

    dom.toggleDebugBtn.addEventListener("click", () => {
        const isHidden = dom.debugPanel.style.display === "none";
        dom.debugPanel.style.display = isHidden ? "flex" : "none";
        dom.toggleDebugBtn.textContent = isHidden ? "Debug Panel ▲" : "Debug Panel ▼";
    });

    window.addEventListener("resize", () => {
        resizeCanvas();
    });

    // Inisialisasi awal
    initDeviceId();
    initConnectionInputs();
    resizeCanvas();
    renderWaveform();
})();
