#!/usr/bin/env python3
"""Render journey boards (sticky swim lanes, numbered arrows) in the grammar of the Console Journeys page.

A journey = parts (one sticky column each) + steps (one slip each, one row per step, time runs down).
Each step may `send` an arrow to another part; the step that receives it carries the arrow's number
(4 -> 4a), later steps of the same sticky without an incoming arrow continue (4b, 4c). Arrow kinds:
request (solid ink), event (solid blue), answer (grey dashed), next (ink dashed, "coming next").
Every text exists in a plain-words and a technical wording; `code` spans are written as `code` in the
source text and rendered in the mono face.
"""
import html, re

COL_W, GAP, LEFT, TOP = 270, 92, 30, 30
SLIP_W, SLIP_DX, ROW_GAP, FIRST_Y = 238, 16, 30, 148
LINE_H, PAD_TOP = 19, 22
TEXT_W = 184          # usable width inside a slip after the pill
PALETTE = ["#c3e1fb", "#ffe98a", "#ddd0f5", "#c9ecc7", "#ffd3b4", "#f8c8dc", "#cfe8e6", "#e6e0c8", "#d7dce8", "#f1dcb0"]

def esc(t): return html.escape(t, quote=False)

def width(text):
    """Rough advance width at the slip font sizes (hand 14px, mono 12.5px)."""
    w = 0.0
    for ch in text:
        if ch in "iljtf.,:;'!| ": w += 4.6
        elif ch in "mwMW": w += 12.0
        elif ch.isupper() or ch in "0123456789": w += 9.3
        else: w += 8.0
    return w

def tokens(text):
    """Split into words; a `code` run is one mono token that keeps the punctuation glued around it."""
    out = []
    for m in re.finditer(r"([(\[\"']*)`([^`]+)`([,.;:)\]\"'!?]*)|(\S+)", text):
        if m.group(2) is not None: out.append((m.group(1) or "", m.group(2), m.group(3) or "", True))
        else: out.append(("", m.group(4), "", False))
    return out

def tok_width(t):
    pre, body, suf, mono = t
    return width(pre) + width(body) * (0.95 if mono else 1.0) + width(suf)

def split_long(t, max_w):
    """Break one over-wide token at natural places (, : / = & ? _ -) so JSON and URLs wrap."""
    pre, body, suf, mono = t
    if tok_width(t) <= max_w or len(body) < 8: return [t]
    pieces, cur = [], ""
    for ch in body:
        cur += ch
        if ch in ",:/=&?_-" and width(cur) * 0.95 > max_w * 0.45:
            pieces.append(cur); cur = ""
        elif width(cur) * 0.95 > max_w - 8:
            pieces.append(cur); cur = ""
    if cur: pieces.append(cur)
    out = []
    for i, pc in enumerate(pieces):
        out.append((pre if i == 0 else "", pc, suf if i == len(pieces) - 1 else "", mono))
    return out

def wrap(text, max_w=TEXT_W):
    lines, cur, cur_w = [], [], 0.0
    toks = []
    for t in tokens(text): toks.extend(split_long(t, max_w))
    for t in toks:
        tw = tok_width(t)
        add = tw + (4.6 if cur else 0)
        if cur and cur_w + add > max_w:
            lines.append(cur); cur, cur_w = [t], tw
        else:
            cur.append(t); cur_w += add
    if cur: lines.append(cur)
    return lines

def line_svg(line):
    parts = []
    for pre, body, suf, mono in line:
        b = esc(body)
        parts.append(esc(pre) + (f'<tspan class="m">{b}</tspan>' if mono else b) + esc(suf))
    return " ".join(parts)

def line_html(text):
    return re.sub(r"`([^`]+)`", lambda m: f"<code>{esc(m.group(1))}</code>", esc(text))

def label_steps(steps):
    """Assign labels: Start for a person's start, n a/b/c for arrow-numbered steps."""
    n = 0
    last_in_part = {}
    for st in steps:
        if st.get("start"):
            st["label"] = "▶"; st["story_label"] = "Start"; st["arrow_in"] = None
            last_in_part[st["part"]] = ("start", 0)
        elif st.get("recv") is not None:
            num = st["recv"]
            st["label"] = f"{num}a"; st["story_label"] = f"{num}a"; st["arrow_in"] = num
            last_in_part[st["part"]] = (num, 0)
        else:
            prev = last_in_part.get(st["part"])
            if prev is None or prev[0] == "start":
                # continuation of the start sticky before any arrow: keep ▶-less plain label
                base = prev[0] if prev else "start"
                idx = (prev[1] if prev else 0) + 1
                st["label"] = f"{chr(ord('a') + idx)}" if base == "start" else f"{base}{chr(ord('a') + idx)}"
                st["story_label"] = st["label"]
                last_in_part[st["part"]] = (base, idx)
            else:
                base, idx = prev; idx += 1
                st["label"] = f"{base}{chr(ord('a') + idx)}"; st["story_label"] = st["label"]
                last_in_part[st["part"]] = (base, idx)
            st["arrow_in"] = None
    return steps

