/**
 * One-time setup: sheets, the proof form, validation, and triggers. Safe to run again.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ZOFF Champions')
    .addItem('Set up (run once)', 'setup')
    .addItem('Set reviewer passcode…', 'menuSetPasscode')
    .addItem('Give PINs to employees without one', 'menuGeneratePins')
    .addSeparator()
    .addItem('Rebuild this month\'s leaderboard', 'menuRebuildThisMonth')
    .addItem('Rebuild last month\'s leaderboard', 'menuRebuildLastMonth')
    .addItem('Pick up missed form responses', 'syncAllResponses')
    .addItem('Run the daily month-end check now', 'dailyTick')
    .addItem('Finalise a month now…', 'menuFinalise')
    .addSeparator()
    .addItem('Optional: also create a Google Form', 'menuCreateForm')
    .addToUi();
}

function menuSetPasscode() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Reviewer passcode', 'Marketing and HR type this on the review page. Use at least 8 characters.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var code = r.getResponseText().trim();
  if (code.length < 8) { ui.alert('Use at least 8 characters.'); return; }
  PropertiesService.getScriptProperties().setProperty('REVIEW_PASSCODE', code);
  audit_('Reviewer passcode changed');
  ui.alert('Saved. Share it only with Marketing and HR reviewers.');
}

/** Fills a random 4-digit PIN for every employee row that has an ID but no PIN. */
function menuGeneratePins() {
  var sh = sheet_(SHEETS.EMPLOYEES);
  var col = col_(SHEETS.EMPLOYEES, 'PIN');
  var n = 0;
  readObjects_(SHEETS.EMPLOYEES).forEach(function (r) {
    if (text_(r['Employee ID']) && !text_(r.PIN)) {
      sh.getRange(r._row, col).setNumberFormat('@').setValue(String(1000 + Math.floor(Math.random() * 9000)));
      n++;
    }
  });
  toast_(n ? 'Added ' + n + ' PINs. Send each person their own PIN privately.' : 'Everyone already has a PIN.');
}

function menuCreateForm() {
  var s = getSettings_();
  if (s[SETTING_KEYS.FORM_ID]) { SpreadsheetApp.getUi().alert('A form already exists: ' + FormApp.openById(s[SETTING_KEYS.FORM_ID]).getEditUrl()); return; }
  var form = createForm_();
  setSetting_(SETTING_KEYS.FORM_ID, form.getId(), 'Created from the menu');
  installTriggers_(form.getId());
  SpreadsheetApp.getUi().alert('Form created: ' + form.getEditUrl() + '\nAdd the two File upload questions by hand (see README).');
}

function menuRebuildThisMonth() { rebuildLeaderboard(monthKeyIST(new Date())); toast_('Leaderboard updated.'); }
function menuRebuildLastMonth() { rebuildLeaderboard(shiftMonthKey(monthKeyIST(new Date()), -1)); toast_('Leaderboard updated.'); }

