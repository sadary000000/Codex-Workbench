# AUT-2 Final Stage Review — Fix9 Round Identity + Final Requirement Closure

## Latest Gate Result

```yaml
stage: AUT-2 Fix9 + Final Requirement Closure
result: PASS_CANDIDATE
latest_real_gate: PASS_REAL
round_persistence: PASS_REAL_RUNTIME
answers_to_draft: PASS_REAL
explicit_user_confirmation: PASS_REAL_RUNTIME
aut3_started: CONDITIONAL_AUT3_ATTEMPTED
v1_core_changed: NO
webgpt_v1_changed: NO
```

Fix9 选择 `NEXT_INTERACTION`，修复了 `round.questionIds` 与 `Question.roundId` 跨 Round 的真实持久化缺陷。真实 `NEEDS_INPUT` 响应包含 5 个问题，Round ownership、Session currentRound、事务回滚和幂等重放均通过。随后正式 answer API 完成 Answers → `READY_FOR_DRAFT`，`actor=USER` 完成 `DRAFT → CONFIRMED`。

最新机器证据： [AUT-2-FINAL-REAL-REQUIREMENT-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FINAL-REAL-REQUIREMENT-EVIDENCE.json)

Fix9 Round 机器证据： [AUT-2-FIX9-ROUND-PERSISTENCE-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FIX9-ROUND-PERSISTENCE-EVIDENCE.json)

预算：累计真实 Prompt `12/12` hard maximum；repair `3/3`；新 Chat `2/3`。原 REQUIREMENT binding 已恢复，PLANNER/REVIEWER 未修改。

AUT-3 条件阶段随后启动了 Planner 自动化基础，但最新真实 Planner request 进入 `RECOVERY_REQUIRED`，所以 AUT-3 单独标记 `FIX_REQUIRED`，不能反向改变 AUT-2 的通过结论。

---

# AUT-2 Historical Stage Review — Gate Fix 5

