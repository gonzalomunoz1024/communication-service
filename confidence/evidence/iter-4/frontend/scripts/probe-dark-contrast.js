// Probe for the g4-focus-409 dark-mode color-contrast hit on the Refresh button: is it the product's dark palette, or a sample taken
// while the 150 ms colour transition after the scheme switch was still running? Dead backend (:3206), as in that run.
process.env.UI = 'http://127.0.0.1:3206'
const L = require('./lib')
const { AxeBuilder } = require('/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4/axe/node_modules/@axe-core/playwright')
L.setFile('probe-dark-contrast')
const colours = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Refresh'); const cs = getComputedStyle(b); return { dark: document.documentElement.classList.contains('dark'), color: cs.color, bg: cs.backgroundColor, disabled: b.disabled, hover: b.matches(':hover'), transition: cs.transitionDuration } })
const cc = async (page) => { const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze(); return r.violations.map((v) => v.nodes.map((n) => n.failureSummary.split('\n').slice(-1)[0].trim().slice(0, 140))).flat() }
;(async () => {
  const browser = await L.launch()
  try {
    // A: dark from first paint
    { const { context, page } = await L.newPage(browser, { colorScheme: 'dark' }); await page.goto(L.UI + '/#/feed'); await L.setTenant(page, 'vf4-probe-dark'); await page.waitForSelector('[role="alert"]'); await L.wait(1500)
      const c = await colours(page); const v = await cc(page); L.record('F-65', 'dead backend, DARK FROM FIRST PAINT: color-contrast violations on the page', v.length === 0, { refresh: c, violations: v }); await context.close() }
    // B: light, then switch to dark, axe after 200 ms and after 1500 ms
    { const { context, page } = await L.newPage(browser, { colorScheme: 'light' }); await page.goto(L.UI + '/#/feed'); await L.setTenant(page, 'vf4-probe-dark'); await page.waitForSelector('[role="alert"]'); await L.wait(1000)
      await page.emulateMedia({ colorScheme: 'dark' })
      const at0 = await colours(page); await L.wait(200); const at200 = await colours(page); const v200 = await cc(page)
      await L.wait(1300); const at1500 = await colours(page); const v1500 = await cc(page)
      L.record('F-65', 'informational: Refresh button colours right after the switch, at +200 ms and at +1500 ms, with the color-contrast result at +200 ms', true, { at0, at200, v200 })
      L.record('F-65', 'dead backend, light → dark switch: no color-contrast violation once the 150 ms transition has settled (+1.5 s)', v1500.length === 0, { at1500, v1500 }); await context.close() }
  } finally { await browser.close(); L.flush() }
})()
