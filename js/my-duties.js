/* My Duties page — PIN-gated view for drivers (edit/delete own records) */

const SESSION_KEY = 'myDutiesDriver';
let myDuties = [];
let _myRenderedDuties = [];

document.addEventListener('DOMContentLoaded', () => {
  const picker = document.getElementById('driverPicker');
  CONFIG.DRIVERS.forEach(d => {
    const o = document.createElement('option');
    o.value = o.textContent = d;
    picker.appendChild(o);
  });

  const now = new Date();
  document.getElementById('monthFilter').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Restore session if already authenticated this browser session
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved && CONFIG.DRIVERS.includes(saved)) {
    showAuthenticated(saved);
    loadMyDuties(saved);
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
    sessionStorage.setItem(SESSION_KEY, name);
    showAuthenticated(name);
    loadMyDuties(name);
  } else {
    err.textContent = '❌ Incorrect PIN. Please try again.';
    err.style.display = 'block';
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
  }
}

function showAuthenticated(name) {
  document.getElementById('loginCard').style.display   = 'none';
  document.getElementById('loggedInBar').style.display = 'block';
  document.getElementById('loggedInName').textContent  = name;
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  document.getElementById('loginCard').style.display   = 'block';
  document.getElementById('loggedInBar').style.display = 'none';
  document.getElementById('content').style.display     = 'none';
  document.getElementById('loader').style.display      = 'none';
  document.getElementById('pinInput').value            = '';
  document.getElementById('driverPicker').value        = '';
  myDuties = [];
}

// ── Data ────────────────────────────────────────────────────────────

async function loadMyDuties(driver) {
  document.getElementById('content').style.display = 'none';
  document.getElementById('loader').style.display  = 'flex';

  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL);
    const json = await res.json();
    const all  = json.success ? (json.data || []) : [];
    myDuties   = all
      .filter(d => (d['Driver Name'] || '') === driver)
      .sort((a, b) => (b['Duty Date'] || '').localeCompare(a['Duty Date'] || ''));

    document.getElementById('loader').style.display  = 'none';
    document.getElementById('content').style.display = 'block';
    renderAll();
  } catch {
    document.getElementById('loader').innerHTML =
      '<div class="alert alert-error">❌ Could not load duties. Check your connection.</div>';
  }
}

// ── Render ───────────────────────────────────────────────────────────

function renderAll() {
  const ym       = document.getElementById('monthFilter').value;
  const filtered = ym ? myDuties.filter(d => (d['Duty Date'] || '').startsWith(ym)) : myDuties;
  renderSummary(filtered);
  renderTable(filtered);
}

function renderSummary(duties) {
  const km   = duties.reduce((s, d) => s + (+d['Total Km']       || 0), 0);
  const exp  = duties.reduce((s, d) => s + (+d['Total Expenses'] || 0), 0);
  const fuel = duties.reduce((s, d) => s + (+d['Fuel Amount']    || 0), 0);
  let   alw  = 0;
  duties.forEach(d => { alw += calcDutyAllowance(d).totalAllowance; });

  document.getElementById('sDuties').textContent = duties.length;
  document.getElementById('sKm').textContent     = km.toLocaleString('en-IN') + ' km';
  document.getElementById('sExp').textContent    = fmtINR(exp);
  document.getElementById('sAlw').textContent    = fmtINR(alw);
}

