# Codex Workbench V1 总体验收与 Release Candidate Freeze

日期：2026-08-18

状态：`V1 RC / Awaiting User Manual Acceptance`
GPT RC Gate：`PASS`

本报告遵循 GPT 的 Phase 6 PASS 后唯一指令：只做 Phase 0–6 集成验收、边界审计、真实 CLI smoke、文档和人工验收入口，不进入 Phase 7，不新增产品功能。

## 1. 冻结结论

- Phase 0–6：已有 GPT PASS 证据；Phase 6 Gate Fix 已获 GPT `PASS`，正式冻结。
- V1 自动化集成 Gate：本轮通过；真实 GUI 人工验收尚未执行，不在此报告中伪造 PASS。
- 当前发布状态：`V1 RC / Awaiting User Manual Acceptance`。
- Phase 7：`NOT_STARTED`。只有用户真实使用后出现并确认的新缺口，才重新开启范围审查。

## 2. 冻结的架构与产品不变量

`Codex App Server → Native Thread → Native Turn → Native Item` 是 V1 Runtime 主链；`nativeThreadId` 是唯一运行身份。Workbench 只保存最小的 Project/ThreadProjection/recovery 状态并提供薄适配和 UI 投影。Conversation Map / Project Map 是 sidecar 增强，不复制完整 Conversation、Transcript、Context、Agent、Reasoning 或 Tool truth。

旧 `D:\办公\AI\Codex_Workbench` 只读 donor 保持在其既有 dirty baseline；本轮未对其执行修改、reset、clean、stash、checkout、commit 或格式化。

## 3. 阶段状态

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| Phase 0 | PASS | `docs/PHASE-01-NATIVE-THREAD-FOUNDATION.md` 与阶段提交 |
| Phase 1 | PASS | Native Runtime 真实链路与 smoke |
| Phase 2 | PASS | `docs/PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md` |
| Phase 3 | PASS | `docs/PHASE-03-CODEX-SHAPED-LEFT-NAVIGATION.md`、Navigation smoke |
| Phase 4 | PASS | `docs/PHASE-04-CODEX-THREAD-WORKSPACE.md`、Workspace smoke |
| Phase 5 | PASS | `docs/PHASE-05-LEGACY-CAPABILITY-SCREENING.md` |
| Phase 6 | PASS | `docs/PHASE-06-GATE-FIX-REPORT.md`、GPT Gate PASS |
| V1 RC Freeze | 自动化通过/人工待验收 | 本报告与 `docs/V1-MANUAL-ACCEPTANCE-CHECKLIST.md` |

## 4. 本轮机器验证

- `npm run check`：PASS；
- `npm test`：51/51 PASS；
- `npm run build`：PASS；
- `npm audit --omit=dev`：PASS，0 vulnerabilities；
- `git diff --check`：PASS；
- 高风险凭据模式扫描：无命中。

## 5. Runtime / Navigation / Workspace 真实 smoke

- Runtime normal：`npm run test:real` PASS；Thread `01a01099-9a88-7132-8865-27b632ded685`，Turn `01a01099-9b1a-73b1-82e4-3282d9dc48ac`，收到 `NATIVE_THREAD_SMOKE_OK`，精确 `thread/delete` 成功；临时状态目录由脚本清理。
- Navigation：`npm run test:real:navigation` PASS；Project Threads `01a01099-971e-7e43-8cfc-6313c2cdee06`、`01a01099-b4cc-7200-a466-94ff3aebe7ba`，Standalone `01a01099-d5c0-7df2-a486-ab717afdafbd`，restart 后身份一致；脚本精确删除全部测试 Thread。
- Workspace：`npm run test:real:workspace` PASS；Thread `01a01099-9bb2-7b91-abe9-12e0d6517d2e`，interrupted Turn `01a01099-9c4f-7a42-8cb5-9b8bc5352f23`，continued Turn `01a01099-9f34-7103-a525-8859209ae661`，restart 后身份一致；脚本精确删除测试 Thread。

Navigation 曾有一次外部 websocket/TLS stream disconnected 导致超时，stderr 指向远程服务连接；随后在相同代码下重跑通过，不作为产品 blocker。

## 6. Map 真实 smoke

