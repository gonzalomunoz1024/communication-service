#!/usr/bin/env python3
"""Renders manifest.json (written by capture.js) into the walkthrough page: one section per journey, one frame per
step, with the screenshot or the transcript the step recorded.

usage: python3 -I render_shots.py [--artifact] [manifest.json] [out.html]
Defaults: docs/journeys/manifest.json -> docs/journeys/outage-walkthroughs.html, a standalone document. --artifact writes
the same page without the document wrapper, for publishing as a claude.ai Artifact. Environment: JR_COMMIT (the commit
the screens show), JR_SWIMLANES_HREF (link to the swim-lane page; default outage-journeys.html)."""
import html
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, ".."))
esc = html.escape

# Who acts in a step → a stable sticky colour (shared family with the swim-lane page).
LANES = {
    "Outage screens": "#c3e1fb",
    "Dependent systems": "#c9ecc7",
    "The service": "#ffe98a",
    "The clock": "#e6e0c8",
    "Health sidecar": "#ddd0f5",
    "Health desk": "#ffd3b4",
    "The team's app": "#f8c8dc",
    "Service operator (Alex)": "#cfe8e6",
    "A publishing system": "#d7dce8",
    "Publisher team (Priya)": "#f1dcb0",
    "The cluster": "#e2e8d0",
    "walkthrough": "#f3d6d0",
}

CSS = r"""
/* Layout: a sticky strip of journey chips, then one section per journey; each step is a frame (screen or transcript) under a lane chip. */
:root {
  --board: #f2f3ef; --dot: #c9ccc2; --ink: #23262b; --ink-soft: #565b63; --event: #1c62c9; --warn: #9a4b00;
  --card: #fbfbf8; --frame: #e6e7e1; --term: #1f2227; --term-ink: #e8e5de;
  --hand: "Shantell Sans", "Comic Neue", "Segoe Print", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --board: #1b1e22; --dot: #343941; --ink: #e8e5de; --ink-soft: #a8acb3; --event: #7cb3ff; --warn: #ffb36b; --card: #24282d; --frame: #2d3137; --term: #121417; --term-ink: #e8e5de; color-scheme: dark; }
}
:root[data-theme="dark"] { --board: #1b1e22; --dot: #343941; --ink: #e8e5de; --ink-soft: #a8acb3; --event: #7cb3ff; --warn: #ffb36b; --card: #24282d; --frame: #2d3137; --term: #121417; --term-ink: #e8e5de; color-scheme: dark; }
body { background: var(--board); color: var(--ink); font-family: var(--hand); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--board); }
.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 64px; max-width: 1100px; margin: 0 auto; display: grid; gap: 30px; }
header { display: grid; gap: 12px; }
h1 { font-size: clamp(28px, 4vw, 40px); margin: 0; text-wrap: balance; }
h2 { font-size: 26px; margin: 0; text-wrap: balance; }
.lede { margin: 0; font-size: 16px; line-height: 1.55; color: var(--ink-soft); max-width: 75ch; }
.how { margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 80ch; }
.how code, .sum code, .cap code { font-family: var(--mono); font-size: 0.86em; background: color-mix(in srgb, var(--ink) 8%, transparent); padding: 1px 5px; border-radius: 4px; }
.bar { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; font-size: 14px; position: sticky; top: env(safe-area-inset-top, 0px); background: var(--board); padding-block: 10px; z-index: 5; border-bottom: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips a { font-size: 13px; color: inherit; text-decoration: none; padding: 4px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent); }
.chips a:hover { border-color: var(--ink); }
.spacer { flex: 1; }
.seg { display: inline-flex; border: 1.5px solid var(--ink); border-radius: 999px; overflow: hidden; }
.seg button { font: inherit; font-size: 13px; background: transparent; color: var(--ink); border: 0; padding: 6px 14px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--board); }
.seg button:focus-visible, a:focus-visible, .shot:focus-visible, dialog button:focus-visible { outline: 2px solid var(--event); outline-offset: 2px; }
.boards { font-size: 15px; margin: 0; }
.boards a { color: inherit; }
.toc { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.card { display: grid; gap: 6px; padding: 14px 16px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); border-radius: 10px; color: inherit; text-decoration: none; min-width: 0; align-content: start; }
.card:hover { border-color: var(--ink); }
.ct { font-weight: 700; font-size: 17px; }
.cs { font-size: 14px; line-height: 1.45; color: var(--ink-soft); }
.cm { font-family: var(--mono); font-size: 12px; color: var(--ink-soft); }
.journey { display: grid; gap: 14px; scroll-margin-top: 80px; }
.sum { margin: 0; font-size: 16px; line-height: 1.55; max-width: 80ch; color: var(--ink-soft); }
ol.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; }
.step { display: grid; gap: 8px; min-width: 0; }
.who { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--paper-ink, #2a2622); }
.who .n { font-family: var(--mono); font-weight: 600; font-size: 12px; color: var(--ink-soft); min-width: 2.2em; }
.who .tag { background: var(--lane); color: #2a2622; padding: 3px 10px; border-radius: 4px; box-shadow: 0 1px 0 rgba(0,0,0,.18); transform: rotate(-0.6deg); }
.cap { margin: 0; font-size: 15px; line-height: 1.5; max-width: 80ch; }
.cap.note { color: var(--ink-soft); font-style: italic; }
.cap.err { color: var(--warn); }
.frame { background: var(--frame); border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent); border-radius: 10px; overflow: hidden; max-width: 100%; }
.frame .tb { display: flex; align-items: center; gap: 6px; padding: 7px 10px; font-family: var(--mono); font-size: 11px; color: var(--ink-soft); border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }
.frame .tb i { width: 9px; height: 9px; border-radius: 50%; background: var(--dot); display: inline-block; }
.frame .tb span { margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot { display: block; width: 100%; height: auto; background: #fff; cursor: zoom-in; border: 0; padding: 0; }
.term { background: var(--term); color: var(--term-ink); border-radius: 10px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent); }
.term .tb { display: flex; justify-content: space-between; gap: 10px; padding: 6px 12px; font-family: var(--mono); font-size: 11px; color: color-mix(in srgb, var(--term-ink) 65%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--term-ink) 12%, transparent); }
.term pre { margin: 0; padding: 12px 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.5; overflow-x: auto; max-height: 440px; overflow-y: auto; white-space: pre; tab-size: 2; }
.term pre .st { color: #9fe3a1; } .term pre .er { color: #ffb0a3; } .term pre .hd { color: #9ec5ff; }
.light .term pre .st { color: #9fe3a1; }
dialog { border: 0; padding: 0; background: transparent; max-width: min(96vw, 1600px); max-height: 96vh; }
dialog::backdrop { background: rgba(10, 12, 15, .82); }
dialog img { display: block; max-width: 96vw; max-height: 90vh; width: auto; height: auto; border-radius: 8px; background: #fff; }
dialog form { display: grid; gap: 8px; justify-items: end; }
dialog button { font: inherit; font-family: var(--hand); background: var(--card); color: var(--ink); border: 1px solid var(--ink); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
dialog .dcap { font-size: 14px; color: #fff; justify-self: start; max-width: 90vw; line-height: 1.45; }
.hide-tech .step[data-kind="transcript"] { display: none; }
.hide-tech .step[data-kind="note"] .cap::before { content: ""; }
.empty { font-size: 14px; color: var(--ink-soft); }
@media (max-width: 640px) { h2 { font-size: 22px; } .term pre { font-size: 11.5px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
"""

