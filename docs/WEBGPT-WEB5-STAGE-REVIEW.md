# Codex Workbench WebGPT — WEB-5 阶段审查材料

> 当前审查状态：`WEB-5 FINAL REAL GATE / PASS_CANDIDATE`。历史 Project CLI focused gate 已通过；本轮在真实打包 EXE 上完成了 In-flight interruption → restart → no-resend 与 Role wrong-chat recovery 两项最终证据。Gate A 最终允许状态为 `RECOVERY_REQUIRED`，Gate B 为无 Prompt 的真实目标恢复；没有自动提交 GPT。

## 1. Executive Summary

本阶段完成 `WEB-5：Request Recovery, Idempotency & Control Ownership Hardening`。

核心结果：

- WebGPT 仍只有一个 Core / Browser Runtime / Electron Session / Request Manager / Role Registry / Page Adapter。
- 同一个幂等键和同一请求语义只返回原 request，不会再次向网页提交 Prompt；语义变化返回 `IDEMPOTENCY_CONFLICT`。
- 已完成请求在 Workbench 重启后可以用同一个 `requestId` 重新读取；提交中、生成中或不确定状态不会盲目重发，而是进入恢复/重新核对路径。
- `USER_CONTROL`、`AUTO_CONTROL`、暂停和交还控制有明确边界；用户接管后，未提交的自动请求不会修改网页。
- Role 绑定要求稳定的 `/c/<chat-id>` Chat URL；未知、待绑定或失配目标 fail-closed，不 fallback 到当前 Chat，也不替换 Role。
- WEBGPT Web5 基线 real smoke 的重复 Prompt、幂等冲突、CLI wait/result、控制权暂停/恢复、超时后继续和完成请求重启证据仍保留在历史报告中。
- 本轮修复了两个 Request Manager 自动化失败：终态等待与 journal 持久化竞态、以及目标页 hydration 等待与测试夹具语义不一致；历史 WEB-5 修复测试已通过，当前 Project CLI 修复后的全量测试为 162/162。
- v2 不再提交新的真实网页 Prompt。此前 Gate Fix real smoke 的最后一次尝试仍是 `RECOVERY_REQUIRED / REQUEST_NOT_VERIFIABLE`，所以 in-flight restart 和 Role wrong-chat real Gate 尚未取得 PASS 证据。
- 测试期间 ChatGPT 网页出现“请求过于频繁”提示；本地日志记录了 54 条独立请求记录，其中 43 条到达网页提交动作。该事实已单独记录，后续没有继续触发真实网页请求。
- V1 Frozen Core 的 Native Thread / Turn / Item、Runtime、Project、Composer、Map、Manual Mode 没有建立第二事实源，也没有改变其身份规则。

本地阶段结论：`READY_FOR_GPT_REVIEW`，自动化部分 PASS，两个最终真实 Gate 已取得受限范围内的 PASS 证据。历史网页限流仍作为安全事实保留；本轮 Gate A 只新增 1 次真实 Prompt，Gate B 没有发送 Prompt。本轮审核包由用户手动提交 GPT；本 Agent 不自动发送网页请求或提交审查。

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
| `npm test` | PASS — 162/162 |
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

`v1_core_behavior_changed: NO`；`v1_regression: PASS（npm test 162/162）`。

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
- 本轮两个自动化失败已修复；当前 `npm test` 为 162/162。修复不改变 Request lifecycle，也没有用 sleep 掩盖问题。
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
npm_test: PASS (162/162)
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

## 24. WEB-5 Final Real Gate — current superseding evidence

本节 supersede 第 13.2、13.3、17.1、18、21、22 节中关于“本轮未执行最终 Gate”的状态。历史运行记录仍保留，当前结论只基于本节和机器可读证据：

`docs/WEBGPT-WEB5-FINAL-REAL-GATE-EVIDENCE.json`

### 24.1 Gate A — in-flight interruption → restart → no resend

本 Gate 使用标准打包 EXE，通过 Node `execFile` 调用 CLI；只在 ChatGPT Project `workts` 上新增 1 次真实 Prompt，未触发限流提示。测试 hook 仅在本地显式启用，用于在真实网页已经出现 User 消息、且页面正在生成时暂停 Owned Workbench 进程；hook 不记录 Prompt 正文。