- New Conversation Map：`npm run test:real:map` PASS；Thread `01a010a3-0926-7493-8e1e-75f0dd5a8d90`，工具调用 1 次，revision `0→1`，节点数 2，ephemeral 自动清理。
- Resumed Map：`npm run test:real:resumed-map` PASS；Thread `01a010a1-24d8-7912-aca9-1ff114d3afe2`，baseline/resumed Turn 均真实完成，`sameTurn=compatibility_fallback`，重启后 Map revision `0→1`、fallback tool call `1`、cursor/sourceCursor 前进，`thread_deleted`。
- Project Map：`npm run test:real:project-map` PASS；Project `project-real-map`，Conversation sources `01a010a4-a06e-7d82-9923-37f1f96985c2`、`01a010a4-a136-7ed3-8d04-949e72aee420`，maintenance `01a010a4-c9f4-7d12-af39-91ca4e2cf9c7`，restart 前后 revision `2→3`，context request 1 次，maintenance 排除普通导航，三条 Thread 均 `thread_deleted`。
- Context request：`npm run test:real:context` PASS；真实 dynamic tool 注册/调用/返回，响应 340 bytes，ephemeral 自动清理。
- Pause/Resume：`npm run test:real:map-pause` PASS；暂停期间 dirty，恢复后 cursor-only 增量，revision `1`，`full_rebuild_count=0`，ephemeral 自动清理。

## 7. Known Limitations 分类

- Resumed Thread 使用 bounded compatibility maintenance call，而非原生 resumed `dynamicTools`：已由协议证据和真实 smoke 覆盖，记录为非阻塞兼容限制。
- `workbench_map_context_request` 是 Workbench 自定义 bounded dynamic tool，不宣称为 Codex 原生协议：非阻塞，边界已验证。
- Map Patch 若由模型生成错误的 operation key 会被 fail-closed 拒绝；本轮一次真实 smoke 捕获了 `type:"add"` 误形，随后强化 dynamic-tool schema/developer hint，最新 smoke 使用 `op:"add"` 通过。该行为不改变 Native 主链，也不把错误包装成成功。
- ephemeral Thread 的 `thread/delete` 可能被协议拒绝：脚本将其分类为 `ephemeral_auto_cleanup`，不保留持久状态；非阻塞。
- GUI 人工验收尚未完成：在用户完成清单前，不能宣称最终发布 PASS；这是 RC 的待验收项，不是已知代码故障。

## 8. 子代理与清理

本阶段四个只读审计子代理均已自然完成；主 Agent 审核结果后关闭，最终 `running_subagents_at_gate=0`。本轮不创建 Codex Desktop/GPT 测试对话；所有真实 smoke 使用 ephemeral 或精确 Native Thread 清理。Navigation/Workspace/resumed smoke 的清理逻辑已补齐，避免异常路径留下持久测试 Thread。

## 9. Gate 建议

当前建议：`V1 RC / Awaiting User Manual Acceptance`。

用户完成 [V1-MANUAL-ACCEPTANCE-CHECKLIST.md](V1-MANUAL-ACCEPTANCE-CHECKLIST.md) 后，再根据真实结果判断是否达到最终发布状态。没有经过用户实际使用，不自动进入 Phase 7，也不把 UI 人工验收标成 PASS。

[CODEX_WORKBENCH_V1_ACCEPTANCE_REVIEW]
status: gpt_rc_gate_pass_awaiting_user_manual
commits: phase6_fix=5c1fed7; phase6_evidence=4e8c42e; rc_commit=48c5862
phase_status: phase0=PASS; phase1=PASS; phase2=PASS; phase3=PASS; phase4=PASS; phase5=PASS; phase6=PASS
runtime_integration: PASS
navigation_integration: PASS
workspace_integration: PASS
map_integration: PASS
native_truth_audit: PASS
tests: check PASS; 51/51 PASS; build PASS; audit 0 vulnerabilities; diff-check PASS; secret-scan PASS
real_smokes: runtime/navigation/workspace/conversation-map/resumed-map/pause-resume/project-map/context all PASS; exact cleanup recorded
manual_acceptance_checklist: docs/V1-MANUAL-ACCEPTANCE-CHECKLIST.md
integrated_acceptance_report: docs/V1-INTEGRATED-ACCEPTANCE.md
conversation_map_update: Phase 6 ●; V1 RC ◉; Phase 7 ○ NOT_STARTED
known_limitations: documented non-blocking compatibility/custom-tool/ephemeral limitations; GUI manual acceptance pending
release_blockers: user manual GUI acceptance pending; no automated release-blocking bug found
subagents: four read-only audits completed, reviewed, and closed after natural completion
running_subagents_at_gate: 0
legacy_project_status: old donor unchanged with pre-existing intentional dirty baseline
phase7_status: NOT_STARTED
gate_recommendation: V1 RC / Awaiting User Manual Acceptance
gpt_rc_gate: PASS
