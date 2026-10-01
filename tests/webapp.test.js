const test = require('node:test');
const assert = require('node:assert/strict');
const fakeGas = require('./fake-gas');
const plain = (x) => JSON.parse(JSON.stringify(x));

function world() {
  const w = fakeGas('2026-10-05T11:00:00+05:30');
  const { G } = w;
  Object.keys(G.SHEETS).forEach((k) => G.ensureSheet_(G.SHEETS[k]));
  G.seedSettings_();
  G.appendRows_(G.SHEETS.EMPLOYEES, [
    ['Z1', 'Asha', 'asha@zoff.test', '', '', true, '1234'],
    ['Z2', 'Ravi', 'ravi@zoff.test', '', '', true, '']
  ]);
  w.props.REVIEW_PASSCODE = 'letmein123';
  return w;
}
const ENG = ['LIKE', 'COMMENT', 'SOCIAL_SHARE', 'WA_STATUS', 'FRIENDS_GROUP'];

test('doGet serves the employee page by default and the review desk with ?page=review', () => {
  const { G } = world();
  assert.equal(G.doGet({ parameter: {} }).title, 'ZOFF Champions');
  const desk = G.doGet({ parameter: { page: 'review' } });
  assert.equal(desk.title, 'ZOFF Champions Review Desk');
  assert.match(desk.html, /Champions Review Desk/);
  assert.doesNotMatch(G.doGet({ parameter: {} }).html, /apiDecide/);
});

test('employees sign in with ID + PIN; no PIN means no access; repeated wrong PINs lock for 10 minutes', () => {
  const { G } = world();
  assert.equal(G.apiSignIn(' z1 ', '1234').name, 'Asha');
  assert.throws(() => G.apiSignIn('Z2', ''), /don't match/);
  for (let i = 0; i < 5; i++) assert.throws(() => G.apiSignIn('Z1', '0000'), /don't match/);
  assert.throws(() => G.apiSignIn('Z1', '1234'), /Too many/);
});

test('a submission with a screenshot lands in Review, the file is saved, and approval scores it', () => {
  const { G, files, sheets } = world();
  G.apiAddPost('letmein123', 'https://www.instagram.com/p/AAA/', 'ZOFF', 'Spice reel');
  assert.throws(() => G.apiAddPost('letmein123', 'https://instagram.com/reel/AAA?igsh=x', 'ZOFF'), /already in the list/);
  assert.equal(G.apiConfig().posts[0].label, 'Spice reel');

  assert.throws(() => G.apiSubmit('Z1', '1234', { entryType: 'ENGAGEMENT', postUrl: 'https://instagram.com/p/AAA', actions: ['LIKE'] }), /screenshot or a proof link/);
  const r = G.apiSubmit('Z1', '1234', {
    entryType: 'ENGAGEMENT', brand: 'ZOFF', postUrl: 'https://instagram.com/reel/AAA', actions: ENG.concat(['HACK']),
    files: [{ name: 'shot.png', mimeType: 'image/png', data: Buffer.from('png').toString('base64') }]
  });
  assert.equal(r.added, 5);
  assert.equal(Object.keys(files).length, 1);
  assert.equal(r.mine.pendingPoints, 20);

  assert.throws(() => G.apiReviewQueue('nope', '2026-10', 'Pending'), /Wrong passcode/);
  const q = G.apiReviewQueue('letmein123', '2026-10', 'Pending');
  assert.equal(q.lines.length, 5);
  assert.deepEqual(plain(q.lines.flatMap((l) => l.flags)), []);
  assert.match(q.lines[0].evidence.join(), /drive\.google\.com\/open\?id=file1/);

  assert.throws(() => G.apiDecide('letmein123', '', [{ id: q.lines[0].id, decision: 'Approved' }]), /Enter your name/);
  G.apiDecide('letmein123', 'Priya (HR)', q.lines.map((l) => ({ id: l.id, decision: 'Approved' })));
  assert.equal(G.apiReviewQueue('letmein123', '2026-10', 'Pending').lines.length, 0);
  const row = G.readObjects_(G.SHEETS.REVIEW)[0];
  assert.equal(row['Reviewed by'], 'Priya (HR)');
  assert.match(sheets['Audit log'].data.at(-1)[1], /Priya/);

  const board = G.apiLeaderboard('2026-10');
  assert.deepEqual(plain(board.rows.map((x) => [x.name, x.points, x.qualified])), [['Asha', 20, false]]);
  assert.equal(G.apiMine('Z1', '1234').points, 20);

  // Same post again: flagged and, even if approved, it does not score twice.
  G.apiSubmit('Z1', '1234', { entryType: 'ENGAGEMENT', postUrl: 'https://instagram.com/p/AAA', actions: ['LIKE'], proofLinks: 'https://x.test/1' });
  const again = G.apiReviewQueue('letmein123', '2026-10', 'Pending').lines[0];
  assert.match(again.flags.join(), /ALREADY_CLAIMED/);
  G.apiDecide('letmein123', 'Priya', [{ id: again.id, decision: 'Approved' }]);
  assert.equal(G.apiMine('Z1', '1234').points, 20);
});

test('originals and Quora answers are validated server-side', () => {
  const { G } = world();
  assert.throws(() => G.apiSubmit('Z1', '1234', { entryType: 'ORIGINAL', originalType: 'ORIGINAL_REEL', contentUrl: 'https://drive.google.com/x' }), /Confirm/);
  assert.equal(G.apiSubmit('Z1', '1234', { entryType: 'ORIGINAL', originalType: 'ORIGINAL_REEL', contentUrl: 'https://drive.google.com/x', confirmed: true }).added, 1);
  assert.throws(() => G.apiSubmit('Z1', '1234', { entryType: 'QUORA', quoraUrl: 'https://example.com/a', confirmed: true }), /Quora answer/);
  assert.equal(G.apiSubmit('Z1', '1234', { entryType: 'QUORA', quoraUrl: 'https://www.quora.com/q/answer/asha', confirmed: true }).mine.pendingPoints, 70);
  assert.throws(() => G.apiSubmit('Z1', '1234', { entryType: 'BOGUS' }), /Choose what this entry is for/);
});

test('decisions on a finalised month are refused', () => {
  const { G, setNow } = world();
  G.apiSubmit('Z1', '1234', { entryType: 'QUORA', quoraUrl: 'https://www.quora.com/q/answer/asha', confirmed: true });
  const id = G.apiReviewQueue('letmein123', '2026-10', 'All').lines[0].id;
  G.apiDecide('letmein123', 'Priya', [{ id, decision: 'Approved' }]);
  setNow('2026-11-09T10:00:00+05:30');
  assert.equal(G.apiReviewQueue('letmein123', '2026-10', 'All').canFinalise, true);
  G.apiFinalise('letmein123', '2026-10');
  assert.equal(G.apiReviewQueue('letmein123', '2026-10', 'All').finalised, true);
  assert.throws(() => G.apiDecide('letmein123', 'Priya', [{ id, decision: 'Rejected' }]), /finalised/);
});