function menuFinalise() {
  var ui = SpreadsheetApp.getUi();
  var prev = shiftMonthKey(monthKeyIST(new Date()), -1);
  var r = ui.prompt('Finalise a month', 'Month to pick winners for (YYYY-MM):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var month = r.getResponseText().trim() || prev;
  var done = finaliseMonth(month);
  ui.alert(done ? 'Winners for ' + month + ' picked. Check Winners, Draw log and your Gmail drafts.'
    : 'Some entries for ' + month + ' are still Pending. Review them first.');
}

function setup() {
  var problems = validateBudget();
  if (problems.length) throw new Error(problems.join('; '));

  Object.keys(SHEETS).forEach(function (k) { ensureSheet_(SHEETS[k]); });
  formatSheets_();
  seedSettings_();

  installTriggers_(getSettings_()[SETTING_KEYS.FORM_ID]);
  proofFolder_();

  SpreadsheetApp.getUi().alert('ZOFF Champions is set up.\n\n' +
    'Next:\n' +
    '1. Fill in the Employees sheet (ID, name, email, tick Eligible), then ZOFF Champions > Give PINs to employees.\n' +
    '2. ZOFF Champions > Set reviewer passcode.\n' +
    '3. In Apps Script: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.\n' +
    '   The URL it gives you is the employee page. Add ?page=review to the end for the Marketing & HR page.');
}

function seedSettings_() {
  var s = getSettings_();
  var prev = shiftMonthKey(monthKeyIST(new Date()), -1);
  var me = Session.getActiveUser().getEmail();
  var defaults = [
    [SETTING_KEYS.MARKETING_EMAILS, me, 'Who gets the Friday, final-score and winner drafts (comma separated)'],
    [SETTING_KEYS.HOLIDAYS, '', 'Company holidays as YYYY-MM-DD, comma separated. Used for "working day 2 / 4 / 5"'],
    [SETTING_KEYS.WEEKEND_DAYS, CONFIG.DEFAULT_WEEKEND_DAYS.join(','), '0 = Sunday, 6 = Saturday. Use 0 if Saturday is a working day'],
    [SETTING_KEYS.CERT_TEMPLATE_ID, '', 'Google Slides template ID with {{NAME}} {{PRIZE}} {{RANK}} {{MONTH}} {{POINTS}}'],
    [SETTING_KEYS.CERT_FOLDER_ID, '', 'Drive folder ID for certificate PDFs'],
    [SETTING_KEYS.PUBLIC_SHEET_ID, '', 'Optional: a separate spreadsheet shared view-only with employees'],
    [SETTING_KEYS.FINAL_SCORES_DONE, prev, 'Managed by the script'],
    [SETTING_KEYS.FINALISED, prev, 'Managed by the script. Months up to here are closed']
  ];
  defaults.forEach(function (d) { if (!(d[0] in s)) setSetting_(d[0], d[1], d[2]); });
}

function formatSheets_() {
  var review = sheet_(SHEETS.REVIEW);
  ['Month', 'Activity date', 'Employee ID', 'Item ID', 'Post key', 'Unique key', 'Content key'].forEach(function (h) {
    review.getRange(2, col_(SHEETS.REVIEW, h), review.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  review.getRange(2, col_(SHEETS.REVIEW, 'Submitted (IST)'), review.getMaxRows() - 1, 1).setNumberFormat('d mmm yyyy hh:mm');
  review.getRange(2, col_(SHEETS.REVIEW, 'Decision'), review.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED], true).build());
  review.getRange(2, col_(SHEETS.REVIEW, 'Evidence'), review.getMaxRows() - 1, 1).setWrap(true);
  review.getRange(2, col_(SHEETS.REVIEW, 'Flags'), review.getMaxRows() - 1, 1).setWrap(true).setFontColor('#b3261e');

  var emp = sheet_(SHEETS.EMPLOYEES);
  emp.getRange(2, col_(SHEETS.EMPLOYEES, 'Employee ID'), emp.getMaxRows() - 1, 1).setNumberFormat('@');
  emp.getRange(2, col_(SHEETS.EMPLOYEES, 'Eligible'), emp.getMaxRows() - 1, 1).insertCheckboxes();
  emp.getRange(2, col_(SHEETS.EMPLOYEES, 'PIN'), emp.getMaxRows() - 1, 1).setNumberFormat('@');

  var winners = sheet_(SHEETS.WINNERS);
  winners.getRange(2, 1, winners.getMaxRows() - 1, 1).setNumberFormat('@');
  winners.getRange(2, col_(SHEETS.WINNERS, 'Use time off by'), winners.getMaxRows() - 1, 1).setNumberFormat('@');
  winners.getRange(2, col_(SHEETS.WINNERS, 'Time off used'), winners.getMaxRows() - 1, 1).insertCheckboxes();
  winners.getRange(2, col_(SHEETS.WINNERS, 'Fulfilment status'), winners.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['To arrange', 'Ordered', 'Delivered', 'Used'], true).build());

  sheet_(SHEETS.SETTINGS).getRange('B:B').setNumberFormat('@');
  sheet_(SHEETS.DRAW_LOG).getRange('A:A').setNumberFormat('@');
}

function createForm_() {
  var form = FormApp.create('ZOFF Champions: send your proof');
  form.setDescription('One entry per post. Choose ZOFF or Akash, tick what you did, and add the link or ' +
    'screenshots. Hide other people\'s names and numbers in screenshots. Marketing checks every entry before points count.');
  form.setCollectEmail(true);
  form.setAllowResponseEdits(false);
  try { form.setRequireLogin(true); } catch (e) { /* only available on Google Workspace */ }

  form.addTextItem().setTitle(Q.EMPLOYEE_ID).setRequired(true);
  var type = form.addMultipleChoiceItem().setTitle(Q.ENTRY_TYPE).setRequired(true);
  var url = FormApp.createTextValidation().requireTextIsUrl().setHelpText('Paste the full link').build();

  var pEng = form.addPageBreakItem().setTitle('Engagement on a daily post');
  form.addMultipleChoiceItem().setTitle(Q.BRAND).setChoiceValues(BRANDS).setRequired(true);
  form.addTextItem().setTitle(Q.POST_URL).setValidation(url).setRequired(true);
  form.addCheckboxItem().setTitle(Q.ACTIONS)
    .setHelpText('Each action counts once per post. Friends and groups share one 5-point allowance.')
    .setChoiceValues(ENGAGEMENT_ACTIONS.map(function (a) { return ACTIONS[a].label; }));
  form.addTextItem().setTitle(Q.HELPFUL_REPLIES)
    .setHelpText('5 points per separate conversation where you answered a real question. Add a screenshot of each.')
    .setValidation(FormApp.createTextValidation().requireNumberBetween(0, 50).build());
  form.addParagraphTextItem().setTitle(Q.PROOF_LINKS);

  var pOrig = form.addPageBreakItem().setTitle('Your original content')
    .setHelpText('Made by you. Clear to see or hear. Relevant to ZOFF or Akash. Check with Marketing before filming at the factory.');
  pOrig.setGoToPage(FormApp.PageNavigationType.SUBMIT); // engagement section ends here
  form.addMultipleChoiceItem().setTitle(Q.ORIGINAL_BRAND).setChoiceValues(BRANDS).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.ORIGINAL_TYPE).setRequired(true)
    .setChoiceValues(ORIGINAL_ACTIONS.map(function (a) { return ACTIONS[a].label; }));
  form.addTextItem().setTitle(Q.ORIGINAL_URL).setValidation(url);
  form.addTextItem().setTitle(Q.ORIGINAL_DESC).setRequired(true);
  form.addCheckboxItem().setTitle(Q.ORIGINAL_CONFIRM).setRequired(true)
    .setChoiceValues(['I made this myself for this programme, beyond my assigned work, and it is not a re-edit of something I already entered']);

  var pQuora = form.addPageBreakItem().setTitle('Quora answer');
  pQuora.setGoToPage(FormApp.PageNavigationType.SUBMIT); // original section ends here
  form.addMultipleChoiceItem().setTitle(Q.QUORA_BRAND).setChoiceValues(BRANDS).setRequired(true);
  form.addTextItem().setTitle(Q.QUORA_URL).setValidation(url).setRequired(true);
  form.addCheckboxItem().setTitle(Q.QUORA_CONFIRM).setRequired(true)
    .setChoiceValues(['My answer says I work at ZOFF and reflects my own experience']);

  type.setChoices([
    type.createChoice(ENTRY_TYPES.ENGAGEMENT, pEng),
    type.createChoice(ENTRY_TYPES.ORIGINAL, pOrig),
    type.createChoice(ENTRY_TYPES.QUORA, pQuora)
  ]);
  return form;
}

var TRIGGER_HANDLERS_ = ['onFormSubmitHandler', 'onSheetEdit', 'fridayUpdate', 'dailyTick'];

function installTriggers_(formId) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS_.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  if (formId) ScriptApp.newTrigger('onFormSubmitHandler').forForm(formId).onFormSubmit().create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss_()).onEdit().create();
  ScriptApp.newTrigger('fridayUpdate').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(CONFIG.FRIDAY_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('dailyTick').timeBased().everyDays(1)
    .atHour(CONFIG.DAILY_HOUR).inTimezone(CONFIG.TIMEZONE).create();
}
