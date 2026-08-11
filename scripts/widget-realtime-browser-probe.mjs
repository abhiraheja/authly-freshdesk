/**
 * The other half of `widget-realtime-probe.mjs`.
 *
 * That one proves the *hub* delivers. This one proves the *panel* is listening —
 * it drives a real Chrome at the real panel route and asserts the socket is
 * opened and acted on, which is the only way to tell "SignalR is wired up" from
 * "the poll happened to fire".
 *
 * The timing is the assertion. An agent replies, and the conversation has to
 * appear in the panel well inside the 20s the fallback poll would have taken —
 * so a pass here cannot be explained by the interval.
 *
 * Usage (needs `ng serve` on 4300 proxying /api and /hubs, and the API on 5210):
 *   node scripts/widget-realtime-browser-probe.mjs --widget <token> --cookie <session>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = args.get('app') ?? 'http://localhost:4300';
const API = args.get('api') ?? 'http://127.0.0.1:5210';
const WIDGET = args.get('widget');
const COOKIE = args.get('cookie');
const PORT = 9361;
if (!WIDGET || !COOKIE) {
  console.error('need --widget <publicToken> and --cookie <session token>');
  process.exit(2);
}

/** The fallback cadence. Anything at or beyond this proves nothing. */
const POLL_MS = 20_000;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'wsprobe-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=420,760', 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* chrome still starting */ }
  await sleep(500);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const sockets = [];
const xhrs = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.webSocketCreated') sockets.push(m.params.url);
  if (m.method === 'Network.requestWillBeSent') xhrs.push(m.params.request.url);
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};

const api = async (path, { method = 'GET', body, visitorToken, cookie } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (visitorToken) headers['X-Trackly-Visitor'] = visitorToken;
  if (cookie) headers.cookie = `trackly.session=${cookie}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

try {
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  console.log('\nWidget realtime — in the browser\n');

  await send('Page.navigate', { url: `${APP}/widget/${WIDGET}` });
  // Generous: a cold dev server compiles the lazy chunk on first request.
  await sleep(12_000);

  const hub = sockets.find((u) => u.includes('/hubs/widget'));
  check('the panel opens a WebSocket to /hubs/widget', Boolean(hub), hub ?? (sockets.join(', ') || 'none'));
  check(
    'it carries both credentials the hub reads',
    Boolean(hub && hub.includes('widget=') && hub.includes('visitorToken=')),
    hub ? new URL(hub.replace(/^ws/, 'http')).search.slice(0, 80) + '…' : '',
  );

  // The panel booted a visitor of its own; borrow its token so the conversation
  // we create really does belong to the browser under test.
  const visitorToken = await evaluate(`localStorage.getItem('trackly.widget.${WIDGET}')`);
  check('the panel established a visitor session', Boolean(visitorToken));
  if (!visitorToken) throw new Error('no visitor token — cannot continue');

  const created = await api(`/api/public/widget/${WIDGET}/conversations`, {
    method: 'POST', visitorToken,
    body: { message: `browser probe ${Date.now()}` },
  });
  const conversationId = created.conversationId ?? created.id;

  // Deliberately AFTER the conversation exists but BEFORE the panel could know
  // about it: only a push can put it on screen inside the window below.
  const xhrsBefore = xhrs.filter((u) => u.includes('/conversations')).length;
  const startedAt = Date.now();
  await api(`/api/tickets/${conversationId}/comments`, {
    method: 'POST', cookie: COOKIE,
    body: { body: 'Agent reply — browser realtime probe', isInternal: false },
  });

  let appearedMs = null;
  for (let i = 0; i < 60; i++) {
    const text = await evaluate('document.body.innerText');
    if (text && text.includes('Agent reply — browser realtime probe')) { appearedMs = Date.now() - startedAt; break; }
    await sleep(250);
  }

  check(
    'the reply reaches the panel with no navigation',
    appearedMs !== null,
    appearedMs === null ? 'never appeared' : `${appearedMs}ms`,
  );
  check(
    `and does it faster than the ${POLL_MS / 1000}s fallback poll could`,
    appearedMs !== null && appearedMs < POLL_MS / 2,
    appearedMs === null ? '' : `${appearedMs}ms`,
  );
  check(
    'the push, not a poll: no interval fired in that window',
    xhrs.filter((u) => u.includes('/conversations')).length - xhrsBefore <= 3,
    `${xhrs.filter((u) => u.includes('/conversations')).length - xhrsBefore} conversation request(s)`,
  );
} catch (error) {
  console.error('\n  probe error:', error.message);
  fail++;
} finally {
  ws.close();
  chrome.kill();
}

console.log(`\n${fail === 0 ? `All ${pass} assertions passed.` : `${fail} of ${pass + fail} FAILED.`}\n`);
process.exit(fail === 0 ? 0 : 1);