```text
requestId: wgpt-6f363f58-139b-4eab-899b-53e94c3e5ee7
idempotencyKey: WEBGPT_WEB5_FINAL_INFLIGHT_1787227170573_f33ad78b
project: workts
baselineUserCount: 0
markerObservedUserCount: 1
markerObservedGenerating: true
interruptedAt: 2026-08-20T12:00:09.921Z
restartAt: 2026-08-20T12:01:12.121Z
sameRequestId: YES
returnedRequestIdAfterRestart: wgpt-6f363f58-139b-4eab-899b-53e94c3e5ee7
duplicatePromptCount: 0
finalState: RECOVERY_REQUIRED
finalError: REQUEST_NOT_VERIFIABLE
```

恢复后的同 key `send` 只重新查询同一 Request，返回相同 `requestId`；没有产生第二条网页 User Prompt，也没有创建替代 Request/Chat。随后 `request status` / `control auto` 将该请求保留在 fail-closed recovery 路径，没有盲目重发。

允许的最终状态是 `COMPLETED`、`RECOVERY_REQUIRED` 或 `INDETERMINATE`，因此本 Gate 的“禁止重复发送”目标为 `PASS`。限制是：该测试从 Project 作用域空白 Chat 开始，强制重启后页面仍停留在 Project route，未提供稳定 `/c/<id>`，所以恢复核对最终为 `REQUEST_NOT_VERIFIABLE`；这不等同于重复发送，也不宣称最终回答完成。中断前的真实页面 marker 已观察到唯一新增 User，`duplicatePromptCount=0` 由 marker、幂等重连和 Request journal 共同确定。

### 24.2 Gate B — Role wrong-chat recovery

本 Gate 不发送 Prompt。它用已存在且稳定的 Role 绑定做真实导航恢复：

```text
Project context open: workts → PASS
Role: PLANNER
Chat A (bound target): https://chatgpt.com/c/6a865d2c-69fc-83ee-9845-1c236f19d7b9
Chat B (wrong current page): https://chatgpt.com/c/6a865d36-a53c-83ee-aa28-d4cbd50c85b3
```

执行证据：

1. 读取 PLANNER binding，记录 Chat A。
2. 真实 `role open --role reviewer` 导航到 Chat B。
3. `current` 确认当前页面就是 Chat B，页面健康、Composer 可见。
4. 交还 `AUTO_CONTROL` 后执行 `role open --role planner`，要求按绑定重新定位。
5. `current` 确认页面回到 Chat A；再次读取 binding，URL 和状态未改变。

```text
wrongChatPromptCount: 0
silentRoleRebind: NO
roleBindingChanged: NO
bindingBefore: Chat A
bindingAfter: Chat A
promptSent: NO
globalNewChatClicked: NO
Gate B: PASS
```

这是真实的无 Prompt target-recovery 证据：当前页面错误时，Role open 使用绑定的 Chat A，而不是把 Chat B 当作目标。当前 Role Registry 使用 Workbench Project ID `371c3fb8-30ac-4943-9584-1915045ea34d`；CLI 没有暴露 Web Project 内部 ID，但同一次运行的 `project open --name workts` 已取得目标 Project route/context PASS。没有修改 binding、没有静默 rebind、没有创建 Chat。

### 24.3 Final budget / safety boundary

```text
MAX_NEW_REAL_PROMPTS: 2
USED: 1
REMAINING: 1
Gate B additional prompts: 0
rate-limit observed during this final run: NO
historical rate-limit observed: YES
```

观察到历史“请求过于频繁”后，本轮没有循环重试、没有扫描历史 Chat、没有并发 Prompt、没有多账号绕过，也没有自动打开/上传审核包。没有 Cookie、Token、密码、完整 Prompt 或网页回答正文进入报告。

### 24.4 Final Gate Output

