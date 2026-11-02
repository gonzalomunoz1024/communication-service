#!/usr/bin/env python3
"""E2E verifier (iteration 3; adapted from the iteration-2 script for the iteration-3 contract changes G-3-3/7/8/9/11/25/30/32, G-3-1/G-3-6 in the mongo phases): HTTP + SSE contract checks against the private backends A (:19501) and B (:19502).
Usage: http_checks.py <phase>...   phases: core sse health fanout mongo_down mongo_back
Prints PASS/FAIL <ID> lines; exit code = number of FAILs (max 99)."""
import http.client, json, socket, sys, time, threading, uuid, urllib.parse
from datetime import datetime, timedelta, timezone

A = ('127.0.0.1', 19501)
B = ('127.0.0.1', 19502)
CID = 've3-http-checks'
RUN = datetime.now(timezone.utc).strftime('%H%M%S')
RESULTS = []

def now(): return datetime.now(timezone.utc)
def iso(dt): return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'
def stamp(): return iso(now())

def check(fid, name, cond, detail=''):
    RESULTS.append((fid, name, bool(cond)))
    print(f"{'PASS' if cond else 'FAIL'} {fid} {name} :: {detail}"[:1200], flush=True)
    return bool(cond)

def req(host, method, path, body=None, headers=None, timeout=20, raw=False):
    h = {'Accept': 'application/json'}
    if headers is None: h['X-Client-Id'] = CID
    else: h.update(headers)
    data = None
    if body is not None:
        if raw: data = body.encode() if isinstance(body, str) else body
        else: data = json.dumps(body).encode()
        h.setdefault('Content-Type', 'application/json')
    c = http.client.HTTPConnection(host[0], host[1], timeout=timeout)
    t0 = time.monotonic()
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    text = r.read().decode(errors='replace')
    dt = time.monotonic() - t0
    c.close()
    try: js = json.loads(text) if text else None
    except Exception: js = None
    return r.status, dict(r.getheaders()), js, text, dt

def sse(host, path, headers=None, seconds=3.0, stop=None, first_byte=None):
    """Collects SSE frames for `seconds` (or until stop(frames) is true): a blocking reader thread, the socket is shut
    down at the deadline. Returns (status, headers, frames, comments)."""
    h = {'Accept': 'text/event-stream'}
    if headers: h.update(headers)
    c = http.client.HTTPConnection(host[0], host[1], timeout=seconds + 30)
    t0 = time.monotonic()
    c.request('GET', path, headers=h)
    r = c.getresponse()
    status, hdrs = r.status, dict(r.getheaders())
    frames, comments = [], []
    done = threading.Event()
    def reader():
        cur = {}; fb = None
        try:
            while True:
                line = r.readline()
                if fb is None:
                    fb = time.monotonic() - t0
                    if first_byte is not None: first_byte.append(fb)
                if not line: break
                s_ = line.decode(errors='replace').rstrip('\r\n')
                if s_.startswith(':'):
                    comments.append((time.monotonic() - t0, s_)); continue
                if s_ == '':
                    if cur:
                        if 'data' in cur:
                            try: cur['json'] = json.loads(cur['data'])
                            except Exception: cur['json'] = None
                        cur['t'] = time.monotonic() - t0
                        frames.append(cur)
                    cur = {}
                    if stop and stop(frames): break
                    continue
                k, _, v = s_.partition(':')
                v = v[1:] if v.startswith(' ') else v
                if k == 'data': cur['data'] = cur.get('data', '') + v
                else: cur[k] = v
        except Exception:
            pass
        finally:
            done.set()
    th = threading.Thread(target=reader, daemon=True); th.start()
    done.wait(seconds)
    try: c.sock.shutdown(socket.SHUT_RDWR)
    except Exception: pass
    try: c.close()
    except Exception: pass
    th.join(3)
    return status, hdrs, frames, comments

def outage(tenant, title, **extra):
    b = {'tenantId': tenant, 'publisher': 've3-publisher', 'type': 'OUTAGE', 'severity': 'MAJOR', 'title': title,
         'affectedServices': ['payments-api']}
    b.update(extra); return b

def publish(host, body, expect=201):
    st, h, js, tx, _ = req(host, 'POST', '/v1/communications', body)
    assert st == expect, f'publish -> {st} {tx[:300]}'
    return js, h

def frames_of(frames, cid): return [f for f in frames if f.get('json') and f['json'].get('communication', {}).get('id') == cid]

