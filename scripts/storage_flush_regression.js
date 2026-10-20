/* Storage flush regression.
 *
 * What it protects
 * ----------------
 * Under Electron the store is not written on every setItem: the page queues a
 * save and it lands 80ms later, with a synchronous write on pagehide as the
 * safety net. Reloading in the same tick as a wipe beat both: pagehide's flush
 * did not land, the queued write died with the page, and the next boot read the
 * old file. New Game then looked like it had done nothing at all, the
 * questionnaire and the prologue stayed hidden, and the save file still had the
 * old run in it.
 *
 * The fix is the window.ryzaFlushStorage hook below plus a call to it in front
 * of each location.reload() that follows a wipe.
 *
 * Run: node scripts/storage_flush_regression.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../desktop/web-storage');

let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

console.log('# the page gets a synchronous flush hook');
const boot = ws.bootScript({ 'ryza.settings.v1': '{}' });
ok(boot.indexOf('window.ryzaFlushStorage') !== -1, 'bootScript defines window.ryzaFlushStorage');
ok(boot.indexOf('ryzaFlushStorage=function(){flush(true);}') !== -1,
   'the hook calls flush(true), not the debounced flush(false)');
ok(boot.indexOf('saveWebStorageSync') !== -1, 'the hook is wired to the synchronous bridge');
ok(ws.inject('<html><head></head><body></body></html>', {}).indexOf('ryzaFlushStorage') !== -1,
   'inject puts the hook into the document');

console.log('\n# a queued save reaches the file when it is flushed');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryza-flush-'));
const file = path.join(dir, 'store.json');
ws.queueSave(file, { 'ryza.settings.v1': '{"state":{"day":1}}' });
ok(!fs.existsSync(file), 'nothing is on disk yet, the save is still queued');
ws.flush();
ok(fs.existsSync(file), 'flush writes it');
ok(ws.load(file)['ryza.settings.v1'] === '{"state":{"day":1}}', 'and the value round-trips');
fs.rmSync(dir, { recursive: true, force: true });

console.log('\n# every reload that follows a wipe flushes first');
const WEB = path.join(__dirname, '..', 'web', 'js');
let sites = 0;
fs.readdirSync(WEB).filter((f) => /\.js$/.test(f)).sort().forEach((f) => {
  const src = fs.readFileSync(path.join(WEB, f), 'utf8');
  let i = -1;
  while ((i = src.indexOf('location.reload()', i + 1)) !== -1) {
    sites++;
    const line = src.slice(0, i).split('\n').length;
    const before = src.slice(Math.max(0, i - 400), i);
    ok(before.indexOf('ryzaFlushStorage') !== -1, f + ':' + line + ' flushes the store before reloading');
  }
});
ok(sites === 2, 'both wipe paths are covered (found ' + sites + ' reload site(s))');

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
