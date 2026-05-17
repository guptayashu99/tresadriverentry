/* Dashboard logic — runs on dashboard.html */

let allDuties     = [];
let allAttendance = [];
let allPayments   = [];

// ── Auth ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('dashAuth') !== CONFIG.DASHBOARD_PASSWORD) {
    showPwScreen();
  } else {
    initDash();
  }
});

function showPwScreen() {
  document.getElementById('pwScreen').style.display = 'flex';
  document.getElementById('dashMain').style.display  = 'none';
  document.getElementById('pwForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = document.getElementById('pwInput').value;
    if (v === CONFIG.DASHBOARD_PASSWORD) {
      sessionStorage.setItem('dashAuth', v);
      document.getElementById('pwScreen').style.display = 'none';
      document.getElementById('dashMain').style.display  = 'block';
      initDash();
    } else {
      document.getElementById('pwErr').style.display = 'block';
      document.getElementById('pwInput').value = '';
    }
  });
}

// ── Init ───────────────────────────────────────────────────────────
function initDash() {
  if (!CONFIG.APPS_SCRIPT_URL) {
    document.getElementById('dashMain').innerHTML =
      '<div class="container-wide" style="padding:40px 16px">' +
      '<div class="alert alert-warn">⚠️ <strong>Setup needed:</strong> Add your Google Apps Script URL to <code>js/config.js</code>.</div>' +
      '</div>';
    return;
  }

  populateFilter('fDriver',   CONFIG.DRIVERS,    'All Drivers');
  populateFilter('fVendor',   CONFIG.VENDORS,    'All Vendors');
  populateFilter('fType',     CONFIG.DUTY_TYPES, 'All Types');
  populateFilter('salDriver', CONFIG.DRIVERS,    'All Drivers');
  populateFilter('psDriver',  CONFIG.DRIVERS);
  populateFilter('payDriver',    CONFIG.DRIVERS);
  populateFilter('bulkDelDriver', CONFIG.DRIVERS);
  populateFilter('attDriver', CONFIG.DRIVERS);

  // Default payment date to today
  el('payDate').value = new Date().toISOString().split('T')[0];

  // Default attendance manual entry to now
  const _now = new Date();
  el('attDate').value = _now.toISOString().split('T')[0];
  el('attTime').value = _now.toTimeString().slice(0, 5);

  const now = new Date();
  el('fFrom').value    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  el('fTo').value      = now.toISOString().split('T')[0];
  el('salMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  ['fFrom','fTo','fDriver','fVendor','fType'].forEach(id =>
    el(id).addEventListener('change', applyFilters)
  );

  loadData();
}

function populateFilter(id, items) {
  const sel = el(id);
  items.forEach(v => {
    const o = document.createElement('option');
    o.value = o.textContent = v;
    sel.appendChild(o);
  });
}

// ── Data load ──────────────────────────────────────────────────────
async function loadData() {
  setTableLoading(true);
  try {
    const [dutiesRes, attRes, payRes] = await Promise.all([
      fetch(CONFIG.APPS_SCRIPT_URL),
      fetch(CONFIG.APPS_SCRIPT_URL + '?type=attendance'),
      fetch(CONFIG.APPS_SCRIPT_URL + '?type=payments')
    ]);

    const dutiesText = await dutiesRes.text();
    let dutiesJson;
    try { dutiesJson = JSON.parse(dutiesText); }
    catch { throw new Error('Response was not JSON. Got: ' + dutiesText.slice(0, 200)); }

    allDuties = dutiesJson.success ? (dutiesJson.data || []) : [];
    if (!dutiesJson.success) console.error('Apps Script error:', dutiesJson.error);

    try {
      const attJson = await attRes.json();
      allAttendance = attJson.success ? (attJson.data || []) : [];
    } catch { allAttendance = []; }

    try {
      const payJson = await payRes.json();
      allPayments = payJson.success ? (payJson.data || []) : [];
    } catch { allPayments = []; }

    renderPaymentHistory();
    applyFilters();
  } catch (err) {
    console.error('Dashboard load error:', err);
    el('dutiesBody').innerHTML =
      `<tr><td colspan="12" class="empty-cell">❌ Could not load data: ${err.message}<br><small>Check browser console (F12) for details.</small></td></tr>`;
  }
}

function setTableLoading(on) {
  if (!on) return;
  el('dutiesBody').innerHTML =
    '<tr><td colspan="12" class="loading-cell"><div class="spinner"></div>Loading…</td></tr>';
  el('driverCards').innerHTML =
    '<div class="loading-cell" style="grid-column:1/-1"><div class="spinner"></div></div>';
}

// ── Filters ────────────────────────────────────────────────────────
function applyFilters() {
  const driver = el('fDriver').value;
  const vendor = el('fVendor').value;
  const type   = el('fType').value;
  const from   = el('fFrom').value;
  const to     = el('fTo').value;

  const filtered = allDuties.filter(d => {
    if (driver && (d['Driver Name'] || '') !== driver) return false;
    if (vendor && (d['Vendor']      || '') !== vendor) return false;
    if (type   && (d['Duty Type']   || '') !== type)   return false;
    if (from   && (d['Duty Date']   || '') < from)     return false;
    if (to     && (d['Duty Date']   || '') > to)       return false;
    return true;
  }).sort((a,b) => (b['Duty Date']||'').localeCompare(a['Duty Date']||''));

  const flagged = flagAnomalies(filtered);

  renderStats(filtered);
  renderDriverCards(filtered);
  renderAnomalyPanel(flagged);
  renderDuties(flagged);
}

// ── Stats cards ────────────────────────────────────────────────────
function renderStats(duties) {
  const totalKm   = duties.reduce((s,d) => s + (+d['Total Km']       || 0), 0);
  const totalExp  = duties.reduce((s,d) => s + (+d['Total Expenses'] || 0), 0);
  const totalFuel = duties.reduce((s,d) => s + (+d['Fuel Amount']    || 0), 0);
  let   totalAlw  = 0;
  duties.forEach(d => { totalAlw += calcDutyAllowance(d).totalAllowance; });

  el('statDuties').textContent = duties.length;
  el('statKm').textContent     = totalKm.toLocaleString('en-IN') + ' km';
  el('statExp').textContent    = fmtINR(totalExp);
  el('statFuel').textContent   = fmtINR(totalFuel);
  el('statAlw').textContent    = fmtINR(totalAlw);
}

// ── Driver summary cards ───────────────────────────────────────────
function renderDriverCards(duties) {
  const map = {};
  duties.forEach(d => {
    const name = d['Driver Name'] || 'Unknown';
    if (!map[name]) map[name] = { duties:0, km:0, exp:0, fuel:0, alw:0 };
    const a = calcDutyAllowance(d);
    map[name].duties++;
    map[name].km   += +d['Total Km']       || 0;
    map[name].exp  += +d['Total Expenses'] || 0;
    map[name].fuel += +d['Fuel Amount']    || 0;
    map[name].alw  += a.totalAllowance;
  });

  el('driverCards').innerHTML = Object.entries(map).map(([name, s]) => `
    <div class="driver-card">
      <div class="driver-name">${name}</div>
      <div class="drow"><span class="lbl">Duties</span><span class="val">${s.duties}</span></div>
      <div class="drow"><span class="lbl">Km Driven</span><span class="val">${s.km.toLocaleString('en-IN')} km</span></div>
      <div class="drow"><span class="lbl">Expenses</span><span class="val">${fmtINR(s.exp)}</span></div>
      <div class="drow"><span class="lbl">Fuel Cost</span><span class="val">${fmtINR(s.fuel)}</span></div>
      <div class="drow"><span class="lbl">OT / Allowances</span><span class="val">${fmtINR(s.alw)}</span></div>
    </div>`).join('') || '<p style="color:var(--text-muted);padding:12px">No data for selected filters</p>';
}

