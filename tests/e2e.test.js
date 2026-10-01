const test = require('node:test');
const assert = require('node:assert/strict');
const fakeGas = require('./fake-gas');
const { response } = fakeGas;

test('a month end to end: submit, flag, approve, Friday board, final scores, winners, reminders', () => {
  const { G, sheets, drafts, setNow } = fakeGas('2026-10-01T10:00:00+05:30');
  Object.keys(G.SHEETS).forEach((k) => G.ensureSheet_(G.SHEETS[k]));
  G.formatSheets_();
  G.seedSettings_();
  const S = G.SHEETS;
  const settings = G.getSettings_();
  assert.equal(settings.FINALISED_THROUGH, '2026-09');

  // Marketing registers people and pastes the daily links.
  G.appendRows_(S.EMPLOYEES, [
    ['Z1', 'Asha', 'asha@zoff.test', 'boss@zoff.test', '', true],
    ['Z2', 'Ravi', 'ravi@zoff.test', 'boss@zoff.test', '', true],
    ['Z3', 'Meera', 'meera@zoff.test', 'boss@zoff.test', '', true],
    ['M1', 'Reviewer', 'marketing@zoff.test', '', '', false]
  ]);
  G.appendRows_(S.POSTS, [1, 2, 3, 4, 5, 6].map((n) => ['2026-10-0' + n, 'ZOFF', 'https://www.instagram.com/p/POST' + n + '/', '', '']));

  const eng = G.ENGAGEMENT_ACTIONS.map((a) => G.ACTIONS[a].label);
  const Q = G.Q;
  let n = 0;
  const submit = (email, empId, answers, when) => {
    const ctx = G.buildIntakeContext_();
    G.processResponse_(response('resp' + (++n), when || '2026-10-0' + ((n % 9) + 1) + 'T12:00:00+05:30', email, Object.assign({ [Q.EMPLOYEE_ID]: empId }, answers)), ctx);
  };
  const engagement = (email, id, post, extra) => submit(email, id, Object.assign({
    [Q.ENTRY_TYPE]: G.ENTRY_TYPES.ENGAGEMENT, [Q.BRAND]: 'ZOFF',
    [Q.POST_URL]: 'https://instagram.com/reel/POST' + post + '?igsh=abc', [Q.ACTIONS]: eng, [Q.PROOF_FILES]: ['shot' + n]
  }, extra || {}));

  // Asha: full set on five posts (100) + an original Reel (150). Ravi: five posts (100). Meera: four posts (80).
  [1, 2, 3, 4, 5].forEach((p) => engagement('asha@zoff.test', 'z1', p));
  submit('asha@zoff.test', 'Z1', { [Q.ENTRY_TYPE]: G.ENTRY_TYPES.ORIGINAL, [Q.ORIGINAL_TYPE]: G.ACTIONS.ORIGINAL_REEL.label, [Q.ORIGINAL_FILES]: ['reel1'], [Q.ORIGINAL_DESC]: 'Grinding day' });
  [1, 2, 3, 4, 5].forEach((p) => engagement('ravi@zoff.test', 'Z2', p));
  [1, 2, 3, 4].forEach((p) => engagement('meera@zoff.test', 'Z3', p));
  // Repeats and abuse attempts.
  engagement('asha@zoff.test', 'Z1', 1);                                                         // same post again
  submit('ravi@zoff.test', 'Z2', { [Q.ENTRY_TYPE]: G.ENTRY_TYPES.ORIGINAL, [Q.ORIGINAL_TYPE]: G.ACTIONS.ORIGINAL_POST.label, [Q.ORIGINAL_FILES]: ['reel1-copy'] }); // Asha's file
  engagement('meera@zoff.test', 'Z1', 6);                                                        // someone else's ID
  engagement('x@zoff.test', 'Z9', 99);                                                           // not registered, unknown post

  const items = G.readReviewItems_();
  assert.equal(items.length, 5 * 5 + 1 + 5 * 5 + 4 * 5 + 5 + 1 + 5 + 5);
  const flags = G.readObjects_(S.REVIEW).map((r) => r.Flags);
  // Five repeat engagement lines, plus Ravi re-uploading Asha's Reel (same Drive MD5).
  assert.equal(flags.filter((f) => /ALREADY_CLAIMED/.test(f)).length, 6);
  const copy = G.readObjects_(S.REVIEW).find((r) => r['Employee ID'] === 'Z2' && r.Action === 'ORIGINAL_POST');
  assert.match(copy.Flags, /ALREADY_CLAIMED/);
  assert.ok(flags.some((f) => /EMAIL_DOES_NOT_MATCH_ID/.test(f)));
  assert.ok(flags.some((f) => /NOT_REGISTERED/.test(f) && /POST_NOT_IN_DAILY_LIST/.test(f)));
  assert.equal(sheets.Posts.data[1][3], 'instagram.com/p/POST1');

  // Marketing approves everything without flags, rejects the rest, via the dropdown.
  const decisionCol = G.col_(S.REVIEW, 'Decision');
  const review = sheets.Review;
  G.readObjects_(S.REVIEW).forEach((r) => {
    review.getRange(r._row, decisionCol).setValue(r.Flags ? 'Rejected' : 'Approved');
  });
  G.onSheetEdit({ range: review.getRange(2, decisionCol, review.getLastRow() - 1, 1), user: { getEmail: () => 'marketing@zoff.test' } });
  assert.equal(sheets['Audit log'].getLastRow() - 1, items.length);

  // Friday.
  setNow('2026-10-16T17:00:00+05:30');
  G.fridayUpdate();
  let board = sheets.Leaderboard.data.slice(1).map((r) => [r[0], r[1], r[3], r[7]]);
  assert.deepEqual(JSON.parse(JSON.stringify(board)), [[1, 'Asha', 150, 'Yes'], [2, 'Ravi', 100, 'Yes'], ['', 'Meera', 80, 'No']]);
  assert.match(drafts.at(-1).subject, /Friday scores for 2026-10/);

  // Meera: one more post at 11:59 PM on the last day (October, left pending) and one a minute
  // after midnight (November). Her October total becomes 100, an exact tie with Ravi.
  const meeraPost = (post, when) => submit('meera@zoff.test', 'Z3', {
    [Q.ENTRY_TYPE]: G.ENTRY_TYPES.ENGAGEMENT, [Q.POST_URL]: 'https://instagram.com/p/POST' + post, [Q.ACTIONS]: eng, [Q.PROOF_FILES]: ['s']
  }, when);
  meeraPost(6, '2026-10-31T23:59:00+05:30');
  meeraPost(5, '2026-11-01T00:01:00+05:30');
  const tail = G.readObjects_(S.REVIEW).slice(-10);
  assert.deepEqual(JSON.parse(JSON.stringify([...new Set(tail.map((r) => r.Month))])), ['2026-10', '2026-11']);

  // Nov 2026: 2nd is working day 1 (1st is a Sunday). Working day 2 = Nov 3, day 5 = Nov 6.
  setNow('2026-11-02T09:00:00+05:30');
  G.dailyTick();
  assert.ok(!drafts.some((d) => /final scores/.test(d.subject)));

  setNow('2026-11-03T09:00:00+05:30');
  G.dailyTick();
  const finalDraft = drafts.find((d) => /final scores for 2026-10/.test(d.subject));
  assert.match(finalDraft.body, /ACTION NEEDED: 5 entries/); // Meera's 11:59 PM entry is still pending
  G.dailyTick();
  assert.equal(drafts.filter((d) => /final scores/.test(d.subject)).length, 1, 'final scores only once');

  setNow('2026-11-06T09:00:00+05:30');
  G.dailyTick();
  assert.ok(drafts.some((d) => /waiting on review/.test(d.subject)));
  assert.equal(G.getSettings_().FINALISED_THROUGH, '2026-09');

  G.readObjects_(S.REVIEW).filter((r) => r.Decision === 'Pending').forEach((r) => review.getRange(r._row, decisionCol).setValue('Approved'));
  setNow('2026-11-07T09:00:00+05:30');
  G.dailyTick();
  assert.equal(G.getSettings_().FINALISED_THROUGH, '2026-10');
  const winners = sheets.Winners.data.slice(1).map((r) => [r[1], r[3], r[5], r[7]]);
  assert.deepEqual(JSON.parse(JSON.stringify(winners[0])), [1, 'Asha', 'Golden Ticket', 8000]);
  assert.deepEqual(winners.slice(1).map((w) => w[1]).sort(), ['Meera', 'Ravi']);
  assert.deepEqual(winners.slice(1).map((w) => w[3]), [3000, 2500]);
  // Ravi and Meera: 100 points, 5 active days, 5 posts each, so a recorded draw decided 2nd and 3rd.
  const draw = sheets['Draw log'].data[1];
  assert.equal(draw[3], '100 / 5 / 5');
  assert.equal(draw[4], winners.slice(1).map((w) => (w[1] === 'Ravi' ? 'Z2' : 'Z3')).join(' > '));
  assert.ok(sheets['Archive 2026-10']);
  assert.match(drafts.at(-1).body, /settled by draw/);
  assert.match(drafts.at(-1).body, /Prize spend: ₹13500 of ₹16000/);
  assert.throws(() => G.finaliseMonth('2026-10'), /already finalised/);

  // Late approvals for a closed month are logged, not silently applied.
  G.onSheetEdit({ range: review.getRange(2, decisionCol), user: { getEmail: () => 'marketing@zoff.test' } });
  assert.match(sheets['Audit log'].data.at(-1)[2], /already finalised/);
});

test('time-off winners get one reminder draft a week before their 60-day window ends', () => {
  const { G, sheets, drafts, setNow } = fakeGas('2026-11-06T09:00:00+05:30');
  Object.keys(G.SHEETS).forEach((k) => G.ensureSheet_(G.SHEETS[k]));
  G.seedSettings_();
  G.appendRows_(G.SHEETS.EMPLOYEES, [['Z7', 'Kiran', 'kiran@zoff.test', 'lead@zoff.test', '', true]]);
  G.appendRows_(G.SHEETS.WINNERS, [['2026-10', 7, 'Z7', 'Kiran', 'kiran@zoff.test', 'A Whole Day Off', 'One paid day off', 0, 'time_off', '2027-01-05', false, '', '', 'To arrange']]);
  setNow('2026-12-28T09:00:00+05:30');
  G.timeOffReminders_();
  assert.equal(drafts.length, 0);
  setNow('2026-12-29T09:00:00+05:30');
  G.timeOffReminders_();
  G.timeOffReminders_();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].opts.cc, 'lead@zoff.test');
});
