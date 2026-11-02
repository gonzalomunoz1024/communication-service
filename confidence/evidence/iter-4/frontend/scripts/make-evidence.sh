#!/bin/bash
# Rebuilds confidence/evidence/iter-4/frontend/ from the scratch folder (idempotent). Frontend Verifier, iteration 4.
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4
R=/home/claude/communication-service
EV=$R/confidence/evidence/iter-4/frontend
rm -rf "$EV"; mkdir -p "$EV/scripts" "$EV/results" "$EV/results-superseded" "$EV/run-logs" "$EV/shots"
cp "$S"/scripts/*.js "$S"/scripts/*.py "$S"/scripts/*.sh "$EV/scripts/"
cp "$S"/run-logs/*.txt "$EV/run-logs/"
cp "$S"/results/*.txt "$EV/results/"; cp "$S"/results-superseded/*.txt "$EV/results-superseded/"
cp "$S"/shots/*.png "$EV/shots/" 2>/dev/null
python3 -I - "$S/results" "$EV/results" "$S/results-superseded" "$EV/results-superseded" <<'PY'
import json, glob, os, sys
for src, dst in ((sys.argv[1], sys.argv[2]), (sys.argv[3], sys.argv[4])):
    for f in sorted(glob.glob(src + '/*.json')):
        base = os.path.basename(f)[:-5]
        d = json.load(open(f))
        with open(dst + '/' + base + '.jsonl.txt', 'w') as o:
            if isinstance(d, list) and d and isinstance(d[0], dict) and 'feature' in d[0]:
                o.write('# one check per line: PASS/FAIL | feature | check | evidence (full, not cut at 400 chars like the run log)\n')
                for r in d:
                    ev = r['evidence'] if isinstance(r['evidence'], str) else json.dumps(r['evidence'], ensure_ascii=False)
                    o.write(f"{'PASS' if r['ok'] else 'FAIL'} | {r['feature']} | {r['name']} | {ev}\n")
            elif isinstance(d, list):
                o.write('# one element per line\n')
                for r in d: o.write(json.dumps(r, ensure_ascii=False) + '\n')
            elif isinstance(d, dict):
                o.write('# one top-level key per line\n')
                for k, v in d.items(): o.write(f'{k}: {json.dumps(v, ensure_ascii=False)}\n')
PY
python3 -I "$S/scripts/aggregate.py" "$S/results" > "$EV/results/aggregate.txt"

# backend logs of my private instances: counts and WARN lines by logger (local URIs only, no secrets)
{
  echo "# private backends (iteration-4 jar, sha256 64e07ece...): ERROR / WARN line counts, stack-trace lines; then WARN lines grouped by logger and message"
  for p in 19200 19201 19202; do f=$S/logs/backend-$p.txt; echo "backend :$p  lines=$(wc -l < $f)  ERROR=$(grep -c ' ERROR ' $f)  WARN=$(grep -c ' WARN ' $f)  stack-trace lines=$(grep -cE '^\s+at ' $f)"; done
  for p in 19200 19202; do
    echo; echo "## backend :$p WARN lines by logger : message (ids folded)"
    python3 -I -c '
import re, sys, collections
c = collections.Counter()
for l in open(sys.argv[1], errors="replace"):
    m = re.search(r" WARN \d+ --- \[[^]]*\] \[[^]]*\] (\S+)\s+: (.*)", l)
    if m: c[m.group(1).split(".")[-1] + " : " + re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", "{id}", m.group(2))[:70]] += 1
for k, v in c.most_common(25): print(f"{v:4d}  {k}")
' "$S/logs/backend-$p.txt"
  done
} > "$EV/results/backend-logs-summary.txt"

# static checks: summary, then the relevant lines of every step
{
  echo "# Frontend static checks at d10369b (code = 1cd3f13) (scripts/run-static.sh; full outputs in the scratch folder, relevant lines here)"
  cat "$S/static/summary.txt"; echo
  for f in 01-lint-run1 14-lint-run2 15-lint-run3 02-typecheck-run1 16-typecheck-run2 17-typecheck-run3; do echo "## $f"; grep -v '^$' "$S/static/$f.txt" | tail -2; done
  for f in 03-build-run1 18-build-run2 19-build-run3 11-default-tenant-build 12-xorigin-build 13-badclientid-build; do echo "## $f"; grep -E 'kB|built in|error' "$S/static/$f.txt" | sed -E 's#^.*/(dist[^/]*/)#\1#'; done
  echo "## bundles byte-identical across the three builds"; cat "$S/static/bundle-sha256.txt"  # frozen from sha256sum dist*/assets/* before the scratch builds were removed
  echo "## 08-audit / 09-audit-omit-dev"; cat "$S/static/08-audit.txt" "$S/static/09-audit-omit-dev.txt"
  echo "## 10-audit-json (metadata)"; python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(d.get('metadata')))" "$S/static/10-audit-json.txt"
  echo "## 20/21 Trivy 0.58.1 fs on a copy of package.json + package-lock.json (--skip-db-update --skip-java-db-update --scanners vuln --include-dev-deps; database of 2026-11-02 01:14Z; under flock of orch-trivy/.lock)"
  grep -vE '^\s*$' "$S/static/20-trivy-fs-lockfile.txt" | sed -E 's/^[0-9TZ:.-]+\s+//' | tail -6
  python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); [print('json:', r['Target'], r.get('Type'), 'packages', len(r.get('Packages') or []), 'vulnerabilities', len(r.get('Vulnerabilities') or [])) for r in d.get('Results',[])]" "$S/static/21-trivy-fs-lockfile.json"
  echo "## minimatch override still in place (G-2-13)"; grep -n -A3 '"overrides"' $R/frontend/package.json; cat "$S/static/22-npm-ls-minimatch.txt"
} > "$EV/static-checks.txt"