## Executive Summary

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
gate_fix: AUT-2 Gate Fix 5 — Recovery Lease Drain + Final Real Requirement Roundtrip
result: FIX_REQUIRED
latest_real_gate: BLOCKED
gate_fix_4_commit: 95cdbbd
gate_fix_5_code_commit: NO_CODE_CHANGE
v1_core_changed: NO
webgpt_v1_changed: NO
aut3_started: NO
```

Fix4 的 semantic-only contract、trusted local envelope、bounded repair 和首轮 `NEEDS_INPUT` 提示修复已经提交为 `95cdbbd`。Fix5 按要求先审计并提交 Fix4，再只读处理恢复租约；正常 close/restart 最终恢复了 `READY / AUTO_CONTROL / FREE`，但既有 REQUIREMENT 测试 Chat 的 exact read 仍返回 `TARGET_CHAT_MISMATCH`。因此没有发送新的 Requirement Prompt，AUT-2 没有通过，不能进入 AUT-3。

## Scope and architecture boundary

本轮只覆盖：

- Fix4 工作树的精确归属和独立提交；
- WebGPT 现有公开 CLI 的恢复/控制诊断；
- bounded recovery wait、graceful close、打包 GUI Host 正常重启和 exact Chat re-open/read；
- AUT-2 真实 Gate 的 fail-closed 证据。

本轮禁止并未执行：

- 修改 `src/features/webgpt/**`、WebGPT Request Manager、Global Operation Arbiter、Browser Lease 或 Control Plane 语义；
- 创建替代 Chat、修改原 REQUIREMENT binding、发送新 Prompt 或 repair Prompt；
- Cookie、Token、私有 API、原始 Prompt/Response、完整聊天正文；
- AUT-3 Planner、Executor、Reviewer 或其他 Automation 阶段。

产品事实边界保持：V1 Native Core 是唯一 Codex 对话事实，WebGPT 是受控扩展能力；没有建立第二套 Conversation/Transcript truth。

## Fix4 committed boundary

`gate_fix_4_commit = 95cdbbd`，提交只包含 18 个 Fix4 路径：

- `src/automation/aut2-real-webgpt-gate.ts`
- `src/automation/requirement-service.ts`
- `src/automation/requirement-webgpt-adapter.ts`
- `src/automation/requirement-webgpt-contract.ts`
- `src/main/main.ts`
- `scripts/aut2-real-webgpt-gate.ts`
- `tests/aut2-requirement-service.test.ts`
- `tests/aut2-requirement-webgpt-adapter.test.ts`
- `tests/aut2-requirement-webgpt-contract.test.ts`
- `docs/AUT-2-GATE-FIX-4-RUNTIME.json`
- `docs/AUT-2-REQUIREMENT-CONTRACT-DRIFT-AUDIT.md`
- `docs/AUT-2-REQUIREMENT-PROTOCOL.md`
- `docs/AUT-2-STAGE-REVIEW.md`
- `docs/AUT-2-TEST-SUMMARY.json`
- `docs/AUT-2-REAL-PROMPT-BUDGET.json`
- `docs/AUT-2-PROVENANCE.txt`
- `dist/review/AUT-2-STAGE-REVIEW-PACKAGE.zip`
- `dist/review/AUT-2-STAGE-REVIEW-PACKAGE.sha256`

其他旧阶段删除项、旧 dirty 修改、`dist-stage-a/`、指导文档和 WebGPT/WEB6 资料没有被本次提交纳入。

## Recovery Lease Evidence

机器证据： [AUT-2-RECOVERY-LEASE-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-RECOVERY-LEASE-EVIDENCE.json)

人读报告： [AUT-2-RECOVERY-LEASE-EVIDENCE.md](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-RECOVERY-LEASE-EVIDENCE.md)

核心结果：

| 项目 | 结果 |
|---|---|
| Journal 中 `SUBMITTED/RUNNING/GENERATING` | 0 |
| Journal 状态统计 | 19 `RECOVERY_REQUIRED`、2 `PAUSED_FOR_USER`、44 `COMPLETED`、11 `FAILED` |
| bounded wait | 120 秒上限，未在窗口内收敛，期间 Prompt 0 |
| graceful close | PASS，`closeMode=GRACEFUL` |
| 正常重启/登录态 | PASS_PARTIAL，`webgpt open` READY，`loginRequired=false` |
| 初次 `control auto` | TIMEOUT / `WORKBENCH_START_TIMEOUT` |
| 最终控制/租约状态 | `AUTO_CONTROL`、`FREE`、active operation/request 为空、queue 0 |
| exact target Chat read | FAIL，`TARGET_CHAT_MISMATCH` |

正常生命周期没有清理 Request Journal、没有强杀 Electron、没有新增 Chat。完整时间线和命令结果见 Fix5 evidence 文件。

## Exact REQUIREMENT binding

Project：`workts`，Project ID：`371c3fb8-30ac-4943-9584-1915045ea34d`。

既有目标测试 Chat：

`https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a88873d-0af0-83e8-a2e7-202adf2560f8`

`webgpt open-chat` 能返回目标 URL，但随后只读 `webgpt chat latest --url <target>` 连续失败，错误为 `TARGET_CHAT_MISMATCH`、`userAction=reopen_target_chat`。在 exact read 通过前，没有执行 `role bind --replace`；原 REQUIREMENT binding 仍为：

`https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc`

这保持了 exact identity、原 binding 和无替代 Chat 的安全边界。

## AUT-2 real Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| Contract drift audit | PASS_AUTOMATED | Fix4 audit + shared contract tests |
| Transport/semantic separation | PASS_AUTOMATED | semantic parser + trusted local envelope |
| Shared response schema | PASS_AUTOMATED | contract tests |
| Recovery lease | BLOCKED / NOT PASS_REAL | Fix5 recovery evidence |
| Recovery blind resend | PASS | recovery 期间 Prompt 0 |
| Exact REQUIREMENT role | NOT_REACHED | target Chat exact read failed |
| First round `NEEDS_INPUT` | NOT_REACHED | 没有发送新业务 Prompt |
| Answers → `READY_FOR_DRAFT` | NOT_REACHED | 依赖前一 Gate |
| USER confirmation | NOT_REACHED | 没有 Draft |
| Original binding restored | PASS | 未替换，仍为原 URL |
| AUT-3 | NOT_STARTED | AUT-2 blocked |

## Budget

来源： [AUT-2-REAL-PROMPT-BUDGET.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-REAL-PROMPT-BUDGET.json)

```yaml
cumulative_real_prompts: 7/12
cumulative_repair_prompts: 2/3
cumulative_new_test_chats: 2/3
fix5_new_business_prompts: 0
fix5_new_repair_prompts: 0
fix5_new_setup_prompts: 0
fix5_new_test_chats: 0
```

没有为了绕过恢复/目标身份失败而消耗预算。

## Automated verification baseline

Fix4 implementation baseline remains：

- `npm run check`：PASS
- `npm test`：PASS，`284/284`
- `npm run build`：PASS
- `npm run package:win`：PASS
- `npm audit --omit=dev`：PASS，0 vulnerabilities
- `git diff --check`：PASS，只有 LF/CRLF normalization warnings
- secret scan：PASS，仅 documented synthetic fixture 命中

Fix5 没有产品代码变更，因此没有为了文档收尾重复消耗真实网页预算。

## Review package and provenance

Fix5 文档收尾包生成后记录：

- `docs/AUT-2-GATE-FIX-5-RUNTIME.json`
- `docs/AUT-2-RECOVERY-LEASE-EVIDENCE.json`
- `docs/AUT-2-RECOVERY-LEASE-EVIDENCE.md`
- `docs/AUT-2-STAGE-REVIEW.md`
- `docs/AUT-2-PROVENANCE.txt`
- `dist/review/AUT-2-STAGE-REVIEW-PACKAGE.zip`
- `dist/review/AUT-2-STAGE-REVIEW-PACKAGE.sha256`

本轮审查包不包含 Cookie、Token、Browser profile、密码、原始 Prompt、原始回答或完整 Request Journal。

## Subagents

| Agent | Task | Result | Status |
|---|---|---|---|
| Hegel | Fix4 提交边界只读审计 | 确认 18 个路径属于 `95cdbbd`，其他 dirty/deleted/untracked 应排除 | completed, reviewed, closed |
| Parfit | Official CLI/Recovery command registry 只读审计 | 确认实际命令、字段来源；不存在公开 `reconcile`/`reattach` 命令 | completed, reviewed, closed |

`running_subagents_at_gate: 0`

## Legacy and user-file protection

- `D:\办公\AI\Codex_Workbench`：只读，保留原有 dirty baseline，未 reset/clean/stash/checkout/commit。
- `D:\办公\AI\Auto_Agent`：未修改。
- `dist-stage-a/`、`指导文档/*.docx` 和其他用户本地规划资料：未被本轮提交。
- 本轮只提交了 Fix4 精确边界；Fix5 证据文档和审查包作为独立文档收尾提交，其他 dirty 文件保持原状态。

## Gate and next action

```yaml
aut2_result: FIX_REQUIRED
aut2_final_gate: BLOCKED
aut3_started: NO
next_action: USER_SUBMIT_AUT2_REVIEW_PACKAGE_TO_GPT
```

阻塞点是现有 REQUIREMENT 测试 Chat 的真实 exact read 仍返回 `TARGET_CHAT_MISMATCH`。不得用新 Chat、额外 Prompt、静默 rebind 或 WebGPT V1 改动绕过。

## Follow-up visible read retry

用户随后要求让 Workbench 显示实际操作并再次尝试读取。跟进证据见：

- [AUT-2-VISIBLE-READ-RETRY-EVIDENCE.md](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-VISIBLE-READ-RETRY-EVIDENCE.md)
- [AUT-2-VISIBLE-READ-RETRY-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-VISIBLE-READ-RETRY-EVIDENCE.json)

本轮新增 3 次只读读取，结果全部为 `TARGET_CHAT_MISMATCH`；其中两次先执行了可见 `open-chat`，两次均报告目标 URL 匹配、已登录、处于 Chat 页面且 Composer 存在。Fix5 原有 4 次加本轮 3 次，累计 exact read 失败 7 次。

本轮没有发送 Prompt、创建 Chat、替换 REQUIREMENT binding 或读取 Cookie/Token。该结果进一步确认：页面导航成功不等于读取结果身份校验成功，AUT-2 仍为 `FIX_REQUIRED / BLOCKED`。

## AUT-2 Fix9 + Final Closure (2026-08-22)

Fix9 选定并实现 `NEXT_INTERACTION` round 语义。真实 `NEEDS_INPUT` 响应包含 5 个问题，落库后 `roundCount=2`，`session.currentRoundId` 与 owning round 一致，所有问题同轮、`round.questionIds` 精确匹配、孤儿问题为 0；跨轮引用、跨轮回答、语义冲突和事务中途失败均自动化 fail-closed。机器证据：

- `docs/AUT-2-FIX9-REAL-EVIDENCE.json`
- `docs/AUT-2-FIX9-ROUND-PERSISTENCE-EVIDENCE.json`

在同一确认为可用的 REQUIREMENT Chat 上，正式 answer API 使用已持久化问题完成 Answers → `READY_FOR_DRAFT`，生成 DRAFT canonical payload 和 `payloadSha256`，再使用 `actor=USER` 完成 `DRAFT → CONFIRMED`。WEBGPT/SYSTEM 自确认均被拒绝，原 REQUIREMENT binding 恢复，PLANNER/REVIEWER 未改变。AUT-2 最终状态：`PASS_CANDIDATE`。

累计网页 Prompt 账本更新为 `12/12` hard maximum，repair `3/3`，新 Chat `2/3`；达到上限后没有继续发送 AUT-2 Prompt。

实现与测试提交：`2eb3018`。本提交同时包含 AUT-3 Planner 的自动化基础，但 AUT-3 真实 Gate 未通过，因此不能将 AUT-3 记为 PASS。

### AUT-3 条件结果

自动化 Planner contract/store tests：`3/3 PASS`；真实精确 PLANNER binding、Requirement binding 和角色保护检查均通过，但真实 Planner Request 进入 `RECOVERY_REQUIRED`，没有形成结构化计划。证据：`docs/AUT-3-REAL-PLANNER-EVIDENCE-ISOLATED.json`。因此 AUT-3 = `FIX_REQUIRED`，Executor/Reviewer 均未启动。

`running_subagents_at_gate: 0`
