// probe: GETs and streams after a reload with a remembered tenant, dev server (:3200, React StrictMode active in dev) vs
// production bundle (:3205, same backend A)
const L = require('./lib')
;(async () => {
  const browser = await L.launch()
  for (const ui of ['http://127.0.0.1:3200', 'http://127.0.0.1:3205']) {
    const { context, page } = await L.newPage(browser)
    await page.goto(ui + '/#/feed')
    await page.evaluate(() => localStorage.setItem('comm-tenant', 'vf4-reload-probe'))
    const t0 = Date.now()
    await page.reload(); await page.waitForSelector('text=All clear'); await L.wait(1500)
    const gets = page.cap.requests.filter((r) => r.at >= t0 && /\/v1\/feed\?/.test(r.url)).length
    const streams = page.cap.requests.filter((r) => r.at >= t0 && r.url.includes('/v1/feed/stream')).length
    console.log(JSON.stringify({ ui, getsAfterReload: gets, streamsAfterReload: streams }))
    await context.close()
  }
  await browser.close()
})()
