# Codex Workbench WebGPT — WEB-5 阶段审查材料

> 当前审查状态：`PASS_WITH_ISSUES_CANDIDATE / REAL_GATE_BLOCKED_BY_RATE_LIMIT`。自动化缺陷已修复；由于此前真实 ChatGPT 页面已出现限流，本轮没有再提交网页 Prompt，因此真实 Gate 不得写成 PASS。

## 1. Executive Summary

本阶段完成 `WEB-5：Request Recovery, Idempotency & Control Ownership Hardening`。

核心结果：

- WebGPT 仍只有一个 Core / Browser Runtime / Electron Session / Request Manager / Role Registry / Page Adapter。
- 同一个幂等键和同一请求语义只返回原 request，不会再次向网页提交 Prompt；语义变化返回 `IDEMPOTENCY_CONFLICT`。
- 已完成请求在 Workbench 重启后可以用同一个 `requestId` 重新读取；提交中、生成中或不确定状态不会盲目重发，而是进入恢复/重新核对路径。
- `USER_CONTROL`、`AUTO_CONTROL`、暂停和交还控制有明确边界；用户接管后，未提交的自动请求不会修改网页。
- Role 绑定要求稳定的 `/c/<chat-id>` Chat URL；未知、待绑定或失配目标 fail-closed，不 fallback 到当前 Chat，也不替换 Role。
- WEBGPT Web5 基线 real smoke 的重复 Prompt、幂等冲突、CLI wait/result、控制权暂停/恢复、超时后继续和完成请求重启证据仍保留在历史报告中。
- 本轮修复了两个 Request Manager 自动化失败：终态等待与 journal 持久化竞态、以及目标页 hydration 等待与测试夹具语义不一致；定向测试 12/12、全量测试 158/158 通过。
- v2 不再提交新的真实网页 Prompt。此前 Gate Fix real smoke 的最后一次尝试仍是 `RECOVERY_REQUIRED / REQUEST_NOT_VERIFIABLE`，所以 in-flight restart 和 Role wrong-chat real Gate 尚未取得 PASS 证据。
- 测试期间 ChatGPT 网页出现“请求过于频繁”提示；本地日志记录了 54 条独立请求记录，其中 43 条到达网页提交动作。该事实已单独记录，后续没有继续触发真实网页请求。
- V1 Frozen Core 的 Native Thread / Turn / Item、Runtime、Project、Composer、Map、Manual Mode 没有建立第二事实源，也没有改变其身份规则。

本地阶段结论：`READY_FOR_GPT_REVIEW`，自动化部分 PASS；真实 Gate 结论为 `BLOCKED_BY_RATE_LIMIT`。本轮审核包由用户手动提交 GPT；本 Agent 不再自动发送网页请求或提交审查。

## 2. Scope Resolution

### In scope

- Request identity、稳定 `idempotencyKey`、语义冲突检测。
- 元数据-only request journal 和版本/坏数据校验。
- 完成、暂停、提交中、生成中、超时、断开和重启后的恢复状态。
- CLI `send --idempotency-key`、`wait`、`result`、`request status`、`request list --active`。
- Control Ownership 的 USER_CONTROL / AUTO_CONTROL / PAUSED 仲裁。
- Role-aware target 校验和恢复时的目标保护。
- CLI socket retry 去重及 replay conflict。

### Out of scope

- Automation、Workflow、Task、Verifier、多账号、多浏览器。
- Playwright、Selenium、CDP、自研浏览器控制协议。
- Cookie、密码、Token 导出或账号凭据持久化。
- Attachment、Browser Pane、视觉 Polish。
- Workbench V1 Frozen Core 的 Runtime / Thread / Project / Composer / Map 重构。

## 3. Architecture Boundary

```text
WebGPT Core
  └─ one Electron BrowserView / one persistent session profile
       ├─ WebGptWorkspace
       ├─ WebGptRequestManager
       ├─ WebGptRoleSessionRegistry / Service
       ├─ WebGptControlServer / CLI client
       └─ WebGptPageAdapter
```

Workbench 只保存 WebGPT 请求的安全元数据和恢复状态；网页 Prompt、网页回答正文、Cookie、密码和 Token 不写入 request journal。页面事实仍由 Browser runtime/page probe 提供，V1 对话事实仍由 Native Thread / Turn / Item 提供。

## 4. Request Identity / Idempotency Contract

每条请求有：

