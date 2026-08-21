# AUT-2 Gate Fix 3 Stage Review

## 1. Executive Summary

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
gate_fix: Bounded JSON Repair + Complete Real Requirement Roundtrip
result: FIX_REQUIRED
base_commit: 8eda595
gate_fix_commit: 917c060
v1_core_changed: NO
webgpt_v1_changed: NO
planner_executor_reviewer_started: NO
real_prompt_budget: 6/12 cumulative local attempts
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

本轮完成了 bounded response diagnostics、一次有界修复请求的真实接线、请求身份保护和证据计数修正。真实 Provider 仍未给出可接受的 Requirement roundtrip：原始响应是合法 JSON 但不符合严格协议 schema，修复响应又是截断/不平衡 JSON。因此不能宣称 `PASS_CANDIDATE`，Gate 为 `FIX_REQUIRED`；按指令停止真实 Prompt，不进入 AUT-3。

## 2. Scope Resolution

### In scope

- 诊断真实 Requirement 响应：只保留长度、SHA256、候选数、JSON/schema 阶段、顶层类型/键和 bounded 错误分类。
- 将最多 3 次修复预算接入 Requirement WebGPT Adapter；本次单次请求最多发送一次 repair。
- repair 使用同一绑定 Chat，但使用新的 runtime requestId、idempotencyKey 和 semanticSha256。
- 保留原始业务 Request/Alignment identity；repair 不能伪造新一轮业务对话。
- 修正 packaged Official CLI Gate 的 setup/reuse、runtime 请求计数、恢复原 REQUIREMENT binding 和审查证据。
- 在真实 Project `workts`、同一个测试 Chat 上完成最后一次受控 Gate 尝试。

### Out of scope

- Planner、Executor、Reviewer、Scheduler、Workflow UI、AUT-3。
- V1 Frozen Core、Native Thread/Turn/Item、Runtime Registry 或 WebGPT V1 架构重构。
- Cookie/Token、私有 API、历史 Chat 扫描、Prompt/Response 全文归档。
- 盲目重试、替代 Chat、当前页面 fallback 或把 malformed 输出标成成功。

## 3. Architecture Boundary

```text
V1 Frozen Core
  └─ WebGPT V1 Runtime / Role Session / Request Manager
       └─ AUT-2 RequirementWebGptAdapter
            ├─ bounded response diagnostics
            ├─ bounded repair transport
            └─ RequirementAutomationService
```

本轮没有建立第二套 Conversation truth，也没有改变 Native identity、WebGPT 页面逻辑、Request Manager 的 no-resend 语义或 Role 路由规则。

## 4. Implementation

- `src/automation/requirement-webgpt-contract.ts`
  - 增加 bounded diagnostics 和 A-I 失败分类。
  - 记录 response 长度/SHA256、JSON 候选、括号平衡、解析阶段、schema 阶段、顶层键和截断推断；不保存 raw response。
  - 保持严格 schema、精确身份和 semantic 校验，失败仍 fail-closed。
- `src/automation/requirement-webgpt-adapter.ts`
  - 接入共享最多 3 次 repair budget。
  - 原始 response 失败且属于可修复 contract 错误时，在同一 Chat 发一次 bounded repair。
  - repair 使用实际 accepted runtime requestId 派生新的 idempotencyKey，并要求新的 runtime identity；不重发原业务请求。
  - 通过 diagnostics event 输出原始/修复请求的 bounded metadata，不输出正文。
- `src/automation/requirement-service.ts`
  - 在 Prompt 中明确 project/role/requestId/idempotencyKey/semanticSha256 回显约束。
  - semantic hash 使用稳定 placeholder 归一化，避免把 hash 自身引入循环。
- `src/automation/aut2-real-webgpt-gate.ts`、`scripts/aut2-real-webgpt-gate.ts`、`src/main/main.ts`
  - 支持复用稳定 setup Chat，避免最终尝试再次新建 Chat 或发送 setup Prompt。
  - 记录 runtime requestId/key/semantic、repair 事件和最终 parse source；修复 `chat latest` 正式 ABI 的计数判断。
  - Gate 结束始终恢复原 REQUIREMENT binding，并把 setup、业务、repair 计数分开。
