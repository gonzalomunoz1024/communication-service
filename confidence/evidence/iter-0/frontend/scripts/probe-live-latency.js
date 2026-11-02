const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch()
  const PORT = require('fs').readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
  for (const [ui, api, label] of [['http://127.0.0.1:3000', 'http://127.0.0.1:8080', 'shared 3000→8080'], ['http://127.0.0.1:3011', `http://127.0.0.1:${PORT}`, `aux 3011→${PORT}`]]) {
    for (const seeded of [false, true]) {
      const tenant = `fe-lat-${Date.now().toString(36)}`
      if (seeded) await fetch(`${api}/v1/communications`, { method: 'POST', headers: { 'X-Client-Id': 'fe-verifier', 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 'seed' }) })
      const page = await (await browser.newContext()).newPage()
      const t0 = Date.now(); const seen = []
      page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) seen.push(`stream response ${r.status()} @${Date.now() - t0}ms`) })
      await page.goto(ui + '/#/feed')
      await page.locator('input[aria-label="Tenant"]').fill(tenant)
      let last = ''
      while (Date.now() - t0 < 25000) {
        const s = await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent().catch(() => '?')
        if (s !== last) { seen.push(`${s} @${Date.now() - t0}ms`); last = s }
        if (s === 'Live') break
        await new Promise((r) => setTimeout(r, 200))
      }
      console.log(label, seeded ? '(tenant with 1 item)' : '(empty tenant)', '::', seen.join(' | '))
      await page.context().close()
    }
  }
  await browser.close()
})()