# every run of the suite, with the load average around it, and the failures' first lines
{
  echo "# npm test runs at d10369b (code = 1cd3f13), 4 CPUs shared with four other verifiers. Scored runs: 04/05/06 (the 3x) and 07 (coverage),"
  echo "# repeats A-1..3 (load ~25), B-1..3 + coverage-rerun (load 2-7) and C-1..3 (load 2-4, after my private stack was down) are scored."
  echo "# D-* and P-* are DIAGNOSTIC (not scored): D-* add --testTimeout=20000 under shared load; P-* run confined to CPU 0 (taskset, PIN=0),"
  echo "# P-...-8workers adds --maxWorkers=8 (8 test files share one core, ~1/8 core each, like the failing runs) and reproduces the timeouts"
  echo "# locally without loading the other cores; the same with --testTimeout=20000 passes 183/183 (the cause is the 5 s margin, not a hang)."
  echo "## run-static.sh steps (load not logged; my three JVMs were starting during 05/06: load 16-21 at 10:24)"
  grep -E '^0[4-7]-' "$S/static/summary.txt"
  for f in 04-test-run1 05-test-run2 06-test-run3 07-coverage; do echo "### $f"; grep -E 'Test Files|Tests +[0-9]|Duration' "$S/static/$f.txt"; grep -E '^ FAIL |^(Error|AssertionError)' "$S/static/$f.txt" | head -8; done
  echo; echo "## repeats (scripts/test-repeat.sh): time | label | exit | wall | 1-min load before -> after | result | failed tests"
  cat "$S/static/repeat/summary.txt"
  echo; echo "## the local reproduction (P-pinned-cpu0-8workers-diagnostic-1): the two tests that failed in 06 and A-3, timed out again"
  sed -E 's/\x1b\[[0-9;]*m//g' "$S/static/repeat/P-pinned-cpu0-8workers-diagnostic-1.txt" | grep -E '^ +× |Test timed out' | sed 's/^ *//' | head -6
  echo; echo "## the cascade in 05-test-run2: the timed-out test's pending typing ('fixed…') reached the next test's note field"
  grep -n -A18 'offers Withdraw instead' "$S/static/05-test-run2.txt" | grep -E 'AssertionError|^\S*-\s+"",|\+\s+"fixe"|Number of calls' | head -6
  echo; echo "## slowest tests in the idle verbose run (04): close to the 5 s default only under contention"
  grep -E '[0-9]{4}ms' "$S/static/04-test-run1.txt" | sed 's/^ *//' | head -8
} > "$EV/test-runs.txt"

