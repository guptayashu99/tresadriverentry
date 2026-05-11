/* Dashboard logic — runs on dashboard.html */

let allDuties = [];

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

  // Populate filter dropdowns
  populateFilter('fDriver',   CONFIG.DRIVERS,    'All Drivers');
  populateFilter('fVendor',   CONFIG.VENDORS,    'All Vendors');
  populateFilter('fType',     CONFIG.DUTY_TYPES, 'All Types');
  populateFilter('salDriver', CONFIG.DRIVERS,    'All Drivers');

  // Default date range = current month
  const now = new Date();
  document.getElementById('fFrom').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  document.getElementById('fTo').value   = now.toISOString().split('T')[0];

  // Salary month picker default
  document.getElementById('salMonth').value =
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // Filter listeners
  ['fFrom','fTo','fDriver','fVendor','fType'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters)
  );

  loadData();
}

function populateFilter(id, items, placeholder) {
  const sel = document.getElementById(id);
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
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL);
    const json = await res.json();
    allDuties  = json.success ? (json.data || []) : [];
    applyFilters();
  } catch {
    document.getElementById('dutiesBody').innerHTML =
      '<tr><td colspan="11" class="empty-cell">❌ Could not load data. Check your API URL.</td></tr>';
  }
}

function setTableLoading(on) {
  if (on) {
    document.getElementById('dutiesBody').innerHTML =
      '<tr><td colspan="11" class="loading-cell"><div class="spinner"></div>Loading…</td></tr>';
    document.getElementById('driverCards').innerHTML =
      '<div class="loading-cell" style="grid-column:1/-1"><div class="spinner"></div></div>';
  }
}

// ── Filters ────────────────────────────────────────────────────────
function applyFilters() {
  const driver = document.getElementById('fDriver').value;
  const vendor = document.getElementById('fVendor').value;
  const type   = document.getElementById('fType').value;
  const from   = document.getElementById('fFrom').value;
  const to     = document.getElementById('fTo').value;

  const filtered = allDuties.filter(d => {
    if (driver && (d['Driver Name'] || '') !== driver) return false;
    if (vendor && (d['Vendor']      || '') !== vendor) return false;
    if (type   && (d['Duty Type']   || '') !== type)   return false;
    if (from   && (d['Duty Date']   || '') < from)     return false;
    if (to     && (d['Duty Date']   || '') > to)       return false;
    return true;
  }).sort((a,b) => (b['Duty Date']||'').localeCompare(a['Duty Date']||''));

  renderStats(filtered);
  renderDriverCards(filtered);
  renderDuties(filtered);
}

