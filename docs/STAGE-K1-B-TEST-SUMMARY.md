# STAGE-K1-B Test Summary

```yaml
targeted_validator_tests: 11/11
targeted_status: PASS
full_npm_test: 458/458 PASS
npm_run_check: FAIL_ENVIRONMENT_MISSING_TSC
npm_audit_omit_dev: PASS_0_VULNERABILITIES
git_diff_check: PASS_WITH_EXISTING_CRLF_WARNINGS
npm_run_build: FAIL_ENVIRONMENT_MISSING_TYPESCRIPT_MODULE
npm_run_package_win: FAIL_ENVIRONMENT_MISSING_TYPESCRIPT_MODULE
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

The full test result was obtained with `npm test` (exit 0). The repository
environment does not contain the TypeScript CLI required by `npm run check`,
`npm run build`, and therefore `npm run package:win`; those commands fail at
the missing executable/module boundary before compiling K1-B. An isolated
strict typecheck of `planner-validator.ts` passes. No dependencies were
installed or changed to hide the environment condition.