def number_arrows(steps):
    """Arrow numbers run in step order; the receiving step is the next step whose part is the target."""
    n = 0
    for i, st in enumerate(steps):
        send = st.get("send")
        if not send: continue
        n += 1
        st["arrow_no"] = n
        # the receiving step: the first later step in the target part that has no explicit recv yet
        for later in steps[i + 1:]:
            if later["part"] == send["to"] and later.get("recv") is None and not later.get("start") and not later.get("_claimed"):
                later["recv"] = n; later["_claimed"] = True; break
        else:
            raise ValueError(f"arrow {n} from {st['part']} to {send['to']} has no receiving step")
    return n

def layout(parts, steps, view):
    """Return (svg, story_html, n_arrows) for one view ('plain' or 'tech')."""
    col = {p["key"]: i for i, p in enumerate(parts)}
    y = FIRST_Y
    for st in steps:
        lines = wrap(st[view])
        st["_lines"] = lines
        st["_x"] = LEFT + col[st["part"]] * (COL_W + GAP) + SLIP_DX
        st["_y"] = y
        st["_h"] = PAD_TOP + LINE_H * len(lines)
        y += st["_h"] + ROW_GAP
    total_h = y - ROW_GAP + 60
    total_w = LEFT + len(parts) * (COL_W + GAP) - GAP + LEFT
    sticky_h = total_h - 44
    jid = f"{view}"
    out = []
    out.append(f'<svg viewBox="0 0 {total_w} {total_h}" width="{total_w}" height="{total_h}" role="img" aria-label="__ARIA__"><defs>')
    out.append(f'<pattern id="{jid}-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" class="dot"/></pattern>')
    out.append(f'<filter id="{jid}-shadow" x="-5%" y="-2%" width="110%" height="104%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity="0.2"/></filter>')
    for k, cls in (("ah", "mkh"), ("ae", "mke"), ("arm", "mkr")):
        out.append(f'<marker id="{jid}-{k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="{cls}"/></marker>')
    out.append(f'<marker id="{jid}-mh" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="mkm"/></marker>')
    out.append(f'</defs><rect width="{total_w}" height="{total_h}" class="boardbg"/><rect width="{total_w}" height="{total_h}" fill="url(#{jid}-dots)"/>')
    # stickies
    for i, p in enumerate(parts):
        x = LEFT + i * (COL_W + GAP)
        color = p.get("color") or PALETTE[i % len(PALETTE)]
        out.append(f'<rect x="{x}" y="{TOP}" width="{COL_W}" height="{sticky_h}" fill="{color}" class="note" filter="url(#{jid}-shadow)"/>')
        out.append(f'<path d="M{x+244} {TOP+sticky_h} L{x+COL_W} {TOP+sticky_h-26} L{x+COL_W} {TOP+sticky_h} Z" class="curl"/>')
        out.append(f'<rect x="{x+91}.0" y="19" width="88" height="24" class="tape" transform="rotate(-2 {x+135}.0 30)"/>')
        out.append(f'<text class="nt" x="{x+16}" y="70">{esc(p[view])}</text>')
        sub = p.get(view + "_sub", "")
        if sub:
            for k, line in enumerate(wrap(sub, 236)):
                out.append(f'<text x="{x+16}.0" y="{92+16*k}.0" class="ns">{line_svg(line)}</text>')
    # mini arrows between consecutive slips of the same sticky
    prev_in_part = {}
    for st in steps:
        pv = prev_in_part.get(st["part"])
        if pv is not None and st.get("arrow_in") is None and not st.get("start"):
            cx = st["_x"] + SLIP_W / 2
            out.append(f'<path class="mini" d="M{cx} {pv["_y"]+pv["_h"]} V{st["_y"]-2}" marker-end="url(#{jid}-mh)"/>')
        prev_in_part[st["part"]] = st
    # slips
    for st in steps:
        x, yy, h = st["_x"], st["_y"], st["_h"]
        out.append(f'<rect class="slip" x="{x}" y="{yy}" width="{SLIP_W}" height="{h}" rx="5"/>')
        lab = st["label"]
        pw = 22 if lab == "▶" else 30
        out.append(f'<rect class="pill" x="{x+8}" y="{yy+8}" width="{pw}" height="20" rx="10"/><text class="pillt" x="{x+8+pw/2}" y="{yy+22}" text-anchor="middle">{lab}</text>')
        for k, line in enumerate(st["_lines"]):
            out.append(f'<text x="{x+8+pw+8}.0" y="{yy+PAD_TOP+1+LINE_H*k}.0" class="st">{line_svg(line)}</text>')
    # arrows
    by_no = {st.get("arrow_no"): st for st in steps if st.get("arrow_no")}
    recv = {st.get("arrow_in"): st for st in steps if st.get("arrow_in")}
    n_arrows = 0
    for no in sorted(by_no):
        src, dst = by_no[no], recv[no]
        kind = src["send"].get("kind", "request")
        n_arrows += 1
        if dst["_x"] > src["_x"]:
            x1, x2 = src["_x"] + SLIP_W, dst["_x"] - 2
        else:
            x1, x2 = src["_x"], dst["_x"] + SLIP_W + 2
        y1 = src["_y"] + src["_h"] - 11
        y2 = dst["_y"] + 17
        mx = (x1 + (dst["_x"] if dst["_x"] > src["_x"] else dst["_x"] + SLIP_W)) / 2
        d = f"M{x1:.1f} {y1:.1f} H{mx:.1f} V{y2:.1f} H{x2:.1f}"
        cls = {"request": "ah", "event": "ae", "answer": "ar", "next": "ah dash"}[kind]
        mk = {"request": "ah", "event": "ae", "answer": "arm", "next": "ah"}[kind]
        out.append(f'<path d="{d}" class="halo"/><path d="{d}" class="{cls}" marker-end="url(#{jid}-{mk})"/>')
        bcls = "bdg ev" if kind == "event" else "bdg"
        by_ = (y1 + y2) / 2
        out.append(f'<g class="{bcls}"><circle cx="{mx:.1f}" cy="{by_:.1f}" r="14"/><text x="{mx:.1f}" y="{by_+4.6:.1f}" text-anchor="middle">{no}</text></g>')
    out.append('</svg>')
    # story
    names = {p["key"]: p[view] for p in parts}
    li = []
    for st in steps:
        send = ""
        if st.get("send"):
            kind = st["send"].get("kind", "request")
            verb = {"request": "→", "event": "→", "answer": "→ answer", "next": "→ next"}[kind]
            send = f' <span class="send">{verb} {st["arrow_no"]} to {esc(names[st["send"]["to"]])}</span>'
        li.append(f'<li><span class="lab">{esc(st["story_label"])}</span><span class="who">{esc(names[st["part"]])}</span><span class="txt">{line_html(st[view])}{send}</span></li>')
    story = '<ol class="story">' + "".join(li) + '</ol>'
    return "\n".join(out), story, n_arrows

