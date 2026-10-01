/**
 * Web app: two pages served from this spreadsheet, so nobody needs a Google Form or a Claude account.
 *   <web app URL>              -> employee page (send proof, posts, leaderboard, my points, rules)
 *   <web app URL>?page=review  -> Marketing & HR review desk
 * Deploy as: Execute as "Me", Who has access "Anyone". Employees sign in with Employee ID + PIN
 * (Employees sheet); reviewers with the passcode set from the ZOFF Champions menu.
 */

var MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
var FAILS_BEFORE_LOCK = 5;

function doGet(e) {
  var review = e && e.parameter && e.parameter.page === 'review';
  return HtmlService.createHtmlOutput(review ? PAGES.review : PAGES.employee)
    .setTitle(review ? 'ZOFF Champions Review Desk' : 'ZOFF Champions')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- shared ----------

function apiConfig() {
  return {
    actions: ACTIONS, engagement: ENGAGEMENT_ACTIONS, original: ORIGINAL_ACTIONS, prizes: PRIZES, brands: BRANDS,
    qualify: CONFIG.QUALIFY_POINTS, month: monthKeyIST(new Date()), timeOffDays: CONFIG.TIME_OFF_USE_WITHIN_DAYS,
    workingDays: [CONFIG.FINAL_SCORES_WORKING_DAY, CONFIG.QUERIES_CLOSE_WORKING_DAY, CONFIG.WINNERS_WORKING_DAY],
    posts: recentPosts_(40), months: monthsWithEntries_()
  };
}

function recentPosts_(limit) {
  knownPostKeys_(); // fills in keys for freshly pasted links
  return readObjects_(SHEETS.POSTS).filter(function (r) { return r['Post link']; }).map(function (r) {
    return { date: text_(r['Date shared']), brand: text_(r.Brand), url: text_(r['Post link']), key: text_(r['Post key']), label: text_(r.Notes) };
  }).reverse().slice(0, limit);
}

function monthsWithEntries_() {
  var set = {};
  set[monthKeyIST(new Date())] = true;
  set[shiftMonthKey(monthKeyIST(new Date()), -1)] = true;
  readReviewItems_().forEach(function (it) { if (it.month) set[it.month] = true; });
  return Object.keys(set).sort().reverse();
}

/** Names-only leaderboard everyone may see. */
function apiLeaderboard(monthKey) {
  monthKey = /^\d{4}-\d{2}$/.test(monthKey || '') ? monthKey : monthKeyIST(new Date());
  var b = boardFor_(monthKey);
  return {
    month: monthKey,
    pending: b.pending,
    rows: b.board.rows.map(function (r) {
      var e = b.employees[r.employeeId] || {};
      return {
        position: r.position, name: e.name || r.employeeId, points: r.points, activeDays: r.activeDays,
        posts: r.postsSupported, qualified: r.qualified, toQualify: r.pointsToQualify,
        prize: r.prize ? r.prize.name : '', detail: r.prize ? r.prize.detail : '', drawPending: !!r.drawPending
      };
    }),
    winners: winnersFor_(monthKey)
  };
}

function boardFor_(monthKey) {
  var items = readReviewItems_();
  var res = computeScores(items, monthKey);
  var employees = readEmployees_();
  var board = rankLeaderboard(res.scores, {
    isEligible: function (id) { return employees[id] && employees[id].eligible; }
  });
  var pending = items.filter(function (it) { return it.month === monthKey && it.status === STATUS.PENDING; }).length;
  return { items: items, counted: res.counted, board: board, employees: employees, pending: pending };
}

function winnersFor_(monthKey) {
  return readObjects_(SHEETS.WINNERS).filter(function (r) { return text_(r.Month).slice(0, 7) === monthKey; }).map(function (r) {
    return { rank: r.Rank, name: text_(r.Name), prize: text_(r.Prize), detail: text_(r.Detail), useBy: text_(r['Use time off by']) };
  });
}

function guard_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get(key) || 0);
  if (fails >= FAILS_BEFORE_LOCK) throw new Error('Too many wrong attempts. Try again in 10 minutes.');
  return function fail(message) {
    cache.put(key, String(fails + 1), 600);
    throw new Error(message);
  };
}

// ---------- employees ----------

function checkEmployee_(empId, pin) {
  var id = String(empId || '').trim().toUpperCase();
  if (!id) throw new Error('Enter your Employee ID.');
  var fail = guard_('emp:' + id);
  var emp = readEmployees_()[id];
  if (!emp || !emp.pin || emp.pin !== String(pin || '').trim()) {
    fail('That Employee ID and PIN don\'t match. Ask Marketing if you need your PIN.');
  }
  return emp;
}

function apiSignIn(empId, pin) {
  var emp = checkEmployee_(empId, pin);
  return { id: emp.id, name: emp.name, mine: myStatus_(emp) };
}

function apiMine(empId, pin) { return myStatus_(checkEmployee_(empId, pin)); }

