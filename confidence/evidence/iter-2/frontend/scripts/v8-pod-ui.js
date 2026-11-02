// F-91 from the UI's side: my own emulated pod (vf2-app = fakeapp:ci, vf2-sidecar = health-sidecar:ci sharing its network
// namespace, UID 1000660000, read-only, cap-drop ALL) reporting to my backend A (:19200) for tenant vf2-pod; the feed on my
// dev server :3200. app UP → monitor registered with the pod as instance; app DOWN → an OUTAGE notice appears live in the feed
// (type Outage); app UP → it is retired and leaves. Timings recorded. The sidecar's own contract belongs to the Sidecar Verifier.
const { execSync } = require('child_process')
const fs = require('fs')
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = 'http://127.0.0.1:19200'
const L = require('./lib')
const { record, api, newPage, setTenant } = L
L.setFile('v8-pod-ui')
// run 3: a fresh tenant per run. Run 2 reused vf2-pod, whose monitor from run 1 had gone stale meanwhile (no report since the pod
// was removed) and already carried a 'vf2-fake-app is down' notice, so the 'card appears after the fault' step was pre-empted.
const TENANT = process.env.POD_TENANT = 'vf2-pod-' + Date.now().toString(36), APP = 'http://127.0.0.1:19290', SIDECAR = 'http://127.0.0.1:19291'
const r1 = (n) => Math.round(n * 10) / 10
const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const monitors = () => api('GET', `/v1/health/monitors?tenantId=${TENANT}`)

;(async () => {
  const browser = await L.launch()
  const tl = []; const T0 = Date.now(); const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    sh('/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/infra.sh pod')
    log('pod started (vf2-app + vf2-sidecar)')
    await fetch(`${APP}/__set?status=UP&db=UP`, { method: 'POST' }).catch(() => {})
    let mon = null
    for (let i = 0; i < 60; i++) { const m = await monitors(); if (m.status === 200 && Array.isArray(m.json)) { mon = m.json.find((x) => x.service === 'vf2-fake-app'); if (mon && mon.state && mon.state.lastStatus === 'UP') break } await L.wait(1000) }
    log(`monitor: ${mon ? `${mon.id} lastStatus=${mon.state && mon.state.lastStatus}` : 'none'}`)
    const inst = mon ? await api('GET', `/v1/health/monitors/${mon.id}/instances`) : { status: 0, json: null }
    const status = await fetch(`${SIDECAR}/status`).then((r) => r.json()).catch(() => null)
    const whoami = sh("docker inspect vf2-sidecar --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} net={{.HostConfig.NetworkMode}}' 2>&1 || true").trim() // run 1 tried `docker exec ... id`: the image has no shell or id binary
    record('F-91', 'app UP → the sidecar reports and the backend auto-registers a monitor (tenant vf2-pod, service vf2-fake-app) in state UP whose instances name the pod', !!mon && mon.state.lastStatus === 'UP' && inst.status === 200 && JSON.stringify(inst.json).includes('vf2-fake-app-5d7c9b8f6-q1w2e'), { monitor: mon && { id: mon.id, service: mon.service, lastStatus: mon.state.lastStatus }, instances: inst.json, sidecarStatus: status && { app: status.appStatus || status.status, reportsSent: status.reportsSent, sendError: status.sendError }, sidecarContainer: whoami.slice(0, 200) })
    const { context, page } = await newPage(browser)
    await page.goto(`${process.env.UI}/#/feed`)
    await setTenant(page, TENANT)
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    const before = await page.locator('article').count()
    log(`feed Live for ${TENANT}, ${before} card(s) before the fault`)
    const tDown = Date.now()
    await fetch(`${APP}/__set?status=DOWN&db=DOWN`, { method: 'POST' })
    log('fake app set DOWN')
    const appeared = await page.waitForSelector('article h3:has-text("is down")', { timeout: 60000 }).then(() => Date.now() - tDown).catch(() => null)
    log(`OUTAGE card appeared after ${appeared} ms`)
    const card = page.locator('article', { has: page.locator('h3:has-text("is down")') }).first()
    const text = appeared !== null ? await card.textContent() : ''
    const typeSel = await page.getByRole('combobox', { name: 'Type' }).inputValue()
    const feed = await api('GET', `/v1/feed?tenantId=${TENANT}`)
    const notice = feed.json.items.find((i) => /is down/.test(i.title))
    const instDown = mon ? await api('GET', `/v1/health/monitors/${mon.id}/instances`) : { json: null }
    await L.shot(page, 'pod-outage-card')
    record('F-91', `app DOWN → after the failure threshold an OUTAGE '<service> is down' appears live in the UI feed (default filter Type=Outage) ${appeared} ms after the fault, published by health-sidecar (the publisher the sidecar registers its monitor with; run 1 wrongly expected the retire actor 'health-monitor' here), severity Major; the instances endpoint names the pod`, appeared !== null && typeSel === 'OUTAGE' && /vf2-fake-app is down/.test(text) && notice && notice.type === 'OUTAGE' && notice.severity === 'MAJOR' && notice.publisher === 'health-sidecar' && JSON.stringify(instDown.json).includes('vf2-fake-app-5d7c9b8f6-q1w2e'), { msUntilCard: appeared, cardText: text.slice(0, 220), notice: notice && { title: notice.title, type: notice.type, severity: notice.severity, publisher: notice.publisher, affectedServices: notice.affectedServices }, instances: instDown.json })
    const tUp = Date.now()
    await fetch(`${APP}/__set?status=UP&db=UP`, { method: 'POST' })
    log('fake app set UP')
    const gone = await page.waitForSelector('article h3:has-text("is down")', { state: 'detached', timeout: 60000 }).then(() => Date.now() - tUp).catch(() => null)
    log(`OUTAGE card left after ${gone} ms`)
    const after = notice ? await api('GET', `/v1/communications/${notice.id}`) : { json: {} }
    record('F-91', `app UP → the notice is retired (status RETIRED) and the card leaves the UI feed ${gone} ms after recovery, without a refresh`, gone !== null && after.json.status === 'RETIRED', { msUntilGone: gone, status: after.json.status, lastHistory: (after.json.history || []).slice(-1)[0] })
    record('F-91', 'no page errors while the auto notice came and went', page.cap.errors.length === 0, { pageErrors: page.cap.errors })
    await context.close()
  } catch (e) { log('SCRIPT ERROR ' + e.message); console.error(e) } finally {
    try { fs.writeFileSync(`${__dirname}/../results/v8-sidecar-log.txt`, sh('docker logs vf2-sidecar 2>&1 | tail -60')) } catch {}
    try { sh('docker rm -f vf2-app vf2-sidecar') } catch {}
    const R = `${__dirname}/../results`; fs.mkdirSync(R, { recursive: true })
    fs.writeFileSync(`${R}/v8-pod-timeline.txt`, tl.join('\n') + '\n')
    await browser.close()
    L.flush()
  }
})()
