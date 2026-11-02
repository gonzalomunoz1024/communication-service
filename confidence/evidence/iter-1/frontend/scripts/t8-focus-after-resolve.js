// G-1-15 follow-up: where does keyboard focus go after resolving a card? Two items (one stays) vs a single item (the list empties).
const L = require('./lib'); const { record, api, publishBody, newPage, cardByTitle } = L
L.setFile('t8-focus-after-resolve')
const RUN = Date.now().toString(36)
const focusInfo = (page) => page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()} tabindex=${e.getAttribute('tabindex')} role=${e.getAttribute('role')} class=${(e.className || '').toString().slice(0, 40)}` : null })
;(async () => {
  const browser = await L.launch()
  try {
    for (const [label, n] of [['two items, resolve the first', 2], ['single item, resolve it', 1]]) {
      const tenant = `fe1-focus${n}-${RUN}`
      for (let i = 0; i < n; i++) await api('POST', '/v1/communications', publishBody(tenant, { title: `focus item ${i}` }))
      const { context, page } = await newPage(browser)
      await L.gotoFeed(page, tenant)
      const card = cardByTitle(page, 'focus item 0'); await card.waitFor()
      await card.getByRole('button', { name: 'Resolve' }).focus(); await page.keyboard.press('Enter')
      await card.getByRole('button', { name: 'Resolve' }).focus(); await page.keyboard.press('Enter')
      await card.waitFor({ state: 'detached', timeout: 5000 })
      await page.waitForTimeout(300)
      const focus = await focusInfo(page)
      const announced = await page.locator('[role="status"]').first().textContent()
      const emptyShown = await page.getByText('All clear').count()
      record('F-62', `G-1-15 focus after resolve (${label}): focus is on the list container (div tabindex=-1), not lost to <body>`, /^div tabindex=-1/.test(focus || ''), { focus, announced, emptyStateShown: emptyShown === 1 })
      await context.close()
    }
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
