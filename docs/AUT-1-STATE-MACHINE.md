# AUT-1 State Machine

## 原语

`StateMachine<S, E>` 只接受显式定义的 `(from, event) -> to`。未定义的转移抛出 `StateTransitionError`，Store 将其映射为 `AUTOMATION_STATE_TRANSITION_INVALID`。不存在隐式 fallback 或状态替换。

## 当前状态表

### AutomationProject

```text
DRAFT -> ALIGNING_REQUIREMENTS -> REQUIREMENTS_CONFIRMED -> PLANNING -> READY -> RUNNING
RUNNING -> PAUSED | BLOCKED | COMPLETED | FAILED
PAUSED -> RUNNING | BLOCKED | CANCELLED
BLOCKED -> PAUSED | CANCELLED
```

### StepSpec（AUT-1 provisional）

```text
NOT_STARTED -> READY | SUPERSEDED
READY -> RUNNING | TERMINAL | SUPERSEDED
RUNNING -> VERIFYING | TERMINAL
VERIFYING -> REVIEWING | TERMINAL
REVIEWING -> TERMINAL
```

### ExecutionAttempt

```text
CREATED -> RUNNING
RUNNING -> COMPLETED | FAILED | BLOCKED | CANCELLED | UNCERTAIN
UNCERTAIN -> COMPLETED (RECONCILE) | RECOVERY_REQUIRED
```

### ActionIntent / ActionAttempt

```text
ActionIntent:
PLANNED -> DISPATCH_ELIGIBLE -> DISPATCHING -> DISPATCHED
DISPATCHING -> UNCERTAIN | RECOVERY_REQUIRED
DISPATCHED -> COMPLETED | FAILED | UNCERTAIN
UNCERTAIN -> COMPLETED (RECONCILE) | RECOVERY_REQUIRED
DISPATCH_ELIGIBLE -> CANCELLED

ActionAttempt:
CREATED -> RUNNING | UNCERTAIN
RUNNING -> COMPLETED | FAILED | UNCERTAIN
UNCERTAIN -> RECOVERY_REQUIRED
```

## 原子性

Store 的 `transition*()` 在同一个 transaction 中完成：读取当前状态、计算下一个状态、更新实体、递增必要 revision、追加 AuditEvent、校验并提交。任一环节失败，state 和 audit 都回滚。测试覆盖了非法转移不新增审计事实的情况。

## 保留说明

AUT-1 不把 StepSpec 的 provisional runtime status 扩展成完整 Workflow/Verifier/Review 模型；Stage/Step runtime 拆分、审批策略和自动重试属于后续审查范围，不在本阶段偷偷实现。
