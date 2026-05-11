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
  'Start Km', 'Start Date', 'Start Time', 'End Km', 'End Date', 'End Time',
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
    const startDate = data.startDate || data.dutyDate || '';
    const endDate   = data.endDate   || data.dutyDate || '';
    if (startDate && data.startTime && endDate && data.endTime) {
      const start = new Date(startDate + 'T' + data.startTime);
      const end   = new Date(endDate   + 'T' + data.endTime);
      durationMins = Math.round((end - start) / 60000);
    }

    sheet.appendRow([
      new Date(),                              // Timestamp
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
    const tz      = Session.getScriptTimeZone();
    const data    = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let v = row[i];
        if (v instanceof Date) {
          // Time columns are stored by Sheets as Date objects anchored to 1899-12-30
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

function jsonResp_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
