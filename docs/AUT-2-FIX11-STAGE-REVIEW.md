# AUT-2 Fix11 — Production Reconciliation / Scope-aware Preflight / Canonical Role Reachability

## Gate result

```yaml
stage: AUT-2-FIX11
result: BLOCKED
preflight_fix_applied: YES
phase5_real_gate: NOT_ENTERED
aut2_ready: NO
aut2_rerun: NOT_RUN
aut3_ready: NO
aut3_rerun: NOT_RUN
```

本轮按 fail-closed 结束：没有因为无法证明 Runtime、Chat identity 或 Journal ownership 而发送 Prompt。

## 根因

1. 旧 `activeSummary().length === 0` 把全部非终态 Journal 记录当作全局 active，无法区分当前 action 与历史记录；
2. AUT-2 的既有 `automationControl()` 会全量执行 recovery sweep；
3. 当前打包运行时状态为 `webgpt=UNAVAILABLE`、`controlOwner=null`，无法证明 Browser runtime READY；
4. Role Registry 有 BOUND 记录，但当前 REQUIREMENT/PLANNER/REVIEWER 实时 target reachability 都未证明；
5. Fix10 的历史 Planner request 来自隔离 Fixture，不在生产 Journal，不能充当 AUT-2 handoff。

## 变更

- 新增 `src/automation/webgpt-action-readiness.ts`：纯派生的 action-scoped reconciliation classifier；
- `src/main/main.ts`：AUT-2 Requirement preflight、AUT-3 Planner scoped preflight、旧 global journal 状态仅作为诊断字段；
- `src/main/main.ts`：真实 AUT-2 Gate 归还 control 时不再扫全量历史 recovery；
- `src/features/webgpt/runtime/webgpt-request-manager.ts`：v2 Journal 的重启恢复分类不再因只读读取持久化原始错误；
- 新增 scope-aware classifier、同目标/lease/idempotency 和 Journal read-only 测试；
- `tests/aut3-planner.test.ts`：补齐测试 double 的完整 Role binding 形状。

未修改 Native Thread/Turn/Item、WebGPT 页面协议、Role Registry binding、Project registry、真实 Journal 内容，也没有创建第二套 Conversation/Transcript truth。

## 当前生产证据

- Journal：85 条；非终态 24 条；
- REQUIREMENT action：`UNKNOWN_BLOCKING=15`，`HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE=7`，`SAFE_TO_RECONCILE=2`；
- PLANNER action：`UNKNOWN_BLOCKING=16`，`HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE=6`，`SAFE_TO_RECONCILE=2`；
- Browser lease/active operation：当前未观察到，但 Runtime ownership 仍未证明；
- REQUIREMENT canonical read：NOT_PROVEN；
- old Planner request：HISTORICAL_ISOLATED_GATE_REQUEST，productionJournal=false；
- AUT-2→AUT-3 handoff：NOT_GENERATED。

## 安全计数

```text
new business prompts: 0
repair prompts: 0
setup prompts: 0
new chats: 0
role binding mutations: 0
Fix11 code Journal mutations: 0
V1 Frozen Core changed: NO
```

### 审计探针副作用说明

一个只读打包状态探针启动 Workbench 时触发了既有 `WebGptRequestManager.load()` 的持久化归一化：21 条 `RECOVERY_REQUIRED` 的 error 被写成 `WORKBENCH_RESTARTED`，记录数量和状态数量未变。本轮没有手工回滚该用户 Journal。Fix11 已增加回归测试并阻止后续 v2 read-only status/preflight 重复产生该写入。

## 子代理

| Agent | 任务 | 结果 | 状态 |
| --- | --- | --- | --- |
| Maxwell | canonical Role/Chat reachability | 找到 DELETED_CHAT / IDENTITY_SOURCE_MISMATCH；当前可读性 NOT_PROVEN | completed / closed |
| Peirce | production Journal reconciliation | 85 条记录、24 条非终态；确认旧 loader 写 error side effect | completed / closed |
| Bernoulli | scope-aware predicate | 确认 global nonterminal block，提出纯派生 classifier | completed / closed |
| Kepler | AUT-2 readiness | 确认 target mismatch、预算权威冲突、same-session 未证明 | completed / closed |
| Feynman | old Planner provenance/handoff | 确认旧 request 是隔离 Fixture，不在生产 Journal | completed / closed |

## 真实验证边界

本轮没有运行 AUT-2/AUT-3 真实业务 Gate，因为 preflight 不满足。没有执行新 Chat、setup、repair、business Prompt，也没有以旧隔离 Fixture 冒充真实闭环。

此前 packaged status 探针曾因启动超时退出；该探针进程已关闭，未保留运行中的 Workbench 子进程。当前不能声称 Runtime READY 或 Role latest PASS。

## 下一步 blocker

1. 取得可用的 Workbench WebGPT Runtime，并确认 `READY + AUTO_CONTROL + browserResource FREE`；
2. 在不 bind/replace、不创建 Chat、不发送 setup Prompt 的情况下，真实读取当前 REQUIREMENT target；
3. 对 15/16 个 `UNKNOWN_BLOCKING` 做后续安全对账；不得删除/强制终态化/盲目 retry；
4. 解决预算文件 `12/12` 与本轮授权 `12/14` 的权威来源冲突；
5. 只有以上条件全部满足，才允许使用剩余 2 条 business Prompt 重新跑 AUT-2，然后验证精确 AUT-2→AUT-3 handoff。

## 证据索引

- `docs/AUT-2-FIX11-PRODUCTION-JOURNAL-AUDIT.json`
- `docs/AUT-2-FIX11-OLD-PLANNER-REQUEST-PROVENANCE.json`
- `docs/AUT-2-FIX11-CANONICAL-ROLE-REACHABILITY.json`
- `docs/AUT-2-FIX11-PREFLIGHT-PREDICATE-AUDIT.md`
- `docs/AUT-2-FIX10-TRUE-SAME-SESSION-E2E.json`
- `docs/AUT-3-REAL-PLANNER-EVIDENCE-FIX10.json`
