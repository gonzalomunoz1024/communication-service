#!/usr/bin/env bash
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e2; O=$S/out; cd $O
node $S/scripts/ui_focus.js > ui-focus-run1.txt 2>&1; echo "exit=$?" >> ui-focus-run1.txt
node $S/scripts/pod_flows.js down degraded sigterm deadapp ordering capture pull logs > pod-flows-run1.txt 2>&1; echo "exit=$?" >> pod-flows-run1.txt
node $S/scripts/failure_flows.js kill mongo > failure-flows-run1.txt 2>&1; echo "exit=$?" >> failure-flows-run1.txt
node $S/scripts/pod_flows.js silence logs > pod-flows-silence-run1.txt 2>&1; echo "exit=$?" >> pod-flows-silence-run1.txt
echo "POD CHAIN DONE $(date -u +%FT%TZ)" > pod-chain-done.txt
