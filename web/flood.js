const sendButton = document.getElementById("sendButton");
const startSimButton = document.getElementById("startSimButton");
const stopSimButton = document.getElementById("stopSimButton");
const statusElement = document.getElementById("status");
const messageElement = document.getElementById("message");
const simModeText = document.getElementById("simModeText");
const simCountText = document.getElementById("simCountText");

let simInterval = null;
let simPacketsSent = 0;
const waterSequence = [20, 21, 22, 25, 28, 31, 35, 40, 50, 55, 80];
let seqIndex = 0;

function setStatus(status, message) {
    statusElement.textContent = status;
    messageElement.textContent = message;
    statusElement.className = "status";

    switch (status) {
        case "NORMAL":
            statusElement.classList.add("normal");
            break;
        case "FLOOD_WARNING":
            statusElement.classList.add("warning");
            break;
        case "FLOOD_ALERT":
            statusElement.classList.add("alert");
            break;
        case "FLOOD_CRITICAL":
            statusElement.classList.add("critical");
            break;
        case "ERROR":
            statusElement.classList.add("error");
            break;
    }
}

async function sendFloodData(deviceId, waterLevel, rateOfRise, rainfall) {
    const payload = {
        device_id: deviceId,
        sensor_type: "flood",
        water_level: waterLevel,
        rate_of_rise: rateOfRise,
        rainfall: rainfall
    };

    try {
        const response = await fetch("/api/flood", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.detail || data.error || "Gagal mengirim data sensor."
            );
        }

        setStatus(data.status, data.message);
        simPacketsSent++;
        if (simCountText) simCountText.textContent = simPacketsSent;

        return data;
    } catch (error) {
        console.error("Flood sensor error:", error);
        setStatus("ERROR", error.message);
        throw error;
    }
}

// MANUAL SEND BUTTON
sendButton.addEventListener("click", async () => {
    const deviceId = document.getElementById("deviceId").value.trim();
    const waterLevel = Number(document.getElementById("waterLevel").value);
    const rateOfRise = Number(document.getElementById("rateOfRise").value);
    const rainfall = Number(document.getElementById("rainfall").value);

    if (!deviceId) {
        setStatus("ERROR", "Device ID tidak boleh kosong.");
        return;
    }
    if (!Number.isFinite(waterLevel) || waterLevel < 0) {
        setStatus("ERROR", "Water level tidak valid.");
        return;
    }
    if (!Number.isFinite(rateOfRise)) {
        setStatus("ERROR", "Rate of rise tidak valid.");
        return;
    }
    if (!Number.isFinite(rainfall) || rainfall < 0) {
        setStatus("ERROR", "Rainfall tidak valid.");
        return;
    }

    sendButton.disabled = true;
    sendButton.textContent = "Sending...";

    try {
        await sendFloodData(deviceId, waterLevel, rateOfRise, rainfall);
    } finally {
        sendButton.disabled = false;
        sendButton.textContent = "Send Manual Data";
    }
});

// AUTO SIMULATION CONTROLS
function startAutoSimulation() {
    if (simInterval) return;

    seqIndex = 0;
    simPacketsSent = 0;
    if (simModeText) simModeText.textContent = "AUTO SIMULATION";
    if (simCountText) simCountText.textContent = "0";

    startSimButton.disabled = true;
    stopSimButton.disabled = false;

    // Direct first tick
    tickSimulation();

    // Loop interval 1 detik
    simInterval = setInterval(tickSimulation, 1000);
}

async function tickSimulation() {
    if (seqIndex >= waterSequence.length) {
        // Loop back to last item or stay at 80cm
        seqIndex = waterSequence.length - 1;
    }

    const deviceId = document.getElementById("deviceId").value.trim() || "flood-node-001";
    const waterLevel = waterSequence[seqIndex];
    
    // Hitung rate_of_rise realistis
    let rateOfRise = 1.0;
    if (seqIndex > 0) {
        const diff = waterLevel - waterSequence[seqIndex - 1];
        rateOfRise = diff * 2.0; // skala visual
    }
    const rainfall = waterLevel >= 50 ? 25.0 : 5.0;

    // Update form input visual
    document.getElementById("waterLevel").value = waterLevel;
    document.getElementById("rateOfRise").value = rateOfRise.toFixed(1);
    document.getElementById("rainfall").value = rainfall.toFixed(1);

    try {
        await sendFloodData(deviceId, waterLevel, rateOfRise, rainfall);
    } catch (err) {
        stopAutoSimulation();
    }

    seqIndex++;
    if (seqIndex >= waterSequence.length) {
        // selesai siklus simulasi
        stopAutoSimulation();
    }
}

function stopAutoSimulation() {
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
    }
    startSimButton.disabled = false;
    stopSimButton.disabled = true;
    if (simModeText) simModeText.textContent = "MANUAL (STOPPED)";
}

if (startSimButton) startSimButton.addEventListener("click", startAutoSimulation);
if (stopSimButton) stopSimButton.addEventListener("click", stopAutoSimulation);