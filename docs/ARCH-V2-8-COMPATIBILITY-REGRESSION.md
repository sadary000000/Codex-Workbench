# ARCH-V2-8 Compatibility Regression — Reconciled

## Baseline

```yaml
repository: D:\办公\AI\Codex_Workbench_V1
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
round1ReviewCommit: 41467ceff78f7e59365233f4472c3e72d1355596
v1FrozenCoreChanged: false
technicalGate: FAIL_WITH_EVIDENCE
currentP1: 5
currentP2: 3
real_business_prompts: 0
new_business_chats: 0
```

## Automated regression

| Command / set | Result |
|---|---:|
| `npm run check` | PASS |
| `npm test` | PASS — 389/389 |
| ARCH-V2-1～7 contract/regression boundary | PASS — covered by full suite and targeted evidence |
| `npm run build` | `LOCKED_WITH_EVIDENCE` — 清理标准 package 资源时 EPERM；isolated package 已通过 |
| isolated `npm run package:win` | PASS |
| standard `npm run package:win` | `LOCKED_WITH_EVIDENCE` — running user EXE caused EPERM; no force kill |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS |
| scoped secret scan | PASS — no high-risk credential signatures |

## Real smoke evidence

| Probe | Result | Meaning |
|---|---|---|
| packaged protocol initialize/status | PASS | control plane starts through explicit activation and returns bounded status |
| protocol mismatch | PASS | returns `VERSION_MISMATCH` |
| unsupported capability | PASS | returns `CAPABILITY_NOT_SUPPORTED` before handler |
| WEB-6.4 arbiter | PASS | capacity=1, ownership/USER_CONTROL/release behavior verified |
| thread/turn business flow | `PAUSED_NOT_EXECUTABLE` | no real business Prompt/Chat allowed in this round |

## Current audit blockers

本轮回归未发现 V1 Frozen Core 被修改，但兼容性审计发现：strict protocol/capability enforcement 不完整；`map-coordinator`/`project-map-manager` 生产路径绕过 shared initialize validator；legacy Control Plane path 绕过 per-command gate；Recovery Provider Port 未接入生产 side-effect bridge/recover；migration identity 覆盖/断言不完整。以上 5 项为 `P1 / blocking=true / FAIL_WITH_EVIDENCE`，提交 GPT 决策，不在本轮修复。

## Interpretation

已验证的 0.147.0 resolver binary/provenance 路径本身可启动，但不能据此宣称整体 compatibility Gate 通过；上述生产覆盖缺口仍是当前 blocker。观察到的 Desktop 0.148.0-alpha.9 继续保持 `UNSUPPORTED`，不得静默放宽。

原始 WEB-6.6/WEB-6.4 JSON 证据已处于既有 dirty 删除状态；本轮只保留可核验摘要与脚本边界，不恢复或改写用户既有删除状态。