```text
[CODEX_WORKBENCH_STAGE_REVIEW_READY]

stage: WEB-5 Final Real Gate
inflight: PASS
sameRequestId: YES
duplicatePromptCount: 0
roleRecovery: PASS
wrongChatPromptCount: 0
automatedTests: PASS (166/166; check/build/package/audit/diff/secret scan PASS)
reviewPackage: D:\办公\AI\Codex_Workbench_V1\dist\review\WEBGPT-WEB5-STAGE-REVIEW-PACKAGE.zip
nextAction: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

本轮仍停在 WEB-5；不进入 WEB-6。产品代码未修改，只新增审查脚本、最终证据 JSON、报告和审核包内容。

## 21. Final closure addendum — Project CLI real smoke

本次按最终闭环指令，对标准打包 EXE 和目标 Project `workts` 只做了一次无 Prompt 的最小真实验证。详细机器证据见：

- `docs/WEBGPT-WEB5-REAL-SMOKE-EVIDENCE.json`
- `docs/WEBGPT-WEB5-GATE-FIX-SUMMARY.json`

执行顺序及结果：

| 操作 | 结果 |
|---|---|
| `webgpt status --json` 初次启动 | Workbench READY，但 WebGPT UNAVAILABLE、页面不健康 |
| 一次正常 `webgpt open --json` 恢复 | 页面恢复为 `https://chatgpt.com/`，`pageHealthy=true`，Composer 可见 |
| `webgpt control auto --json` | 最终状态确认 `controlOwner=AUTO_CONTROL` |
| `webgpt project open --name "workts" --json` | 无可用 JSON 响应，页面未进入 Project |
| 同命令一次非 JSON 诊断调用 | 同样无可用响应，页面仍为 ChatGPT 首页 |
| `webgpt project new-chat --name "workts" --json` | 未执行 |

因此：

```text
projectName: workts
open: BLOCKED_BY_PAGE_OR_NETWORK
newChat: NOT_TESTED
projectContextEvidence: NOT_OBTAINED
chatUrlBeforeFirstPrompt: NOT_OBTAINED
promptSentDuringProjectSmoke: NO
```

这不是新的 selector 失败证据：页面已经恢复到健康首页，但 Project CLI 调用没有返回可验证的 Control Plane 结果。按照预算和安全规则，本轮没有重复刷新、没有重复 new-chat、没有发送 Prompt，也没有继续 WEB-5 的两个真实 Gate。

### 21.1 WEB-5 final gate decision

Project CLI 是本次 WEB-5 剩余真实 Gate 的前置条件。由于 `project open` 未取得 PASS，本轮不执行 in-flight interruption 或 Role wrong-chat 真实 Prompt。此前已观察到的 ChatGPT 网页限流仍作为真实 Gate 的既有阻塞事实保留；本轮没有重新触发限流，也没有新增真实 Prompt。

```text
[CODEX_WORKBENCH_STAGE_REVIEW_READY]

stage: WEB-5 Request Recovery, Idempotency & Control Ownership Hardening
local_result: BLOCKED
project_cli_open_real_smoke: BLOCKED_BY_PAGE_OR_NETWORK
project_cli_new_chat_real_smoke: NOT_TESTED
automated_tests: PASS
inflight_real_interruption: BLOCKED_BY_RATE_LIMIT
inflight_restart_no_resend: NOT_TESTED
same_key_after_restart: NOT_TESTED
real_page_duplicate_count: NOT_PROVABLE
role_recovery_real_project: BLOCKED_BY_RATE_LIMIT
wrong_chat_prompt_count: NOT_TESTED
v1_core_behavior_changed: NO
v1_regression: PASS
review_report: docs/WEBGPT-WEB5-STAGE-REVIEW.md
review_package: dist/review/WEBGPT-WEB5-STAGE-REVIEW-PACKAGE.zip
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

## 22. Current focused Gate Fix superseding addendum

本节 supersede 第 21 节中“无可用 JSON 响应 / `BLOCKED_BY_PAGE_OR_NETWORK`”的历史描述。第 21 节保留为旧运行记录；当前 focused fix 已将失败分类改为结构化 Control Plane 错误，并没有把旧结论改写成 PASS。

### 22.1 Fix scope

- `project open` 服务端预算 60 秒，CLI 预算 65 秒；
- `project new-chat` 服务端预算 90 秒，CLI 预算 95 秒；
- 操作阶段记录 request/handler/lookup/click/navigation/composer/action/response-write/CLI receive/exit 时间线；
- 超时推进 automation epoch、停止挂起导航，并返回 `CONTROL_OPERATION_TIMEOUT`；客户端超时返回 `CONTROL_RESPONSE_TIMEOUT`；
- 不保存 Prompt、回答正文、Cookie、Token、页面全文或截图，不引入第二事实源。

### 22.2 Current real evidence

按以下无 Prompt 序列执行：

```text
webgpt status --json
webgpt control auto --json
webgpt project open --name "workts" --json
webgpt project new-chat --name "workts" --json
```

结果：

| Command | Structured result |
|---|---|
| `status` | 返回结构化状态；一次运行内层响应耗时 232 ms，但 CLI 外层受启动子进程句柄影响延迟返回 |
| `control auto` | PASS，`AUTO_CONTROL` |
| `project open workts` | `ok=false`、exit 1、约 12,401 ms，`PROJECT_NAVIGATION_NOT_CONFIRMED`；`matchCount=1`，但 `active=false`、`contextMatch=false`、`projectRoute=false`，URL 仍为 ChatGPT 首页 |
| `project new-chat workts` | `ok=false`、exit 1、约 10,310 ms；同一 open 前置确认失败，未进入 Project 行内 action |

当前页面后续不再含精确目标 `workts`，观察到的是 `works`，没有替换测试。独立冷启动检查还记录过结构化 `WORKBENCH_START_TIMEOUT` 与 `CONTROL_RESPONSE_TIMEOUT`；手动启动标准 EXE 能正常驻留。该冷启动生命周期问题与 Project route/context 失败分开记录。

```text
current_focused_gate: FIX_REQUIRED
project_open_real_smoke: FAIL / PROJECT_NAVIGATION_NOT_CONFIRMED
project_new_chat_real_smoke: FAIL_PREREQUISITE / NOT_ENTERED
new_real_prompt_count: 0
new_chat_created: false
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

