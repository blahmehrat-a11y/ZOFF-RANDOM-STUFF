const test = require('node:test');
const assert = require('node:assert/strict');
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the vm sandbox have foreign prototypes
const load = require('./load');

const G = load();
const ist = (s) => new Date(s + '+05:30');

let seq = 0;
function item(o) {
  seq++;
  return Object.assign({
    id: 'r' + seq + '-1', month: '2026-10', date: '2026-10-05', submittedAt: ist('2026-10-05T10:00:00').getTime() + seq,
    status: G.STATUS.APPROVED, postKey: '', uniqueKey: '', employeeId: 'E1'
  }, o);
}
// The 20-point set from slide 13 on one post.
function fullSet(emp, post, date) {
  return G.ENGAGEMENT_ACTIONS.map((a) => item({ employeeId: emp, postKey: post, action: a, date: date || '2026-10-05' }));
}
const all = () => true;

test('deck arithmetic: one post = 20, + reel = 70, five posts = 100 (slide 13)', () => {
  let r = G.computeScores(fullSet('E1', 'p1'), '2026-10');
  assert.equal(r.scores[0].points, 20);
  r = G.computeScores([...fullSet('E1', 'p1'), item({ action: 'ORIGINAL_REEL', uniqueKey: 'hash:a' })], '2026-10');
  assert.equal(r.scores[0].points, 70);
  const five = [1, 2, 3, 4, 5].flatMap((n) => fullSet('E1', 'p' + n));
  r = G.computeScores(five, '2026-10');
  assert.equal(r.scores[0].points, 100);
  assert.equal(G.rankLeaderboard(r.scores, { isEligible: all }).rows[0].qualified, true);
});

test('engagement actions count once per post, even if approved twice', () => {
  const items = [...fullSet('E1', 'p1'), ...fullSet('E1', 'p1')];
  const r = G.computeScores(items, '2026-10');
  assert.equal(r.scores[0].points, 20);
  assert.equal(Object.values(r.counted).filter((v) => v === 0).length, 5);
});

test('a post counted last month cannot score again this month', () => {
  const sep = fullSet('E1', 'p1', '2026-09-30').map((i) => Object.assign(i, { month: '2026-09', submittedAt: i.submittedAt - 1e9 }));
  const oct = fullSet('E1', 'p1');
  assert.equal(G.computeScores([...sep, ...oct], '2026-10').scores.length, 0);
  assert.equal(G.computeScores([...sep, ...oct], '2026-09').scores[0].points, 20);
});

test('helpful replies count once per conversation, not per post', () => {
  const items = [
    item({ action: 'HELPFUL_REPLY', postKey: 'p1', uniqueKey: 'c1' }),
    item({ action: 'HELPFUL_REPLY', postKey: 'p1', uniqueKey: 'c2' }),
    item({ action: 'HELPFUL_REPLY', postKey: 'p1', uniqueKey: 'c1' })
  ];
  assert.equal(G.computeScores(items, '2026-10').scores[0].points, 10);
});

test('an original counts once across everyone; earliest submission wins; factory reel is 50 total', () => {
  const items = [
    item({ employeeId: 'E2', action: 'FACTORY_REEL', uniqueKey: 'hash:x', submittedAt: 2e12 }),
    item({ employeeId: 'E1', action: 'FACTORY_REEL', uniqueKey: 'hash:x', submittedAt: 1e12 })
  ];
  const s = G.computeScores(items, '2026-10').scores;
  assert.deepEqual(plain(s.map((x) => [x.employeeId, x.points])), [['E1', 50]]);
});

test('quora answers score 20 once per answer', () => {
  const items = [item({ action: 'QUORA_ANSWER', uniqueKey: 'quora.com/a/1' }), item({ action: 'QUORA_ANSWER', uniqueKey: 'quora.com/a/1' })];
  assert.equal(G.computeScores(items, '2026-10').scores[0].points, 20);
});

test('pending and rejected items earn nothing', () => {
  const items = [item({ action: 'LIKE', postKey: 'p', status: G.STATUS.PENDING }), item({ action: 'COMMENT', postKey: 'p', status: G.STATUS.REJECTED })];
  assert.equal(G.computeScores(items, '2026-10').scores.length, 0);
});

