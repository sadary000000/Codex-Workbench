# Direct Codex vs Workbench Native A/B — protocol 1.1.0

- runId: native-ab-20260829T151810Z-8b7f91
- exact tested commit: 8b7f91e98893bd5b098ca9df93190540ae3efc0d
- verdict: INCONCLUSIVE
- performance assessment: INCONCLUSIVE
- release recommendation: RETEST_REQUIRED

Repository gates passed (targeted 12/12; full 615/615), static parity passed, and no model-visible Workbench injection was observed. Case 1 was comparable at 4/4 success per arm (Workbench median delta -101.85 ms; ratio 0.9841). Case 2 ended with 3/4 success per arm: one Direct output had a prohibited prose prefix and the final Workbench observation ended with usageLimitExceeded. The failed quota observation was preserved and not retried. Case 3 could not start, so the required evidence set cannot support a semantic or performance conclusion.
