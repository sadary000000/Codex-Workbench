# ARCH-V2-8 Stage Review — Final Manifest Reconciliation

```yaml
stage: ARCH-V2-8
technicalGate: FAIL_WITH_EVIDENCE
status: GPT_REVIEW_REQUIRED_WITH_BLOCKERS
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
round1ReviewCommit: 41467ceff78f7e59365233f4472c3e72d1355596
finalFrozen: false
v1FrozenCoreChanged: false
P0: 0
P1: 5
P2: 3
real_business_prompts: 0
new_business_chats: 0
running_subagents: 0
```

## Round 2 scope

本轮只做 Final Freeze 文档、Manifest、hash/provenance 和一致性审计，不做产品 redesign，不进入 AUT-2/AUT-3，不创建业务 Chat，不发送业务 Prompt。ROUND 1 已关闭的历史项作为 `HISTORICAL_RESOLVED` 证据保留；Round 2 新发现的 5 个 P1 必须保留为当前 blocker。

## Reconciled results

- Final Manifest、Reality、Capability Matrix、Frozen Contract、Compatibility Regression、Deferred Debt、Architecture Baseline、Stage Review、Test Summary 和 Source Evidence Index 统一引用 implementation head `926440739ef3ca4a35a41f9d8b6537b31ac66d25`。
- 当前 blocker 计数为 `P0=0`、`P1=5`；另有 3 个非阻塞 P2。
- `technicalGate=FAIL_WITH_EVIDENCE`、`status=GPT_REVIEW_REQUIRED_WITH_BLOCKERS`、`finalFrozen=false` 在全部最终文档中一致。
- 0.147.0 resolver provenance/initialize/capability 路径为 `SUPPORTED_WITH_COMPATIBILITY_PATH`；观察到的 0.148.0-alpha.9 为 `UNSUPPORTED`，不静默兼容。
- WEB-6.6 protocol smoke 与 WEB-6.4 arbiter smoke PASS；真实业务 Prompt/Chat 数量均为 0；这些 smoke 不能覆盖当前 5 个生产路径 P1。

## New evidence requiring GPT direction

| ID | Current result |
|---|---|
| P1-01 | strict `protocolVersion` / requested `experimentalApi` enforcement incomplete |
| P1-02 | map/project-map production App Server paths bypass shared initialize validator |
| P1-03 | legacy Control Plane path bypasses per-command capability enforcement |
| P1-04 | Recovery Provider Port production side-effect bridge/recover wiring missing |
| P1-05 | production migration identity coverage/assertion incomplete |

These are `FAIL_WITH_EVIDENCE`, not deferred and not fixed in Round 2. Ordinary startup `app_ready` logger side effect is recorded as a boundary question, not counted as P0 under the current scope.

## Verification boundary

`npm test` 的 389/389、check/audit、isolated package 和 ROUND 1 smoke 证据可复用；本轮现场 `npm run build` 在清理标准 package 资源时收到 EPERM，记录为 `LOCKED_WITH_EVIDENCE`，没有强杀用户进程。本轮不重复真实业务 smoke。原始 WEB-6.6/WEB-6.4 JSON 属于既有 dirty 删除状态，审查包不声称其 raw JSON 自包含重放。

## Subagents

5 个只读子代理分别完成 Manifest/hash、Capability/provenance、Frozen Contract/P2、Regression/package 和独立 challenge 审计；其结果在最终生成前审核，Gate 时 `running_subagents=0`。

## Gate

```text
[ARCH_V2_8_FIX_ROUND_2_REVIEW_READY]
requested_gate: FIX_REQUIRED
result: FAIL_WITH_EVIDENCE
```