- `requestId`：Workbench 生成的请求身份。
- `idempotencyKey`：CLI 或调用方提供的稳定幂等键。
- `semanticSha256`：由 Prompt、Project、Role、规范化 target Chat 组成的语义摘要。

行为：

| 条件 | 行为 |
| --- | --- |
| 同 key + 同语义 | 返回原 request；不会新建 request，也不会再次网页提交 |
| 同 key + Prompt / Project / Role / target 任一变化 | `IDEMPOTENCY_CONFLICT` |
| CLI 超时、断开后重试 | 通过同 key 重新查询原 request，不按不确定状态重发 |
| QUEUED / PAUSED 且同 key | 只在尚未提交网页前重新挂接原 request |

Request journal 不保存完整 Prompt，只保存长度和 SHA-256。完整 Prompt 只在运行时内存和当前 CLI 调用中使用。

## 5. Persistent Request Model

持久化字段包括：

- `requestId`、`idempotencyKey`、`semanticSha256`。
- Project / Role / target Chat 的安全元数据。
- state、created/submitted/completed 时间、baseline/observed user/assistant count。
- prompt 字符数和 hash、result hash/bytes/path、错误 code/message。
- 最后一次受限 page state 摘要。

不会持久化：

- 完整 Prompt 或网页回答正文。
- Cookie、密码、Authorization、control-plane auth token。
- 任意网页 DOM、截图或完整页面内容。

加载时拒绝 malformed schema、未知 state、重复 request identity、无效结果路径和损坏结果 hash；未完成的 active state 转为恢复所需状态，不自动重发。

## 6. Recovery State Model / Restart Reconciliation

```text
QUEUED / PAUSED_FOR_USER
  ├─ restart → 可用同一 key/语义重新挂接（仅限网页尚未提交）
  └─ USER_CONTROL → 保留原 request，禁止网页变更

SUBMITTING / SUBMITTED / GENERATING / TIMEOUT / INDETERMINATE
  └─ restart/disconnect → reconcile 或 RECOVERY_REQUIRED，不盲目再次 send

COMPLETED
  └─ restart → 保留原 request/result，可按同 key 读取

FAILED / CANCELED
  └─ 保留错误和 Prompt recovery metadata，由用户显式重试
```

`wait` 超时只表示等待调用超时，不等于取消 Request；后续仍可 `request status` / `wait` / `result`。提交失败、目标变化、登录/Composer 不可用等不确定路径进入 `RECOVERY_REQUIRED`，不伪造成功或切换目标。

## 7. Control Ownership Arbitration

- `USER_CONTROL`：用户拥有页面；自动请求在网页提交前转为 `PAUSED_FOR_USER`，不做导航、写入 Composer 或点击 Send。
- `AUTO_CONTROL`：仅在自动控制 epoch 有效且目标仍是已声明 target 时允许自动操作。
- `PAUSED`：保留 request identity；交还自动控制后恢复同一个 request，不创建替代 request。
- 自动 Prompt 已提交后，用户接管只允许观察/核对，不能再尝试第二次网页提交。
- 用户手动导航到另一个 Chat、离开 Chat 或 Role 目标失配时，自动请求 fail-closed。

IPC 与 CLI 都经过同一 Request Manager 仲裁；control socket 的重复 `requestId` + 同 payload 返回原响应，不会重复执行 handler；同 `requestId` + 不同 payload 返回 replay conflict。

## 8. Role-aware Recovery

Role 发送前要求明确且稳定的 `/c/<chat-id>` 绑定。`PENDING_CHAT_URL`、未知 Role、非 Chat URL、跨 Role target 或当前页面改变均拒绝发送/恢复：

- 不 fallback 到当前 Chat。
- 不静默 rebind Role。
- 不创建替代 Role 或替代 Chat。
- 保留原 Role metadata 和 request identity，等待用户显式修复/绑定。

自动化测试覆盖 pending bind、精确 URL 校验、失配恢复和 USER_CONTROL；本轮没有设置 `WEBGPT_PROJECT_ID`，因此没有执行真实 Role project smoke。

## 9. Duplicate Prompt Proof — Real Browser Evidence

命令：

```text
npm run test:real:webgpt:recovery
```

该 smoke 使用打包 EXE 的真实 WebGPT Browser runtime，并使用唯一测试幂等键：

