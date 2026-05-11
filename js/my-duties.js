/* My Duties page — read-only view for drivers */

let myDuties = [];

document.addEventListener('DOMContentLoaded', () => {
  // Populate driver dropdown
  const picker = document.getElementById('driverPicker');
  CONFIG.DRIVERS.forEach(d => {
    const o = document.createElement('option');
    o.value = o.textContent = d;
    picker.appendChild(o);
  });

  const saved = localStorage.getItem('selectedDriver');
  if (saved && CONFIG.DRIVERS.includes(saved)) {
    picker.value = saved;
    loadMyDuties(saved);
  }

  // Default month = current month
  const now = new Date();
  document.getElementById('monthFilter').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
});

function selectDriver() {
  const name = document.getElementById('driverPicker').value;
  if (!name) return;
  localStorage.setItem('selectedDriver', name);
  loadMyDuties(name);
}

async function loadMyDuties(driver) {
  document.getElementById('content').style.display  = 'none';
  document.getElementById('loader').style.display   = 'flex';
  document.getElementById('noDriver').style.display = 'none';

  try {
    const res  = await fetch(CONFIG.APPS_SCRIPT_URL);
    const json = await res.json();
    const all  = json.success ? (json.data || []) : [];
    myDuties   = all.filter(d => (d['Driver Name'] || '') === driver)
                    .sort((a, b) => (b['Duty Date'] || '').localeCompare(a['Duty Date'] || ''));

    document.getElementById('loader').style.display  = 'none';
    document.getElementById('content').style.display = 'block';
    renderAll();
  } catch {
    document.getElementById('loader').innerHTML =
      '<div class="alert alert-error">❌ Could not load duties. Check your connection.</div>';
  }
}

function renderAll() {
  const ym       = document.getElementById('monthFilter').value;
  const filtered = ym ? myDuties.filter(d => (d['Duty Date'] || '').startsWith(ym)) : myDuties;

  renderSummary(filtered);
  renderTable(filtered);
}

function renderSummary(duties) {
  const km    = duties.reduce((s, d) => s + (+d['Total Km']       || 0), 0);
  const exp   = duties.reduce((s, d) => s + (+d['Total Expenses'] || 0), 0);
  const fuel  = duties.reduce((s, d) => s + (+d['Fuel Amount']    || 0), 0);
  let   alw   = 0;
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

  cnt.textContent = duties.length + ' duties' + (ym ? ' in ' + fmtMonth(ym) : '');

  if (!duties.length) {
    body.innerHTML = `<tr><td colspan="9" class="empty-cell">
      <div class="empty-icon">📋</div>No duties found</td></tr>`;
    return;
  }

  body.innerHTML = duties.map(d => {
    const a   = calcDutyAllowance(d);
    const exp = +d['Total Expenses'] || 0;
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
    </tr>`;
  }).join('');
}

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
    return `${st} (${shortDate(sd)}) – ${et} (${shortDate(ed)})`;
  }
  return `${st || '—'} – ${et || '—'}`;
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
