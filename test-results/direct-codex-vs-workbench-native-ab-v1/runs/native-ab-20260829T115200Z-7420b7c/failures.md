# Failures

- Command: npm test
- Result: 572 tests, 571 passed, 1 failed
- Failing test: tests/workspace-layout-contract.test.ts:10:1
- Assertion: workspace conversation shell must close
- Action: stop before model discovery; no retry; no A/B arm, warmup, or formal trial started.

This result is bound to the exact deferred execution target 7420b7c6ce93201641c7e79e33e05392602ebf01. The pre-start tooling note is retained in preflight/preflight-retry-note.txt; it executed no product gate and caused no duplicate measurement.
