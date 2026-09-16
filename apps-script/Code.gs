/* ============================================================
   Monthly Meeting Report — Google Apps Script BACKEND
   ------------------------------------------------------------
   Powers a static site hosted on GitHub Pages.

   TABLES USED
   -----------
   The script auto-creates these sheets if missing:
     5S        -> project, area, date, photos, remarks
     Manpower  -> project, active, balanceprf, transferred, asof, remarks
     Contracts -> project, contract, status, issue, updated, remarks
     Overtime  -> project, july, august, asof, remarks

   SETUP
   -----
   1. Create a new Google Spreadsheet (any name).
   2. Extensions > Apps Script. Paste this file as Code.gs.
   3. OPTIONAL: set FOLDER_ID to a Google Drive folder for 5S photos.
      (If empty, photos are saved to your Drive root / My Drive.)
   4. OPTIONAL: set API_KEY to any random string, then paste the SAME
      value into the frontend  js/config.js  (const API_KEY = "...").
   5. Deploy > New deployment > Web app:
        - Description:  monthly-meeting-api
        - Execute as:   Me
        - Who has access: Anyone with Google account  (or "Anyone")
      Then copy the /exec  URL into js/config.js (GOOGLE_SCRIPT_URL).
   ============================================================ */

var FOLDER_ID = '';   /* e.g. '1AbCdefGhijKlmNoPQrsTUvWxyZ'  - leave '' for My Drive */
var API_KEY   = '';   /* optional shared secret, keep in sync with js/config.js      */

/* Column layout of each sheet (first row = headers). */
var HEADERS = {
  '5S':        ['project', 'area', 'date', 'photos', 'remarks'],
  'Manpower':  ['project', 'active', 'balanceprf', 'transferred', 'asof', 'remarks'],
  'Contracts': ['project', 'contract', 'status', 'issue', 'updated', 'remarks'],
  'Overtime':  ['project', 'year', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'asof', 'remarks']
};

var MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/* Old July/August schema that older versions may have created.
   Migrated so existing data is not lost. */
var OLD_OVERTIME_HEADER = ['project', 'july', 'august', 'asof', 'remarks'];

/* ---------- Entry point ---------- */
function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  var p = {};
  for (var k in (e.parameter || {})) p[k] = e.parameter[k];

  /* merge JSON body posted from the frontend */
  if (e.postData && e.postData.contents) {
    try {
      var extra = JSON.parse(e.postData.contents);
      for (var k2 in extra) p[k2] = extra[k2];
    } catch (err) { /* ignore malformed bodies */ }
  }

  try {
    if (API_KEY && p.key !== API_KEY) {
      return jsonOut({ ok: false, error: 'Invalid API key.' });
    }

    var action = String(p.action || '').toLowerCase();

    if (action === 'meta') {
      return jsonOut({ ok: true, folderSet: !!FOLDER_ID, keyed: !!API_KEY, time: new Date().toISOString() });
    }
    if (action === 'read' && HEADERS[p.sheet]) {
      return jsonOut(readSheet(p.sheet));
    }
    if (action === 'add' && HEADERS[p.sheet]) {
      return jsonOut(addRow(p.sheet, parseRow(p)));
    }
    if (action === 'update' && HEADERS[p.sheet]) {
      return jsonOut(updateRow(p.sheet, Number(p.rowNumber) || 0, parseRow(p)));
    }
    if (action === 'delete' && HEADERS[p.sheet]) {
      return jsonOut(deleteRow(p.sheet, Number(p.rowNumber) || 0));
    }
    if (action === 'upload') {
      return jsonOut(uploadPhoto(p));
    }

    return jsonOut({ ok: false, error: 'Unknown action or sheet.' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) + ' | ' + (err.stack || '').split('\n')[1] || String(err) });
  }
}

/* ---------- Helpers ---------- */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseRow(p) {
  var v = p.row;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { v = {}; }
  }
  return v || {};
}

