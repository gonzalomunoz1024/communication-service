// F-91 through the UI with an emulated pod (Docker, no cluster here): vf3-app (fakeapp:ci) and vf3-sidecar (health-sidecar:ci,
// version ci-iter3) sharing one network namespace, the sidecar as UID 1000660000:0 with --read-only --cap-drop ALL
// --security-opt no-new-privileges, reporting to my private backend A (:19200, iteration-3 jar); the UI is my dev server :3200.
// Pod 2 (vf3-app2 + vf3-sidecar2) joins later for the rollup case. Also G-3-25 on a notice raised by a real sidecar.
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = 'http://127.0.0.1:19200'
const { execSync } = require('child_process')
const fs = require('fs')
const L = require('./lib')
const { record, api, newPage, UI, cardByTitle } = L
L.setFile('v8-pod-ui')
const RUN = Date.now().toString(36)
const tenant = `vf3-pod-${RUN}`, SERVICE = 'vf3-fake-app', POD1 = 'vf3-fake-app-5d7c9b8f6-q1w2e', POD2 = 'vf3-fake-app-5d7c9b8f6-z9y8x'
const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const setApp = (port, status, db) => sh(`curl -s -X POST 'http://127.0.0.1:${port}/__set?status=${status}&db=${db}'`)
const visible = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
async function monitor() { const r = await api('GET', `/v1/health/monitors?tenantId=${tenant}`); return r.json && r.json.find ? r.json.find((m) => m.service === SERVICE) : null }
async function instances(id) { const r = await api('GET', `/v1/health/monitors/${id}/instances`); return r.json || [] }
async function until(fn, ms, step = 500) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await L.wait(step) } return null }

