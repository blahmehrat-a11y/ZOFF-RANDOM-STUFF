/**
 * Pure programme rules. Nothing in this file touches Sheets, Forms, Drive or Gmail,
 * so the same code runs in Apps Script and under `npm test`.
 */

// ---------- Dates (IST is a fixed +05:30, no daylight saving) ----------

var IST_OFFSET_MS = 330 * 60 * 1000;
var DAY_MS = 24 * 60 * 60 * 1000;

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function istDate_(date) { return new Date(date.getTime() + IST_OFFSET_MS); }

/** 'YYYY-MM-DD' for the IST calendar day of an instant. */
function dateKeyIST(date) {
  var d = istDate_(date);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

/** 'YYYY-MM' for the IST month of an instant. Entries belong to the month they are submitted in. */
function monthKeyIST(date) { return dateKeyIST(date).slice(0, 7); }

function parseMonthKey_(monthKey) {
  var m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new Error('Bad month key: ' + monthKey);
  return { y: Number(m[1]), m: Number(m[2]) };
}

function shiftMonthKey(monthKey, delta) {
  var p = parseMonthKey_(monthKey);
  var d = new Date(Date.UTC(p.y, p.m - 1 + delta, 1));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1);
}

/** Last instant entries are accepted for a month: 11:59:59.999 PM IST on its last day (slide 16). */
function monthCloseInstant(monthKey) {
  var p = parseMonthKey_(monthKey);
  return new Date(Date.UTC(p.y, p.m, 1) - IST_OFFSET_MS - 1);
}

/**
 * The nth working day of a month as 'YYYY-MM-DD'.
 * @param {string} monthKey 'YYYY-MM'
 * @param {number} n 1-based
 * @param {string[]} holidays 'YYYY-MM-DD' dates that are not working days
 * @param {number[]} weekendDays 0 = Sunday ... 6 = Saturday
 */
function nthWorkingDay(monthKey, n, holidays, weekendDays) {
  var p = parseMonthKey_(monthKey);
  var off = {};
  (holidays || []).forEach(function (h) { off[String(h).trim()] = true; });
  var weekend = weekendDays || CONFIG.DEFAULT_WEEKEND_DAYS;
  var count = 0;
  for (var day = 1; day <= 31; day++) {
    var d = new Date(Date.UTC(p.y, p.m - 1, day));
    if (d.getUTCMonth() !== p.m - 1) break;
    var key = monthKey + '-' + pad2_(day);
    if (weekend.indexOf(d.getUTCDay()) !== -1 || off[key]) continue;
    if (++count === n) return key;
  }
  throw new Error('Month ' + monthKey + ' has fewer than ' + n + ' working days');
}

function addDaysToDateKey(dateKey, days) {
  var p = dateKey.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + days * DAY_MS);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

// ---------- Links ----------

var TRACKING_PARAMS_ = /^(utm_.*|igsh|igshid|si|fbclid|gclid|ref|ref_src|ref_url|feature|trk|trackingid|rcm|lipi|mibextid|s|t)$/i;

/**
 * Canonical form of a post link so the same post matches however it was copied:
 * drops scheme, www./m., tracking params, fragments and trailing slashes, and folds
 * Instagram /reel/ into /p/ and YouTube short forms into watch?v=.
 * Path case is kept because Instagram and YouTube IDs are case-sensitive.
 */
