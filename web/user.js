/**
 * Earthquake Vibration Alert - User Client (Vanilla JS)
 *
 * Alur:
 * Server Python (FastAPI) -> WebSocket Broadcast (/ws/user) -> User Client HP
 * -> Fullscreen Warning Overlay + Audio Siren + Vibration
 */

(() => {
    "use strict";

    // -------------------------------------------------------------------------
    // 1. State Aplikasi
    // -------------------------------------------------------------------------
    const state = {
        ws: null,
        wsConnected: false,
        isArmed: false,
        isAlertActive: false,
        isMuted: false,
        audioCtx: null,
        alarmInterval: null,
        vibrationInterval: null,
        lastAlertTimeStr: "None",
    };

    // DOM Elements
    const dom = {
        sysBanner: document.getElementById("sysBanner"),
        sysBannerText: document.getElementById("sysBannerText"),
        userNotification: document.getElementById("userNotification"),
        userNotificationTitle: document.getElementById("userNotificationTitle"),
        userNotificationMsg: document.getElementById("userNotificationMsg"),
        userNotificationClose: document.getElementById("userNotificationClose"),

        // Config & Connection
        serverIp: document.getElementById("serverIp"),
        serverPort: document.getElementById("serverPort"),
        connectBtn: document.getElementById("connectBtn"),
        wsDot: document.getElementById("wsDot"),
        wsStatusText: document.getElementById("wsStatusText"),
        armDot: document.getElementById("armDot"),
        armStatusText: document.getElementById("armStatusText"),

        // Arming Controls
        armBtn: document.getElementById("armBtn"),
        testAlarmBtn: document.getElementById("testAlarmBtn"),
        vibrationSupportBadge: document.getElementById("vibrationSupportBadge"),
        audioSupportBadge: document.getElementById("audioSupportBadge"),

        // Dashboard Status
        dashServerVal: document.getElementById("dashServerVal"),
        dashConnVal: document.getElementById("dashConnVal"),
        dashArmVal: document.getElementById("dashArmVal"),
        dashLastAlertVal: document.getElementById("dashLastAlertVal"),

        // History
        refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
        alertsList: document.getElementById("alertsList"),

        // Fullscreen Alert Overlay
        alertOverlay: document.getElementById("alertOverlay"),
        alertSourceVal: document.getElementById("alertSourceVal"),
        alertTimeVal: document.getElementById("alertTimeVal"),
        alertParamsVal: document.getElementById("alertParamsVal"),
        muteAlarmBtn: document.getElementById("muteAlarmBtn"),
        dismissAlertBtn: document.getElementById("dismissAlertBtn"),
    };

    // -------------------------------------------------------------------------
    // 2. Inisialisasi & Feature Detection
    // -------------------------------------------------------------------------
    function initConnectionInputs() {
        const currentHost = window.location.hostname || "127.0.0.1";
        const currentPort = window.location.port || "8000";

        dom.serverIp.value = localStorage.getItem("seismic_user_server_ip") || currentHost;
        dom.serverPort.value = localStorage.getItem("seismic_user_server_port") || currentPort;
    }

    function checkDeviceCapabilities() {
        // Cek dukungan getaran (navigator.vibrate)
        if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
            dom.vibrationSupportBadge.textContent = "Vibration: SUPPORTED";
            dom.vibrationSupportBadge.style.color = "#34d399";
        } else {
            dom.vibrationSupportBadge.textContent = "Vibration: NOT SUPPORTED";
            dom.vibrationSupportBadge.style.color = "#94a3b8";
        }

        // Cek Web Audio API
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            dom.audioSupportBadge.textContent = "Web Audio: READY";
            dom.audioSupportBadge.style.color = "#34d399";
        } else {
            dom.audioSupportBadge.textContent = "Web Audio: NOT SUPPORTED";
            dom.audioSupportBadge.style.color = "#f87171";
        }
    }

    function showNotification(title, message) {
        dom.userNotificationTitle.textContent = title;
        dom.userNotificationMsg.textContent = message;
        dom.userNotification.style.display = "flex";
    }

    function hideNotification() {
        dom.userNotification.style.display = "none";
    }

    // -------------------------------------------------------------------------
    // 3. Audio & Vibration Engine (Web Audio API Synthesizer)
    // -------------------------------------------------------------------------
    function ensureAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        if (!state.audioCtx) {
            state.audioCtx = new AudioContextClass();
        }
        if (state.audioCtx.state === "suspended") {
            state.audioCtx.resume();
        }
        return state.audioCtx;
    }

    /**
     * Memainkan satu beep sirine darurat (frekuensi tinggi lalu rendah)
     */
    function playBeepTone(freq = 880, duration = 0.35) {
        const ctx = ensureAudioContext();
        if (!ctx) return;

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.75, ctx.currentTime + duration);

            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (err) {
            console.error("Gagal memutar audio tone:", err);
        }
    }

    function startAlarmSound() {
        if (state.isMuted) return;
        stopAlarmSound(); // bersihkan timer sebelumnya jika ada

        // Pola sirine: beep bernada ganda berulang setiap 700ms
        let step = 0;
        playBeepTone(880, 0.3);
        state.alarmInterval = setInterval(() => {
            if (state.isMuted) return;
            const freq = step % 2 === 0 ? 980 : 750;
            playBeepTone(freq, 0.32);
            step++;
        }, 360);
    }

    function stopAlarmSound() {
        if (state.alarmInterval) {
            clearInterval(state.alarmInterval);
            state.alarmInterval = null;
        }
    }

    function startVibration() {
        if (!("vibrate" in navigator)) return;
        stopVibration();

        try {
            // Pola getar berulang: 500ms getar, 200ms diam, 500ms getar, 200ms diam, 1000ms getar
            navigator.vibrate([500, 200, 500, 200, 1000]);
            state.vibrationInterval = setInterval(() => {
                navigator.vibrate([500, 200, 500, 200, 1000]);
            }, 2600);
        } catch (err) {
            console.warn("Gagal getar:", err);
        }
    }

    function stopVibration() {
        if (state.vibrationInterval) {
            clearInterval(state.vibrationInterval);
            state.vibrationInterval = null;
        }
        if ("vibrate" in navigator) {
            try {
                navigator.vibrate(0);
            } catch (err) {
                // ignore
            }
        }
    }

    // -------------------------------------------------------------------------
    // 4. WebSocket Manager
    // -------------------------------------------------------------------------
    function connectWebSocket() {
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            disconnectWebSocket();
            return;
        }

        const ip = dom.serverIp.value.trim();
        const port = dom.serverPort.value.trim();

        if (!ip || !port) {
            showNotification("Input Tidak Lengkap", "Silakan masukkan IP dan Port server.");
            return;
        }

        localStorage.setItem("seismic_user_server_ip", ip);
        localStorage.setItem("seismic_user_server_port", port);

        const wsUrl = `ws://${ip}:${port}/ws/user`;
        updateWsStatus("CONNECTING...", "connecting");
        dom.connectBtn.disabled = true;
        hideNotification();

        try {
            state.ws = new WebSocket(wsUrl);
        } catch (err) {
            updateWsStatus("ERROR", "disconnected");
            showNotification("Koneksi Gagal", `Gagal inisialisasi WebSocket: ${err.message}`);
            dom.connectBtn.disabled = false;
            return;
        }

        state.ws.onopen = () => {
            state.wsConnected = true;
            updateWsStatus("CONNECTED", "connected");
            dom.dashConnVal.textContent = "CONNECTED";
            dom.dashConnVal.className = "dash-val val-green";
            dom.connectBtn.textContent = "PUTUSKAN KONEKSI";
            dom.connectBtn.classList.remove("btn-primary");
            dom.connectBtn.classList.add("btn-danger");
            dom.connectBtn.disabled = false;

            // Muat riwayat alert dari database
            fetchRecentAlerts();
        };

        state.ws.onmessage = (event) => {
            handleServerMessage(event.data);
        };

        state.ws.onerror = (err) => {
            console.error("User WebSocket Error:", err);
            showNotification(
                "WebSocket Terputus",
                `Tidak dapat terhubung ke ${wsUrl}. Pastikan server aktif dan HP terhubung ke Wi-Fi yang sama.`
            );
        };

        state.ws.onclose = () => {
            state.wsConnected = false;
            updateWsStatus("DISCONNECTED", "disconnected");
            dom.dashConnVal.textContent = "DISCONNECTED";
            dom.dashConnVal.className = "dash-val val-muted";
            dom.connectBtn.textContent = "HUBUNGKAN KE SERVER";
            dom.connectBtn.classList.remove("btn-danger");
            dom.connectBtn.classList.add("btn-primary");
            dom.connectBtn.disabled = false;
        };
    }

    function disconnectWebSocket() {
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
    // 5. Server Alert Dispatcher
    // -------------------------------------------------------------------------
    function handleServerMessage(rawText) {
        try {
            const data = JSON.parse(rawText);

            if (data.type === "CONNECTION_ESTABLISHED") {
                console.log("Server Handshake:", data.message);
                return;
            }

            // Menerima Event Broadcast Alert dari Server
            if (data.type === "EARTHQUAKE_ALERT" && data.status === "ANOMALY_VIBRATION") {
                triggerEmergencyWarning(data);
            }
        } catch (err) {
            console.error("Gagal parse pesan WebSocket:", err, rawText);
        }
    }

    /**
     * Menampilkan Fullscreen Emergency Warning Overlay dan memicu alarm
     */
    function triggerEmergencyWarning(data) {
        state.isAlertActive = true;
        state.isMuted = false;

        const dateObj = data.timestamp ? new Date(data.timestamp * 1000) : new Date();
        const timeStr = dateObj.toLocaleTimeString();
        state.lastAlertTimeStr = timeStr;

        // Update dashboard status
        dom.dashLastAlertVal.textContent = timeStr;
        dom.dashLastAlertVal.className = "dash-val val-green";

        // Update isi overlay
        dom.alertSourceVal.textContent = data.source_device || "Unknown";
        dom.alertTimeVal.textContent = timeStr;
        dom.alertParamsVal.textContent = `RMS: ${(data.rms || 0).toFixed(4)} m/s² | Peak: ${(data.peak || 0).toFixed(4)} m/s²`;

        // Tampilkan fullscreen warning overlay
        dom.alertOverlay.style.display = "flex";
        dom.muteAlarmBtn.textContent = "🔇 MATIKAN SUARA";

        // Bunyikan audio & aktifkan getaran jika sistem di-ARMED
        if (state.isArmed) {
            startAlarmSound();
            startVibration();
        } else {
            console.log("Alert diterima namun sistem belum di-ARMED. Audio diabaikan.");
        }

        // Segera refresh daftar histori
        fetchRecentAlerts();
    }

    // -------------------------------------------------------------------------
    // 6. Action Handlers (Mute, Dismiss, Arming)
    // -------------------------------------------------------------------------
    function armAlertSystem() {
        ensureAudioContext();
        state.isArmed = true;

        dom.armDot.className = "dot armed";
        dom.armStatusText.textContent = "ARMED";
        dom.dashArmVal.textContent = "ARMED";
        dom.dashArmVal.className = "dash-val val-green";

        dom.sysBanner.className = "status-banner status-waiting";
        dom.sysBannerText.textContent = "SYSTEM ARMED (MONITORING)";

        dom.armBtn.textContent = "✓ SISTEM PERINGATAN AKTIF (ARMED)";
        dom.armBtn.classList.remove("btn-success");
        dom.armBtn.classList.add("btn-secondary");

        showNotification(
            "Sistem Peringatan Aktif",
            "Audio context & getaran telah diizinkan. Perangkat Anda siap berbunyi saat getaran terdeteksi."
        );
    }

    function muteAlarm() {
        state.isMuted = true;
        stopAlarmSound();
        dom.muteAlarmBtn.textContent = "✓ SUARA DIMATIKAN";
    }

    function dismissAlert() {
        stopAlarmSound();
        stopVibration();
        state.isAlertActive = false;
        state.isMuted = false;

        dom.alertOverlay.style.display = "none";

        // Sistem tetap terhubung dan kembali ARMED untuk alert selanjutnya
        if (state.isArmed) {
            dom.sysBannerText.textContent = "SYSTEM ARMED (MONITORING)";
        }
    }

    function testAlarmPreview() {
        armAlertSystem();
        const dummyData = {
            type: "EARTHQUAKE_ALERT",
            status: "ANOMALY_VIBRATION",
            source_device: "android-test-node",
            timestamp: Date.now() / 1000,
            rms: 0.8421,
            peak: 1.4258,
        };
        triggerEmergencyWarning(dummyData);
    }

    // -------------------------------------------------------------------------
    // 7. Recent Alerts Fetcher (GET /api/alerts)
    // -------------------------------------------------------------------------
    async function fetchRecentAlerts() {
        const ip = dom.serverIp.value.trim() || window.location.hostname || "127.0.0.1";
        const port = dom.serverPort.value.trim() || window.location.port || "8000";

        try {
            const resp = await fetch(`http://${ip}:${port}/api/alerts`);
            if (!resp.ok) return;

            const json = await resp.json();
            const alerts = json.alerts || [];

            if (alerts.length === 0) {
                dom.alertsList.innerHTML = `<div class="history-empty">Belum ada riwayat anomali getaran tercatat.</div>`;
                return;
            }

            dom.alertsList.innerHTML = "";
            alerts.forEach((alt) => {
                const dateObj = new Date(alt.timestamp * 1000);
                const timeStr = dateObj.toLocaleTimeString();

                const item = document.createElement("div");
                item.className = "history-item";
                item.innerHTML = `
                    <div class="history-item-top">
                        <span class="history-item-title">⚠️ ${alt.message || "Anomali Getaran"}</span>
                        <span class="history-item-time">${timeStr}</span>
                    </div>
                    <div class="history-item-sub">
                        Source: <strong>${alt.source_device}</strong> | RMS: ${Number(alt.rms).toFixed(4)} | Peak: ${Number(alt.peak).toFixed(4)}
                    </div>
                `;
                dom.alertsList.appendChild(item);
            });
        } catch (err) {
            console.warn("Gagal memuat histori alert:", err);
        }
    }

    // -------------------------------------------------------------------------
    // 8. Event Listeners & Bootstrapping
    // -------------------------------------------------------------------------
    dom.connectBtn.addEventListener("click", connectWebSocket);
    dom.armBtn.addEventListener("click", armAlertSystem);
    dom.testAlarmBtn.addEventListener("click", testAlarmPreview);
    dom.muteAlarmBtn.addEventListener("click", muteAlarm);
    dom.dismissAlertBtn.addEventListener("click", dismissAlert);
    dom.refreshHistoryBtn.addEventListener("click", fetchRecentAlerts);
    dom.userNotificationClose.addEventListener("click", hideNotification);

    // Inisialisasi awal
    initConnectionInputs();
    checkDeviceCapabilities();
    fetchRecentAlerts();
})();
