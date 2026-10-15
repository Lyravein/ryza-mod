/*
 * Verify the translations through the real Electron shell, not just Chrome.
 *
 * Run from desktop/ (Electron must be launched from where its binary lives):
 *   PROBE_LANG=en ./node_modules/electron/dist/electron \
 *     ../scripts/verify_i18n_electron.js --no-sandbox
 *
 * Exit 0 = every translated node in that language is free of CJK.
 * PROBE_LANG defaults to 'en'; pass 'ja' or 'zh' as a positive control —
 * those languages legitimately contain CJK, so a healthy run reports a
 * three-digit leak count there. If 'ja' also reports 0, the detector is
 * broken, not the app.
 *
 * Two rules worth keeping in sync with scripts/html_i18n_guard.js:
 *   - U+FF0B (＋) and U+FF0D (－) are the fullwidth maths signs on the zoom
 *     buttons. They are icon glyphs, not language, and stay in every locale,
 *     so they are stripped before the CJK test.
 *   - The window is created hidden and the app boots late, so the probe polls
 *     for window.I18n / window.Config instead of assuming a fixed delay, and
 *     a hard timeout guarantees it exits rather than hanging silently.
 *
 * This exists because the app's own earlier Electron probe hung with no
 * output, which made a whole verification path look done when it was not.
 */
const { app, BrowserWindow } = require('electron');
/* Shared with scripts/html_i18n_guard.js so the two checks cannot drift.
   require() resolves against this file, not the cwd, so this works even
   though Electron must be launched from desktop/. */
const { CJK_SOURCE, MATHS_SOURCE } = require('./lib/i18n_cjk.js');

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const APP_URL = 'http://127.0.0.1:8770/';
const LANG = process.env.PROBE_LANG || 'en';
const HARD_LIMIT_MS = 90 * 1000;

function say(...a) { console.log('[probe]', ...a); }

/* Always exit, even if the window never finishes loading: a silent hang is
   what made the previous attempt useless. */
const killer = setTimeout(() => {
  say('HARD TIMEOUT reached — the window never got to a reportable state');
  process.exit(9);
}, HARD_LIMIT_MS);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = `(function(){
  /* Ranges come from scripts/lib/i18n_cjk.js, injected at build-free
     runtime so this probe and html_i18n_guard.js can never disagree about
     what counts as CJK. U+FF0B (＋) and U+FF0D (－) are the zoom buttons'
     fullwidth maths signs: icon glyphs, not language. */
  var MATHS = new RegExp(${JSON.stringify(MATHS_SOURCE)}, 'g');
  var CJK = new RegExp(${JSON.stringify(CJK_SOURCE)});
  if (!window.I18n || !window.Config) return { stage: 'not-booted' };
  try {
    if (Config.section) Config.section('app').lang = "${LANG}";
    I18n.setLang("${LANG}");
    /* Replay the app's OWN language-change path, not a shortcut. In
       App._openLangSheet the handler does exactly this sequence:
         Config.set('app.lang', id); I18n.setLang(id);
         App.applyI18n(document); App._relocalize();
       Calling only applyI18n would skip _relocalize(), which is what writes
       the #input placeholder — the previous version of this probe did that
       and so tested a path the user never takes. */
    if (window.App && App.applyI18n) App.applyI18n(document);
    if (window.App && App._relocalize) App._relocalize();
  } catch (e) { return { stage: 'lang-switch-failed', err: e.message }; }

  var leaks = 0, samples = [];
  /* Every element that carries a translation hook. data-i18n-ph is NOT
     here: that attribute was removed from the markup on purpose (#input is
     owned by app.js), and querying for it would silently match nothing and
     make the probe look like it covers a case it does not. */
  document.querySelectorAll('[data-i18n],[data-i18n-title]').forEach(function (el) {
    ['textContent', 'title', 'placeholder'].forEach(function (prop) {
      var v = (prop === 'textContent' ? el.textContent : el.getAttribute(prop)) || '';
      v = v.replace(MATHS, '').trim();
      if (!v || !CJK.test(v)) return;
      leaks++;
      if (samples.length < 6) samples.push(prop + '=' + v.slice(0, 30));
    });
  });

  var dn = document.querySelector('.drawer-name');
  var df = document.querySelector('.drawer-foot');
  var h1 = document.querySelector('#overlay-title h1') || document.querySelector('h1');
  var ip = document.getElementById('input');
  return {
    stage: 'ok',
    lang: I18n.lang,
    docTitle: document.title,
    drawerName: dn ? dn.textContent.trim() : null,
    drawerFoot: df ? df.textContent.trim() : null,
    h1: h1 ? h1.textContent.trim() : null,
    inputPh: ip ? ip.getAttribute('placeholder') : null,
    leaks: leaks,
    samples: samples
  };
})()`.replace(/%LANG%/g, JSON.stringify(LANG));

app.whenReady().then(async () => {
  say('electron ready, loading', APP_URL);

  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 900,
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });

  win.webContents.on('did-finish-load', () => say('did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    say('did-fail-load', code, desc));

  try {
    await win.loadURL(APP_URL);
    say('loadURL resolved');
  } catch (e) {
    say('loadURL threw:', e.message);
  }

  /* The app boots late; poll rather than assume a fixed delay. */
  let result = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      const r = await win.webContents.executeJavaScript(EXPR, true);
      if (r && r.stage === 'ok') { result = r; break; }
      if (r && r.stage && r.stage !== 'not-booted') { result = r; break; }
    } catch (e) {
      say('executeJavaScript failed at poll', i, '-', e.message);
    }
    if (i % 10 === 9) say('still waiting for boot...', i + 1, 's');
  }

  clearTimeout(killer);
  if (!result) {
    say('RESULT: never booted within 60s');
    app.exit(10);
    return;
  }
  say('RESULT: ' + JSON.stringify(result, null, 1));
  app.exit(result.stage === 'ok' && result.leaks === 0 ? 0 : 1);
}).catch(e => {
  say('fatal:', e && e.message);
  process.exit(2);
});
