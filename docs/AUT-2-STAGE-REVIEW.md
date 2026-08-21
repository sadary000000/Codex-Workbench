# AUT-2 Stage Review — Real WebGPT Gate Fix

## 1. Executive Summary

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
result: FIX_REQUIRED
base_commit: c20c282
implementation_commit: fe2bf56
v1_core_changed: NO
webgpt_v1_changed: NO
real_webgpt_runtime: PASS_REAL_PRECHECK_ONLY
real_requirement_roundtrip: FAIL
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

AUT-2 的 Requirement Domain、批量问题合同、Canonical Requirement、显式 USER Confirmation、Change Request/Impact/Diff、Data Egress/Trust 和 Persistence 已有 `PASS_AUTOMATED` 证据，原有自动化基线为 276/276。此次 Gate Fix 修正了 packaged runtime 的 Official CLI 编排，并完成了真实运行时预检，但真实 Requirement 网页闭环仍未通过，不能宣称 `PASS_CANDIDATE`。

## 2. Scope Resolution

本轮只做：

- `Codex Workbench CLI.exe` 作为唯一外部 CLI 探针；
- 正常启动 packaged `Codex Workbench V1.exe` 作为 GUI/Browser Host；
- Requirement Role 真实网页 Gate 的受预算取证；
- Evidence grading、Prompt budget、Provenance 和审查 ZIP。

本轮不做：

- V1 Frozen Core、Native Thread/Turn/Item、Runtime Registry、WebGPT V1 语义修改；
- Automation、Planner、Reviewer、Native Executor、Scheduler、Workflow UI；
- Cookie/Token/私有接口/历史 Chat 扫描；
- 通过当前页面 fallback、替代 Chat 或盲目重发绕过目标保护。

## 3. Architecture Boundary

```text
Automation Requirement Service
  → RequirementWebGptAdapter
  → existing WebGPT Role Session / Request Manager
  → exact REQUIREMENT Role Chat
  → bounded response parser
  → Requirement Domain
```

Automation 内部没有 spawn Official CLI；Official CLI 只用于外部 status/control/role/close 探针。GUI EXE 没有作为 public CLI 使用。

## 4. Real Runtime Evidence

使用：

```yaml
gui_host: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
official_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
project: 371c3fb8-30ac-4943-9584-1915045ea34d
role: REQUIREMENT
chat: https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc
loginRequired: false
autoControl: true
roleOpen: PASS_REAL
targetUrlConfirmed: true
composerFound: true
```

预检页面没有可见对话条目（User=0、Assistant=0）。两次 Requirement Service 真实尝试均在网页提交前被目标保护拒绝，`submittedAt=null`，所以：

```yaml
realPromptCount: 0/12
attemptedRealRequests: 2
newTestChatCount: 1/3
repairPromptCount: 0/3
wrongChatPromptCount: 0
duplicatePromptCount: 0
```

详细 request/idempotency/semantic hash 见 `AUT-2-REAL-WEBGPT-EVIDENCE.json` 和 `AUT-2-REAL-PROMPT-BUDGET.json`。证据中没有保存 Prompt/Response 全文。

## 5. Gate Matrix

| Gate | Result |
|---|---|
| Requirement Domain | PASS_AUTOMATED |
| Batch Question Contract | PASS_AUTOMATED |
| Canonical Requirement / payloadSha256 | PASS_AUTOMATED |
| Explicit USER Confirmation | PASS_AUTOMATED |
| Change Request / Impact / Diff | PASS_AUTOMATED |
| Data Egress / Trust Boundary | PASS_AUTOMATED |
| Prompt Injection Boundary | PASS_AUTOMATED |
| Official CLI external probe | PASS |
| GUI EXE used as public CLI | NO |
| Runtime login / AUTO_CONTROL / Role Open precheck | PASS_REAL |
| Real batch alignment / NEEDS_INPUT | FAIL / NOT_REACHED |
| Real answers-to-draft | NOT_REACHED |
| Real canonical draft | NOT_REACHED |
| Real USER confirmation | NOT_REACHED |
| Request idempotency | PASS_AUTOMATED; no resend observed in real attempts |
| V1 Core changed | NO |
| WebGPT V1 changed | NO |

