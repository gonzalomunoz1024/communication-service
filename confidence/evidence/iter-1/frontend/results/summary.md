# Frontend verifier: automated browser checks, aggregated per feature (iteration 1) — scripts in scripts/, raw JSON in results/, console logs in run-logs/; run with `python3 scripts/aggregate.py results`

| file | passed | failed |
|---|---|---|
| t1-shell-theme-form.json | 55 | 0 |
| t2-publish-errors.json | 37 | 0 |
| t3-feed.json | 48 | 1 |
| t4-reconnect-sigkill.json | 9 | 0 |
| t4b-replay-in-browser.json | 6 | 0 |
| t5-a11y.json | 30 | 0 |
| t6-xorigin.json | 3 | 0 |
| t7-iter1-gaps.json | 11 | 0 |
| t8-focus-after-resolve.json | 1 | 1 |

| feature | checks passed | checks failed | failed checks |
|---|---|---|---|
| F-01 | 1 | 0 | - |
| F-02 | 5 | 0 | - |
| F-06 | 3 | 0 | - |
| F-07 | 2 | 0 | - |
| F-09 | 2 | 0 | - |
| F-14 | 2 | 0 | - |
| F-15 | 3 | 0 | - |
| F-16 | 4 | 0 | - |
| F-20 | 4 | 0 | - |
| F-27 | 1 | 0 | - |
| F-52 | 13 | 0 | - |
| F-53 | 9 | 0 | - |
| F-54 | 21 | 0 | - |
| F-55 | 20 | 0 | - |
| F-56 | 15 | 0 | - |
| F-57 | 14 | 0 | - |
| F-58 | 8 | 0 | - |
| F-59 | 10 | 0 | - |
| F-60 | 7 | 0 | - |
| F-61 | 11 | 0 | - |
| F-62 | 7 | 2 | t3-feed.json: G-1-15: after resolving, the live region announces 'Resolved “<title>”. It has left every consumer's feed.' and focus moves to the list<br>t8-focus-after-resolve.json: G-1-15 focus after resolve (single item, resolve it): focus is on the list container (div tabindex=-1), not lost to <body> |
| F-63 | 4 | 0 | - |
| F-64 | 2 | 0 | - |
| F-65 | 32 | 0 | - |
