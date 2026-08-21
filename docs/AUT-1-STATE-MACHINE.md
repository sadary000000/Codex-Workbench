# AUT-1 State Machine

## 原语

`StateMachine<S, E>` 只接受显式定义的 `(from, event) -> to`。未定义的转移抛出 `StateTransitionError`，Store 映射为 `AUTOMATION_STATE_TRANSITION_INVALID`；不存在隐式 fallback、状态替换或第二条事实源。

## StepSpec 与 StepRuntime 分离

```text
StepSpec (immutable definition)
  id / stage / key / specVersion / kind / goal / risk / sideEffect / specStatus

StepRuntime (mutable execution state)
  stepSpecId / lifecycle / terminalResult / waitReason
  currentAttemptId / revision / createdAt / updatedAt
```

StepSpec 只有：

```text
ACTIVE -> SUPERSEDED
```

运行态只在 StepRuntime 上变化：

```text
NOT_STARTED -> READY -> RUNNING -> VERIFYING -> REVIEWING -> TERMINAL
READY/RUNNING -> TERMINAL (CANCEL)
RUNNING/VERIFYING/REVIEWING -> TERMINAL (FAIL)
```

`waitReason` 是等待原因标签，不伪造新的状态机事实：`NONE | RESOURCE | HUMAN | EXTERNAL | USER_CONTROL | RATE_LIMIT`。

## 其他状态机

### AutomationProject

```text
DRAFT -> ALIGNING_REQUIREMENTS -> REQUIREMENTS_CONFIRMED -> PLANNING -> READY -> RUNNING
RUNNING -> PAUSED | BLOCKED | COMPLETED | FAILED
PAUSED -> RUNNING | BLOCKED | CANCELLED
BLOCKED -> PAUSED | CANCELLED
```

### ExecutionAttempt

```text
CREATED -> RUNNING
RUNNING -> COMPLETED | FAILED | BLOCKED | CANCELLED | UNCERTAIN
UNCERTAIN -> COMPLETED (RECONCILE) | RECOVERY_REQUIRED
```

ExecutionAttempt 的 `stepSpecId` 永远指向创建时的精确 StepSpec；Attempt 的启动/终态变化会在同一 transaction 同步对应 StepRuntime 的运行态。

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

Store 的 `transition*()` 在同一个 transaction 中读取状态、计算下一个状态、更新实体、递增 revision、追加 AuditEvent、校验并提交。StepRuntime 与 ExecutionAttempt 的关联更新也在同一 draft 中完成。任一环节失败，state、runtime 和 audit 都回滚；测试覆盖非法转移和重复动作尝试不产生持久化污染。

## 范围边界

AUT-1 不实现 Workflow/Verifier/Review 模型、调度、自动 retry、真实 dispatcher、人工审批 UI 或多进程协调。JSON store 的单写者/跨进程限制见 `AUT-1-PERSISTENCE-ADR.md`。
