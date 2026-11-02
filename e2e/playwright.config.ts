import path from 'node:path'
import { defineConfig } from '@playwright/test'

// The UI under test is the production bundle (frontend/dist) served by Vite's preview server, with /v1
// proxied to the stack's backend: vite.config.ts' proxy, SSE drop handler included, applies to preview
// as it does to dev, so the browser talks to one origin exactly as it would behind a real reverse proxy.
const UI_PORT = 28030
const BACKEND = 'http://127.0.0.1:28080'

export default defineConfig({
  testDir: './tests',
  // one stack, one browser at a time: the files run in name order, and some restart or stop parts of the stack
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${UI_PORT} --strictPort`,
    cwd: path.resolve(__dirname, '../frontend'),
    url: `http://127.0.0.1:${UI_PORT}`,
    env: { COMM_BACKEND: BACKEND },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
