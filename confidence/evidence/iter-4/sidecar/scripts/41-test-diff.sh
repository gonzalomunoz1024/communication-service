#!/bin/bash
# 41: were sidecar tests skipped, deleted or loosened between the iteration-3 code (6c15715) and the code under test
# (1cd3f13 = aa37365's code)? Read-only git queries.
cd /home/claude/communication-service
echo "### 1. sidecar and CI files differ between 1cd3f13 and HEAD ($(git rev-parse --short HEAD))?"
git diff --quiet 1cd3f13 HEAD -- sidecar .github; echo "  git diff --quiet 1cd3f13 HEAD -- sidecar .github -> exit $? (0 = identical)"
echo "### 2. test files changed 6c15715..1cd3f13 (added / removed lines)"
git diff --numstat 6c15715 1cd3f13 -- 'sidecar/**/*_test.go' 'sidecar/*_test.go' | sed 's/^/  /'
echo "### 3. test functions removed or renamed (func Test... lines with '-' and no matching '+')"
git diff -U0 6c15715 1cd3f13 -- 'sidecar/**/*_test.go' | grep -E '^[-+]func Test' | sort | sed 's/^/  /'
echo "  (only '+' lines = tests added; a '-' line without its '+' twin = a test removed or renamed)"
echo "### 4. every removed line in sidecar test files (assertions loosened?)"
git diff -U0 6c15715 1cd3f13 -- 'sidecar/**/*_test.go' | grep -E '^-[^-]' | sed 's/^/  /' | cut -c1-220
echo "### 5. t.Skip / t.SkipNow / testing.Short in the sidecar tests at 1cd3f13"
git grep -n -E 't\.Skip|SkipNow|testing\.Short' 1cd3f13 -- 'sidecar/*_test.go' 'sidecar/**/*_test.go' | sed 's/^/  /' | cut -c1-220
echo "### 6. the same at 6c15715 (to compare)"
git grep -n -E 't\.Skip|SkipNow|testing\.Short' 6c15715 -- 'sidecar/*_test.go' 'sidecar/**/*_test.go' | sed 's/^/  /' | cut -c1-220
echo "### 7. tests that fixes.md says were touched (sidecar)"
grep -n -i -E 'sidecar.*_test\.go|_test\.go.*sidecar|touched' confidence/iter-4/fixes.md | cut -c1-240 | head -20
