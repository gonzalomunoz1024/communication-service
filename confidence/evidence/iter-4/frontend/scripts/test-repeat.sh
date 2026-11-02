#!/bin/bash
# Repeats `npm test` (and once the coverage run) in frontend/, logging the 1-minute load average before and after each run.
# Usage: test-repeat.sh <label> <n> [extra vitest args...]   (extra args only for the diagnostic run, never for a scored run)
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4
O=$S/static/repeat; label=$1; n=$2; shift 2
cd /home/claude/communication-service/frontend || exit 99
for i in $(seq 1 $n); do
  la0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date +%s%N)
  ${PIN:+taskset -c $PIN} npm test -- "$@" > $O/$label-$i.txt 2>&1; rc=$?  # PIN=<cpu> confines the run to one CPU (diagnostic only)
  t1=$(date +%s%N); la1=$(cut -d' ' -f1 /proc/loadavg)
  res=$(grep -E "^\s+Tests " $O/$label-$i.txt | tr -s ' ' | sed 's/^ //'); fails=$(grep -E "^ FAIL " $O/$label-$i.txt | sed 's/^ FAIL  //' | tr '\n' ';' | cut -c1-400)
  printf '%s | %s-%d | exit %d | %d.%01ds | load %s -> %s | %s | %s\n' "$(date -u +%T)" "$label" "$i" "$rc" "$(( (t1-t0)/1000000000 ))" "$(( (t1-t0)/100000000 % 10 ))" "$la0" "$la1" "$res" "$fails" >> $O/summary.txt
done
