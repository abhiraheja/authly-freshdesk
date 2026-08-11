/**
 * Widget realtime — does an agent's reply actually reach an embedded panel?
 *
 * The phase-3 suite only asserted that `/hubs/widget` negotiates. That proves
 * the hub is mapped; it proves nothing about delivery, and delivery is the whole
 * reason the panel stopped polling. This drives the socket the way
 * `WidgetApi.connect` does — same query string, same event name — so the thing
 * under test is the contract the Angular client actually depends on.
 *
 * Four assertions, and the last two are the interesting ones:
 *   1. the hub accepts a visitor connection and the handshake completes
 *   2. an agent's public reply arrives as `conversation` with the right id
 *   3. an agent's INTERNAL note does NOT (invariant 5 — a private note must not
 *      even hint at itself on a customer-facing socket)
 *   4. a connection holding a *different* visitor's token never sees any of it
 *      (the trust rule of § 3.3, over the socket rather than over HTTP)
 *
 * Usage:
 *   node scripts/widget-realtime-probe.mjs \
 *     --base http://127.0.0.1:5210 --widget <publicToken> --cookie <trackly.session value>
 */
import { createRequire } from 'node:module';

// Resolved out of the Angular workspace rather than declared here: this probe is
// only worth anything if it speaks to the hub through the *same* client the
// panel ships, negotiate and transport fallback included. A hand-rolled
// WebSocket would test a protocol I wrote down, not the one in production.
const req = createRequire(new URL('../frontend-angular/package.json', import.meta.url));
const { HubConnectionBuilder, LogLevel } = req('@microsoft/signalr');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const BASE = args.get('base') ?? 'http://127.0.0.1:5210';
const WIDGET = args.get('widget');
const COOKIE = args.get('cookie');
if (!WIDGET || !COOKIE) {
  console.error('need --widget <publicToken> and --cookie <session token>');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

const widgetBase = `${BASE}/api/public/widget/${encodeURIComponent(WIDGET)}`;

async function api(url, { method = 'GET', body, visitorToken, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (visitorToken) headers['X-Trackly-Visitor'] = visitorToken;
  if (cookie) headers.Cookie = `trackly.session=${cookie}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** A visitor, and a conversation they raised. */
async function newVisitor(name) {
  const session = await api(`${widgetBase}/session`, { method: 'POST', body: { name } });
  const token = session.visitorToken;
  const created = await api(`${widgetBase}/conversations`, {
    method: 'POST',
    visitorToken: token,
    body: { message: `probe ${name} ${Date.now()}` },
  });
  return { token, conversationId: created.conversationId ?? created.id };
}

/** Connects, and records every `conversation` event it is handed. */
async function listen(visitorToken) {
  const url =
    `${BASE}/hubs/widget?widget=${encodeURIComponent(WIDGET)}` +
    `&visitorToken=${encodeURIComponent(visitorToken)}`;
  const connection = new HubConnectionBuilder()
    .withUrl(url)
    .configureLogging(LogLevel.Error)
    .build();

  const seen = [];
  // A block body, not an expression: `.push` returns a number, and the client
  // reads a returned value as a result the server never asked for.
  connection.on('conversation', (event) => {
    seen.push(event);
  });
  await connection.start();
  return { connection, seen };
}

/**
 * Resolves once `seen` has more than `from` entries, or after `ms`.
 *
 * `from` is passed in rather than sampled here, and that is the whole point: the
 * push routinely lands *before* the POST that caused it has returned, so a
 * baseline taken after the await would already include the event and this would
 * sit waiting for a second one. Absence is an assertion in this file too, so a
 * false negative here would be indistinguishable from a real leak.
 */
const settle = (seen, from, ms) =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      if (seen.length > from) {
        clearInterval(timer);
        clearTimeout(bail);
        resolve(true);
      }
    }, 50);
    const bail = setTimeout(() => {
      clearInterval(timer);
      resolve(false);
    }, ms);
  });

const main = async () => {
  console.log('\nWidget realtime\n');

  const alice = await newVisitor('Probe Alice');
  const bob = await newVisitor('Probe Bob');

  const a = await listen(alice.token);
  const b = await listen(bob.token);
  check('the hub accepts a visitor connection', a.connection.state === 'Connected', a.connection.state);

  // ── An agent's public reply ────────────────────────────────────────────────
  const beforeReply = a.seen.length;
  await api(`${BASE}/api/tickets/${alice.conversationId}/comments`, {
    method: 'POST',
    cookie: COOKIE,
    body: { body: 'Agent reply from the realtime probe', isInternal: false },
  });
  const gotPublic = await settle(a.seen, beforeReply, 8000);
  check("an agent's public reply pushes `conversation`", gotPublic);
  check(
    'the push names the conversation it belongs to',
    a.seen.at(-1)?.conversationId?.toLowerCase() === alice.conversationId.toLowerCase(),
    `${a.seen.at(-1)?.conversationId} vs ${alice.conversationId}`,
  );

  // ── An agent's internal note ───────────────────────────────────────────────
  const before = a.seen.length;
  await api(`${BASE}/api/tickets/${alice.conversationId}/comments`, {
    method: 'POST',
    cookie: COOKIE,
    body: { body: 'Internal note — must never reach the panel', isInternal: true },
  });
  await settle(a.seen, before, 4000);
  check('an internal note pushes nothing (invariant 5)', a.seen.length === before);

  // ── Somebody else's visitor token ─────────────────────────────────────────
  check("another visitor's socket saw none of it (trust rule § 3.3)", b.seen.length === 0,
    `${b.seen.length} event(s)`);

  await a.connection.stop();
  await b.connection.stop();

  console.log(`\n${failures === 0 ? 'All assertions passed.' : `${failures} assertion(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('\nProbe crashed:', error.message, '\n');
  process.exit(1);
});
