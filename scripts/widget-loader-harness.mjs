/**
 * Test doubles for the two things widget.js talks to (docs/widget-plan.md § 7).
 *
 *   HOST_PORT     the embedding site:
 *                   /              the § 7.1 snippet, verbatim
 *                   /hidden        hide_launcher + launch_widget overrides
 *                   /databind      the pre-phase-4 data-widget snippet
 *                   /dataworkspace the pre-phase-4 data-workspace snippet
 *   FRAME_ORIGIN  the panel document, served on whatever port the widget's own
 *                 config says frameUrl lives at — so the loader is exercised
 *                 against the URL it will really use, with no override anywhere.
 *
 * The panel stub echoes every loader message back to the top window, so the
 * probe reads one log from one execution context instead of chasing frames.
 *
 * Run through scripts/verify-widget-phase4.ps1, which sets the environment.
 */
import { createServer } from 'node:http';

const API = process.env.API ?? 'http://localhost:5210';
const TOKEN = process.env.TOKEN ?? '';
const SLUG = process.env.SLUG ?? '';
const HOST_PORT = Number(process.env.HOST_PORT ?? 4310);
const FRAME_ORIGIN = process.env.FRAME_ORIGIN ?? 'http://localhost:5173';
const FRAME_PORT = Number(new URL(FRAME_ORIGIN).port || 80);

const hostPage = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Loader harness</title></head>
<body style="font:14px system-ui;margin:0;padding:40px">
<h1>Host page</h1>
<button id="host-open" onclick="openChatWidget()">Live Chat</button>
<button id="host-close" onclick="closeChatWidget()">Close</button>
<script>
  window.__frameLog = [];
  window.addEventListener('message', function (e) {
    if (e.data && e.data.source === 'trackly-widget' && e.data.type === 'echo') {
      window.__frameLog.push(e.data.payload);
    }
  });
</script>
${body}
</body></html>`;

// Exactly the snippet in § 7.1, including the keys that are meant to be ignored.
const snippetPage = hostPage(`
<script type="text/javascript" src="${API}/widget.js"></script>
<script type="text/javascript">
  var tracklyConfig = {
    widgetToken: "${TOKEN}",
    variables: { plan: "pro", account_id: "8842" },
    hide_launcher: false,
    show_widget_form: true,
    show_close_button: true,
    launch_widget: false,
    show_send_button: true,
    unique_id: "alice@acme.example",
    name: "Alice Example",
    mail: "alice@acme.example",
    theme: "dark"
  };
  initChatWidget(tracklyConfig, 0);
</script>`);

const hiddenPage = hostPage(`
<script type="text/javascript" src="${API}/widget.js"></script>
<script type="text/javascript">
  initChatWidget({ widgetToken: "${TOKEN}", hide_launcher: true, launch_widget: true }, 0);
</script>`);

const dataWidgetPage = hostPage(
  `<script src="${API}/widget.js" data-widget="${TOKEN}" data-user-name="Legacy Larry" data-user-email="larry@old.example"></script>`);

const dataWorkspacePage = hostPage(
  `<script src="${API}/widget.js" data-workspace="${SLUG}" data-embed="floating" data-theme="light"></script>`);

const framePage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Panel stub</title></head>
<body style="margin:0;font:14px system-ui;background:#fff">
<div id="panel">panel stub</div>
<script>
  var LOADER = 'trackly-loader', FRAME = 'trackly-widget';
  function toLoader(type, payload) { parent.postMessage({ source: FRAME, type: type, payload: payload }, '*'); }
  window.__toLoader = toLoader;

  window.addEventListener('message', function (e) {
    // The probe's remote control. A separate source so the loader ignores it —
    // needed because the panel is a different origin from the host page, exactly
    // as in production, so the probe cannot reach into this frame directly.
    if (e.data && e.data.source === 'harness-control') {
      toLoader(e.data.type, e.data.payload);
      return;
    }
    if (!e.data || e.data.source !== LOADER) return;
    parent.postMessage({ source: FRAME, type: 'echo',
      payload: { type: e.data.type, payload: e.data.payload, origin: e.origin } }, '*');
  });

  toLoader('ready');
</script>
</body></html>`;

const handler = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  if (url.pathname.startsWith('/widget/')) return send(framePage);
  if (url.pathname === '/hidden') return send(hiddenPage);
  if (url.pathname === '/databind') return send(dataWidgetPage);
  if (url.pathname === '/dataworkspace') return send(dataWorkspacePage);
  if (url.pathname === '/') return send(snippetPage);
  res.writeHead(404).end('not found');
};

const listen = (port, label) => new Promise((resolve, reject) => {
  const server = createServer(handler);
  server.on('error', (err) => reject(
    err.code === 'EADDRINUSE'
      ? new Error(`port ${port} (${label}) is already in use — stop whatever holds it, ` +
                  `or point App:FrontendBaseUrl somewhere free`)
      : err));
  server.listen(port, () => resolve(server));
});

await listen(HOST_PORT, 'host page');
if (FRAME_PORT !== HOST_PORT) await listen(FRAME_PORT, 'panel');
console.log(`harness: host http://localhost:${HOST_PORT}, panel ${FRAME_ORIGIN}`);