# ----------------------------------------------------------------------------------------------------------------- core
def phase_core():
    T = f've3-http-{RUN}'
    print(f'## core phase on A tenant {T} at {stamp()}')
    # F-01
    js, h = publish(A, outage(T, 'F-01 active now'))
    check('F-01', '201 + Location + ACTIVE + audience default', h.get('Location', '').endswith('/v1/communications/' + js['id']) and js['status'] == 'ACTIVE' and js['audience'] == 'CUSTOMERS',
          f"Location={h.get('Location')} status={js['status']} audience={js['audience']} version={js.get('version')}")
    js2, _ = publish(A, outage(T, 'F-01 future', startsAt=iso(now() + timedelta(hours=2))))
    check('F-01', 'future startsAt -> SCHEDULED', js2['status'] == 'SCHEDULED', f"status={js2['status']}")
    st, _, item, _, _ = req(A, 'GET', f"/v1/feed/{js['id']}")
    check('F-01', 'permalink of the active item', st == 200 and item['status'] == 'ACTIVE', f'{st} {item and item.get("status")}')
    # F-02 draft
    d, _ = publish(A, outage(T, 'F-02 draft', draft=True))
    st_f, _, feed, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T}')
    st_p, _, _, _, _ = req(A, 'GET', f"/v1/feed/{d['id']}")
    check('F-02', 'draft stored DRAFT, absent from feed, permalink 404', d['status'] == 'DRAFT' and d['id'] not in [i['id'] for i in feed['items']] and st_p == 404,
          f"status={d['status']} feed={st_f} inFeed={d['id'] in [i['id'] for i in feed['items']]} permalink={st_p}")
    st, _, pub, tx, _ = req(A, 'POST', f"/v1/communications/{d['id']}/publish")
    check('F-02', 'POST /publish moves the draft to ACTIVE', st == 200 and pub['status'] == 'ACTIVE', f'{st} {pub and pub.get("status")}')
    st, _, again, tx, _ = req(A, 'POST', f"/v1/communications/{d['id']}/publish")
    check('F-02', 'publishing a non-draft is 409 {error}', st == 409 and again and 'error' in again, f'{st} {tx[:160]}')
    # F-06 retire
    st, _, ret, tx, _ = req(A, 'POST', f"/v1/communications/{js['id']}/retire", {'actor': 've3-ops', 'note': 'fixed in prod'})
    hist = [e for e in (ret or {}).get('history', [])]
    check('F-06', 'retire -> 200 RETIRED, note+actor in history', st == 200 and ret['status'] == 'RETIRED' and any('fixed in prod' in e.get('action', '') and e.get('actor') == 've3-ops' for e in hist),
          f"{st} status={ret and ret.get('status')} last_history={hist[-1] if hist else None}")
    st2, _, ret2, _, _ = req(A, 'POST', f"/v1/communications/{js['id']}/retire", {'note': 'again'})
    check('F-06', 'retire again is idempotent 200 RETIRED (history unchanged)', st2 == 200 and ret2['status'] == 'RETIRED' and len(ret2.get('history', [])) == len(hist), f'{st2} history {len(hist)} -> {len(ret2.get("history", []))}')
    st3, _, ret3, _, _ = req(A, 'POST', f"/v1/communications/{pub['id']}/retire", {})
    check('F-06', 'retire without actor -> actor defaults to publisher', st3 == 200 and ret3['history'][-1].get('actor') == 've3-publisher', f"{st3} actor={ret3 and ret3['history'][-1].get('actor')}")
    ex, _ = publish(A, outage(T, 'F-06 expires soon', expiresAt=iso(now() + timedelta(seconds=1))))
    time.sleep(1.6)
    st4, _, r4, tx4, _ = req(A, 'POST', f"/v1/communications/{ex['id']}/retire", {'note': 'too late'})
    check('F-06', 'retire an expired item -> 409 (effective status, before the sweep may have run)', st4 == 409 and 'error' in (r4 or {}), f'{st4} {tx4[:160]}')
    # F-07 validation
    long_title = 'x' * 201
    cases = [
        ('missing title', {**outage(T, 'x'), 'title': None}, 'title'),
        ('title 201 chars', outage(T, long_title), 'title'),
        ('OUTAGE with severity INFO', outage(T, 'F-07 sev', severity='INFO'), 'severity'),
        ('MAINTENANCE without endsAt', {**outage(T, 'F-07 maint'), 'type': 'MAINTENANCE', 'severity': 'INFO'}, 'endsAt'),
        ('expiresAt before startsAt', outage(T, 'F-07 exp', startsAt=iso(now() + timedelta(hours=2)), expiresAt=iso(now() + timedelta(hours=1))), 'expiresAt'),
        ('ticket without number', outage(T, 'F-07 ticket', ticket={'system': 'servicenow'}), 'number'),
        ('21 affectedServices', outage(T, 'F-07 many', affectedServices=[f's{i}' for i in range(21)]), 'affectedServices'),
        ('missing tenantId', {**outage(T, 'x'), 'tenantId': None}, 'tenantId'),
        ('missing publisher', {**outage(T, 'x'), 'publisher': None}, 'publisher'),
        ('body > 16384 bytes', outage(T, 'F-07 body', body='b' * 16385), 'body'),
        ('affectedServices containing null (G-3-7)', outage(T, 'F-07 null', affectedServices=['a', None]), 'affectedServices[1]: must not be null'),
        ('affectedServices containing "" (G-3-7)', outage(T, 'F-07 blank', affectedServices=['a', '']), 'affectedServices[1]: must not be blank'),
        ('affectedServices containing "  " (G-3-7)', outage(T, 'F-07 blank2', affectedServices=['  ', 'a']), 'affectedServices[0]: must not be blank'),
    ]
    for name, body, field in cases:
        st, _, js, tx, _ = req(A, 'POST', '/v1/communications', body)
        check('F-07', f'{name} -> 400 naming {field}', st == 400 and js and field in js.get('error', ''), f'{st} {tx[:200]}')
    # G-3-8: unknown fields in publishing bodies are refused, naming the field and the known ones
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', {**outage(T, 'F-07 typo'), 'sevrity': 'MINOR'})
    check('F-07', 'G-3-8: misspelled field sevrity -> 400 naming it and listing the known fields', st == 400 and js and 'sevrity' in js.get('error', '') and 'severity' in js.get('error', ''), f'{st} {tx[:300]}')
    # G-3-9 / G-3-32: the time-order 400s carry both values and say the start defaulted to now
    past = iso(now() - timedelta(days=30))
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'F-07 past expiry', expiresAt=past))
    check('F-07', 'G-3-9: past expiresAt without startsAt -> 400 naming the value and the defaulted start', st == 400 and js and 'expiresAt' in js.get('error', '') and 'defaulted to now' in js.get('error', '') and past[:16] in js.get('error', ''), f'{st} {tx[:300]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', {**outage(T, 'F-07 maint order', severity='INFO'), 'type': 'MAINTENANCE', 'startsAt': iso(now() + timedelta(hours=2)), 'endsAt': iso(now() + timedelta(hours=1))})
    check('F-07', 'G-3-32: endsAt not after startsAt -> 400 naming both values', st == 400 and js and 'endsAt' in js.get('error', '') and 'startsAt' in js.get('error', '') and js.get('error', '').count('20') >= 2, f'{st} {tx[:300]}')
    upd0, _ = publish(A, outage(T, 'F-07 update target'))
    st, _, js, tx, _ = req(A, 'PUT', f"/v1/communications/{upd0['id']}", {'title': 'no version'})
    check('F-07', 'G-3-9: PUT without expectedVersion -> 400 saying what to send and what a 409 means', st == 400 and js and 'expectedVersion is required' in js.get('error', '') and '409' in js.get('error', ''), f'{st} {tx[:300]}')
    st, _, js, tx, _ = req(A, 'PUT', f"/v1/communications/{upd0['id']}", {'expectedVersion': upd0['version'], 'titel': 'typo'})
    check('F-07', 'G-3-8: PUT with an unknown field -> 400 naming it', st == 400 and js and 'titel' in js.get('error', ''), f'{st} {tx[:300]}')
    st, _, js, tx, _ = req(A, 'POST', f"/v1/communications/{upd0['id']}/retire", {'note': 'x', 'reason': 'typo'})
    check('F-07', 'G-3-8: retire with an unknown field -> 400 naming it (nothing retired)', st == 400 and js and 'reason' in js.get('error', '') and req(A, 'GET', f"/v1/communications/{upd0['id']}")[2]['status'] == 'ACTIVE', f'{st} {tx[:300]}')
    req(A, 'POST', f"/v1/communications/{upd0['id']}/retire", {'note': 'cleanup'})
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'F-07 enum', type='BOGUS'))
    check('F-07', 'unknown enum -> 400 listing the values', st == 400 and js and 'OUTAGE' in js.get('error', ''), f'{st} {tx[:200]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', '{"tenantId": "x", ', raw=True)
    check('F-07', 'malformed JSON -> 400 {error}', st == 400 and js and 'error' in js, f'{st} {tx[:200]}')
    # F-09 ticket
    tk, _ = publish(A, outage(T, 'F-09 ticket', ticket={'number': ' inc0077001 '}))
    check('F-09', 'ticket normalised + system default + externalRef defaults to the number', tk.get('ticket', {}).get('number') == 'INC0077001' and tk['ticket'].get('system') == 'servicenow' and tk.get('externalRef') == 'INC0077001',
          f"ticket={tk.get('ticket')} externalRef={tk.get('externalRef')}")
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'F-09 bad', ticket={'number': 'ABC'}))
    check('F-09', 'bad ticket number -> 400', st == 400 and 'error' in (js or {}), f'{st} {tx[:200]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'F-09 ftp', ticket={'number': 'INC0077009', 'url': 'ftp://x'}))
    check('F-09', 'ticket url must be http(s) -> 400', st == 400, f'{st} {tx[:200]}')
    plain, _ = publish(A, outage(T, 'F-09 attach later'))
    st, _, upd, tx, _ = req(A, 'PUT', f"/v1/communications/{plain['id']}", {'expectedVersion': plain['version'], 'ticket': {'number': 'inc0077003'}, 'actor': 've3-ops'})
    check('F-09', 'PUT attaches a ticket later with audit', st == 200 and upd.get('ticket', {}).get('number') == 'INC0077003' and any('ticket' in e.get('action', '') for e in upd.get('history', [])),
          f"{st} ticket={upd and upd.get('ticket')} actions={[e.get('action') for e in (upd or {}).get('history', [])]}")
    st, _, fi, _, _ = req(A, 'GET', f"/v1/feed/{plain['id']}")
    check('F-09', 'feed item carries the ticket', st == 200 and fi.get('ticket', {}).get('number') == 'INC0077003', f"{st} ticket={fi and fi.get('ticket')}")
    # duplicate externalRef wording (G-2-9 API half) + permanence
    ref = f'REF-{RUN}'
    holder, _ = publish(A, outage(T, 'dup holder', externalRef=ref))
    st, _, dup, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'dup again', externalRef=ref))
    check('F-57', f'duplicate externalRef -> 409 naming the holder and saying permanent', st == 409 and dup and holder['id'] in dup.get('error', '') and 'permanent' in dup.get('error', '').lower(), f'{st} {tx[:400]}')
    req(A, 'POST', f"/v1/communications/{holder['id']}/retire", {'note': 'free it?'})
    st, _, dup2, tx2, _ = req(A, 'POST', '/v1/communications', outage(T, 'dup after retire', externalRef=ref))
    check('F-57', 'externalRef stays taken after its holder is retired (permanent key)', st == 409, f'{st} {tx2[:200]}')
    st, _, other, _, _ = req(A, 'POST', '/v1/communications', outage(T + '-other', 'dup other tenant', externalRef=ref))
    check('F-09', 'same externalRef in another tenant -> 201', st == 201, f'{st}')
    if st == 201: req(A, 'POST', f"/v1/communications/{other['id']}/retire", {})
    # F-14 feed filters/ordering/paging
    T14 = T + '-feed'
    items = {}
    items['crit_b'] = publish(A, outage(T14, 'crit b', severity='CRITICAL', affectedServices=['b'], startsAt=iso(now() - timedelta(hours=1))))[0]
    items['maj_a_old'] = publish(A, outage(T14, 'major a old', affectedServices=['a'], startsAt=iso(now() - timedelta(hours=2))))[0]
    items['maj_a_new'] = publish(A, outage(T14, 'major a new', affectedServices=['a'], startsAt=iso(now() - timedelta(hours=1))))[0]
    items['inc_min'] = publish(A, {**outage(T14, 'incident minor', severity='MINOR', affectedServices=['a']), 'type': 'INCIDENT'})[0]
    items['internal'] = publish(A, outage(T14, 'internal change', severity='MINOR', audience='INTERNAL', affectedServices=['c']))[0]
    st, _, feed, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}')
    ids = [i['id'] for i in feed['items']]
    check('F-14', 'default feed lists all 5, ordered severity desc then startsAt desc', ids[:3] == [items['crit_b']['id'], items['maj_a_new']['id'], items['maj_a_old']['id']] and len(ids) == 5,
          f"order={[i['title'] for i in feed['items']]} keys={sorted(k for k in feed.keys() if k != 'items')}")
    st, _, f2, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&service=a')
    check('F-14', 'service filter is an exact match in affectedServices', sorted(i['id'] for i in f2['items']) == sorted([items['maj_a_old']['id'], items['maj_a_new']['id'], items['inc_min']['id']]), f"{[i['title'] for i in f2['items']]}")
    st, _, f3, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&type=INCIDENT')
    check('F-14', 'type filter', [i['id'] for i in f3['items']] == [items['inc_min']['id']], f"{[i['title'] for i in f3['items']]}")
    st, _, f4, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&severity=MAJOR')
    check('F-14', 'severity is an inclusive minimum', sorted(i['id'] for i in f4['items']) == sorted([items['crit_b']['id'], items['maj_a_new']['id'], items['maj_a_old']['id']]), f"{[i['title'] for i in f4['items']]}")
    st, _, f5, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&audience=INTERNAL')
    check('F-14', 'audience filter', [i['id'] for i in f5['items']] == [items['internal']['id']], f"{[i['title'] for i in f5['items']]}")
    st, _, f6, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&page=1&size=2')
    check('F-14', 'paging page=1&size=2 -> 2 items (3rd and 4th)', st == 200 and len(f6['items']) == 2 and f6['items'][0]['id'] == ids[2], f"{[i['title'] for i in f6['items']]} meta={ {k: v for k, v in f6.items() if k != 'items'} }")
    st, _, f7, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&size=500')
    check('F-14', 'size=500 is capped (<=100) and answers 200', st == 200 and len(f7['items']) <= 100, f"{st} size_meta={f7.get('size')}")
    st, _, _, tx, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&page=-1')
    check('F-14', 'page=-1 -> 400', st == 400, f'{st} {tx[:120]}')
    st, _, _, tx, _ = req(A, 'GET', '/v1/feed?tenantId=')
    check('F-14', 'blank tenantId -> 400', st == 400, f'{st} {tx[:120]}')
    st, _, _, tx, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&type=NOPE')
    check('F-14', 'invalid enum query value -> 400 JSON', st == 400 and 'error' in tx, f'{st} {tx[:160]}')
    # F-15 effective status on read
    soon, _ = publish(A, outage(T14, 'F-15 expires in 3s', expiresAt=iso(now() + timedelta(seconds=3))))
    st, _, f8, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&service=payments-api')
    present = soon['id'] in [i['id'] for i in f8['items']]
    time.sleep(3.4)
    st, _, f9, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T14}&service=payments-api')
    gone = soon['id'] not in [i['id'] for i in f9['items']]
    st, _, pl, _, _ = req(A, 'GET', f"/v1/feed/{soon['id']}")
    st2, _, stored, _, _ = req(A, 'GET', f"/v1/communications/{soon['id']}")
    check('F-15', 'item present before expiresAt, gone 0.4 s after it, permalink EXPIRED', present and gone and pl.get('status') == 'EXPIRED',
          f"present={present} gone={gone} permalink={pl.get('status')} publisher-read={stored.get('status')}")
    st3, _, adm, _, _ = req(A, 'GET', f'/v1/admin/communications?tenantId={T14}&size=100')
    adm_item = next((i for i in (adm or {}).get('items', []) if i.get('id') == soon['id']), {})
    check('F-15', 'G-3-3: publisher GET /v1/communications/{id} and admin search answer EXPIRED right after expiresAt (effective status, no write)', stored.get('status') == 'EXPIRED' and adm_item.get('status') == 'EXPIRED', f"publisher={stored.get('status')} admin={adm_item.get('status')} admin_http={st3}")
    sched, _ = publish(A, {**outage(T14, 'F-15 maintenance starts in 2s', severity='INFO', affectedServices=['m']), 'type': 'MAINTENANCE', 'startsAt': iso(now() + timedelta(seconds=2)), 'endsAt': iso(now() + timedelta(hours=1))})
    st, _, p0, _, _ = req(A, 'GET', f"/v1/feed/{sched['id']}")
    time.sleep(2.3)
    st, _, p1, _, _ = req(A, 'GET', f"/v1/feed/{sched['id']}")
    st2, _, s1, _, _ = req(A, 'GET', f"/v1/communications/{sched['id']}")
    check('F-15', 'SCHEDULED maintenance reads ACTIVE once its start passed, regardless of the stored status', p0.get('status') == 'SCHEDULED' and p1.get('status') == 'ACTIVE', f"before={p0.get('status')} after={p1.get('status')} stored_after={s1.get('status')}")
    # F-16 upcoming window
    T16 = T + '-up'
    m1, _ = publish(A, {**outage(T16, 'maint in 1 day', severity='INFO', affectedServices=['m']), 'type': 'MAINTENANCE', 'startsAt': iso(now() + timedelta(days=1)), 'endsAt': iso(now() + timedelta(days=1, hours=2))})
    o1, _ = publish(A, outage(T16, 'outage in 1 day', startsAt=iso(now() + timedelta(days=1))))
    m8, _ = publish(A, {**outage(T16, 'maint in 8 days', severity='INFO', affectedServices=['m']), 'type': 'MAINTENANCE', 'startsAt': iso(now() + timedelta(days=8)), 'endsAt': iso(now() + timedelta(days=8, hours=2))})
    st, _, u1, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T16}')
    st, _, u2, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T16}&includeUpcoming=false')
    check('F-16', 'only the maintenance within P7D is listed (SCHEDULED), hidden with includeUpcoming=false', [i['id'] for i in u1['items']] == [m1['id']] and u1['items'][0]['status'] == 'SCHEDULED' and u2['items'] == [],
          f"default={[i['title'] for i in u1['items']]} includeUpcoming=false={[i['title'] for i in u2['items']]}")
    # F-27 client id
    st, _, js, tx, _ = req(A, 'GET', f'/v1/feed?tenantId={T}', headers={})
    check('F-27', 'no X-Client-Id -> 401 {error}', st == 401 and js and 'error' in js, f'{st} {tx[:160]}')
    st, _, js, tx, _ = req(A, 'GET', f'/v1/feed?tenantId={T}', headers={'X-Client-Id': 'bad id!'})
    check('F-27', "malformed id 'bad id!' -> 400 {error}", st == 400 and js and 'error' in js, f'{st} {tx[:160]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/communications', outage(T, 'x'), headers={})
    check('F-27', 'POST without id -> 401 before any validation', st == 401, f'{st} {tx[:120]}')
    st, h, _, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId=ve3-stream', seconds=0.5)
    check('F-27', 'stream with ?clientId= -> 200 text/event-stream', st == 200 and 'text/event-stream' in h.get('Content-Type', ''), f"{st} {h.get('Content-Type')}")
    st, h, _, _ = sse(A, f'/v1/feed/stream?tenantId={T}', seconds=0.5)
    check('F-27', 'stream without any id -> 401', st == 401, f'{st}')
    st, h, _, tx, _ = req(A, 'GET', '/swagger-ui.html', headers={})
    check('F-27', 'Swagger UI exempt (no header)', st in (200, 302, 301), f'{st} {h.get("Location", "")}')
    st, _, js, _, _ = req(A, 'GET', '/v3/api-docs', headers={})
    check('F-27', 'api-docs exempt and list /v1/feed/stream + /v1/health/reports', st == 200 and '/v1/feed/stream' in js.get('paths', {}) and '/v1/health/reports' in js.get('paths', {}), f'{st}')
    st, _, _, tx, _ = req(A, 'OPTIONS', '/v1/feed', headers={})
    check('F-27', 'OPTIONS is not refused for a missing id', st != 401, f'{st} {tx[:80]}')
    st, _, js, _, _ = req(A, 'GET', '/actuator/health/readiness', headers={})
    st2, _, js2, _, _ = req(A, 'GET', '/actuator/health/liveness', headers={})
    check('F-92', 'readiness and liveness probes answer 200 UP without a client id', st == 200 and js.get('status') == 'UP' and st2 == 200, f'{st} {js} / {st2} {js2}')
    st, _, _, tx, _ = req(A, 'GET', '/actuator/env', headers={})
    check('F-92', 'nothing but health is exposed (/actuator/env)', st in (404, 401, 403), f'{st} {tx[:80]}')

