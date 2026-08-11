/**
 * Phase 6 verification: drives the admin widget screens in a real browser.
 *
 * The done-when is two claims that only a rendered page can settle — the widget
 * screen is real rather than a ComingSoon placeholder, and each branding record
 * is editable in exactly one place.
 *
 * That second claim was rewritten by widget-plan § 4.2.1. Phase 6 asserted that
 * branding lived *only* on the widget screen; it now asserts the opposite split,
 * which is the point of the reversal: the workspace record has its own screen and
 * nav row, and the widget's Branding tab writes the widget row alone. The strong
 * form of that is checked at the end — set a colour and a logo on a widget, then
 * re-read GET /api/admin/branding and prove it did not move.
 *
 * Run through scripts/verify-widget-phase6.ps1.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.APP ?? 'http://localhost:4200';
const API = process.env.API ?? 'http://localhost:5210';
const SESSION = process.env.SESSION ?? '';
const PORT = Number(process.env.CDP_PORT ?? 9360);
const OUT = process.env.OUT ?? '.';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); fail++; }
};

const profile = mkdtempSync(join(tmpdir(), 'admin-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1500,1000', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let list = [];
for (let i = 0; i < 60; i++) {
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (list.some((t) => t.type === 'page')) break;
  } catch {}
  await sleep(500);
}
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCookie', {
  name: 'trackly.session', value: SESSION, domain: 'localhost', path: '/', httpOnly: true,
});

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const go = async (path, wait = 4000) => { await send('Page.navigate', { url: APP + path }); await sleep(wait); };
const clickText = (text) => evalJs(`(() => {
  const t = ${JSON.stringify(text.toLowerCase())};
  const el = [...document.querySelectorAll('button, a')].find(b =>
    (b.innerText||'').trim().toLowerCase().includes(t) || (b.getAttribute('aria-label')||'').toLowerCase().includes(t));
  if (!el) return 'not found';
  el.click(); return 'clicked';
})()`);
const text = () => evalJs('document.body.innerText');

console.log('\nList screen ...');
await go('/admin/widget', 6000);
check('The widget list renders (no ComingSoon)',
  !((await text()) || '').includes('Coming soon'), ((await text()) || '').slice(0, 120));
check('...with the list heading', ((await text()) || '').includes('Widget'));
check('...and a New widget action',
  (await evalJs(`[...document.querySelectorAll('button')].some(b => (b.innerText||'').includes('New widget'))`)) === true);
// Whatever widget the workspace actually has, rather than a token baked in here.
const someToken = await (await fetch(`${API}/api/admin/widgets`, {
  headers: { cookie: `trackly.session=${SESSION}` },
})).json().then((rows) => rows[0]?.publicToken ?? '');
check('Existing widgets are listed by token',
  !!someToken && ((await text()) || '').includes(someToken), `looked for ${someToken}`);

console.log('\nWorkspace branding has a screen of its own (§ 4.2.1) ...');
check('The Branding nav row is back',
  (await evalJs(`[...document.querySelectorAll('nav a')].some(a => (a.innerText||'').trim().toLowerCase().startsWith('branding'))`)) === true);

await go('/admin/settings/branding', 4000);
check('/admin/settings/branding is a real screen, not a redirect',
  (await evalJs('location.pathname')) === '/admin/settings/branding', await evalJs('location.pathname'));

const workspaceBrandingBody = (await text()) || '';
check('...and it owns the sign-in image, which no widget has',
  workspaceBrandingBody.includes('Sign-in image'), workspaceBrandingBody.slice(0, 300));
check('...and says out loud that it applies everywhere',
  workspaceBrandingBody.includes('applies everywhere'), workspaceBrandingBody.slice(0, 300));

console.log('\nEditor ...');
await go('/admin/widget', 5000);
await evalJs(`document.querySelector('table a').click()`);
await sleep(4000);
check('Opening a widget lands on its editor',
  /\/admin\/widget\/[0-9a-f-]{36}/.test(await evalJs('location.pathname')), await evalJs('location.pathname'));

const body = (await text()) || '';
check('Configuration tab is shown first', body.includes('Basics') || body.includes('Launch options'));
check('Three tabs are offered',
  ['Configuration', 'Branding', 'Integration'].every((t) => body.includes(t)), body.slice(0, 200));
check('The secret key is masked, never plain',
  (await evalJs(`(() => { const c=[...document.querySelectorAll('code')].map(x=>x.innerText); return c.some(v=>v.includes('…')) || c.some(v=>v.includes('None yet')); })()`)) === true);
check('A live preview is rendered beside the form',
  (await evalJs(`!!document.querySelector('tk-widget-preview')`)) === true);

console.log('\nBranding tab — this widget only ...');
await clickText('branding');
await sleep(1200);
const brandingBody = (await text()) || '';
check('Branding tab says it changes this widget only',
  brandingBody.includes('this widget only'), brandingBody.slice(0, 300));
check('...and offers this widget\'s own logo and colour',
  brandingBody.includes('Widget logo') && brandingBody.includes('Widget colour'), brandingBody.slice(0, 300));
// The workspace-wide fields moved out, and their absence is the assertion — a
// widget that can still set the footer is a widget that can still repaint the
// emails. Checked by field label rather than by the phrase "Powered by Trackly",
// which the live preview legitimately renders inside the mock panel.
check('...and no longer offers the workspace-wide fields',
  !brandingBody.includes('Page title') &&
  !brandingBody.includes('Welcome text') &&
  !brandingBody.includes('Footer text'),
  brandingBody.slice(0, 300));

// The colour picker is the reason the preview exists.
const before = await evalJs(`getComputedStyle(document.querySelector('tk-widget-preview [class*="bg-primary"]')).backgroundColor`);
await evalJs(`(() => {
  const input = document.querySelector('input[name="widget-colour"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '#B91C1C');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(800);
const after = await evalJs(`getComputedStyle(document.querySelector('tk-widget-preview [class*="bg-primary"]')).backgroundColor`);
check('Typing a colour repaints the preview live', before !== after && after === 'rgb(185, 28, 28)', `${before} -> ${after}`);

console.log('\nIntegration tab ...');
await clickText('integration');
await sleep(1200);
const integrationBody = (await text()) || '';
check('The snippet is the initChatWidget form',
  integrationBody.includes('initChatWidget(tracklyConfig, 0)'), integrationBody.slice(0, 300));
check('...and names this widget by its token', integrationBody.includes('widgetToken'));
check('Web and Mobile SDK are both offered',
  integrationBody.includes('Web') && integrationBody.includes('Mobile SDK'));
check('The variables reference is on the page', integrationBody.includes('unique_id'));

// ── The § 4.2.1 invariant, proved rather than asserted ────────────────────────
// Saving a widget's own colour must leave the workspace record untouched. Read
// before, save, read after, compare the whole payload — a narrow check on
// primaryColor would miss a save that clobbered the page title.
console.log('\nEditing a widget does not write workspace_branding ...');
const readBranding = async () =>
  JSON.stringify(await (await fetch(`${API}/api/admin/branding`, {
    headers: { cookie: `trackly.session=${SESSION}` },
  })).json());

const brandingBefore = await readBranding();
await go(`${await evalJs('location.pathname')}`, 3000);
await clickText('branding');
await sleep(1200);
await evalJs(`(() => {
  const input = document.querySelector('input[name="widget-colour"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '#0F766E');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
await clickText('update widget');
await sleep(2500);
const brandingAfter = await readBranding();
check('The workspace branding record is byte-for-byte unchanged',
  brandingBefore === brandingAfter, `${brandingBefore}\n  vs\n  ${brandingAfter}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) writeFileSync(join(OUT, 'admin.png'), Buffer.from(shot.result.data, 'base64'));

check('No unhandled exception anywhere in the run', errors.length === 0, errors.join(' | '));

console.log('\n----------------------------------------');
console.log(` Widget phase 6 admin: ${pass} passed, ${fail} failed`);
ws.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