function myStatus_(emp) {
  var month = monthKeyIST(new Date());
  var b = boardFor_(month);
  var me = b.board.rows.filter(function (r) { return r.employeeId === emp.id; })[0];
  var notes = {};
  readObjects_(SHEETS.REVIEW).forEach(function (r) { if (r['Reviewer note']) notes[text_(r['Item ID'])] = text_(r['Reviewer note']); });
  var mine = b.items.filter(function (it) { return it.employeeId === emp.id; }).sort(function (a, c) { return c.submittedAt - a.submittedAt; });
  return {
    month: month,
    points: me ? me.points : 0,
    position: me ? me.position : null,
    pendingPoints: mine.filter(function (it) { return it.month === month && it.status === STATUS.PENDING; })
      .reduce(function (s, it) { return s + ACTIONS[it.action].points; }, 0),
    items: mine.slice(0, 80).map(function (it) {
      return {
        id: it.id, responseId: it.responseId, at: it.submittedAt, action: it.action, points: ACTIONS[it.action].points,
        status: it.status, counted: it.id in b.counted ? b.counted[it.id] : null, postKey: it.postKey, note: notes[it.id] || ''
      };
    })
  };
}

/**
 * @param {Object} p entryType ('ENGAGEMENT'|'ORIGINAL'|'QUORA'), brand, postUrl, actions[], helpfulReplies,
 *   proofLinks, files[{name, mimeType, data(base64)}], originalType, contentUrl, description, quoraUrl, confirmed
 */
function apiSubmit(empId, pin, p) {
  var emp = checkEmployee_(empId, pin);
  p = p || {};
  var type = ENTRY_TYPES[p.entryType];
  if (!type) throw new Error('Choose what this entry is for.');
  var isUrl = function (u) { return /^https?:\/\/\S+$/i.test(String(u || '').trim()); };
  var files = p.files || [];
  var bytes = files.reduce(function (s, f) { return s + Math.ceil(String(f.data || '').length * 3 / 4); }, 0);
  if (bytes > MAX_UPLOAD_BYTES) throw new Error('Files are too large. Keep uploads under 20 MB in total, or share a Drive link instead.');

  var parsed = {
    submittedAt: new Date(), email: emp.email, employeeId: emp.id, entryType: type,
    brand: BRANDS.indexOf(p.brand) !== -1 ? p.brand : '', proofLinks: String(p.proofLinks || ''),
    description: String(p.description || '').slice(0, 300)
  };
  if (p.entryType === 'ENGAGEMENT') {
    if (!isUrl(p.postUrl)) throw new Error('Paste the post link, starting with https://');
    parsed.postUrl = String(p.postUrl).trim();
    parsed.actionLabels = (p.actions || []).filter(function (a) { return ENGAGEMENT_ACTIONS.indexOf(a) !== -1; })
      .map(function (a) { return ACTIONS[a].label; });
    parsed.helpfulReplies = p.helpfulReplies;
    if (!parsed.actionLabels.length && !(Number(p.helpfulReplies) > 0)) throw new Error('Tick at least one thing you did.');
    if (!files.length && !parsed.proofLinks.trim()) throw new Error('Add a screenshot or a proof link.');
  } else if (p.entryType === 'ORIGINAL') {
    if (ORIGINAL_ACTIONS.indexOf(p.originalType) === -1) throw new Error('Choose what you created.');
    if (!p.confirmed) throw new Error('Confirm that you made it yourself.');
    if (!files.length && !isUrl(p.contentUrl)) throw new Error('Upload the clean file or paste a Drive link to it.');
    parsed.originalTypeLabel = ACTIONS[p.originalType].label;
    parsed.contentUrl = isUrl(p.contentUrl) ? String(p.contentUrl).trim() : '';
  } else {
    if (!/^https?:\/\/([a-z]+\.)?quora\.com\//i.test(String(p.quoraUrl || '').trim())) throw new Error('Paste the link to your Quora answer.');
    if (!p.confirmed) throw new Error('Quora answers need the disclosure.');
    parsed.quoraUrl = String(p.quoraUrl).trim();
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var fullId = 'web-' + Utilities.getUuid();
    parsed.responseId = sha256Hex_(fullId).slice(0, 8).toUpperCase();
    var fileIds = saveProofFiles_(files, emp, parsed.responseId);
    if (p.entryType === 'ORIGINAL') {
      parsed.originalFileIds = fileIds;
      parsed.fileHash = fileIds.length ? fileMd5_(fileIds[0]) : '';
    } else {
      parsed.proofFileIds = fileIds;
    }
    var added = recordSubmission_(parsed, fullId, buildIntakeContext_());
    if (!added) throw new Error('Nothing in this entry can earn points.');
    return { added: added, mine: myStatus_(emp) };
  } finally {
    lock.releaseLock();
  }
}

function proofFolder_() {
  var id = getSettings_()[SETTING_KEYS.PROOF_FOLDER_ID];
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ }
  }
  var folder = DriveApp.createFolder('ZOFF Champions proof');
  setSetting_(SETTING_KEYS.PROOF_FOLDER_ID, folder.getId(), 'Where uploaded screenshots and files are saved');
  return folder;
}

