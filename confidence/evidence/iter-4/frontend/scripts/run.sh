#!/bin/bash
# runs one check script, keeps its console output as run-logs/<name>.txt and appends the exit code and wall time
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4
name=$1; shift
cd $S/scripts || exit 99
t0=$(date +%s)
echo "== $(date -u +%FT%TZ) start: $* (commit $(git -C /home/claude/communication-service rev-parse --short HEAD))" > $S/run-logs/$name.txt
"$@" >> $S/run-logs/$name.txt 2>&1; rc=$?
echo "EXIT $rc ($(( $(date +%s) - t0 )) s)" >> $S/run-logs/$name.txt
exit $rc