- `tests/aut2-requirement-webgpt-contract.test.ts`、`tests/aut2-requirement-webgpt-adapter.test.ts`、`tests/aut2-requirement-service.test.ts`
  - 覆盖 diagnostics、schema failure、same-Chat repair、new identity、repair budget、malformed repair 和 Prompt identity。

## 5. Final Real Gate Evidence

证据文件：`docs/AUT-2-GATE-FIX-3-RUNTIME.json`。该文件不含 raw Prompt/response。

```yaml
official_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
gui_host: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
project: workts
setup: PASS_REAL_SETUP
final_setup_prompt_count: 0
final_setup_new_chat_count: 0
runtime: READY
control_owner: AUTO_CONTROL
login_required: false
original_requirement_binding_restored: true
final_real_prompt_count: 2
final_repair_count: 1
```

### Response contract result

```yaml
original_request_id: wgpt-20ccab78-11b4-4bda-826c-e03cfcb04c26
original_result_sha256: 286641baecaeb49dfdf842dc7f3cdb54dd82ab6970956805a26fba738e694121
original_json_parse: passed
original_schema: failed
original_category: F_SCHEMA_MISMATCH
original_candidate_count: 1
original_response_chars: 686
original_brace_balance: 0
repair_triggered: true
repair_request_id: wgpt-89dafd5b-97b8-4325-951e-f3748ade04ae
repair_idempotency_key: aut2:repair:wgpt-20ccab78-11b4-4bda-826c-e03cfcb04c26:1
repair_semantic_sha256: 98973113da78a4352d384a4d293784c87c861ae23b999fed958d0ec89d6a92d6
repair_result_sha256: e1ed83665932cb5c801204f998017d47fb6f7b1887e4fdd10a39ac735c2298a3
repair_json_parse: failed
repair_category: B_UNBALANCED_JSON
repair_response_chars: 580
repair_brace_balance: 3
repair_truncated_suspected: true
final_parse_result: FAIL
```

原始响应的顶层键集合为 `requirementProtocolVersion/projectId/role/requestId/idempotencyKey/semanticSha256/status/payload`；JSON 本身已通过解析，但严格 payload/schema 校验失败。修复请求确实发送到同一绑定 Chat，且 runtime requestId、idempotencyKey、semanticSha256 均为新的值；修复响应没有形成可解析候选，故未继续发送 answers、draft 或 confirmation Prompt。

## 6. Gate Matrix

| Gate | Result | Evidence |
|---|---|---|
| Packaged Runtime / login / AUTO_CONTROL | PASS_REAL | final runtime status and setup evidence |
| Stable setup Chat reuse | PASS_REAL_SETUP | 0 setup Prompt, 0 new Chat in final invocation |
| Exact REQUIREMENT binding | PASS_REAL | same target was opened and restored |
| Bounded diagnostics | PASS_AUTOMATED | diagnostics contract tests and runtime metadata |
| Bounded repair wiring | PASS_AUTOMATED + PASS_REAL_CONTROL_FLOW | one repair was triggered and recorded |
| New repair identity | PASS_REAL | runtime requestId/key/semantic differ from original |
| Requirement alignment roundtrip | FAIL | original `F_SCHEMA_MISMATCH`, repair `B_UNBALANCED_JSON` |
| Answers / Draft / canonical Requirement | NOT_REACHED | no valid envelope |
| USER confirmation | NOT_REACHED | no Draft |
| No blind resend / no replacement Chat | PASS | no extra business resend, original binding restored |

## 7. Prompt Budget

最终一次 Gate invocation 使用 2 条业务 Prompt（original + repair），没有 setup Prompt、没有新 Chat。整个本地 Gate Fix 3 尝试累计如下；均在同一 Project `workts` 范围内，未继续发送：