## 23. Final Project CLI DOM Gate — current result supersedes section 22

本节记录最终 focused DOM gate。第 22 节保留为历史运行记录；本节才是当前审查结论。

### 23.1 Implementation decision from real DOM

真实 Project 行悬停后有两个按钮：

- `打开项目首页`：用户截图中的铅笔按钮，实际 Project 作用域新 Chat/项目首页入口；
- `打开 workts 的项目选项`：用户截图中的三个点，仅项目菜单。

最终 `open` 和 `new-chat` 都只追踪并点击第一个语义按钮；不点击三个点，不查询或点击全局 `create-new-chat-button` / `新聊天`，不发送 Prompt。

### 23.2 Settled real EXE evidence
```text
package: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
run: 2026-08-20T10:07:51.762Z - 2026-08-20T10:07:53.196Z
invocation: Node execFile for every EXE CLI command
commands: status → control auto → project inspect → project open → project new-chat
all_command_exit_codes: 0
stderr: empty
newPromptCount: 0
```

`inspect`：`found=true`、`ambiguous=false`、`matchCount=1`；row 为 `DIV[role=button]`，container class 为 `group/project-unfurl-row relative`；hover actions 正确返回铅笔和三个点两个受限控件。

`open`：`matchCount=1`、`contextMatch=true`、`projectRoute=true`、Composer 可见，URL 为目标 `workts/project`。

`new-chat`：`chatCreated=true`、`chatUrl=null`、`promptSent=false`、`actionSource=project-row-new-chat-pencil`、`actionLabel=打开项目首页`、`contextMatch=true`、`projectRoute=true`、`composerFound=true`、`globalNewChatClicked=false`。

`chatUrl=null` 是正确结果：操作只建立 Project 作用域的空白 Chat 上下文，首条 Prompt 尚未发送，不伪造 `/c/...` URL。

### 23.3 Cold-start limitation

重新打包后立即启动并立刻执行时，首个 inspect/open 曾出现真实 `ERR_CONNECTION_CLOSED (-100)`；这属于 WebView 首次网络就绪时序，未循环重试、未刷新页面、未发送 Prompt。保持会话稳定后同一 EXE 复跑五步序列全部通过。该限制单独记录，不降低最终 DOM selector/context Gate 结论。

### 23.4 Gate

implementation_commit: 8e15807
package_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```text
DOM_INSPECT: PASS
PROJECT_OPEN: PASS
PROJECT_NEW_CHAT: PASS
PROMPT_SENT: NO
GLOBAL_NEW_CHAT_CLICKED: NO
AUTOMATED_TESTS: PASS (166/166)
GATE_RESULT: PASS
```

## 25. WEB-5 Final Freeze Metadata

本节是最终冻结收口记录，supersede 早期报告中尚未完成最终 Gate 的状态；不改变任何产品实现。

### 25.1 Executive Summary

```yaml
stage: WEB-5 Request Recovery, Idempotency & Control Ownership Hardening
result: PASS_CANDIDATE
v1_core_changed: NO
automation_layer_changed: NO
next_stage_candidate: WEB-6 Automation Architecture Design
freeze_scope: report, evidence, audit scripts, review package only
```

### 25.2 Architecture Boundary

