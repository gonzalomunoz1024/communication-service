// UX-23 re-check: Swagger UI before/after Authorize, 401 documentation, scheme name; OpenAPI text for expectedVersion and monitorId.
const { chromium } = require('playwright'); const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {}
;(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto('http://localhost:8080/swagger-ui.html'); await page.waitForSelector('.swagger-ui .opblock', { timeout: 30000 }); await sleep(800)
  out.url = page.url(); out.title = (await page.locator('.swagger-ui .info .title').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  out.tags = await page.locator('.opblock-tag').allInnerTexts()
  out.authorizeButton = await page.locator('.btn.authorize').count()
  await page.locator('.btn.authorize').first().click(); await sleep(500)
  out.authDialog = (await page.locator('.auth-container').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 400))
  await page.screenshot({ path: `${EV}/27-swagger-authorize.png` })
  await page.locator('.modal-ux .close-modal, .btn-done').first().click(); await sleep(300)
  const op = page.locator('.opblock-get').filter({ has: page.locator('.opblock-summary-path[data-path="/v1/feed"]') }).first()
  out.feedOpFound = await op.count()
  await op.locator('.opblock-summary').click(); await sleep(500)
  out.feedDocumentedResponses = await op.locator('.responses-table .response-col_status').allInnerTexts()
  await op.locator('.try-out__btn').click(); await sleep(300)
  await op.locator('input[placeholder="tenantId"]').fill('ux1-swagger')
  await op.locator('.execute').click(); await sleep(2000)
  out.noAuth = { status: await op.locator('.live-responses-table tbody tr.response .response-col_status').first().innerText().catch(() => null), body: (await op.locator('.live-responses-table tbody tr.response .response-col_description').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300), undocumentedLabel: await op.locator('.response-undocumented').count() }
  await op.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${EV}/28-swagger-401.png` })
  await page.locator('.btn.authorize').first().click(); await sleep(400)
  await page.locator('.auth-container input').first().fill('ux1-swagger'); await page.locator('.auth-btn-wrapper .btn.authorize, .auth-container .btn.authorize').first().click(); await sleep(300)
  await page.locator('.btn-done').first().click(); await sleep(300)
  await op.locator('.execute').click(); await sleep(2000)
  out.withAuth = { status: await op.locator('.live-responses-table tbody tr.response .response-col_status').first().innerText().catch(() => null), bodyStart: (await op.locator('.live-responses-table tbody tr.response .response-col_description').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120) }
  const doc = await (await fetch('http://localhost:8080/v3/api-docs')).json()
  const put = doc.paths['/v1/communications/{id}'] && doc.paths['/v1/communications/{id}'].put
  const probePath = Object.keys(doc.paths).find((p) => p.includes('/probe'))
  const schemas = doc.components.schemas
  const ev = Object.entries(schemas).filter(([, s]) => s.properties && s.properties.expectedVersion).map(([n, s]) => ({ schema: n, expectedVersion: s.properties.expectedVersion }))
  out.openapi = { paths: Object.keys(doc.paths).length, securitySchemes: doc.components.securitySchemes, globalSecurity: doc.security, feedGetResponses: Object.keys(doc.paths['/v1/feed'].get.responses), feed401Text: doc.paths['/v1/feed'].get.responses['401'] && doc.paths['/v1/feed'].get.responses['401'].description, putSummary: put && (put.summary || ''), putDescription: put && (put.description || '').slice(0, 400), expectedVersion: ev, probePath, probeSummary: probePath && (doc.paths[probePath].post.summary || doc.paths[probePath].post.description || ''), probeIdParam: probePath && (doc.paths[probePath].post.parameters || []).map((p) => ({ name: p.name, description: p.description })), streamParams: (doc.paths['/v1/feed/stream'].get.parameters || []).map((p) => p.name + (p.description ? ': ' + p.description.slice(0, 120) : '')) }
  await browser.close(); fs.writeFileSync(`${EV}/swagger-ui.txt`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/swagger-ui.txt`, JSON.stringify(out, null, 1)); process.exit(1) })
