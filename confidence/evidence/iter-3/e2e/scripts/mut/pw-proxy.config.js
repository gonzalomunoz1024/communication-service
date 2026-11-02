// Verifier-only Playwright config: runs the repository's own spec 04, unchanged, with the suite's preview server
// pointed at replay-proxy.js instead of the backend. No import, so nothing resolves from this folder.
module.exports = {
  testDir: '/home/claude/communication-service/e2e/tests',
  testMatch: /04-f92-backend-restart\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 10000 },
  outputDir: '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e3/mut/test-results',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:28030', trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 28030 --strictPort',
    cwd: '/home/claude/communication-service/frontend',
    url: 'http://127.0.0.1:28030',
    env: { COMM_BACKEND: 'http://127.0.0.1:19590' },
    reuseExistingServer: false,
    timeout: 60000,
  },
}
