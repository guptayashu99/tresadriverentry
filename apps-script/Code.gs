/**
 * Tresa Driver Entry – Google Apps Script backend
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * doPost  → receives duty data OR attendance data
 * doGet   → ?type=attendance returns attendance; default returns duties
 */

const SHEET_NAME            = 'Duties';
const ATTENDANCE_SHEET_NAME = 'Attendance';
const PAYMENTS_SHEET_NAME   = 'Payments';
const OWNER_EMAIL           = 'guptayashu99@gmail.com';

// Column headers – order must match appendRow() below
const HEADERS = [
  'Timestamp', 'Driver Name', 'Vehicle Number', 'Duty Date',
  'Vendor', 'Vendor Duty Number', 'Manual Slip', 'Manual Slip No.', 'Duty Type',
  'Start Km', 'Start Date', 'Start Time', 'End Km', 'End Date', 'End Time',
  'Total Km', 'Duration (mins)',
  'Parking', 'MCD', 'Toll', 'State Tax', 'Miscellaneous', 'Total Expenses',
  'Filled Fuel', 'Fuel Amount', 'Fuel Litres', 'Fuel Odometer Reading'
];

const ATTENDANCE_HEADERS = [
  'Timestamp', 'Driver Name', 'Date', 'In Time', 'Out Time', 'Total Duty Hours'
];

const PAYMENT_HEADERS = [
  'Timestamp', 'Driver Name', 'Month', 'Amount', 'Payment Date', 'Mode', 'Notes'
];

/* ────────────────────────────────────────────────────────── */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'attendance') return doPostAttendance_(data);
    if (data.action === 'payment')    return doPostPayment_(data);
    if (data.action === 'editDuty')        return doEditDuty_(data);
    if (data.action === 'deleteDuty')      return doDeleteDuty_(data);
    if (data.action === 'bulkDeleteDuties') return doBulkDeleteDuties_(data);
    return doPostDuty_(data);
  } catch (err) {
    return jsonResp_({ success: false, error: err.toString() });
  }
}

function doPostDuty_(data) {
  const sheet = getOrCreateSheet_();

  const totalKm  = (parseFloat(data.endKm)  || 0) - (parseFloat(data.startKm) || 0);
  const expenses = ['parking','mcd','toll','stateTax','miscellaneous']
    .reduce((s, k) => s + (parseFloat(data[k]) || 0), 0);

  let durationMins = '';
  const startDate = data.startDate || data.dutyDate || '';
  const endDate   = data.endDate   || data.dutyDate || '';
  if (startDate && data.startTime && endDate && data.endTime) {
    const start = new Date(startDate + 'T' + data.startTime);
    const end   = new Date(endDate   + 'T' + data.endTime);
    durationMins = Math.round((end - start) / 60000);
  }

  sheet.appendRow([
    new Date(),
    data.driverName       || '',
    data.vehicleNumber    || '',
    data.dutyDate         || '',
    data.vendor           || '',
    data.vendorDutyNumber || '',
    data.manualSlip ? 'Yes' : 'No',
    data.manualSlip ? (data.manualSlipNo || '') : '',
    data.dutyType         || '',
    parseFloat(data.startKm) || 0,
    startDate,
    data.startTime        || '',
    parseFloat(data.endKm)   || 0,
    endDate,
    data.endTime          || '',
    totalKm,
    durationMins,
    parseFloat(data.parking)       || 0,
    parseFloat(data.mcd)           || 0,
    parseFloat(data.toll)          || 0,
    parseFloat(data.stateTax)      || 0,
    parseFloat(data.miscellaneous) || 0,
    expenses,
    data.filledFuel ? 'Yes' : 'No',
    data.filledFuel ? (parseFloat(data.fuelAmount)   || 0) : '',
    data.filledFuel ? (parseFloat(data.fuelLitres)   || 0) : '',
    data.filledFuel ? (parseFloat(data.fuelOdometer) || '') : ''
  ]);

  // Email notification to owner
  try {
    const kmDriven = (parseFloat(data.endKm) || 0) - (parseFloat(data.startKm) || 0);
    MailApp.sendEmail(OWNER_EMAIL,
      `[Tresa] New Duty – ${data.driverName} · ${data.dutyDate}`,
      [
        `Driver   : ${data.driverName}`,
        `Vehicle  : ${data.vehicleNumber}`,
        `Date     : ${data.dutyDate}`,
        `Vendor   : ${data.vendor} (${data.vendorDutyNumber})`,
        `Type     : ${data.dutyType}`,
        `Start    : ${data.startDate} ${data.startTime}  →  End: ${data.endDate} ${data.endTime}`,
        `Km       : ${data.startKm} → ${data.endKm}  (${kmDriven} km)`,
        `Expenses : ₹${expenses}`,
        data.filledFuel ? `Fuel     : ₹${data.fuelAmount}  ·  ${data.fuelLitres} L` : '',
        '',
        `Submitted: ${new Date()}`
      ].filter(Boolean).join('\n')
    );
  } catch (_) { /* never fail a submission because of email */ }

  return jsonResp_({ success: true });
}

