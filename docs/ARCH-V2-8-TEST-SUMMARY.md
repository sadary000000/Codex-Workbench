# ARCH-V2-8 Test Summary — Reconciled

```yaml
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
technicalGate: FAIL_WITH_EVIDENCE
finalFrozen: false
P0: 0
P1: 5
P2: 3
```

## Automated checks

本轮自动化命令与既有 isolated smoke 通过，但不覆盖 5 个当前 P1 生产路径缺口；因此总体 Gate 不是 PASS。

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 389/389 |
| `npm run build` | `LOCKED_WITH_EVIDENCE` — 标准 package 资源被运行中的用户 EXE 占用 |
| isolated `npm run package:win` | PASS |
| standard `npm run package:win` | `LOCKED_WITH_EVIDENCE` — user process owns EXE lock |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS |
| scoped secret scan | PASS |
| final-doc consistency scan | PASS (ROUND 2 gate) |
| manifest/package hash verification | PASS (sidecars) |

## Reused smoke evidence

- WEB-6.6 protocol smoke：PASS；initialize/status、version mismatch 和 unsupported capability 均有真实隔离 packaged 证据。
- WEB-6.4 arbiter smoke：PASS；capacity=1、USER_CONTROL 和释放行为通过。
- 真实业务 Prompt：0。
- 新业务 Chat：0。

原始 WEB-6.6/WEB-6.4 smoke JSON 已处于既有 dirty 删除状态；本轮不恢复用户文件，报告只引用摘要、脚本边界和已核验 package/provenance。

## Scope limitation

会创建 Native Thread 或发送业务 Prompt 的业务 real smoke 在本轮仍保持暂停；不将 `TEST_ONLY` 或 `PAUSED_NOT_EXECUTABLE` 能力写成生产 real business PASS。

当前 P1：strict protocol/capability enforcement、production App Server shared validator bypass、legacy per-command capability bypass、Recovery production side-effect wiring、migration identity coverage/assertion。它们均已记录在 Manifest 与 Stage Review，等待 GPT。
