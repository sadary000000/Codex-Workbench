# STAGE-K1-B Test Summary

```yaml
targeted_validator_tests: 11/11
targeted_status: PASS
full_npm_test: 458/458 PASS
npm_run_check: PASS
npm_audit_omit_dev: PASS_0_VULNERABILITIES
git_diff_check: PASS_WITH_EXISTING_CRLF_WARNINGS
npm_run_build: PASS
npm_run_package_win: PASS
dependency_restore: PASS_NPM_CI_INCLUDE_DEV
electron_runtime: PASS_43.3.0
isolated_validator_typecheck: PASS
real_planner_prompts: 0
new_business_chats: 0
executed_steps: 0
new_native_threads: 0
```

The targeted result was obtained with:

```text
node --experimental-strip-types --test tests/stage-k1-b-validator-jit.test.ts
```

The full test result was obtained with `npm test` (exit 0). The missing
development dependencies were restored from the existing lockfile with
`npm ci --include=dev`; no package manifest or lockfile change was made. The
TypeScript transition signature then received a one-line type fix in
`0a9df72108af475beb32f712c653ab0cc639826e`. Check, build, Windows packaging,
audit, targeted tests, and full tests now pass. An isolated strict typecheck
also passes.
