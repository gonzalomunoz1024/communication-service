#!/bin/sh
cd /home/claude/communication-service/frontend || exit 9
for i in 1 2 3; do echo "== typecheck run $i ($(date -u +%T))"; npm run typecheck; echo "TYPECHECK_RC_$i=$?"; done
for i in 1 2 3; do echo "== build run $i ($(date -u +%T))"; npm run build; echo "BUILD_RC_$i=$?"; done
for i in 1 2 3; do echo "== test run $i ($(date -u +%T))"; npm test; echo "TEST_RC_$i=$?"; done
echo "== npm audit --omit=dev"; npm audit --omit=dev; echo "AUDIT_PROD_RC=$?"
echo "== npm audit"; npm audit; echo "AUDIT_ALL_RC=$?"
echo "== npm audit --json"; npm audit --json
echo "== ls -la dist"; ls -la dist dist/assets
echo "ALL_DONE"