function score(id, points, days, posts) {
  return { employeeId: id, points, prizePoints: points, activeDays: days, postsSupported: posts };
}

test('ranking tie-breaks: points, then active days, then posts supported (slide 14)', () => {
  const rows = G.rankLeaderboard([
    score('A', 120, 3, 9), score('B', 150, 1, 1), score('C', 120, 5, 1), score('D', 120, 3, 10), score('E', 90, 20, 20)
  ], { isEligible: all }).rows;
  assert.deepEqual(plain(rows.map((r) => r.employeeId)), ['B', 'C', 'D', 'A', 'E']);
  assert.deepEqual(plain(rows.map((r) => r.position)), [1, 2, 3, 4, null]);
  assert.equal(rows[0].prize.name, 'Golden Ticket');
  assert.equal(rows[4].prize, null);
  assert.equal(rows[4].pointsToQualify, 10);
});

test('exact ties are resolved by a reproducible draw and reported', () => {
  const scores = [score('A', 200, 4, 4), score('B', 200, 4, 4), score('C', 300, 1, 1)];
  const provisional = G.rankLeaderboard(scores, { isEligible: all });
  assert.equal(provisional.rows[1].drawPending, true);
  const draw = { A: 'ff', B: '00' };
  const final = G.rankLeaderboard(scores, { isEligible: all, drawKey: (id) => draw[id] || '' });
  assert.deepEqual(plain(final.rows.map((r) => r.employeeId)), ['C', 'B', 'A']);
  assert.equal(final.tieGroups.length, 1);
  assert.equal(final.tieGroups[0].affectsPrizes, true);
});

test('a tie between ranks 5 and 6 (same prize) does not need a draw', () => {
  const scores = ['A', 'B', 'C', 'D'].map((id, i) => score(id, 500 - i * 10, 1, 1)).concat([score('E', 100, 1, 1), score('F', 100, 1, 1)]);
  const res = G.rankLeaderboard(scores, { isEligible: all });
  assert.equal(res.tieGroups[0].affectsPrizes, false);
  assert.ok(!res.rows.some((r) => r.drawPending));
});

test('only nine prizes are given; ineligible people are left off', () => {
  const scores = Array.from({ length: 12 }, (_, i) => score('E' + i, 1000 - i, 1, 1));
  const rows = G.rankLeaderboard(scores, { isEligible: (id) => id !== 'E0' }).rows;
  assert.equal(rows.length, 11);
  assert.equal(rows[0].employeeId, 'E1');
  assert.equal(rows.filter((r) => r.prize).length, 9);
  assert.equal(rows[8].prize.kind, 'time_off');
});

test('originals-only fallback (slide 20): engagement is tracked but does not win paid prizes', () => {
  const H = load({ PRIZE_BASIS: 'ORIGINALS_ONLY' });
  const mk = (o) => Object.assign(item(o), { status: H.STATUS.APPROVED });
  const items = [1, 2, 3, 4, 5, 6].flatMap((n) => H.ENGAGEMENT_ACTIONS.map((a) => mk({ employeeId: 'ENG', postKey: 'p' + n, action: a })))
    .concat([mk({ employeeId: 'CRE', action: 'ORIGINAL_REEL', uniqueKey: 'h1' }), mk({ employeeId: 'CRE', action: 'ORIGINAL_REEL', uniqueKey: 'h2' })]);
  const s = H.computeScores(items, '2026-10').scores;
  const eng = s.find((x) => x.employeeId === 'ENG');
  assert.equal(eng.points, 120);
  assert.equal(eng.prizePoints, 0);
  const rows = H.rankLeaderboard(s, { isEligible: all }).rows;
  assert.equal(rows[0].employeeId, 'CRE');
  assert.equal(rows.find((r) => r.employeeId === 'ENG').qualified, false);
});

test('budget matches slide 18: ₹16,000 prizes + ₹4,000 allowance = ₹20,000', () => {
  assert.equal(G.PRIZES.reduce((s, p) => s + p.value, 0), 16000);
  assert.deepEqual(plain(G.validateBudget(G.PRIZES)), []);
  assert.equal(load({ MONTHLY_CAP: 19999 }).validateBudget().length, 1);
});
