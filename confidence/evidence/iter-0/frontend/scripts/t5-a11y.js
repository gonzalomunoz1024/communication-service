// F-65 accessibility basics: axe on both tabs (light + dark), keyboard navigation, roles, focus-visible, contrast
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, form, UI } = L
const { AxeBuilder } = require('@axe-core/playwright')
L.setFile('t5-a11y')
const RUN = Date.now().toString(36)
const tenant = `fe-a11y-${RUN}`

async function axe(page, label) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze()
  const v = res.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map((n) => n.target.join(' ')), summary: x.nodes[0] && x.nodes[0].failureSummary && x.nodes[0].failureSummary.slice(0, 220) }))
  const serious = v.filter((x) => x.impact === 'critical' || x.impact === 'serious')
  record('F-65', `axe ${label}: ${v.length} violation rule(s), ${serious.length} serious/critical`, serious.length === 0, v)
  return v
}
async function active(page) {
  return page.evaluate(() => { const e = document.activeElement; if (!e) return null; const lab = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`) && document.querySelector(`label[for="${e.id}"]`).textContent) || e.textContent; return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}:${(lab || '').trim().slice(0, 30)}` })
}

;(async () => {
  const browser = await L.launch()
  try {
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y outage', ticket: { number: 'INC0012345' }, audience: 'INTERNAL', endsAt: new Date(Date.now() + 3600000).toISOString() }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y maintenance', type: 'MAINTENANCE', severity: 'INFO', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y minor', severity: 'MINOR' }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y info change', type: 'CHANGE', severity: 'INFO' }))
    const all = {}
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(browser, { colorScheme: scheme })
      await page.goto(UI + '/#/feed')
      await setTenant(page, tenant)
      await page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await page.waitForSelector('article')
      await page.waitForTimeout(500)
      // open one confirm row so its controls are scanned too
      await page.locator('article').first().getByRole('button', { name: 'Resolve' }).click()
      all[`feed-${scheme}`] = await axe(page, `feed tab (${scheme})`)
      await page.goto(UI + '/#/publish')
      await page.waitForSelector('form')
      await field.schedule(page).click()
      all[`publish-${scheme}`] = await axe(page, `publish tab, timing open (${scheme})`)
      await setTenant(page, '')
      await field.submit(page).click()
      await page.waitForTimeout(200)
      all[`publish-errors-${scheme}`] = await axe(page, `publish tab with validation errors (${scheme})`)
      await context.close()
    }
    // roles and names
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/publish')
      await setTenant(page, tenant)
      await page.waitForSelector('form')
      const labelled = await page.evaluate(() => {
        const out = []
        for (const el of document.querySelectorAll('input, textarea, select')) {
          const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          const wrapped = el.closest('label')
          out.push({ id: el.id || el.placeholder || el.type, named: !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || byFor || wrapped), how: el.getAttribute('aria-label') ? 'aria-label' : byFor ? 'label[for]' : wrapped ? 'wrapping label' : el.placeholder ? 'placeholder only' : 'none' })
        }
        return out
      })
      record('F-65', 'publish tab: every input/textarea/select has a label[for], wrapping label or aria-label', labelled.every((l) => l.named), labelled)
      const roles = await page.evaluate(() => ({ tablist: document.querySelectorAll('[role="tablist"] [role="tab"]').length, radiogroups: document.querySelectorAll('[role="radiogroup"]').length, radios: document.querySelectorAll('[role="radio"][aria-checked]').length, switches: [...document.querySelectorAll('[role="switch"]')].map((s) => ({ label: s.getAttribute('aria-label'), checked: s.getAttribute('aria-checked') })) }))
      record('F-65', 'roles: tabs, two radiogroups (type, severity) with aria-checked radios, switch with aria-label + aria-checked', roles.tablist === 2 && roles.radiogroups === 2 && roles.radios === 8 && roles.switches.length === 1 && roles.switches[0].label === 'Save as draft', roles)
      // keyboard: tab order through the form
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await page.locator('input[aria-label="Tenant"]').focus()
      const order = []
      for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); order.push(await active(page)) }
      const joined = order.join(' > ')
      record('F-65', 'Tab order from the header: theme toggle → selected tab (roving) → type → severity → title → details → services → ticket → tenant → publisher → audience → ref → schedule → draft switch → Clear → Publish', /Switch to .* mode/.test(joined) && /button\[tab\]:(Feed|Publish)/.test(joined) && /button\[radio\]:Outage.*button\[radio\]:Major.*input:Title.*textarea:Details.*input:Affected services.*input:ServiceNow incident.*input:Tenant.*input:Publisher.*select:Audience.*input:External reference.*button:Schedule.*button\[switch\]:Save as draft.*button:Clear.*button:Publish outage/.test(joined), order)
      // roving tabindex: only the selected radio/tab is tabbable
      const tabbable = await page.evaluate(() => ({ radios: [...document.querySelectorAll('[role="radio"]')].map((r) => r.tabIndex), tabs: [...document.querySelectorAll('[role="tab"]')].map((r) => r.tabIndex) }))
      record('F-65', 'roving tabindex: exactly one tabbable radio per group and one tabbable tab', tabbable.radios.filter((t) => t === 0).length === 2 && tabbable.tabs.filter((t) => t === 0).length === 1, tabbable)
      // arrow keys on segmented + Home/End
      await field.type(page, 'Outage').focus()
      await page.keyboard.press('ArrowRight')
      const afterRight = await field.type(page, 'Incident').getAttribute('aria-checked')
      await page.keyboard.press('End')
      const afterEnd = await field.type(page, 'Change').getAttribute('aria-checked')
      await page.keyboard.press('Home')
      const afterHome = await field.type(page, 'Outage').getAttribute('aria-checked')
      await page.keyboard.press('ArrowLeft')
      const wrap = await field.type(page, 'Change').getAttribute('aria-checked')
      record('F-65', 'segmented control: ArrowRight/End/Home/ArrowLeft(wrap) move the selection and focus', afterRight === 'true' && afterEnd === 'true' && afterHome === 'true' && wrap === 'true' && /button\[radio\]:Change/.test(await active(page)), { afterRight, afterEnd, afterHome, wrap, focus: await active(page) })
      // arrow keys on tabs
      await page.getByRole('tab', { name: /^Publish/ }).focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
      const feedSel = await page.getByRole('tab', { name: /^Feed/ }).getAttribute('aria-selected')
      record('F-65', 'tabs: ArrowRight from Publish wraps to Feed and selects it', feedSel === 'true' && page.url().endsWith('#/feed') && /button\[tab\]:Feed/.test(await active(page)), { feedSel, url: page.url(), focus: await active(page) })
      await page.keyboard.press('ArrowLeft')
      await page.waitForSelector('form')
      // switch with keyboard
      await field.draft(page).focus()
      await page.keyboard.press('Space')
      const sw = await field.draft(page).getAttribute('aria-checked')
      await page.keyboard.press('Enter')
      const sw2 = await field.draft(page).getAttribute('aria-checked')
      record('F-65', 'switch toggles with Space and Enter (aria-checked follows)', sw === 'true' && sw2 === 'false', { sw, sw2 })
      // submit with Enter from a text field, errors role=alert and aria-invalid
      await field.title(page).focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      const alerts = await page.locator('[role="alert"]').count()
      record('F-65', 'Enter in a text field submits; validation errors are role=alert and inputs aria-invalid', alerts >= 2 && (await field.title(page).getAttribute('aria-invalid')) === 'true', { alerts })
      // focus-visible ring on keyboard focus
      await page.locator('input[aria-label="Tenant"]').focus()
      await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e.getAttribute('aria-label') || e.textContent, matchesFocusVisible: e.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow.slice(0, 80) } })
      record('F-65', 'keyboard focus is visible (focus-visible ring: outline or box-shadow)', ring.matchesFocusVisible && (ring.boxShadow !== 'none' || !/none/.test(ring.outline)), ring)
      await context.close()
    }
    // feed tab labels + status dot text
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article')
      const labelled = await page.evaluate(() => [...document.querySelectorAll('input, select')].map((el) => { const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); return { id: el.id || el.placeholder || el.type, how: el.getAttribute('aria-label') ? 'aria-label' : byFor ? 'label[for]' : el.closest('label') ? 'wrapping label' : el.placeholder ? 'placeholder only' : 'none' } }))
      record('F-65', 'feed tab: filter controls have accessible names via label association or aria-label (not placeholder only)', labelled.every((l) => l.how !== 'placeholder only' && l.how !== 'none'), labelled)
      const dot = await page.locator('text=/^(Live|Connecting|Paused|Reconnecting)$/').first().textContent()
      record('F-65', 'connection status dot has a text label', ['Live', 'Connecting', 'Paused', 'Reconnecting'].includes(dot), dot)
      const resolveNames = await page.locator('article').first().getByRole('button').allTextContents()
      record('F-65', 'card action buttons have text names (Resolve)', resolveNames.includes('Resolve'), resolveNames)
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