# coverage: the v8 table, then the iteration-4 source lines against it
{
  echo "# vitest --coverage (v8) at d10369b, from static/07b-coverage-rerun.txt (183/183 passed; 07-coverage had one timeout and vitest wrote no report)"
  sed -n '/Coverage report from/,$p' "$S/static/07b-coverage-rerun.txt" | sed -E 's/\x1b\[[0-9;]*m//g' | grep -vE '^\s*$'
  echo; echo "# iteration-4 source changes (git diff -U0 6c15715..d10369b -- frontend/src ':!frontend/src/test') against coverage-final.json (statement map)"
  cat "$S/static/changed-lines-coverage.txt"
} > "$EV/coverage.txt"
cp "$S/static/test-names.txt" "$EV/test-names.txt"
cp "$S/static/test-diff.txt" "$EV/test-diff.txt"
{
  echo '$ git rev-parse HEAD; git log -1 --format="%h %cI %s"; git branch --show-current'; git -C $R rev-parse HEAD; git -C $R log -1 --format='%h %cI %s'; git -C $R branch --show-current
  echo; echo '$ git diff 1cd3f13 HEAD -- . ":!confidence" | wc -l   (0 = the code under test is 1cd3f13)'; git -C $R diff 1cd3f13 HEAD -- . ':!confidence' | wc -l
  echo; echo '$ git log --format="%h %s" 6c15715..HEAD -- frontend/'; git -C $R log --format='%h %s' 6c15715..HEAD -- frontend/
  echo; echo '$ git diff --stat 6c15715..HEAD -- frontend/ (the iteration-4 frontend change set)'; git -C $R diff --stat 6c15715..HEAD -- frontend/ | tail -18
  echo; echo '$ git status --short (at evidence time; other verifiers own the other untracked folders)'; git -C $R status --short
} > "$EV/commit.txt"
# timelines whose pretty-printed JSON tail pushes them past ~200 lines: same content, one compact JSON element per line
python3 -I - "$EV/results" "$EV/results-superseded" <<'PY2'
import json, glob, sys
for d in sys.argv[1:]:
    for f in sorted(glob.glob(d + '/*-timeline.txt')):
        lines = open(f).read().split('\n')
        if len(lines) <= 200 or '{' not in lines: continue
        i = lines.index('{')
        try: data = json.loads('\n'.join(lines[i:]))
        except ValueError: print('could not compact (JSON cut):', f); continue
        out = lines[:i] + ['# the run data below: one compact JSON element per line (re-emitted from the pretty-printed JSON the script wrote)']
        for k, v in data.items():
            if isinstance(v, dict):
                for k2, v2 in v.items():
                    out.append(f'## {k}.{k2}')
                    out += [json.dumps(x, ensure_ascii=False) for x in v2] if isinstance(v2, list) else [json.dumps(v2, ensure_ascii=False)]
            else:
                out.append(f'## {k}'); out += [json.dumps(x, ensure_ascii=False) for x in v] if isinstance(v, list) else [json.dumps(v, ensure_ascii=False)]
        open(f, 'w').write('\n'.join(out) + '\n'); print(f'compacted {f.split("/")[-1]}: {len(lines)} -> {len(out)} lines')
PY2
echo "kept whole on purpose: the browser scripts (code to re-run as-is; iteration 3 kept them whole too)"
echo "files over 200 lines:"; find "$EV" -type f \( -name '*.txt' -o -name '*.js' -o -name '*.sh' -o -name '*.py' \) -exec wc -l {} + | awk '$1>200 && $2!="total"'
echo "evidence tree: $(find "$EV" -type f | wc -l) files, $(du -sh "$EV" | cut -f1)"
