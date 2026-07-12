import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend dev server proxies API + WS calls to the FastAPI backend on :8000.
// Port is configurable via HOLODECK_FRONTEND_PORT (defaults to 8350).
const frontendPort = Number(process.env.HOLODECK_FRONTEND_PORT) || 8350

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: frontendPort,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
