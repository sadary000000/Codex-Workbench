# ARCH-V2-5 FIX ROUND 1 Test Summary

~~~yaml
npm_run_check: PASS
source_full_suite: 336/336 PASS
arch_v2_5_targeted: 7/7 PASS
arch_v2_4_targeted: PASS
arch_v2_2_protocol_generation: PASS
isolated_build: PASS
isolated_package: PASS
npm_audit_omit_dev: 0 vulnerabilities
git_diff_check: PASS
secret_scan: PASS
real_business_prompts: 0
~~~

## Required npm test

The required unfiltered npm test was executed and returned 336/337:

- 336 source tests passed;
- one pre-existing test under
  dist-stage-arch-v2-5/review-staging/tests/arch-v2-5-policy.test.ts failed before
  test registration because review-staging/src/automation/canonical.ts is missing.

The user-owned staging directory was not deleted, regenerated, or modified to hide
the failure. The reproducible source-only command is:

~~~bash
node --experimental-strip-types --test tests/*.test.ts
~~~

It returned 336/336 PASS.

## Real protocol smoke

No real business Prompt was sent. The WEB-6.6 smoke completed with:

- descriptor ready from the running Workbench;
- VERSION_MISMATCH fixture PASS;
- CAPABILITY_NOT_SUPPORTED fixture PASS;
- status subprocess launch caveat exitCode 2147483651, disclosed rather than hidden.

## FIX ROUND 2 final verification

```yaml
npm_run_check: PASS
npm_test: 336/336 PASS
arch_v2_4_arch_v2_5_control_plane_targeted: 10/10 PASS
isolated_build: PASS
isolated_package: PASS
npm_audit_omit_dev: 0 vulnerabilities
git_diff_check: PASS
secret_scan: PASS
web6_6_packaged_status: PASS
web6_6_official_cli_runtime_status: PASS
version_mismatch: PASS
unsupported_capability: PASS
real_business_prompts: 0
```

最终 status evidence 使用隔离 packaged GUI host 和同一临时 userData 的
`Codex Workbench CLI Runtime.exe --workbench-official-cli`，不是启动第二个 GUI
EXE。直接 Control Plane 与 official CLI Runtime 都返回 `ok=true`、
`command=webgpt.status`、Workbench `READY`、WebGPT `UNAVAILABLE`。

历史 staging 测试目录保持原状；修复的是默认 test discovery 边界，不是删除该
目录来掩盖失败。
