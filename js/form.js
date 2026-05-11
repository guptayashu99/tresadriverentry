/* Entry form logic — runs on index.html */

let fuelFilled = false;

document.addEventListener('DOMContentLoaded', () => {
  // Default duty date = today
  document.getElementById('dutyDate').value = todayStr();

  // Populate dropdowns
  fill('driverName',    CONFIG.DRIVERS);
  fill('vehicleNumber', CONFIG.VEHICLES);
  fill('vendor',        CONFIG.VENDORS);
  fill('dutyType',      CONFIG.DUTY_TYPES);

  // Live km / time summary
  ['startKm','endKm','startTime','endTime'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateKmSummary)
  );

  // Live expense total
  ['parking','mcd','toll','stateTax','miscellaneous'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateExpTotal)
  );

  // Live OT preview when time or type changes
  ['startTime','endTime','dutyDate','dutyType'].forEach(id =>
    document.getElementById(id).addEventListener('change', updateOTPreview)
  );

  // Form submit
  document.getElementById('dutyForm').addEventListener('submit', handleSubmit);

  // Default: no fuel
  setFuel(false);

  // Warn if not configured
  if (!CONFIG.APPS_SCRIPT_URL) showBanner();
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
  const sk = +document.getElementById('startKm').value || 0;
  const ek = +document.getElementById('endKm').value   || 0;
  const st = document.getElementById('startTime').value;
  const et = document.getElementById('endTime').value;

  const box = document.getElementById('kmSummary');
  if (!sk && !ek && !st && !et) { box.style.display = 'none'; return; }
  box.style.display = 'flex';

  document.getElementById('kmTotal').textContent = Math.max(0, ek - sk) + ' km';

  if (st && et) {
    const sm = toM(st), em = toM(et);
    const dur = em < sm ? (1440 - sm + em) : (em - sm);
    document.getElementById('kmDuration').textContent = fmtDuration(dur);
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
  const st    = document.getElementById('startTime').value;
  const et    = document.getElementById('endTime').value;
  const date  = document.getElementById('dutyDate').value;
  const dtype = document.getElementById('dutyType').value;
  const box   = document.getElementById('otPreview');

  if (!st || !et || !dtype) { box.style.display = 'none'; return; }

  const a = calcDutyAllowance({ startTime: st, endTime: et, dutyType: dtype, dutyDate: date });
  box.style.display = 'block';

  let html = '';
  if (dtype === 'Outstation') {
    html += `<div>Outstation: <strong>${a.outstationDays} day${a.outstationDays > 1 ? 's' : ''}</strong> × ${fmtINR(SALARY.OUTSTATION_DAILY)} = <strong>${fmtINR(a.outstationAllowance)}</strong></div>`;
    if (a.outstationDays === 2) html += `<div style="font-size:12px;color:var(--text-muted)">↳ Duty extends ≥30 min past midnight → next-day allowance</div>`;
  } else {
    html += `<div>Overtime: <strong>${a.overtimeHours.toFixed(2)} h</strong> × ${fmtINR(SALARY.OT_RATE)} = <strong>${fmtINR(a.overtimeAmount)}</strong></div>`;
  }
  if (a.isSunday) {
    html += `<div>Sunday bonus: <strong>${fmtINR(SALARY.SUNDAY_BONUS)}</strong></div>`;
  }
  html += `<div class="ot-total">Total Allowance: ${fmtINR(a.totalAllowance)}</div>`;

  box.innerHTML = html;
}

function toM(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }

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

  const payload = {
    driverName:       form.driverName.value,
    vehicleNumber:    form.vehicleNumber.value,
    dutyDate:         form.dutyDate.value,
    vendor:           form.vendor.value,
    vendorDutyNumber: form.vendorDutyNumber.value,
    dutyType:         form.dutyType.value,
    startKm:          sk,
    startTime:        form.startTime.value,
    endKm:            ek,
    endTime:          form.endTime.value,
    parking:          +form.parking.value     || 0,
    mcd:              +form.mcd.value         || 0,
    toll:             +form.toll.value        || 0,
    stateTax:         +form.stateTax.value    || 0,
    miscellaneous:    +form.miscellaneous.value || 0,
    filledFuel:       fuelFilled,
    fuelAmount:       fuelFilled ? (+form.fuelAmount.value   || 0) : null,
    fuelLitres:       fuelFilled ? (+form.fuelLitres.value   || 0) : null,
    fuelOdometer:     fuelFilled ? (+form.fuelOdometer.value || 0) : null
  };

  setLoading(true);
  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    showSuccess();
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

function showSuccess() {
  document.getElementById('dutyForm').style.display = 'none';
  document.getElementById('successBox').style.display = 'block';
}

function submitAnother() {
  document.getElementById('dutyForm').reset();
  document.getElementById('dutyForm').style.display = 'flex';
  document.getElementById('successBox').style.display = 'none';
  document.getElementById('dutyDate').value = todayStr();
  document.getElementById('kmSummary').style.display = 'none';
  document.getElementById('otPreview').style.display = 'none';
  document.getElementById('expTotal').textContent = '₹0';
  setFuel(false);
}

function showBanner() {
  const b = document.createElement('div');
  b.className = 'alert alert-warn';
  b.style.marginBottom = '16px';
  b.innerHTML = '⚠️ <strong>Setup needed:</strong> Add your Google Apps Script URL to <code>js/config.js</code>. See README.md.';
  document.querySelector('.main .container').insertBefore(b, document.getElementById('dutyForm'));
}