- 首次 `send`：`COMPLETED`。
- 第二次使用完全相同 key + Prompt：返回同一 `requestId`。
- 同 key + 不同 Prompt：返回 `IDEMPOTENCY_CONFLICT`。
- 页面 probe：`baselineUserCount = 0`、`observedUserCount = 1`，因此 duplicate prompt proof 为 true。
- 本次真实 smoke 没有记录 Prompt 或回答正文，输出仅保留长度、hash、计数和结果 hash。

## 10. Restart / Reattach Real Evidence

同一 `test:real:webgpt:recovery` 在 `WEBGPT_WEB5_OWN_PROCESS=1` 下执行：

1. 完成一个真实网页 request。
2. 关闭本次 smoke 启动的 Workbench EXE。
3. 重新启动同一打包 EXE，并显式重新打开 WebGPT 页面。
4. 查询原 `requestId` 的 status/result。

结果：

- `sameRequestId: true`
- state 仍为 `COMPLETED`
- `sameResultHash: true`
- 没有再次网页提交 Prompt

同一 smoke 还验证：`wait --timeout-ms 0` 返回 `WEBGPT_WAIT_TIMEOUT` 后 request 继续，随后仍能取得完成结果；USER_CONTROL 下发送转为 `PAUSED_FOR_USER`，交还 AUTO_CONTROL 后使用同一 request identity 完成。

## 11. Failure / Recovery Matrix

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 同 key 重试 | 原 request、单次网页 Prompt | real smoke + unit |
| 同 key 语义漂移 | `IDEMPOTENCY_CONFLICT`、无第二次发送 | real smoke + contract |
| CLI wait timeout | 不取消、不重发 | real smoke |
| 已完成 request 重启 | 同 request/result | real smoke |
| 提交中/生成中重启 | reconcile 或 `RECOVERY_REQUIRED`，拒绝盲重发 | unit/contract |
| USER_CONTROL before submit | `PAUSED_FOR_USER`、页面不变 | real smoke + unit |
| writer/replay conflict | 明确拒绝，不替换身份 | contract + V1 regression |
| Role target 失效 | fail-closed，不 fallback | unit/contract |
| 无效结果路径 / 损坏 journal | 拒绝读取，不泄漏或伪造结果 | unit |

## 12. Changed Files

实现提交：`d5f5976 feat: harden webgpt request recovery`

主要变更：

- `package.json`：增加 `test:real:webgpt:recovery`。
- `scripts/real-webgpt-recovery-smoke.ts`：真实 Browser recovery/idempotency/control/restart smoke。
- `src/features/webgpt/types.ts`：请求状态、幂等、页面计数和恢复 metadata。
- `src/features/webgpt/adapter/webgpt-page-adapter.ts`：Composer 绑定、原生输入 fallback、提交证据和 page probe。
- `src/features/webgpt/runtime/webgpt-workspace.ts`：control epoch、目标检查、用户/自动控制边界。
- `src/features/webgpt/runtime/webgpt-request-manager.ts`：journal、幂等、恢复、reconcile、result 校验、无盲重发。
- `src/features/webgpt/runtime/webgpt-role-session-registry.ts` / `webgpt-role-session-service.ts`：严格 Role target 和 fail-closed routing。
- `src/main/main.ts`：CLI/IPC 与 Request Manager 的控制权协调、result 输出保护。
- `src/main/webgpt-command.ts`：idempotency/status/list CLI 参数和错误校验。
- `src/main/webgpt-control.ts`：requestId 校验、socket close、请求去重和 replay conflict。
- `src/features/webgpt/runtime/webgpt-interruption-test-hook.ts`：默认关闭、显式本地 opt-in 的受限中断证据 hook。
- `scripts/real-webgpt-gate-fix-smoke.ts`：Gate Fix 的真实 in-flight / Role recovery smoke；最新运行未通过。
- `tests/webgpt-interruption-test-hook.test.ts` 及 `tests/webgpt-request-manager.test.ts`：中断证据和恢复路径测试。
- 对应 WebGPT contract/unit tests：`tests/webgpt-control-contract.test.ts`、`tests/webgpt-page-adapter.test.ts`、`tests/webgpt-request-manager.test.ts`、`tests/webgpt-role-session-registry.test.ts`、`tests/webgpt-role-session-service.test.ts`。

实现提交：`5d08b72 fix: close web5 request recovery lifecycle`。

没有修改旧 donor，也没有把用户未提交的规划文档、`dist-stage-a/` 或既有临时资料纳入提交。