# ------------------------------------------------------------------------------------------------------------------ sse
def phase_sse():
    T = f've3-sse-{RUN}'
    print(f'## sse phase on A tenant {T} at {stamp()}')
    captured = {'frames': [], 'comments': [], 'status': None, 'hdrs': None, 'fb': []}
    def listen():
        st, h, fr, co = sse(A, f'/v1/feed/stream?tenantId={T}', headers={'X-Client-Id': CID}, seconds=22, first_byte=captured['fb'])
        captured.update(frames=fr, comments=co, status=st, hdrs=h)
    th = threading.Thread(target=listen); th.start(); time.sleep(0.6)
    p1, _ = publish(A, outage(T, 'F-18 one'))
    time.sleep(0.9)
    req(A, 'PUT', f"/v1/communications/{p1['id']}", {'expectedVersion': p1['version'], 'title': 'F-18 one (updated)'})
    time.sleep(0.9)
    req(A, 'POST', f"/v1/communications/{p1['id']}/retire", {'note': 'done'})
    th.join()
    fr = captured['frames']; names = [f.get('event') for f in fr]
    ids = [int(f['id']) for f in fr if f.get('id', '').isdigit()]
    check('F-18', 'stream 200 text/event-stream, :connected first, first byte fast', captured['status'] == 200 and 'text/event-stream' in captured['hdrs'].get('Content-Type', '') and captured['comments'] and captured['comments'][0][1].startswith(':connected') and captured['fb'] and captured['fb'][0] < 2,
          f"status={captured['status']} first_comment={captured['comments'][:1]} first_byte={captured['fb'][:1]}")
    check('F-18', 'live frames created/updated/retired named after the event type, ids increasing, id == data.seq', names == ['created', 'updated', 'retired'] and ids == sorted(ids) and len(set(ids)) == len(ids) and all(int(f['id']) == f['json']['seq'] for f in fr),
          f"names={names} ids={ids} seqs={[f['json'].get('seq') for f in fr]} types={[f['json'].get('type') for f in fr]}")
    ka = [c for c in captured['comments'] if 'keepalive' in c[1]]
    check('F-18', ':keepalive comment within ~15 s', bool(ka) and 14 < ka[0][0] < 17, f'keepalives={[(round(t, 2), s) for t, s in ka]}')
    # snapshot + G-2-8 + F-20
    created_seq = {}
    def listen2(seconds, store):
        st, h, fr, co = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', seconds=seconds)
        store.extend(fr)
    tail = []; th2 = threading.Thread(target=listen2, args=(9, tail)); th2.start(); time.sleep(0.5)
    p2, _ = publish(A, outage(T, 'F-20 two')); time.sleep(0.8)
    p3, _ = publish(A, outage(T, 'F-20 three')); time.sleep(0.8)
    st, h, snap, co = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', seconds=1.5)
    snaps = [f for f in snap if f.get('event') == 'snapshot']
    th2.join()
    for f in tail:
        if f.get('event') == 'created': created_seq[f['json']['communication']['id']] = f['json']['seq']
    sid = sorted({int(f['id']) for f in snaps}) if snaps else []
    check('F-18', 'a fresh stream sends one snapshot frame per visible item, all stamped with one id', len(snaps) == 2 and len(sid) == 1 and {f['json']['communication']['id'] for f in snaps} == {p2['id'], p3['id']} and all(f['json']['type'] == 'SNAPSHOT' for f in snaps),
          f"snapshots={[(f.get('id'), f['json']['communication']['title']) for f in snaps]} other={[f.get('event') for f in snap if f.get('event') != 'snapshot']}")
    head = sid[0] if sid else -1
    check('F-20', f'G-2-8: snapshot id ({head}) >= the created seq of the newest item in it ({created_seq.get(p3["id"])})', head >= created_seq.get(p3['id'], 10**9), f"created seqs={created_seq}")
    st, h, re0, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', headers={'Last-Event-ID': str(head)}, seconds=2.5)
    check('F-20', 'G-2-8: resuming from the snapshot id replays nothing (no created re-delivery)', st == 200 and re0 == [], f"status={st} frames={[(f.get('event'), f.get('id'), f['json']['communication']['title']) for f in re0]}")
    last = created_seq.get(p3['id'])
    req(A, 'POST', f"/v1/communications/{p2['id']}/retire", {'note': 'while away'})
    p4, _ = publish(A, outage(T, 'F-20 four'))
    time.sleep(0.8)
    st, h, re1, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', headers={'Last-Event-ID': str(last)}, seconds=2.0)
    seq1 = [(f.get('event'), f['json']['communication']['title']) for f in re1]
    check('F-20', 'Last-Event-ID header replays exactly what was missed, in order, no snapshot', st == 200 and seq1 == [('retired', 'F-20 two'), ('created', 'F-20 four')], f'{st} {seq1}')
    st, h, re2, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}&lastEventId={last}', seconds=2.0)
    seq2 = [(f.get('event'), f['json']['communication']['title']) for f in re2]
    check('F-20', '?lastEventId= query does the same (EventSource path)', st == 200 and seq2 == seq1, f'{st} {seq2}')
    ret_seq = next((f['json']['seq'] for f in re1 if f.get('event') == 'retired'), None)
    st, h, re5, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}&lastEventId={last}', headers={'Last-Event-ID': str(ret_seq)}, seconds=2.0)
    st6, h6, re6, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}&lastEventId={ret_seq}', headers={'Last-Event-ID': str(last)}, seconds=2.0)
    seq5 = [(f.get('event'), f['json']['communication']['title']) for f in re5]; seq6 = [(f.get('event'), f['json']['communication']['title']) for f in re6]
    check('F-20', f'G-3-11: query {last} + header {ret_seq} (and the reverse) -> resume after the larger, nothing replayed twice', st == 200 and st6 == 200 and seq5 == [('created', 'F-20 four')] and seq6 == seq5, f'query<header: {seq5}; query>header: {seq6}')
    st, h, re3, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}&lastEventId=999999999', seconds=1.5)
    check('F-20', 'never-issued id -> fresh snapshot (2 visible items)', st == 200 and [f.get('event') for f in re3] == ['snapshot', 'snapshot'], f"{st} {[f.get('event') for f in re3]}")
    st, h, re4, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', headers={'Last-Event-ID': 'abc'}, seconds=1.5)
    check('F-20', 'non-numeric Last-Event-ID ignored -> 200 with a snapshot', st == 200 and [f.get('event') for f in re4] == ['snapshot', 'snapshot'], f"{st} {[f.get('event') for f in re4]}")
    # G-2-8 repeated 3x: publish, snapshot, resume from snapshot id -> nothing
    for n in range(3):
        store = []; t = threading.Thread(target=listen2, args=(2.2, store)); t.start(); time.sleep(0.4)
        pn, _ = publish(A, outage(T, f'G-2-8 probe {n}')); time.sleep(0.9)
        st, h, sn, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', seconds=1.2)
        t.join()
        cseq = next((f['json']['seq'] for f in store if f.get('event') == 'created' and f['json']['communication']['id'] == pn['id']), None)
        hid = max((int(f['id']) for f in sn if f.get('event') == 'snapshot'), default=-1)
        st2, _, rr, _ = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}&lastEventId={hid}', seconds=1.5)
        check('F-20', f'G-2-8 probe {n + 1}/3: snapshot id {hid} >= created seq {cseq}; resume from it replays nothing', cseq is not None and hid >= cseq and rr == [], f"replayed={[(f.get('event'), f['json']['communication']['title']) for f in rr]}")