JS = r"""
(function () {
  var root = document.documentElement;
  var key = 'jw';
  function apply(v) {
    root.classList.toggle('hide-tech', v === 'screens');
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
  }
  var saved = null; try { saved = localStorage.getItem(key); } catch (e) {}
  apply(saved === 'screens' ? 'screens' : 'all');
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () { apply(b.dataset.v); try { localStorage.setItem(key, b.dataset.v); } catch (e) {} });
  });
  var dlg = document.getElementById('zoom'), img = dlg.querySelector('img'), cap = dlg.querySelector('.dcap');
  document.querySelectorAll('.shot').forEach(function (b) {
    b.addEventListener('click', function () {
      img.src = b.dataset.full; img.alt = b.getAttribute('aria-label') || ''; cap.textContent = b.dataset.cap || '';
      if (typeof dlg.showModal === 'function') dlg.showModal();
    });
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
})();
"""


def colour_pre(text, lang):
    """Light touches on a transcript: status lines and headers, no real highlighter."""
    out = []
    for line in text.split("\n"):
        e = esc(line)
        m = re.match(r"^(→ )(\d{3})(.*)$", line)
        if m:
            cls = "st" if m.group(2)[0] in "23" else "er"
            out.append(f'<span class="{cls}">{esc(line)}</span>')
        elif re.match(r"^(GET|POST|PUT|DELETE|PATCH) /", line) or re.match(r"^HTTP/\d", line):
            out.append(f'<span class="hd">{e}</span>')
        else:
            out.append(e)
    return "\n".join(out)


def step_html(j, i, s):
    who = s.get("who", "")
    lane = LANES.get(who, "#e6e0c8")
    kind = "image" if s.get("image") else "transcript" if s.get("transcript") else "note"
    if s.get("error"):
        kind = "note"
    label = f'<div class="who" style="--lane:{lane}"><span class="n">{i:02d}</span><span class="tag">{esc(who)}</span></div>'
    cap_cls = "cap" + (" err" if s.get("error") else " note" if kind == "note" else "")
    cap = f'<p class="{cap_cls}">{inline(s.get("text", ""))}</p>'
    body = ""
    if kind == "image":
        full = s["image"]
        alt = f'{who}: {s.get("text", "")}'
        body = (
            f'<div class="frame"><div class="tb"><i></i><i></i><i></i><span>{esc(who)}</span></div>'
            f'<button class="shot" type="button" data-full="{esc(full)}" data-cap="{esc(s.get("text", ""))}" aria-label="{esc(alt)}">'
            f'<img src="{esc(full)}" alt="{esc(alt)}" loading="lazy" width="1280" height="800" style="display:block;width:100%;height:auto"></button></div>'
        )
    elif kind == "transcript":
        lang = s.get("lang", "http")
        body = f'<div class="term"><div class="tb"><span>{esc(who)}</span><span>{esc(lang)}</span></div><pre>{colour_pre(s["transcript"], lang)}</pre></div>'
    return f'<li class="step" data-kind="{kind}">{label}{cap}{body}</li>'


