# ARCH-V2-4 Test Summary — FIX ROUND 1

> **Current authoritative addendum:** FIX ROUND 2 has 322/322 tests, isolated build/package PASS, standard build lock FAIL_WITH_EVIDENCE, and current real-smoke results in `ARCH-V2-4-FIX-ROUND-2.md`.

## Gate summary

```yaml
npm_run_check: PASS
npm_test: PASS
tests: 317/317
arch_v2_4_targeted: PASS_WITH_DISCLOSED_BRIDGE_REATTACH_GAP
npm_run_build_standard: FAIL_WITH_EVIDENCE (EPERM: running EXE lock)
npm_run_package_standard: NOT_UPDATED (same lock)
isolated_build_package: PASS (dist-stage-arch-v2-4)
npm_audit_omit_dev: PASS / 0 vulnerabilities
git_diff_check: PASS
scoped_secret_scan: PASS
real_prompts: 0
```

## Covered contracts

- `control.auto` does not call global historical reconcile;
- production Arbiter lease correlation reaches ProviderRequest/ExternalRef/ResourceClaim;
- accepted provider side effect plus local persistence fault is UNKNOWN/recovery-only and never redispatched;
- authoritative dispatch context uses the existing scope-aware classifier and live facts;
- normal observation is `NOT_REQUIRED`; explicit reconcile is `RECONCILED`;
- 15 unrelated historical records do not block a free Browser;
- same-side-effect unknown, live lease busy and semantic drift fail closed;
- ARCH-V2-1/2/3 real regressions remain passing.

## Packaging note

The current running `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe` held the standard output path. The required command was therefore also executed with the task-scoped `CODEX_WORKBENCH_DIST=D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-4`; both build and package passed there. No process was force-terminated.