// ── Anomaly detection ──────────────────────────────────────────────
function flagAnomalies(duties) {
  return duties.map(d => {
    const flags = [];

    // Late submission: submitted >3 days after duty date
    if (d['Timestamp'] && d['Duty Date']) {
      const submitted = new Date(d['Timestamp'].replace(' ', 'T'));
      const dutyDay   = new Date(d['Duty Date'] + 'T00:00:00');
      const daysLate  = Math.floor((submitted - dutyDay) / 86400000);
      if (daysLate > 3) flags.push({ type: 'late', label: `${daysLate}d late` });
    }

    // Km gap: start km lower than previous duty's end km for same vehicle
    const v       = d['Vehicle Number'] || '';
    const startKm = parseFloat(d['Start Km']);
    if (v && !isNaN(startKm)) {
      const startDT = new Date((d['Start Date'] || d['Duty Date'] || '') + 'T' + (d['Start Time'] || '00:00'));
      const prev = allDuties
        .filter(x => x !== d && (x['Vehicle Number'] || '') === v)
        .map(x => ({
          endKm: parseFloat(x['End Km']),
          endDT: new Date((x['End Date'] || x['Duty Date'] || '') + 'T' + (x['End Time'] || '00:00'))
        }))
        .filter(x => !isNaN(x.endDT.getTime()) && x.endDT <= startDT)
        .sort((a, b) => b.endDT - a.endDT)[0];
      if (prev && !isNaN(prev.endKm) && prev.endKm > startKm) {
        flags.push({ type: 'km_gap', label: `Km ↓ (was ${prev.endKm})` });
      }
    }

    // High OT: more than 4 hours (non-Outstation)
    const _isOut = d['Duty Type'] === 'Outstation' || d['Duty Type'] === 'Outstation Round-Trip';
    if (!_isOut) {
      const a = calcDutyAllowance(d);
      if (a.overtimeHours > 4) flags.push({ type: 'high_ot', label: `${a.overtimeHours.toFixed(1)}h OT` });
    }

    // No attendance check-in on duty day (Beta — only shown when attendance data is loaded)
    if (allAttendance.length > 0 && d['Duty Date'] && d['Driver Name']) {
      const hasCheckin = allAttendance.some(a =>
        a['Driver Name'] === d['Driver Name'] &&
        a['In Time']     &&
        (a['Date']       || '').startsWith(d['Duty Date'])
      );
      if (!hasCheckin) flags.push({ type: 'no_att', label: 'No check-in' });
    }

    return { ...d, _flags: flags };
  });
}