;(async () => {
  const browser = await L.launch()
  const tl = []; const T0 = Date.now(); const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    log(sh(`POD_TENANT=${tenant} ${__dirname}/../infra.sh pod`).replace(/\n/g, ' | '))
    const user = sh("docker inspect vf3-sidecar --format '{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} net={{.HostConfig.NetworkMode}}'")
    log(`sidecar container: ${user}`)
    const m0 = await until(async () => { const m = await monitor(); return m && m.state && m.state.lastStatus === 'UP' ? m : null }, 60000)
    const inst0 = m0 ? await instances(m0.id) : []
    const st = sh('curl -s http://127.0.0.1:19292/status')
    log(`monitor ${m0 && m0.id} UP; instances ${JSON.stringify(inst0.map((i) => [i.instanceId, i.status, i.sidecar]))}`)
    record('F-91', 'app UP: the sidecar (UID 1000660000, read-only root, all capabilities dropped, no-new-privileges, the app\'s network namespace) reports and the backend auto-registers a monitor in state UP whose instances name the pod', m0 && inst0.length === 1 && inst0[0].instanceId === POD1 && inst0[0].status === 'UP' && inst0[0].sidecar === 'ci-iter3' && /^1000660000:0 ro=true capdrop=\[ALL\]/.test(user), { monitor: m0 && { id: m0.id, publisher: m0.policy && m0.policy.publisher, lastStatus: m0.state.lastStatus }, instances: inst0, sidecarStatus: st.slice(0, 300), container: user })

    const { context, page } = await newPage(browser)
    await page.goto(UI + '/#/feed')
    await L.setTenant(page, tenant)
    await page.waitForSelector('text=All clear')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log('UI feed Live, All clear')
    // app DOWN → notice
    log('app DOWN: ' + setApp(19291, 'DOWN', 'DOWN')); const tDown = Date.now()
    const card = cardByTitle(page, `${SERVICE} is down`)
    const seen = await card.waitFor({ timeout: 40000 }).then(() => Date.now() - tDown).catch(() => null)
    log(`card '${SERVICE} is down' visible after ${seen} ms`)
    const feed = await api('GET', `/v1/feed?tenantId=${tenant}`)
    const notice = (feed.json.items || []).find((i) => i.title === `${SERVICE} is down`) || {}
    const m1 = await monitor(); const inst1 = m1 ? await instances(m1.id) : []
    const cardText = seen !== null ? await visible(card) : ''
    record('F-91', "app DOWN: after the failure threshold an OUTAGE '<service> is down' (Major) appears live in the UI feed (default filter Type=Outage) without a refresh; the instances endpoint names the pod as DOWN", seen !== null && notice.type === 'OUTAGE' && notice.severity === 'MAJOR' && /Major/.test(cardText) && inst1.some((i) => i.instanceId === POD1 && i.status === 'DOWN'), { msUntilCard: seen, notice: { title: notice.title, type: notice.type, severity: notice.severity, publisher: notice.publisher, externalRef: notice.externalRef }, instances: inst1.map((i) => [i.instanceId, i.status]) })
    const tags = seen !== null ? await card.locator('span[title="Raised by an automated health check"]').allInnerTexts() : []
    record('G-3-25', "the sidecar-raised notice shows 'Automatic' and no health: reference; its body is plain words (no **, times to the second) naming the pod rollup and the failing component", tags.length === 1 && tags[0].trim() === 'Automatic' && !cardText.includes('health:') && !/\*\*/.test(notice.body || '') && !/\d{2}:\d{2}:\d{2}\.\d+/.test(notice.body || '') && /db/.test(notice.body || ''), { tags, body: notice.body, cardText: cardText.slice(0, 300) })
    await L.shot(page, 'pod-outage-card')
    // app UP → retired
    log('app UP: ' + setApp(19291, 'UP', 'UP')); const tUp = Date.now()
    const gone = await card.waitFor({ state: 'detached', timeout: 40000 }).then(() => Date.now() - tUp).catch(() => null)
    const perma = await api('GET', `/v1/communications/${notice.id}`)
    const hist = (perma.json && perma.json.history) || []
    const actors = [...new Set(hist.map((h) => h.actor))]
    log(`card gone ${gone} ms after recovery; history actors ${JSON.stringify(actors)}`)
    record('F-91', 'app UP: the notice is retired and the card leaves the UI feed without a refresh; one actor name signs the whole history (G-3-25 backend half: the monitor\'s own publisher)', gone !== null && perma.json.status === 'RETIRED' && actors.length === 1 && actors[0] === notice.publisher, { msUntilGone: gone, status: perma.json.status, publisher: notice.publisher, actors, last: hist.slice(-1)[0] })
    // pod 2 joins; pod 1 DOWN while pod 2 is UP → rollup 1 of 2 UP → UP by default, no notice
    sh(`docker rm -f vf3-app2 vf3-sidecar2 >/dev/null 2>&1 || true`)
    sh(`docker run -d --name vf3-app2 -p 127.0.0.1:19293:8080 fakeapp:ci`)
    sh(`docker run -d --name vf3-sidecar2 --network container:vf3-app2 --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=http://172.17.0.1:19200 -e CS_TENANT=${tenant} -e CS_SERVICE=${SERVICE} -e CS_CLIENT_ID=vf3-fakeapp-repo -e POD_NAME=${POD2} -e POD_NAMESPACE=vf3-ns -e NODE_NAME=worker-2 -e CS_CLUSTER=sandbox -e CS_VERSION=1.0.0 -e CS_INTERVAL=2s -e CS_HEARTBEAT=6s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s health-sidecar:ci`)
    log('pod 2 started')
    const two = await until(async () => { const m = await monitor(); const i = m ? await instances(m.id) : []; return i.filter((x) => x.status === 'UP' && !x.left).length === 2 ? i : null }, 60000)
    log('app 1 DOWN with pod 2 UP: ' + setApp(19291, 'DOWN', 'DOWN'))
    await L.wait(12000)
    const m2 = await monitor()
    const cardsNow = await page.locator('article').count()
    const feed2 = await api('GET', `/v1/feed?tenantId=${tenant}`)
    log(`after 12 s: monitor ${m2.state.lastStatus} '${m2.state.lastSummary || m2.state.lastMessage || ''}', cards ${cardsNow}`)
    record('F-91', "a second pod keeps the service UP while one pod is DOWN (rollup '1 of 2 pods UP' meets minHealthyPercent 50): no notice, the UI feed stays All clear", two && m2.state.lastStatus === 'UP' && cardsNow === 0 && (feed2.json.items || []).length === 0 && (await page.getByText('All clear').count()) === 1, { instances: (two || []).map((i) => [i.instanceId, i.status]), monitorState: m2.state, cards: cardsNow })
    setApp(19291, 'UP', 'UP')
    // SIGTERM sidecar 1 → leaving report → instance left=true
    const tStop = Date.now(); sh('docker stop -t 10 vf3-sidecar'); const stopMs = Date.now() - tStop
    const left = await until(async () => { const m = await monitor(); const i = m ? await instances(m.id) : []; const p1 = i.find((x) => x.instanceId === POD1); return p1 && p1.left ? i : null }, 15000)
    const exit = sh("docker inspect vf3-sidecar --format '{{.State.ExitCode}}'")
    log(`sidecar 1 stopped in ${stopMs} ms, exit ${exit}; pod 1 left=${!!left}`)
    record('F-91', 'SIGTERM to sidecar 1 (docker stop): it exits 0 within the grace and the backend marks pod 1 left=true; pod 2 stays live', left && exit === '0' && stopMs < 10000 && left.some((i) => i.instanceId === POD2 && !i.left), { stopMs, exit, instances: (left || []).map((i) => ({ id: i.instanceId, status: i.status, left: i.left })) })
    record('F-91', 'no page errors in the UI while the automated notice came and went', page.cap.errors.length === 0, { pageErrors: page.cap.errors })
    await context.close()
    fs.writeFileSync(`${__dirname}/../results/v8-sidecar1-log.txt`, sh('docker logs vf3-sidecar 2>&1 | tail -40') + '\n')
  } catch (e) { log('SCRIPT ERROR ' + e.message); console.error(e); process.exitCode = 1 } finally {
    fs.writeFileSync(`${__dirname}/../results/v8-pod-timeline.txt`, tl.join('\n') + '\n')
    try { sh('docker rm -f vf3-app2 vf3-sidecar2') } catch {}
    await browser.close()
    L.flush()
  }
})()
