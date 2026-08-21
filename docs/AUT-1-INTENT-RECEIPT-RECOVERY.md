# AUT-1 Intent / Attempt / Receipt / Recovery

## Intent-before-dispatch

外部动作必须先经过 `createActionIntent()`。只有已持久化的 Intent 被显式标记为 `DISPATCH_ELIGIBLE` 后，`createActionAttempt()` 才能记录尝试；当前 AUT-1 没有真实 dispatcher，不产生外部副作用。

```text
ActionIntent PLANNED
  -> DISPATCH_ELIGIBLE
  -> ActionAttempt CREATED / Intent DISPATCHING
  -> 外部执行（AUT-1 不实现）
  -> Receipt SUCCEEDED | FAILED | UNKNOWN
```

## 语义幂等

`semanticSha256` 来自稳定 canonical action descriptor：

```json
{
  "actionType": "...",
  "targetRef": "...",
  "sideEffectClass": "...",
  "payloadRef": "...",
  "payloadHash": "...",
  "expectedOutcomeRef": "...",
  "executionOptions": {}
}
```

descriptor 不包含 intentId、idempotencyRef、时间、executor 或 ActionAttempt 运行态。相同 project + idempotencyRef + semanticSha256 返回既有 Intent；同 key 但 payload、target、side effect、expected outcome 或 options 任一变化会抛 `AUTOMATION_CONFLICT`，不创建第二 Intent 或第二 ActionAttempt。schema 也拒绝同一 Intent 的重复 ActionAttempt 快照。

## 未知结果

`UNKNOWN` Receipt 会把 ActionAttempt 标记为 `UNCERTAIN / RECOVERY_REQUIRED`，Intent 保留 `UNCERTAIN`，不自动重发、不伪造成功。外部收据只保存状态、hash 和 opaque refs，不保存原始返回正文。

## Checkpoint

Checkpoint 在同一个 Automation transaction 内记录 project revision、当前 Stage、StepSpec、对应 StepRuntime、Attempt、最后 Intent/Receipt，以及 ResourceClaim、WorkspaceSnapshot、ExternalRef、Evidence 引用。`lastActionReceiptId` 的项目归属通过 receipt → actionAttempt → intent 推导。重新打开 Store 时按 schema 和引用完整性加载；损坏、跨项目、runtime/spec 不匹配或版本过新均 fail closed。

## 未实现边界

AUT-1 不执行 Codex Native Thread、WebGPT Chat、Browser 或文件操作，不实现 reconcile service、调度、自动 retry、Planner continuation 或人工审批 UI。后续阶段必须在 Receipt/外部证据确认后才允许把 `UNCERTAIN` 收敛为终态。
