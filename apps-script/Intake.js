/**
 * Form submission -> pending line items in the Review sheet, with duplicate and eligibility flags.
 * Nothing here awards points; a person approves every line (slide 15, "Marketing checks and adds the points").
 */

/** Installable form-submit trigger (created by setup). */
function onFormSubmitHandler(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    processResponse_(e.response, buildIntakeContext_());
  } finally {
    lock.releaseLock();
  }
}

/** Menu: pick up any responses the trigger missed. Safe to run any time. */
function syncAllResponses() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var formId = getSettings_()[SETTING_KEYS.FORM_ID];
    if (!formId) { toast_('No Google Form is set up. Entries come in through the web app.'); return; }
    var form = FormApp.openById(formId);
    var ctx = buildIntakeContext_();
    var added = 0;
    form.getResponses().forEach(function (resp) {
      if (!ctx.seenResponses[resp.getId()]) added += processResponse_(resp, ctx);
    });
    toast_('Added ' + added + ' line items from missed responses.');
  } finally {
    lock.releaseLock();
  }
}

function buildIntakeContext_() {
  var employees = readEmployees_();
  var existing = readReviewItems_();
  var seen = {};
  existing.forEach(function (it) { seen[it.responseId] = true; });
  return {
    employees: employees,
    existing: existing,
    seenResponses: seen,
    knownPostKeys: knownPostKeys_(),
    isRegistered: function (id) { return !!employees[id]; }
  };
}

/** @return {number} line items added */
function processResponse_(response, ctx) {
  if (ctx.seenResponses[response.getId()]) return 0;
  return recordSubmission_(parseFormResponse_(response), response.getId(), ctx);
}

/**
 * Shared by the Google Form and the web app: one parsed submission -> flagged Review lines.
 * @return {number} line items added
 */
function recordSubmission_(parsed, fullId, ctx) {
  var items = expandSubmission(parsed);
  if (!items.length) {
    audit_('Submission ' + fullId + ' from ' + (parsed.email || parsed.employeeId) + ' had nothing to score');
    ctx.seenResponses[fullId] = true;
    return 0;
  }
  flagItems(items, ctx.existing, ctx);

  var employee = ctx.employees[items[0].employeeId];
  items.forEach(function (it) {
    it.fullResponseId = fullId;
    // The Employee ID is typed by hand, so check it belongs to the signed-in person.
    if (employee && employee.email && it.email && employee.email !== it.email) it.flags.unshift('EMAIL_DOES_NOT_MATCH_ID');
    if (parsed.description) it.evidence.unshift('“' + parsed.description + '”');
  });

  appendRows_(SHEETS.REVIEW, items.map(function (it) { return reviewRow_(it, employee); }));
  ctx.existing = ctx.existing.concat(items);
  ctx.seenResponses[fullId] = true;
  return items.length;
}

function parseFormResponse_(response) {
  var a = {};
  response.getItemResponses().forEach(function (ir) { a[ir.getItem().getTitle()] = ir.getResponse(); });
  var originalFiles = asArray_(a[Q.ORIGINAL_FILES]);
  return {
    responseId: sha256Hex_(response.getId()).slice(0, 8).toUpperCase(),
    submittedAt: response.getTimestamp(),
    email: response.getRespondentEmail(),
    employeeId: a[Q.EMPLOYEE_ID],
    entryType: a[Q.ENTRY_TYPE],
    brand: a[Q.BRAND] || a[Q.ORIGINAL_BRAND] || a[Q.QUORA_BRAND] || '',
    postUrl: a[Q.POST_URL],
    actionLabels: asArray_(a[Q.ACTIONS]),
    helpfulReplies: a[Q.HELPFUL_REPLIES],
    proofLinks: a[Q.PROOF_LINKS],
    proofFileIds: asArray_(a[Q.PROOF_FILES]),
    originalTypeLabel: a[Q.ORIGINAL_TYPE],
    contentUrl: a[Q.ORIGINAL_URL],
    description: a[Q.ORIGINAL_DESC] || '',
    originalFileIds: originalFiles,
    fileHash: originalFiles.length ? fileMd5_(originalFiles[0]) : '',
    quoraUrl: a[Q.QUORA_URL]
  };
}

function asArray_(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

/** Drive's own MD5 of an uploaded file, so a re-upload of the same file is caught without downloading it. */
function fileMd5_(fileId) {
  try {
    return Drive.Files.get(fileId, { fields: 'md5Checksum', supportsAllDrives: true }).md5Checksum || '';
  } catch (e) {
    console.warn('Could not read MD5 for ' + fileId + ': ' + e);
    return '';
  }
}
