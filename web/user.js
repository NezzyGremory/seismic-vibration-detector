/**
 * Disaster Monitoring Alert - User Client (Vanilla JS)
 *
 * Realtime Emergency Warning Receiver (Earthquake & Flood)
 * Alur:
 * Server Python (FastAPI) -> WebSocket Broadcast (/ws/user) -> User Client HP
 * -> Fullscreen Warning Overlay + Audio Siren + Vibration + System Notification
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
        reconnectTimer: null,
        wakeLockSentinel: null,
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
        dashQuakeVal: document.getElementById("dashQuakeVal"),
        dashFloodVal: document.getElementById("dashFloodVal"),

        // History
        refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
        alertsList: document.getElementById("alertsList"),

        // Fullscreen Alert Overlay
        alertOverlay: document.getElementById("alertOverlay"),
        overlayIcon: document.getElementById("overlayIcon"),
        overlayTitle: document.getElementById("overlayTitle"),
        overlaySubtitle: document.getElementById("overlaySubtitle"),
        overlayDesc: document.getElementById("overlayDesc"),
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

        // Daftarkan Service Worker untuk notifikasi sistem HP
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/web/sw.js").then((reg) => {
                console.log("Service Worker terdaftar:", reg.scope);
            }).catch((err) => {
                console.warn("Service Worker gagal didaftarkan:", err);
            });
        }
    }

    function showNotification(title, message) {
        if (dom.userNotificationTitle) dom.userNotificationTitle.textContent = title;
        if (dom.userNotificationMsg) dom.userNotificationMsg.textContent = message;
        if (dom.userNotification) dom.userNotification.style.display = "flex";
    }

    function hideNotification() {
        if (dom.userNotification) dom.userNotification.style.display = "none";
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

    function playBeepTone(freq = 880, duration = 0.35, waveType = "sawtooth", volume = 0.6) {
        const ctx = ensureAudioContext();
        if (!ctx) return;

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = waveType;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.8, ctx.currentTime + duration);

            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (err) {
            console.error("Gagal memutar audio tone:", err);
        }
    }

    function startAlarmSound(hazardType = "earthquake") {
        if (state.isMuted) return;
        stopAlarmSound();

        let step = 0;
        const isFlood = (hazardType === "FLOOD_ALERT" || hazardType === "flood");

        if (isFlood) {
            // SIRINE BANJIR NYARING (Frequency 1250Hz - 650Hz, Square Wave, Volume Maksimal 0.8)
            playBeepTone(1250, 0.35, "square", 0.8);
            state.alarmInterval = setInterval(() => {
                if (state.isMuted) return;
                const freq = step % 2 === 0 ? 1250 : 650;
                const wave = step % 2 === 0 ? "square" : "sawtooth";
                playBeepTone(freq, 0.35, wave, 0.8);
                step++;
            }, 280);
        } else {
            // SIRINE GEMPA (Frequency 980Hz - 750Hz, Sawtooth Wave)
            playBeepTone(880, 0.3, "sawtooth", 0.6);
            state.alarmInterval = setInterval(() => {
                if (state.isMuted) return;
                const freq = step % 2 === 0 ? 980 : 750;
                playBeepTone(freq, 0.32, "sawtooth", 0.6);
                step++;
            }, 360);
        }
    }

    function stopAlarmSound() {
        if (state.alarmInterval) {
            clearInterval(state.alarmInterval);
            state.alarmInterval = null;
        }
    }

    function requestNotificationPermission() {
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission().catch(() => {});
        }
    }

    async function triggerSystemNotification(title, body) {
        if (!("Notification" in window) || Notification.permission !== "granted") {
            return;
        }

        const options = {
            body: body,
            requireInteraction: true,
            vibrate: [1000, 300, 1000, 300, 1000],
            tag: "disaster-alert-notification",
            renotify: true,
        };

        // Di Android Chrome, Service Worker showNotification adalah metode standar yang diizinkan OS
        if ("serviceWorker" in navigator) {
            try {
                const reg = await navigator.serviceWorker.ready;
                if (reg && reg.showNotification) {
                    await reg.showNotification(title, options);
                    return;
                }
            } catch (swErr) {
                console.warn("ServiceWorker showNotification error:", swErr);
            }
        }

        // Fallback untuk desktop browser
        try {
            new Notification(title, options);
        } catch (err) {
            console.warn("Desktop Notification fallback error:", err);
        }
    }

    function startVibration() {
        if (!("vibrate" in navigator)) return;
        stopVibration();

        try {
            // Pola getar berulang: 1000ms getar, 300ms diam, 1000ms getar
            navigator.vibrate([1000, 300, 1000, 300, 1000]);
            state.vibrationInterval = setInterval(() => {
                try {
                    navigator.vibrate([1000, 300, 1000, 300, 1000]);
                } catch (e) {}
            }, 3000);
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
            } catch (err) {}
        }
    }

    // -------------------------------------------------------------------------
    // 4. WebSocket Manager (Auto-Connect & Auto-Reconnect)
    // -------------------------------------------------------------------------
    function connectWebSocket() {
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const ip = dom.serverIp.value.trim() || window.location.hostname || "127.0.0.1";
        const port = dom.serverPort.value.trim() || window.location.port || "8000";

        localStorage.setItem("seismic_user_server_ip", ip);
        localStorage.setItem("seismic_user_server_port", port);

        const wsUrl = `ws://${ip}:${port}/ws/user`;
        updateWsStatus("CONNECTING...", "connecting");
        if (dom.connectBtn) dom.connectBtn.disabled = true;

        try {
            state.ws = new WebSocket(wsUrl);
        } catch (err) {
            updateWsStatus("ERROR", "disconnected");
            if (dom.connectBtn) dom.connectBtn.disabled = false;
            scheduleReconnect();
            return;
        }

        state.ws.onopen = () => {
            state.wsConnected = true;
            if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
            updateWsStatus("CONNECTED", "connected");

            if (dom.dashConnVal) {
                dom.dashConnVal.textContent = "CONNECTED";
                dom.dashConnVal.className = "dash-val val-green";
            }
            if (dom.connectBtn) {
                dom.connectBtn.textContent = "PUTUSKAN KONEKSI";
                dom.connectBtn.classList.remove("btn-primary");
                dom.connectBtn.classList.add("btn-danger");
                dom.connectBtn.disabled = false;
            }

            fetchRecentAlerts();
        };

        state.ws.onmessage = (event) => {
            handleServerMessage(event.data);
        };

        state.ws.onerror = (err) => {
            console.warn("User WebSocket error, reconnecting...", err);
            scheduleReconnect();
        };

        state.ws.onclose = () => {
            state.wsConnected = false;
            updateWsStatus("DISCONNECTED", "disconnected");

            if (dom.dashConnVal) {
                dom.dashConnVal.textContent = "DISCONNECTED";
                dom.dashConnVal.className = "dash-val val-muted";
            }
            if (dom.connectBtn) {
                dom.connectBtn.textContent = "HUBUNGKAN KE SERVER";
                dom.connectBtn.classList.remove("btn-danger");
                dom.connectBtn.classList.add("btn-primary");
                dom.connectBtn.disabled = false;
            }

            scheduleReconnect();
        };
    }

    function scheduleReconnect() {
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(() => {
            if (!state.wsConnected) {
                console.log("Mencoba menghubungkan ulang WebSocket...");
                connectWebSocket();
            }
        }, 3000);
    }

    function disconnectWebSocket() {
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        state.wsConnected = false;
        updateWsStatus("DISCONNECTED", "disconnected");
    }

    function updateWsStatus(text, statusClass) {
        if (dom.wsStatusText) dom.wsStatusText.textContent = text;
        if (dom.wsDot) dom.wsDot.className = `dot ${statusClass}`;
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

            // Menerima Event Broadcast Alert dari Server (Gempa & Banjir)
            if (data.type === "EARTHQUAKE_ALERT" && data.status === "ANOMALY_VIBRATION") {
                triggerEmergencyWarning(data);
            } else if (data.type === "FLOOD_ALERT") {
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
        try {
            state.isAlertActive = true;
            state.isMuted = false;

            const dateObj = data.timestamp ? new Date(data.timestamp * 1000) : new Date();
            const timeStr = dateObj.toLocaleTimeString();
            state.lastAlertTimeStr = timeStr;

            // Customization per Hazard Type
            if (data.type === "FLOOD_ALERT") {
                if (dom.dashFloodVal) {
                    dom.dashFloodVal.textContent = data.status || "ALERT";
                    dom.dashFloodVal.className = "dash-val val-red";
                }

                if (data.status === "FLOOD_CRITICAL") {
                    if (dom.overlayIcon) dom.overlayIcon.textContent = "🚨";
                    if (dom.overlayTitle) dom.overlayTitle.textContent = "BAHAYA BANJIR KRITIS";
                    if (dom.overlaySubtitle) dom.overlaySubtitle.textContent = "FLOOD CRITICAL";
                } else if (data.status === "FLOOD_ALERT") {
                    if (dom.overlayIcon) dom.overlayIcon.textContent = "🌊";
                    if (dom.overlayTitle) dom.overlayTitle.textContent = "SIAGA BANJIR";
                    if (dom.overlaySubtitle) dom.overlaySubtitle.textContent = "FLOOD ALERT";
                } else {
                    if (dom.overlayIcon) dom.overlayIcon.textContent = "💧";
                    if (dom.overlayTitle) dom.overlayTitle.textContent = "PERINGATAN BANJIR";
                    if (dom.overlaySubtitle) dom.overlaySubtitle.textContent = "FLOOD WARNING";
                }

                if (dom.overlayDesc) dom.overlayDesc.textContent = data.message || "Potensi banjir terdeteksi oleh sensor.";
                if (dom.alertSourceVal) dom.alertSourceVal.textContent = data.source_device || "flood-node";
                if (dom.alertTimeVal) dom.alertTimeVal.textContent = timeStr;
                if (dom.alertParamsVal) dom.alertParamsVal.textContent = `Water Level: ${data.water_level} cm | Rise Rate: ${data.rate_of_rise} cm/h`;

            } else {
                // EARTHQUAKE_ALERT
                if (dom.dashQuakeVal) {
                    dom.dashQuakeVal.textContent = "ANOMALY";
                    dom.dashQuakeVal.className = "dash-val val-red";
                }

                if (dom.overlayIcon) dom.overlayIcon.textContent = "⚠️";
                if (dom.overlayTitle) dom.overlayTitle.textContent = "WARNING GEMPA";
                if (dom.overlaySubtitle) dom.overlaySubtitle.textContent = "ANOMALI GETARAN TERDETEKSI";
                if (dom.overlayDesc) dom.overlayDesc.textContent = data.message || "Indikasi getaran abnormal terdeteksi.";

                if (dom.alertSourceVal) dom.alertSourceVal.textContent = data.source_device || "Unknown";
                if (dom.alertTimeVal) dom.alertTimeVal.textContent = timeStr;
                if (dom.alertParamsVal) dom.alertParamsVal.textContent = `RMS: ${(data.rms || 0).toFixed(4)} m/s² | Peak: ${(data.peak || 0).toFixed(4)} m/s²`;
            }

            // TAMPILKAN OVERLAY LAYAR PENUH (Dual-method untuk keandalan maksimal di HP)
            if (dom.alertOverlay) {
                dom.alertOverlay.classList.add("active");
                dom.alertOverlay.style.display = "flex";
            }
            if (dom.muteAlarmBtn) dom.muteAlarmBtn.textContent = "🔇 MATIKAN SUARA";

            // Pemicu Notifikasi Sistem OS (Heads-up Notification di HP saat diminimize)
            const notifTitle = (data.type === "FLOOD_ALERT") ? `🚨 ${data.status || "PERINGATAN BANJIR"}` : "⚠️ WARNING GEMPA";
            const notifBody = data.message || "Anomali terdeteksi oleh sistem monitoring!";
            triggerSystemNotification(notifTitle, notifBody);

            // Bunyikan audio & aktifkan getaran jika sistem di-ARMED
            if (state.isArmed) {
                startAlarmSound(data.type);
                startVibration();
            } else {
                console.log("Alert diterima namun sistem belum di-ARMED. Audio/getaran standby.");
            }

            fetchRecentAlerts();
        } catch (err) {
            console.error("Error in triggerEmergencyWarning:", err);
            // Fallback penting: pastikan overlay tetap muncul
            if (dom.alertOverlay) {
                dom.alertOverlay.classList.add("active");
                dom.alertOverlay.style.display = "flex";
            }
        }
    }

    // -------------------------------------------------------------------------
    // 6. Action Handlers (Mute, Dismiss, Arming)
    // -------------------------------------------------------------------------
    function armAlertSystem() {
        ensureAudioContext();
        requestNotificationPermission();
        state.isArmed = true;

        // Auto-connect websocket jika belum terhubung
        if (!state.wsConnected) {
            connectWebSocket();
        }

        // Test getaran singkat
        if ("vibrate" in navigator) {
            try { navigator.vibrate(300); } catch (e) {}
        }

        // Screen Wake Lock (Mencegah layar HP mati/sleep otomatis saat monitoring)
        if ("wakeLock" in navigator && !state.wakeLockSentinel) {
            try {
                navigator.wakeLock.request("screen").then((sentinel) => {
                    state.wakeLockSentinel = sentinel;
                }).catch(() => {});
            } catch (e) {}
        }

        if (dom.armDot) dom.armDot.className = "dot armed";
        if (dom.armStatusText) dom.armStatusText.textContent = "ARMED";

        if (dom.sysBanner) dom.sysBanner.className = "status-banner status-waiting";
        if (dom.sysBannerText) dom.sysBannerText.textContent = "SYSTEM ARMED (MONITORING)";

        if (dom.armBtn) {
            dom.armBtn.textContent = "✓ SISTEM PERINGATAN AKTIF (ARMED)";
            dom.armBtn.classList.remove("btn-success");
            dom.armBtn.classList.add("btn-secondary");
        }

        showNotification(
            "Sistem Peringatan Aktif",
            "Audio, notifikasi OS, & getaran telah diizinkan. Perangkat siap berbunyi & bergetar saat anomali terdeteksi."
        );
    }

    function muteAlarm() {
        state.isMuted = true;
        stopAlarmSound();
        if (dom.muteAlarmBtn) dom.muteAlarmBtn.textContent = "✓ SUARA DIMATIKAN";
    }

    function dismissAlert() {
        stopAlarmSound();
        stopVibration();
        state.isAlertActive = false;
        state.isMuted = false;

        if (dom.alertOverlay) {
            dom.alertOverlay.classList.remove("active");
            dom.alertOverlay.style.display = "none";
        }

        if (state.isArmed && dom.sysBannerText) {
            dom.sysBannerText.textContent = "SYSTEM ARMED (MONITORING)";
        }
    }

    function testAlarmPreview() {
        armAlertSystem();
        const dummyData = {
            type: "FLOOD_ALERT",
            status: "FLOOD_CRITICAL",
            source_device: "flood-node-test",
            timestamp: Date.now() / 1000,
            water_level: 82.5,
            rate_of_rise: 6.2,
            rainfall: 35.0,
            message: "Ketinggian air berada pada level kritis",
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
                if (dom.alertsList) dom.alertsList.innerHTML = `<div class="history-empty">Belum ada riwayat anomali/peringatan tercatat.</div>`;
                return;
            }

            if (dom.alertsList) {
                dom.alertsList.innerHTML = "";
                alerts.forEach((alt) => {
                    const dateObj = new Date(alt.timestamp * 1000);
                    const timeStr = dateObj.toLocaleTimeString();

                    const item = document.createElement("div");
                    item.className = "history-item";
                    item.innerHTML = `
                        <div class="history-item-top">
                            <span class="history-item-title">⚠️ ${alt.message || "Anomali Terdeteksi"}</span>
                            <span class="history-item-time">${timeStr}</span>
                        </div>
                        <div class="history-item-sub">
                            Source: <strong>${alt.source_device}</strong> | Status: ${alt.status}
                        </div>
                    `;
                    dom.alertsList.appendChild(item);
                });
            }
        } catch (err) {
            console.warn("Gagal memuat histori alert:", err);
        }
    }

    // -------------------------------------------------------------------------
    // 8. Event Listeners & Bootstrapping
    // -------------------------------------------------------------------------
    if (dom.connectBtn) {
        dom.connectBtn.addEventListener("click", () => {
            if (state.wsConnected) {
                disconnectWebSocket();
            } else {
                connectWebSocket();
            }
        });
    }

    if (dom.armBtn) dom.armBtn.addEventListener("click", armAlertSystem);
    if (dom.testAlarmBtn) dom.testAlarmBtn.addEventListener("click", testAlarmPreview);
    if (dom.muteAlarmBtn) dom.muteAlarmBtn.addEventListener("click", muteAlarm);
    if (dom.dismissAlertBtn) dom.dismissAlertBtn.addEventListener("click", dismissAlert);
    if (dom.refreshHistoryBtn) dom.refreshHistoryBtn.addEventListener("click", fetchRecentAlerts);
    if (dom.userNotificationClose) dom.userNotificationClose.addEventListener("click", hideNotification);

    // Saat tab kembali dibuka setelah diminimize, pastikan overlay tetap muncul jika alert sedang aktif
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.isAlertActive) {
            if (dom.alertOverlay) {
                dom.alertOverlay.classList.add("active");
                dom.alertOverlay.style.display = "flex";
            }
        }
    });

    // Inisialisasi awal
    initConnectionInputs();
    checkDeviceCapabilities();
    fetchRecentAlerts();
    // AUTO CONNECT WEBSOCKET SAAT HALAMAN DIBUKA
    connectWebSocket();
})();
