/**
 * The embedding site, and nothing else.
 *
 * Unlike scripts/widget-loader-harness.mjs, this serves no panel stub: the frame
 * URL points at the SPA dev server, so what loads in the iframe is the real
 * Angular route. That is the whole point of the phase 5 suite — the loader, the
 * panel and the API all being the real ones is what makes a pass mean anything.
 *
 * Run through scripts/verify-widget-phase5.ps1.
 */
import { createServer } from 'node:http';

const API = process.env.API ?? 'http://localhost:5210';
const PORT = Number(process.env.HOST_PORT ?? 4310);
const TOKEN = process.env.TOKEN ?? '';

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Widget host</title></head>
<body style="font:14px system-ui;margin:0;padding:40px">
<h1>Host page</h1>
<script type="text/javascript" src="${API}/widget.js"></script>
<script type="text/javascript">
  var tracklyConfig = { widgetToken: "${TOKEN}", launch_widget: true };
  initChatWidget(tracklyConfig, 0);
</script>
</body></html>`;

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
}).listen(PORT, () => console.log(`host page on http://localhost:${PORT}`));
