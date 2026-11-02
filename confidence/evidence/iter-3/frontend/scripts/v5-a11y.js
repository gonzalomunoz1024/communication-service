// F-65 accessibility: axe (wcag2a/2aa/21a/21aa) on feed, publish (timing open), publish-with-validation-errors and publish-with-
// server-error-banner, in light and dark; sampled contrast ratios; keyboard navigation; roles and names; h1 and live region;
// narrow viewports (375 px feed, 390 px publish); the Save-as-draft click target. Shared stack :3000.
// Iteration 3 adds: the no-tenant state ('Waiting for a tenant'), the 409 banner with its <details> open (G-3-21), the
// Resolve confirmation group (G-3-22), an 'Automatic' card on my private stack (:3200 -> A, G-3-25), two polite regions
// (G-3-23) and the >= 24 px targets of the feed's controls.
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, UI } = L
const { AxeBuilder } = require('/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend3/axe/node_modules/@axe-core/playwright')
const fs = require('fs')
L.setFile('v5-a11y')
const RUN = Date.now().toString(36)
const tenant = `vf3-a11y-${RUN}`
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const summarise = (res) => res.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map((n) => n.target.join(' ')), summary: x.nodes[0] && x.nodes[0].failureSummary && x.nodes[0].failureSummary.slice(0, 220) }))
async function axe(page, label, tags = WCAG, gate = true) {
  const res = await new AxeBuilder({ page }).withTags(tags).analyze()
  const v = summarise(res)
  const serious = v.filter((x) => x.impact === 'critical' || x.impact === 'serious')
  const contrast = v.filter((x) => x.id === 'color-contrast')
  record('F-65', `axe ${label} [${tags.join(',')}]: ${v.length} violation rule(s), ${serious.length} serious/critical, color-contrast: ${contrast.length}${gate ? '' : ' (informational)'}`, gate ? v.length === 0 : true, { violations: v, passes: res.passes.length, incomplete: res.incomplete.map((i) => i.id) })
  return v
}
async function active(page) {
  return page.evaluate(() => { const e = document.activeElement; if (!e) return null; const lab = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`) && document.querySelector(`label[for="${CSS.escape(e.id)}"]`).textContent) || e.textContent; return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}:${(lab || '').trim().slice(0, 30)}` })
}
async function contrastSamples(page) {
  return page.evaluate(() => {
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
    const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
    const over = (top, under) => { const a = top.a + under.a * (1 - top.a); return { r: (top.r * top.a + under.r * under.a * (1 - top.a)) / a, g: (top.g * top.a + under.g * under.a * (1 - top.a)) / a, b: (top.b * top.a + under.b * under.a * (1 - top.a)) / a, a } }
    const bgOf = (el) => { let acc = null; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc } } const base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; return acc ? over(acc, { ...base, a: 1 }) : base }
    const ratio = (f, b) => { const l1 = lum(f), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
    const groups = { 'tertiary text (captions, hints, meta)': '.text-tertiary', 'secondary text': '.text-secondary', 'section headings h2': 'h2', 'text inside tinted tags/banners': '[class*="-tint"]', 'critical text': '.text-critical-fg', 'accent text': '.text-accent-fg', 'captions (.text-caption)': '.text-caption', 'state capsules': '[class*="bg-state-"]' }
    const out = {}
    for (const [name, sel] of Object.entries(groups)) {
      const els = [...document.querySelectorAll(sel)].filter((e) => e.textContent.trim() && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').slice(0, 20)
      const rs = els.map((e) => { const cs = getComputedStyle(e); const fg = parse(cs.color); const bg = bgOf(e); const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold); const fgc = fg.a < 1 ? over(fg, { ...bg, a: 1 }) : fg; return { text: e.textContent.trim().slice(0, 26), fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, px: size, ratio: +ratio(fgc, bg).toFixed(2), needs: large ? 3 : 4.5 } })
      rs.sort((a, b) => a.ratio - b.ratio)
      out[name] = { sampled: rs.length, min: rs.length ? rs[0].ratio : null, belowAA: rs.filter((r) => r.ratio < r.needs).length, worst: rs.slice(0, 2) }
    }
    return out
  })
}