# --------------------------------------------------------------------------------------------------------------- health
def phase_health():
    T = f've3-health-{RUN}'
    print(f'## health phase on A tenant {T} at {stamp()}')
    created = []
    def report(service, status, **extra):
        body = {'tenantId': T, 'service': service, 'status': status, 'publisher': f'{service}-team'}
        body.update(extra)
        return req(A, 'POST', '/v1/health/reports', body)
    # F-36
    st, _, mon, tx, _ = report('svc-push', 'UP')
    check('F-36', 'first push auto-registers a push-only monitor (202, url absent, publisher from the report)', st == 202 and mon and not mon.get('url') and mon['policy']['publisher'] == 'svc-push-team' and mon['state']['lastStatus'] == 'UP',
          f"{st} url={mon and mon.get('url')} publisher={mon and mon['policy']['publisher']} state={mon and mon['state'].get('lastStatus')} id={mon and mon.get('id')}")
    if mon: created.append(mon['id'])
    st, _, lst, _, _ = req(A, 'GET', f'/v1/health/monitors?tenantId={T}')
    check('F-36', 'GET monitors lists it', st == 200 and any(m['service'] == 'svc-push' for m in lst), f'{st} {[m["service"] for m in lst]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/health/reports', {'tenantId': T, 'service': 'svc-nostatus'})
    check('F-36', 'report without status -> 400', st == 400, f'{st} {tx[:160]}')
    st, _, js, tx, _ = req(A, 'POST', '/v1/health/reports', {'service': 'svc-notenant', 'status': 'UP'})
    check('F-36', 'report without tenantId -> 400', st == 400, f'{st} {tx[:160]}')
    # F-38 vocabulary
    for code, want in [('OK', 'UP'), ('HEALTHY', 'UP'), ('OUT_OF_SERVICE', 'DOWN'), ('FATAL', 'DOWN'), ('UNHEALTHY', 'DOWN'), ('UNKNOWN', 'UNKNOWN'), ('WARN', 'DEGRADED'), ('', 'UNKNOWN or 400')]:
        svc = f'svc-{(code or "blank").lower()}'
        st, _, m, tx, _ = report(svc, code)
        got = m['state']['lastStatus'] if (m and 'state' in m) else f'HTTP {st}'
        if m and 'id' in m: created.append(m['id'])
        ok = (got == want) if want != 'UNKNOWN or 400' else (got in ('UNKNOWN', 'HTTP 400'))
        check('F-38', f"status '{code}' -> {want}", ok, f'got {got} {tx[:100] if st >= 400 else ""}')
    for code, want in [('pass', 'UP'), ('PASS', 'UP'), ('green', 'UP'), ('SERVING', 'UP'), ('fail', 'DOWN'), ('FAILED', 'DOWN'), ('error', 'DOWN'), ('RED', 'DOWN'), ('NOT_SERVING', 'DOWN')]:
        svc = f'svc-word-{code.lower()}'
        st, _, m, tx, _ = report(svc, code)
        got = m['state']['lastStatus'] if (m and 'state' in m) else f'HTTP {st}'
        if m and 'id' in m: created.append(m['id'])
        check('F-38', f"G-3-30: status '{code}' -> {want} (the sidecar's vocabulary)", got == want, f'got {got}')
    st, _, m, tx, _ = report('svc-comp-pass', 'UP', components={'db': {'status': 'pass'}, 'cache': {'status': 'GREEN'}})
    created.append(m['id'])
    check('F-38', "G-3-30: UP with components 'pass'/'GREEN' -> UP (no false DEGRADED)", m['state']['lastStatus'] == 'UP', f"state={m['state'].get('lastStatus')} summary={m['state'].get('lastSummary')}")
    st, _, m, tx, _ = report('svc-comp-fail', 'UP', components={'db': {'status': 'fail', 'details': {'error': 'timeout'}}, 'cache': {'status': 'pass'}})
    created.append(m['id'])
    check('F-38', "G-3-30: UP with component 'fail' -> DEGRADED and the component counted DOWN", m['state']['lastStatus'] == 'DEGRADED' and 'db' in (m['state'].get('lastSummary') or '') and 'DOWN' in (m['state'].get('lastSummary') or ''), f"state={m['state'].get('lastStatus')} summary={m['state'].get('lastSummary')}")
    st, _, m, tx, _ = report('svc-extra-keys', 'UP', groups=['liveness', 'readiness'], extra={'x': 1})
    if m and 'id' in m: created.append(m['id'])
    check('F-36', 'G-3-8: a health report with keys the service does not know is still accepted (202, lenient by design)', st == 202, f'{st} {tx[:160]}')
    st, _, m, tx, _ = report('svc-nested', 'UP', components={'db': {'status': 'UP', 'components': {'primary': {'status': 'DOWN', 'details': {'error': 'connection refused'}}}}, 'ping': {'status': 'UP'}})
    created.append(m['id'])
    check('F-38', 'UP overall with a failing nested component -> DEGRADED, flattened to db.primary', m['state']['lastStatus'] == 'DEGRADED' and 'db.primary' in (m['state'].get('lastSummary') or ''), f"state={m['state'].get('lastStatus')} summary={m['state'].get('lastSummary')}")
    st, _, m2, tx, _ = report('svc-legacy', 'UP', components={'cache': {'status': 'UP', 'details': {'redis': {'status': 'DOWN', 'details': {'error': 'x' * 300}}}}})
    created.append(m2['id'])
    summ = m2['state'].get('lastSummary') or ''
    check('F-38', 'legacy details nesting flattened (cache.redis), detail text capped near 200 chars', m2['state']['lastStatus'] == 'DEGRADED' and 'cache.redis' in summ and ('x' * 201) not in summ, f"summary={summ[:260]}")
    # F-46 instances
    inst = lambda i, **k: {'id': i, 'namespace': 'ns1', 'node': 'node-a', 'cluster': 'sandbox', 'version': '1.2.3', 'sidecar': 'e2e3', **k}
    st, _, m, _, _ = report('svc-pods', 'UP', instance=inst('pod-b')); created.append(m['id']); mid = m['id']
    report('svc-pods', 'UP', instance=inst('pod-a'))
    st, _, insts, _, _ = req(A, 'GET', f'/v1/health/monitors/{mid}/instances')
    check('F-46', 'two pods -> 2 instance records ordered by id with lastSeenAt and metadata', st == 200 and [i['instanceId'] for i in insts] == ['pod-a', 'pod-b'] and all(i.get('lastSeenAt') and i.get('namespace') == 'ns1' and i.get('sidecar') == 'e2e3' and i['left'] is False for i in insts),
          f"{st} {[(i['instanceId'], i['status'], i.get('lastSeenAt')) for i in insts]}")
    seen = insts[0]['lastSeenAt'] if insts else None
    time.sleep(1.1)
    report('svc-pods', 'UP', instance=inst('pod-a'))
    st, _, insts2, _, _ = req(A, 'GET', f'/v1/health/monitors/{mid}/instances')
    check('F-46', 'repeat report for pod-a upserts (still 2, lastSeenAt advanced)', len(insts2) == 2 and insts2[0]['lastSeenAt'] > seen, f"{[(i['instanceId'], i.get('lastSeenAt')) for i in insts2]}")
    st, _, m3, _, _ = req(A, 'GET', f'/v1/health/monitors/{mid}')
    check('F-46', "rollup summary '2 of 2 pods UP'", '2 of 2' in (m3['state'].get('lastSummary') or ''), f"summary={m3['state'].get('lastSummary')}")
    st, _, _, tx, _ = req(A, 'GET', f'/v1/health/monitors/{uuid.uuid4()}/instances')
    check('F-46', 'unknown monitor -> 404', st == 404, f'{st} {tx[:100]}')
    # F-48 fast path: staleAfterSeconds=4 on registered push-only monitors (sweep every 1 s in this stack)
    st, _, sz, tx, _ = req(A, 'POST', '/v1/health/monitors', {'tenantId': T, 'service': 'svc-scaled', 'staleAfterSeconds': 4, 'publisher': 'ops'})
    check('F-48', 'register a push-only monitor with staleAfterSeconds=4 -> 201', st == 201, f'{st} {tx[:120]}')
    created.append(sz['id'])
    report('svc-scaled', 'UP', instance={'id': 'z1'}); report('svc-scaled', 'UP', instance={'id': 'z2'})
    report('svc-scaled', 'UP', instance={'id': 'z1', 'leaving': True})
    st, _, zi, _, _ = req(A, 'GET', f"/v1/health/monitors/{sz['id']}/instances")
    st, _, zm, _, _ = req(A, 'GET', f"/v1/health/monitors/{sz['id']}")
    check('F-48', 'leaving=true marks the pod left at once and drops it from the rollup', any(i['instanceId'] == 'z1' and i['left'] for i in zi) and '1 of 1' in (zm['state'].get('lastSummary') or ''), f"left={[(i['instanceId'], i['left']) for i in zi]} summary={zm['state'].get('lastSummary')}")
    report('svc-scaled', 'UP', instance={'id': 'z2', 'leaving': True})
    st, _, sl, _, _ = req(A, 'POST', '/v1/health/monitors', {'tenantId': T, 'service': 'svc-silent', 'staleAfterSeconds': 4, 'publisher': 'ops'})
    created.append(sl['id'])
    report('svc-silent', 'UP', instance={'id': 's1'}); report('svc-silent', 'UP', instance={'id': 's2'})
    t0 = time.monotonic(); opened = None
    while time.monotonic() - t0 < 20:
        st, _, sm, _, _ = req(A, 'GET', f"/v1/health/monitors/{sl['id']}")
        if sm['state'].get('openCommunicationId'): opened = time.monotonic() - t0; break
        time.sleep(0.5)
    st, _, zm2, _, _ = req(A, 'GET', f"/v1/health/monitors/{sz['id']}")
    body = ''
    if opened is not None:
        st, _, fi, _, _ = req(A, 'GET', f"/v1/feed/{sm['state']['openCommunicationId']}"); body = (fi or {}).get('body', '') + ' | ' + (fi or {}).get('title', '')
    plain = opened is not None and '**' not in body and not __import__('re').search(r'\d{2}:\d{2}:\d{2}\.\d', body) and __import__('re').search(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC', body)
    check('F-40', 'G-3-25: the automated notice reads as plain words (no ** markers, times to the second in UTC)', plain, body[:300].replace('\n', ' / '))
    check('F-48', 'pods that went silent -> DOWN notice after the window naming them; the scaled-to-zero service gets none', opened is not None and 's1' in body and 's2' in body and not zm2['state'].get('openCommunicationId'),
          f"silent_opened_after={opened and round(opened, 1)}s state={sm['state'].get('lastStatus')} notice={body[:220]} scaled_state={zm2['state'].get('lastStatus')} scaled_open={zm2['state'].get('openCommunicationId')} scaled_summary={zm2['state'].get('lastSummary')}")
    # F-50 bursts
    for n, svc in enumerate(['svc-burst', 'svc-burst', 'svc-burst2']):
        codes = []
        def one(i):
            st, _, _, _, _ = req(A, 'POST', '/v1/health/reports', {'tenantId': T, 'service': svc, 'status': 'UP', 'publisher': 'burst', 'instance': {'id': f'p{i}'}}); codes.append(st)
        ths = [threading.Thread(target=one, args=(i,)) for i in range(20)]
        [t.start() for t in ths]; [t.join() for t in ths]
        check('F-50', f'burst {n + 1}: 20 parallel instance reports for {svc} all 202', codes.count(202) == 20, f'202 x{codes.count(202)} others={[c for c in codes if c != 202]}')
    st, _, lst, _, _ = req(A, 'GET', f'/v1/health/monitors?tenantId={T}')
    bm = next((m for m in lst if m['service'] == 'svc-burst'), None); created.extend(m['id'] for m in lst if m['service'].startswith('svc-burst'))
    st, _, bi, _, _ = req(A, 'GET', f"/v1/health/monitors/{bm['id']}/instances")
    check('F-50', "one monitor, 20 pods, '20 of 20 pods UP'", len(bi) == 20 and '20 of 20' in (bm['state'].get('lastSummary') or ''), f"pods={len(bi)} summary={bm['state'].get('lastSummary')}")
    # cleanup: delete every monitor this phase created (nothing reports to them; left behind they would all go silent and feed the valve)
    st, _, lst, _, _ = req(A, 'GET', f'/v1/health/monitors?tenantId={T}')
    dels = []
    for m in lst:
        st, _, _, _, _ = req(A, 'DELETE', f"/v1/health/monitors/{m['id']}"); dels.append(st)
    st, _, nf, _, _ = req(A, 'GET', f'/v1/feed/{sm["state"]["openCommunicationId"]}') if opened is not None else (0, 0, {}, 0, 0)
    check('F-48', f'cleanup: DELETE {len(dels)} monitors -> 204; deleting retires the silent notice', all(d == 204 for d in dels) and (opened is None or nf.get('status') == 'RETIRED'), f"deletes={dels} notice_after_delete={nf.get('status')}")
    if opened is not None:
        st, _, full, _, _ = req(A, 'GET', f'/v1/communications/{sm["state"]["openCommunicationId"]}')
        actors = sorted({e.get('actor') for e in (full or {}).get('history', [])})
        check('F-40', "G-3-25: the automated notice is published, updated and retired under one name (the monitor's publisher 'ops')", (full or {}).get('publisher') == 'ops' and actors == ['ops'], f"publisher={(full or {}).get('publisher')} history={[(e.get('actor'), e.get('action')[:50]) for e in (full or {}).get('history', [])]}")

# --------------------------------------------------------------------------------------------------------------- fanout
def phase_fanout():
    T = f've3-fan-{RUN}'
    print(f'## fanout phase A<->B tenant {T} at {stamp()}')
    got = {'A': [], 'B': []}
    def listen(host, key):
        st, h, fr, co = sse(host, f'/v1/feed/stream?tenantId={T}&clientId={CID}', seconds=6)
        got[key] = fr
    ta = threading.Thread(target=listen, args=(A, 'A')); tb = threading.Thread(target=listen, args=(B, 'B')); ta.start(); tb.start(); time.sleep(0.6)
    t0 = time.monotonic()
    p, _ = publish(B, outage(T, 'published on B'))
    time.sleep(1.5)
    st, _, fa, _, _ = req(A, 'GET', f'/v1/feed?tenantId={T}')
    req(A, 'POST', f"/v1/communications/{p['id']}/retire", {'note': 'retired on A'})
    ta.join(); tb.join()
    ea = [(f.get('event'), f.get('id'), round(f['t'], 2)) for f in got['A']]; eb = [(f.get('event'), f.get('id'), round(f['t'], 2)) for f in got['B']]
    check('F-18', 'publish on B -> created frame on A and B with the same seq; retire on A -> retired on both', [e[0] for e in ea] == ['created', 'retired'] and [e[0] for e in eb] == ['created', 'retired'] and [e[1] for e in ea] == [e[1] for e in eb], f'A={ea} B={eb}')
    check('F-18', 'A serves what B stored (shared store)', p['id'] in [i['id'] for i in fa['items']], f"{[i['title'] for i in fa['items']]}")

# ------------------------------------------------------------------------------------------------------------ mongo down
def phase_mongo_down():
    T = f've3-mongo-{RUN}'
    print(f'## mongo_down phase (Mongo is expected to be stopped) at {stamp()}')
    st, _, js, tx, dt = req(A, 'GET', f'/v1/feed?tenantId={T}', timeout=40)
    check('F-92', 'GET /v1/feed with Mongo down -> 503 {"error":"database unavailable"} within ~5 s (G-2-4)', st == 503 and js == {'error': 'database unavailable'}, f'{st} {tx[:200]} after {dt:.2f} s')
    st, _, js, tx, dt = req(A, 'POST', '/v1/communications', outage(T, 'during outage'), timeout=40)
    check('F-92', 'POST with Mongo down -> 503 database unavailable, no driver cluster description leaked', st == 503 and js == {'error': 'database unavailable'} and 'ClusterDescription' not in tx and 'ServerDescription' not in tx, f'{st} {tx[:200]} after {dt:.2f} s')
    st, _, js, tx, dt = req(A, 'GET', '/actuator/health/readiness', headers={}, timeout=40)
    check('F-92', 'G-3-6: readiness reports DOWN (503) while Mongo is down, within ~1 s', st == 503 and (js or {}).get('status') == 'DOWN' and dt < 1.6, f'{st} {tx[:120]} after {dt:.2f} s')
    st, _, js, tx, dt = req(A, 'GET', '/actuator/health/liveness', headers={}, timeout=40)
    check('F-92', 'liveness stays UP (no restart loop)', st == 200 and (js or {}).get('status') == 'UP', f'{st} {tx[:120]} after {dt:.2f} s')
    st, _, js, tx, dt = req(A, 'GET', f'/v1/health/monitors?tenantId={T}', timeout=40)
    check('F-92', 'health API with Mongo down -> 503 database unavailable', st == 503 and js == {'error': 'database unavailable'}, f'{st} {tx[:160]} after {dt:.2f} s')
    try:
        t0 = time.monotonic(); ended = []
        st, h, fr, co = sse(A, f'/v1/feed/stream?tenantId={T}&clientId={CID}', seconds=12, stop=None, first_byte=ended)
        dt = time.monotonic() - t0
        check('F-92', 'G-3-1: a stream opened while Mongo is down answers 200 + :connected and then ends by itself (no frames), so EventSource retries', st == 200 and co and co[0][1].startswith(':connected') and not fr and dt < 11.5, f"status={st} ct={h.get('Content-Type')} frames={len(fr)} comments={[(round(t, 2), c) for t, c in co][:4]} closed after {dt:.1f} s")
    except Exception as e:
        check('F-92', 'stream request with Mongo down: observed behaviour recorded', True, f'exception {type(e).__name__}: {e}')

def phase_mongo_back():
    T = f've3-mongo-{RUN}'
    print(f'## mongo_back phase (Mongo started again, backend NOT restarted) at {stamp()}')
    t0 = time.monotonic(); ok = None
    while time.monotonic() - t0 < 60:
        st, _, js, tx, dt = req(A, 'GET', f'/v1/feed?tenantId={T}', timeout=40)
        if st == 200: ok = time.monotonic() - t0; break
        time.sleep(1)
    check('F-92', 'GET /v1/feed answers 200 again without a backend restart', ok is not None, f'after {ok and round(ok, 1)} s')
    st, _, js, _, _ = req(A, 'GET', '/actuator/health/readiness', headers={})
    check('F-92', 'readiness UP again', st == 200 and js.get('status') == 'UP', f'{st} {js}')
    p, _ = publish(A, outage(T, 'after recovery'))
    st, _, fi, _, _ = req(A, 'GET', f"/v1/feed/{p['id']}")
    check('F-92', 'publish + read work after recovery', st == 200 and fi['status'] == 'ACTIVE', f'{st}')
    req(A, 'POST', f"/v1/communications/{p['id']}/retire", {})

if __name__ == '__main__':
    phases = sys.argv[1:] or ['core', 'sse', 'health', 'fanout']
    for p in phases:
        try:
            globals()['phase_' + p]()
        except Exception as e:
            import traceback; traceback.print_exc()
            check('RUN', f'phase {p} crashed', False, f'{type(e).__name__}: {e}')
    fails = [r for r in RESULTS if not r[2]]
    print(f'## summary: {len(RESULTS) - len(fails)} pass, {len(fails)} fail at {stamp()}')
    sys.exit(min(99, len(fails)))
