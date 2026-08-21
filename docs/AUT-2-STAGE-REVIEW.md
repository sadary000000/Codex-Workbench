# AUT-2 Gate Fix 2 Stage Review

## 1. Executive Summary

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
gate_fix: Materialize REQUIREMENT Chat + Real Roundtrip
result: FIX_REQUIRED
base_commit: d4c8021
gate_fix_commit: 91c39ae
v1_core_changed: NO
webgpt_v1_changed: NO
runtime: PASS_REAL
role_materialization: PASS_REAL_SETUP
exact_requirement_role: PASS_REAL
real_requirement_roundtrip: FAIL
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

本轮只闭环“先物化一个稳定真实 REQUIREMENT Chat，再进入真实 AUT-2 Gate”。该前置链路已通过；正式 Requirement 请求也确实发送到了新 Chat，但返回的 bounded JSON 无效，Adapter 正确 fail-closed。因此本轮不能宣称 `PASS_CANDIDATE`。

## 2. Scope Resolution

### In scope

- 使用 packaged GUI Host + packaged Official CLI 建立同一 WebGPT Runtime。
- 在 Project `workts` 下创建一个测试 Chat 上下文。
- 发送一次限定用途的初始化 Prompt，使 Chat 产生稳定 `/c/` identity。
- 将该 Chat 精确绑定到 `REQUIREMENT` Role，真实打开并验证。
- 运行一次真实 Requirement alignment roundtrip，保留机器可读元数据和错误分类。
- 无论成功或失败都恢复原 REQUIREMENT binding，整理审查包。

### Out of scope

- Planner、Reviewer、Native Executor、Scheduler、Workflow UI、AUT-3。
- V1 Frozen Core、Native Thread/Turn/Item、Runtime Registry 或 WebGPT V1 架构重构。
- Cookie/Token、私有 API、历史 Chat 扫描、Prompt/Response 全文归档。
- 失败后的盲目重发、替代 Chat 或当前页面 fallback。

## 3. Architecture Boundary

```text
V1 Frozen Core
  └─ WebGPT V1 Runtime / Role Session / Request Manager
       └─ AUT-2 RequirementWebGptAdapter
            └─ RequirementAutomationService
```

本轮只在 AUT-2 Gate harness 与主进程的受控启动编排处增加 setup context；没有建立第二套 Conversation truth，也没有改变 WebGPT V1 的页面、请求或 Role 路由语义。

## 4. Implementation

- `scripts/aut2-real-webgpt-gate.ts`
  - 只使用 `execFile` 调用 Official CLI。
  - 先检查原 binding，再执行 `project open` / `project new-chat`。
  - 发送一次初始化消息并用 `chat latest`、User/Assistant 计数和 `ROLE_READY` 语义校验确认 Chat 已物化。
  - 通过临时 setup context 把原 binding、稳定 Chat URL、初始化 Request 元数据交给 GUI Gate。
  - `control auto` 超时只允许由独立 `status=READY/AUTO_CONTROL` 证据收敛，不把超时当作成功、不盲重试。
  - 清理临时 evidence/database，并保留脱敏后的运行证据。
  - 修正包装层在 Adapter 早期异常时的真实 Prompt 计数汇总。
- `src/main/main.ts`
  - 等待并校验 setup context；setup 失败立即显式失败，不等待无意义的长超时。
- `src/automation/aut2-real-webgpt-gate.ts`
  - 要求稳定 setup Chat 和精确 Role binding。
  - 真实 Gate 始终在 `finally` 恢复原 binding。
  - 保留 `PASS_REAL_SETUP`、Role routing、roundtrip、idempotency 和错误分层。

## 5. Real Gate Evidence

### Runtime

```yaml
gui_host: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
official_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
project: workts
project_id: 371c3fb8-30ac-4943-9584-1915045ea34d
workbench: READY
webgpt: READY
control_owner: AUTO_CONTROL
login_required: false
page_healthy: true
```

### Role materialization

