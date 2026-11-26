const settings = window.raceboxSettings || { speed_unit: 'kmh', distance_unit: 'm', gps_accuracy: 35 };
const speedFactor = settings.speed_unit === 'mph' ? 0.621371 : 1;
const distanceFactor = settings.distance_unit === 'ft' ? 3.28084 : 1;
const speedLabel = settings.speed_unit === 'mph' ? 'mph' : 'km/h';
const distanceLabel = settings.distance_unit === 'ft' ? 'ft' : 'm';
const $ = (id) => document.getElementById(id);
let watchId = null;
let lastPosition = null;
let startedAt = null;
let isArmed = false;
let isRunning = false;
let runDistance = 0;
let maxSpeed = 0;
let timerId = null;
let finishPending = false;
let routeCoordinates = [];
let telemetryValues = [];
const splitTimes = { 60: null, 100: null, 201: null, 402: null };
const checkpoints = [60, 100, 201, 402];
$('speedUnit').textContent = speedLabel;
$('topSpeedUnit').textContent = speedLabel;
$('distanceUnit').textContent = distanceLabel;
$('progressDistance').textContent = `0 / ${Math.round(402 * distanceFactor)} ${distanceLabel}`;
function toRadians(degrees) { return degrees * Math.PI / 180; }
function distanceBetween(a, b) {
    const dLat = toRadians(b.coords.latitude - a.coords.latitude);
    const dLon = toRadians(b.coords.longitude - a.coords.longitude);
    const lat1 = toRadians(a.coords.latitude), lat2 = toRadians(b.coords.latitude);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function setGps(message, state = 'ready') {
    const labels = { ready: 'GPS SIAP', searching: 'MENCARI GPS…', connected: 'GPS TERHUBUNG', error: 'IZIN / SINYAL GPS' };
    $('gpsStatus').textContent = message;
    $('gpsPill').textContent = labels[state] || labels.ready;
    for (const dot of [$('gpsDot'), $('sideGpsDot')]) {
        dot.classList.toggle('connected', state === 'connected');
        dot.classList.toggle('searching', state === 'searching');
        dot.classList.toggle('gps-error', state === 'error');
    }
}
function formatTime(milliseconds) {
    const safe = Math.max(0, milliseconds);
    const minutes = Math.floor(safe / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    const millis = Math.floor(safe % 1000);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
function setSplit(key, seconds) {
    if (splitTimes[key] !== null) return;
    splitTimes[key] = seconds;
    $(`split${key}`).textContent = seconds.toFixed(3);
    $(`split${key}State`).textContent = 'TERCATAT';
    $(`split${key}State`).classList.add('recorded');
}
function updateClock() {
    if (startedAt !== null) $('dragClock').textContent = formatTime(Date.now() - startedAt);
}
function updateDistanceDisplay() {
    const shownDistance = runDistance * distanceFactor;
    const finishDistance = 402 * distanceFactor;
    $('dragDistance').textContent = shownDistance.toFixed(0);
    $('progressDistance').textContent = `${shownDistance.toFixed(0)} / ${finishDistance.toFixed(0)} ${distanceLabel}`;
    $('distanceProgress').style.width = `${Math.min(100, (runDistance / 402) * 100)}%`;
    if (runDistance >= 402) $('dragStatus').textContent = 'FINISH 402 M';
}
function handlePosition(position) {
    const { latitude, longitude, accuracy, speed: gpsSpeed } = position.coords;
    $('accuracyLabel').textContent = `AKURASI GPS ±${Math.round(accuracy)} M`;
    setGps('Sinyal lokasi diterima', 'connected');
    if (accuracy > Number(settings.gps_accuracy || 35)) {
        lastPosition = null;
        $('dragHint').textContent = `GPS mendapat lokasi, tetapi akurasinya ±${Math.round(accuracy)} m. Atur filter hingga ±${settings.gps_accuracy} m atau lebih longgar di Pengaturan.`;
        return;
    }

    routeCoordinates.push([latitude, longitude]);
    let segmentDistance = 0;
    let speedKmh = Number.isFinite(gpsSpeed) && gpsSpeed > 0 ? gpsSpeed * 3.6 : 0;
    if (lastPosition) {
        const elapsed = (position.timestamp - lastPosition.timestamp) / 1000;
        segmentDistance = distanceBetween(lastPosition, position);
        if (speedKmh === 0 && elapsed > 0 && segmentDistance > Math.max(2, accuracy * 0.25) && segmentDistance < 80) speedKmh = segmentDistance / elapsed * 3.6;
    }

    if (!isRunning && speedKmh >= 3) {
        isRunning = true;
        isArmed = false;
        startedAt = position.timestamp;
        $('dragStatus').textContent = 'RUN BERLANGSUNG';
        $('armedDot').classList.add('active');
        $('dragHint').textContent = 'Run berjalan. Split akan dicatat otomatis berdasarkan kecepatan dan jarak GPS.';
        timerId = window.setInterval(updateClock, 30);
        lastPosition = position;
        $('dragSpeed').textContent = Math.round(speedKmh * speedFactor);
        $('dragTopSpeed').textContent = (speedKmh * speedFactor).toFixed(1);
        $('stopDragButton').disabled = false;
        return;
    }

    if (isRunning && startedAt !== null) {
        const previousDistance = runDistance;
        if (segmentDistance < 80) runDistance += segmentDistance;
        const elapsedSeconds = Math.max(0, (position.timestamp - startedAt) / 1000);
        if (speedKmh >= 60) setSplit(60, elapsedSeconds);
        if (speedKmh >= 100) setSplit(100, elapsedSeconds);
        for (const checkpoint of [201, 402]) {
            if (splitTimes[checkpoint] === null && previousDistance < checkpoint && runDistance >= checkpoint) {
                const ratio = segmentDistance > 0 ? (checkpoint - previousDistance) / segmentDistance : 1;
                const crossingTime = position.timestamp - (1 - Math.min(1, Math.max(0, ratio))) * (position.timestamp - lastPosition.timestamp);
                setSplit(checkpoint, Math.max(0, (crossingTime - startedAt) / 1000));
            }
        }
        updateDistanceDisplay();
        telemetryValues.push(Number(speedKmh.toFixed(1)));
        $('dragSpeed').textContent = Math.round(speedKmh * speedFactor);
        if (speedKmh > maxSpeed) {
            maxSpeed = speedKmh;
            $('dragTopSpeed').textContent = (maxSpeed * speedFactor).toFixed(1);
        }
    } else {
        $('dragSpeed').textContent = Math.round(speedKmh * speedFactor);
    }
    lastPosition = position;
    if (isRunning && runDistance >= 402 && !finishPending) {
        finishPending = true;
        window.setTimeout(() => disarmTimer(), 0);
    }
}
function handleGpsError(error) {
    const messages = {
        1: 'Izin lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser.',
        2: 'Sinyal GPS tidak tersedia. Aktifkan layanan lokasi perangkat dan coba di area terbuka.',
        3: 'GPS belum mendapat fix setelah 60 detik. Aktifkan lokasi presisi dan coba lagi di area terbuka.'
    };
    const message = messages[error.code] || 'GPS bermasalah. Periksa izin lokasi dan coba lagi.';
    disarmTimer(false);
    setGps(message, 'error');
    $('dragStatus').textContent = 'GPS TIDAK SIAP';
    $('dragHint').textContent = message;
}
function armTimer() {
    if (!navigator.geolocation) {
        const message = 'Browser ini tidak menyediakan GPS. Buka melalui HTTPS di browser yang mendukung lokasi.';
        setGps(message, 'error');
        $('dragHint').textContent = message;
        return;
    }
    if (isArmed || isRunning) return;
    resetTimer();
    isArmed = true;
    $('dragStatus').textContent = 'MENUNGGU START';
    $('armedDot').classList.add('active');
    $('dragHint').textContent = 'Timer siap. Mulai bergerak untuk memulai pencatatan waktu.';
    $('armButton').disabled = true;
    $('stopDragButton').disabled = false;
    watchId = navigator.geolocation.watchPosition(handlePosition, handleGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
    setGps('Meminta izin lokasi dan mencari sinyal GPS…', 'searching');
}
async function disarmTimer(save = true) {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isArmed = false;
    isRunning = false;
    window.clearInterval(timerId);
    $('armButton').disabled = false;
    $('stopDragButton').disabled = true;
    $('armedDot').classList.remove('active');
    if (startedAt === null) {
        $('dragStatus').textContent = 'TIMER DIHENTIKAN';
        $('dragHint').textContent = 'Belum ada gerakan yang terekam. Tekan ARM TIMER untuk mencoba lagi.';
        return;
    }
    $('dragClock').textContent = formatTime(Date.now() - startedAt);
    $('dragStatus').textContent = runDistance >= 402 ? 'RUN SELESAI · 402 M' : 'RUN DIHENTIKAN';
    $('dragHint').textContent = 'Run dihentikan. Hasil tersimpan pada riwayat bila jarak GPS valid.';
    if (!save || routeCoordinates.length < 2 || runDistance < 10) return;
    try {
        const response = await fetch('/api/save_run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                max_speed: maxSpeed,
                zero_to_hundred: splitTimes[100],
                distance: runDistance,
                route_data: routeCoordinates,
                telemetry_data: telemetryValues
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Run gagal disimpan');
        $('dragHint').textContent = `Run tersimpan ke riwayat · ${result.analysis}`;
    } catch (error) {
        $('dragHint').textContent = `Gagal menyimpan run: ${error.message}`;
    }
}
function resetTimer() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    window.clearInterval(timerId);
    watchId = null;
    lastPosition = null;
    startedAt = null;
    isArmed = false;
    isRunning = false;
    finishPending = false;
    runDistance = 0;
    maxSpeed = 0;
    routeCoordinates = [];
    telemetryValues = [];
    for (const key of checkpoints) {
        splitTimes[key] = null;
        $(`split${key}`).textContent = '—.---';
        $(`split${key}State`).textContent = 'MENUNGGU';
        $(`split${key}State`).classList.remove('recorded');
    }
    $('dragClock').textContent = '00:00.000';
    $('dragSpeed').textContent = '0';
    $('dragDistance').textContent = '0';
    $('dragTopSpeed').textContent = '0.0';
    $('distanceProgress').style.width = '0%';
    $('progressDistance').textContent = `0 / ${Math.round(402 * distanceFactor)} ${distanceLabel}`;
    $('dragStatus').textContent = 'SIAP DI GARIS START';
    $('dragHint').textContent = 'Izinkan lokasi browser. Timer mulai otomatis saat GPS mendeteksi motor bergerak.';
    $('armButton').disabled = false;
    $('stopDragButton').disabled = true;
    $('armedDot').classList.remove('active');
    setGps('Belum tersambung', 'ready');
}
$('armButton').addEventListener('click', armTimer);
$('stopDragButton').addEventListener('click', () => disarmTimer());
$('resetDragButton').addEventListener('click', resetTimer);