## 13. Automated Tests / V1 Regression

| 检查 | 结果 |
| --- | --- |
| `npm run check` | PASS |
| 定向 Request Manager / interruption tests | PASS — 12/12 |
| `npm test` | PASS — 158/158 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS；仅有 Git 的 LF→CRLF advisory |
| scoped secret scan | PASS；未发现 literal credential/key pattern |

### 13.1 Automated Fix Evidence

1. Journal rename / temp-file race：`waitForRequest()` 在 worker 已把内存状态改为终态/恢复态、但 journal `persist()` 尚未完成时就返回；测试随后清理临时目录，后台 rename 命中 `ENOENT`。修复为 settled wait 在返回前等待当前 `persistQueue` 完成；没有增加 sleep，也没有降低原子临时文件 + rename 保护。
2. Request state async race：目标 Role 测试夹具打开 Chat 后仍返回空历史计数，触发 10 秒目标页 hydration 等待，刚好耗尽测试 wait 窗口，断言看到 `SUBMITTING`。修复测试夹具，使其明确模拟已有 Role Chat 的 User/Assistant 历史；生产 hydration 逻辑和 timeout 语义未被测试绕过或扩大。

修改文件：

- `src/features/webgpt/runtime/webgpt-request-manager.ts`
- `tests/webgpt-request-manager.test.ts`

实现提交：`5d08b72`。修复后的定向测试和全量测试均 PASS。

此前已通过、且本轮没有因限流再次触发的基线真实回归证据：

- `npm run test:real:navigation`
- `npm run test:real:workspace`
- `npm run test:real:multi-thread`
- `npm run test:real:composer-capability`
- `npm run test:real:composer-persistence`
- `npm run test:real:project-lifecycle`
- `npm run test:real:reliability`
- `npm run test:real:webgpt:recovery`（历史报告中的完成请求重启和 duplicate Prompt proof）

本轮 v2 真实 Gate 保护结果：

- 新增真实 Prompt：`0`。此前已出现限流，本轮按预算/保护规则没有再次执行 `npm run test:real:webgpt:gate-fix`。
- In-flight interruption/restart：`BLOCKED_BY_RATE_LIMIT`；不能把之前 `REQUEST_NOT_VERIFIABLE` 的失败尝试改写为 PASS。
- Role wrong-chat recovery：`BLOCKED_BY_RATE_LIMIT`；v2 没有提交 Role Prompt，因此没有新的真实 Role 证据。

`v1_core_behavior_changed: NO`；`v1_regression: PASS（npm test 158/158）`。

## 13.2 Real In-flight Interruption / Restart Evidence

本节区分“此前一次真实尝试”与“v2 本轮”。v2 没有再次发送 Prompt。

此前最后一次真实 Gate Fix 尝试：

```text
requestId: wgpt-83124077-8c61-48e2-9c5d-31877e6b7c98
idempotencyKey: WEBGPT_WEB5_GATE_FIX_1787199861420_6fedf9db_INFLIGHT
targetChatUrl: https://chatgpt.com/c/6a867ffd-7014-83e8-b2d5-959accbad112
submittedEvidence: local submittedAt exists; final visible-page proof failed
interruptionPoint: NOT_REACHED
restartState: NOT_REACHED
sameKeyRetry: NOT_ESTABLISHED
returnedRequestId: NOT_ESTABLISHED
pageDuplicateCount: NOT_PROVABLE
finalRecoveryState: RECOVERY_REQUIRED / REQUEST_NOT_VERIFIABLE
```

该记录不能证明 no-resend 闭环。v2 本轮因限流保护没有创建新的真实 Prompt，故：

```text
inflight_real_interruption: BLOCKED_BY_RATE_LIMIT
inflight_restart_no_resend: BLOCKED_BY_RATE_LIMIT
same_key_after_restart: NOT_TESTED_IN_V2
```

## 13.3 Real Project-scoped Role Wrong-chat Recovery

```text
projectId: NOT_EXECUTED_IN_V2
role: PLANNER
Chat A: NOT_ALLOCATED_IN_V2
Chat B: NOT_ALLOCATED_IN_V2
originalRequestId: NOT_CREATED_IN_V2
recoveryAction: NOT_RUN; stopped before any new Role Prompt due to rate-limit protection
wrong_chat_prompt_count: 0 observed (no v2 Role Prompt; not a full Gate PASS proof)
role_binding_before_after: unchanged by v2
final_state: BLOCKED_BY_RATE_LIMIT
silent_role_rebind: NOT_OBSERVED; real v2 evidence not established
```

