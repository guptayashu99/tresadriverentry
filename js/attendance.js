/* Attendance page — PIN-gated, garage-gated check-in / check-out */

const ATT_SESSION_KEY = 'attendanceAuth';

let currentDriver   = null;
let locationWatcher = null;
let atGarage        = false;
let lastPosition    = null; // most recent coords from watchPosition
let currentStatus   = null; // 'in' | 'out' | null
let todayRecords    = [];

document.addEventListener('DOMContentLoaded', () => {
  const picker = document.getElementById('driverPicker');
  CONFIG.DRIVERS.forEach(d => {
    const o = document.createElement('option');
    o.value = o.textContent = d;
    picker.appendChild(o);
  });

  const saved = sessionStorage.getItem(ATT_SESSION_KEY);
  if (saved && CONFIG.DRIVERS.includes(saved)) {
    showAuthenticated(saved);
    loadTodayStatus();
    startLocationWatch();
  }
});

// ── Auth ────────────────────────────────────────────────────────────

function handleLogin() {
  const name = document.getElementById('driverPicker').value;
  const pin  = document.getElementById('pinInput').value;
  const err  = document.getElementById('loginError');

  if (!name) { err.textContent = '❌ Please select your name.'; err.style.display = 'block'; return; }

  if ((CONFIG.DRIVER_PINS[name] || '') === pin) {
    err.style.display = 'none';
    currentDriver = name;
    sessionStorage.setItem(ATT_SESSION_KEY, name);
    showAuthenticated(name);
    loadTodayStatus();
    startLocationWatch();
  } else {
    err.textContent = '❌ Incorrect PIN. Please try again.';
    err.style.display = 'block';
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
  }
}

function showAuthenticated(name) {
  currentDriver = name;
  document.getElementById('loginCard').style.display    = 'none';
  document.getElementById('loggedInBar').style.display  = 'flex';
  document.getElementById('loggedInName').textContent   = name;
  document.getElementById('content').style.display      = 'block';
}

function logout() {
  sessionStorage.removeItem(ATT_SESSION_KEY);
  stopLocationWatch();
  currentDriver = null;
  currentStatus = null;
  todayRecords  = [];
  document.getElementById('loginCard').style.display   = 'block';
  document.getElementById('loggedInBar').style.display = 'none';
  document.getElementById('content').style.display     = 'none';
  document.getElementById('pinInput').value            = '';
  document.getElementById('driverPicker').value        = '';
}

// ── Data ────────────────────────────────────────────────────────────

async function loadTodayStatus() {
  const today = todayStr();
  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL + '?type=attendance');
    const json = await res.json();
    const all  = json.success ? (json.data || []) : [];

    todayRecords = all.filter(r =>
      r['Driver Name'] === currentDriver &&
      (r['Date'] || '').startsWith(today)
    );

    const last = todayRecords[todayRecords.length - 1];
    currentStatus = last ? (last['Out Time'] ? 'out' : 'in') : null;
  } catch {
    currentStatus = null;
  }
  updateActionButton();
  renderLog();
}

// ── Geolocation ─────────────────────────────────────────────────────