function doPostPayment_(data) {
  const sheet = getOrCreatePaymentsSheet_();
  sheet.appendRow([
    new Date(),
    data.driverName   || '',
    data.month        || '',
    parseFloat(data.amount) || 0,
    data.paymentDate  || '',
    data.mode         || '',
    data.notes        || ''
  ]);
  return jsonResp_({ success: true });
}

function doPostAttendance_(data) {
  const sheet = getOrCreateAttendanceSheet_();

  if (data.attendanceAction === 'Check-in') {
    sheet.appendRow([
      new Date(),
      data.driverName || '',
      data.date       || '',
      data.time       || '',
      '',
      ''
    ]);
  } else {
    // Checkout: find the last open row (no Out Time) for this driver today
    const rows       = sheet.getDataRange().getValues();
    const headers    = rows[0];
    const driverIdx  = headers.indexOf('Driver Name');
    const dateIdx    = headers.indexOf('Date');
    const inTimeIdx  = headers.indexOf('In Time');
    const outTimeIdx = headers.indexOf('Out Time');
    const totalIdx   = headers.indexOf('Total Duty Hours');
    const tz         = Session.getScriptTimeZone();

    // Normalise a cell value to a date string (yyyy-MM-dd), handling cases
    // where Sheets auto-parsed the stored string into a Date object.
    const toDateStr = v => v instanceof Date
      ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
      : String(v || '');

    // Same for HH:mm time cells.
    const toTimeStr = v => v instanceof Date
      ? Utilities.formatDate(v, tz, 'HH:mm')
      : String(v || '');

    let targetRow = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][driverIdx] === (data.driverName || '') &&
          toDateStr(rows[i][dateIdx]) === (data.date || '') &&
          !rows[i][outTimeIdx]) {
        targetRow = i + 1; // 1-indexed
        break;
      }
    }

    if (targetRow === -1) return jsonResp_({ success: false, error: 'No open check-in found' });

    const inTime  = toTimeStr(rows[targetRow - 1][inTimeIdx]);
    const outTime = data.time || '';
    let totalHours = '';
    if (inTime && outTime) {
      const [inH,  inM]  = inTime.split(':').map(Number);
      const [outH, outM] = outTime.split(':').map(Number);
      let diff = (outH * 60 + outM) - (inH * 60 + inM);
      if (diff < 0) diff += 1440;
      totalHours = Math.floor(diff / 60) + 'h ' + (diff % 60) + 'm';
    }

    sheet.getRange(targetRow, outTimeIdx + 1).setValue(outTime);
    sheet.getRange(targetRow, totalIdx   + 1).setValue(totalHours);
  }

  return jsonResp_({ success: true });
}

/* ────────────────────────────────────────────────────────── */

function doGet(e) {
  try {
    const type = (e && e.parameter && e.parameter.type) || 'duties';
    if (type === 'attendance') return doGetAttendance_();
    if (type === 'payments')   return doGetPayments_();
    return doGetDuties_();
  } catch (err) {
    return jsonResp_({ success: false, error: err.toString() });
  }
}

function doGetDuties_() {
  const sheet = getOrCreateSheet_();
  if (sheet.getLastRow() <= 1) return jsonResp_({ success: true, data: [] });

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const tz      = Session.getScriptTimeZone();
  const data    = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        if (h === 'Start Time' || h === 'End Time') {
          v = Utilities.formatDate(v, tz, 'HH:mm');
        } else if (h === 'Timestamp') {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
        } else {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        }
      }
      obj[h] = (v === null || v === undefined) ? '' : v;
    });
    return obj;
  });

  return jsonResp_({ success: true, data });
}

function doGetAttendance_() {
  const sheet = getOrCreateAttendanceSheet_();
  if (sheet.getLastRow() <= 1) return jsonResp_({ success: true, data: [] });

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const tz      = Session.getScriptTimeZone();
  const timeColumns = new Set(['In Time', 'Out Time']);
  const data    = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        if (timeColumns.has(h)) {
          v = Utilities.formatDate(v, tz, 'HH:mm');
        } else if (h === 'Timestamp') {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
        } else {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        }
      }
      obj[h] = (v === null || v === undefined) ? '' : v;
    });
    return obj;
  });

  return jsonResp_({ success: true, data });
}

function doGetPayments_() {
  const sheet = getOrCreatePaymentsSheet_();
  if (sheet.getLastRow() <= 1) return jsonResp_({ success: true, data: [] });

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const tz      = Session.getScriptTimeZone();
  const data    = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        v = h === 'Timestamp'
          ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss')
          : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      obj[h] = (v === null || v === undefined) ? '' : v;
    });
    return obj;
  });
  return jsonResp_({ success: true, data });
}

