# AUT-2 Fix11 — Production Journal Reconciliation Audit

## 结论

本报告只记录生产 Request Journal 的安全元数据和派生分类，不执行恢复、重放、终态化、删除或重写请求。

当前生产环境不能进入 AUT-2/AUT-3 真实 Prompt 阶段：

- Journal 共 85 条记录，非终态 24 条；
- 当前可观察运行时为 `workbench=READY`、`webgpt=UNAVAILABLE`、`controlOwner=null`、`browserResource=null`；
- 精确 REQUIREMENT Chat 尚未完成真实读取；
- 作用域分类仍包含未知归属/未知副作用记录，因此按 fail-closed 阻塞；
- 本轮新业务 Prompt、repair/setup Prompt、新 Chat、Role binding mutation 均为 0。

原始来源：`C:\Users\sadar\AppData\Roaming\codex-workbench-v1\webgpt\requests\requests.json`。完整无 Prompt/Response 的摘要见同名 JSON。

## 生产统计

| 状态 | 数量 |
| --- | ---: |
| COMPLETED | 50 |
| FAILED | 11 |
| PAUSED_FOR_USER | 2 |
| QUEUED | 1 |
| RECOVERY_REQUIRED | 21 |
| 非终态合计 | 24 |

非终态作用域：15 条无 `projectId/role/targetChatUrl`，6 条 REQUIREMENT，3 条 PLANNER。Journal 没有 `updatedAt` 字段，不能仅以年龄把记录安全判定为已失效。

## 派生作用域结果

分类器位于 `src/automation/webgpt-action-readiness.ts`。分类是内存派生结果，不新增 Journal 状态、不写入第二套事实源。

### REQUIREMENT action

目标：Project `371c3fb8-30ac-4943-9584-1915045ea34d`、Role `REQUIREMENT`、Chat `https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc`。

| 派生分类 | 数量 |
| --- | ---: |
| ACTIVE_BLOCKING | 0 |
| SAFE_TO_RECONCILE | 2 |
| STALE_CANDIDATE | 0 |
| HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE | 7 |
| UNKNOWN_BLOCKING | 15 |

结论：`ok=false`。其中两个同目标 REQUIREMENT 历史记录仍是 `UNKNOWN_BLOCKING`；13 条未带完整作用域且有提交/发送/生成证据的记录也不能安全忽略。

### PLANNER action

目标：同一 Project、Role `PLANNER`、Chat `https://chatgpt.com/c/6a865d2c-69fc-83ee-9845-1c236f19d7b9`。

| 派生分类 | 数量 |
| --- | ---: |
| ACTIVE_BLOCKING | 0 |
| SAFE_TO_RECONCILE | 2 |
| STALE_CANDIDATE | 0 |
| HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE | 6 |
| UNKNOWN_BLOCKING | 16 |

结论：`ok=false`。3 条当前目标 Planner 非终态记录与 13 条缺少作用域的历史记录仍阻塞；不能用旧 AUT-3 Fixture 冒充真实 AUT-2 handoff。

## 规则

- 当前 Browser lease、active operation、active request 或 queue 非空：`ACTIVE_BLOCKING`；
- 同目标存在未决请求：`UNKNOWN_BLOCKING`；
- 同 idempotency key 且 semantic 相同：仅允许 reattach，不能新发；
- 同 idempotency key 但 semantic 不同：`IDEMPOTENCY_CONFLICT`；
- 作用域缺失但无外部副作用证据：可作为 `STALE_CANDIDATE`/`SAFE_TO_RECONCILE`，也不得自动删除或重发；
- 作用域/外部副作用无法证明：`UNKNOWN_BLOCKING`；
- 与当前 action 目标完全不相干且作用域完整的历史记录：`HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE`，不再因为 Journal 非终态计数而跨作用域阻塞。

## 重要审计偏差

本阶段一个只读打包状态探针启动了 Workbench。已有 `WebGptRequestManager.load()` 在读取 v2 Journal 时会把非终态记录归一化为 `WORKBENCH_RESTARTED` 并持久化。该既有路径造成了：记录数量和状态数量不变，但 21 条 `RECOVERY_REQUIRED` 的 `error` 被统一写成 `WORKBENCH_RESTARTED`，文件大小从约 116,431 增至约 118,048 字节。

本轮没有手工回滚用户 Journal，也没有删除/终态化任何记录。Fix11 已增加保护：v2 Journal 的重启恢复分类只在内存派生，后续只读 status/preflight 不再因为该分类重写 Journal；schema migration 仍按原规则持久化。

## 安全计数

```text
new business prompts: 0
repair prompts: 0
setup prompts: 0
new chats: 0
role binding mutations: 0
Fix11 Journal mutations: 0
```

下一步必须先解决 canonical REQUIREMENT Chat 的真实可读性、运行时 READY/AUTO_CONTROL 和未知 Journal 副作用，再重新运行 AUT-2。不能通过删除 Journal、强制终态化、fallback Chat 或盲目 retry 解锁。
