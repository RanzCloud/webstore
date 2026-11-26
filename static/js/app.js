const map = L.map('map', { zoomControl: false }).setView([0, 0], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
tileLayer.on('tileerror', () => { document.getElementById('mapHint').textContent = 'Peta tidak dapat dimuat. Periksa koneksi internet, lalu muat ulang halaman.'; });
const routeLine = L.polyline([], { color: '#f07835', weight: 4, opacity: 0.95 }).addTo(map);
let currentLocationMarker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;
let totalDistance = 0;
let maxSpeed = 0;
let zeroStart = null;
let zeroDone = false;
let routeCoordinates = [];
let telemetryValues = [];
let startedAt = null;
let timerId = null;
let isTracking = false;
const $ = (id) => document.getElementById(id);
const settings = window.raceboxSettings || { speed_unit: 'kmh', distance_unit: 'm', accel_target: '100', gps_accuracy: 35 };
const speedFactor = settings.speed_unit === 'mph' ? 0.621371 : 1;
const distanceFactor = settings.distance_unit === 'ft' ? 3.28084 : 1;
const accelerationTarget = Number(settings.accel_target || 100);
const speedUnitLabel = settings.speed_unit === 'mph' ? 'mph' : 'km/h';
const distanceUnitLabel = settings.distance_unit === 'ft' ? 'ft' : 'm';
$('speed').nextElementSibling.textContent = speedUnitLabel;
document.querySelectorAll('.metric-card small').forEach((unit, index) => { if (index === 0) unit.textContent = speedUnitLabel; if (index === 2) unit.textContent = distanceUnitLabel; });
document.querySelector('.metric-stack .metric-card:nth-child(2) .eyebrow').textContent = `0–${accelerationTarget} KM/H`;
document.querySelector('.chart-unit').textContent = speedUnitLabel;
document.querySelector('.chart-panel h2').textContent = `Kecepatan (${speedUnitLabel})`;
document.querySelector('.metric-stack .metric-card:nth-child(3) .metric-note').textContent = `TOTAL JARAK (${distanceUnitLabel.toUpperCase()})`;
const speedData = { labels: [], datasets: [{ label: 'Kecepatan', borderColor: '#f07835', backgroundColor: 'rgba(240,120,53,.12)', data: [], tension: .35, fill: true, pointRadius: 0, borderWidth: 2 }] };
const chart = new Chart($('speedChart'), { type: 'line', data: speedData, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { display: false, grid: { display: false } }, y: { beginAtZero: true, suggestedMax: 100, ticks: { color: '#777', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' }, border: { display: false } } } } });
function toRadians(value) { return value * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1), dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function setGpsStatus(message, state = 'ready') {
    const labels = { ready: 'GPS SIAP', searching: 'MENCARI GPS…', connected: 'GPS TERHUBUNG', error: 'IZIN / SINYAL GPS' };
    $('gpsStatus').textContent = message;
    $('gpsPill').textContent = labels[state] || labels.ready;
    document.querySelectorAll('.status-dot').forEach(dot => {
        dot.classList.toggle('connected', state === 'connected');
        dot.classList.toggle('searching', state === 'searching');
        dot.classList.toggle('gps-error', state === 'error');
    });
}
function updateTimer() {
    if (!startedAt) return;
    const seconds = (Date.now() - startedAt) / 1000;
    $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
}
function startTracking() {
    if (!navigator.geolocation) {
        const message = 'Browser ini tidak menyediakan GPS. Buka melalui HTTPS di browser yang mendukung lokasi.';
        setGpsStatus(message, 'error');
        $('mapHint').textContent = message;
        return;
    }
    if (isTracking) return;
    if (routeCoordinates.length) resetTracking();
    isTracking = true;
    startedAt = Date.now();
    timerId = window.setInterval(updateTimer, 100);
    $('startButton').disabled = true;
    $('stopButton').disabled = false;
    $('trackState').textContent = 'MEREKAM';
    $('mapHint').textContent = 'Sedang merekam posisi GPS';
    setGpsStatus('Meminta izin lokasi dan mencari sinyal GPS…', 'searching');
    watchId = navigator.geolocation.watchPosition(updatePosition, handleGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function updatePosition(position) {
    const { latitude, longitude, accuracy, speed: gpsSpeed } = position.coords;
    const point = [latitude, longitude];
    $('accuracyLabel').textContent = `AKURASI GPS ±${Math.round(accuracy)} M`;
    $('deviceAccuracy').textContent = `±${Math.round(accuracy)} meter`;
    $('coords').textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    setGpsStatus('Sinyal lokasi diterima', 'connected');

    if (!accuracyCircle) {
        accuracyCircle = L.circle(point, { radius: Math.max(5, Math.min(accuracy, 500)), color: '#f07835', weight: 1, fillColor: '#f07835', fillOpacity: 0.12 }).addTo(map);
        currentLocationMarker = L.circleMarker(point, { radius: 7, color: '#fff', weight: 2, fillColor: '#f07835', fillOpacity: 1 }).addTo(map);
        map.setView(point, 16);
    } else {
        accuracyCircle.setLatLng(point).setRadius(Math.max(5, Math.min(accuracy, 500)));
        currentLocationMarker.setLatLng(point);
        if (isTracking) map.panTo(point, { animate: false });
    }

    if (accuracy > Number(settings.gps_accuracy || 35)) {
        lastPosition = null;
        $('mapHint').textContent = `Lokasi terlihat, tetapi akurasi ±${Math.round(accuracy)} m belum memenuhi filter ±${settings.gps_accuracy} m. Longgarkan filter di Pengaturan.`;
        return;
    }
    routeCoordinates.push(point);
    routeLine.addLatLng(point);
    $('mapHint').textContent = 'Lokasi GPS terkunci · merekam lintasan';
    let currentSpeed = Number.isFinite(gpsSpeed) && gpsSpeed >= 0 ? gpsSpeed * 3.6 : 0;
    if (lastPosition) {
        const distance = haversine(lastPosition.coords.latitude, lastPosition.coords.longitude, latitude, longitude);
        const elapsed = (position.timestamp - lastPosition.timestamp) / 1000;
        if ((!Number.isFinite(gpsSpeed) || gpsSpeed <= 0) && elapsed > 0 && distance > Math.max(2, accuracy * 0.25) && distance < 80) currentSpeed = (distance / elapsed) * 3.6;
        if (distance < 80) totalDistance += distance;
    }
    $('speed').textContent = Math.round(currentSpeed * speedFactor);
    $('speedBar').style.width = `${Math.min(100, (currentSpeed / 250) * 100)}%`;
    $('distance').textContent = (totalDistance * distanceFactor).toFixed(0);
    if (currentSpeed > maxSpeed) { maxSpeed = currentSpeed; $('maxSpeed').textContent = (maxSpeed * speedFactor).toFixed(1); }
    if (!zeroStart && currentSpeed > 3) zeroStart = position.timestamp;
    if (!zeroDone && currentSpeed >= accelerationTarget && zeroStart) {
        $('zeroToHundred').textContent = ((position.timestamp - zeroStart) / 1000).toFixed(2);
        zeroDone = true;
    }
    telemetryValues.push(Number(currentSpeed.toFixed(1)));
    speedData.labels.push(speedData.labels.length + 1);
    speedData.datasets[0].data.push(Number((currentSpeed * speedFactor).toFixed(1)));
    if (speedData.labels.length > 180) { speedData.labels.shift(); speedData.datasets[0].data.shift(); }
    chart.update('none');
    lastPosition = position;
}
function handleGpsError(error) {
    const messages = {
        1: 'Izin lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser.',
        2: 'Sinyal GPS tidak tersedia. Aktifkan layanan lokasi perangkat dan coba di area terbuka.',
        3: 'GPS belum mendapat fix setelah 60 detik. Coba lagi di area terbuka dengan lokasi presisi aktif.'
    };
    const message = messages[error.code] || 'GPS bermasalah. Periksa izin lokasi dan coba lagi.';
    stopTracking(false);
    setGpsStatus(message, 'error');
    $('trackState').textContent = 'GPS ERROR';
    $('mapHint').textContent = message;
}
async function stopTracking(save = true) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isTracking = false;
    window.clearInterval(timerId);
    $('startButton').disabled = false;
    $('stopButton').disabled = true;
    $('trackState').textContent = 'SELESAI';
    $('mapHint').textContent = routeCoordinates.length ? `${routeCoordinates.length} titik GPS terekam` : 'Tidak ada titik GPS terekam';
    if (!save || routeCoordinates.length < 2 || totalDistance < 10) return;
    try {
        const response = await fetch('/api/save_run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ max_speed: maxSpeed, zero_to_hundred: zeroDone && accelerationTarget === 100 ? Number($('zeroToHundred').textContent) : null, distance: totalDistance, route_data: routeCoordinates, telemetry_data: telemetryValues }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Run gagal disimpan');
        $('mapHint').textContent = `Run tersimpan · ${result.analysis}`;
    } catch (error) { $('mapHint').textContent = error.message; }
}
function resetTracking() {
    if (isTracking) stopTracking(false);
    lastPosition = null; totalDistance = 0; maxSpeed = 0; zeroStart = null; zeroDone = false; routeCoordinates = []; telemetryValues = []; startedAt = null;
    $('speed').textContent = '0'; $('speedBar').style.width = '0%'; $('maxSpeed').textContent = '0.0'; $('zeroToHundred').textContent = '—'; $('distance').textContent = '0'; $('elapsed').textContent = '00:00.0'; $('coords').textContent = 'MENUNGGU SINYAL GPS'; $('accuracyLabel').textContent = 'AKURASI GPS —'; $('deviceAccuracy').textContent = 'Menunggu GPS'; $('trackState').textContent = 'SIAP'; $('mapHint').textContent = 'Mulai GPS untuk menampilkan posisi. Izinkan akses lokasi di browser.';
    routeLine.setLatLngs([]);
    if (currentLocationMarker) map.removeLayer(currentLocationMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    currentLocationMarker = null;
    accuracyCircle = null;
    map.setView([0, 0], 2);
    speedData.labels = []; speedData.datasets[0].data = []; chart.update(); setGpsStatus('Belum tersambung', 'ready');
}
$('startButton').addEventListener('click', startTracking);
$('stopButton').addEventListener('click', () => stopTracking());
$('resetButton').addEventListener('click', resetTracking);
window.addEventListener('resize', () => map.invalidateSize());
