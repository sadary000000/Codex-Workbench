# AUT-2 Real WebGPT Evidence

## 结论

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
result: FIX_REQUIRED
webgpt_contract: PASS_AUTOMATED
real_webgpt_runtime: PASS_REAL_PRECHECK_ONLY
real_requirement_roundtrip: FAIL
official_cli_external_probe: PASS
gui_exe_used_as_public_cli: NO
v1_core_changed: NO
webgpt_v1_changed: NO
```

本轮已验证 packaged GUI Host 和 Official CLI 可以连接同一个 Control Plane；登录状态、AUTO_CONTROL、REQUIREMENT Role Open 以及精确 Chat URL 预检均可通过。但 Requirement Service 的真实网页请求在提交前被现有目标保护拒绝，未产生网页 User Prompt，因此不能把 AUT-2 Real Gate 写成 PASS。

## 测试边界与预算

```yaml
hardMaxRealPrompts: 12
targetMaxRealPrompts: 6
hardMaxNewChats: 3
hardMaxRepairPrompts: 3
maxRoleSetupPrompts: 0
attemptedRealRequests: 2
usedRealPrompts: 0
usedNewChats: 1
usedRepairPrompts: 0
```

两次 Gate 尝试使用同一个 synthetic 目标语义；均在网页提交前失败，没有重复发送。一次 `role new --replace` 只用于验证新 Role Chat 是否能得到稳定 URL，返回 `PENDING_CHAT_URL` 后立即用原 URL 恢复；没有发送 Role 初始化 Prompt。没有扫描历史 Chat、Cookie、Token、raw HTML 或私人聊天内容。

## 使用的运行时与 CLI

```yaml
gui_host: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
official_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
official_cli_used: YES
gui_exe_used_as_public_cli: NO
same_runtime: YES
same_persistent_session: YES
test_project_ref: 371c3fb8-30ac-4943-9584-1915045ea34d
requirement_role: REQUIREMENT
target_chat_ref: https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc
```

预检证据：在 AUTO_CONTROL 下，Official CLI `webgpt role open` 返回 `ok=true`、`onChatPage=true`、`composerFound=true`，`currentUrl` 与目标 Chat 一致，`loginRequired=false`。该页面当时没有可见 User/Assistant 条目（`userCount=0`、`assistantCount=0`），这是后续“新 Chat 是否已物化”的关键限制。

## 真实 Gate 尝试

### Attempt 1

```yaml
requestId: wgpt-24b78c80-9222-4316-acd9-255fe6a582c7
idempotencyKey: aut2:alignment:b7210c50-7484-4f66-b62b-82b9da6c6493:round:6362ec4a-ac53-4133-94c2-d032d9bc46dd:a521a89f093da9034fab1b8e14cb93bc
semanticSha256: f31bd06499601e66240ba9af02bc773d0994c69f2e22f4e3633fb8f7101c5308
targetChatUrl: https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc
submitted: false
submittedAt: null
observedGateResult: FAIL
```

### Attempt 2

```yaml
requestId: wgpt-13270834-c441-4ca3-8730-a7943f12a14a
idempotencyKey: aut2:alignment:954a8f33-46fd-4126-9ebb-8543ae896966:round:7b1c7c89-94e8-4de8-b2a9-b205e3d14482:a521a89f093da9034fab1b8e14cb93bc
semanticSha256: f31bd06499601e66240ba9af02bc773d0994c69f2e22f4e3633fb8f7101c5308
targetChatUrl: https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc
submitted: false
submittedAt: null
observedGateResult: FAIL
```

第一次 Gate 输出由 Requirement Service 包装为 `MALFORMED_REQUIREMENT_RESPONSE`；Request Journal 在后续恢复检查中保留为 `RECOVERY_REQUIRED`，没有 `submittedAt`。第二次同样在提交前被 `ROLE_CHAT_MISMATCH` 保护拒绝，后续恢复检查仍未发现可验证的目标 Chat 内容，当前 Journal 状态为 `RECOVERY_REQUIRED`。这不是向错误 Chat 发送，也不是 Prompt 重发。

## 为什么不能继续强行真实发送

原 REQUIREMENT binding 可以被导航确认，但目标 Chat 当前是空的；点击 `role new` 只返回 `PENDING_CHAT_URL` 并回到首页。按照 ChatGPT 页面行为，只有完成一次对话后才可能得到可稳定使用的 Chat 身份；而本轮明确要求 `MAX_ROLE_SETUP_PROMPTS=0`。在没有稳定、已物化的 REQUIREMENT Chat 前，绕过 Adapter 的精确 BOUND 检查、使用当前页面 fallback、或发送一个角色初始化 Prompt 都会违反本阶段安全边界。

因此本轮停止在真实 Gate 的安全边界：

```text
Requirement Service → RequirementWebGptAdapter → Role Session
→ target verification → fail-closed
```

没有进入 `NEEDS_INPUT`，没有解析问题批次，没有生成 Draft，也没有执行网页侧 USER Confirmation。`PASS_AUTOMATED` 的 Domain/Contract/Confirmation/Data Egress 证据仍然有效，但不等于 `PASS_REAL`。

## Gate 分级

| Gate | 结果 | 证据 |
|---|---|---|
| Requirement Domain | PASS_AUTOMATED | 现有 AUT-2 单元/合同测试 |
| Batch Alignment Contract | PASS_AUTOMATED | bounded contract 与服务测试 |
| Canonical Requirement / payloadSha256 | PASS_AUTOMATED | 服务/持久化测试 |
| Explicit USER Confirmation | PASS_AUTOMATED | actor guard 与状态机测试 |
| Change Request / Impact / Diff | PASS_AUTOMATED | 现有测试 |
| Data Egress / Trust Boundary | PASS_AUTOMATED | policy 与 injection 测试 |
| Official CLI external probe | PASS | packaged CLI + same runtime |
| Exact REQUIREMENT Role Open | PASS_REAL | URL/page/composer 预检 |
| Real batch alignment | NOT_REACHED / FAIL | 发送前目标保护拒绝 |
| Real answers-to-draft | NOT_REACHED | 没有第一轮问题 |
| Real canonical draft | NOT_REACHED | 没有有效网页响应 |
| Real USER confirmation | NOT_REACHED | 没有 Draft |
| Request idempotency | PASS_AUTOMATED; REAL NO-RESEND OBSERVED | 两次尝试均未提交 |

## 安全与范围

- `official_cli_used=YES`；没有把 GUI EXE 当公共 CLI。
- 没有修改 V1 Frozen Core、Native Thread/Turn/Item、Runtime Registry 或 WebGPT V1 语义。
- 没有启动 Planner、Reviewer、Native Executor、Scheduler 或 AUT-3。
- 没有复制 Transcript、Prompt/Response 全文、Cookie、Token、浏览器私有状态。
- 原 REQUIREMENT binding 的 Project、Role、Chat URL 已恢复；PLANNER/REVIEWER 未修改。

## 下一步最小阻塞解除条件

需要用户提供或在已允许的真实 WebGPT 操作中先完成一个明确、稳定、可复用的 REQUIREMENT Chat 物化流程，并将其绑定到当前测试 Project；该流程若需要发送初始化 Prompt，必须单独获得允许并计入真实 Prompt 预算。本轮不自行发送该 Prompt。
