#!/usr/bin/env bash
# samples the machine's load every 10 s (the sandbox is shared by five verifiers on 4 CPUs)
while [ ! -f /tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4/stop-loadlog ]; do
  echo "$(date -u +%FT%TZ) $(cut -d' ' -f1-3 /proc/loadavg)"
  sleep 10
done
