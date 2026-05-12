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
  populateFilter('payDriver', CONFIG.DRIVERS);

  // Default payment date to today
  el('payDate').value = new Date().toISOString().split('T')[0];

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
    if (d['Duty Type'] !== 'Outstation') {
      const a = calcDutyAllowance(d);
      if (a.overtimeHours > 4) flags.push({ type: 'high_ot', label: `${a.overtimeHours.toFixed(1)}h OT` });
    }

    // No attendance check-in on duty day (Beta — only shown when attendance data is loaded)
    if (allAttendance.length > 0 && d['Duty Date'] && d['Driver Name']) {
      const hasCheckin = allAttendance.some(a =>
        a['Driver Name'] === d['Driver Name'] &&
        a['Action']      === 'Check-in' &&
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
    counts.no_att  && `📍 ${counts.no_att} missing check-in (Beta)`
  ].filter(Boolean).join(' · ');

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong style="color:#92400e;white-space:nowrap">⚠️ ${bad.length} dut${bad.length > 1 ? 'ies' : 'y'} flagged</strong>
      <span style="color:#78350f;font-size:13px">${parts}</span>
    </div>`;
}

// ── Duties table ───────────────────────────────────────────────────
const FLAG_STYLE = {
  late:    { bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  km_gap:  { bg: '#fee2e2', color: '#991b1b', border: '#dc2626' },
  high_ot: { bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  no_att:  { bg: '#f3f4f6', color: '#4b5563', border: '#9ca3af' }
};

function renderDuties(duties) {
  el('dutiesCount').textContent = duties.length + ' duties';
  if (!duties.length) {
    el('dutiesBody').innerHTML =
      '<tr><td colspan="12" class="empty-cell"><div class="empty-icon">📋</div>No duties found</td></tr>';
    return;
  }

  el('dutiesBody').innerHTML = duties.map(d => {
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
    ((b['Date'] || '') + (b['Time'] || '')).localeCompare((a['Date'] || '') + (a['Time'] || ''))
  );

  tbody.innerHTML = sorted.map(r => {
    const isIn = r['Action'] === 'Check-in';
    const lat  = parseFloat(r['Latitude']);
    const lng  = parseFloat(r['Longitude']);
    return `<tr>
      <td>${fmtDate(r['Date'])}</td>
      <td>${r['Driver Name'] || '—'}</td>
      <td><span style="font-weight:600;color:${isIn ? '#16a34a' : '#dc2626'}">${isIn ? '▶' : '⏹'} ${r['Action']}</span></td>
      <td>${r['Time'] || '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${!isNaN(lat) ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : '—'}</td>
    </tr>`;
  }).join('');
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
      const resp = await fetch(new URL('Branding/Invoice%20Header.png', location.href).href);
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
  .sig-area{display:flex;justify-content:space-between;margin-top:52px;padding-top:0}
  .sig-block{width:44%}
  .sig-line{border-top:1px solid #374151;margin-bottom:6px}
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
  if (!st && !et) return '—';
  if (sd && ed && sd !== ed) {
    const short = s => {
      try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short' }); }
      catch { return s; }
    };
    return `${st} <span style="font-size:11px;color:var(--text-muted)">${short(sd)}</span> – ${et} <span style="font-size:11px;color:var(--text-muted)">${short(ed)}</span>`;
  }
  return `${st || '—'} – ${et || '—'}`;
}

function fmtDuration2(mins) {
  if (mins === '' || mins === undefined || mins === null) return '—';
  const m = Math.round(+mins);
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