// ── Stats cards ────────────────────────────────────────────────────
function renderStats(duties) {
  const totalKm  = duties.reduce((s,d) => s + (+d['Total Km']       ||0), 0);
  const totalExp = duties.reduce((s,d) => s + (+d['Total Expenses'] ||0), 0);
  const totalFuel= duties.reduce((s,d) => s + (+d['Fuel Amount']    ||0), 0);
  let   totalAlw = 0;
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

// ── Duties table ───────────────────────────────────────────────────
function renderDuties(duties) {
  el('dutiesCount').textContent = duties.length + ' duties';
  if (!duties.length) {
    el('dutiesBody').innerHTML =
      '<tr><td colspan="11" class="empty-cell"><div class="empty-icon">📋</div>No duties found</td></tr>';
    return;
  }

  el('dutiesBody').innerHTML = duties.map(d => {
    const a    = calcDutyAllowance(d);
    const exp  = +d['Total Expenses'] || 0;
    const fuel = d['Filled Fuel'] === 'Yes';
    return `<tr>
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
      <td><strong style="color:var(--primary)">${fmtINR(a.totalAllowance)}</strong>${a.isSunday ? '<br><span style="font-size:11px;color:var(--warning)">+₹1k Sun</span>':''}
      </td>
    </tr>`;
  }).join('');
}

// ── Salary report ──────────────────────────────────────────────────
function calcSalaryReport() {
  const ym = el('salMonth').value;
  if (!ym) { alert('Select a month first'); return; }

  const tbody = el('salBody');
  const drivers = CONFIG.DRIVERS;

  let html = '';
  let grandBasic=0, grandOT=0, grandOut=0, grandSun=0, grandGross=0;

  drivers.forEach(name => {
    const s = calcMonthlySalary(allDuties, name, ym);
    grandBasic += s.basicSalary;
    grandOT    += s.overtimePay;
    grandOut   += s.outstationAllowance;
    grandSun   += s.sundayBonus;
    grandGross += s.grossSalary;

    html += `<tr>
      <td><strong>${name}</strong></td>
      <td style="text-align:center">${s.totalDuties}</td>
      <td>${fmtINR(s.basicSalary)}</td>
      <td>${fmtINR(s.overtimePay)}</td>
      <td>${fmtINR(s.outstationAllowance)}</td>
      <td>${fmtINR(s.sundayBonus)}</td>
      <td><strong style="color:var(--primary)">${fmtINR(s.grossSalary)}</strong></td>
    </tr>`;
  });

  html += `<tr class="salary-row-total">
    <td><strong>TOTAL</strong></td>
    <td></td>
    <td>${fmtINR(grandBasic)}</td>
    <td>${fmtINR(grandOT)}</td>
    <td>${fmtINR(grandOut)}</td>
    <td>${fmtINR(grandSun)}</td>
    <td><strong>${fmtINR(grandGross)}</strong></td>
  </tr>`;

  tbody.innerHTML = html;

  // Also show per-duty breakdown
  renderSalaryBreakdown(ym);
}

function renderSalaryBreakdown(ym) {
  const driver = el('salDriver').value;
  const duties = allDuties.filter(d => {
    const date   = d['Duty Date']   || '';
    const drvr   = d['Driver Name'] || '';
    return date.startsWith(ym) && (!driver || drvr === driver);
  }).sort((a,b) => (a['Duty Date']||'').localeCompare(b['Duty Date']||''));

  if (!duties.length) {
    el('salDetailBody').innerHTML = '<tr><td colspan="8" class="empty-cell">No duties for selected period</td></tr>';
    return;
  }

  el('salDetailBody').innerHTML = duties.map(d => {
    const a = calcDutyAllowance(d);
    const dayLabel = a.isSunday ? ' 🌟' : '';
    return `<tr>
      <td>${fmtDate(d['Duty Date'])}${dayLabel}</td>
      <td>${d['Driver Name'] || '—'}</td>
      <td><span class="badge badge-blue">${d['Duty Type'] || '—'}</span></td>
      <td>${fmtTimeRange(d)}</td>
      <td>${a.overtimeHours > 0 ? a.overtimeHours.toFixed(2) + ' h' : '—'}</td>
      <td>${a.overtimeAmount ? fmtINR(a.overtimeAmount) : '—'}</td>
      <td>${a.outstationAllowance ? fmtINR(a.outstationAllowance) + (a.outstationDays===2?' (×2)':'') : '—'}</td>
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
      <td>
        ${s.duties.map(d => `<span class="badge badge-blue" style="margin:2px">${d['Vendor Duty Number']||'N/A'}</span>`).join(' ')}
      </td>
    </tr>`;
  }).join('');
}

// ── Tabs ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
}

// ── Export CSV ─────────────────────────────────────────────────────
function exportCSV() {
  if (!allDuties.length) { alert('No data to export'); return; }
  const headers = Object.keys(allDuties[0]);
  const csv = [
    headers.join(','),
    ...allDuties.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], {type:'text/csv'})),
    download: 'tresa-duties-' + new Date().toISOString().split('T')[0] + '.csv'
  });
  a.click();
}

function refreshData() { loadData(); }

// ── Helpers ────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  } catch { return s; }
}

// Shows "HH:MM – HH:MM" for same-day, or "HH:MM (date) – HH:MM (date)" for overnight
function fmtTimeRange(d) {
  const st = d['Start Time'] || '';
  const et = d['End Time']   || '';
  const sd = d['Start Date'] || d['Duty Date'] || '';
  const ed = d['End Date']   || d['Duty Date'] || '';
  if (!st && !et) return '—';
  if (sd && ed && sd !== ed) {
    const shortDate = s => {
      try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }
      catch { return s; }
    };
    return `${st} <span style="font-size:11px;color:var(--text-muted)">${shortDate(sd)}</span> – ${et} <span style="font-size:11px;color:var(--text-muted)">${shortDate(ed)}</span>`;
  }
  return `${st || '—'} – ${et || '—'}`;
}

function fmtDuration2(mins) {
  if (mins === '' || mins === undefined || mins === null) return '—';
  const m = Math.round(+mins);
  return Math.floor(m/60) + 'h ' + (m%60) + 'm';
}
