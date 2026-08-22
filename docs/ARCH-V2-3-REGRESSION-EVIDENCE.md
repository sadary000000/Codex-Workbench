# ARCH-V2-3 Regression Evidence

## Required architecture regressions

- ARCH-V2-1 Native equivalence / optional feature isolation: covered by the existing Native, Map OFF/ON and identity tests in the full suite.
- ARCH-V2-2 Shared CodexHost / generated protocol / runtime dedup: covered by shared-host, protocol, multi-thread and crash/restart tests in the full suite.
- Native identity remains `nativeThreadId`; no replacement Thread or second conversation truth was introduced.
- Map maintenance remains isolated; no Map runtime or Renderer rewrite was made.

## Current automated result

```yaml
npm_run_check: PASS
npm_test: PASS
tests: 308/308
```

Real App Server and package commands are recorded in `ARCH-V2-3-TEST-SUMMARY.md` after execution. No real WebGPT Prompt is part of this stage.