def render_journey(j, idx):
    parts, steps = j["parts"], [dict(s) for s in j["steps"]]
    n = number_arrows(steps)
    label_steps(steps)
    used = {s["part"] for s in steps}
    parts = [p for p in parts if p["key"] in used]
    svg_p, story_p, n_arrows = layout(parts, steps, "plain")
    svg_t, story_t, _ = layout(parts, steps, "tech")
    svg_p = svg_p.replace("__ARIA__", esc(f'{j["title"]}: {j["plain"]}')).replace('id="plain', f'id="{j["id"]}p').replace('url(#plain', f'url(#{j["id"]}p')
    svg_t = svg_t.replace("__ARIA__", esc(f'{j["title"]}: {j["tech"]}')).replace('id="tech', f'id="{j["id"]}t').replace('url(#tech', f'url(#{j["id"]}t')
    sec = f'''<section class="journey" id="{j["id"]}">
  <p class="top"><a href="#journeys">↑ All journeys</a></p>
  <h2>{esc(j["title"])}</h2>
  <p class="sum v-plain">{line_html(j["plain"])}</p>
  <p class="sum v-tech" hidden>{line_html(j["tech"])}</p>
  <div class="scroller v-plain">{svg_p}</div>
  <div class="scroller v-tech" hidden>{svg_t}</div>
  <details open><summary>The same journey, step by step</summary>
    <div class="v-plain">{story_p}</div>
    <div class="v-tech" hidden>{story_t}</div>
  </details>
</section>'''
    card = f'<a class="card" href="#{j["id"]}"><span class="ct">{esc(j["title"])}</span><span class="cs">{esc(j["plain"])}</span><span class="cm">{n_arrows} arrows · {len(parts)} parts</span></a>'
    return sec, card

def render_page(meta, journeys, css, script):
    secs, cards = [], []
    for i, j in enumerate(journeys):
        s, c = render_journey(j, i); secs.append(s); cards.append(c)
    rules = "".join(f"<li>{line_html(r)}</li>" for r in meta["rules"])
    boards = f'<p class="boards">{meta["boards"]}</p>' if meta.get("boards") else ""
    keys = meta["keys"]
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{esc(meta["title"])}</title>
<meta name="description" content="{esc(meta["description"])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
{css}
</style>
</head>
<body>
<div class="wrap">
  <header id="journeys">
    <h1>{esc(meta["h1"])}</h1>
    <p class="lede">{line_html(meta["lede"])}</p>
    <ul class="rules">{rules}</ul>
    {boards}
    <div class="cards">
{chr(10).join(cards)}
    </div>
  </header>

  <div class="bar" role="group" aria-label="View options">
    <span class="seg" role="group" aria-label="Wording">
      <button type="button" id="vPlain" aria-pressed="true">Plain words</button>
      <button type="button" id="vTech" aria-pressed="false">Technical</button>
    </span>
    <span class="seg" role="group" aria-label="Diagram size">
      <button type="button" id="zAct" aria-pressed="true">Actual size</button>
      <button type="button" id="zFit" aria-pressed="false">Fit width</button>
    </span>
    <span class="spacer"></span>
    {keys}
  </div>

{chr(10).join(secs)}
</div>
<script>
{script}
</script>
</body></html>
'''
