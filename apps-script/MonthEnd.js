/**
 * The monthly rhythm (slide 16): Friday scores, final scores on working day 2, winners on
 * working day 5, certificates, archive, and time-off reminders. Every message is created as a
 * Gmail draft so a person reads it before it goes out (slide 19).
 */

/** Weekly trigger, Friday evening. */
function fridayUpdate() {
  var res = rebuildLeaderboard(monthKeyIST(new Date()));
  draft_(marketingEmails_(getSettings_()), 'ZOFF Champions: Friday scores for ' + res.monthKey,
    'Leaderboard as of today (approved entries only):\n\n' + leaderboardSummary_(res) +
    '\n\n' + res.pending + ' entries are waiting for review in the Review sheet.' +
    '\n\nWhen you are happy with it, share the leaderboard with the team.');
}

/** Daily trigger. Works out whether today is a month-end milestone and acts once per month. */
function dailyTick() {
  var s = getSettings_();
  var today = dateKeyIST(new Date());
  var thisMonth = today.slice(0, 7);
  var prev = shiftMonthKey(thisMonth, -1);
  var hol = holidays_(s);
  var wk = weekendDays_(s);

  if (today >= nthWorkingDay(thisMonth, CONFIG.FINAL_SCORES_WORKING_DAY, hol, wk) &&
      (s[SETTING_KEYS.FINAL_SCORES_DONE] || '') < prev) {
    publishFinalScores_(prev, nthWorkingDay(thisMonth, CONFIG.QUERIES_CLOSE_WORKING_DAY, hol, wk));
  }
  if (today >= nthWorkingDay(thisMonth, CONFIG.WINNERS_WORKING_DAY, hol, wk) &&
      (s[SETTING_KEYS.FINALISED] || '') < prev) {
    finaliseMonth(prev);
  }
  timeOffReminders_();
}

function publishFinalScores_(monthKey, queriesBy) {
  var res = rebuildLeaderboard(monthKey);
  var body = 'Entries for ' + monthKey + ' closed at 11:59 PM IST on the last day.\n\n' +
    'Final scores:\n\n' + leaderboardSummary_(res, 30) +
    '\n\nQueries are open until ' + queriesBy + '. Winners are confirmed on working day ' + CONFIG.WINNERS_WORKING_DAY + '.';
  if (res.pending) {
    body = 'ACTION NEEDED: ' + res.pending + ' entries for ' + monthKey + ' are still Pending. ' +
      'Winners cannot be picked until every entry is approved or rejected.\n\n' + body;
  }
  draft_(marketingEmails_(getSettings_()), 'ZOFF Champions: final scores for ' + monthKey, body);
  setSetting_(SETTING_KEYS.FINAL_SCORES_DONE, monthKey);
  audit_('Final scores published for ' + monthKey);
}

/**
 * Picks winners for a month. Refuses while entries are pending or if the month is already done.
 * Ties are settled by a draw whose seed and outcome are written to the Draw log.
 */
function finaliseMonth(monthKey) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var s = getSettings_();
    if ((s[SETTING_KEYS.FINALISED] || '') >= monthKey) throw new Error(monthKey + ' is already finalised.');

    var pending = readReviewItems_().filter(function (it) {
      return it.month === monthKey && it.status === STATUS.PENDING;
    }).length;
    if (pending) {
      draft_(marketingEmails_(s), 'ZOFF Champions: winners for ' + monthKey + ' are waiting on review',
        pending + ' entries for ' + monthKey + ' are still Pending in the Review sheet. ' +
        'Approve or reject them; winners are picked automatically on the next daily run.');
      audit_('Winner selection for ' + monthKey + ' waiting on ' + pending + ' pending entries');
      return false;
    }

    var runAt = new Date();
    var seed = monthKey + '|' + runAt.toISOString() + '|' + Utilities.getUuid();
    var res = rebuildLeaderboard(monthKey, { drawKey: function (id) { return sha256Hex_(seed + '|' + id); } });
    var winners = res.board.rows.filter(function (r) { return r.prize; });

    var problems = validateBudget(winners.map(function (w) { return w.prize; }));
    if (problems.length) throw new Error('Budget check failed: ' + problems.join('; '));

    logDraw_(monthKey, runAt, seed, res.board.tieGroups);
    var today = dateKeyIST(runAt);
    var winnerRows = winners.map(function (w) {
      var e = res.employees[w.employeeId] || {};
      return {
        employee: e, w: w,
        row: [monthKey, w.position, w.employeeId, e.name || w.employeeId, e.email || '', w.prize.name, w.prize.detail,
          w.prize.value, w.prize.kind,
          w.prize.kind === 'time_off' ? addDaysToDateKey(today, CONFIG.TIME_OFF_USE_WITHIN_DAYS) : '',
          w.prize.kind === 'time_off' ? false : '', '', '', 'To arrange']
      };
    });
    winnerRows.forEach(function (x) {
      x.row[12] = makeCertificate_(monthKey, x.w, x.employee) || '';
    });
    appendRows_(SHEETS.WINNERS, winnerRows.map(function (x) { return x.row; }));
    archiveMonth_(monthKey);

    var spent = winners.reduce(function (sum, w) { return sum + w.prize.value; }, 0);
    draft_(marketingEmails_(s), 'ZOFF Champions: ' + monthKey + ' winners (please check, then announce)',
      'Winners for ' + monthKey + ':\n\n' +
      winners.map(function (w) {
        var e = res.employees[w.employeeId] || {};
        return '#' + w.position + '  ' + (e.name || w.employeeId) + '  ' + w.points + ' pts  → ' + w.prize.name + ' (' + w.prize.detail + ')';
      }).join('\n') +
      '\n\nPrize spend: ₹' + spent + ' of ₹' + (CONFIG.MONTHLY_CAP - CONFIG.RECOGNITION_ALLOWANCE) + '. Unawarded prizes stay unspent.' +
      (res.board.tieGroups.some(function (g) { return g.affectsPrizes; }) ? '\nA tie was settled by draw; see the Draw log sheet.' : '') +
      '\n\nStill to do by hand: arrange each reward (Winners sheet, Fulfilment status), bobblehead and Champion Cup, ' +
      'founders\' note and coffee, Wall of Fame, walk-in tracks.');

    setSetting_(SETTING_KEYS.FINALISED, monthKey);
    if ((s[SETTING_KEYS.FINAL_SCORES_DONE] || '') < monthKey) setSetting_(SETTING_KEYS.FINAL_SCORES_DONE, monthKey);
    audit_('Finalised ' + monthKey + ': ' + winners.length + ' winners, ₹' + spent);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function logDraw_(monthKey, runAt, seed, tieGroups) {
  var rows = tieGroups.filter(function (g) { return g.affectsPrizes; }).map(function (g) {
    return [monthKey, runAt, seed, g.prizePoints + ' / ' + g.activeDays + ' / ' + g.postsSupported, g.order.join(' > ')];
  });
  if (!rows.length) rows = [[monthKey, runAt, seed, 'No ties affecting prizes', '']];
  appendRows_(SHEETS.DRAW_LOG, rows);
}

