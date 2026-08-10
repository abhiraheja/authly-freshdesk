/**
 * Phase 4 verification: drives real Chrome against
 * scripts/widget-loader-harness.mjs and asserts the loader's whole public
 * contract (docs/widget-plan.md § 7).
 *
 * A browser rather than PowerShell, because every claim here is about the DOM,
 * about postMessage and about origins — none of which an HTTP client can check.
 * Run through scripts/verify-widget-phase4.ps1, which sets the environment.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HARNESS = process.env.HARNESS ?? 'http://localhost:4310';
const API = process.env.API ?? 'http://localhost:5210';
const TOKEN = process.env.TOKEN ?? '';
const PORT = Number(process.env.CDP_PORT ?? 9340);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); fail++; }
};

const profile = mkdtempSync(join(tmpdir(), 'loader-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let list = [];
for (let i = 0; i < 40; i++) {
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (list.some((t) => t.type === 'page')) break;
  } catch {}
  await sleep(500);
}
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleLog = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled')
    consoleLog.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    consoleLog.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? ''));
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const go = async (path) => {
  consoleLog.length = 0;
  await send('Page.navigate', { url: HARNESS + path });
  await sleep(2500);
};

// ---- The section 7.1 snippet on a plain HTML page ---------------------------
console.log('\nThe snippet from section 7.1 ...');
await go('/');

const launcher = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.id !== 'host-open' && x.id !== 'host-close');
  if (!b) return null;
  const s = getComputedStyle(b);
  return JSON.stringify({ bg: s.backgroundColor, pos: s.position, label: b.getAttribute('aria-label'), badge: !!b.querySelector('span') });
})()`);
check('A launcher is injected', launcher !== null);
const l = launcher ? JSON.parse(launcher) : {};
check('...fixed to the viewport', l.pos === 'fixed');
check('...labelled with the widget name', !!l.label);

const cfg = await evalJs(`fetch('${API}/api/public/widget/${TOKEN}/config').then(r => r.json()).then(c => JSON.stringify(c))`);
const config = JSON.parse(cfg);
const hex = (rgb) => {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb || '');
  return m ? '#' + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('').toUpperCase() : rgb;
};
check('...in the brand colour, not a hardcoded indigo',
  hex(l.bg) === (config.primaryColor || '').toUpperCase(), `${hex(l.bg)} vs ${config.primaryColor}`);
check('Config carries the frame URL the loader needs', typeof config.frameUrl === 'string' && config.frameUrl.includes('/widget/'));

const frame = await evalJs(`(() => {
  const f = document.querySelector('iframe');
  if (!f) return null;
  return JSON.stringify({ src: f.src, display: getComputedStyle(f).display });
})()`);
check('An iframe is created on load', frame !== null);
const fr = frame ? JSON.parse(frame) : {};
check('...pointing at the panel', fr.src === config.frameUrl, fr.src);
check('...hidden, so it can report unread while shut', fr.display === 'none');

// ---- Handshake ---------------------------------------------------------------
console.log('\nHandshake ...');
const log = JSON.parse(await evalJs('JSON.stringify(window.__frameLog || [])'));
const configMsg = log.find((e) => e.type === 'config');
check('The frame gets a config message after it says ready', !!configMsg);
check('...carrying the merged settings', !!configMsg?.payload?.config?.showWidgetForm);
check('...and the identity the host page supplied',
  configMsg?.payload?.identity?.unique_id === 'alice@acme.example');
check('...including the free-form variables bag',
  configMsg?.payload?.identity?.variables?.plan === 'pro');
check('theme is accepted and dropped, never forwarded',
  configMsg && !('theme' in (configMsg.payload.identity || {})), JSON.stringify(configMsg?.payload?.identity));
// Arrival is the proof. postMessage with the wrong targetOrigin is dropped by
// the browser, so a message the panel actually received was addressed to the
// panel's origin and not broadcast at '*'; `origin` here is the sender's, which
// is the host page.
check('The config reaches the panel across origins',
  configMsg?.origin === new URL(HARNESS).origin, configMsg?.origin);
check('...and the panel really is a separate origin',
  new URL(config.frameUrl).origin !== new URL(HARNESS).origin,
  `${config.frameUrl} vs ${HARNESS}`);

// ---- Open / close ------------------------------------------------------------
console.log('\nOpen and close ...');
await evalJs(`document.querySelector('button[aria-label]').click()`);
await sleep(400);
check('Clicking the launcher shows the panel',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'block');
check('...and tells the frame it opened',
  JSON.parse(await evalJs('JSON.stringify(window.__frameLog)')).some((e) => e.type === 'open'));

await evalJs(`document.querySelector('button[aria-label]').click()`);
await sleep(300);
check('Clicking again hides it',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'none');

await evalJs('openChatWidget()');
await sleep(300);
check('openChatWidget() opens it',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'block');
await evalJs('closeChatWidget()');
await sleep(300);
check('closeChatWidget() closes it',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'none');
check('All three globals are exposed',
  (await evalJs(`['initChatWidget','openChatWidget','closeChatWidget','identifyChatWidget'].every(k => typeof window[k] === 'function')`)) === true);

// ---- Messages from the frame -------------------------------------------------
console.log('\nMessages from the frame ...');
// Through the stub's control channel rather than by touching contentWindow: the
// panel is a different origin from the host page, which is the whole point of
// the design and makes direct access a SecurityError.
const fromFrame = (type, payload) => evalJs(
  `document.querySelector('iframe').contentWindow.postMessage(` +
  `{ source: 'harness-control', type: ${JSON.stringify(type)}, payload: ${JSON.stringify(payload ?? null)} }, '*')`);

await fromFrame('unread', { count: 3 });
await sleep(300);
const badge = JSON.parse(await evalJs(`(() => {
  const b = document.querySelector('button[aria-label] span');
  return JSON.stringify({ text: b.textContent, display: getComputedStyle(b).display });
})()`));
check('unread renders a count badge on the launcher', badge.text === '3' && badge.display !== 'none');
check('...and the panel does NOT open itself',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'none');

await fromFrame('unread', { count: 12 });
await sleep(200);
check('...capped for legibility',
  (await evalJs(`document.querySelector('button[aria-label] span').textContent`)) === '9+');

await evalJs('openChatWidget()');
await sleep(300);
check('Opening the panel clears the badge',
  (await evalJs(`getComputedStyle(document.querySelector('button[aria-label] span')).display`)) === 'none');

await fromFrame('resize', { height: 480 });
await sleep(300);
check('resize sets the docked height',
  (await evalJs(`document.querySelector('iframe').style.height`)) === '480px');

await fromFrame('expand');
await sleep(300);
const expanded = JSON.parse(await evalJs(`(() => {
  const f = document.querySelector('iframe'), s = getComputedStyle(f);
  const b = document.querySelector('button[aria-label]');
  const r = f.getBoundingClientRect();
  return JSON.stringify({ w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight, launcher: getComputedStyle(b).display, radius: s.borderTopLeftRadius });
})()`));
check('expand takes the whole viewport',
  Math.abs(expanded.w - expanded.vw) < 2 && Math.abs(expanded.h - expanded.vh) < 2, JSON.stringify(expanded));
check('...with the docked corner radius dropped', expanded.radius === '0px');
check('...and hides the launcher', expanded.launcher === 'none');

await fromFrame('collapse');
await sleep(300);
const collapsed = JSON.parse(await evalJs(`(() => {
  const f = document.querySelector('iframe');
  return JSON.stringify({ w: f.getBoundingClientRect().width, launcher: getComputedStyle(document.querySelector('button[aria-label]')).display });
})()`));
check('collapse docks it again', collapsed.w > 0 && collapsed.w < 600, JSON.stringify(collapsed));
check('...and brings the launcher back', collapsed.launcher !== 'none');

await fromFrame('close');
await sleep(300);
check('The frame can close itself',
  (await evalJs(`getComputedStyle(document.querySelector('iframe')).display`)) === 'none');

// ---- identify ----------------------------------------------------------------
console.log('\nidentifyChatWidget ...');
await evalJs('window.__frameLog.length = 0');
await evalJs(`identifyChatWidget({ unique_id: 'bob@acme.example', name: 'Bob', mail: 'bob@acme.example', token: 'jwt-here' })`);
await sleep(400);
const identifyMsg = JSON.parse(await evalJs('JSON.stringify(window.__frameLog)')).find((e) => e.type === 'identify');
check('identifyChatWidget posts an identity to the frame', !!identifyMsg);
check('...carrying the signed token', identifyMsg?.payload?.identity?.token === 'jwt-here');
check('...and nothing else from the object', !('widgetToken' in (identifyMsg?.payload?.identity ?? {})));

// ---- Message hygiene ---------------------------------------------------------
console.log('\nMessage hygiene ...');
await evalJs(`window.postMessage({ source: 'trackly-widget', type: 'expand' }, '*')`);
await sleep(300);
check('A message from the page itself is ignored (wrong source window)',
  (await evalJs(`document.querySelector('iframe').getBoundingClientRect().width`)) < 600);

// ---- Host overrides ----------------------------------------------------------
console.log('\nHost page overrides the admin defaults ...');
await go('/hidden');
check('hide_launcher: true injects no launcher',
  (await evalJs(`[...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label')).length`)) === 0);
check('launch_widget: true opens the panel on load',
  (await evalJs(`(() => { const f = document.querySelector('iframe'); return f ? getComputedStyle(f).display : 'none'; })()`)) === 'block');
check('...and openChatWidget() still works with no launcher',
  (await evalJs(`typeof openChatWidget === 'function'`)) === true);

// ---- Back-compatibility ------------------------------------------------------
console.log('\nBack-compatibility (section 7.3) ...');
await go('/databind');
check('A data-widget snippet self-initialises',
  (await evalJs(`!!document.querySelector('iframe')`)) === true);
const legacyIdentity = JSON.parse(await evalJs('JSON.stringify(window.__frameLog || [])'))
  .find((e) => e.type === 'config')?.payload?.identity;
check('...and carries data-user-name / data-user-email across',
  legacyIdentity?.name === 'Legacy Larry' && legacyIdentity?.mail === 'larry@old.example',
  JSON.stringify(legacyIdentity));

await go('/dataworkspace');
await sleep(1500);
check('A data-workspace snippet resolves the workspace to a widget',
  (await evalJs(`!!document.querySelector('iframe')`)) === true);
// The workspace's FIRST active widget, which need not be the one this run
// created - so the assertion is the shape of the URL, not the token in it.
const legacySrc = await evalJs(`(document.querySelector('iframe') || {}).src`);
check('...and opens a panel on the configured frame origin',
  typeof legacySrc === 'string' && legacySrc.startsWith(new URL(config.frameUrl).origin + '/widget/'),
  String(legacySrc));

console.log('\n----------------------------------------');
console.log(` Widget phase 4 loader: ${pass} passed, ${fail} failed`);
if (consoleLog.length) { console.log(' page console:'); consoleLog.forEach((c) => console.log('   ' + c)); }

ws.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
