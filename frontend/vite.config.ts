/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// where `npm run dev` sends /v1 (COMM_BACKEND=http://localhost:18080 npm run dev)
const backend = process.env.COMM_BACKEND ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // the backend has no CORS config, so the dev server proxies the API (SSE included)
      '/v1': {
        target: backend,
        changeOrigin: true,
        // SSE: if the service dies mid-stream, http-proxy leaves the browser's response open
        // forever and the EventSource never notices (production proxies end it). Do the same here.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (!String(proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) return
            const drop = () => {
              if (!res.writableEnded) res.destroy()
            }
            proxyRes.on('close', drop)
            proxyRes.on('error', drop)
          })
        },
      },
    },
  },
  test: {
    // pure modules run in node; component tests opt into jsdom with `// @vitest-environment jsdom`
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
})
