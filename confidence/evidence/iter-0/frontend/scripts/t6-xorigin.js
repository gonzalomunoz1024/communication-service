// F-64: static build with VITE_API_BASE pointing at another origin (no CORS on the backend) + header/identity checks on the dev proxy
process.env.UI = 'http://127.0.0.1:3027'
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant } = L
L.setFile('t6-xorigin')
const RUN = Date.now().toString(36)
const tenant = `fe-xorigin-${RUN}`

;(async () => {
  const browser = await L.launch()
  try {
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'xorigin item' }))
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3027/#/feed')
      await setTenant(page, tenant)
      await page.waitForTimeout(2500)
      const err = await page.getByText("Couldn't load the feed").count()
      const corsConsole = page.cap.console.filter((c) => /CORS|Access-Control-Allow-Origin/i.test(c.text))
      const apiTargets = [...new Set(page.cap.requests.map((r) => new URL(r.url).origin))]
      const preflight = await fetch('http://127.0.0.1:8080/v1/feed?tenantId=' + tenant, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3027', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-client-id' } })
      record('F-64', 'static build with VITE_API_BASE=http://127.0.0.1:8080 served from http://127.0.0.1:3027: requests go to the API origin and are blocked by the browser (no CORS on the backend) → feed error state (documented limitation, Q2)', err === 1 && corsConsole.length > 0 && apiTargets.includes('http://127.0.0.1:8080') && !preflight.headers.get('access-control-allow-origin'), { errorStateShown: err === 1, corsConsole: corsConsole.slice(0, 2).map((c) => c.text.slice(0, 160)), apiTargets, preflightStatus: preflight.status, acao: preflight.headers.get('access-control-allow-origin') })
      await context.close()
    }
    {
      // identity headers through the dev proxy (shared stack)
      process.env.UI = 'http://127.0.0.1:3000'
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3000/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article')
      await page.waitForTimeout(500)
      const reqs = page.cap.requests
      const fetches = reqs.filter((r) => !r.url.includes('/v1/feed/stream'))
      const stream = reqs.find((r) => r.url.includes('/v1/feed/stream'))
      record('F-64', "every fetch carries X-Client-Id: communication-frontend and Accept: application/json; the EventSource carries ?clientId=; all same-origin through the dev proxy", fetches.length > 0 && fetches.every((r) => r.headers['x-client-id'] === 'communication-frontend' && r.headers['accept'] === 'application/json') && stream && /clientId=communication-frontend/.test(stream.url) && reqs.every((r) => new URL(r.url).origin === 'http://127.0.0.1:3000'), { fetches: fetches.map((r) => ({ url: r.url.replace('http://127.0.0.1:3000', ''), clientId: r.headers['x-client-id'], accept: r.headers['accept'] })), stream: stream && stream.url.replace('http://127.0.0.1:3000', ''), statuses: page.cap.responses.map((r) => r.status) })
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
