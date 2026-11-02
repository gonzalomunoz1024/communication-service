// F-92 / GAP-frontend4-1 confirmation on the PRODUCTION bundle (no React StrictMode): the same probe as v7d (copied by sed, only
// the UI origin, result name and timeline file differ). Backend C (:19202, container vf4-mongo) behind rp.js :3208 serving my
// scratch dist/ (npm run build at e3968c4). The page is opened after `docker stop vf4-mongo` and observed for 30 s: stream
// requests and answers, list GETs, the badge live-region text, backend C WARN/ERROR lines; then `docker start vf4-mongo`.
const { execSync } = require('child_process'); const fs = require('fs')
const L = require('./lib'); const { record, api, publishBody, newPage } = L
L.setFile('v7e-db-outage-prod')
const C_API = 'http://127.0.0.1:19202', C_UI = 'http://127.0.0.1:3208'
const LOG = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4/logs/backend-19202.txt'
const lines = () => fs.readFileSync(LOG, 'utf8').split('\n').length
;(async () => {
  const browser = await L.launch(); const tl = []; const T0 = Date.now(); const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    const tenant = `vf4-dbout-${Date.now().toString(36)}`
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'present before the outage' }), {}, C_API)
    const { context, page } = await newPage(browser)
    await page.goto(C_UI + '/#/feed'); await L.setTenant(page, tenant)
    await page.waitForSelector('article h3:has-text("present before the outage")'); await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    execSync('docker stop vf4-mongo'); log('docker stop vf4-mongo')
    const l0 = lines(); const tOpen = Date.now()
    const reqs = []; page.on('request', (r) => { if (/\/v1\/feed/.test(r.url())) reqs.push({ t: Date.now() - tOpen, kind: r.url().includes('/stream') ? 'stream' : 'GET' }) })
    const resps = []; page.on('response', (r) => { if (/\/v1\/feed/.test(r.url())) resps.push({ t: Date.now() - tOpen, kind: r.url().includes('/stream') ? 'stream' : 'GET', status: r.status() }) })
    await page.reload(); await page.waitForSelector('[role="tablist"]')
    await page.evaluate(() => { const el = document.querySelector('span[role="status"][aria-live="polite"]'); window.__b = [{ t: 0, x: el.innerText.trim() }]; const t0 = Date.now(); new MutationObserver(() => { const x = el.innerText.trim(); if (window.__b[window.__b.length - 1].x !== x) window.__b.push({ t: Date.now() - t0, x }) }).observe(el, { subtree: true, childList: true, characterData: true }) })
    await L.wait(30000)
    const badge = await page.evaluate(() => window.__b)
    const msg = await page.getByText("Couldn't load the feed").locator('..').innerText().catch(() => '(no error state)')
    const backendLines = fs.readFileSync(LOG, 'utf8').split('\n').slice(l0 - 1).filter((l) => / (WARN|ERROR) /.test(l)).map((l) => l.replace(/^.*? (WARN|ERROR) \d+ --- \[[^\]]*\] \[[^\]]*\] /, '$1 ').slice(0, 170))
    const streamsN = reqs.filter((r) => r.kind === 'stream').length, getsN = reqs.filter((r) => r.kind === 'GET').length
    log(`30 s with the database down: ${streamsN} stream requests, ${getsN} list GETs; badge ${JSON.stringify(badge.map((b) => b.x))}`)
    record('F-92', 'observation: a feed opened while the database is down shows the database wording; over 30 s the stream requests, list GETs, badge texts and backend WARN/ERROR lines are recorded (G-3-1: the service ends each stream with one WARN, no ERROR)', msg.includes('cannot reach its database') && !backendLines.some((l) => l.startsWith('ERROR')), { streams: streamsN, gets: getsN, requests: reqs, responses: resps, badge, backendWarnErrorLines: backendLines.length, sample: backendLines.slice(0, 6), msg: msg.replace(/\s+/g, ' ') })
    execSync('docker start vf4-mongo'); const tStart = Date.now(); log('docker start vf4-mongo')
    const back = await page.waitForSelector('article h3:has-text("present before the outage")', { timeout: 40000 }).then(() => Date.now() - tStart).catch(() => null)
    const live = await page.waitForSelector('text=/^Live$/', { timeout: 30000 }).then(() => true).catch(() => false)
    log(`card back without a click ${back} ms after docker start; Live=${live}`)
    record('F-92', 'when the database is back the page recovers by itself (no click, no reload): the card is listed again and the badge is Live', back !== null && live, { msAfterDockerStart: back, live })
    await context.close()
  } catch (e) { log('SCRIPT ERROR ' + e.message); console.error(e); process.exitCode = 1 } finally {
    try { execSync('docker start vf4-mongo') } catch {}
    fs.writeFileSync(`${__dirname}/../results/v7e-db-outage-prod-timeline.txt`, tl.join('\n') + '\n')
    await browser.close(); L.flush()
  }
})()