```yaml
status: PASS_REAL_SETUP
role: REQUIREMENT
setup_chat: https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a88873d-0af0-83e8-a2e7-202adf2560f8
setup_request_id: wgpt-50c015b8-1544-48c3-9209-2b038524bac9
setup_prompt_count: 1/2
new_chat_count: 1/3
user_count: 1
assistant_count: 1
stable_chat_materialized: true
role_open_exact_target: true
```

### Formal Requirement request

```yaml
request_id: wgpt-09790d1c-3ed2-49d7-9781-72294e0cc4ac
target_chat: setup_chat
submitted: true
journal_state: COMPLETED
result: MALFORMED_REQUIREMENT_RESPONSE
repair_prompt_count: 0
wrong_chat_prompt_count: 0
```

错误是 bounded JSON candidate 无效或不平衡。没有第一轮 `NEEDS_INPUT`，所以 answers-to-draft、canonical requirement、USER confirmation 未到达。原 REQUIREMENT binding 已恢复为：

```text
https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc
```

## 6. Gate Matrix

| Gate | Result | Evidence |
|---|---|---|
| Runtime / login / AUTO_CONTROL | PASS_REAL | Packaged GUI Host + Official CLI status |
| Project open | PASS_REAL | Project `workts` context |
| Project new Chat context | PASS_REAL | Pending composer before setup send |
| REQUIREMENT Chat materialization | PASS_REAL_SETUP | Stable URL, User/Assistant counts, `ROLE_READY` |
| Exact REQUIREMENT Role binding/open | PASS_REAL | Same target URL confirmed |
| Batch alignment / NEEDS_INPUT | FAIL | `MALFORMED_REQUIREMENT_RESPONSE` |
| Answers to Draft | NOT_REACHED | No valid question batch |
| Canonical Requirement | NOT_REACHED | No Draft |
| Explicit USER confirmation | NOT_REACHED | No Draft |
| Change Request / Impact / Diff | PASS_AUTOMATED | Existing AUT-2 contract tests |
| Request no-resend safety | PASS | No repair or blind resend |
| Original binding restoration | PASS_REAL | Final status/URL equal original |

## 7. Prompt Budget

```yaml
hard_max_real_prompts: 12
target_max_real_prompts: 7
used_real_prompts: 2
hard_max_role_setup_prompts: 2
used_role_setup_prompts: 1
hard_max_new_test_chats: 3
used_new_test_chats: 1
hard_max_repair_prompts: 3
used_repair_prompts: 0
```

原始 Gate evidence 因 Adapter 在正式 request envelope 返回前抛错，曾将 `realPromptCount` 写成 1。最终审查包按 Request Journal 元数据更正为 2：初始化 1 条、正式 Requirement 1 条；没有第三条 Prompt。

## 8. Automated Verification

```yaml
npm_run_check: PASS
npm_test: PASS
tests: 276/276
npm_run_build: PASS
npm_run_package_win: PASS
npm_audit_omit_dev: PASS
git_diff_check: PASS
secret_scan: PASS
```

最新 packaged Host/CLI 已重新生成。计数修正只更新 harness 的证据汇总，不重新执行真实网页请求。

## 9. Safety / Regression

- V1 Frozen Core：未修改。
- WebGPT V1：未修改其产品语义。
- PLANNER / REVIEWER：未修改。
- Native execution / Planner / Reviewer：均未启动。
- 没有替换 native identity、没有误发到原 Chat 之外的 Chat、没有自动删除用户 Chat。
- 没有读取 Cookie/Token、没有扫描历史 Chat、没有保存 Prompt/Response 全文。
- 旧 donor `D:\办公\AI\Codex_Workbench` 保持原有 dirty baseline，只读未改；`D:\办公\AI\Auto_Agent` 未修改。

## 10. Review Package

```text
D:\办公\AI\Codex_Workbench_V1\dist\review\AUT-2-STAGE-REVIEW-PACKAGE.zip
```

包内只放本阶段报告、脱敏运行证据、Prompt budget、provenance 和测试摘要；不含 Cookie、Token、浏览器 Profile、私人聊天正文或无关日志。

## 11. Gate

```yaml
gate: FIX_REQUIRED
safe_stop: YES
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```
