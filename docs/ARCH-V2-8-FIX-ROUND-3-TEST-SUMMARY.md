# ARCH-V2-8 FIX ROUND 3 Test Summary

```yaml
npm_run_check: PASS
npm_test: 392/392 PASS
round3_targeted_contract: 6/6 PASS
arch_v2_1_to_7_selected_regression: 67/67 PASS
arch_v2_2_protocol_generation: PASS
npm_audit_omit_dev: 0 vulnerabilities
git_diff_check: PASS_WITH_NORMAL_LF_CRLF_WARNINGS
scoped_secret_scan: PASS
isolated_build: PASS
isolated_package: PASS
standard_build: LOCKED_WITH_EVIDENCE
standard_package: LOCKED_WITH_EVIDENCE
real_business_prompts: 0
new_business_chats: 0
```

真实无副作用 initialize 探针：

```yaml
response_keys: codexHome, platformFamily, platformOs, userAgent
protocolVersion: null
capabilities: null
strict_result: VERSION_MISMATCH
thread_started: false
turn_started: false
prompt_sent: false
```

标准 package 的 EPERM 目标是正在运行的 `dist/package/Codex Workbench V1.exe`；没有终止用户进程。隔离输出使用 `dist-stage-arch-v2-8-fix-round-3`，构建与打包均通过。
