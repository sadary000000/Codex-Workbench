# AUT-1 Intent / Attempt / Receipt / Recovery

## Intent-before-dispatch

外部动作必须先经过 `createActionIntent()`。只有已持久化的 Intent 被显式标记为 `DISPATCH_ELIGIBLE` 后，`createActionAttempt()` 才能记录尝试；当前 AUT-1 没有任何真实 dispatcher，因此不会产生外部副作用。

```text
ActionIntent PLANNED
  -> DISPATCH_ELIGIBLE
  -> ActionAttempt CREATED / Intent DISPATCHING
  -> 外部执行（AUT-1 不实现）
  -> Receipt SUCCEEDED | FAILED | UNKNOWN
```

## 幂等

`idempotencyRef` 在同一 Project 内用于去重。同 key 且 actionType/targetRef/sideEffectClass 相同会返回已有 Intent；语义不同会抛出 `AUTOMATION_CONFLICT`，不会创建第二个动作。

## 未知结果

`UNKNOWN` Receipt 会把 ActionAttempt 标记为 `UNCERTAIN` / `RECOVERY_REQUIRED`，Intent 保留 `UNCERTAIN`，不自动重发、不伪造成功。外部收据仅保存状态、hash 和 opaque refs，不保存原始返回正文。

## Checkpoint

Checkpoint 在同一个 Automation transaction 内记录 project revision、当前 StepSpec/Attempt、最后 Intent/Receipt，以及 ResourceClaim、WorkspaceSnapshot、ExternalRef、Evidence 的引用。重新打开 Store 时按 schema 和引用完整性加载；损坏或版本过新则 fail closed。

## 未实现的边界

AUT-1 不执行 Codex Native Thread、WebGPT Chat、Browser 或文件操作，不实现 reconcile service、调度、自动 retry、Planner continuation 或人工审批 UI。后续阶段必须在验证 Receipt/外部证据后才允许把 `UNCERTAIN` 收敛为终态。
