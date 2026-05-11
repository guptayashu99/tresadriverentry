/**
 * Tresa Driver Entry – Google Apps Script backend
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * doPost  → receives duty data from the entry form and appends a row
 * doGet   → returns all duties as JSON (used by the dashboard)
 */

const SHEET_NAME = 'Duties';

// Column headers – order must match appendRow() below
const HEADERS = [
  'Timestamp', 'Driver Name', 'Vehicle Number', 'Duty Date',
  'Vendor', 'Vendor Duty Number', 'Duty Type',
  'Start Km', 'Start Time', 'End Km', 'End Time',
  'Total Km', 'Duration (mins)',
  'Parking', 'MCD', 'Toll', 'State Tax', 'Miscellaneous', 'Total Expenses',
  'Filled Fuel', 'Fuel Amount', 'Fuel Litres', 'Fuel Odometer Reading'
];

/* ────────────────────────────────────────────────────────── */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet_();

    // Derived values
    const totalKm  = (parseFloat(data.endKm)  || 0) - (parseFloat(data.startKm) || 0);
    const expenses = ['parking','mcd','toll','stateTax','miscellaneous']
      .reduce((s, k) => s + (parseFloat(data[k]) || 0), 0);

    let durationMins = '';
    if (data.startTime && data.endTime) {
      const sm = toMins_(data.startTime);
      const em = toMins_(data.endTime);
      durationMins = em < sm ? (1440 - sm + em) : (em - sm);
    }

    sheet.appendRow([
      new Date(),                              // Timestamp
      data.driverName       || '',
      data.vehicleNumber    || '',
      data.dutyDate         || '',
      data.vendor           || '',
      data.vendorDutyNumber || '',
      data.dutyType         || '',
      parseFloat(data.startKm)  || 0,
      data.startTime        || '',
      parseFloat(data.endKm)    || 0,
      data.endTime          || '',
      totalKm,
      durationMins,
      parseFloat(data.parking)      || 0,
      parseFloat(data.mcd)          || 0,
      parseFloat(data.toll)         || 0,
      parseFloat(data.stateTax)     || 0,
      parseFloat(data.miscellaneous)|| 0,
      expenses,
      data.filledFuel ? 'Yes' : 'No',
      data.filledFuel ? (parseFloat(data.fuelAmount)   || 0) : '',
      data.filledFuel ? (parseFloat(data.fuelLitres)   || 0) : '',
      data.filledFuel ? (parseFloat(data.fuelOdometer) || '') : ''
    ]);

    return jsonResp_({ success: true });
  } catch (err) {
    return jsonResp_({ success: false, error: err.toString() });
  }
}

/* ────────────────────────────────────────────────────────── */

function doGet(e) {
  try {
    const sheet = getOrCreateSheet_();
    if (sheet.getLastRow() <= 1) return jsonResp_({ success: true, data: [] });

    const rows    = sheet.getDataRange().getValues();
    const headers = rows[0];
    const data    = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let v = row[i];
        // Serialise Date objects to ISO date string
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        obj[h] = (v === null || v === undefined) ? '' : v;
      });
      return obj;
    });

    return jsonResp_({ success: true, data });
  } catch (err) {
    return jsonResp_({ success: false, error: err.toString() });
  }
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
    // Style header row
    const hdr = sheet.getRange(1, 1, 1, HEADERS.length);
    hdr.setBackground('#1e3a8a')
       .setFontColor('#ffffff')
       .setFontWeight('bold')
       .setWrap(false);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);  // Timestamp
    sheet.setColumnWidth(2, 160);  // Driver Name
  }

  return sheet;
}

function toMins_(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function jsonResp_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
