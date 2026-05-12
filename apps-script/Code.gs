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
  'Vendor', 'Vendor Duty Number', 'Duty Type',
  'Start Km', 'Start Date', 'Start Time', 'End Km', 'End Date', 'End Time',
  'Total Km', 'Duration (mins)',
  'Parking', 'MCD', 'Toll', 'State Tax', 'Miscellaneous', 'Total Expenses',
  'Filled Fuel', 'Fuel Amount', 'Fuel Litres', 'Fuel Odometer Reading'
];

const ATTENDANCE_HEADERS = [
  'Timestamp', 'Driver Name', 'Action', 'Date', 'Time', 'Latitude', 'Longitude'
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
  sheet.appendRow([
    new Date(),
    data.driverName       || '',
    data.attendanceAction || '',
    data.date             || '',
    data.time             || '',
    data.latitude         || '',
    data.longitude        || ''
  ]);
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
  const data    = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        if (h === 'Time') {
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