;(async () => {
  const browser = await L.launch()
  try {
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y outage', ticket: { number: 'INC0012345' }, audience: 'INTERNAL', endsAt: new Date(Date.now() + 3600000).toISOString() }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y maintenance', type: 'MAINTENANCE', severity: 'INFO', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y minor', severity: 'MINOR' }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y info change', type: 'CHANGE', severity: 'INFO' }))
    const dupRef = 'vf3-a11y-dup-' + RUN
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'a11y dup holder', externalRef: dupRef }))
    const all = {}
    const samples = {}
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(browser, { colorScheme: scheme })
      await page.goto(UI + '/#/feed')
      await page.waitForSelector('text=Waiting for a tenant')
      all[`feed-no-tenant-${scheme}`] = await axe(page, `feed tab with no tenant: prompt, 'Choose a tenant', badge 'Waiting for a tenant' (${scheme})`)
      samples[`feed-no-tenant-${scheme}`] = await contrastSamples(page)
      await setTenant(page, tenant)
      await page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await page.waitForSelector('article')
      await page.waitForTimeout(500)
      await page.locator('article').first().getByRole('button', { name: 'Resolve' }).click()
      all[`feed-${scheme}`] = await axe(page, `feed tab with a confirm row open (${scheme})`)
      samples[`feed-${scheme}`] = await contrastSamples(page)
      if (scheme === 'light') await axe(page, 'feed tab (light), best-practice rules', ['best-practice'], false)
      await L.shot(page, `feed-${scheme}`)
      await page.goto(UI + '/#/publish')
      await page.waitForSelector('form')
      await field.schedule(page).click()
      all[`publish-${scheme}`] = await axe(page, `publish tab, timing open (${scheme})`)
      samples[`publish-${scheme}`] = await contrastSamples(page)
      if (scheme === 'light') await axe(page, 'publish tab (light), best-practice rules', ['best-practice'], false)
      await L.shot(page, `publish-${scheme}`)
      await setTenant(page, '')
      await field.submit(page).click()
      await page.waitForTimeout(300)
      all[`publish-errors-${scheme}`] = await axe(page, `publish tab with validation errors + summary (${scheme})`)
      samples[`publish-errors-${scheme}`] = await contrastSamples(page)
      if (scheme === 'light') await L.shot(page, 'publish-errors-light')
      // the server-error banner (G-2-9 text, G-2-10 focusable div)
      await setTenant(page, tenant)
      await field.title(page).fill('a11y banner probe')
      await field.publisher(page).fill('vf3-oncall')
      await field.ref(page).fill(dupRef)
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await L.banner(page).waitFor({ timeout: 5000 })
      all[`publish-banner-${scheme}`] = await axe(page, `publish tab with the server-error banner focused (${scheme})`)
      await L.banner(page).locator('summary').click()
      all[`publish-banner-details-${scheme}`] = await axe(page, `publish tab, 409 banner with 'What the service said' open (${scheme})`)
      samples[`publish-banner-details-${scheme}`] = await contrastSamples(page)
      if (scheme === 'light') await L.shot(page, 'publish-banner-light')
      await context.close()
    }
    for (const [k, s] of Object.entries(samples)) {
      const below = Object.entries(s).filter(([, g]) => g.belowAA > 0)
      record('F-65', `sampled contrast ratios ${k}: every sampled text at or above AA (4.5:1 normal, 3:1 large)`, below.length === 0, s)
    }
    const R = `${__dirname}/../results`; fs.mkdirSync(R, { recursive: true })
    fs.writeFileSync(`${R}/v5-axe-violations.json`, JSON.stringify(all, null, 1))
    fs.writeFileSync(`${R}/v5-contrast-samples.json`, JSON.stringify(samples, null, 1))
    // roles and names, keyboard
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/publish')
      await setTenant(page, tenant)
      await page.waitForSelector('form')
      const h1 = await page.locator('h1').allTextContents()
      record('F-65', "the page has exactly one h1, 'Outage Notifications'", h1.length === 1 && h1[0] === 'Outage Notifications', h1)
      const labelled = await page.evaluate(() => {
        const out = []
        for (const el of document.querySelectorAll('input, textarea, select')) {
          const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          const wrapped = el.closest('label')
          out.push({ id: el.id || el.placeholder || el.type, named: !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || byFor || wrapped), how: el.getAttribute('aria-label') ? 'aria-label' : byFor ? 'label[for]' : wrapped ? 'wrapping label' : el.placeholder ? 'placeholder only' : 'none', describedBy: el.getAttribute('aria-describedby') ? !!document.getElementById(el.getAttribute('aria-describedby')) : null })
        }
        return out
      })
      record('F-65', 'publish tab: every input/textarea/select has a label[for], wrapping label or aria-label; every aria-describedby points at an existing note', labelled.every((l) => l.named && l.describedBy !== false), labelled)
      const roles = await page.evaluate(() => ({ tablist: document.querySelectorAll('[role="tablist"] [role="tab"]').length, radiogroups: [...document.querySelectorAll('[role="radiogroup"]')].map((g) => g.getAttribute('aria-label') || (g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')) && document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim())), radios: document.querySelectorAll('[role="radio"][aria-checked]').length, switches: [...document.querySelectorAll('[role="switch"]')].map((s) => ({ label: s.getAttribute('aria-label'), checked: s.getAttribute('aria-checked') })), h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()) }))
      record('F-65', "roles: tabs, two radiogroups named 'Type' and 'Severity' with aria-checked radios, switch with aria-label + aria-checked, card headings are h2", roles.tablist === 2 && JSON.stringify(roles.radiogroups) === JSON.stringify(['Type', 'Severity']) && roles.radios === 8 && roles.switches.length === 1 && roles.switches[0].label === 'Save as draft' && roles.h2.length >= 3, roles)
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await page.locator('input[aria-label="Tenant"]').focus()
      const order = []
      for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); order.push(await active(page)) }
      const joined = order.join(' > ')
      record('F-65', 'Tab order from the header: theme toggle → selected tab (roving) → type → severity → title → details → services → ticket → tenant → publisher → audience → ref → schedule → draft switch → Clear → Publish', /Switch to .* mode/.test(joined) && /button\[tab\]:(Feed|Publish)/.test(joined) && /button\[radio\]:Outage.*button\[radio\]:Major.*input:Title.*textarea:Details.*input:Affected services.*input:ServiceNow incident.*input:Tenant.*input:Publisher.*select:Audience.*input:External reference.*button:Schedule.*button\[switch\]:Save as draft.*button:Clear.*button:Publish outage/.test(joined), order)
      const tabbable = await page.evaluate(() => ({ radios: [...document.querySelectorAll('[role="radio"]')].map((r) => r.tabIndex), tabs: [...document.querySelectorAll('[role="tab"]')].map((r) => r.tabIndex) }))
      record('F-65', 'roving tabindex: exactly one tabbable radio per group and one tabbable tab', tabbable.radios.filter((t) => t === 0).length === 2 && tabbable.tabs.filter((t) => t === 0).length === 1, tabbable)
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
      await page.getByRole('tab', { name: /^Publish/ }).focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
      const feedSel = await page.getByRole('tab', { name: /^Feed/ }).getAttribute('aria-selected')
      record('F-65', 'tabs: ArrowRight from Publish wraps to Feed and selects it', feedSel === 'true' && page.url().endsWith('#/feed') && /button\[tab\]:Feed/.test(await active(page)), { feedSel, url: page.url(), focus: await active(page) })
      await page.keyboard.press('ArrowLeft')
      await page.waitForSelector('form')
      await field.draft(page).focus()
      await page.keyboard.press('Space')
      const sw = await field.draft(page).getAttribute('aria-checked')
      await page.keyboard.press('Enter')
      const sw2 = await field.draft(page).getAttribute('aria-checked')
      record('F-65', 'switch toggles with Space and Enter (aria-checked follows)', sw === 'true' && sw2 === 'false', { sw, sw2 })
      await field.title(page).focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      const alerts = await page.locator('[role="alert"]').count()
      record('F-65', 'Enter in a text field submits; validation errors are role=alert and inputs aria-invalid', alerts >= 2 && (await field.title(page).getAttribute('aria-invalid')) === 'true', { alerts })
      await page.locator('input[aria-label="Tenant"]').focus()
      await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e.getAttribute('aria-label') || e.textContent, matchesFocusVisible: e.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow.slice(0, 80) } })
      record('F-65', 'keyboard focus is visible (focus-visible ring: outline or box-shadow)', ring.matchesFocusVisible && (ring.boxShadow !== 'none' || !/none/.test(ring.outline)), ring)
      await context.close()
    }
    // feed tab labels, badge text, live region; narrow viewports
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article')
      const labelled = await page.evaluate(() => [...document.querySelectorAll('input, select')].map((el) => { const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); return { id: el.id || el.placeholder || el.type, how: el.getAttribute('aria-label') ? 'aria-label' : byFor ? 'label[for]' : el.closest('label') ? 'wrapping label' : el.placeholder ? 'placeholder only' : 'none' } }))
      record('F-65', 'feed tab: filter controls have accessible names via label association or aria-label (not placeholder only)', labelled.every((l) => l.how !== 'placeholder only' && l.how !== 'none'), labelled)
      const dot = await L.indicator(page, 3000)
      record('F-65', 'connection badge has a text label', /^(Live|Connecting|Paused|Reconnecting)/.test(dot), dot)
      const regions = await page.locator('[role="status"][aria-live="polite"]').evaluateAll((els) => els.map((e) => e.tagName.toLowerCase()))
      record('F-65', 'G-3-23: two polite live regions on the feed: the connection badge (span) and the resolve/withdraw announcement (p)', JSON.stringify(regions) === JSON.stringify(['span', 'p']), regions)
      const resolveNames = await page.locator('article').first().getByRole('button').allTextContents()
      record('F-65', 'card action buttons have text names (Resolve)', resolveNames.includes('Resolve'), resolveNames)
      // the results wrapper is a programmatic focus target only (tabindex=-1), so it is not in the Tab order
      const wrapperTab = await page.evaluate(() => [...document.querySelectorAll('div[tabindex="-1"]')].length)
      record('F-65', 'G-2-10: the results wrapper is focusable programmatically (tabindex=-1) without entering the Tab order', wrapperTab >= 1, `div[tabindex=-1] count=${wrapperTab}`)
      await context.close()
      const narrow = await newPage(browser, { viewport: { width: 375, height: 740 } })
      await narrow.page.goto(UI + '/#/feed')
      await setTenant(narrow.page, tenant)
      await narrow.page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await narrow.page.waitForSelector('article')
      await narrow.page.waitForTimeout(400)
      const fit = await narrow.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, h1: document.querySelectorAll('h1').length }))
      await L.shot(narrow.page, 'feed-light-375')
      record('F-65', 'narrow viewport (375 px): feed has no horizontal overflow, the h1 is still in the document (visually hidden)', fit.scrollWidth <= fit.innerWidth && fit.h1 === 1, fit)
      const feedSmall = await narrow.page.evaluate(() => [...document.querySelectorAll('button, a, input, select, [role="switch"]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); const row = e.closest('label'); const rr = row ? row.getBoundingClientRect() : r; return { name: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height), rowH: Math.round(rr.height) } }).filter((x) => x.h < 24 && x.rowH < 24))
      const liveRow = await narrow.page.evaluate(() => { const sw = document.querySelector('[role="switch"][aria-label="Live updates"]'); const r = sw.getBoundingClientRect(); const rr = sw.closest('label').getBoundingClientRect(); return { switch: { w: Math.round(r.width), h: Math.round(r.height) }, row: { w: Math.round(rr.width), h: Math.round(rr.height) } } })
      record('F-65', 'G-3-23: narrow viewport (375 px): every feed control (or its labelled row) is at least 24 px tall; the Live-updates row is >= 24 px around the 30x18 switch', feedSmall.length === 0 && liveRow.row.h >= 24, { feedSmall, liveRow })
      await narrow.page.goto(UI + '/#/publish')
      await narrow.page.waitForSelector('form')
      await field.schedule(narrow.page).click()
      const fit2 = await narrow.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
      const small = await narrow.page.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea, [role="switch"]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); const row = e.closest('label'); const rr = row ? row.getBoundingClientRect() : r; return { name: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 24), h: Math.round(r.height), rowH: Math.round(rr.height) } }).filter((x) => x.h < 24 && x.rowH < 24))
      await L.shot(narrow.page, 'publish-light-375')
      record('F-65', 'narrow viewport (375 px): publish form (timing open) has no horizontal overflow and no interactive control (or its labelled row) under 24 px tall', fit2.scrollWidth <= fit2.innerWidth && small.length === 0, { fit2, small })
      await narrow.context.close()
    }
    // G-3-25: an automated notice's card ('Automatic' tag) on my private stack, both themes
    {
      const PRIV_UI = 'http://127.0.0.1:3200', PRIV_API = 'http://127.0.0.1:19200'
      const autoTenant = `vf3-a11y-auto-${RUN}`, svc = `vf3-a11y-svc-${RUN}`
      for (let i = 0; i < 2; i++) await api('POST', '/v1/health/reports', { tenantId: autoTenant, service: svc, status: 'DOWN', components: { db: { status: 'DOWN', details: { error: 'timeout' } } } }, {}, PRIV_API)
      for (const scheme of ['light', 'dark']) {
        const { context, page } = await newPage(browser, { colorScheme: scheme })
        await page.goto(PRIV_UI + '/#/feed')
        await setTenant(page, autoTenant)
        await page.waitForSelector(`article h3:has-text("${svc} is down")`, { timeout: 15000 })
        await page.locator('article').first().getByRole('button', { name: 'Resolve' }).click()
        all[`feed-automatic-${scheme}`] = await axe(page, `feed with an automated notice ('Automatic' tag) and its confirmation open (${scheme})`)
        samples[`feed-automatic-${scheme}`] = await contrastSamples(page)
        if (scheme === 'dark') await L.shot(page, 'feed-automatic-dark')
        await context.close()
      }
      for (let i = 0; i < 2; i++) await api('POST', '/v1/health/reports', { tenantId: autoTenant, service: svc, status: 'UP' }, {}, PRIV_API)
      for (const k of ['feed-automatic-light', 'feed-automatic-dark']) {
        const below = Object.entries(samples[k] || {}).filter(([, g]) => g.belowAA > 0)
        record('F-65', `sampled contrast ratios ${k}: every sampled text at or above AA`, samples[k] && below.length === 0, samples[k])
      }
      fs.writeFileSync(`${__dirname}/../results/v5-axe-violations.json`, JSON.stringify(all, null, 1))
      fs.writeFileSync(`${__dirname}/../results/v5-contrast-samples.json`, JSON.stringify(samples, null, 1))
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
