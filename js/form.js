/* Entry form logic — runs on index.html */

let fuelFilled = false;
let existingDuties = [];

document.addEventListener('DOMContentLoaded', () => {
  // Default duty date = today, and set datetime defaults
  const today = todayStr();
  document.getElementById('dutyDate').value = today;
  setDatetimeDefaults(today);

  // Populate dropdowns
  fill('driverName',    CONFIG.DRIVERS);
  fill('vehicleNumber', CONFIG.VEHICLES);
  fill('vendor',        CONFIG.VENDORS);
  fill('dutyType',      CONFIG.DUTY_TYPES);

  // When duty date changes, update datetime defaults
  document.getElementById('dutyDate').addEventListener('change', e => {
    setDatetimeDefaults(e.target.value);
    updateOTPreview();
  });

  // Live km / duration summary
  ['startKm','endKm','startDatetime','endDatetime'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateKmSummary)
  );

  // Live expense total
  ['parking','mcd','toll','stateTax','miscellaneous'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateExpTotal)
  );

  // Live OT preview
  ['startDatetime','endDatetime','dutyDate','dutyType'].forEach(id =>
    document.getElementById(id).addEventListener('change', updateOTPreview)
  );

  // Form submit
  document.getElementById('dutyForm').addEventListener('submit', handleSubmit);

  // Default: no fuel
  setFuel(false);

  // Warn if not configured
  if (!CONFIG.APPS_SCRIPT_URL) showBanner();

  // Pre-fetch existing duties silently for duplicate detection
  if (CONFIG.APPS_SCRIPT_URL) {
    fetch(CONFIG.APPS_SCRIPT_URL)
      .then(r => r.json())
      .then(j => { existingDuties = j.success ? (j.data || []) : []; })
      .catch(() => {});
  }
});

