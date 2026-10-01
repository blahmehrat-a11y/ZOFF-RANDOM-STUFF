/**
 * Reading and writing the tracker spreadsheet. Every sheet is addressed by header name,
 * so organisers can add their own columns to the right without breaking anything.
 */

function ss_() { return SpreadsheetApp.getActive(); }

function sheet_(def) {
  var sh = ss_().getSheetByName(def.name);
  if (!sh) throw new Error('Missing sheet "' + def.name + '". Run ZOFF Champions > Set up first.');
  return sh;
}

function ensureSheet_(def) {
  var sh = ss_().getSheetByName(def.name) || ss_().insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function col_(def, header) {
  var i = def.headers.indexOf(header);
  if (i < 0) throw new Error('No column "' + header + '" in ' + def.name);
  return i + 1;
}

/** Sheets turns '2026-10' into a date unless told otherwise; read such cells back as text. */
function text_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}

function readObjects_(def) {
  var sh = sheet_(def);
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), def.headers.length).getValues();
  var headers = values.shift();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = row[j]; });
    return o;
  });
}

function appendRows_(def, rows) {
  if (!rows.length) return;
  var sh = sheet_(def);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function audit_(what) {
  var who = '';
  try { who = Session.getActiveUser().getEmail(); } catch (e) { /* trigger context */ }
  appendRows_(SHEETS.AUDIT, [[new Date(), who || 'automation', what]]);
}

// ---------- Settings ----------

function getSettings_() {
  var out = {};
  readObjects_(SHEETS.SETTINGS).forEach(function (r) {
    if (r.Key) out[String(r.Key).trim()] = text_(r.Value);
  });
  return out;
}

function setSetting_(key, value, note) {
  var sh = sheet_(SHEETS.SETTINGS);
  var rows = readObjects_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Key).trim() === key) {
      sh.getRange(rows[i]._row, 2).setNumberFormat('@').setValue(value);
      return;
    }
  }
  appendRows_(SHEETS.SETTINGS, [[key, value, note || '']]);
  sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(value);
}

function listSetting_(settings, key) {
  return String(settings[key] || '').split(/[,\s]+/).filter(String);
}

function holidays_(settings) { return listSetting_(settings, SETTING_KEYS.HOLIDAYS); }

function weekendDays_(settings) {
  var days = listSetting_(settings, SETTING_KEYS.WEEKEND_DAYS).map(Number);
  return days.length ? days : CONFIG.DEFAULT_WEEKEND_DAYS;
}

function marketingEmails_(settings) { return listSetting_(settings, SETTING_KEYS.MARKETING_EMAILS).join(','); }

// ---------- Employees and posts ----------

function readEmployees_() {
  var byId = {};
  readObjects_(SHEETS.EMPLOYEES).forEach(function (r) {
    var id = text_(r['Employee ID']).toUpperCase();
    if (!id) return;
    byId[id] = {
      id: id,
      name: text_(r.Name),
      email: text_(r.Email).toLowerCase(),
      manager: text_(r['Manager email']),
      eligible: r.Eligible === true || /^(true|yes|y)$/i.test(text_(r.Eligible)),
      pin: text_(r.PIN)
    };
  });
  return byId;
}

/** Post keys of the daily links, filling in the Post key column for rows Marketing just pasted. */
function knownPostKeys_() {
  var sh = sheet_(SHEETS.POSTS);
  var keyCol = col_(SHEETS.POSTS, 'Post key');
  var known = {};
  readObjects_(SHEETS.POSTS).forEach(function (r) {
    var key = text_(r['Post key']);
    if (!key && r['Post link']) {
      key = normalizeUrl(text_(r['Post link']));
      sh.getRange(r._row, keyCol).setValue(key);
    }
    if (key) known[key] = true;
  });
  return known;
}

// ---------- Review items ----------

function readReviewItems_() {
  return readObjects_(SHEETS.REVIEW).filter(function (r) { return r['Item ID']; }).map(function (r) {
    var submitted = r['Submitted (IST)'];
    return {
      _row: r._row,
      id: text_(r['Item ID']),
      responseId: text_(r['Response ID']),
      submittedAt: submitted instanceof Date ? submitted.getTime() : new Date(submitted).getTime(),
      month: text_(r.Month).slice(0, 7),
      date: text_(r['Activity date']),
      employeeId: text_(r['Employee ID']).toUpperCase(),
      email: text_(r.Email).toLowerCase(),
      action: text_(r.Action),
      postKey: text_(r['Post key']),
      uniqueKey: text_(r['Unique key']),
      fileHash: text_(r['File hash']),
      contentKey: text_(r['Content key']),
      status: text_(r.Decision) || STATUS.PENDING
    };
  });
}

function reviewRow_(item, employee) {
  var row = {};
  row['Item ID'] = item.id;
  row['Response ID'] = item.fullResponseId;
  row['Submitted (IST)'] = new Date(item.submittedAt);
  row.Month = item.month;
  row['Activity date'] = item.date;
  row['Employee ID'] = item.employeeId;
  row.Name = employee ? employee.name : '';
  row.Email = item.email;
  row['Entry type'] = item.entryType;
  row.Brand = item.brand;
  row.Action = item.action;
  row['Post key'] = item.postKey;
  row['Unique key'] = item.uniqueKey;
  row['File hash'] = item.fileHash;
  row['Content key'] = item.contentKey || '';
  row.Evidence = item.evidence.join('\n');
  row['Claimed points'] = item.claimedPoints;
  row.Flags = item.flags.join('\n');
  row.Decision = STATUS.PENDING;
  return SHEETS.REVIEW.headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
