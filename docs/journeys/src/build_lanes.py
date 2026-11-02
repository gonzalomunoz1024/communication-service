"""Builds the swim-lane page from journeys_data.py.

usage: python3 -I build_lanes.py <out-full.html> <out-artifact.html | -> [screenshots-href]
The full file is a standalone document (for the repo); the artifact file is the same page without the
document wrapper, for publishing as a claude.ai Artifact ('-' skips it). For the repo:
  python3 -I docs/journeys/src/build_lanes.py docs/journeys/outage-journeys.html - outage-walkthroughs.html"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gen import render_page  # noqa: E402
import journeys_data as jd  # noqa: E402

full_out, art_out = sys.argv[1], sys.argv[2]
shots = sys.argv[3] if len(sys.argv) > 3 else ""
meta = dict(jd.META)
meta["keys"] = open(os.path.join(HERE, "ref-keys.html"), encoding="utf-8").read()
if shots:
    meta["boards"] = (f'The same journeys as screenshots of the running system: <a href="{shots}">Outage journeys, '
                      'step by step</a>.')
page = render_page(meta, jd.JOURNEYS, open(os.path.join(HERE, "ref.css"), encoding="utf-8").read(),
                   open(os.path.join(HERE, "ref.js"), encoding="utf-8").read())
open(full_out, "w", encoding="utf-8").write(page)
if art_out == "-":
    print(len(page), "bytes full;", len(jd.JOURNEYS), "journeys")
    sys.exit(0)

# artifact: no doctype/html/head/body of our own; title, metas, fonts and style first
head = re.search(r"<head>(.*?)</head>", page, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", page, re.S).group(1)
head = re.sub(r'<meta charset="utf-8">\s*', "", head)
head = re.sub(r'<meta name="viewport"[^>]*>\s*', "", head)
head = head.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n<title>', 1)
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
head = head.replace(title, "", 1)
open(art_out, "w", encoding="utf-8").write(title + "\n" + head.strip() + "\n" + body.strip() + "\n")
print(len(page), "bytes full;", os.path.getsize(art_out), "bytes artifact;", len(jd.JOURNEYS), "journeys")