function startLocationWatch() {
  stopLocationWatch();
  if (!navigator.geolocation) {
    setLocationUI('⚠️', '#f59e0b', 'Geolocation not supported', 'Use a device that supports GPS.');
    return;
  }
  locationWatcher = navigator.geolocation.watchPosition(
    onLocationSuccess,
    onLocationError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

function stopLocationWatch() {
  if (locationWatcher !== null) {
    navigator.geolocation.clearWatch(locationWatcher);
    locationWatcher = null;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function onLocationSuccess(pos) {
  lastPosition = pos;
  const { latitude, longitude, accuracy } = pos.coords;
  const dist = haversine(latitude, longitude, CONFIG.GARAGE_LAT, CONFIG.GARAGE_LNG);
  atGarage   = dist <= CONFIG.GARAGE_RADIUS_M;

  const distLabel = dist >= 1000
    ? (dist / 1000).toFixed(1) + ' km'
    : Math.round(dist) + ' m';

  if (atGarage) {
    setLocationUI('✅', '#16a34a', "You're at the garage",
      `${Math.round(dist)} m from garage · GPS accuracy ±${Math.round(accuracy)} m`);
  } else {
    setLocationUI('❌', '#dc2626', 'Not at the garage',
      `${distLabel} away — check-in is only allowed at the garage`);
  }
  updateActionButton();
}

function onLocationError(err) {
  atGarage = false;
  const sub = err.code === 1
    ? 'Please allow location access in your browser settings.'
    : 'Could not get your location. Please try again.';
  setLocationUI('⚠️', '#f59e0b', 'Location unavailable', sub);
  updateActionButton();
}

function setLocationUI(icon, color, label, sub) {
  document.getElementById('locationIcon').textContent   = icon;
  document.getElementById('locationLabel').textContent  = label;
  document.getElementById('locationLabel').style.color  = color;
  document.getElementById('locationSub').textContent    = sub;
}

// ── Action button ────────────────────────────────────────────────────

function updateActionButton() {
  const btn = document.getElementById('actionBtn');
  if (currentStatus === 'in') {
    btn.textContent = 'Check Out';
    btn.className   = 'action-btn checkout';
  } else {
    btn.textContent = 'Check In';
    btn.className   = 'action-btn checkin';
  }
  btn.disabled = !atGarage;
}

async function handleAction() {
  if (!atGarage || !currentDriver || !lastPosition) return;

  const action = currentStatus === 'in' ? 'Check-out' : 'Check-in';
  const btn    = document.getElementById('actionBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // Re-verify using the most recent position from watchPosition
  const { latitude, longitude } = lastPosition.coords;
  const dist = haversine(latitude, longitude, CONFIG.GARAGE_LAT, CONFIG.GARAGE_LNG);

  if (dist > CONFIG.GARAGE_RADIUS_M) {
    alert("You've moved away from the garage. Please be at the garage to check in/out.");
    atGarage = false;
    updateActionButton();
    return;
  }

  const now  = new Date();
  const date = todayStr();
  const time = now.toTimeString().slice(0, 5);

  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'attendance',
        driverName: currentDriver,
        attendanceAction: action,
        date, time,
        latitude, longitude
      })
    });

    if (action === 'Check-in') {
      currentStatus = 'in';
      todayRecords.push({ 'Driver Name': currentDriver, 'Date': date, 'In Time': time, 'Out Time': '', 'Total Duty Hours': '' });
    } else {
      currentStatus = 'out';
      if (todayRecords.length) {
        const last = todayRecords[todayRecords.length - 1];
        last['Out Time'] = time;
        const [inH,  inM]  = (last['In Time'] || '00:00').split(':').map(Number);
        const [outH, outM] = time.split(':').map(Number);
        let diff = (outH * 60 + outM) - (inH * 60 + inM);
        if (diff < 0) diff += 1440;
        last['Total Duty Hours'] = Math.floor(diff / 60) + 'h ' + (diff % 60) + 'm';
      }
    }
    updateActionButton();
    renderLog();
  } catch {
    alert('Failed to save. Please check your connection and try again.');
    updateActionButton();
  }
}

// ── Log ──────────────────────────────────────────────────────────────

function renderLog() {
  const el = document.getElementById('todayLog');
  if (!todayRecords.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px 0">No entries today</div>';
    return;
  }
  el.innerHTML = todayRecords.map(r => {
    const isOpen = !r['Out Time'];
    return `<div class="log-row">
      <span>
        <span class="badge-checkin">▶ In</span> ${r['In Time'] || '—'}
        ${!isOpen ? `&nbsp;&nbsp;<span class="badge-checkout">⏹ Out</span> ${r['Out Time']}` : ''}
      </span>
      <span style="color:var(--text-muted)">${r['Total Duty Hours'] || (isOpen ? 'In progress…' : '')}</span>
    </div>`;
  }).join('');
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