function fill(id, items) {
  const sel = document.getElementById(id);
  items.forEach(v => {
    const o = document.createElement('option');
    o.value = o.textContent = v;
    sel.appendChild(o);
  });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Pre-fill start/end datetime to the duty date at 00:00 if not yet set
function setDatetimeDefaults(date) {
  if (!date) return;
  const sd = document.getElementById('startDatetime');
  const ed = document.getElementById('endDatetime');
  if (!sd.value) sd.value = date + 'T00:00';
  if (!ed.value) ed.value = date + 'T00:00';
}

// Split a datetime-local value into { date, time }
function splitDT(val) {
  if (!val) return { date: '', time: '' };
  const [date, time] = val.split('T');
  return { date, time };
}

// ── Fuel toggle ────────────────────────────────────────────────────
function setFuel(yes) {
  fuelFilled = yes;
  document.getElementById('btnFuelYes').classList.toggle('active',  yes);
  document.getElementById('btnFuelNo') .classList.toggle('active', !yes);
  const det = document.getElementById('fuelDetails');
  det.style.display = yes ? 'grid' : 'none';
  ['fuelAmount','fuelLitres','fuelOdometer'].forEach(id => {
    const el = document.getElementById(id);
    yes ? el.setAttribute('required','') : el.removeAttribute('required');
  });
}

// ── Live km / duration summary ─────────────────────────────────────
function updateKmSummary() {
  const sk  = +document.getElementById('startKm').value || 0;
  const ek  = +document.getElementById('endKm').value   || 0;
  const sdt = document.getElementById('startDatetime').value;
  const edt = document.getElementById('endDatetime').value;

  const box = document.getElementById('kmSummary');
  if (!sk && !ek && !sdt && !edt) { box.style.display = 'none'; return; }
  box.style.display = 'flex';

  document.getElementById('kmTotal').textContent = Math.max(0, ek - sk) + ' km';

  if (sdt && edt) {
    const diffMs = new Date(edt) - new Date(sdt);
    if (diffMs > 0) {
      document.getElementById('kmDuration').textContent = fmtDuration(diffMs / 60000);
    }
  }

  updateOTPreview();
}

// ── Live expense total ─────────────────────────────────────────────
function updateExpTotal() {
  const ids = ['parking','mcd','toll','stateTax','miscellaneous'];
  const tot = ids.reduce((s, id) => s + (+document.getElementById(id).value || 0), 0);
  document.getElementById('expTotal').textContent = fmtINR(tot);
}

// ── Live OT / allowance preview ────────────────────────────────────
function updateOTPreview() {
  const sdt   = document.getElementById('startDatetime').value;
  const edt   = document.getElementById('endDatetime').value;
  const dtype = document.getElementById('dutyType').value;
  const box   = document.getElementById('otPreview');

  if (!sdt || !edt || !dtype) { box.style.display = 'none'; return; }

  const { date: startDate, time: startTime } = splitDT(sdt);
  const { date: endDate,   time: endTime   } = splitDT(edt);
  const dutyDate = document.getElementById('dutyDate').value || startDate;

  const a = calcDutyAllowance({ startDate, startTime, endDate, endTime, dutyType: dtype, dutyDate });
  box.style.display = 'block';

  let html = '';
  if (dtype === 'Outstation') {
    html += `<div>Outstation: <strong>${a.outstationDays} day${a.outstationDays > 1 ? 's' : ''}</strong> × ${fmtINR(SALARY.OUTSTATION_DAILY)} = <strong>${fmtINR(a.outstationAllowance)}</strong></div>`;
    if (a.outstationDays > 1) html += `<div style="font-size:12px;color:var(--text-muted)">↳ Duty extends ≥30 min past midnight</div>`;
  } else {
    html += `<div>Overtime: <strong>${a.overtimeHours.toFixed(2)} h</strong> × ${fmtINR(SALARY.OT_RATE)} = <strong>${fmtINR(a.overtimeAmount)}</strong></div>`;
  }
  if (a.isSunday) {
    html += `<div>Sunday bonus: <strong>${fmtINR(SALARY.SUNDAY_BONUS)}</strong></div>`;
  }
  html += `<div class="ot-total">Total Allowance: ${fmtINR(a.totalAllowance)}</div>`;
  box.innerHTML = html;
}

// ── Submit ─────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();

  if (!CONFIG.APPS_SCRIPT_URL) {
    alert('Google Apps Script URL not configured.\nSee README.md for setup instructions.');
    return;
  }

  const form = e.target;
  const sk = +form.startKm.value;
  const ek = +form.endKm.value;
  if (ek < sk) { alert('End Km must be ≥ Start Km'); return; }

  const sdt = form.startDatetime.value;
  const edt = form.endDatetime.value;
  if (!sdt || !edt) { alert('Please enter start and end date/time.'); return; }
  if (new Date(edt) <= new Date(sdt)) { alert('End date/time must be after start date/time.'); return; }

  const { date: startDate, time: startTime } = splitDT(sdt);
  const { date: endDate,   time: endTime   } = splitDT(edt);

  const payload = {
    driverName:       form.driverName.value,
    vehicleNumber:    form.vehicleNumber.value,
    dutyDate:         form.dutyDate.value,
    vendor:           form.vendor.value,
    vendorDutyNumber: form.vendorDutyNumber.value,
    dutyType:         form.dutyType.value,
    startKm:          sk,
    startDate, startTime,
    endKm:            ek,
    endDate,   endTime,
    parking:          +form.parking.value      || 0,
    mcd:              +form.mcd.value          || 0,
    toll:             +form.toll.value         || 0,
    stateTax:         +form.stateTax.value     || 0,
    miscellaneous:    +form.miscellaneous.value || 0,
    filledFuel:       fuelFilled,
    fuelAmount:       fuelFilled ? (+form.fuelAmount.value   || 0) : null,
    fuelLitres:       fuelFilled ? (+form.fuelLitres.value   || 0) : null,
    fuelOdometer:     fuelFilled ? (+form.fuelOdometer.value || 0) : null
  };

  // Duplicate check — same vehicle + overlapping datetime range
  const conflict = existingDuties.find(d => {
    if ((d['Vehicle Number'] || '') !== payload.vehicleNumber) return false;
    const exSD = d['Start Date'] || d['Duty Date'] || '';
    const exST = d['Start Time'] || '';
    const exED = d['End Date']   || d['Duty Date'] || '';
    const exET = d['End Time']   || '';
    return timesOverlap(startDate, startTime, endDate, endTime, exSD, exST, exED, exET);
  });
  if (conflict) {
    const proceed = confirm(
      `⚠️ ${payload.vehicleNumber} already has a duty from ` +
      `${conflict['Start Date'] || conflict['Duty Date']} ${conflict['Start Time']} → ` +
      `${conflict['End Date']   || conflict['Duty Date']} ${conflict['End Time']}\n` +
      `(${conflict['Driver Name']}, ${conflict['Vendor Duty Number']})\n\nSubmit anyway?`
    );
    if (!proceed) return;
  }

  setLoading(true);
  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    showSuccess(payload);
  } catch {
    document.getElementById('errMsg').style.display = 'block';
    setTimeout(() => document.getElementById('errMsg').style.display = 'none', 5000);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = document.getElementById('submitBtn');
  btn.disabled = on;
  document.getElementById('btnText').textContent = on ? 'Submitting…' : 'Submit Duty';
}