function saveProofFiles_(files, emp, shortId) {
  if (!files.length) return [];
  var folder = proofFolder_();
  return files.slice(0, 10).map(function (f, i) {
    var name = [monthKeyIST(new Date()), emp.id, shortId, i + 1, String(f.name || 'proof').replace(/[^\w.\- ]+/g, '_')].join(' ');
    var blob = Utilities.newBlob(Utilities.base64Decode(String(f.data || '')), f.mimeType || 'application/octet-stream', name);
    return folder.createFile(blob).getId();
  });
}

// ---------- reviewers ----------

function checkReviewer_(passcode) {
  var fail = guard_('review');
  var real = PropertiesService.getScriptProperties().getProperty('REVIEW_PASSCODE');
  if (!real) throw new Error('No reviewer passcode yet. In the sheet, choose ZOFF Champions > Set reviewer passcode.');
  if (String(passcode || '') !== real) fail('Wrong passcode.');
}

function apiReviewSignIn(passcode) {
  checkReviewer_(passcode);
  return apiConfig();
}

/** Lines for one month, newest submission first, grouped by submission on the page. */
function apiReviewQueue(passcode, monthKey, filter) {
  checkReviewer_(passcode);
  var finalised = getSettings_()[SETTING_KEYS.FINALISED] || '';
  var rows = readObjects_(SHEETS.REVIEW).filter(function (r) {
    var d = text_(r.Decision) || STATUS.PENDING;
    return r['Item ID'] && text_(r.Month).slice(0, 7) === monthKey && (filter === 'All' || d === filter);
  });
  var b = boardFor_(monthKey);
  return {
    month: monthKey,
    finalised: monthKey <= finalised,
    pending: b.pending,
    canFinalise: monthKey < monthKeyIST(new Date()) && monthKey > finalised && b.pending === 0,
    winnersDue: nthWorkingDay(shiftMonthKey(monthKey, 1), CONFIG.WINNERS_WORKING_DAY, holidays_(getSettings_()), weekendDays_(getSettings_())),
    lines: rows.map(function (r) {
      var submitted = r['Submitted (IST)'];
      return {
        id: text_(r['Item ID']), responseId: text_(r['Response ID']),
        at: submitted instanceof Date ? submitted.getTime() : new Date(submitted).getTime(),
        name: text_(r.Name), empId: text_(r['Employee ID']), entryType: text_(r['Entry type']), brand: text_(r.Brand),
        action: text_(r.Action), points: Number(r['Claimed points']) || 0, postKey: text_(r['Post key']),
        evidence: text_(r.Evidence).split('\n').filter(String), flags: text_(r.Flags).split('\n').filter(String),
        decision: text_(r.Decision) || STATUS.PENDING, note: text_(r['Reviewer note']), reviewedBy: text_(r['Reviewed by'])
      };
    }).reverse()
  };
}

/** @param {{id: string, decision: string, note: string=}[]} decisions */
function apiDecide(passcode, reviewer, decisions) {
  checkReviewer_(passcode);
  reviewer = String(reviewer || '').trim();
  if (!reviewer) throw new Error('Enter your name so decisions are signed.');
  var allowed = [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED];
  var finalised = getSettings_()[SETTING_KEYS.FINALISED] || '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(SHEETS.REVIEW);
    var byId = {};
    readObjects_(SHEETS.REVIEW).forEach(function (r) { byId[text_(r['Item ID'])] = r; });
    var dCol = col_(SHEETS.REVIEW, 'Decision');
    var done = 0;
    (decisions || []).forEach(function (d) {
      var r = byId[d.id];
      if (!r || allowed.indexOf(d.decision) === -1) return;
      if (text_(r.Month).slice(0, 7) <= finalised) throw new Error(text_(r.Month).slice(0, 7) + ' is already finalised, so its entries are locked.');
      sh.getRange(r._row, dCol, 1, 4).setValues([[d.decision, d.note === undefined ? r['Reviewer note'] : String(d.note).slice(0, 300), reviewer, new Date()]]);
      appendRows_(SHEETS.AUDIT, [[new Date(), reviewer + ' (review desk)', d.id + ' -> ' + d.decision + (d.note ? ': ' + d.note : '')]]);
      done++;
    });
    return { saved: done };
  } finally {
    lock.releaseLock();
  }
}

function apiAddPost(passcode, url, brand, label) {
  checkReviewer_(passcode);
  if (!/^https?:\/\/\S+$/i.test(String(url || '').trim())) throw new Error('Paste the full post link, starting with https://');
  var key = normalizeUrl(url);
  if (recentPosts_(1000).some(function (p) { return p.key === key; })) throw new Error('That post is already in the list.');
  appendRows_(SHEETS.POSTS, [[dateKeyIST(new Date()), BRANDS.indexOf(brand) !== -1 ? brand : BRANDS[0], String(url).trim(), key, String(label || '').slice(0, 80)]]);
  return recentPosts_(40);
}

function apiFinalise(passcode, monthKey) {
  checkReviewer_(passcode);
  var ok = finaliseMonth(monthKey);
  if (!ok) throw new Error('Some entries are still pending. Decide them first.');
  return apiLeaderboard(monthKey);
}
