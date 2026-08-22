# AUT-2 Fix11 — Scope-aware Preflight Predicate Audit

## 原有问题

旧 AUT-3 前置条件使用：

```text
activeSummary().length === 0
```

而 `activeSummary()` 返回所有不属于 `COMPLETED / FAILED / CANCELED` 的记录。因此历史 `RECOVERY_REQUIRED`、`PAUSED_FOR_USER` 和 `QUEUED` 会被当成当前 active，导致与当前 Planner/Requirement action 无关的记录也全局阻塞。

AUT-2 还会调用 `WebGptRequestManager.automationControl()`，该路径会执行全量 `reconcilePending()`，可能导航/恢复所有历史 `RECOVERY_REQUIRED`/`INDETERMINATE` 请求，违反 Fix11 的无盲目恢复要求。

## Fix11 predicate

新增 `src/automation/webgpt-action-readiness.ts`，只做纯内存派生：

```text
action scope
  + runtime Browser diagnostics
  + active request ids
  + requestStatus(id, reconcile=false)
        ↓
derived dispositions
        ↓
action-scoped blockers
```

分类：

```text
ACTIVE_BLOCKING
SAFE_TO_RECONCILE
STALE_CANDIDATE
HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE
UNKNOWN_BLOCKING
```

判定原则：

1. Browser lease、active operation、active request 或 queue 非空，整个 action 阻塞；
2. 同目标有未决请求，阻塞；
3. 同 idempotency key + 同 semantic 只允许 reattach，不允许新发；
4. 同 idempotency key + 不同 semantic 返回冲突；
5. 作用域/ownership/外部副作用无法证明时保持 `UNKNOWN_BLOCKING`；
6. 完整且与当前 action target 不相干的历史记录不再跨作用域阻塞；
7. 分类器不写 Journal、不调用 recovery、不发送 Prompt、不创建 Chat。

## AUT-2 / AUT-3 接入

- AUT-2 在 `openWorkspace` 和 `automationControl` 之前执行 Requirement scoped preflight；失败时只写 BLOCKED evidence 并退出。
- AUT-2 real gate 的 `automationControl` 回调只归还 workspace automation control，不再扫全量旧 recovery 记录。
- AUT-3 preflight 使用 Planner scoped classifier；保留 Requirement/Reviewer binding、exact target read 和 recovery request 的专属 fail-closed 检查。
- 旧 `journalClean` 仅作为 `legacyGlobalJournalClean` 诊断字段保留，不再作为跨作用域放行/阻塞谓词。

## Persistence safety

Fix11 同时修正 v2 Journal 加载路径：重启恢复分类在内存中派生，不因只读 status/preflight 把所有记录的原始 error 统一持久化为 `WORKBENCH_RESTARTED`。已有 schema migration 的持久化行为不变。

该修正不是清理 Journal，也不新增持久化状态；原始记录不被删除、终态化、truncate 或 reset。

## 当前生产判断

- REQUIREMENT action：`UNKNOWN_BLOCKING=15`，`ok=false`；
- PLANNER action：`UNKNOWN_BLOCKING=16`，`ok=false`；
- Runtime：`webgpt=UNAVAILABLE`、`controlOwner=null`；
- Canonical Role reachability：NOT_PROVEN；
- Fix11 不能安全进入两条业务 Prompt 阶段。

## 验证

新增测试覆盖：

- 无当前 Browser lease 的无关历史记录不阻塞；
- 同目标未决记录阻塞；
- Browser lease/queue 全局阻塞；
- 同 idempotency + semantic 只 reattach；
- semantic drift 阻塞；
- status 不可读 fail-closed；
- v2 Journal read-only restart classification 不改写原始文件。