## 6. Root Cause / Blocker

现有 binding 的 URL 可以导航确认，但页面是空 Chat；`role new --replace` 的无 Prompt 探针只返回 `PENDING_CHAT_URL` 并回到首页，无法得到稳定的 Chat URL。Adapter 要求 `BOUND + exact chatRef`，Request Manager 在提交前发现页面目标无法再次确认后 fail-closed。后续恢复检查也没有发现已物化对话身份。

这不是 timeout、不是错误 Chat 发送、不是 Prompt 丢失，也不是自动替换 Chat。强行绕过该保护或发送角色初始化 Prompt 会违反本轮 `MAX_ROLE_SETUP_PROMPTS=0` 与 no-fallback 约束。

## 7. Automated Verification

本次 Gate Fix 最终验证：

```yaml
npm run check: PASS
npm test: PASS
tests: 276/276
npm run build: PASS
npm run package:win: PASS
npm audit --omit=dev: 0 vulnerabilities
git diff --check: PASS
secret scan: PASS
```

验证结果已写入 `dist/review/AUT-2-TEST-SUMMARY.json`；真实 Requirement Gate 仍为 FAIL，不能由自动化测试替代。

## 8. Binding / Safety

- 原 REQUIREMENT Project/Role/Chat URL 已恢复，`originalChatRef == finalChatRef`。
- PLANNER、REVIEWER 未修改。
- 一次新 Role Chat 只用于无 Prompt 的物化能力探针，返回 PENDING 后已恢复，不作为成功 Chat。
- 没有删除磁盘文件、没有修改旧 donor、没有修改 Auto_Agent。
- `planner_started=NO`、`native_execution_started=NO`、`reviewer_started=NO`。

## 9. Deferred / Required Follow-up

真实 Gate 需要一个已物化、可稳定读取 URL 的 REQUIREMENT Chat。若必须先发送一次初始化消息，应由用户单独授权并计入预算；本轮不自行发送。取得该前置条件后，再从 Gate A 重新执行，不能把本轮 `PASS_REAL_PRECHECK_ONLY` 提升为 Real Roundtrip PASS。

## 10. Review Package

```text
docs/AUT-2-REAL-WEBGPT-EVIDENCE.md
docs/AUT-2-REAL-WEBGPT-EVIDENCE.json
docs/AUT-2-REAL-PROMPT-BUDGET.json
docs/AUT-2-PROVENANCE.txt
docs/AUT-2-STAGE-REVIEW.md
```

最终 ZIP 路径：`D:\办公\AI\Codex_Workbench_V1\dist\review\AUT-2-STAGE-REVIEW-PACKAGE.zip`。
ZIP SHA256 通过同目录的 `AUT-2-STAGE-REVIEW-PACKAGE.sha256` sidecar 提供；避免把归档自身 hash 写入归档造成自引用。

## 10.1 Package Provenance Inputs

```yaml
gui_outer_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
official_cli_sha256: DB558C0CE95E8539C62441EA4F1AF2575D42A4AEB194A07B9EECF9B38AEEE0A5
app_main_sha256: 1848BBD792E5300E5ADC5BC0A04DF2D96DDF3B1FE177E5C2DAB2DA03B33A454C
app_renderer_sha256: 94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1
automation_gate_module_sha256: 5ECDDD373C5E7B00C6E93220D3EBCA0EB07C8B75F6189D856673D726DB0204F4
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```

## 11. Gate

```yaml
gate: FIX_REQUIRED
real_webgpt_requirement_roundtrip: FAIL
safe_stop: YES
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```
