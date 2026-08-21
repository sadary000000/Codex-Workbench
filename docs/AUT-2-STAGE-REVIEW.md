# AUT-2 Gate Fix 4 Stage Review

## Executive Summary

stage: AUT-2 Gate Fix 4 — Transport / Semantic Contract Separation + Final Real Requirement Roundtrip
result: FIX_REQUIRED
base_commit: 80d57f6
prior_fix3_commit: 917c060
implementation_commit: UNCOMMITTED_WORKTREE
v1_core_changed: NO
webgpt_v1_changed: NO
planner_executor_reviewer_started: NO
aut3_started: NO

Fix 4 已完成 semantic-only response contract、trusted local envelope、bounded repair/dispatch accounting、首轮批量提问约束和对应自动化回归。自动化 Gate 通过，但真实 Gate 尚未闭环：第一次 Fix4 真实业务调用得到合法 READY_FOR_DRAFT，没有满足首轮 NEEDS_INPUT Gate；提示已修正后第二次 Gate 在复用稳定 Chat 阶段被 USER_CONTROL / recovery lease 阻塞，且没有发送新的业务 Prompt。

因此当前只能判定 FIX_REQUIRED，不得进入 AUT-3。

## Scope

In scope:
- 对齐 Prompt、Parser、Validator、Tests、Docs 和真实响应字段。
- 模型只返回 semantic response；transport/domain identity 由本地可信层生成。
- NEEDS_INPUT、READY_FOR_DRAFT、BLOCKED discriminated union。
- 同 Chat 的 bounded repair，单次 Gate 最多一次 repair。
- 真实业务 Prompt 累计硬上限、repair 上限、setup/new-chat 上限和 dispatch 前预留。
- 首轮至少三条独立问题的 Requirement alignment Gate。
- 使用打包 CLI/GUI host 做受控真实 Gate；不创建新 Chat、不发送多余 Prompt。

Out of scope:
- AUT-3 Planner/Structured Workflow、Executor、Reviewer、Scheduler。
- V1 Native Thread/Turn/Item、Runtime Registry、WebGPT V1 页面/Completion/Request Manager 重构。
- Cookie、Token、私有 API、原始 Prompt/Response、完整聊天正文归档。

## Architecture Boundary

V1 Frozen Core
  └─ WebGPT V1 Runtime / Role Session / Request Manager
       └─ AUT-2 RequirementWebGptAdapter
            ├─ semantic response contract
            ├─ trusted local envelope
            ├─ bounded repair transport
            └─ RequirementAutomationService

