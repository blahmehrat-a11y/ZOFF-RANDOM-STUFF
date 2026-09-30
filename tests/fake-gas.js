// A small in-memory stand-in for the Apps Script services the tracker uses, so the glue code
// can run end to end under Node. It models values only, not formatting.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const data = [];
  const chain = new Proxy({}, { get: (t, k) => () => chain });
  const sheet = {
    data,
    getName: () => name,
    getLastRow: () => {
      for (let r = data.length - 1; r >= 0; r--) if ((data[r] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r + 1;
      return 0;
    },
    getMaxRows: () => Math.max(1000, data.length),
    setFrozenRows: () => {},
    protect: () => chain,
    clearContents: () => { data.length = 0; },
    getDataRange: () => sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), Math.max(1, ...data.map((r) => (r || []).length))),
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === 'string') return chain;
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const v = (data[r - 1 + i] || [])[c - 1 + j];
          return v === undefined ? '' : v;
        })),
        setValues(vals) {
          vals.forEach((row, i) => row.forEach((v, j) => {
            data[r - 1 + i] = data[r - 1 + i] || [];
            data[r - 1 + i][c - 1 + j] = v;
          }));
          return proxy;
        },
        setValue: (v) => range.setValues([[v]]),
        clearContent: () => range.setValues(Array.from({ length: nr }, () => Array(nc).fill(''))),
        getSheet: () => sheet, getRow: () => r, getLastRow: () => r + nr - 1, getColumn: () => c, getLastColumn: () => c + nc - 1
      };
      const proxy = new Proxy(range, { get: (t, k) => (k in t ? t[k] : () => proxy) });
      return proxy;
    }
  };
  return sheet;
}

module.exports = function fakeGas(nowIso) {
  let now = new Date(nowIso).getTime();
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const sheets = {};
  const drafts = [];
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    deleteSheet: (s) => { delete sheets[s.getName()]; },
    toast: () => {},
    getId: () => 'SS'
  };
  const chain = new Proxy({}, { get: () => () => chain });
  const ctx = vm.createContext({
    Date: FakeDate, console,
    SpreadsheetApp: { getActive: () => ss, newDataValidation: () => chain },
    Session: { getActiveUser: () => ({ getEmail: () => 'marketing@zoff.test' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    GmailApp: { createDraft: (to, subject, body, opts) => drafts.push({ to, subject, body, opts }) },
    Drive: { Files: { get: (id) => ({ md5Checksum: 'md5-' + id.replace(/-copy$/, '') }) } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash(alg).update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ')
    }
  });
  const dir = path.join(__dirname, '..', 'apps-script');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return { G: ctx, sheets, drafts, setNow: (iso) => { now = new Date(iso).getTime(); } };
};

/** A FormResponse-shaped object. */
module.exports.response = function (id, whenIso, email, answers) {
  return {
    getId: () => id,
    getTimestamp: () => new Date(whenIso),
    getRespondentEmail: () => email,
    getItemResponses: () => Object.entries(answers).map(([title, value]) => ({
      getItem: () => ({ getTitle: () => title }), getResponse: () => value
    }))
  };
};
