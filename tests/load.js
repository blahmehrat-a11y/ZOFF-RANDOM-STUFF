// Loads the Apps Script globals (Config.js + Rules.js) into one sandbox, the way Apps Script does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load(overrides) {
  const ctx = vm.createContext({});
  for (const f of ['Config.js', 'Rules.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  }
  if (overrides) Object.assign(ctx.CONFIG, overrides);
  return ctx;
};