本轮未修改 src/features/webgpt/** 的产品语义；src/main/main.ts 仅承担 AUT-2 AutomationStore/Gate 组合接线和 bounded setup context 传递。未建立第二套 Conversation/Transcript truth，未替换 Native identity。

## Implementation

- requirement-webgpt-contract.ts：共享模型指令、semantic response union、严格 validator、本地 trusted envelope；模型不得提供 transport/domain identity。
- requirement-service.ts：semantic-only Prompt；初始无答案轮次强制 NEEDS_INPUT，至少三条独立问题覆盖 synthetic 缺口；ID 均由本地生成。
- requirement-webgpt-adapter.ts：dispatch 前预算预留；同 Chat bounded repair；预留拒绝时回滚 repair 计数；不盲目重发业务请求。
- aut2-real-webgpt-gate.ts：单次最多 3 个业务 Prompt/1 个 repair；只接受经过校验的剩余累计预算；记录 dispatched accounting。
- main.ts：传递并校验 setup context 的剩余 Prompt/repair 预算，缺失或越界时 fail-closed。
- scripts/aut2-real-webgpt-gate.ts：读取累计账本并记录 Fix4 bounded evidence。
- Tests/docs：新增首轮 NEEDS_INPUT 提示回归、repair 预留回滚回归、contract drift audit 和 Fix4 report。

## Contract Drift Audit

详见 D:\办公\AI\Codex_Workbench_V1\docs\AUT-2-REQUIREMENT-CONTRACT-DRIFT-AUDIT.md。Fix4 已将模型 semantic payload 与本地 trusted transport/domain identity 分离，Prompt/Validator/Tests 使用同一共享 schema instruction。剩余失败属于真实首轮语义 Gate 和运行控制恢复，不是继续用 repair 掩盖内部 contract drift。

## Real Gate Evidence

当前正式证据：D:\办公\AI\Codex_Workbench_V1\docs\AUT-2-GATE-FIX-4-RUNTIME.json。

latest_result: BLOCKED
project: workts
setup_prompt_count: 0
new_chat_count: 0
new_business_prompts_dispatched: 0
new_repair_prompts_dispatched: 0
login_required: false

阻塞链路：稳定 Chat 的 chat latest 返回 USER_CONTROL；随后显式 control auto 因已有 recovery lease 返回 TIMEOUT/WORKBENCH_START_TIMEOUT。累计 setup/new-chat 预算已耗尽，所以脚本没有创建替代 Chat、没有发送 setup Prompt、没有发送业务 Prompt。直接 CLI status 随后显示 AUTO_CONTROL，但仍观测到 active RECOVERY lease，不能据此宣称稳定 Chat 已恢复。

在本次阻塞之前的第一轮 Fix4 真实业务调用中，模型返回的顶层结构已经收敛到 semantic-only 三键，解析/schema/semantic 校验通过，但状态为 READY_FOR_DRAFT；由于首轮没有 NEEDS_INPUT 问题，触发 BATCH_ALIGNMENT_NOT_NEEDS_INPUT。该结果促成了当前首轮提示修复，但不构成完整真实 roundtrip 证据。

## Gate Matrix

Gate | Result | Evidence
Contract drift audit | PASS_AUTOMATED | audit + shared contract/tests
Transport/semantic separation | PASS_AUTOMATED | semantic parser + trusted local envelope
Local trusted identity | PASS_AUTOMATED | spoof/mixed payload rejection tests
Single canonical response schema | PASS_AUTOMATED | contract tests and shared prompt instructions
Prompt/validator alignment | PASS_AUTOMATED | check + 284 tests
Packaged runtime | PASS_REAL_SETUP_PARTIAL | runtime reached READY; second reuse was blocked
Exact REQUIREMENT binding | PASS_REAL_SETUP_PARTIAL | original binding restored on setup failure
Real batch alignment | FAIL / NOT_COMPLETED | first attempt READY_FOR_DRAFT; no valid NEEDS_INPUT round
Answers -> Draft | NOT_REACHED | no valid first round
Canonical Requirement / payload hash | NOT_REACHED_REAL | automated path only
Explicit USER confirmation | NOT_REACHED_REAL | no Draft in blocked run
No blind resend / replacement Chat | PASS | latest blocked run dispatched 0 new Prompt
V1/WebGPT frozen semantics | PASS | no src/features/webgpt/** product semantic changes
AUT-3 | NOT_STARTED | blocked by AUT-2

## Budget Evidence

来源：D:\办公\AI\Codex_Workbench_V1\docs\AUT-2-REAL-PROMPT-BUDGET.json。

hard_max_real_prompts: 12
cumulative_local_real_prompts: 7
cumulative_repair_prompts: 2/3
cumulative_setup_prompts: 2/2
cumulative_new_test_chats: 2/3
latest_gate_new_business_prompts: 0
latest_gate_new_repair_prompts: 0

没有因为稳定 Chat 复用失败而消耗第 8 条 Prompt；这符合本阶段的 fail-closed 预算规则。

## Automated Verification

npm_run_check: PASS
npm_test: PASS (284/284)
npm_run_build: PASS
npm_run_package_win: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS (LF/CRLF normalization warnings only)
secret_scan: PASS (only documented synthetic fixture match)

打包产物：
- D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
- D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe

## Provenance and Safety

- Base HEAD: 80d57f6；prior Fix3 implementation: 917c060。
- Fix4 implementation is currently uncommitted in the intentionally dirty worktree；没有生成新的 implementation commit。
- GUI outer EXE SHA256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC。
- Official CLI EXE SHA256: 00F4063CA268F884AAB6B4C49BEDCEAA254388AE9410C39AFC25377CC8174EB2。
- Packaged main.js SHA256: 5111A11C657BE336836A5ADCFA3ADBCB68FE3AF513F2B25CBE9A476971746EEF。
- Packaged renderer.js SHA256: 94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1。
- Packaged aut2-real-webgpt-gate.js SHA256: 001BA39FE9EC590F22C282D40879478330D3B7751B56EB76D5F312C8CB2EBEEA。
- Packaged package.json SHA256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F。
- 未读取/打包 Cookie、Token、Browser profile 或聊天正文；evidence 仅包含 bounded metadata/hash/状态。

## Subagents

Agent | Task | Result | Final status
Aristotle | Contract drift / identity audit | 指出 budget passthrough、repair dispatch accounting 和 real evidence 缺口 | completed, reviewed, closed/not_found after shutdown
Pasteur | Real Gate / budget audit | 指出累计预算与 setup reuse 的安全边界 | completed, reviewed, closed
Linnaeus | Regression / scope audit | 确认首轮 Gate 失败、AUT-3 未启动、V1/WebGPT 边界 | completed, reviewed, closed

running_subagents_at_gate: 0

## Known Limitations / Deferred

- 尚未取得真实 NEEDS_INPUT -> answers -> READY_FOR_DRAFT -> USER confirmation 完整证据。
- 当前 RECOVERY lease / USER_CONTROL 恢复问题阻塞 stable Chat reattach；不得通过新 Chat 或额外 Prompt 绕过。
- gpt_self_confirmation 仍 BLOCKED/未请求。
- Change Request 仅保留 automated evidence；Planner/Executor/Reviewer/Workflow 未启动。
- Attachment、多账号、多会话继续 deferred。

## Workspace Protection and Gate

- D:\办公\AI\Codex_Workbench 旧 donor 只读，未修改。
- D:\办公\AI\Auto_Agent 未修改。
- dist-stage-a/、指导文档/*.docx、用户本地规划资料未被本轮 add/修改/删除/重命名。
- 既有 dirty/deleted baseline 未 reset、clean、stash 或 checkout。

gate: FIX_REQUIRED
safe_stop: YES
do_not_enter: AUT-3
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
