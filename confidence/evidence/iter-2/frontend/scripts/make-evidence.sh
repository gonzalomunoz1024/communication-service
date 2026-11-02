#!/bin/bash
# Rebuilds confidence/evidence/iter-2/frontend/{scripts,results,run-logs,shots} from the scratch folder (idempotent).
set -u
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2
EV=/home/claude/communication-service/confidence/evidence/iter-2/frontend
rm -rf "$EV/scripts" "$EV/results" "$EV/run-logs" "$EV/shots"; mkdir -p "$EV/scripts" "$EV/results" "$EV/run-logs" "$EV/shots"
cp "$S"/scripts/*.js "$S"/scripts/*.py "$S"/scripts/*.sh "$S"/infra.sh "$S"/static/run-static.sh "$S"/make-evidence.sh "$EV/scripts/"
cp "$S"/run-logs/*.txt "$EV/run-logs/"
cp "$S"/results/*.txt "$EV/results/"
cp "$S"/shots/*.png "$EV/shots/"
python3 -I - "$S/results" "$EV/results" <<'PY'
import json, glob, os, sys
src, dst = sys.argv[1], sys.argv[2]
for f in sorted(glob.glob(src + '/*.json')):
    base = os.path.basename(f)[:-5]
    d = json.load(open(f))
    out = dst + '/' + base + '.jsonl.txt'
    with open(out, 'w') as o:
        if isinstance(d, list):
            if d and isinstance(d[0], dict) and 'feature' in d[0]:
                o.write('# one check per line: PASS/FAIL | feature | check | evidence (full, not truncated to 400 chars like the run log)\n')
                for r in d:
                    o.write(f"{'PASS' if r['ok'] else 'FAIL'} | {r['feature']} | {r['name']} | {r['evidence']}\n")
            else:
                o.write('# one element per line\n')
                for r in d: o.write(json.dumps(r, ensure_ascii=False) + '\n')
        elif isinstance(d, dict):
            o.write('# one top-level key per line\n')
            for k, v in d.items(): o.write(f'{k}: {json.dumps(v, ensure_ascii=False)}\n')
        else:
            o.write(json.dumps(d))
PY
python3 -I "$S/scripts/aggregate.py" "$S/results" > "$EV/results/aggregate.txt"
echo "files over 200 lines (should be none):"; find "$EV" -name '*.txt' -o -name '*.js' -o -name '*.sh' -o -name '*.py' | xargs wc -l 2>/dev/null | awk '$1>200 && $2!="total"'
echo "evidence tree:"; find "$EV" -type f | wc -l; du -sh "$EV"