function normalize(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ensureSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  var expected = HEADERS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(expected);
    sh.setFrozenRows(1);
    return sh;
  }

  var lastCol = sh.getLastColumn();
  var probe = sh.getRange(1, 1, 1, Math.max(1, Math.min(lastCol, Math.max(expected.length, OLD_OVERTIME_HEADER.length)))).getValues()[0];
  var matches = expected.every(function (h, i) {
    return String(probe[i] || '').trim().toLowerCase() === h;
  });

  if (matches) return sh;

  /* Migrate the old July/August Overtime sheet (if present) so data is kept. */
  if (name === 'Overtime' && isOldOvertimeHeader(sh)) {
    migrateOvertime(sh);
    return sh;
  }

  /* Header row only (no data)? Safe to reshape. Otherwise leave untouched. */
  if (sh.getLastRow() <= 1) {
    sh.clearContents();
    sh.getRange(1, 1, 1, expected.length).setValues([expected.slice()]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function isOldOvertimeHeader(sh) {
  var count = Math.min(sh.getLastColumn(), OLD_OVERTIME_HEADER.length);
  if (count < 3) return false;
  var first = sh.getRange(1, 1, 1, count).getValues()[0];
  return OLD_OVERTIME_HEADER.every(function (h, i) {
    return String(first[i] || '').trim().toLowerCase() === h;
  });
}

function migrateOvertime(sh) {
  var data = sh.getDataRange().getValues();          /* row 0 = old header */
  var idx = {};
  OLD_OVERTIME_HEADER.forEach(function (c, i) { idx[c] = i; });
  var newHeaders = HEADERS.Overtime;
  var rows = [];

  for (var r = 1; r < data.length; r++) {
    var line = data[r];
    if (line.join('').toString().trim() === '') continue;
    if (String(line[idx['project']] || '') === '' &&
        String(line[idx['july']] || '') === '' &&
        String(line[idx['august']] || '') === '') continue;

    var asof = line[idx['asof']];
    var year = 2026;
    if (asof instanceof Date) year = Number(Utilities.formatDate(asof, Session.getScriptTimeZone(), 'yyyy'));
    else { var m = String(asof || '').match(/\d{4}/); if (m) year = Number(m[0]); }

    var out = {};
    newHeaders.forEach(function (h) { out[h] = ''; });
    out.project = line[idx['project']];
    out.year = year;
    out.jul = line[idx['july']];      /* old "July"  -> jul column */
    out.aug = line[idx['august']];    /* old "August" -> aug column */
    out.asof = line[idx['asof']];
    out.remarks = line[idx['remarks']];
    rows.push(newHeaders.map(function (h) { return normalize(out[h]); }));
  }

  sh.clearContents();
  sh.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders.slice()]);
  if (rows.length) sh.getRange(2, 1, rows.length, newHeaders.length).setValues(rows);
  sh.setFrozenRows(1);
}

/* ---------- Read ---------- */
function readSheet(name) {
  var sh = ensureSheet(name);
  var headers = HEADERS[name];
  var values = sh.getDataRange().getValues();
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var line = values[i];
    if (line.join('').toString().trim() === '') continue;
    if (line.length > headers.length && line.slice(headers.length).join('').toString().trim() !== '') continue;
    if (line[0] === '' && line[1] === '' && line[2] === '') continue;

    var obj = { rowNumber: i + 1 };
    for (var h = 0; h < headers.length; h++) {
      var val = line[h];
      if (val == null) val = '';
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      if (headers[h] === 'photos' && val) {
        try { val = JSON.parse(val); } catch (e) { val = String(val).split(','); }
      }
      obj[headers[h]] = val;
    }
    rows.push(obj);
  }
  return { ok: true, sheet: name, rows: rows };
}

/* ---------- Write ---------- */
function addRow(name, row) {
  var sh = ensureSheet(name);
  var data = HEADERS[name].map(function (h) { return normalize(row[h]); });
  if (name === '5S') {
    if (typeof row.photos === 'string') { try { row.photos = JSON.parse(row.photos); } catch (e) {} }
    data[HEADERS[name].indexOf('photos')] = JSON.stringify(row.photos || []);
  }
  sh.appendRow(data);
  return { ok: true, message: name + ' row added.' };
}

function updateRow(name, rowNumber, row) {
  if (rowNumber < 2) return { ok: false, error: 'Invalid row number.' };
  var sh = ensureSheet(name);
  var last = sh.getLastRow();
  if (rowNumber > last) return { ok: false, error: 'Row out of range (sheet has ' + last + ' rows).' };

  var old = readSheet(name).rows;

  /* keep photos that were already in the sheet if none supplied on edit */
  var data = HEADERS[name].map(function (h) { return normalize(row[h]); });
  if (name === '5S') {
    var photos = row.photos;
    if (!photos || (typeof photos === 'string' && photos === '') || (Array.isArray(photos) && photos.length === 0)) {
      var found = old.filter(function (r) { return r.rowNumber === rowNumber; })[0];
      photos = found ? found.photos : [];
    }
    data[HEADERS[name].indexOf('photos')] = JSON.stringify(photos || []);
  }

  sh.getRange(rowNumber, 1, 1, HEADERS[name].length).setValues([data]);
  return { ok: true, message: name + ' row ' + rowNumber + ' updated.' };
}

function deleteRow(name, rowNumber) {
  if (rowNumber < 2) return { ok: false, error: 'Invalid row number.' };
  var sh = ensureSheet(name);
  var last = sh.getLastRow();
  if (rowNumber > last) return { ok: false, error: 'Row out of range (sheet has ' + last + ' rows).' };
  sh.deleteRow(rowNumber);
  return { ok: true, message: name + ' row ' + rowNumber + ' deleted.' };
}

/* ---------- Photo upload to Google Drive ---------- */
function uploadPhoto(p) {
  var fileName = String(p.fileName || ('photo_' + Date.now() + '.png'));
  var base64 = String(p.fileData || '').replace(/[\r\n]/g, '');
  var mime = String(p.mimeType || 'image/png');

  if (!base64) return { ok: false, error: 'No file data received.' };
  if (base64.length < 50) return { ok: false, error: 'File data looks too small / empty.' };

  var folder;
  if (FOLDER_ID) {
    try {
      folder = DriveApp.getFolderById(FOLDER_ID);
    } catch (err) {
      return { ok: false, error: 'Folder not found. Check FOLDER_ID in Code.gs (' + err + ')' };
    }
  } else {
    folder = DriveApp.getRootFolder();
  }

  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mime, fileName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    ok: true,
    id: file.getId(),
    name: fileName,
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
    thumbnail: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=s500'
  };
}