function doEditDuty_(data) {
  const sheet   = getOrCreateSheet_();
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const tsIdx   = headers.indexOf('Timestamp');
  const tz      = Session.getScriptTimeZone();

  let targetRow = -1;
  for (let i = 1; i < rows.length; i++) {
    const ts    = rows[i][tsIdx];
    const tsStr = ts instanceof Date ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd HH:mm:ss') : String(ts);
    if (tsStr === (data.timestamp || '')) { targetRow = i + 1; break; }
  }
  if (targetRow === -1) return jsonResp_({ success: false, error: 'Record not found' });

  const totalKm  = (parseFloat(data.endKm)  || 0) - (parseFloat(data.startKm) || 0);
  const expenses = ['parking','mcd','toll','stateTax','miscellaneous']
    .reduce((s, k) => s + (parseFloat(data[k]) || 0), 0);

  let durationMins = '';
  const startDate = data.startDate || data.dutyDate || '';
  const endDate   = data.endDate   || data.dutyDate || '';
  if (startDate && data.startTime && endDate && data.endTime) {
    const start = new Date(startDate + 'T' + data.startTime);
    const end   = new Date(endDate   + 'T' + data.endTime);
    durationMins = Math.round((end - start) / 60000);
  }

  const newRow = [
    rows[targetRow - 1][tsIdx],
    data.driverName       || '',
    data.vehicleNumber    || '',
    data.dutyDate         || '',
    data.vendor           || '',
    data.vendorDutyNumber || '',
    data.manualSlip ? 'Yes' : 'No',
    data.manualSlip ? (data.manualSlipNo || '') : '',
    data.dutyType         || '',
    parseFloat(data.startKm) || 0,
    startDate,
    data.startTime        || '',
    parseFloat(data.endKm)   || 0,
    endDate,
    data.endTime          || '',
    totalKm,
    durationMins,
    parseFloat(data.parking)       || 0,
    parseFloat(data.mcd)           || 0,
    parseFloat(data.toll)          || 0,
    parseFloat(data.stateTax)      || 0,
    parseFloat(data.miscellaneous) || 0,
    expenses,
    data.filledFuel ? 'Yes' : 'No',
    data.filledFuel ? (parseFloat(data.fuelAmount)   || 0) : '',
    data.filledFuel ? (parseFloat(data.fuelLitres)   || 0) : '',
    data.filledFuel ? (parseFloat(data.fuelOdometer) || '') : ''
  ];

  sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);
  return jsonResp_({ success: true });
}

function doBulkDeleteDuties_(data) {
  const sheet     = getOrCreateSheet_();
  const rows      = sheet.getDataRange().getValues();
  const headers   = rows[0];
  const driverIdx = headers.indexOf('Driver Name');
  const dateIdx   = headers.indexOf('Duty Date');
  const tz        = Session.getScriptTimeZone();

  const driver   = data.driverName || '';
  const fromDate = data.fromDate   || '';
  const toDate   = data.toDate     || '';

  const toDelete = [];
  for (let i = 1; i < rows.length; i++) {
    const rowDriver = String(rows[i][driverIdx] || '');
    let   rowDate   = rows[i][dateIdx];
    if (rowDate instanceof Date) {
      rowDate = Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd');
    } else {
      rowDate = String(rowDate || '');
    }
    if (rowDriver === driver && rowDate >= fromDate && rowDate <= toDate) {
      toDelete.push(i + 1); // 1-indexed sheet row
    }
  }

  // Delete bottom-to-top so row indices don't shift
  toDelete.reverse().forEach(r => sheet.deleteRow(r));
  return jsonResp_({ success: true, count: toDelete.length });
}

function doDeleteDuty_(data) {
  const sheet   = getOrCreateSheet_();
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const tsIdx   = headers.indexOf('Timestamp');
  const tz      = Session.getScriptTimeZone();

  let targetRow = -1;
  for (let i = 1; i < rows.length; i++) {
    const ts    = rows[i][tsIdx];
    const tsStr = ts instanceof Date ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd HH:mm:ss') : String(ts);
    if (tsStr === (data.timestamp || '')) { targetRow = i + 1; break; }
  }
  if (targetRow === -1) return jsonResp_({ success: false, error: 'Record not found' });

  sheet.deleteRow(targetRow);
  return jsonResp_({ success: true });
}

/* ── Helpers ─────────────────────────────────────────────── */

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    const hdr = sheet.getRange(1, 1, 1, HEADERS.length);
    hdr.setBackground('#1e3a8a')
       .setFontColor('#ffffff')
       .setFontWeight('bold')
       .setWrap(false);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 160);
  }

  return sheet;
}

function getOrCreateAttendanceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(ATTENDANCE_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(ATTENDANCE_HEADERS);
    const hdr = sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length);
    hdr.setBackground('#1e3a8a')
       .setFontColor('#ffffff')
       .setFontWeight('bold')
       .setWrap(false);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 160);
  }

  return sheet;
}

function getOrCreatePaymentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(PAYMENTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(PAYMENT_HEADERS);
    const hdr = sheet.getRange(1, 1, 1, PAYMENT_HEADERS.length);
    hdr.setBackground('#1e3a8a').setFontColor('#ffffff').setFontWeight('bold').setWrap(false);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 160);
  }
  return sheet;
}

function jsonResp_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