## 13.4 Rate-limit Budget for WEB-5 Gate Fix v2

```text
new_real_prompt_count: 0
history_sidebar_scan: NO
parallel_web_prompt: NO
rate_limit_observed_this_fix: YES (previous environment state; no new Prompt sent in v2)
```

本轮严格停止在本地自动化 Gate；没有用重复网页请求“测恢复”。

## 14. Package Provenance

```text
base_commit: 580534f
implementation_commit: 5d08b72
review_commit: report-only commit created after this implementation commit; final hash is returned with the package handoff
```

本轮本地重新打包产物：

`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`

SHA-256：

```text
outer EXE
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC

resources/app/dist/main/main.js
3087F7AADD1B5BD195865FF9DC86CA2CFEFB7CC50AE4B4CF2B204B93450391A6

resources/app/dist/renderer/renderer.js
94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1

resources/app/package.json
1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```

## 15. Security / V1 Core Integrity

- Request journal 是 metadata-only；不保存完整 Prompt、网页回答、Cookie、密码或 Token。
- result 读取限制在 Workbench 控制目录，并校验 bytes/hash/state；未完成 request 不输出假结果。
- 控制 socket 继续使用本地 per-instance descriptor/authentication；审查材料不包含 descriptor 或 auth token。
- Page Adapter 只取得 bounded page metadata，不把任意网页内容写入 Workbench transcript。
- 没有安装软件、插件，未修改系统配置。
- 没有使用 Playwright / Selenium / CDP。
- 没有修改 `D:\办公\AI\Codex_Workbench` 或 `D:\办公\AI\Auto_Agent`。

## 16. Subagent Results

本阶段使用了三个互不冲突的只读审计子代理，均自然完成、审核结果后关闭：

| Agent | 任务 | 结果 | 处理 |
| --- | --- | --- | --- |
| Helmholtz | 架构/恢复/目标边界审计 | 发现 target fallback、PENDING TOCTOU、journal/recovery 校验风险 | 已采纳并补齐实现与测试 |
| Rawls | CLI/control plane 审计 | 发现 socket retry、EOF、result `--out`、requestId replay 风险 | 已采纳并补齐实现与测试 |
| Hooke | 测试/安全/持久化审计 | 要求 duplicate/restart/timeout 覆盖，并确认 journal 不应保存 Prompt | 已采纳并补齐实现与测试 |
| Huygens | v2 两个自动化失败根因复核 | 确认同一条异步时序链：persist 尚未完成 + hydration 耗尽测试窗口；复核 158/158 | 已采纳；只读审计，已关闭 |

`running_subagents_at_gate: 0`。

## 17. Known Issues / Deferred

- 最新 Gate Fix real smoke 的历史尝试在 in-flight 阶段因 `REQUEST_NOT_VERIFIABLE` 停止，Role wrong-chat recovery 没有实际执行到；本轮 v2 因限流保护没有重新发送 Prompt，因此这两项仍是 `BLOCKED_BY_RATE_LIMIT`，不是 PASS。
- 本轮两个自动化失败已修复，`npm test` 已恢复为 158/158；修复不改变 Request lifecycle，也没有用 sleep 掩盖问题。
- 提交中/生成中恰好硬杀 Workbench 的真实窗口时序没有强制制造；自动化 recovery 测试覆盖“不确定状态不盲重发”，真实 smoke 覆盖完成后重启恢复。为避免向真实 ChatGPT 重复提交，未破坏性制造该时序。
- `Attachment = deferred / unsupported`，不属于 WEB-5 范围。
- Browser Pane、视觉 Polish、多账号和多浏览器继续 deferred。
- `RateLimitGuard` 尚未产品化；本轮只按工程预算停止真实请求，不把限流保护扩展为 WEB-5 产品功能。
- `status` 的 identity 输出提供 Workbench instance；WebGPT runtime 内部身份不作为外部持久化事实使用。

### 17.1 Rate-limit / request-count evidence

