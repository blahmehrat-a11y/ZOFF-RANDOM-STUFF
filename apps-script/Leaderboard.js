/**
 * Approvals, the leaderboard, and the public copy employees see.
 */

/** Installable edit trigger: stamps who approved what, and keeps an audit trail. */
function onSheetEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEETS.REVIEW.name) return;
  var decisionCol = col_(SHEETS.REVIEW, 'Decision');
  if (e.range.getColumn() > decisionCol || e.range.getLastColumn() < decisionCol) return;

  var who = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || 'unknown';
  var finalised = getSettings_()[SETTING_KEYS.FINALISED] || '';
  var monthCol = col_(SHEETS.REVIEW, 'Month');
  var idCol = col_(SHEETS.REVIEW, 'Item ID');
  for (var r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
    if (r === 1) continue;
    var row = sh.getRange(r, 1, 1, SHEETS.REVIEW.headers.length).getValues()[0];
    var decision = text_(row[decisionCol - 1]);
    var month = text_(row[monthCol - 1]).slice(0, 7);
    sh.getRange(r, col_(SHEETS.REVIEW, 'Reviewed by'), 1, 2).setValues([[who, new Date()]]);
    var note = row[idCol - 1] + ' -> ' + decision;
    if (month && month <= finalised) {
      note += ' (month ' + month + ' is already finalised; winners are not changed)';
      toast_('Heads up: ' + month + ' is finalised. This change is logged but does not alter the winners.');
    }
    appendRows_(SHEETS.AUDIT, [[new Date(), who, note]]);
  }
}

/**
 * Recomputes a month from approved items and rewrites the Leaderboard sheet.
 * @param {string=} monthKey defaults to the current IST month
 * @param {{drawKey: function=}=} opts pass drawKey only when picking winners
 */
function rebuildLeaderboard(monthKey, opts) {
  monthKey = monthKey || monthKeyIST(new Date());
  var items = readReviewItems_();
  var result = computeScores(items, monthKey);
  var employees = readEmployees_();
  var board = rankLeaderboard(result.scores, {
    isEligible: function (id) { return employees[id] && employees[id].eligible; },
    drawKey: opts && opts.drawKey
  });
  var pending = items.filter(function (it) { return it.month === monthKey && it.status === STATUS.PENDING; }).length;

  writeCountedPoints_(items, result.counted, monthKey);
  writeLeaderboard_(board, employees, monthKey, pending);
  publishPublicBoard_(board, employees, monthKey);
  return { board: board, pending: pending, employees: employees, monthKey: monthKey };
}

function writeCountedPoints_(items, counted, monthKey) {
  var sh = sheet_(SHEETS.REVIEW);
  var col = col_(SHEETS.REVIEW, 'Counted points');
  if (sh.getLastRow() < 2) return;
  var range = sh.getRange(2, col, sh.getLastRow() - 1, 1);
  var values = range.getValues();
  items.forEach(function (it) {
    if (it.month !== monthKey) return;
    values[it._row - 2][0] = it.id in counted ? counted[it.id] : '';
  });
  range.setValues(values);
}

function boardRows_(board, employees) {
  return board.rows.map(function (r) {
    var e = employees[r.employeeId] || {};
    var note = r.drawPending ? 'Tied: order settled by recorded draw at month end' : '';
    if (!r.qualified) note = r.pointsToQualify + ' more approved points to enter the prize ranking';
    return {
      position: r.position || '', name: e.name || r.employeeId, id: r.employeeId, points: r.points,
      prizePoints: r.prizePoints, days: r.activeDays, posts: r.postsSupported, qualified: r.qualified ? 'Yes' : 'No',
      toQualify: r.pointsToQualify, prize: r.prize ? r.prize.name : '', note: note
    };
  });
}

function writeLeaderboard_(board, employees, monthKey, pending) {
  var sh = sheet_(SHEETS.LEADERBOARD);
  var width = SHEETS.LEADERBOARD.headers.length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  var rows = boardRows_(board, employees).map(function (r) {
    return [r.position, r.name, r.id, r.points, r.prizePoints, r.days, r.posts, r.qualified, r.toQualify, r.prize, r.note];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  sh.getRange(1, width + 2).setValue('Month ' + monthKey + ' · updated ' +
    Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'd MMM yyyy HH:mm') + ' IST · ' + pending + ' entries still pending review');
}

/** Optional view-only spreadsheet for employees: names and points, no emails or evidence. */
function publishPublicBoard_(board, employees, monthKey) {
  var id = getSettings_()[SETTING_KEYS.PUBLIC_SHEET_ID];
  if (!id) return;
  var pub = SpreadsheetApp.openById(id);
  var sh = pub.getSheetByName('Leaderboard') || pub.insertSheet('Leaderboard');
  sh.clearContents();
  var rows = [['ZOFF Champions · ' + monthKey, '', '', ''], ['Position', 'Name', 'Approved points', 'In the prize ranking?']];
  boardRows_(board, employees).forEach(function (r) {
    rows.push([r.position, r.name, r.points, r.qualified === 'Yes' ? 'Yes' : r.toQualify + ' to go']);
  });
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
}

function leaderboardSummary_(res, limit) {
  var lines = boardRows_(res.board, res.employees).slice(0, limit || 15).map(function (r) {
    return (r.position ? '#' + r.position : ' -') + '  ' + r.name + '  ' + r.points + ' pts' +
      (r.prize ? '  → ' + r.prize : '') + (r.note ? '  (' + r.note + ')' : '');
  });
  return lines.length ? lines.join('\n') : '(no approved points yet)';
}

function toast_(msg) {
  try { ss_().toast(msg, 'ZOFF Champions', 8); } catch (e) { console.log(msg); }
}
