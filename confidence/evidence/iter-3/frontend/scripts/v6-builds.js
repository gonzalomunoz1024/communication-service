// F-64 / F-52 / F-57 / F-53 on production builds: VITE_DEFAULT_TENANT honoured (:3202), VITE_API_BASE cross-origin blocked by CORS
// (:3203, documented limitation Q2), VITE_CLIENT_ID='bad id!' → 400 text surfaced (:3204), the built index.html keeps the pre-paint
// theme script; identity headers through the dev proxy on the shared :3000. Static fronts are rp.js serving my scratch builds.
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant } = L
L.setFile('v6-builds')
const RUN = Date.now().toString(36)
const tenant = `vf3-build-${RUN}`
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'

;(async () => {
  const browser = await L.launch()
  try {
    await api('POST', '/v1/communications', publishBody('vf3-default', { title: 'default tenant item ' + RUN }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'xorigin item' }))
    // ---- VITE_DEFAULT_TENANT ----
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3202/#/feed')
      await page.waitForSelector('[role="tablist"]')
      const value = await page.locator('input[aria-label="Tenant"]').inputValue()
      const listed = await page.waitForSelector(`article h3:has-text("default tenant item ${RUN}")`, { timeout: 10000 }).then(() => true).catch(() => false)
      const q = page.cap.requests.find((r) => /\/v1\/feed\?/.test(r.url))
      const prompt = await page.locator('main p', { hasText: 'Enter the tenant your consumers read' }).count()
      record('F-52', "G-2-12: a build with VITE_DEFAULT_TENANT=vf3-default opens on that tenant (input value, GET /v1/feed?tenantId=vf3-default, its items listed, no prompt)", value === 'vf3-default' && listed && q && /tenantId=vf3-default/.test(q.url) && prompt === 0, { value, listed, query: q && new URL(q.url).search, prompt })
      await page.evaluate(() => localStorage.setItem('comm-tenant', 'vf3-somebody-else'))
      await page.reload()
      await page.waitForSelector('[role="tablist"]')
      const value2 = await page.locator('input[aria-label="Tenant"]').inputValue()
      record('F-52', 'G-2-12: the build default wins over the tenant remembered in localStorage (as documented in frontend/README.md)', value2 === 'vf3-default', { value2 })
      await context.close()
    }
    // ---- cross-origin static build ----
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3203/#/feed')
      await setTenant(page, tenant)
      await page.waitForTimeout(2500)
      const err = await page.getByText("Couldn't load the feed").count()
      const msg = err ? await page.getByText("Couldn't load the feed").locator('..').textContent() : ''
      const corsConsole = page.cap.console.filter((c) => /CORS|Access-Control-Allow-Origin/i.test(c.text))
      const apiTargets = [...new Set(page.cap.requests.map((r) => new URL(r.url).origin))]
      const preflight = await fetch('http://127.0.0.1:8080/v1/feed?tenantId=' + tenant, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3203', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-client-id' } })
      record('F-64', 'static build with VITE_API_BASE=http://127.0.0.1:8080 served from http://127.0.0.1:3203: requests go to the API origin and are blocked by the browser (no CORS on the backend) → feed error state with the unreachable wording (documented limitation, Q2)', err === 1 && corsConsole.length > 0 && apiTargets.includes('http://127.0.0.1:8080') && !preflight.headers.get('access-control-allow-origin') && msg.includes(UNREACHABLE), { errorStateShown: err === 1, msg: msg.slice(0, 160), corsConsole: corsConsole.slice(0, 2).map((c) => c.text.slice(0, 160)), apiTargets, preflightStatus: preflight.status, acao: preflight.headers.get('access-control-allow-origin') })
      await context.close()
    }
    // ---- VITE_CLIENT_ID='bad id!' ----
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3204/#/feed')
      await setTenant(page, tenant)
      const shown = await page.waitForSelector("text=Couldn't load the feed", { timeout: 10000 }).then(() => true).catch(() => false)
      const msg = shown ? await page.getByText("Couldn't load the feed").locator('..').textContent() : ''
      await page.waitForTimeout(3000)
      const feedStatus = page.cap.responses.find((r) => /\/v1\/feed\?/.test(r.url))
      const streamStatuses = page.cap.responses.filter((r) => r.url.includes('/v1/feed/stream')).map((r) => r.status)
      const headerSent = page.cap.requests.find((r) => /\/v1\/feed\?/.test(r.url)).headers['x-client-id']
      const badge = await L.indicator(page)
      record('F-57', "a build with VITE_CLIENT_ID='bad id!' sends that header, the service answers 400 and its text is shown in the feed error state; the stream (?clientId=bad id!) is refused with 400 too, so the badge stays 'Reconnecting (n)'", shown && feedStatus && feedStatus.status === 400 && /X-Client-Id must be 1-100 characters/.test(msg) && headerSent === 'bad id!' && streamStatuses.every((s) => s === 400) && /^Reconnecting \(\d+\)$/.test(badge), { msg: msg.slice(0, 200), feedStatus: feedStatus && feedStatus.status, streamStatuses, headerSent, badge })
      await context.close()
    }
    // ---- the built index.html (production bundle) ----
    {
      const html = await (await fetch('http://127.0.0.1:3205/')).text()
      record('F-53', 'the production index.html keeps the inline pre-paint theme script and the color-scheme meta', /atlas-theme/.test(html) && /prefers-color-scheme/.test(html) && /name="color-scheme" content="light dark"/.test(html), { bytes: html.length })
    }
    // ---- identity through the dev proxy (shared :3000) ----
    {
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
      // the dev proxy forwards the SSE content type and keeps the stream open
      const streamRes = page.cap.responses.find((r) => r.url.includes('/v1/feed/stream'))
      record('F-64', 'the dev proxy forwards the stream as text/event-stream', streamRes && /text\/event-stream/.test(streamRes.headers['content-type'] || ''), streamRes && streamRes.headers['content-type'])
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
