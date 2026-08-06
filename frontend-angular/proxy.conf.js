/**
 * Dev-server proxy — mirrors what `frontend/vite.config.ts` did for the React app.
 *
 * The API and the SPA share an origin in every deployed environment (the session
 * lives in a same-site HttpOnly cookie, so a cross-origin dev setup would drop
 * it). Proxying keeps local dev on one origin too, which is why every request in
 * `src/app/core/api` uses a root-relative path and never a configured host.
 */
const API_TARGET = process.env['TRACKLY_API'] ?? 'http://localhost:5210';

module.exports = {
  '/api': {
    target: API_TARGET,
    secure: false,
    changeOrigin: false,
  },
  // SignalR live-chat hub — needs the WebSocket upgrade proxied as well, or the
  // connection silently falls back to long-polling.
  '/hubs': {
    target: API_TARGET,
    secure: false,
    changeOrigin: false,
    ws: true,
  },
};
