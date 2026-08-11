/**
 * The embed snippet, opened as a local file.
 *
 * Every other widget probe serves the host page over http, which is what
 * production looks like — and is exactly why none of them caught this. A page
 * opened from `file://` (or inside a sandboxed iframe) has an **opaque** origin,
 * reported to the panel as the string `"null"`, and `"null"` is not a legal
 * `postMessage` target: it throws `SyntaxError` rather than quietly not
 * delivering. Thrown from `reportUnread` inside an effect, that took out change
 * detection and left the panel on its loading skeletons forever — indistinguishable,
 * on screen, from an API call that never came back.
 *
 * Opening the snippet in a local HTML file is the first thing anyone does with
 * it, so this asserts the whole flow survives an origin that cannot be named.
 *
 * Prereqs: the API, and whatever serves `App:FrontendBaseUrl` (in dev, `ng serve`).
 *   node scripts/widget-opaque-origin-probe.mjs --widget <publicToken>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = args.get('api') ?? 'http://localhost:5210';
const WIDGET = args.get('widget');
const PORT = 9374;
if (!WIDGET) {
  console.error('need --widget <publicToken>');
  process.exit(2);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The § 7.1 snippet verbatim, in a file the browser will open off the disk.
const dir = mkdtempSync(join(tmpdir(), 'widget-file-'));
const page = join(dir, 'embed.html');
writeFileSync(page, `<!doctype html><meta charset="utf-8"><title>opaque origin</title>
<h1>host page</h1>
<script src="${API}/widget.js"></script>
<script>initChatWidget({ widgetToken: ${JSON.stringify(WIDGET)} }, 0);</script>
`);

const profile = mkdtempSync(join(tmpdir(), 'widget-file-profile-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1100,900', 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* starting */ }
  await sleep(500);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const exceptions = [];
const responses = [];
let panelSession = null;

const send = (method, params = {}, sessionId) => new Promise((r) => {
  const n = ++id; pending.set(n, r);
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
});

ws.addEventListener('message', async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Target.attachedToTarget') {
    panelSession = m.params.sessionId;
    await send('Runtime.enable', {}, panelSession);
    await send('Network.enable', {}, panelSession);
    await send('Runtime.runIfWaitingForDebugger', {}, panelSession);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  // Angular reports a broken effect through console.error, not exceptionThrown.
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    exceptions.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/public/widget/'))
    responses.push(`${m.params.response.status} ${new URL(m.params.response.url).pathname.split('/').pop()}`);
});

try {
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await sleep(14_000);

  console.log('\nWidget from an opaque origin (file://)\n');

  check('the panel iframe attached', Boolean(panelSession));
  check(
    'the public API answered every call',
    responses.length > 0 && responses.every((r) => r.startsWith('2')),
    responses.join(', ') || 'no calls seen',
  );

  const postMessageErrors = exceptions.filter((e) => /postMessage|target origin/i.test(e));
  check(
    'postMessage survives a host origin that cannot be named',
    postMessageErrors.length === 0,
    postMessageErrors[0]?.split('\n')[0] ?? '',
  );

  const dom = panelSession
    ? await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          text: document.body.innerText.replace(/\\s+/g, ' ').trim(),
          skeletons: document.querySelectorAll('[class*="animate-pulse"],[class*="skeleton"]').length,
        })`,
        returnByValue: true,
      }, panelSession)
    : null;
  const state = dom?.result?.result?.value ? JSON.parse(dom.result.result.value) : null;

  check(
    'the panel reaches a real state instead of loading forever',
    Boolean(state) && state.skeletons === 0 && state.text.length > 0,
    state ? `${state.skeletons} skeleton(s): "${state.text.slice(0, 70)}"` : 'no DOM',
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