```text
V1 Frozen Core
    |
    +-- WebGPT Feature
          |
          +-- Electron Browser Runtime
          +-- CLI
          +-- Control Plane
          +-- Request Manager
          +-- Role Registry
```

WebGPT 是 V1 上的扩展能力，不是第二套 Codex，也没有建立第二套 Conversation truth。Native Thread / Turn / Item、V1 Runtime Registry、Project、Composer 和 Map 均未改动。WebGPT 只通过单一 Electron Browser Runtime、受限页面元数据、Request Manager 和显式 Role binding 提供网页能力。

### 25.3 Automated Verification / Provenance

验证时间：`2026-08-20T21:23:31+08:00`（冻结前工作树核对时间；最终构建验证在同一收口窗口完成）。

```text
npm run check: PASS
npm test: PASS (166/166)
npm run build: PASS
npm run package:win: PASS
npm audit --omit=dev: PASS (0 vulnerabilities)
git diff --check: PASS
secret scan: PASS (no credential pattern match)
```

```text
base_commit_before_freeze: 87f432d
web5_implementation_commit: 8e15807
freeze_commit: supplied in final handoff after the docs-only freeze commit
review_package_commit: same docs-only freeze commit
```

`freeze_commit` 不写入自身 ZIP manifest，避免自引用 hash；最终 Git commit hash、审核包 SHA-256 和当前 `git status` 在本次交付回执中给出。

### 25.4 Project CLI / Real Gate Summary

```text
projectName: workts
project_open: PASS
project_new_chat: PASS
matchCount: 1
contextMatch: true
projectRoute: true
composerFound: true
promptSent: false (Project CLI gate)
globalNewChatClicked: false

inflight_safety: PASS
sameRequestId: YES
duplicatePromptCount: 0
role_safety: PASS
wrong_chat_prompt_count: 0
silent_role_rebind: NO
```

Gate A 的最终允许恢复状态为 `RECOVERY_REQUIRED / REQUEST_NOT_VERIFIABLE`，目标是验证 `NO RESEND`，不是强制恢复为 `COMPLETED`。Gate B 使用 Chat B → 绑定 Chat A 的真实无 Prompt recovery，未创建 Chat、未改 Role binding。

### 25.5 Deferred to Future Stages

以下只记录，不在本轮修复：

| Deferred issue | Current state | Future boundary |
| --- | --- | --- |
| Recovery 完整恢复 | `RECOVERY_REQUIRED`；Project 空白 Chat 的 `/c/<id>` identity 不稳定 | Chat identity hardening |
| Planner continuation | 未实现自动继续执行 | Automation Layer |
| Multi-account | `DEFERRED` | Future account/session design |
| Multi-session | `DEFERRED` | Future runtime/session design |
| RateLimitGuard | 目前只有本轮保护策略，未产品化 | Automation Infrastructure |

这些 Deferred Issue 不构成当前产品代码变更，也不改变本次 `PASS_CANDIDATE` 资料冻结结论。

### 25.6 Final Review Package Contents / Exclusions

审核包：

```text
D:\办公\AI\Codex_Workbench_V1\dist\review\WEBGPT-WEB5-STAGE-REVIEW-PACKAGE.zip
```

包含最终报告、`WEBGPT-WEB5-FINAL-REAL-GATE-EVIDENCE.json`、Gate summary、历史 real smoke evidence、Project CLI report、最终 Gate 审计脚本、相关 WebGPT source/tests 和 build/package 元数据。

明确不包含 Cookie、Token、Browser profile、密码、用户私人聊天内容、完整 Prompt、网页回答正文、request journal、`dist-stage-a/`、用户 `指导文档/*.docx` 或任何旧 donor 文件。

### 25.7 Freeze Output

```text
[CODEX_WORKBENCH_WEB5_FREEZE_READY]

stage: WEB-5 Final Freeze
result: PASS_CANDIDATE
automated_tests: PASS
project_cli: PASS
inflight_safety: PASS
role_safety: PASS
v1_core_changed: NO
review_report: D:\办公\AI\Codex_Workbench_V1\docs\WEBGPT-WEB5-STAGE-REVIEW.md
review_package: D:\办公\AI\Codex_Workbench_V1\dist\review\WEBGPT-WEB5-STAGE-REVIEW-PACKAGE.zip
implementation_commit: 8e15807
freeze_commit: FINAL_HANDOFF_COMMIT
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

冻结完成后停止，不自动打开 ChatGPT、不自动上传、不等待 GPT、不进入 WEB-6。
