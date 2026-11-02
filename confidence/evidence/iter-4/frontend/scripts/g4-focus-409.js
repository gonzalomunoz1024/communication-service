// Iteration 4 in a real browser against real backends (no mocks, no route fulfilment):
//   G-4-18  dead backend (my dev server :3206 → nothing on :19299; the dev proxy answers 502 with an empty body): the feed's load
//           error is a role=alert, each failed Try again (keyboard) inserts a NEW alert and focus lands on its Try again;
//   G-4-19  "View in feed" (keyboard and mouse) puts focus on the feed's list; switching tabs by hand leaves it on the tabs;
//   G-4-20  Escape cancels the inline Resolve / Withdraw confirmation from the note, Cancel or confirm control; focus returns to the
//           Resolve / Withdraw button; nothing is sent (the while-the-call-runs case is in g4-db-outage.js);
//   G-4-21  the duplicate-reference 409 from backend A (:19200 behind :3200) offers the service's suggestedExternalRef (R-3 when R-2
//           is taken; the old local count would have said R-2), for a typed reference and for a ticket number; the suggestion is
//           accepted (201); with all 50 follow-up values taken the 409 has no suggestion and the banner suggests none, quoting the
//           service; edge: a reference that contains parentheses.
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = 'http://127.0.0.1:19200'
const fs = require('fs')
const L = require('./lib')
const { record, api, publishBody, newPage, field, UI } = L
const { axe } = require('./a11y')
L.setFile('g4-focus-409')
const RUN = Date.now().toString(36)
const T = (n) => `vf4-${n}-${RUN}`
const DEAD_UI = 'http://127.0.0.1:3206'
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'
const visible = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const tl = []; const T0 = Date.now(); const log = (m) => { const l = `+${((Date.now() - T0) / 1000).toFixed(2)}s ${m}`; tl.push(l); console.log(l) }
const OBSERVE = () => {
  window.__alerts = []
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue
      const found = [...(n.matches('[role="alert"]') ? [n] : []), ...n.querySelectorAll('[role="alert"]')]
      for (const a of found) window.__alerts.push({ t: Date.now(), text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) })
    }
  }).observe(document, { subtree: true, childList: true })
}
async function tabTo(page, label, max = 12) {
  for (let i = 0; i < max; i++) { const a = await L.activeInfo(page); if (a && a.text === label) return true; await page.keyboard.press('Tab') }
  return false
}
async function uiPublish(page, { title, ref, ticket }) {
  await field.title(page).fill(title)
  await field.publisher(page).fill('vf4-oncall')
  await field.ref(page).fill(ref || '')
  await field.ticket(page).fill(ticket || '')
  const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status(), json }
}

