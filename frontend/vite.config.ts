import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5210',
      // SignalR live-chat hub (WebSocket upgrade must be proxied too).
      '/hubs': { target: 'http://localhost:5210', ws: true },
    },
  },
})
