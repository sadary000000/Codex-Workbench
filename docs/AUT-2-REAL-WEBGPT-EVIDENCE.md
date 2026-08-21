# AUT-2 Gate Fix 2 — Real WebGPT Evidence

## 结论

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
gate_fix: Materialize REQUIREMENT Chat + Real Roundtrip
result: FIX_REQUIRED
runtime: PASS_REAL
role_materialization: PASS_REAL_SETUP
exact_requirement_role: PASS_REAL
batch_alignment: FAIL
answers_to_draft: NOT_REACHED
canonical_requirement: NOT_REACHED
explicit_user_confirmation: NOT_REACHED
change_request: PASS_AUTOMATED
v1_core_changed: NO
webgpt_v1_changed: NO
```

本轮已证明 Gate Fix 2 的前置问题已闭环：通过 `project new-chat` 创建待发送上下文，再发送一次受限初始化消息，得到稳定的真实 Chat URL；该 Chat 被精确绑定到 `REQUIREMENT` Role，并可通过 `role open` 重新确认。

随后正式 Requirement 请求确实发送到了这个新 Chat，但网页返回无法解析的 bounded JSON。Adapter 按既有 fail-closed 规则报告 `MALFORMED_REQUIREMENT_RESPONSE`，没有 repair Prompt、盲目重发、替代 Chat 或错误 Chat fallback。因此本轮是 `FIX_REQUIRED`，不能提升为 `PASS_CANDIDATE`。

## 运行时与边界

```yaml
gui_host: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
official_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
official_cli_used: YES
gui_exe_used_as_public_cli: NO
project_name: workts
project_id: 371c3fb8-30ac-4943-9584-1915045ea34d
same_runtime: YES
same_persistent_session: YES
login_required: NO
page_healthy: YES
control_owner: AUTO_CONTROL
```

`webgpt control auto` 公共命令本次因已有持久化 recovery sweep 超过 CLI 运输超时而返回失败；独立 `status` 随后确认 `READY/AUTO_CONTROL`，所以没有把超时当作成功，也没有盲目重试。`project open` 与 `project new-chat` 均通过。

## 真实初始化与 Chat 物化

初始化只使用一条 Prompt，内容不进入本报告；仅记录可审计元数据：

```yaml
role: REQUIREMENT_SETUP
setup_request_id: wgpt-50c015b8-1544-48c3-9209-2b038524bac9
setup_idempotency_key: aut2:setup:1787332385192:61821983-d0c1-4b40-b690-a48bf4a1c2d8
setup_chat: https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a88873d-0af0-83e8-a2e7-202adf2560f8
setup_prompt_count: 1/2
new_chat_count: 1/3
user_count_after_setup: 1
assistant_count_after_setup: 1
semantic_response_check: ROLE_READY
stable_chat_materialized: YES
```

`chat latest` 返回同一 Chat URL、至少一个 User 和 Assistant 条目；随后 `role bind --replace` 与 `role open` 均确认目标为该物化 Chat。初始化结束后，原 `REQUIREMENT` binding 已在 Gate `finally` 路径恢复，最终仍为原 URL；PLANNER/REVIEWER 没有改动。

## 正式 Requirement 请求

```yaml
request_id: wgpt-09790d1c-3ed2-49d7-9781-72294e0cc4ac
idempotency_key: aut2:alignment:c84c6da2-13f8-4334-9f48-a2bcf5dc17dd:round:79c68acd-2799-4c28-bde4-b0c1a373c33a:9024228823f5ba143eb4bd06afd9e299
target_chat: https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a88873d-0af0-83e8-a2e7-202adf2560f8
prompt_chars: 468
prompt_sha256: 1e6318b21024069b4afd6f45b5a914e5ca59884c71734d810365102649828efe
semantic_sha256: 34339e8f99535c458af35ec16a9bcb4329cec4975615be08339266f723ed8995
result_sha256: 263436cb464d4b2378663fc09f45c229ead181f4a93564901a7f03b0b396784a
journal_state: COMPLETED
created_at: 2026-08-21T17:13:59.372Z
submitted_at: 2026-08-21T17:14:03.582Z
completed_at: 2026-08-21T17:14:26.204Z
result: MALFORMED_REQUIREMENT_RESPONSE
repair_prompt_count: 0
```

失败原因是 bounded JSON candidate 无效或不平衡。没有获得第一轮 `NEEDS_INPUT` 问题批次，因此 answers-to-draft、canonical requirement、USER confirmation 均为 `NOT_REACHED`。没有把失败误判为成功。

## 预算与计数

```yaml
hard_max_real_prompts: 12
target_max_real_prompts: 7
real_prompt_count: 2
hard_max_role_setup_prompts: 2
role_setup_prompt_count: 1
hard_max_new_test_chats: 3
new_test_chat_count: 1
hard_max_repair_prompts: 3
repair_prompt_count: 0
duplicate_prompt_count: 0
wrong_chat_prompt_count: 0
```

原始 Gate JSON 在 Adapter 异常发生前没有拿到正式请求 envelope，所以其中 `realPromptCount=1` 只计入初始化 Prompt。最终审查计数按本次 Request Journal 元数据更正为 2：初始化 1 条 + 正式 Requirement 1 条；没有第三条 Prompt。

## 自动化 Gate 与安全边界

- Requirement Domain、Batch Contract、Canonical Requirement、USER Confirmation Guard、Change Request、Data Egress 和 Prompt Injection Boundary：`PASS_AUTOMATED`。
- Official CLI 使用 `execFile`，没有把 GUI EXE 当公共 CLI，也没有设置 `ELECTRON_RUN_AS_NODE`。
- 没有扫描历史 Chat、读取 Cookie/Token、保存 Prompt/Response 全文或浏览器私有 Profile。
- 没有启动 Planner、Native Executor、Reviewer、Scheduler、Workflow UI 或 AUT-3。
- 没有修改 V1 Frozen Core 或 WebGPT V1 语义；未创建替代 Chat；原 REQUIREMENT binding 已恢复。

## 自动化验证

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

最新 packaged Host/CLI 已重新构建。计数修正只影响 Gate harness 的证据汇总，不重新发送真实 Prompt。

## 阶段判断

```text
REQUIREMENT Chat materialization: PASS_REAL_SETUP
Exact Role routing: PASS_REAL
Real Requirement roundtrip: FAIL — MALFORMED_REQUIREMENT_RESPONSE
AUT-2 Gate Fix 2: FIX_REQUIRED
```

本次失败不是“找不到新 Chat”、不是 wrong-thread send、不是 timeout 误报，也不是 Prompt 重发；下一步只需由 GPT 审查当前真实响应协议失败，不能把本包当作 AUT-2 Real Gate PASS。
