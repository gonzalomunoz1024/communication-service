#!/bin/bash
# Runs the iteration-3 browser scripts (adapted to vf4 / the iteration-4 jar) one after the other; one line per script in regression-summary.txt.
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4
SUM=$S/results/regression-summary.txt
one() { # name, command...
  local name=$1; shift
  $S/scripts/run.sh "$name" "$@"; local rc=$?
  local pass=$(grep -c '^PASS ' $S/run-logs/$name.txt) fail=$(grep -c '^FAIL ' $S/run-logs/$name.txt)
  echo "$(date -u +%T) $name exit=$rc pass=$pass fail=$fail $(tail -1 $S/run-logs/$name.txt)" >> $SUM
}
for spec in "$@"; do
  case $spec in
    v7b) one v7b bash v7b-expired-lastEventId.sh;;
    *) one $spec node $(ls $S/scripts | grep "^$spec-.*\.js$\|^$spec\.js$" | head -1);;
  esac
done
echo "$(date -u +%T) DONE $*" >> $SUM