;(async () => {
  const browser = await L.launch()
  try {
    // ---------------- G-4-18: dead backend ----------------
    {
      const { context, page } = await newPage(browser)
      await page.addInitScript(OBSERVE)
      await page.goto(DEAD_UI + '/#/feed')
      await L.setTenant(page, T('dead'))
      await page.waitForSelector('[role="alert"]:has-text("Couldn\'t load the feed")', { timeout: 15000 })
      const first = await visible(page.locator('[role="alert"]:has-text("Couldn\'t load the feed")'))
      const n0 = await page.evaluate(() => window.__alerts.length)
      record('G-4-18', "dead backend: the feed's load error renders inside a role=alert (title, the unreachable wording and Try again inside it)", first.includes("Couldn't load the feed") && first.includes(UNREACHABLE) && first.includes('Try again') && n0 === 1, { alertText: first, alertsInserted: n0 })
      const presses = []
      for (let i = 0; i < 3; i++) {
        const old = await page.locator('[role="alert"]:has-text("Couldn\'t load the feed")').elementHandle()
        await page.getByRole('button', { name: 'Try again' }).focus()
        const before = await page.evaluate(() => window.__alerts.length)
        const resp = page.waitForResponse((r) => /\/v1\/feed\?/.test(r.url()))
        await page.keyboard.press('Enter')
        const r = await resp
        await page.waitForFunction((n) => window.__alerts.length > n, before, { timeout: 5000 }).catch(() => {})
        await L.wait(250)
        presses.push({ status: r.status(), inserted: (await page.evaluate(() => window.__alerts.length)) - before, oldDetached: !(await old.evaluate((e) => e.isConnected)), focus: await L.activeInfo(page), text: await page.evaluate(() => window.__alerts[window.__alerts.length - 1].text) }) // run 1 cut this at 120 characters, dropping the wording's final period
      }
      log(`dead backend Try again ×3: ${JSON.stringify(presses.map((p) => ({ status: p.status, inserted: p.inserted, oldDetached: p.oldDetached, focus: p.focus && p.focus.id })))}`)
      record('G-4-18', 'dead backend: each of three Try again presses (keyboard) gets its 502 and inserts exactly one NEW role=alert (the old one detached), whose text is read again; focus lands on the new Try again button each time, never <body>', presses.every((p) => p.status === 502 && p.inserted === 1 && p.oldDetached && p.focus && p.focus.tag === 'button' && /-retry$/.test(p.focus.id || '') && p.text.includes(UNREACHABLE)), presses)
      const badge = await L.indicator(page)
      record('G-4-17', "dead backend: the badge counts 'Reconnecting (n)', never 'Live' or 'Service degraded' (no stream works)", /^Reconnecting \(\d+\)$/.test(badge), { badge })
      await axe(page, 'dead-backend feed alert (light)')
      // run 1 waited 200 ms: on this loaded machine the buttons' 150 ms colour transition had not settled (probe-dark-contrast.js)
      await page.emulateMedia({ colorScheme: 'dark' }); await L.wait(1500)
      await axe(page, 'dead-backend feed alert (dark)')
      await L.shot(page, 'g4-dead-backend-alert-dark')
      await context.close()
    }

    // ---------------- G-4-19: focus after "View in feed" ----------------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('view')
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      await field.title(page).focus(); await page.keyboard.type('view in feed keyboard')
      await field.publisher(page).focus(); await page.keyboard.type('vf4-oncall')
      await field.submit(page).focus()
      const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), page.keyboard.press('Enter')])
      await page.waitForSelector('text=Outage published')
      const reached = await tabTo(page, 'View in feed')
      const scrollBefore = await page.evaluate(() => window.scrollY)
      await page.keyboard.press('Enter')
      await page.waitForSelector('article h3:has-text("view in feed keyboard")')
      await L.wait(300)
      const f1 = await L.activeInfo(page)
      const inList = await page.evaluate(() => { const e = document.activeElement; return !!e && e.tagName === 'DIV' && e.getAttribute('tabindex') === '-1' && !!e.querySelector('article') })
      record('G-4-19', "keyboard: Enter on 'View in feed' (201 publish) switches to #/feed and puts focus on the feed's list (the results div, tabindex=-1, holding the new card), not <body>", res.status() === 201 && reached && page.url().endsWith('#/feed') && f1 && f1.tag === 'div' && f1.tabindex === '-1' && inList, { status: res.status(), url: page.url(), focus: f1, scrollYBefore: scrollBefore, scrollYAfter: await page.evaluate(() => window.scrollY) })
      await page.keyboard.press('Tab')
      const next = await L.activeInfo(page)
      record('G-4-19', 'from there the next Tab lands inside the list (a control of the first card), so the keyboard user continues where the notice is', next && next.tag === 'button' && /^(Resolve|Withdraw)$/.test(next.text) || (next && next.tag === 'a'), next)
      // mouse variant
      await page.getByRole('tab', { name: /^Publish/ }).click()
      await page.waitForSelector('form')
      await field.title(page).fill('view in feed mouse'); await field.publisher(page).fill('vf4-oncall')
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.getByRole('button', { name: 'View in feed' }).click()
      await page.waitForSelector('article h3:has-text("view in feed mouse")')
      await L.wait(300)
      const f2 = await L.activeInfo(page)
      record('G-4-19', "mouse: clicking 'View in feed' puts focus on the feed's list too", f2 && f2.tag === 'div' && f2.tabindex === '-1', f2)
      // switching tabs by hand does not move focus into the list
      await page.getByRole('tab', { name: /^Publish/ }).click(); await page.waitForSelector('form')
      await page.getByRole('tab', { name: /^Feed/ }).click()
      await page.waitForSelector('article'); await L.wait(300)
      const f3 = await L.activeInfo(page)
      await page.getByRole('tab', { name: /^Feed/ }).focus(); await page.keyboard.press('ArrowRight'); await page.waitForSelector('form'); await page.keyboard.press('ArrowLeft'); await page.waitForSelector('article'); await L.wait(300)
      const f4 = await L.activeInfo(page)
      record('G-4-19', 'switching to the Feed tab by hand (mouse click, or arrow keys on the tablist) leaves focus on the tab, not on the list', f3 && f3.role === 'tab' && /Feed/.test(f3.text) && f4 && f4.role === 'tab' && /Feed/.test(f4.text), { mouse: f3, arrows: f4 })
      // browser back after View in feed: hash navigation resets the request
      await page.getByRole('tab', { name: /^Publish/ }).click(); await page.waitForSelector('form')
      await field.title(page).fill('view in feed then back'); await field.publisher(page).fill('vf4-oncall')
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.getByRole('button', { name: 'View in feed' }).click(); await page.waitForSelector('article h3:has-text("view in feed then back")')
      await page.goBack(); await page.waitForSelector('form'); await page.goForward(); await page.waitForSelector('article'); await L.wait(300)
      const f5 = await L.activeInfo(page)
      record('G-4-19', 'observation: after Back/Forward through the hash the feed does not grab focus (the hashchange resets the request)', true, f5)
      record('G-4-19', 'no page errors', page.cap.errors.length === 0, page.cap.errors)
      await context.close()
    }

    // ---------------- G-4-20: Escape cancels the confirmation ----------------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('esc')
      const a = await api('POST', '/v1/communications', publishBody(tenant, { title: 'escape active' }))
      const m = await api('POST', '/v1/communications', publishBody(tenant, { title: 'escape scheduled', type: 'MAINTENANCE', severity: 'INFO', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() }))
      await L.gotoFeed(page, tenant, { allTypes: true })
      await page.waitForSelector('article h3:has-text("escape scheduled")')
      const results = []
      for (const [title, verb] of [['escape active', 'Resolve'], ['escape scheduled', 'Withdraw']]) {
        const card = L.cardByTitle(page, title)
        for (const from of ['note', 'Cancel', 'confirm']) {
          await card.getByRole('button', { name: verb }).focus()
          await page.keyboard.press('Enter')
          await card.locator('[role="group"]').waitFor()
          if (from === 'note') await page.keyboard.type('typed then escaped')
          if (from === 'Cancel') await card.getByRole('button', { name: 'Cancel' }).focus()
          if (from === 'confirm') await card.locator('button[id$="-confirm"]').focus()
          const at = await L.activeInfo(page)
          await page.keyboard.press('Escape')
          await L.wait(200)
          const after = await L.activeInfo(page)
          results.push({ verb, from, focusedBefore: at && (at.id || at.text), group: await card.locator('[role="group"]').count(), focus: after && { id: after.id, text: after.text }, cards: await L.cardByTitle(page, title).count() })
        }
      }
      // mouse open, then Escape (focus is put in the note by the opening)
      const card = L.cardByTitle(page, 'escape active')
      await card.getByRole('button', { name: 'Resolve' }).click(); await card.locator('[role="group"]').waitFor()
      await page.keyboard.press('Escape'); await L.wait(200)
      const mouse = { group: await card.locator('[role="group"]').count(), focus: await L.activeInfo(page) }
      const posts = page.cap.requests.filter((r) => r.method === 'POST').length
      log(`Escape: ${JSON.stringify(results)} mouse ${JSON.stringify({ group: mouse.group, focus: mouse.focus && mouse.focus.id })}; POSTs ${posts}`)
      record('G-4-20', 'Escape from the note field, Cancel or the confirm button closes the Resolve and the Withdraw confirmation and focus returns to the Resolve / Withdraw button; the card stays', a.status === 201 && m.status === 201 && results.length === 6 && results.every((r) => r.group === 0 && r.focus && /-action$/.test(r.focus.id || '') && r.focus.text === r.verb && r.cards === 1), results)
      record('G-4-20', 'after a mouse click on Resolve (focus moved into the note), Escape cancels too; no retire call was sent by any Escape', mouse.group === 0 && mouse.focus && /-action$/.test(mouse.focus.id || '') && posts === 0, { mouse, retirePosts: posts })
      await card.getByRole('button', { name: 'Resolve' }).focus(); await page.keyboard.press('Enter'); await card.locator('[role="group"]').waitFor()
      const noteKept = await card.locator('input[id$="-note"]').inputValue()
      record('G-4-20', 'observation: what the note holds when the confirmation is opened again after an Escape', true, { noteOnReopen: noteKept })
      await page.keyboard.press('Escape')
      await context.close()
    }

    // ---------------- G-4-21: the service's suggestion ----------------
    {
      const tenant = T('g421')
      const R = `vf4-ref-${RUN}`
      const s1 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'holds R', externalRef: R }))
      const s2 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'holds R-2', externalRef: `${R}-2` }))
      const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 900 } })
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      const r409 = await uiPublish(page, { title: 'reuses R', ref: R })
      await L.banner(page).waitFor({ timeout: 8000 })
      const b1 = await visible(L.banner(page))
      const said1 = r409.json && r409.json.error
      log(`409 for R: ${JSON.stringify(r409.json)}`)
      record('G-4-21', "R and R-2 taken: the real 409 carries suggestedExternalRef R-3 beside error, and the banner offers R-3 (the service's value; the old local count would have said R-2)", s1.status === 201 && s2.status === 201 && r409.status === 409 && r409.json.suggestedExternalRef === `${R}-3` && b1 === `The service rejected this. ${R} is already the External reference of a notice in tenant ${tenant}. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as ${R}-3. What the service said`, { status: r409.status, body: r409.json, banner: b1 })
      await L.banner(page).locator('summary').click()
      const opened = await visible(L.banner(page))
      record('G-4-21', "the service's own sentence (it names the free value too) is under 'What the service said'", opened.includes(said1) && /for example .*-3, which is still free/.test(said1), { said: said1 })
      const accept = await uiPublish(page, { title: 'follow-up with the suggested value', ref: `${R}-3` })
      record('G-4-21', 'the suggested value is accepted: publishing with R-3 → 201', accept.status === 201 && accept.json.externalRef === `${R}-3`, { status: accept.status, externalRef: accept.json && accept.json.externalRef })
      // the ticket number as the reference
      await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForSelector('form')
      const INC = `INC${String(Date.now()).slice(-7)}`
      const t1 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'holds the incident', ticket: { number: INC } }))
      const t2 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'holds the incident -2', externalRef: `${INC}-2` }))
      const r409b = await uiPublish(page, { title: 'reuses the incident', ticket: INC.toLowerCase() })
      await L.banner(page).waitFor({ timeout: 8000 })
      const b2 = await visible(L.banner(page))
      record('G-4-21', "a ServiceNow number doubling as the reference (INC-2 taken as well): the banner offers the service's INC…-3 in the incident wording", t1.status === 201 && t2.status === 201 && r409b.status === 409 && r409b.json.suggestedExternalRef === `${INC}-3` && b2 === `The service rejected this. ${INC} is already the reference of a notice in tenant ${tenant} (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as ${INC}-3. What the service said`, { body: r409b.json, banner: b2 })
      // all 50 follow-up values taken
      const runFull = async (FULL, label) => {
        const seeded = []
        seeded.push((await api('POST', '/v1/communications', publishBody(tenant, { title: `${label} base`, externalRef: FULL }))).status)
        for (let n = 2; n <= 51; n++) seeded.push((await api('POST', '/v1/communications', publishBody(tenant, { title: `${label} ${n}`, externalRef: `${FULL}-${n}` }))).status)
        await field.ticket(page).fill('')
        const r = await uiPublish(page, { title: `${label} reuse`, ref: FULL })
        await L.banner(page).waitFor({ timeout: 8000 })
        await L.wait(200)
        // the same banner element may still have its <details> open from the previous 409: read the closed state
        await L.banner(page).locator('details').evaluate((d) => { d.open = false })
        const text = await visible(L.banner(page))
        const focus = await L.activeInfo(page)
        await L.banner(page).locator('summary').click()
        const openedText = await visible(L.banner(page))
        return { seeded201: seeded.filter((s) => s === 201).length, status: r.status, body: r.json, banner: text, focus, details: openedText }
      }
      const FULL = `vf4-full-${RUN}`
      const full = await runFull(FULL, 'full')
      log(`all 50 taken: ${JSON.stringify({ status: full.status, body: full.body, banner: full.banner })}`)
      record('G-4-21', "all 50 follow-up values taken (R-2 … R-51 seeded through the API): the real 409 has no suggestedExternalRef and the banner suggests nothing, quoting the service's '(R-2 to R-51 are taken as well)'; the banner has focus and the service's sentence is in the details", full.seeded201 === 51 && full.status === 409 && full.body && !('suggestedExternalRef' in full.body) && full.banner === `The service rejected this. ${FULL} is already the External reference of a notice in tenant ${tenant}. References are permanent, even after a notice is retired, so a follow-up needs another External reference (${FULL}-2 to ${FULL}-51 are taken as well). What the service said` && full.focus && full.focus.role === 'alert' && full.details.includes(full.body.error), full)
      await axe(page, '409 banner with no suggestion, details open (light)')
      await L.shot(page, 'g4-409-none-free')
      // edge: parentheses in the reference
      const PAREN = `vf4 (eu) ${RUN}`
      const paren = await runFull(PAREN, 'paren')
      log(`all 50 taken, reference with parentheses: ${JSON.stringify({ status: paren.status, body: paren.body, banner: paren.banner })}`)
      record('G-4-21', "edge: a reference that contains parentheses ('vf4 (eu) <run>') with all 50 follow-ups taken: the banner should suggest nothing either (the service sends no suggestion)", paren.seeded201 === 51 && paren.status === 409 && !('suggestedExternalRef' in (paren.body || {})) && !/such as/.test(paren.banner) && paren.banner.includes('are taken as well'), { banner: paren.banner, body: paren.body })
      record('G-4-21', 'no page errors', page.cap.errors.length === 0, page.cap.errors)
      await context.close()
    }
  } catch (e) { log('SCRIPT ERROR ' + (e.stack || e)); process.exitCode = 1 } finally {
    fs.writeFileSync(`${__dirname}/../results/g4-focus-409-timeline.txt`, tl.join('\n') + '\n')
    await browser.close(); L.flush()
  }
})()