/** Copies the month's leaderboard and review lines into a protected "Archive YYYY-MM" sheet. */
function archiveMonth_(monthKey) {
  var name = 'Archive ' + monthKey;
  var ss = ss_();
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(name);

  var board = sheet_(SHEETS.LEADERBOARD).getDataRange().getValues();
  var review = sheet_(SHEETS.REVIEW).getDataRange().getValues();
  var monthIdx = SHEETS.REVIEW.headers.indexOf('Month');
  var reviewRows = [review[0]].concat(review.slice(1).filter(function (r) { return text_(r[monthIdx]).slice(0, 7) === monthKey; }));

  sh.getRange(1, 1).setValue('Leaderboard').setFontWeight('bold');
  sh.getRange(2, 1, board.length, board[0].length).setValues(pad_(board, board[0].length));
  var start = board.length + 4;
  sh.getRange(start - 1, 1).setValue('Review lines').setFontWeight('bold');
  sh.getRange(start, 1, reviewRows.length, reviewRows[0].length).setValues(reviewRows);
  sh.protect().setDescription('Archived results for ' + monthKey).setWarningOnly(true);
}

function pad_(rows, width) {
  return rows.map(function (r) { r = r.slice(0, width); while (r.length < width) r.push(''); return r; });
}

/**
 * Certificate from a Google Slides template with {{NAME}}, {{PRIZE}}, {{RANK}}, {{MONTH}} and
 * {{POINTS}} placeholders, saved as a PDF. Skipped if no template is configured.
 */
function makeCertificate_(monthKey, w, employee) {
  var s = getSettings_();
  var tpl = s[SETTING_KEYS.CERT_TEMPLATE_ID];
  var folderId = s[SETTING_KEYS.CERT_FOLDER_ID];
  if (!tpl || !folderId) return '';
  var folder = DriveApp.getFolderById(folderId);
  var name = (employee.name || w.employeeId);
  var copy = DriveApp.getFileById(tpl).makeCopy('Certificate ' + monthKey + ' ' + name, folder);
  var deck = SlidesApp.openById(copy.getId());
  var p = monthKey.split('-');
  var monthLabel = Utilities.formatDate(new Date(Date.UTC(+p[0], +p[1] - 1, 15)), CONFIG.TIMEZONE, 'MMMM yyyy');
  deck.replaceAllText('{{NAME}}', name);
  deck.replaceAllText('{{PRIZE}}', w.prize.name);
  deck.replaceAllText('{{RANK}}', String(w.position));
  deck.replaceAllText('{{MONTH}}', monthLabel);
  deck.replaceAllText('{{POINTS}}', String(w.points));
  deck.saveAndClose();
  var pdf = folder.createFile(copy.getAs('application/pdf')).setName('Certificate ' + monthKey + ' ' + name + '.pdf');
  copy.setTrashed(true);
  return pdf.getUrl();
}

/** Drafts a reminder to time-off winners (cc manager) a week before their 60-day window ends. */
function timeOffReminders_() {
  var today = dateKeyIST(new Date());
  var sh = sheet_(SHEETS.WINNERS);
  var employees = readEmployees_();
  readObjects_(SHEETS.WINNERS).forEach(function (r) {
    var useBy = text_(r['Use time off by']);
    if (!useBy || r['Time off used'] === true || text_(r['Reminder drafted'])) return;
    if (addDaysToDateKey(today, CONFIG.TIME_OFF_REMINDER_DAYS_BEFORE) < useBy) return;
    var e = employees[text_(r['Employee ID']).toUpperCase()] || {};
    draft_(text_(r.Email), 'Your ZOFF Champions time off: use it by ' + useBy,
      'Hi ' + (e.name || '') + ',\n\nA reminder that your ' + text_(r.Prize) + ' (' + text_(r.Detail) + ') from ' +
      text_(r.Month) + ' needs to be used by ' + useBy + '. Please agree a date with your manager.\n\nMarketing',
      e.manager);
    sh.getRange(r._row, col_(SHEETS.WINNERS, 'Reminder drafted')).setValue(new Date());
  });
}

function draft_(to, subject, body, cc) {
  if (!to) { console.warn('No recipient for "' + subject + '"; set MARKETING_EMAILS in Settings.'); return; }
  GmailApp.createDraft(to, subject, body, cc ? { cc: cc } : {});
}