- 本地 request journal：`C:\Users\sadar\AppData\Roaming\codex-workbench-v1\webgpt\requests\requests.json`。
- 共 54 条独立 Workbench WebGPT request record；其中 43 条存在 `submittedAt`，表示本地流程到达网页提交动作；11 条在提交前失败或暂停。
- 54 条记录的状态统计：27 `COMPLETED`、11 `FAILED`、14 `RECOVERY_REQUIRED`、2 `PAUSED_FOR_USER`。
- 在存在 `submittedAt` 的 43 条中：27 条完成、3 条提交动作后失败、13 条提交动作后进入 `RECOVERY_REQUIRED`。`submittedAt` 是本地提交标记，不等同于 ChatGPT 服务端已接受或已生成回复。
- 仅 04:00 小时日志就有 13 条记录，其中 12 条到达提交动作；这比单看最后一组 21 条更能解释限流现象。
- 最新 Gate Fix + setup/clean 子集为 21 条记录，其中 19 条到达提交动作。此前把这 21 条误报成全部请求次数，已在本报告中纠正。
- `open`、`status`、`control`、`request status`、`reconcile` 等 CLI/控制调用未计入上述网页提交数；服务端实际限流计数不可从 Workbench 本地读取。
- AppData 工作台日志中虽然有 `account/rateLimits/updated` 事件，但它们是 Codex 账号侧遥测，不是 WebGPT 网页请求的 429/限流计数，不能并入 54/43。
- 用户截图显示 ChatGPT 网页“请求过于频繁”。观察到该提示后，本轮没有继续发送真实网页 Prompt，也没有自动提交 GPT 审查。

## 18. Gate Output

```text
request_idempotency: PASS
duplicate_prompt_prevention: PASS (WEB-5 baseline evidence; latest Gate Fix not proven)
cli_reattach: PASS
completed_restart_recovery: PASS
inflight_restart_safety: BLOCKED_BY_RATE_LIMIT (previous real attempt: REQUEST_NOT_VERIFIABLE)
control_ownership_hardening: PASS (contract/unit and prior baseline evidence)
role_aware_recovery: BLOCKED_BY_RATE_LIMIT (v2 Role phase not run)
request_persistence: PASS
single_webgpt_runtime: PASS
v1_core_behavior_changed: NO
npm_test: PASS (158/158)
rate_limit_observed: YES
v1_regression: PASS (automated; real Gate additions blocked)
multi_account: DEFERRED
gate_result: BLOCKED
gate_blocker: REAL_GATE_BLOCKED_BY_RATE_LIMIT
```

## 19. Stage Review Package

本报告对应：

`D:\办公\AI\Codex_Workbench_V1\dist\review\WEBGPT-WEB5-STAGE-REVIEW-PACKAGE.zip`

审核包包含：

- 本报告（最新真实状态和限流/request-count 证据）。
- `WEBGPT-WEB5-GATE-FIX-SUMMARY.json`：机器可读自动化、预算、阻塞状态和提交信息。
- `WEBGPT-WEB5-REAL-SMOKE-EVIDENCE.json`：此前真实尝试的原始有限证据与 v2 未执行原因。
- Gate Fix smoke、Request Manager、Workspace、Page Adapter、Role Registry/Service、Main/CLI/Control、Interruption Hook 的当前源码和相关测试。
- `package.json` 与当前构建/打包来源。
- changed-files summary、package provenance/hash 和安全排除说明。
- 不包含 Cookie、密码、Token、完整 Prompt、网页回答正文或原始 request journal；请求次数只以脱敏统计写入本报告。

审查时请返回：

```text
GATE_RESULT: PASS | FIX_REQUIRED | BLOCKED
```

当前建议 GPT 返回 `GATE_RESULT: BLOCKED` 或明确要求用户在限流解除后执行一次受预算约束的真实 Gate；不要把限流期间未执行的 real smoke 当成 PASS，也不要要求循环重试。

## 20. Local / Legacy Status

- `D:\办公\AI\Codex_Workbench`：只读检查，保留原有 dirty baseline，未修改。
- `D:\办公\AI\Auto_Agent`：只读检查，clean，未修改。
- 当前项目用户未提交文件：`dist-stage-a/`、`指导文档/*.docx`、既有 WebGPT spike 文档均未 add/modify/delete。
- 既有 `dist/review/WEBGPT-WEB3-STAGE-REVIEW-PACKAGE.zip` 与 `WEBGPT-WEB4-STAGE-REVIEW-PACKAGE.zip` 的工作树删除状态未在本阶段恢复或纳入提交。

```text
gate: READY_FOR_GPT_REVIEW
gate_result: BLOCKED_BY_RATE_LIMIT
waiting_state: WAITING_FOR_GPT_REVIEW
```
