// F-64: static build with VITE_API_BASE pointing at another origin (no CORS on the backend), served on :3127; identity headers
// through the dev proxy on the shared :3000. Iteration-1 copy of the iteration-0 script (ports changed).
process.env.UI = 'http://127.0.0.1:3127'
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant } = L
L.setFile('t6-xorigin')
const RUN = Date.now().toString(36)
const tenant = `fe1-xorigin-${RUN}`
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'

;(async () => {
  const browser = await L.launch()
  try {
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'xorigin item' }))
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3127/#/feed')
      await setTenant(page, tenant)
      await page.waitForTimeout(2500)
      const err = await page.getByText("Couldn't load the feed").count()
      const msg = err ? await page.getByText("Couldn't load the feed").locator('..').textContent() : ''
      const corsConsole = page.cap.console.filter((c) => /CORS|Access-Control-Allow-Origin/i.test(c.text))
      const apiTargets = [...new Set(page.cap.requests.map((r) => new URL(r.url).origin))]
      const preflight = await fetch('http://127.0.0.1:8080/v1/feed?tenantId=' + tenant, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3127', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-client-id' } })
      record('F-64', 'static build with VITE_API_BASE=http://127.0.0.1:8080 served from http://127.0.0.1:3127: requests go to the API origin and are blocked by the browser (no CORS on the backend) → feed error state (documented limitation, Q2)', err === 1 && corsConsole.length > 0 && apiTargets.includes('http://127.0.0.1:8080') && !preflight.headers.get('access-control-allow-origin'), { errorStateShown: err === 1, shownAs: msg.includes(UNREACHABLE) ? 'unreachable wording (fetch TypeError)' : msg.slice(0, 160), corsConsole: corsConsole.slice(0, 2).map((c) => c.text.slice(0, 160)), apiTargets, preflightStatus: preflight.status, acao: preflight.headers.get('access-control-allow-origin') })
      await context.close()
    }
    {
      process.env.UI = 'http://127.0.0.1:3000'
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3000/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article')
      await page.waitForTimeout(500)
      const reqs = page.cap.requests
      const fetches = reqs.filter((r) => !r.url.includes('/v1/feed/stream'))
      const stream = reqs.find((r) => r.url.includes('/v1/feed/stream'))
      record('F-64', 'every fetch carries X-Client-Id: communication-frontend and Accept: application/json; the EventSource carries ?clientId=; all same-origin through the dev proxy', fetches.length > 0 && fetches.every((r) => r.headers['x-client-id'] === 'communication-frontend' && r.headers['accept'] === 'application/json') && stream && /clientId=communication-frontend/.test(stream.url) && reqs.every((r) => new URL(r.url).origin === 'http://127.0.0.1:3000'), { fetches: fetches.map((r) => ({ url: r.url.replace('http://127.0.0.1:3000', ''), clientId: r.headers['x-client-id'], accept: r.headers['accept'] })), stream: stream && stream.url.replace('http://127.0.0.1:3000', ''), statuses: page.cap.responses.map((r) => r.status) })
      record('F-27', 'the UI identifies itself on every call (header on fetches, ?clientId= on the stream); the service answers 200', fetches.every((r) => r.headers['x-client-id'] === 'communication-frontend') && page.cap.responses.every((r) => r.status === 200), page.cap.responses.map((r) => `${r.status} ${r.url.replace('http://127.0.0.1:3000', '').slice(0, 60)}`))
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