def inline(text):
    """`code` spans inside captions."""
    parts = re.split(r"(`[^`]+`)", text)
    return "".join(f"<code>{esc(p[1:-1])}</code>" if p.startswith("`") and p.endswith("`") and len(p) > 2 else esc(p) for p in parts)


def counted(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


def render(manifest, swimlanes_href="outage-journeys.html", context=None):
    context = context or {}
    gen = manifest.get("generatedAt", "")
    try:
        when = datetime.fromisoformat(gen.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        when = gen
    journeys = manifest.get("journeys", [])
    chips = "".join(f'<a href="#{esc(j["id"])}">{esc(j["title"])}</a>' for j in journeys)
    toc = "".join(
        f'<a class="card" href="#{esc(j["id"])}"><span class="ct">{esc(j["title"])}</span><span class="cs">{esc(j["summary"])}</span>'
        f'<span class="cm">{counted(sum(1 for s in j["steps"] if s.get("image")), "screen")} · {counted(sum(1 for s in j["steps"] if s.get("transcript")), "transcript")}</span></a>'
        for j in journeys
    )
    sections = []
    for j in journeys:
        steps = "".join(step_html(j, i + 1, s) for i, s in enumerate(j["steps"]))
        sections.append(
            f'<section class="journey" id="{esc(j["id"])}"><h2>{esc(j["title"])}</h2><p class="sum">{inline(j["summary"])}</p>'
            f'<ol class="steps">{steps}</ol></section>'
        )
    commit = context.get("commit", "")
    how = (
        f"Captured {when} by driving the real stack: the React screens at 1280×800 in headless Chromium, the API over HTTP with the "
        f"<code>X-Client-Id</code> header, the Go health sidecar in its container next to a stand-in app, and the service's own log. "
        f"Nothing here is mocked; the short timers (probe every 5 s, a 75 s maintenance window) are walkthrough settings, the defaults are stated in each step."
        + (f" Code at commit <code>{esc(commit)}</code>." if commit else "")
    )
    return f"""<title>Outage Walkthroughs</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>{CSS}</style>
<div class="wrap">
<header>
<h1>Communication service, step by step</h1>
<p class="lede">Every way the outage service gets used, shown as it happened: the screens people see, the answers systems get, and what the health sidecar and the service wrote while it ran.</p>
<p class="how">{how}</p>
<p class="boards">The same journeys as sticky swim lanes, with a plain and a technical view: <a href="{esc(swimlanes_href)}">Communication service journeys</a>.</p>
</header>
<nav class="bar" aria-label="Journeys">
<div class="chips">{chips}</div>
<span class="spacer"></span>
<div class="seg" role="group" aria-label="What to show"><button type="button" data-v="all" aria-pressed="true">Screens and transcripts</button><button type="button" data-v="screens" aria-pressed="false">Screens only</button></div>
</nav>
<div class="toc">{toc}</div>
{''.join(sections)}
</div>
<dialog id="zoom" aria-label="Screenshot, enlarged"><form method="dialog"><button type="submit">Close</button><img src="" alt=""><p class="dcap"></p></form></dialog>
<script>{JS}</script>
"""


BASE_CSS = (":root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
            "body{margin:0;font-size:14px}img{max-width:100%}[hidden]{display:none!important}")


def standalone(fragment):
    """Wraps the artifact fragment in a document of its own, with the small reset the Artifact host would add."""
    title = re.search(r"<title>.*?</title>", fragment, re.S).group(0)
    rest = fragment.replace(title, "", 1).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "", 1)
    i = rest.index('<div class="wrap">')
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            f'{title}\n<style>{BASE_CSS}</style>\n{rest[:i].strip()}\n</head>\n<body>\n{rest[i:].strip()}\n</body>\n</html>\n')


if __name__ == "__main__":
    args = sys.argv[1:]
    artifact = "--artifact" in args
    args = [a for a in args if a != "--artifact"]
    mpath = args[0] if args else os.path.join(OUT, "manifest.json")
    out = args[1] if len(args) > 1 else os.path.join(os.path.dirname(mpath), "outage-walkthroughs.html")
    ctx = {"commit": os.environ.get("JR_COMMIT", "")}
    with open(mpath, encoding="utf-8") as f:
        manifest = json.load(f)
    page = render(manifest, swimlanes_href=os.environ.get("JR_SWIMLANES_HREF", "outage-journeys.html"), context=ctx)
    if not artifact:
        page = standalone(page)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print(out, len(page), "bytes;", len(manifest.get("journeys", [])), "journeys")