function renderTable(duties) {
  const cnt  = document.getElementById('dutyCount');
  const body = document.getElementById('myDutiesBody');
  const ym   = document.getElementById('monthFilter').value;

  _myRenderedDuties = duties;
  cnt.textContent = duties.length + ' duties' + (ym ? ' in ' + fmtMonth(ym) : '');

  if (!duties.length) {
    body.innerHTML = `<tr><td colspan="10" class="empty-cell">
      <div class="empty-icon">📋</div>No duties found</td></tr>`;
    return;
  }

  body.innerHTML = duties.map((d, i) => {
    const a    = calcDutyAllowance(d);
    const exp  = +d['Total Expenses'] || 0;
    const fuel = d['Filled Fuel'] === 'Yes';

    return `<tr>
      <td>${fmtDate(d['Duty Date'])}${a.isSunday ? ' <span class="badge badge-yellow">Sun</span>' : ''}</td>
      <td style="font-size:12px;color:var(--text-muted)">${d['Vehicle Number'] || '—'}</td>
      <td>${d['Vendor'] || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${d['Vendor Duty Number'] || '—'}</td>
      <td><span class="badge badge-blue">${d['Duty Type'] || '—'}</span></td>
      <td>${fmtTimeRange(d)}</td>
      <td>${d['Total Km'] || 0} km</td>
      <td>${exp ? fmtINR(exp) : '—'}</td>
      <td>
        <strong style="color:var(--success)">${fmtINR(a.totalAllowance)}</strong>
        ${a.overtimeHours > 0 ? `<div style="font-size:11px;color:var(--text-muted)">${a.overtimeHours.toFixed(2)}h OT</div>` : ''}
        ${a.outstationDays > 0 ? `<div style="font-size:11px;color:var(--text-muted)">${a.outstationDays}d outstation</div>` : ''}
        ${a.isSunday ? `<div style="font-size:11px;color:var(--warning)">+₹1k Sunday</div>` : ''}
        ${fuel ? `<div style="font-size:11px;color:var(--text-muted)">⛽ ${fmtINR(d['Fuel Amount'])}</div>` : ''}
      </td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" onclick="openMyEditModal(_myRenderedDuties[${i}])">Edit</button>
        <button class="btn" style="padding:3px 10px;font-size:11px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;margin-left:4px" onclick="deleteMyDuty(_myRenderedDuties[${i}]['Timestamp'],_myRenderedDuties[${i}]['Duty Date'])">Del</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Edit modal ────────────────────────────────────────────────────────

function openMyEditModal(d) {
  const existing = document.getElementById('myEditDutyModal');
  if (existing) existing.remove();

  const opts = (items, sel) => items.map(v =>
    `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  const fld = (label, id, type, val, extra = '') =>
    `<div class="field"><label>${label}</label><input type="${type}" id="${id}" value="${val}" ${extra}></div>`;

  const modal = document.createElement('div');
  modal.id = 'myEditDutyModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
  <div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:700px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h3 style="margin:0;font-size:17px">Edit Duty Record</h3>
      <button type="button" onclick="closeMyEditModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1">×</button>
    </div>
    <div style="font-size:11px;color:#9ca3af;margin-bottom:16px">Submitted: ${d['Timestamp'] || '—'}</div>
    <input type="hidden" id="myEditTs" value="${d['Timestamp'] || ''}">

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="field"><label>Driver</label><input type="text" value="${d['Driver Name'] || ''}" disabled style="background:#f3f4f6;color:var(--text-muted)"></div>
      <div class="field"><label>Vehicle</label><select id="myEditVehicle">${opts(CONFIG.VEHICLES, d['Vehicle Number'])}</select></div>
      ${fld('Duty Date', 'myEditDutyDate', 'date', d['Duty Date'] || '')}
      <div class="field"><label>Duty Type</label><select id="myEditDutyType">${opts(CONFIG.DUTY_TYPES, d['Duty Type'])}</select></div>
      <div class="field"><label>Vendor</label><select id="myEditVendor">${opts(CONFIG.VENDORS, d['Vendor'])}</select></div>
      ${fld('Vendor Duty No.', 'myEditVendorNo', 'text', d['Vendor Duty Number'] || '')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      ${fld('Start Km', 'myEditStartKm', 'number', d['Start Km'] || 0)}
      ${fld('Start Date', 'myEditStartDate', 'date', d['Start Date'] || d['Duty Date'] || '')}
      ${fld('Start Time', 'myEditStartTime', 'time', d['Start Time'] || '')}
      ${fld('End Km', 'myEditEndKm', 'number', d['End Km'] || 0)}
      ${fld('End Date', 'myEditEndDate', 'date', d['End Date'] || d['Duty Date'] || '')}
      ${fld('End Time', 'myEditEndTime', 'time', d['End Time'] || '')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px">
      ${fld('Parking', 'myEditParking', 'number', d['Parking'] || 0, 'min=0')}
      ${fld('MCD', 'myEditMcd', 'number', d['MCD'] || 0, 'min=0')}
      ${fld('Toll', 'myEditToll', 'number', d['Toll'] || 0, 'min=0')}
      ${fld('State Tax', 'myEditStateTax', 'number', d['State Tax'] || 0, 'min=0')}
      ${fld('Misc', 'myEditMisc', 'number', d['Miscellaneous'] || 0, 'min=0')}
    </div>

    <div style="margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="myEditFuelCb" ${d['Filled Fuel'] === 'Yes' ? 'checked' : ''} onchange="toggleMyEditFuel()">
        Fuel filled on this duty
      </label>
      <div id="myEditFuelRow" style="display:${d['Filled Fuel'] === 'Yes' ? 'grid' : 'none'};grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
        ${fld('Fuel Amount (₹)', 'myEditFuelAmt', 'number', d['Fuel Amount'] || 0, 'min=0')}
        ${fld('Fuel Litres', 'myEditFuelL', 'number', d['Fuel Litres'] || 0, 'min=0')}
        ${fld('Fuel Odometer', 'myEditFuelOdo', 'number', d['Fuel Odometer Reading'] || 0, 'min=0')}
      </div>
    </div>

    <div id="myEditErr" class="alert alert-error" style="display:none;margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="closeMyEditModal()">Cancel</button>
      <button class="btn btn-primary" id="myEditSaveBtn" onclick="submitMyEditDuty(event)">Save Changes</button>
    </div>
  </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) closeMyEditModal(); });
  document.body.appendChild(modal);
}

function closeMyEditModal() {
  const m = document.getElementById('myEditDutyModal');
  if (m) m.remove();
}

function toggleMyEditFuel() {
  document.getElementById('myEditFuelRow').style.display =
    document.getElementById('myEditFuelCb').checked ? 'grid' : 'none';
}

async function submitMyEditDuty(e) {
  e.preventDefault();
  const btn   = document.getElementById('myEditSaveBtn');
  const errEl = document.getElementById('myEditErr');
  errEl.style.display = 'none';

  const startKm = parseFloat(document.getElementById('myEditStartKm').value) || 0;
  const endKm   = parseFloat(document.getElementById('myEditEndKm').value)   || 0;
  if (endKm < startKm) {
    errEl.textContent = 'End Km must be ≥ Start Km'; errEl.style.display = 'block'; return;
  }
  btn.disabled = true; btn.textContent = 'Saving…';

  const fuel = document.getElementById('myEditFuelCb').checked;
  const payload = {
    action:           'editDuty',
    timestamp:        document.getElementById('myEditTs').value,
    driverName:       currentDriver,
    vehicleNumber:    document.getElementById('myEditVehicle').value,
    dutyDate:         document.getElementById('myEditDutyDate').value,
    dutyType:         document.getElementById('myEditDutyType').value,
    vendor:           document.getElementById('myEditVendor').value,
    vendorDutyNumber: document.getElementById('myEditVendorNo').value,
    startKm, startDate: document.getElementById('myEditStartDate').value,
    startTime:        document.getElementById('myEditStartTime').value,
    endKm,   endDate:   document.getElementById('myEditEndDate').value,
    endTime:          document.getElementById('myEditEndTime').value,
    parking:          parseFloat(document.getElementById('myEditParking').value)  || 0,
    mcd:              parseFloat(document.getElementById('myEditMcd').value)      || 0,
    toll:             parseFloat(document.getElementById('myEditToll').value)     || 0,
    stateTax:         parseFloat(document.getElementById('myEditStateTax').value) || 0,
    miscellaneous:    parseFloat(document.getElementById('myEditMisc').value)     || 0,
    filledFuel: fuel,
    fuelAmount:   fuel ? (parseFloat(document.getElementById('myEditFuelAmt').value) || 0) : null,
    fuelLitres:   fuel ? (parseFloat(document.getElementById('myEditFuelL').value)   || 0) : null,
    fuelOdometer: fuel ? (parseFloat(document.getElementById('myEditFuelOdo').value) || 0) : null,
    manualSlip: false, manualSlipNo: ''
  };

  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) { closeMyEditModal(); await loadMyDuties(currentDriver); }
    else throw new Error(json.error || 'Unknown error');
  } catch (err) {
    errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

async function deleteMyDuty(timestamp, dutyDate) {
  if (!confirm(`Delete duty on ${fmtDate(dutyDate)}?\n\nThis cannot be undone.`)) return;
  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'deleteDuty', timestamp })
    });
    const json = await res.json();
    if (json.success) { await loadMyDuties(currentDriver); }
    else alert('Delete failed: ' + (json.error || 'Unknown error'));
  } catch (err) { alert('Error: ' + err.message); }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtTimeRange(d) {
  const st = d['Start Time'] || '';
  const et = d['End Time']   || '';
  const sd = d['Start Date'] || d['Duty Date'] || '';
  const ed = d['End Date']   || d['Duty Date'] || '';
  const shortDate = s => {
    try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }
    catch { return s; }
  };
  if (!st && !et) return '—';
  if (sd && ed && sd !== ed) {
    return `${st} (${shortDate(sd)}) – ${et} (${shortDate(ed)})`;
  }
  const dateLabel = sd ? `<div style="font-size:11px;color:var(--text-muted)">${shortDate(sd)}</div>` : '';
  return `${dateLabel}${st || '—'} – ${et || '—'}`;
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN',
      { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
