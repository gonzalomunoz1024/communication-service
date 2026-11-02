# Iteration-4 audit: partial working files

The independent audit of iteration 4 was stopped at 12:43Z on 2026-11-02, at Gonzalo's request, before it wrote
`confidence/iter-4/audit.md`. These are its working files as they stood. They hold replays and measurements, not rulings:
no score, gate or test-weakening verdict was issued for iteration 4.

- `00-claims-and-sample.txt`: the verifiers' claims and the random sample drawn from them
- `01-test-weakening-check.txt`: the diff of test code and test configuration over 6c15715..1cd3f13 and 191a0c5..1cd3f13
- `07-security-scans.txt`: Trivy (SBOMs, images), govulncheck and npm audit, with two control scans
- `20-…` to `60-…`: test reruns and replays of sampled backend, frontend, sidecar and usability claims
- `22-backend-gate1-frozen-db.txt`: GAP-backend4-1 reproduced with `mongod` frozen, iteration-3 and iteration-4 jars side by side
- `70-code-reads.txt`: the code read for the gate questions

`confidence/FINAL-REPORT.md` §1 says what these files support and what stays unruled.
