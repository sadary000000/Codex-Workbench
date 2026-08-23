# Architecture Baseline v2 — Final Candidate Before Human Freeze

```yaml
stage: ARCH-V2-8
technicalGate: FAIL_WITH_EVIDENCE
status: GPT_REVIEW_REQUIRED_WITH_BLOCKERS
finalFrozen: false
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
P0: 0
P1: 5
P2: 3
```

## Frozen architecture candidate

```text
Native Thread
  → 唯一 Conversation identity
Native Turn / Native Item
  → 唯一消息与运行事实
Codex App Server
  → V1 Runtime 主路径
Workbench
  → 产品壳 + UI projection + minimal persistence/recovery + Map enhancement
WebGPT extension
  → Electron browser runtime + CLI + Control Plane + Request/Role/Project boundary
```

## Explicit non-goals

不存在第二套 Conversation truth、Transcript truth、Task truth、隐藏替代 Thread 或 exec-history reconstruction。Request Journal 只记录 request/recovery correlation，不重建 Workflow truth。

## Readiness boundary

当前技术 Gate 因 5 个 P1 证据未通过，必须先由 GPT 审查决定修复范围。即使 P1 关闭，用户确认前仍不能写 `FINAL_FROZEN`，不能把 `finalFrozen` 改为 `true`，也不能启动 AUT-2/AUT-3。

## Current blockers

P1-01 strict protocol/capability enforcement；P1-02 production map/project-map raw initialize bypass；P1-03 legacy per-command capability bypass；P1-04 recovery production side-effect bridge/recover wiring；P1-05 migration identity coverage/assertion。详见 `ARCH-V2-8-REALITY.md`。

## Compatibility rule

生产 App Server 必须经过 binary provenance、initialize、协议/版本/能力验证。当前 verified resolver 是 0.147.0；观察到的 0.148.0-alpha.9 不在 allowlist 内，状态为 `UNSUPPORTED`，不得静默放宽。
