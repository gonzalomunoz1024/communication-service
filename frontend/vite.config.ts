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
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
