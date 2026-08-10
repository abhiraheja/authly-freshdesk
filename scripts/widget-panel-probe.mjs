/**
 * Phase 5 end-to-end: the real panel, in the real loader, against the real API.
 *
 * Raises a conversation from inside the widget exactly as a visitor would —
 * clicking, typing, submitting — then has an agent reply over the API and checks
 * what comes back: the unread badge on the launcher, the preview on the row, the
 * reply in the thread, and the read receipt clearing the badge. It also asserts
 * the thing that must never happen, which is an internal note reaching a
 * customer surface (invariant 5).
 *
 * Run through scripts/verify-widget-phase5.ps1.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HOST = process.env.HOST_PAGE ?? 'http://localhost:4310';
const API = process.env.API ?? 'http://localhost:5210';
const SESSION = process.env.SESSION ?? '';
const PORT = 9351;
const OUT = process.env.OUT ?? '.';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); fail++; }
};

function hexToRgbString(hex) {
  const v = (hex ?? '').replace(/^#/, '');
  const n = parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const agent = (path, init = {}) =>
  fetch(API + path, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: `trackly.session=${SESSION}`, ...(init.headers ?? {}) },
  });

const profile = mkdtempSync(join(tmpdir(), 'flow-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1280,900', 'about:blank',
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
await send('Page.navigate', { url: HOST });
await sleep(9000);

// A live handle on the panel's own execution context.
let ctx = null;
async function bindPanel() {
  const tree = await send('Page.getFrameTree');
  const child = (tree.result.frameTree.childFrames ?? [])[0];
  if (!child) return false;
  const iso = await send('Page.createIsolatedWorld', { frameId: child.frame.id, worldName: 'probe' + Date.now() });
  ctx = iso.result.executionContextId;
  return true;
}
const inPanel = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId: ctx });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const inPage = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};
const clickInPanel = (selectorOrText) => inPanel(`(() => {
  const byText = [...document.querySelectorAll('button')].find(b =>
    (b.innerText || '').trim().toLowerCase().includes(${JSON.stringify(selectorOrText.toLowerCase())}) ||
    (b.getAttribute('aria-label') || '').toLowerCase().includes(${JSON.stringify(selectorOrText.toLowerCase())}));
  if (!byText) return 'not found';
  byText.click();
  return 'clicked';
})()`);
const typeInto = async (selector, text) => {
  await inPanel(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await send('Input.insertText', { text });
};

await bindPanel();

console.log('\nHome ...');
check('The panel loaded inside the frame', (await inPanel('!!document.querySelector("tk-widget-panel")')) === true);
check('It is light, whatever the visitor prefers',
  (await inPanel('document.documentElement.classList.contains("dark")')) === false);
// Read from the widget's own config rather than hard-coded, so this asserts
// "the tenant's colour" and not "green".
const widgetConfig = await (await fetch(`${API}/api/public/widget/${process.env.TOKEN}/config`)).json();
const brand = hexToRgbString(widgetConfig.primaryColor);
check('It wears the workspace brand, not Trackly indigo',
  (await inPanel(`getComputedStyle(document.querySelector('header')).backgroundColor`)) === brand,
  `expected ${brand} for ${widgetConfig.primaryColor}`);
check('Empty state distinguishes "nothing yet"',
  ((await inPanel('document.body.innerText')) || '').includes('No conversations yet'));

console.log('\nDetails form ...');
check('"Send us a message" opens the details form', (await clickInPanel('send us a message')) === 'clicked');
await sleep(600);
const onDetails = ((await inPanel('document.body.innerText')) || '').includes('Tell us who you are');
check('The form is shown when nobody is identified', onDetails);
check('Submit is disabled until a name is typed',
  (await inPanel(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Submit'); return !!b && b.disabled; })()`)) === true);

const stamp = Date.now().toString().slice(-6);
await typeInto('#widget-name', 'Panel Tester');
await typeInto('#widget-email', `panel-${stamp}@example.test`);
await sleep(400);
check('Submit enables once the required field is filled',
  (await inPanel(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Submit'); return !!b && !b.disabled; })()`)) === true);
await clickInPanel('submit');
await sleep(1200);

console.log('\nNew conversation ...');
check('Submitting lands on the composer',
  ((await inPanel('document.body.innerText')) || '').includes('What can I help with?'));

await typeInto('#widget-composer', 'The printer on floor 2 is offline');
await sleep(300);
await clickInPanel('send');
await sleep(2500);

const threadText = (await inPanel('document.body.innerText')) || '';
check('The message appears in the thread', threadText.includes('printer on floor 2'));

// The desk's side of the same conversation.
const tickets = await (await agent('/api/tickets?channel=widget')).json();
const ticket = (tickets.items ?? []).find((t) => (t.subject || '').includes('printer on floor 2'));
check('A widget ticket reached the queue', !!ticket, JSON.stringify((tickets.items ?? []).slice(0, 2)));
check('...as a guest, with the typed name', ticket?.guestName === 'Panel Tester', ticket?.guestName);

console.log('\nAgent replies ...');
if (ticket) {
  await agent(`/api/tickets/${ticket.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'We have restarted the print queue — try again now.', isInternal: false }),
  });
  await agent(`/api/tickets/${ticket.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Internal: swapped the toner too', isInternal: true }),
  });

  // Back to home so the list is what is on screen, then wait out a poll.
  await clickInPanel('back');
  await sleep(1000);
  await bindPanel();
  await sleep(21000);

  const homeText = (await inPanel('document.body.innerText')) || '';
  check('The agent reply shows in the list preview', homeText.includes('restarted the print queue'), homeText.slice(0, 200));
  check('An internal note never reaches the panel', !homeText.includes('swapped the toner'));

  const badge = await inPage(`(() => { const b=document.querySelector('button[aria-label] span'); return b ? { text: b.textContent, shown: getComputedStyle(b).display !== 'none' } : null; })()`);
  check('The launcher badge shows the unread count', !!badge && badge.shown && badge.text === '1', JSON.stringify(badge));

  await inPanel(`document.querySelector('tk-widget-row button').click()`);
  await sleep(2000);
  const opened = (await inPanel('document.body.innerText')) || '';
  check('Opening the row shows the reply', opened.includes('restarted the print queue'));
  check('...and still no internal note', !opened.includes('swapped the toner'));

  await clickInPanel('back');
  await sleep(1500);
  const cleared = await inPanel(`(() => { const el=[...document.querySelectorAll('span')].find(s=>/^\\d+$/.test((s.textContent||'').trim()) && s.className.includes('bg-primary')); return !el; })()`);
  check('The read receipt clears the row badge', cleared === true);

  await agent(`/api/tickets/${ticket.id}`, { method: 'DELETE' }).catch(() => {});
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) writeFileSync(join(OUT, 'flow.png'), Buffer.from(shot.result.data, 'base64'));

check('No unhandled exception anywhere in the run', errors.length === 0, errors.join(' | '));

console.log('\n----------------------------------------');
console.log(` Widget phase 5 panel: ${pass} passed, ${fail} failed`);
ws.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
