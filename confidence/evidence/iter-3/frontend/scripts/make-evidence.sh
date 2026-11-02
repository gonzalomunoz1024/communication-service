#!/bin/bash
# Rebuilds confidence/evidence/iter-3/frontend/ from the scratch folder (idempotent). Frontend Verifier, iteration 3.
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend3
R=/home/claude/communication-service
EV=$R/confidence/evidence/iter-3/frontend
rm -rf "$EV"; mkdir -p "$EV/scripts" "$EV/results" "$EV/run-logs" "$EV/shots"
cp "$S"/scripts/*.js "$S"/scripts/*.py "$S"/scripts/*.sh "$S"/infra.sh "$S"/static/run-static.sh "$S"/make-evidence.sh "$EV/scripts/"
cp "$S"/run-logs/*.txt "$EV/run-logs/"
cp "$S"/results/*.txt "$EV/results/"; for f in infra-up infra-wait infra-down; do cp "$S/logs/$f.txt" "$EV/results/$f.txt"; done
cp "$S"/shots/*.png "$EV/shots/"
python3 -I - "$S/results" "$S/results-superseded" "$EV/results" <<'PY'
import json, glob, os, sys
dst = sys.argv[3]
for src in sys.argv[1:3]:
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
            else:
                o.write(json.dumps(d) + '\n')
PY
python3 -I "$S/scripts/aggregate.py" "$S/results" > "$S/results/aggregate.txt" && cp "$S/results/aggregate.txt" "$EV/results/aggregate.txt"

# backend logs of my private instances: counts, and the WARN/ERROR lines trimmed (no secrets: local URIs only)
{
  echo "# private backends (iteration-3 jar): ERROR / WARN line counts, then backend C's WARN lines (Mongo outages of v7, v7d, v7e), cut at 190 chars"
  for p in 19200 19201 19202; do f=$S/logs/backend-$p.txt; echo "backend :$p  lines=$(wc -l < $f)  ERROR=$(grep -c ' ERROR ' $f)  WARN=$(grep -c ' WARN ' $f)  stack-trace lines=$(grep -cE '^\s+at ' $f)"; done
  echo; echo "## backend C (:19202) WARN lines by logger"
  python3 -I -c 'import re,sys,collections; c=collections.Counter(); [c.update([(m.group(1)+" : "+re.sub(r"/[0-9a-f-]{36}/","/{id}/",m.group(2))[:48])]) for l in open(sys.argv[1]) for m in [re.search(r" WARN \d+ --- \[[^]]*\] \[[^]]*\] (\S+)\s+: (.*)$", l)] if m]; [print(f"{n:5d}  {k}") for k,n in c.most_common()]' $S/logs/backend-19202.txt
  echo; echo "## backend C WARN/INFO readiness and stream lines (first 60)"
  grep -E ' WARN |readiness' $S/logs/backend-19202.txt | sed -E 's/^([0-9T:.-]+)[^ ]* +(WARN|INFO) [0-9]+ --- \[[^]]*\] \[[^]]*\] /\1 \2 /' | cut -c1-190 | head -60
} > "$EV/results/backend-logs-summary.txt"

# static checks: the summary, then the relevant lines of every step
{
  echo "# Frontend static checks at e3968c4 (scripts/run-static.sh; full outputs in the scratch folder, relevant lines here)"
  cat "$S/static/summary.txt"; echo
  for f in 01-lint-run1 14-lint-run2 15-lint-run3 02-typecheck-run1 16-typecheck-run2 17-typecheck-run3; do echo "## $f"; grep -v '^$' "$S/static/$f.txt" | tail -3; done
  for f in 03-build-run1 18-build-run2 19-build-run3 11-default-tenant-build 12-xorigin-build 13-badclientid-build; do echo "## $f"; grep -E 'kB|built in|error' "$S/static/$f.txt" | sed -E 's#^.*/(dist[^/]*/)#\1#'; done
  echo "## bundles byte-identical across the three builds"; (cd $S && sha256sum dist/assets/* dist-run2/assets/* dist-run3/assets/* | sed -E 's#  # #' | awk '{print substr($1,1,16), $2}')
  for f in 04-test-run1 05-test-run2 06-test-run3 07-coverage; do echo "## $f"; grep -E 'Test Files|Tests +[0-9]|Duration|skipped|todo|failed' "$S/static/$f.txt"; done
  echo "## 08-audit / 09-audit-omit-dev"; cat "$S/static/08-audit.txt" "$S/static/09-audit-omit-dev.txt"
  echo "## 10-audit-json (metadata)"; python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(d.get('metadata'), indent=0))" "$S/static/10-audit-json.txt" 2>/dev/null || grep -A20 metadata "$S/static/10-audit-json.txt"
  echo "## minimatch override still in place (G-2-13)"; grep -n -A3 '"overrides"' $R/frontend/package.json; (cd $R/frontend && npm ls minimatch 2>/dev/null | head -8)
} > "$EV/static-checks.txt"

# coverage: the v8 table, then the iteration-3 source lines against it
{
  echo "# vitest --coverage (v8) at e3968c4, from static/07-coverage.txt"
  sed -n '/Coverage report from/,$p' "$S/static/07-coverage.txt" | sed -E 's/\x1b\[[0-9;]*m//g'
  echo; echo "# iteration-3 source changes (git diff -U0 be19645..e3968c4 -- frontend/src ':!frontend/src/test') against the line coverage of the HTML report"
  cat "$S/static/changed-lines-coverage.txt"
} > "$EV/coverage.txt"
cp "$S/static/test-names.txt" "$EV/test-names.txt"
cp "$S/static/test-diff.txt" "$EV/test-diff.txt"
{
  echo '$ git rev-parse HEAD; git log -1 --format="%h %cI %s"; git branch --show-current'; git -C $R rev-parse HEAD; git -C $R log -1 --format='%h %cI %s'; git -C $R branch --show-current
  echo; echo '$ git diff --stat be19645..e3968c4 -- frontend/ (the iteration-3 frontend change set)'; git -C $R diff --stat be19645..e3968c4 -- frontend/ | tail -16
  echo; echo '$ git status --short (at evidence time; other verifiers own the other untracked folders)'; git -C $R status --short
} > "$EV/commit.txt"
echo "files over 200 lines (should be none):"; find "$EV" -type f \( -name '*.txt' -o -name '*.js' -o -name '*.sh' -o -name '*.py' \) -exec wc -l {} + | awk '$1>200 && $2!="total"'
echo "evidence tree: $(find "$EV" -type f | wc -l) files, $(du -sh "$EV" | cut -f1)"
