const test = require('node:test');
const assert = require('node:assert/strict');
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the vm sandbox have foreign prototypes
const load = require('./load');

const G = load();
const ist = (s) => new Date(s + '+05:30');

test('IST month boundaries: 11:59 PM on the last day is still that month', () => {
  assert.equal(G.monthKeyIST(ist('2026-10-31T23:59:59')), '2026-10');
  assert.equal(G.monthKeyIST(ist('2026-11-01T00:00:00')), '2026-11');
  assert.equal(G.monthCloseInstant('2026-10').getTime(), ist('2026-11-01T00:00:00').getTime() - 1);
  assert.equal(G.shiftMonthKey('2026-01', -1), '2025-12');
});

test('working days skip weekends and listed holidays', () => {
  // 1 Nov 2026 is a Sunday.
  assert.equal(G.nthWorkingDay('2026-11', 1, [], [0, 6]), '2026-11-02');
  assert.equal(G.nthWorkingDay('2026-11', 5, [], [0, 6]), '2026-11-06');
  assert.equal(G.nthWorkingDay('2026-11', 2, ['2026-11-03'], [0, 6]), '2026-11-04');
  assert.equal(G.nthWorkingDay('2026-11', 5, [], [0]), '2026-11-06');
  assert.equal(G.nthWorkingDay('2026-11', 6, [], [0]), '2026-11-07');
});

test('the same post matches however the link was copied', () => {
  const a = G.normalizeUrl('https://www.instagram.com/reel/AbC123/?igsh=xyz&utm_source=ig_web');
  const b = G.normalizeUrl('Look at this http://instagram.com/p/AbC123');
  assert.equal(a, 'instagram.com/p/AbC123');
  assert.equal(a, b);
  assert.notEqual(a, G.normalizeUrl('https://instagram.com/p/abc123'));
  assert.equal(G.normalizeUrl('https://youtu.be/xY_1?si=q'), 'youtube.com/watch?v=xY_1');
  assert.equal(G.normalizeUrl('https://www.youtube.com/shorts/xY_1'), 'youtube.com/watch?v=xY_1');
  assert.equal(G.normalizeUrl('https://www.linkedin.com/posts/akash_x-activity-1-abc?utm_source=share'), 'linkedin.com/posts/akash_x-activity-1-abc');
  assert.equal(G.normalizeUrl(''), '');
});

function engagement(o) {
  return Object.assign({
    responseId: 'R1', submittedAt: ist('2026-10-05T21:00:00'), email: 'Asha@Zoff.co', employeeId: ' z101 ',
    entryType: G.ENTRY_TYPES.ENGAGEMENT, brand: 'ZOFF', postUrl: 'https://instagram.com/p/AAA/',
    actionLabels: [G.ACTIONS.LIKE.label, G.ACTIONS.COMMENT.label], helpfulReplies: '2',
    proofLinks: '', proofFileIds: ['f1']
  }, o);
}

test('an engagement entry becomes one reviewable line per ticked action', () => {
  const items = G.expandSubmission(engagement());
  assert.deepEqual(plain(items.map((i) => [i.action, i.claimedPoints])), [['LIKE', 1], ['COMMENT', 4], ['HELPFUL_REPLY', 5], ['HELPFUL_REPLY', 5]]);
  assert.equal(items[0].employeeId, 'Z101');
  assert.equal(items[0].email, 'asha@zoff.co');
  assert.equal(items[0].postKey, 'instagram.com/p/AAA');
  assert.equal(items[0].month, '2026-10');
  assert.deepEqual(plain(items[0].evidence), ['https://drive.google.com/open?id=f1']);
  assert.equal(new Set(items.map((i) => i.id)).size, 4);
});

test('original and quora entries', () => {
  const orig = G.expandSubmission({
    responseId: 'R2', submittedAt: ist('2026-10-06T10:00:00'), employeeId: 'Z1', entryType: G.ENTRY_TYPES.ORIGINAL,
    originalTypeLabel: G.ACTIONS.FACTORY_REEL.label, contentUrl: '', originalFileIds: ['f9'], fileHash: 'md5abc'
  });
  assert.equal(orig.length, 1);
  assert.equal(orig[0].action, 'FACTORY_REEL');
  assert.equal(orig[0].claimedPoints, 50);
  assert.equal(orig[0].uniqueKey, 'hash:md5abc');

  const q = G.expandSubmission({
    responseId: 'R3', submittedAt: ist('2026-10-06T10:00:00'), employeeId: 'Z1', entryType: G.ENTRY_TYPES.QUORA,
    quoraUrl: 'https://www.quora.com/What-is-ZOFF/answer/Asha?ch=10'
  });
  assert.equal(q[0].claimedPoints, 20);
  assert.equal(q[0].uniqueKey, 'quora.com/What-is-ZOFF/answer/Asha?ch=10');
});

test('flags: unregistered, unknown post, repeat claims, same file, no proof', () => {
  const ctx = { isRegistered: (id) => id === 'Z101', knownPostKeys: { 'instagram.com/p/AAA': true } };
  const first = G.flagItems(G.expandSubmission(engagement({ helpfulReplies: 0 })), [], ctx);
  assert.deepEqual(plain(first.map((i) => i.flags)), [[], []]);

  const again = G.flagItems(G.expandSubmission(engagement({ responseId: 'R9', helpfulReplies: 0 })), first, ctx);
  assert.match(again[0].flags.join(), /ALREADY_CLAIMED \(R1-1\)/);

  const rejected = first.map((i) => Object.assign({}, i, { status: G.STATUS.REJECTED }));
  const retry = G.flagItems(G.expandSubmission(engagement({ responseId: 'R10', helpfulReplies: 0 })), rejected, ctx);
  assert.deepEqual(plain(retry[0].flags), []);

  const stranger = G.flagItems(G.expandSubmission(engagement({
    responseId: 'R11', employeeId: 'X9', postUrl: 'https://instagram.com/p/ZZZ', proofFileIds: [], helpfulReplies: 0
  })), [], ctx);
  assert.deepEqual(plain(stranger[0].flags), ['NOT_REGISTERED', 'POST_NOT_IN_DAILY_LIST', 'NO_PROOF']);

  const orig = (id, emp, url) => G.expandSubmission({
    responseId: id, submittedAt: ist('2026-10-06T10:00:00'), employeeId: emp, entryType: G.ENTRY_TYPES.ORIGINAL,
    originalTypeLabel: G.ACTIONS.ORIGINAL_POST.label, contentUrl: url, originalFileIds: ['f'], fileHash: id === 'O3' ? 'h2' : 'h1'
  });
  const o1 = G.flagItems(orig('O1', 'Z101', ''), [], ctx);
  const o2 = G.flagItems(orig('O2', 'Z101', 'https://instagram.com/p/NEW'), o1, ctx);
  assert.match(o2[0].flags.join(), /ALREADY_CLAIMED \(O1-1\)/);
  const o3 = G.flagItems(orig('O3', 'Z101', 'https://instagram.com/p/NEW'), o1.concat(o2), ctx);
  assert.match(o3[0].flags.join(), /SAME_LINK_AS O2-1/);
});