// ── Anomaly panel ──────────────────────────────────────────────────
function renderAnomalyPanel(flagged) {
  const panel = el('anomalyPanel');
  const bad   = flagged.filter(d => d._flags && d._flags.length > 0);

  if (!bad.length) { panel.style.display = 'none'; return; }

  const counts = { late: 0, km_gap: 0, high_ot: 0, no_att: 0 };
  bad.forEach(d => d._flags.forEach(f => { if (f.type in counts) counts[f.type]++; }));

  const parts = [
    counts.late    && `⏰ ${counts.late} late submission${counts.late > 1 ? 's' : ''}`,
    counts.km_gap  && `📉 ${counts.km_gap} km gap${counts.km_gap > 1 ? 's' : ''}`,
    counts.high_ot && `⚡ ${counts.high_ot} high OT`,
    counts.no_att  && `📍 ${counts.no_att} missing check-in`
  ].filter(Boolean).join(' · ');

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong style="color:#92400e;white-space:nowrap">⚠️ ${bad.length} dut${bad.length > 1 ? 'ies' : 'y'} flagged</strong>
      <span style="color:#78350f;font-size:13px">${parts}</span>
    </div>`;
}

// ── Duties table ───────────────────────────────────────────────────
let _renderedDuties = [];   // reference used by edit/delete onclick handlers

const FLAG_STYLE = {
  late:    { bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  km_gap:  { bg: '#fee2e2', color: '#991b1b', border: '#dc2626' },
  high_ot: { bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  no_att:  { bg: '#f3f4f6', color: '#4b5563', border: '#9ca3af' }
};

function renderDuties(duties) {
  _renderedDuties = duties;
  el('dutiesCount').textContent = duties.length + ' duties';
  if (!duties.length) {
    el('dutiesBody').innerHTML =
      '<tr><td colspan="13" class="empty-cell"><div class="empty-icon">📋</div>No duties found</td></tr>';
    return;
  }

  el('dutiesBody').innerHTML = duties.map((d, i) => {
    const a     = calcDutyAllowance(d);
    const exp   = +d['Total Expenses'] || 0;
    const fuel  = d['Filled Fuel'] === 'Yes';
    const flags = d._flags || [];

    const flagBadges = flags.map(f => {
      const s = FLAG_STYLE[f.type] || FLAG_STYLE.no_att;
      return `<span style="display:inline-block;background:${s.bg};color:${s.color};border:1px solid ${s.border};border-radius:10px;font-size:10px;padding:1px 7px;white-space:nowrap;margin:1px">${f.label}</span>`;
    }).join('');

    const rowBg = flags.some(f => f.type === 'km_gap') ? 'background:#fff5f5' :
                  flags.length                          ? 'background:#fffbeb' : '';

    return `<tr${rowBg ? ` style="${rowBg}"` : ''}>
      <td>${fmtDate(d['Duty Date'])}${a.isSunday ? ' <span class="badge badge-yellow">Sun</span>' : ''}</td>
      <td>${d['Driver Name'] || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${d['Vehicle Number'] || '—'}</td>
      <td>${d['Vendor'] || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${d['Vendor Duty Number'] || '—'}</td>
      <td><span class="badge badge-blue">${d['Duty Type'] || '—'}</span></td>
      <td>${d['Total Km'] || 0} km</td>
      <td>${fmtDuration2(d['Duration (mins)'])}</td>
      <td>${exp ? fmtINR(exp) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${fuel ? `<span class="badge badge-green">⛽ ${fmtINR(d['Fuel Amount'])}</span>` : '—'}</td>
      <td><strong style="color:var(--primary)">${fmtINR(a.totalAllowance)}</strong>${a.isSunday ? '<br><span style="font-size:11px;color:var(--warning)">+₹1k Sun</span>' : ''}</td>
      <td>${flagBadges || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" onclick="openEditModal(_renderedDuties[${i}])">Edit</button>
        <button class="btn" style="padding:3px 10px;font-size:11px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;margin-left:4px" onclick="deleteDuty(_renderedDuties[${i}]['Timestamp'],_renderedDuties[${i}]['Duty Date']+' – '+_renderedDuties[${i}]['Driver Name'])">Del</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Attendance tab ─────────────────────────────────────────────────
function renderAttendanceTab() {
  const tbody = el('attBody');
  if (!allAttendance.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No attendance records found</td></tr>';
    return;
  }

  const sorted = [...allAttendance].sort((a, b) =>
    ((b['Date'] || '') + (b['In Time'] || '')).localeCompare((a['Date'] || '') + (a['In Time'] || ''))
  );

  tbody.innerHTML = sorted.map(r => {
    const isOpen = !r['Out Time'];
    return `<tr>
      <td>${fmtDate(r['Date'])}</td>
      <td>${r['Driver Name'] || '—'}</td>
      <td><span style="font-weight:600;color:#16a34a">▶ ${r['In Time'] || '—'}</span></td>
      <td>${r['Out Time'] ? `<span style="font-weight:600;color:#dc2626">⏹ ${r['Out Time']}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${r['Total Duty Hours'] || (isOpen ? '<span style="color:#f59e0b">In progress</span>' : '—')}</td>
    </tr>`;
  }).join('');
}

// ── Admin attendance ────────────────────────────────────────────────
function adminCheckIn() {
  const driver = el('attDriver').value;
  const date   = el('attDate').value;
  const time   = el('attTime').value;
  const msg    = el('attAdminMsg');
  if (!driver || !date || !time) { alert('Select driver, date and time.'); return; }

  msg.textContent = 'Saving…';
  fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'attendance', driverName: driver, attendanceAction: 'Check-in', date, time })
  })
  .then(r => r.json())
  .then(j => {
    if (j.success) {
      msg.innerHTML = `<span style="color:#16a34a">✓ ${driver} checked in at ${time} on ${fmtDate(date)}</span>`;
      allAttendance.push({ 'Driver Name': driver, 'Date': date, 'In Time': time, 'Out Time': '', 'Total Duty Hours': '' });
      renderAttendanceTab();
    } else {
      msg.innerHTML = `<span style="color:#dc2626">❌ ${j.error || 'Failed to check in'}</span>`;
    }
  })
  .catch(() => { msg.innerHTML = '<span style="color:#dc2626">❌ Network error — check your connection</span>'; });
}

function adminCheckOut() {
  const driver = el('attDriver').value;
  const date   = el('attDate').value;
  const time   = el('attTime').value;
  const msg    = el('attAdminMsg');
  if (!driver || !date || !time) { alert('Select driver, date and time.'); return; }

  const open = allAttendance.find(a =>
    a['Driver Name'] === driver && a['Date'] === date && !a['Out Time']
  );
  if (!open) {
    msg.innerHTML = `<span style="color:#dc2626">❌ No open check-in found for ${driver} on ${fmtDate(date)}</span>`;
    return;
  }

  msg.textContent = 'Saving…';
  fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'attendance', driverName: driver, attendanceAction: 'Check-out', date, time })
  })
  .then(r => r.json())
  .then(j => {
    if (j.success) {
      const [inH, inM]   = (open['In Time'] || '00:00').split(':').map(Number);
      const [outH, outM] = time.split(':').map(Number);
      let diff = (outH * 60 + outM) - (inH * 60 + inM);
      if (diff < 0) diff += 1440;
      open['Out Time']        = time;
      open['Total Duty Hours'] = Math.floor(diff / 60) + 'h ' + (diff % 60) + 'm';
      msg.innerHTML = `<span style="color:#16a34a">✓ ${driver} checked out at ${time} · ${open['Total Duty Hours']}</span>`;
      renderAttendanceTab();
    } else {
      msg.innerHTML = `<span style="color:#dc2626">❌ ${j.error || 'Failed to check out'}</span>`;
    }
  })
  .catch(() => { msg.innerHTML = '<span style="color:#dc2626">❌ Network error — check your connection</span>'; });
}

// ── Salary report ──────────────────────────────────────────────────
function calcSalaryReport() {
  const ym = el('salMonth').value;
  if (!ym) { alert('Select a month first'); return; }

  let html = '';
  let grandBasic=0, grandOT=0, grandOut=0, grandSun=0, grandGross=0;

  CONFIG.DRIVERS.forEach(name => {
    const s = calcMonthlySalary(allDuties, name, ym);
    grandBasic += s.basicSalary;
    grandOT    += s.overtimePay;
    grandOut   += s.outstationAllowance;
    grandSun   += s.sundayBonus;
    grandGross += s.grossSalary;

    const paid = allPayments.some(p => p['Driver Name'] === name && p['Month'] === ym);
    const statusBadge = paid
      ? `<span class="badge badge-green">✓ Paid</span>`
      : `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">Pending</span>`;

    html += `<tr>
      <td><strong>${name}</strong></td>
      <td style="text-align:center">${s.totalDuties}</td>
      <td>${fmtINR(s.basicSalary)}</td>
      <td>${fmtINR(s.overtimePay)}</td>
      <td>${fmtINR(s.outstationAllowance)}</td>
      <td>${fmtINR(s.sundayBonus)}</td>
      <td><strong style="color:var(--primary)">${fmtINR(s.grossSalary)}</strong></td>
      <td>${statusBadge}</td>
    </tr>`;
  });

  html += `<tr class="salary-row-total">
    <td><strong>TOTAL</strong></td><td></td>
    <td>${fmtINR(grandBasic)}</td>
    <td>${fmtINR(grandOT)}</td>
    <td>${fmtINR(grandOut)}</td>
    <td>${fmtINR(grandSun)}</td>
    <td><strong>${fmtINR(grandGross)}</strong></td>
    <td></td>
  </tr>`;

  el('salBody').innerHTML = html;
  renderSalaryBreakdown(ym);
}

function renderSalaryBreakdown(ym) {
  const driver = el('salDriver').value;
  const duties = allDuties.filter(d => {
    return (d['Duty Date'] || '').startsWith(ym) && (!driver || (d['Driver Name'] || '') === driver);
  }).sort((a,b) => (a['Duty Date']||'').localeCompare(b['Duty Date']||''));

  if (!duties.length) {
    el('salDetailBody').innerHTML = '<tr><td colspan="8" class="empty-cell">No duties for selected period</td></tr>';
    return;
  }

  el('salDetailBody').innerHTML = duties.map(d => {
    const a = calcDutyAllowance(d);
    return `<tr>
      <td>${fmtDate(d['Duty Date'])}${a.isSunday ? ' 🌟' : ''}</td>
      <td>${d['Driver Name'] || '—'}</td>
      <td><span class="badge badge-blue">${d['Duty Type'] || '—'}</span></td>
      <td>${fmtTimeRange(d)}</td>
      <td>${a.overtimeHours > 0 ? a.overtimeHours.toFixed(2) + ' h' : '—'}</td>
      <td>${a.overtimeAmount ? fmtINR(a.overtimeAmount) : '—'}</td>
      <td>${a.outstationAllowance ? fmtINR(a.outstationAllowance) + (a.outstationDays === 2 ? ' (×2)' : '') : '—'}</td>
      <td>${a.isSunday ? fmtINR(a.sundayBonus) : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Vendor report ──────────────────────────────────────────────────
function renderVendorReport() {
  const from = el('vFrom').value;
  const to   = el('vTo').value;

  const filtered = allDuties.filter(d => {
    if (from && (d['Duty Date']||'') < from) return false;
    if (to   && (d['Duty Date']||'') > to)   return false;
    return true;
  });

  const map = {};
  filtered.forEach(d => {
    const v = d['Vendor'] || 'Unknown';
    if (!map[v]) map[v] = { duties:[], km:0, types:{} };
    map[v].duties.push(d);
    map[v].km += +d['Total Km'] || 0;
    const t = d['Duty Type'] || '?';
    map[v].types[t] = (map[v].types[t] || 0) + 1;
  });

  if (!Object.keys(map).length) {
    el('vendorBody').innerHTML = '<tr><td colspan="5" class="empty-cell">No data for selected period</td></tr>';
    return;
  }

  el('vendorBody').innerHTML = Object.entries(map).map(([v, s]) => {
    const breakdown = Object.entries(s.types).map(([t,n]) => `${t}: ${n}`).join(' · ');
    return `<tr>
      <td><strong>${v}</strong></td>
      <td style="text-align:center">${s.duties.length}</td>
      <td>${breakdown}</td>
      <td>${s.km.toLocaleString('en-IN')} km</td>
      <td>${s.duties.map(d => `<span class="badge badge-blue" style="margin:2px">${d['Vendor Duty Number']||'N/A'}</span>`).join(' ')}</td>
    </tr>`;
  }).join('');
}

// ── Payment tracking ───────────────────────────────────────────────
function autoFillPayAmount() {
  const name = el('payDriver').value;
  const ym   = el('salMonth').value;
  if (name && ym) {
    const s = calcMonthlySalary(allDuties, name, ym);
    el('payAmount').value = s.grossSalary;
  }
}

async function recordPayment() {
  const name   = el('payDriver').value;
  const ym     = el('salMonth').value;
  const amount = parseFloat(el('payAmount').value);
  const date   = el('payDate').value;
  const mode   = el('payMode').value;
  const notes  = el('payNotes').value.trim();

  if (!name)   { alert('Select a driver.'); return; }
  if (!ym)     { alert('Select a month first using the salary calculator above.'); return; }
  if (!amount) { alert('Enter the payment amount.'); return; }
  if (!date)   { alert('Enter the payment date.'); return; }

  const btn = el('payBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'payment', driverName: name, month: ym, amount, paymentDate: date, mode, notes })
    });

    allPayments.push({
      'Driver Name': name, 'Month': ym, 'Amount': amount,
      'Payment Date': date, 'Mode': mode, 'Notes': notes
    });
    renderPaymentHistory();
    el('payNotes').value = '';
  } catch {
    alert('Failed to save. Check your connection.');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Record Payment';
  }
}

function renderPaymentHistory() {
  const tbody = el('paymentBody');
  if (!allPayments.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No payments recorded yet</td></tr>';
    return;
  }

  const sorted = [...allPayments].sort((a, b) =>
    (b['Payment Date'] || '').localeCompare(a['Payment Date'] || '')
  );

  tbody.innerHTML = sorted.map(p => {
    const [yr, mo] = (p['Month'] || '').split('-');
    const monthLabel = yr && mo
      ? new Date(+yr, +mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : (p['Month'] || '—');
    return `<tr>
      <td>${fmtDate(p['Payment Date'])}</td>
      <td>${p['Driver Name'] || '—'}</td>
      <td>${monthLabel}</td>
      <td><strong style="color:var(--success)">${fmtINR(p['Amount'])}</strong></td>
      <td>${p['Mode'] || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${p['Notes'] || '—'}</td>
    </tr>`;
  }).join('');
}

// ── Payslip ────────────────────────────────────────────────────────
async function generatePayslip() {
  const name = el('psDriver').value;
  const ym   = el('salMonth').value;

  if (!name) { alert('Select a driver first.'); return; }
  if (!ym)   { alert('Select a month and calculate salaries first.'); return; }

  const dedAccident = parseFloat(el('dedAccident').value) || 0;
  const dedChallan  = parseFloat(el('dedChallan').value)  || 0;
  const dedFine     = parseFloat(el('dedFine').value)     || 0;
  const dedExpense  = parseFloat(el('dedExpense').value)  || 0;
  const deductions  = dedAccident + dedChallan + dedFine + dedExpense;

  const s          = calcMonthlySalary(allDuties, name, ym);
  const totalAllow = s.overtimePay + s.outstationAllowance + s.sundayBonus;
  const netSalary  = s.grossSalary - deductions;

  const [yr, mo]  = ym.split('-');
  const monthLabel = new Date(+yr, +mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const today      = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  const inr = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const invoiceHeaderUrl = await (async () => {
    try {
      const resp = await fetch(new URL('Branding/Payslip-Header.png', location.href).href);
      const blob = await resp.blob();
      return await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
    } catch { return ''; }
  })();

  const row = (label, value, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td>${inr(value)}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payslip – ${name} – ${monthLabel}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;background:#fff}
  .page{max-width:680px;margin:32px auto;padding:40px;border:1px solid #d1d5db}
  @media print{
    body{margin:0}
    .page{margin:0;border:none;padding:32px;max-width:100%}
    .no-print{display:none!important}
  }
  .print-btn{display:block;margin:0 auto 28px;padding:9px 22px;background:#c9a84c;color:#0d0d0b;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}
  .logo-area{text-align:center;margin-bottom:20px}
  .co-name{font-size:18px;font-weight:700;color:#c9a84c;letter-spacing:.02em}
  .co-sub{font-size:11px;color:#6b7280;margin-top:2px}
  .divider{border:none;border-top:2px solid #c9a84c;margin:14px 0 6px}
  .slip-title{text-align:center;font-size:14px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#c9a84c;margin-bottom:4px}
  .slip-month{text-align:center;font-size:12px;color:#374151;margin-bottom:20px}
  .meta{display:flex;gap:0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:20px}
  .meta-item{flex:1;padding:10px 14px;border-right:1px solid #e5e7eb}
  .meta-item:last-child{border-right:none}
  .meta-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
  .meta-value{font-size:13px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  th{background:#c9a84c;color:#0d0d0b;padding:8px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  th:last-child{text-align:right}
  td{padding:8px 14px;border-bottom:1px solid #f3f4f6}
  td:last-child{text-align:right;font-weight:500}
  tr.section-head td{background:#f8fafc;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-top:1px solid #e5e7eb}
  tr.subtotal td{background:#fdf8ed;font-weight:600;color:#a8842a}
  tr.gross td{background:#f5e9c8;font-weight:700;color:#7a5e1a;font-size:14px}
  tr.deduct td{color:#dc2626}
  tr.net td{background:#c9a84c;color:#0d0d0b;font-weight:700;font-size:15px;border:none}
  .sig-area{display:flex;justify-content:space-between;margin-top:80px;padding-top:0}
  .sig-block{width:44%}
  .sig-line{border-top:1px solid #374151;margin-bottom:10px;margin-top:90px}
  .sig-label{font-size:11px;color:#6b7280}
  .sig-name{font-size:12px;font-weight:600;margin-top:3px}
  .footer-note{text-align:center;font-size:10px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:10px}
</style>
</head>
<body>
<div class="page">
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>

  <div class="logo-area">
    <img src="${invoiceHeaderUrl}" alt="Tresa Fleet Management" style="width:100%;height:auto;display:block">
  </div>

  <hr class="divider">
  <div class="slip-title">Salary Slip</div>
  <div class="slip-month">For the Month of ${monthLabel}</div>

  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Employee Name</div>
      <div class="meta-value">${name}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Designation</div>
      <div class="meta-value">Driver</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Duties This Month</div>
      <div class="meta-value">${s.totalDuties}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Pay Period</div>
      <div class="meta-value">${monthLabel}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody>
      <tr class="section-head"><td colspan="2">Earnings</td></tr>
      ${row('Basic Salary', s.basicSalary)}
      <tr class="section-head"><td colspan="2">Allowances</td></tr>
      ${row('Overtime Allowance', s.overtimePay)}
      ${row('Outstation Allowance', s.outstationAllowance)}
      ${row('Sunday Allowance', s.sundayBonus)}
      ${row('Total Allowance', totalAllow, 'subtotal')}
      ${row('Gross Salary', s.grossSalary, 'gross')}
      <tr class="section-head"><td colspan="2">Deductions</td></tr>
      ${dedAccident ? row('Accident',          dedAccident, 'deduct') : ''}
      ${dedChallan  ? row('Challan',           dedChallan,  'deduct') : ''}
      ${dedFine     ? row('Fine',              dedFine,     'deduct') : ''}
      ${dedExpense  ? row('Invalid Expenses',  dedExpense,  'deduct') : ''}
      ${!deductions ? `<tr class="deduct"><td>No deductions</td><td>—</td></tr>` : ''}
      ${deductions  ? row('Total Deductions',  deductions,  'subtotal') : ''}
      ${row('Net Salary Payable', netSalary, 'net')}
    </tbody>
  </table>

  <div class="sig-area">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Employee Signature</div>
      <div class="sig-name">${name}</div>
    </div>
    <div class="sig-block" style="text-align:right">
      <div class="sig-line"></div>
      <div class="sig-label">Authorised Signatory</div>
      <div class="sig-name">For Tresa Fleet Management Private Limited</div>
    </div>
  </div>

  <div class="footer-note">
    Generated on ${today} &nbsp;·&nbsp; This is a system-generated payslip.
  </div>
</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ── Tabs ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
  if (tabId === 'tabAttendance') renderAttendanceTab();
  if (tabId === 'tabInvoicing')  { renderInvPricing(); renderInvoicingDuties(); }
}

// ── Export CSV ─────────────────────────────────────────────────────
function exportCSV() {
  if (!allDuties.length) { alert('No data to export'); return; }
  const headers = Object.keys(allDuties[0]).filter(k => k !== '_flags');
  const csv = [
    headers.join(','),
    ...allDuties.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'tresa-duties-' + new Date().toISOString().split('T')[0] + '.csv'
  });
  a.click();
}

function refreshData() { loadData(); }

// ── Invoicing ───────────────────────────────────────────────────────

const INV_PRICING_KEY = 'invPricing';

const INV_PACKAGES = [
  { key: 'hourly',     label: '8 Hrs / 80 Kms', subLabel: 'Hourly Rental',  hasFixed: true  },
  { key: 'airport',    label: 'Airport Transfer', subLabel: 'Fixed package',  hasFixed: true  },
  { key: 'outstation', label: 'Outstation',        subLabel: 'Per KM rate',    hasFixed: false },
];

function calcOutstationPerDay() {
  const kmRate   = parseFloat(el('pOutstationKmRate').value) || 0;
  const minKmDay = parseFloat(el('pOutstationMinKm').value)  || 0;
  el('pOutstationPerDay').value = (kmRate && minKmDay) ? Math.round(kmRate * minKmDay) : '';
}

function getInvPricing() {
  try { return JSON.parse(localStorage.getItem(INV_PRICING_KEY)) || {}; } catch { return {}; }
}

function renderInvPricing() {
  const p = getInvPricing();
  el('invCgstPct').value = p.cgst    ?? 2.5;
  el('invSgstPct').value = p.sgst    ?? 2.5;
  el('invHsnCode').value = p.hsnCode ?? '9966';

  const h = p.hourly     || {};
  const a = p.airport    || {};
  const o = p.outstation || {};
  el('pHourlyBase').value    = h.basePrice ?? '';
  el('pAirportBase').value   = a.basePrice ?? '';
  el('pOutstationKmRate').value = o.kmRate      ?? '';
  el('pOutstationMinKm').value  = o.minKmPerDay ?? '';
  calcOutstationPerDay();
  el('pExtraKmRate').value   = p.extraKmRate ?? '';
  el('pExtraHrRate').value   = p.extraHrRate ?? '';

  // Populate driver filter once
  const sel = el('invDriverFilter');
  if (sel.options.length === 1) {
    CONFIG.DRIVERS.forEach(d => {
      const o = document.createElement('option');
      o.value = o.textContent = d;
      sel.appendChild(o);
    });
  }
}

function saveInvPricing() {
  const p = getInvPricing();
  p.cgst    = parseFloat(el('invCgstPct').value) || 0;
  p.sgst    = parseFloat(el('invSgstPct').value) || 0;
  p.hsnCode = el('invHsnCode').value.trim() || '9966';
  p.hourly     = { basePrice: parseFloat(el('pHourlyBase').value)  || 0 };
  p.airport    = { basePrice: parseFloat(el('pAirportBase').value) || 0 };
  p.outstation = {
    kmRate:      parseFloat(el('pOutstationKmRate').value) || 0,
    minKmPerDay: parseFloat(el('pOutstationMinKm').value)  || 0,
  };
  p.extraKmRate = parseFloat(el('pExtraKmRate').value) || 0;
  p.extraHrRate = parseFloat(el('pExtraHrRate').value) || 0;
  localStorage.setItem(INV_PRICING_KEY, JSON.stringify(p));
  const btn = document.querySelector('[onclick="saveInvPricing()"]');
  btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = 'Save Pricing', 1500);
}

// ── Duties table ────────────────────────────────────────────────────

let invFilteredDuties = [];
let currentInvDuty   = null;

function renderInvoicingDuties() {
  const driver = el('invDriverFilter').value;
  const month  = el('invMonthFilter').value;

  let duties = [...(allDuties || [])];
  if (driver) duties = duties.filter(d => d['Driver Name'] === driver);
  if (month)  duties = duties.filter(d => (d['Duty Date'] || '').startsWith(month));
  duties.sort((a, b) => (b['Duty Date'] || '') > (a['Duty Date'] || '') ? 1 : -1);

  invFilteredDuties = duties;
  el('invDutiesCount').textContent = `${duties.length} dut${duties.length === 1 ? 'y' : 'ies'}`;

  const tbody = el('invDutiesBody');
  if (!duties.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell"><div class="empty-icon">📋</div>No duties found</td></tr>';
    return;
  }
  tbody.innerHTML = duties.map((d, i) => {
    const km  = (parseFloat(d['End Km']) || 0) - (parseFloat(d['Start Km']) || 0);
    const dur = d['Duration (mins)'] ? fmtDuration2(+d['Duration (mins)']) : '—';
    return `<tr>
      <td>${fmtDate(d['Duty Date'])}</td>
      <td>${d['Driver Name'] || '—'}</td>
      <td>${d['Vehicle Number'] || '—'}</td>
      <td>${d['Vendor Duty Number'] || '—'}</td>
      <td>${d['Duty Type'] || '—'}</td>
      <td>${km} km</td>
      <td>${dur}</td>
      <td>${fmtINR(parseFloat(d['Total Expenses']) || 0)}</td>
      <td><button class="btn btn-outline" style="padding:5px 12px;font-size:12px;white-space:nowrap" onclick="openInvForm(${i})">Generate Invoice</button></td>
    </tr>`;
  }).join('');
}

// ── Invoice form ─────────────────────────────────────────────────────

const DUTY_TYPE_TO_PKG = {
  'Hourly Rental':         'hourly',
  'Day Use':               'hourly',
  'Airport Transfer':      'airport',
  'Outstation':            'outstation',
  'Outstation Round-Trip': 'outstation',
};

function openInvForm(idx) {
  currentInvDuty = invFilteredDuties[idx];
  const d = currentInvDuty;
  const p = getInvPricing();

  el('invFormSection').style.display = 'block';
  setTimeout(() => el('invFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  // Invoice number & date
  const now = new Date();
  el('invNumber').value = 'TFM' + String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  el('invDate').value = now.toISOString().split('T')[0];

  // Duty reference
  const km = (parseFloat(d['End Km']) || 0) - (parseFloat(d['Start Km']) || 0);
  el('invDutyRef').innerHTML = [
    `<span><strong>Date:</strong> ${d['Duty Date'] || '—'}</span>`,
    `<span><strong>Driver:</strong> ${d['Driver Name'] || '—'}</span>`,
    `<span><strong>Vehicle:</strong> ${d['Vehicle Number'] || '—'}</span>`,
    `<span><strong>Duty No.:</strong> ${d['Vendor Duty Number'] || '—'}</span>`,
    `<span><strong>Type:</strong> ${d['Duty Type'] || '—'}</span>`,
    `<span><strong>KM:</strong> ${km} km</span>`,
    `<span><strong>Duration:</strong> ${d['Duration (mins)'] ? fmtDuration2(+d['Duration (mins)']) : '—'}</span>`,
  ].join('');

  // Map duty type to package key and pre-fill pricing
  const pkgKey  = DUTY_TYPE_TO_PKG[d['Duty Type']] || 'hourly';
  const pkgData = p[pkgKey] || {};
  el('invPkgType').value  = pkgKey;
  el('invPkgDesc').value  = '';
  el('invExtraKm').value  = '';
  el('invExtraHr').value  = '';

  if (pkgKey === 'outstation') {
    const perDay = Math.round((pkgData.kmRate || 0) * (pkgData.minKmPerDay || 0));
    el('invOutDays').value        = 1;
    el('invOutPerDayRate').value  = perDay || '';
    el('invOutMinKmPerDay').value = pkgData.minKmPerDay || '';
    el('invOutActualKm').value    = km || '';
    el('invOutExtraKmRate').value = pkgData.kmRate || '';
  } else {
    el('invPkgCost').value     = pkgData.basePrice || '';
    el('invExtraKmRate').value = p.extraKmRate     || '';
    el('invExtraHrRate').value = p.extraHrRate     || '';
  }

  // Pre-fill expenses from duty
  el('invParking').value      = parseFloat(d['Parking'])        || 0;
  el('invToll').value         = parseFloat(d['Toll'])           || 0;
  el('invStateTax').value     = parseFloat(d['State Tax'])      || 0;
  el('invMcd').value          = parseFloat(d['MCD'])            || 0;
  el('invMisc').value         = parseFloat(d['Miscellaneous'])  || 0;
  el('invDriverAllow').value  = 0;
  el('invDiscount').value     = 0;
  el('invComments').value     = '';
  el('invCustName').value     = '';
  el('invCustCompany').value  = '';
  el('invCustContact').value  = '';
  el('invCustEmail').value    = '';
  el('invPickupAddr').value   = '';
  el('invBillingAddr').value  = '';
  el('invErrMsg').style.display = 'none';

  onInvPkgTypeChange();
}

function onInvPkgTypeChange() {
  const pkgKey  = el('invPkgType').value;
  const isOut   = pkgKey === 'outstation';
  const p       = getInvPricing();
  const pkgData = p[pkgKey] || {};

  el('invFixedPkg').style.display      = isOut ? 'none'  : 'block';
  el('invOutstationPkg').style.display = isOut ? 'block' : 'none';

  if (isOut) {
    const perDay = Math.round((pkgData.kmRate || 0) * (pkgData.minKmPerDay || 0));
    el('invOutPerDayRate').value  = perDay || '';
    el('invOutMinKmPerDay').value = pkgData.minKmPerDay || '';
    el('invOutExtraKmRate').value = pkgData.kmRate      || '';
  } else {
    el('invPkgCost').value     = pkgData.basePrice || '';
    el('invExtraKmRate').value = p.extraKmRate     || '';
    el('invExtraHrRate').value = p.extraHrRate     || '';
  }
  updateInvTotal();
}

function closeInvForm() {
  el('invFormSection').style.display = 'none';
  currentInvDuty = null;
}

function updateInvTotal() {
  const pkgKey  = el('invPkgType').value;
  const isOut   = pkgKey === 'outstation';
  const p       = getInvPricing();
  const cgstPct = p.cgst ?? 2.5;
  const sgstPct = p.sgst ?? 2.5;

  let pkgCost = 0, extraKmCost = 0, extraHrCost = 0;
  let extraKm = 0, extraKmRate = 0, extraHr = 0, extraHrRate = 0;
  let outPerKmRate = 0, outActualKm = 0;

  if (isOut) {
    const days       = +el('invOutDays').value        || 0;
    const dayRate    = +el('invOutPerDayRate').value   || 0;
    const minKmDay   = +el('invOutMinKmPerDay').value  || 0;
    const actualKm   = +el('invOutActualKm').value     || 0;
    const exKmRate   = +el('invOutExtraKmRate').value  || 0;
    const baseCost   = days * dayRate;
    const includedKm = days * minKmDay;
    const extraKmOut = Math.max(0, actualKm - includedKm);
    const extraKmOutCost = extraKmOut * exKmRate;
    pkgCost = baseCost + extraKmOutCost;

    el('invOutBaseCost').value   = Math.round(baseCost);
    el('invOutIncludedKm').value = includedKm;
    el('invOutExtraKm').value    = extraKmOut;
    el('invOutExtraKmCost').value = Math.round(extraKmOutCost);

    // store for summary rendering
    outPerKmRate = dayRate; outActualKm = actualKm;
    // reuse outPerKmRate/outActualKm vars for summary label below via closure
    const _days = days, _dayRate = dayRate, _incKm = includedKm,
          _actKm = actualKm, _exKm = extraKmOut, _exKmRate = exKmRate,
          _baseCost = baseCost, _exKmCost = extraKmOutCost;

    const parking     = +el('invParking').value     || 0;
    const toll        = +el('invToll').value        || 0;
    const stateTax    = +el('invStateTax').value    || 0;
    const mcd         = +el('invMcd').value         || 0;
    const misc        = +el('invMisc').value        || 0;
    const driverAllow = +el('invDriverAllow').value || 0;
    const discount    = +el('invDiscount').value    || 0;
    const p2          = getInvPricing();
    const cgstPct2    = p2.cgst ?? 2.5;
    const sgstPct2    = p2.sgst ?? 2.5;
    const net2   = pkgCost + parking + toll + stateTax + mcd + misc + driverAllow - discount;
    const cgst2  = net2 * cgstPct2 / 100;
    const sgst2  = net2 * sgstPct2 / 100;
    const gross2 = net2 + cgst2 + sgst2;
    const row2 = (label, val) =>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${label}</span><span>${fmtINR(val)}</span></div>`;
    el('invSummary').innerHTML = `<div style="max-width:420px;margin-left:auto">
      ${row2(`Outstation Base (${_days} day${_days>1?'s':''} × ₹${_dayRate}/day)`, _baseCost)}
      ${_exKmCost ? row2(`Extra KM (${_exKm} km × ₹${_exKmRate}/km) <span style="font-size:11px;color:var(--text-muted)">incl. ${_incKm} km</span>`, _exKmCost) : ''}
      ${parking     ? row2('Parking', parking) : ''}
      ${toll        ? row2('Toll', toll) : ''}
      ${stateTax    ? row2('State Tax', stateTax) : ''}
      ${mcd         ? row2('Delhi MCD', mcd) : ''}
      ${misc        ? row2('Miscellaneous', misc) : ''}
      ${driverAllow ? row2('Driver Allowance', driverAllow) : ''}
      ${discount    ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--error)"><span>Discount</span><span>− ${fmtINR(discount)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-weight:600"><span>Net Total</span><span>${fmtINR(net2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-muted)"><span>CGST @ ${cgstPct2}%</span><span>${fmtINR(cgst2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-muted)"><span>SGST @ ${sgstPct2}%</span><span>${fmtINR(sgst2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:17px;font-weight:700"><span>Gross Total</span><span>${fmtINR(gross2)}</span></div>
    </div>`;
    return;
  } else {
    pkgCost     = +el('invPkgCost').value      || 0;
    extraKmRate = +el('invExtraKmRate').value  || 0;
    extraKm     = +el('invExtraKm').value      || 0;
    extraHrRate = +el('invExtraHrRate').value  || 0;
    extraHr     = +el('invExtraHr').value      || 0;
    extraKmCost = extraKmRate * extraKm;
    extraHrCost = extraHrRate * extraHr;
    el('invExtraKmCost').value = Math.round(extraKmCost);
    el('invExtraHrCost').value = Math.round(extraHrCost);
  }

  const parking     = +el('invParking').value     || 0;
  const toll        = +el('invToll').value        || 0;
  const stateTax    = +el('invStateTax').value    || 0;
  const mcd         = +el('invMcd').value         || 0;
  const misc        = +el('invMisc').value        || 0;
  const driverAllow = +el('invDriverAllow').value || 0;
  const discount    = +el('invDiscount').value    || 0;

  const net   = pkgCost + extraKmCost + extraHrCost + parking + toll + stateTax + mcd + misc + driverAllow - discount;
  const cgst  = net * cgstPct / 100;
  const sgst  = net * sgstPct / 100;
  const gross = net + cgst + sgst;

  const row = (label, val) =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${label}</span><span>${fmtINR(val)}</span></div>`;

  el('invSummary').innerHTML = `<div style="max-width:420px;margin-left:auto">
    ${row('Package Cost', pkgCost)}
    ${extraKmCost ? row(`Extra KM (${extraKm} km × ₹${extraKmRate})`, extraKmCost) : ''}
    ${extraHrCost ? row(`Extra Hours (${extraHr} hr × ₹${extraHrRate})`, extraHrCost) : ''}
    ${parking     ? row('Parking', parking) : ''}
    ${toll        ? row('Toll', toll) : ''}
    ${stateTax    ? row('State Tax', stateTax) : ''}
    ${mcd         ? row('Delhi MCD', mcd) : ''}
    ${misc        ? row('Miscellaneous', misc) : ''}
    ${driverAllow ? row('Driver Allowance', driverAllow) : ''}
    ${discount    ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--error)"><span>Discount</span><span>− ${fmtINR(discount)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-weight:600"><span>Net Total</span><span>${fmtINR(net)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-muted)"><span>CGST @ ${cgstPct}%</span><span>${fmtINR(cgst)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-muted)"><span>SGST @ ${sgstPct}%</span><span>${fmtINR(sgst)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:17px;font-weight:700"><span>Gross Total</span><span>${fmtINR(gross)}</span></div>
  </div>`;
}

// ── Generate Invoice (print window) ─────────────────────────────────

async function generateInvoice() {
  const custName = el('invCustName').value.trim();
  const pkgKey   = el('invPkgType').value;
  const isOut    = pkgKey === 'outstation';

  if (!custName) {
    el('invErrMsg').textContent = '❌ Customer name is required.';
    el('invErrMsg').style.display = 'block'; return;
  }

  let pkgCost = 0, extraKmCost = 0, extraHrCost = 0;
  let extraKm = 0, extraKmRate = 0, extraHr = 0, extraHrRate = 0;
  let outDays = 0, outDayRate = 0, outIncludedKm = 0, outActualKm = 0,
      outExtraKm = 0, outExtraKmRate = 0, outBaseCost = 0, outExtraKmCost = 0;

  if (isOut) {
    const days      = +el('invOutDays').value        || 0;
    const dayRate   = +el('invOutPerDayRate').value   || 0;
    const minKmDay  = +el('invOutMinKmPerDay').value  || 0;
    const actualKm  = +el('invOutActualKm').value     || 0;
    const exKmRate  = +el('invOutExtraKmRate').value  || 0;
    outDays = days; outDayRate = dayRate; outActualKm = actualKm; outExtraKmRate = exKmRate;
    outBaseCost   = days * dayRate;
    outIncludedKm = days * minKmDay;
    outExtraKm    = Math.max(0, actualKm - outIncludedKm);
    outExtraKmCost = outExtraKm * exKmRate;
    pkgCost = outBaseCost + outExtraKmCost;
    if (dayRate <= 0) {
      el('invErrMsg').textContent = '❌ Set the Outstation KM Rate and Min KM per Day in Package Pricing first.';
      el('invErrMsg').style.display = 'block'; return;
    }
    if (days <= 0) {
      el('invErrMsg').textContent = '❌ Number of Days is required.';
      el('invErrMsg').style.display = 'block'; return;
    }
  } else {
    pkgCost     = +el('invPkgCost').value     || 0;
    extraKmRate = +el('invExtraKmRate').value || 0;
    extraKm     = +el('invExtraKm').value     || 0;
    extraHrRate = +el('invExtraHrRate').value || 0;
    extraHr     = +el('invExtraHr').value     || 0;
    extraKmCost = extraKmRate * extraKm;
    extraHrCost = extraHrRate * extraHr;
    if (pkgCost <= 0) {
      el('invErrMsg').textContent = '❌ Package Cost is required and must be greater than ₹0.';
      el('invErrMsg').style.display = 'block'; return;
    }
  }
  el('invErrMsg').style.display = 'none';

  const d       = currentInvDuty || {};
  const p       = getInvPricing();
  const cgstPct = p.cgst ?? 2.5;
  const sgstPct = p.sgst ?? 2.5;
  const parking     = +el('invParking').value     || 0;
  const toll        = +el('invToll').value        || 0;
  const stateTax    = +el('invStateTax').value    || 0;
  const mcd         = +el('invMcd').value         || 0;
  const misc        = +el('invMisc').value        || 0;
  const driverAllow = +el('invDriverAllow').value || 0;
  const discount    = +el('invDiscount').value    || 0;
  const net         = pkgCost + extraKmCost + extraHrCost + parking + toll + stateTax + mcd + misc + driverAllow - discount;
  const cgst        = net * cgstPct / 100;
  const sgst        = net * sgstPct / 100;
  const gross       = net + cgst + sgst;
  const hsnCode     = p.hsnCode || '9966';
  const inr         = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const today       = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
  const km          = (parseFloat(d['End Km']) || 0) - (parseFloat(d['Start Km']) || 0);

  const headerUrl = await (async () => {
    try {
      const resp = await fetch(new URL('Branding/Payslip-Header.png', location.href).href);
      const blob = await resp.blob();
      return await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
    } catch { return ''; }
  })();

  const trow = (label, val, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td style="text-align:right;font-weight:500">${inr(val)}</td></tr>`;

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<title>Invoice – ${el('invNumber').value} – ${custName}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;background:#fff}
  .page{max-width:720px;margin:24px auto;padding:40px;border:1px solid #d1d5db}
  @media print{body{margin:0}.page{margin:0;border:none;padding:32px;max-width:100%}.no-print{display:none!important}}
  .print-btn{display:block;margin:0 auto 24px;padding:9px 22px;background:#c9a84c;color:#0d0d0b;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}
  .header-img{width:100%;height:auto;display:block;margin-bottom:18px}
  .inv-meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #c9a84c}
  .inv-no{font-size:20px;font-weight:700;color:#111}
  .inv-date{font-size:12px;color:#6b7280;margin-top:3px}
  .status-badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;background:#fef3c7;color:#92400e;letter-spacing:.04em}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}
  .detail-box{background:#f9fafb;border-radius:6px;padding:14px 16px}
  .detail-box h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:10px}
  .detail-row{display:flex;flex-direction:column;margin-bottom:6px;font-size:13px}
  .detail-label{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
  .detail-value{font-weight:600;color:#111;margin-top:1px}
  .pkg-box{background:#f3f4f6;border-radius:6px;padding:12px 16px;margin-bottom:18px;font-size:13px}
  .pkg-box strong{font-size:14px}
  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  th{background:#111;color:#fff;padding:8px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  th:last-child{text-align:right}
  td{padding:8px 14px;border-bottom:1px solid #f3f4f6;font-size:13px}
  tr.section-head td{background:#f8fafc;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-top:1px solid #e5e7eb}
  tr.subtotal td{background:#f3f4f6;font-weight:600}
  tr.deduct td{color:#dc2626}
  tr.net-row td{font-weight:700;font-size:14px;border-top:2px solid #111}
  tr.gst-row td{color:#6b7280;font-size:12px}
  tr.gross-row td{background:#c9a84c;color:#0d0d0b;font-weight:700;font-size:15px;border:none}
  .comments{font-size:12px;color:#6b7280;margin:12px 0 24px;font-style:italic}
  .sig-area{display:flex;justify-content:space-between;margin-top:60px}
  .sig-block{width:44%}
  .sig-line{border-top:1px solid #374151;margin-top:80px;margin-bottom:6px}
  .sig-label{font-size:11px;color:#6b7280}
  .sig-name{font-size:12px;font-weight:600;margin-top:3px}
  .footer-note{text-align:center;font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:10px}
  .gst-no{font-size:11px;color:#6b7280;text-align:center;margin-top:4px}
</style></head><body>
<div class="page">
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  ${headerUrl ? `<img src="${headerUrl}" class="header-img" alt="Tresa Fleet Management">` : '<div style="text-align:center;font-size:20px;font-weight:700;color:#c9a84c;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #c9a84c">TRESA FLEET MANAGEMENT PRIVATE LIMITED</div>'}

  <div class="inv-meta">
    <div>
      <div class="inv-no">Invoice No. ${el('invNumber').value || '—'}</div>
      <div class="inv-date">Date: ${el('invDate').value || today}</div>
    </div>
    <span class="status-badge">NOT PAID</span>
  </div>

  <div class="two-col">
    <div class="detail-box">
      <h3>Customer Details</h3>
      <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${custName}</span></div>
      ${el('invCustCompany').value ? `<div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${el('invCustCompany').value}</span></div>` : ''}
      ${el('invCustContact').value ? `<div class="detail-row"><span class="detail-label">Contact</span><span class="detail-value">${el('invCustContact').value}</span></div>` : ''}
      ${el('invCustEmail').value   ? `<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${el('invCustEmail').value}</span></div>` : ''}
      ${el('invBillingAddr').value ? `<div class="detail-row"><span class="detail-label">Billing Address</span><span class="detail-value">${el('invBillingAddr').value}</span></div>` : ''}
    </div>
    <div class="detail-box">
      <h3>Driver &amp; Vehicle</h3>
      <div class="detail-row"><span class="detail-label">Driver</span><span class="detail-value">${d['Driver Name'] || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Vehicle</span><span class="detail-value">${d['Vehicle Number'] || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Duty Date</span><span class="detail-value">${d['Duty Date'] || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Vendor Duty No.</span><span class="detail-value">${d['Vendor Duty Number'] || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">KM Driven</span><span class="detail-value">${km} km</span></div>
      ${d['Duration (mins)'] ? `<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${fmtDuration2(+d['Duration (mins)'])}</span></div>` : ''}
    </div>
  </div>

  <div class="pkg-box">
    <strong>${el('invPkgType').selectedOptions[0].text}</strong>${el('invPkgDesc').value ? ' — ' + el('invPkgDesc').value : ''}
    ${el('invPickupAddr').value ? `<div style="margin-top:6px;font-size:12px;color:#6b7280">📍 Pickup: ${el('invPickupAddr').value}</div>` : ''}
  </div>

  <table>
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody>
      ${isOut
        ? trow(`Outstation Base &nbsp;<span style="font-size:11px;color:#9ca3af">(${outDays} day${outDays>1?'s':''} × ₹${outDayRate}/day · ${outIncludedKm} km incl.)</span>`, outBaseCost)
        : trow('Package Cost', pkgCost)
      }
      ${isOut && outExtraKmCost ? trow(`Additional KM &nbsp;<span style="font-size:11px;color:#9ca3af">(${outExtraKm} km × ₹${outExtraKmRate}/km)</span>`, outExtraKmCost) : ''}
      ${!isOut && extraKmCost ? trow(`Additional KM &nbsp;<span style="font-size:11px;color:#9ca3af">(${extraKm} km × ₹${extraKmRate}/km)</span>`, extraKmCost) : ''}
      ${!isOut && extraHrCost ? trow(`Additional Hours &nbsp;<span style="font-size:11px;color:#9ca3af">(${extraHr} hr × ₹${extraHrRate}/hr)</span>`, extraHrCost) : ''}
      ${parking   ? trow('Parking', parking) : ''}
      ${toll      ? trow('Toll', toll) : ''}
      ${stateTax  ? trow('State Tax', stateTax) : ''}
      ${mcd       ? trow('Delhi MCD', mcd) : ''}
      ${misc      ? trow('Miscellaneous', misc) : ''}
      ${driverAllow ? trow('Driver Allowance', driverAllow) : ''}
      ${discount  ? `<tr class="deduct"><td>Discount</td><td style="text-align:right;font-weight:500">− ${inr(discount)}</td></tr>` : ''}
      <tr class="net-row"><td>Net Total &nbsp;<span style="font-size:10px;font-weight:400;color:#9ca3af">HSN ${hsnCode}</span></td><td style="text-align:right">${inr(net)}</td></tr>
      <tr class="gst-row"><td>CGST @ ${cgstPct}%</td><td style="text-align:right">${inr(cgst)}</td></tr>
      <tr class="gst-row"><td>SGST @ ${sgstPct}%</td><td style="text-align:right">${inr(sgst)}</td></tr>
      <tr class="gross-row"><td>GROSS TOTAL</td><td style="text-align:right">${inr(gross)}</td></tr>
    </tbody>
  </table>

  ${el('invComments').value ? `<div class="comments">Note: ${el('invComments').value}</div>` : ''}

  <div class="sig-area">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Customer Signature</div>
      <div class="sig-name">${custName}</div>
    </div>
    <div class="sig-block" style="text-align:right">
      <div class="sig-line"></div>
      <div class="sig-label">Authorised Signatory</div>
      <div class="sig-name">For Tresa Fleet Management Private Limited</div>
    </div>
  </div>

  <div class="footer-note">Thank you for choosing Tresa Fleet. We look forward to serving you again.</div>
  <div class="gst-no">GST No: 06AALCT8104G1ZB &nbsp;·&nbsp; Generated on ${today}</div>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ── Edit / Delete duties ───────────────────────────────────────────

function openEditModal(d) {
  const existing = document.getElementById('editDutyModal');
  if (existing) existing.remove();

  const opts = (items, sel) => items.map(v =>
    `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  const fld = (label, id, type, val, extra = '') =>
    `<div class="field"><label>${label}</label><input type="${type}" id="${id}" value="${val}" ${extra}></div>`;

  const modal = document.createElement('div');
  modal.id = 'editDutyModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
  <div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:700px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h3 style="margin:0;font-size:17px">Edit Duty Record</h3>
      <button type="button" onclick="closeEditModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1">×</button>
    </div>
    <div style="font-size:11px;color:#9ca3af;margin-bottom:16px">Submitted: ${d['Timestamp'] || '—'}</div>
    <input type="hidden" id="editTs" value="${d['Timestamp'] || ''}">

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="field"><label>Driver</label><select id="editDriver">${opts(CONFIG.DRIVERS, d['Driver Name'])}</select></div>
      <div class="field"><label>Vehicle</label><select id="editVehicle">${opts(CONFIG.VEHICLES, d['Vehicle Number'])}</select></div>
      ${fld('Duty Date', 'editDutyDate', 'date', d['Duty Date'] || '')}
      <div class="field"><label>Duty Type</label><select id="editDutyType">${opts(CONFIG.DUTY_TYPES, d['Duty Type'])}</select></div>
      <div class="field"><label>Vendor</label><select id="editVendor">${opts(CONFIG.VENDORS, d['Vendor'])}</select></div>
      ${fld('Vendor Duty No.', 'editVendorNo', 'text', d['Vendor Duty Number'] || '')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      ${fld('Start Km', 'editStartKm', 'number', d['Start Km'] || 0)}
      ${fld('Start Date', 'editStartDate', 'date', d['Start Date'] || d['Duty Date'] || '')}
      ${fld('Start Time', 'editStartTime', 'time', d['Start Time'] || '')}
      ${fld('End Km', 'editEndKm', 'number', d['End Km'] || 0)}
      ${fld('End Date', 'editEndDate', 'date', d['End Date'] || d['Duty Date'] || '')}
      ${fld('End Time', 'editEndTime', 'time', d['End Time'] || '')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px">
      ${fld('Parking', 'editParking', 'number', d['Parking'] || 0, 'min=0')}
      ${fld('MCD', 'editMcd', 'number', d['MCD'] || 0, 'min=0')}
      ${fld('Toll', 'editToll', 'number', d['Toll'] || 0, 'min=0')}
      ${fld('State Tax', 'editStateTax', 'number', d['State Tax'] || 0, 'min=0')}
      ${fld('Misc', 'editMisc', 'number', d['Miscellaneous'] || 0, 'min=0')}
    </div>

    <div style="margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="editFuelCb" ${d['Filled Fuel'] === 'Yes' ? 'checked' : ''} onchange="toggleEditFuel()">
        Fuel filled on this duty
      </label>
      <div id="editFuelRow" style="display:${d['Filled Fuel'] === 'Yes' ? 'grid' : 'none'};grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
        ${fld('Fuel Amount (₹)', 'editFuelAmt', 'number', d['Fuel Amount'] || 0, 'min=0')}
        ${fld('Fuel Litres', 'editFuelL', 'number', d['Fuel Litres'] || 0, 'min=0')}
        ${fld('Fuel Odometer', 'editFuelOdo', 'number', d['Fuel Odometer Reading'] || 0, 'min=0')}
      </div>
    </div>

    <div id="editErr" class="alert alert-error" style="display:none;margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="closeEditModal()">Cancel</button>
      <button class="btn btn-primary" id="editSaveBtn" onclick="submitEditDuty(event)">Save Changes</button>
    </div>
  </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) closeEditModal(); });
  document.body.appendChild(modal);
}

function closeEditModal() {
  const m = document.getElementById('editDutyModal');
  if (m) m.remove();
}

function toggleEditFuel() {
  document.getElementById('editFuelRow').style.display =
    document.getElementById('editFuelCb').checked ? 'grid' : 'none';
}

async function submitEditDuty(e) {
  e.preventDefault();
  const btn  = document.getElementById('editSaveBtn');
  const errEl = document.getElementById('editErr');
  errEl.style.display = 'none';

  const startKm = parseFloat(document.getElementById('editStartKm').value) || 0;
  const endKm   = parseFloat(document.getElementById('editEndKm').value)   || 0;
  if (endKm < startKm) {
    errEl.textContent = 'End Km must be ≥ Start Km'; errEl.style.display = 'block'; return;
  }
  btn.disabled = true; btn.textContent = 'Saving…';

  const fuel = document.getElementById('editFuelCb').checked;
  const payload = {
    action:           'editDuty',
    timestamp:        document.getElementById('editTs').value,
    driverName:       document.getElementById('editDriver').value,
    vehicleNumber:    document.getElementById('editVehicle').value,
    dutyDate:         document.getElementById('editDutyDate').value,
    dutyType:         document.getElementById('editDutyType').value,
    vendor:           document.getElementById('editVendor').value,
    vendorDutyNumber: document.getElementById('editVendorNo').value,
    startKm, startDate: document.getElementById('editStartDate').value,
    startTime:        document.getElementById('editStartTime').value,
    endKm,   endDate:   document.getElementById('editEndDate').value,
    endTime:          document.getElementById('editEndTime').value,
    parking:          parseFloat(document.getElementById('editParking').value)  || 0,
    mcd:              parseFloat(document.getElementById('editMcd').value)      || 0,
    toll:             parseFloat(document.getElementById('editToll').value)     || 0,
    stateTax:         parseFloat(document.getElementById('editStateTax').value) || 0,
    miscellaneous:    parseFloat(document.getElementById('editMisc').value)     || 0,
    filledFuel: fuel,
    fuelAmount:  fuel ? (parseFloat(document.getElementById('editFuelAmt').value)  || 0) : null,
    fuelLitres:  fuel ? (parseFloat(document.getElementById('editFuelL').value)    || 0) : null,
    fuelOdometer:fuel ? (parseFloat(document.getElementById('editFuelOdo').value)  || 0) : null,
    manualSlip: false, manualSlipNo: ''
  };

  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) { closeEditModal(); await loadData(); }
    else throw new Error(json.error || 'Unknown error');
  } catch (err) {
    errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

async function deleteDuty(timestamp, label) {
  if (!confirm(`Delete duty: ${label}?\n\nThis cannot be undone.`)) return;
  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'deleteDuty', timestamp })
    });
    const json = await res.json();
    if (json.success) { await loadData(); }
    else alert('Delete failed: ' + (json.error || 'Unknown error'));
  } catch (err) { alert('Error: ' + err.message); }
}

async function bulkDeleteDuties() {
  const driver = el('bulkDelDriver').value;
  const from   = el('bulkDelFrom').value;
  const to     = el('bulkDelTo').value;

  if (!driver) { alert('Please select a driver.'); return; }
  if (!from || !to) { alert('Please select a date range.'); return; }
  if (from > to) { alert('"From" date must be on or before "To" date.'); return; }

  const matching = allDuties.filter(d => {
    const dd = d['Duty Date'] || '';
    return (d['Driver Name'] || '') === driver && dd >= from && dd <= to;
  });

  if (!matching.length) {
    alert(`No duties found for ${driver} between ${from} and ${to}.`);
    return;
  }

  if (!confirm(
    `Delete ${matching.length} dut${matching.length === 1 ? 'y' : 'ies'} for ${driver}\n` +
    `from ${from} to ${to}?\n\nThis cannot be undone.`
  )) return;

  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'bulkDeleteDuties', driverName: driver, fromDate: from, toDate: to })
    });
    const json = await res.json();
    if (json.success) {
      alert(`Deleted ${json.count} dut${json.count === 1 ? 'y' : 'ies'}.`);
      await loadData();
    } else {
      alert('Error: ' + (json.error || 'Unknown error'));
    }
  } catch (err) { alert('Error: ' + err.message); }
}

// ── Helpers ────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return s; }
}

function fmtTimeRange(d) {
  const st = d['Start Time'] || '';
  const et = d['End Time']   || '';
  const sd = d['Start Date'] || d['Duty Date'] || '';
  const ed = d['End Date']   || d['Duty Date'] || '';
  const short = s => {
    try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short' }); }
    catch { return s; }
  };
  if (!st && !et) return '—';
  if (sd && ed && sd !== ed) {
    return `${st} <span style="font-size:11px;color:var(--text-muted)">${short(sd)}</span> – ${et} <span style="font-size:11px;color:var(--text-muted)">${short(ed)}</span>`;
  }
  const dateLabel = sd ? `<div style="font-size:11px;color:var(--text-muted)">${short(sd)}</div>` : '';
  return `${dateLabel}${st || '—'} – ${et || '—'}`;
}

function fmtDuration2(mins) {
  if (mins === '' || mins === undefined || mins === null) return '—';
  const m = Math.round(+mins);
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