function showSuccess(payload) {
  const a = calcDutyAllowance(payload);

  let rows = '';
  if (payload.dutyType === 'Outstation') {
    rows += `<div class="sum-row"><span>Outstation (${a.outstationDays} day${a.outstationDays > 1 ? 's' : ''})</span><span>${fmtINR(a.outstationAllowance)}</span></div>`;
    if (a.outstationDays > 1) rows += `<div class="sum-note">↳ Duty extended past 00:30</div>`;
  } else {
    rows += `<div class="sum-row"><span>Overtime (${a.overtimeHours.toFixed(2)} h × ₹100)</span><span>${fmtINR(a.overtimeAmount)}</span></div>`;
  }
  if (a.isSunday) {
    rows += `<div class="sum-row"><span>Sunday Bonus</span><span>${fmtINR(a.sundayBonus)}</span></div>`;
  }

  const allowanceBlock = a.totalAllowance > 0
    ? `<div class="success-allowance">
        <div class="sum-label">Your Allowance for This Duty</div>
        ${rows}
        <div class="sum-total"><span>Total</span><span>${fmtINR(a.totalAllowance)}</span></div>
       </div>`
    : `<div class="success-allowance"><div class="sum-label">No overtime for this duty</div></div>`;

  document.getElementById('successAllowance').innerHTML = allowanceBlock;
  document.getElementById('dutyForm').style.display = 'none';
  document.getElementById('successBox').style.display = 'block';
}

function submitAnother() {
  document.getElementById('dutyForm').reset();
  document.getElementById('dutyForm').style.display = 'flex';
  document.getElementById('successBox').style.display = 'none';
  const today = todayStr();
  document.getElementById('dutyDate').value = today;
  document.getElementById('startDatetime').value = today + 'T00:00';
  document.getElementById('endDatetime').value   = today + 'T00:00';
  document.getElementById('kmSummary').style.display = 'none';
  document.getElementById('otPreview').style.display = 'none';
  document.getElementById('expTotal').textContent = '₹0';
  setFuel(false);
}

// Returns true if two datetime ranges overlap.
function timesOverlap(sd1, st1, ed1, et1, sd2, st2, ed2, et2) {
  if (!sd1 || !st1 || !ed1 || !et1 || !sd2 || !st2 || !ed2 || !et2) return false;
  const s1 = new Date(sd1 + 'T' + st1).getTime();
  const e1 = new Date(ed1 + 'T' + et1).getTime();
  const s2 = new Date(sd2 + 'T' + st2).getTime();
  const e2 = new Date(ed2 + 'T' + et2).getTime();
  return s1 < e2 && s2 < e1;
}

function showBanner() {
  const b = document.createElement('div');
  b.className = 'alert alert-warn';
  b.style.marginBottom = '16px';
  b.innerHTML = '⚠️ <strong>Setup needed:</strong> Add your Google Apps Script URL to <code>js/config.js</code>. See README.md.';
  document.querySelector('.main .container').insertBefore(b, document.getElementById('dutyForm'));
}