function normalizeUrl(raw) {
  if (!raw) return '';
  var found = /https?:\/\/[^\s<>"']+/i.exec(String(raw));
  if (!found) return String(raw).trim();
  var parts = /^https?:\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?/i.exec(found[0]);
  if (!parts) return found[0];
  var host = parts[1].toLowerCase().replace(/^(www|m|mobile)\./, '');
  var path = parts[2].replace(/\/+$/, '');
  var params = (parts[3] || '').replace(/^\?/, '').split('&').filter(function (kv) {
    return kv && !TRACKING_PARAMS_.test(kv.split('=')[0]);
  });

  if (host === 'instagr.am') host = 'instagram.com';
  if (host === 'instagram.com') path = path.replace(/^\/(reels?|tv)\//, '/p/');
  if (host === 'youtu.be') {
    host = 'youtube.com';
    params = ['v=' + path.replace(/^\//, '')];
    path = '/watch';
  } else if (host === 'youtube.com' && /^\/shorts\//.test(path)) {
    params = ['v=' + path.replace(/^\/shorts\//, '')];
    path = '/watch';
  } else if (host === 'youtube.com' && path === '/watch') {
    params = params.filter(function (kv) { return kv.split('=')[0] === 'v'; });
  } else if (/(^|\.)linkedin\.com$/.test(host)) {
    params = [];
  }
  params.sort();
  return host + path + (params.length ? '?' + params.join('&') : '');
}

// ---------- Turning a form response into reviewable line items ----------

function actionByLabel_(label) {
  for (var code in ACTIONS) if (ACTIONS[code].label === label) return code;
  return null;
}

/**
 * One form response -> one line item per claimed action (slide 15: one entry per post,
 * tick what you did). Reviewers approve or reject each line on its own.
 *
 * @param {Object} r parsed response: responseId, submittedAt (Date), email, employeeId, entryType,
 *   brand, postUrl, actionLabels[], helpfulReplies, proofLinks, proofFileIds[],
 *   originalTypeLabel, contentUrl, originalFileIds[], fileHash, quoraUrl
 */
function expandSubmission(r) {
  var base = {
    responseId: r.responseId,
    submittedAt: r.submittedAt,
    month: monthKeyIST(r.submittedAt),
    date: dateKeyIST(r.submittedAt),
    employeeId: String(r.employeeId || '').trim().toUpperCase(),
    email: String(r.email || '').trim().toLowerCase(),
    entryType: r.entryType,
    brand: r.brand || '',
    postKey: '',
    uniqueKey: '',
    fileHash: '',
    evidence: [],
    unknownLabels: []
  };
  var items = [];
  function push(action, extra) {
    var item = {};
    for (var k in base) item[k] = base[k];
    for (var e in extra) item[e] = extra[e];
    item.action = action;
    item.claimedPoints = ACTIONS[action].points;
    item.status = STATUS.PENDING;
    item.id = r.responseId + '-' + (items.length + 1);
    items.push(item);
  }

  if (r.entryType === ENTRY_TYPES.ENGAGEMENT) {
    var postKey = normalizeUrl(r.postUrl);
    var evidence = [].concat(linksIn_(r.proofLinks), fileLinks_(r.proofFileIds));
    (r.actionLabels || []).forEach(function (label) {
      var code = actionByLabel_(label);
      if (code && ENGAGEMENT_ACTIONS.indexOf(code) !== -1) {
        push(code, { postKey: postKey, evidence: evidence });
      } else {
        base.unknownLabels.push(label);
      }
    });
    var replies = Math.max(0, Math.min(50, Math.floor(Number(r.helpfulReplies) || 0)));
    for (var i = 1; i <= replies; i++) {
      // The form cannot identify a conversation, so each claimed reply gets its own key and
      // the reviewer confirms from the screenshots that they are separate conversations.
      push('HELPFUL_REPLY', { postKey: postKey, uniqueKey: r.responseId + '#conv' + i, evidence: evidence });
    }
  } else if (r.entryType === ENTRY_TYPES.ORIGINAL) {
    var code = actionByLabel_(r.originalTypeLabel);
    if (code && ORIGINAL_ACTIONS.indexOf(code) !== -1) {
      var contentKey = normalizeUrl(r.contentUrl);
      push(code, {
        // Same file (by hash) or same published link = same original (slide 15).
        uniqueKey: r.fileHash ? 'hash:' + r.fileHash : (contentKey ? 'url:' + contentKey : 'resp:' + r.responseId),
        fileHash: r.fileHash || '',
        contentKey: contentKey,
        evidence: [].concat(linksIn_(r.contentUrl), fileLinks_(r.originalFileIds))
      });
    } else if (r.originalTypeLabel) {
      base.unknownLabels.push(r.originalTypeLabel);
    }
  } else if (r.entryType === ENTRY_TYPES.QUORA) {
    var quoraKey = normalizeUrl(r.quoraUrl);
    push('QUORA_ANSWER', { uniqueKey: quoraKey, evidence: linksIn_(r.quoraUrl) });
  }
  return items;
}

function linksIn_(text) {
  if (!text) return [];
  return String(text).match(/https?:\/\/[^\s<>"',]+/gi) || [];
}

function fileLinks_(ids) {
  return (ids || []).map(function (id) { return 'https://drive.google.com/open?id=' + id; });
}

/** What makes two approved line items "the same thing" for points. */
function scoringKey(item) {
  var rule = ACTIONS[item.action];
  if (!rule) return null;
  switch (rule.scope) {
    case 'post': return ['POST', item.employeeId, item.postKey, item.action].join('|');
    case 'conversation': return ['CONV', item.employeeId, item.uniqueKey].join('|');
    case 'original': return 'ORIGINAL|' + item.uniqueKey;
    case 'quora': return 'QUORA|' + item.uniqueKey;
  }
  return null;
}

/**
 * Flags that help the reviewer; they never change points by themselves.
 * @param {Object[]} newItems from expandSubmission
 * @param {Object[]} existing items already in the Review sheet (any month)
 * @param {Object} ctx { isRegistered(employeeId, email) -> bool, knownPostKeys: {postKey: true} }
 */
function flagItems(newItems, existing, ctx) {
  var claimed = {};
  var hashes = {};
  var contentKeys = {};
  existing.forEach(function (it) {
    if (it.status === STATUS.REJECTED) return;
    var k = scoringKey(it);
    if (k) claimed[k] = it.id;
    if (it.fileHash) hashes[it.fileHash] = it.id;
    if (ACTIONS[it.action] && ACTIONS[it.action].scope === 'original' && it.contentKey) contentKeys[it.contentKey] = it.id;
  });

  newItems.forEach(function (it) {
    var flags = [];
    if (!ctx.isRegistered(it.employeeId, it.email)) flags.push('NOT_REGISTERED');
    if (it.unknownLabels && it.unknownLabels.length) flags.push('UNKNOWN_CHOICE: ' + it.unknownLabels.join('; '));
    var scope = ACTIONS[it.action].scope;
    if ((scope === 'post' || scope === 'conversation') && !it.postKey) flags.push('NO_POST_LINK');
    if (scope === 'post' && it.postKey && !ctx.knownPostKeys[it.postKey]) flags.push('POST_NOT_IN_DAILY_LIST');
    if (!it.evidence.length) flags.push('NO_PROOF');

    var k = scoringKey(it);
    if (claimed[k]) flags.push('ALREADY_CLAIMED (' + claimed[k] + ')');
    if (it.fileHash && hashes[it.fileHash] && hashes[it.fileHash] !== claimed[k]) flags.push('SAME_FILE_AS ' + hashes[it.fileHash]);
    if (scope === 'original' && it.contentKey && contentKeys[it.contentKey] && contentKeys[it.contentKey] !== claimed[k]) {
      flags.push('SAME_LINK_AS ' + contentKeys[it.contentKey]);
    }
    if (scope === 'original' && !it.fileHash) flags.push('NO_CLEAN_FILE');

    claimed[k] = claimed[k] || it.id;
    if (it.fileHash) hashes[it.fileHash] = hashes[it.fileHash] || it.id;
    if (scope === 'original' && it.contentKey) contentKeys[it.contentKey] = contentKeys[it.contentKey] || it.id;
    it.flags = flags;
  });
  return newItems;
}

// ---------- Scoring and ranking ----------

function prizeActions_() {
  return CONFIG.PRIZE_BASIS === 'ORIGINALS_ONLY' ? CONFIG.PRIZE_ACTIONS_WHEN_ORIGINALS_ONLY : null;
}

/**
 * Month totals from approved items only. Enforces "counts once" again at scoring time, so a
 * duplicate that slipped through review still earns nothing. Earliest submission wins.
 * @return {{counted: Object<string, number>, scores: Object[]}}
 */
function computeScores(items, monthKey) {
  var prizeOnly = prizeActions_();
  // Earlier months are replayed too: a post, original or answer approved last month
  // has already been counted and cannot score again this month.
  var approved = items.filter(function (it) {
    return it.month <= monthKey && it.status === STATUS.APPROVED && ACTIONS[it.action];
  }).sort(function (a, b) {
    return (a.submittedAt - b.submittedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  var seen = {};
  var counted = {};
  var byEmp = {};
  approved.forEach(function (it) {
    var key = scoringKey(it);
    if (seen[key]) { counted[it.id] = 0; return; }
    seen[key] = true;
    if (it.month !== monthKey) return;
    var pts = ACTIONS[it.action].points;
    counted[it.id] = pts;
    var s = byEmp[it.employeeId];
    if (!s) s = byEmp[it.employeeId] = { employeeId: it.employeeId, points: 0, prizePoints: 0, days: {}, posts: {} };
    s.points += pts;
    if (!prizeOnly || prizeOnly.indexOf(it.action) !== -1) s.prizePoints += pts;
    s.days[it.date] = true;
    if (it.postKey) s.posts[it.postKey] = true;
  });

  var scores = Object.keys(byEmp).map(function (id) {
    var s = byEmp[id];
    return {
      employeeId: id,
      points: s.points,
      prizePoints: s.prizePoints,
      activeDays: Object.keys(s.days).length,
      postsSupported: Object.keys(s.posts).length
    };
  });
  return { counted: counted, scores: scores };
}

/**
 * Orders the month (slide 14): prize points, then more active days, then more different posts
 * supported, then a recorded draw. Only qualified people (>= QUALIFY_POINTS prize points) get
 * prizes; one prize per person because each person has one position.
 *
 * @param {Object[]} scores from computeScores
 * @param {Object} opts
 *   isEligible(employeeId) -> bool
 *   drawKey(employeeId) -> string  Sort key for the draw. Omit for a provisional board: exact ties
 *                                  are then left in ID order and marked drawPending.
 * @return {{rows: Object[], tieGroups: Object[]}}
 */
function rankLeaderboard(scores, opts) {
  var drawKey = opts.drawKey;
  var rows = scores.filter(function (s) { return opts.isEligible(s.employeeId); }).map(function (s) {
    return {
      employeeId: s.employeeId, points: s.points, prizePoints: s.prizePoints,
      activeDays: s.activeDays, postsSupported: s.postsSupported,
      qualified: s.prizePoints >= CONFIG.QUALIFY_POINTS,
      pointsToQualify: Math.max(0, CONFIG.QUALIFY_POINTS - s.prizePoints),
      draw: drawKey ? drawKey(s.employeeId) : s.employeeId
    };
  });

  function standing(a, b) {
    return (b.qualified - a.qualified) || (b.prizePoints - a.prizePoints) ||
      (b.activeDays - a.activeDays) || (b.postsSupported - a.postsSupported);
  }
  rows.sort(function (a, b) {
    return standing(a, b) || (a.draw < b.draw ? -1 : a.draw > b.draw ? 1 : 0);
  });

  var tieGroups = [];
  for (var i = 0; i < rows.length;) {
    var j = i + 1;
    while (j < rows.length && standing(rows[i], rows[j]) === 0) j++;
    if (j - i > 1 && rows[i].qualified) {
      var group = rows.slice(i, j);
      // A tie only needs a draw if it straddles a prize boundary or splits different prizes.
      var prizesInvolved = group.map(function (_, k) { return prizeKey_(i + k + 1); });
      var matters = prizesInvolved.some(function (p) { return p !== prizesInvolved[0]; });
      tieGroups.push({
        prizePoints: rows[i].prizePoints, activeDays: rows[i].activeDays, postsSupported: rows[i].postsSupported,
        order: group.map(function (r) { return r.employeeId; }),
        affectsPrizes: matters
      });
      if (!drawKey && matters) group.forEach(function (r) { r.drawPending = true; });
    }
    i = j;
  }

  var place = 0;
  rows.forEach(function (r) {
    if (!r.qualified) { r.position = null; r.prize = null; return; }
    r.position = ++place;
    r.prize = PRIZES[place - 1] || null;
  });
  return { rows: rows, tieGroups: tieGroups };
}

function prizeKey_(position) {
  var p = PRIZES[position - 1];
  return p ? p.name + '|' + p.value + '|' + p.kind : 'none';
}

/** Budget check (slide 18). Returns a list of problems; empty means fine. */
function validateBudget(awarded) {
  var problems = [];
  var prizeTotal = PRIZES.reduce(function (sum, p) { return sum + p.value; }, 0);
  if (prizeTotal + CONFIG.RECOGNITION_ALLOWANCE > CONFIG.MONTHLY_CAP) {
    problems.push('Prize table ₹' + prizeTotal + ' + allowance ₹' + CONFIG.RECOGNITION_ALLOWANCE +
      ' exceeds the ₹' + CONFIG.MONTHLY_CAP + ' cap');
  }
  if (awarded) {
    var spent = awarded.reduce(function (sum, p) { return sum + (p ? p.value : 0); }, 0);
    if (spent > prizeTotal) problems.push('Awarded ₹' + spent + ' is more than the ₹' + prizeTotal + ' prize budget');
  }
  return problems;
}