```yaml
hard_max_real_prompts: 12
target_max_real_prompts: 7
cumulative_real_prompts: 6
cumulative_breakdown:
  requirement_setup: 2
  alignment_original: 2
  alignment_repair: 2
  answers_to_draft: 0
  draft_repair: 0
  change_request: 0
  change_repair: 0
cumulative_repair_prompts: 2/3
cumulative_new_test_chats: 2/3
final_invocation_real_prompts: 2
final_invocation_setup_prompts: 0
final_invocation_new_chats: 0
```

## 8. Automated Verification

```yaml
npm_run_check: PASS
npm_test: PASS (280/280)
npm_run_build: PASS
npm_run_package_win: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS (warnings only for Git LF/CRLF normalization)
secret_scan: PASS (only synthetic-fixture-value in an existing egress-policy test)
```

`npm run build` 和 `npm run package:win` 在最终代码变更后已成功；标准产物在 `dist/package`。秘密扫描没有发现真实凭据；唯一命中是测试用的字符串 `Authorization: Bearer synthetic-fixture-value`，该夹具专门验证敏感内容被拒绝。

## 9. Provenance and Safety

- Implementation commit: `917c0609f91589c3f9f0456714c4ab8198fef830`。
- GUI outer EXE SHA256: `31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`。
- Official CLI EXE SHA256: `CAB4A529620720E820F2CE73E7C7EE9F03FAFFF739F5B4AEB07F1C1B0AD74D56`。
- Packaged `main/main.js` SHA256: `9A9E8177E79BC9F7A57742D2EA33CA44B8D4F6EE441A73A833C4D60D86658A4F`。
- Packaged `renderer/renderer.js` SHA256: `94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1`。
- Packaged `automation/aut2-real-webgpt-gate.js` SHA256: `B87F6A8BA513A7673128A9C7F722B73683B9B73E86F4496B27008123B59E61E1`。
- Packaged `package.json` SHA256: `1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F`。
- Review package SHA256 is recorded in the adjacent `.sha256` sidecar to avoid self-reference.
- No Cookie/Token/browser profile/private chat body was read or packaged. `promptBodyLogged=false`, `responseBodyLogged=false`, `cookiesRead=false`, `tokensRead=false`。
- V1 Frozen Core and WebGPT V1 product semantics were not modified.
- Existing controlled Request Manager result-file behavior was not expanded by this gate.

## 10. Subagents

本轮四个独立审计子代理均自然完成并在审核整合后关闭：

| Agent | Task | Result | Status |
|---|---|---|---|
| Kant | Root cause / parser audit | Identified prior `JSON_INVALID`; confirmed adapter repair wiring gap | completed, closed |
| Beauvoir | Control-flow / no-resend audit | Confirmed same-Chat repair identity and Request Manager safety | completed, closed |
| Lagrange | Real Gate harness / budget audit | Identified setup reuse/counting evidence issues | completed, closed |
| McClintock | Security boundary audit | Confirmed bounded evidence and no new raw credential egress | completed, closed |

`running_subagents_at_gate: 0`

## 11. Known Limitations / Deferred

- 真实 GPT 当前仍返回 schema mismatch，修复请求返回截断 JSON；因此完整 Requirement roundtrip 尚未完成。
- `RequirementAutomationService` 对 Adapter 的最终失败仍以 `MALFORMED_REQUIREMENT_RESPONSE` fail-closed；这不是成功结果。
- 没有获得有效 NEEDS_INPUT，所以 Draft、USER confirmation 和 Change Request 真实链路未执行。
- Attachment、多账号、多会话、Planner/Executor/Reviewer/Workflow 继续 deferred 或 NOT_STARTED。

## 12. Workspace Protection and Gate

- 用户本地 `dist-stage-a/`、`指导文档/*.docx`、其他未提交规划资料未被 add、修改、删除或重命名。
- 旧 donor `D:\办公\AI\Codex_Workbench` 只读，原有 dirty baseline 保留；`D:\办公\AI\Auto_Agent` 未修改。
- 既有无关 dirty/deleted 文件没有被 reset、clean、stash 或覆盖。

```yaml
gate: FIX_REQUIRED
safe_stop: YES
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
do_not_enter: AUT-3
```
