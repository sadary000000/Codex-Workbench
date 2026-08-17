# Phase 5 — Legacy Capability Screening

日期：2026-08-17
项目：Codex Workbench V1
工作目录：`D:\办公\AI\Codex_Workbench_V1`
旧 donor：`D:\办公\AI\Codex_Workbench`（只读）
状态：审计、分类和命令行 Gate 已完成，等待 GPT 阶段审查

## 1. 阶段结论

Phase 5 的目标是筛选旧 Workbench 中真正值得进入 V1 的能力，而不是恢复旧产品架构。四项只读审计和主 Agent 交叉复核后，结论为：

> V1 Native Thread 主链保持不变；旧 donor 没有当前必须直接迁移的独立能力；实际代码迁移为 0 项。

这不是漏做迁移。旧 donor 的大多数“能力”属于同一套 Conversation → Transcript → Task/Exec → Workflow/Review/Context/Renderer 产品事实链；剩余安全、诊断和 lifecycle 能力要么 V1 已有基础实现，要么必须按 Native Thread 语义重新设计，不能直接复制旧文件。

## 2. 审计范围与证据

| 审计 | 主要结论 | 主要来源 |
| --- | --- | --- |
| Runtime Donor Audit | V1 App Server/Native Thread/Turn/Item、identity、persistence、recovery 主链应 KEEP；旧 session/adapter/runner 不替换；reconnect/reconcile、lifecycle cleanup、dedupe 等为后置 REWORK | `src/codex/app-server-client.ts`、`src/codex/native-thread-runtime.ts`、`src/codex/app-server-session.ts`、Phase 1–4 报告 |
| Security / IPC / Path Audit | V1 窄 IPC、Native identity、approval、原子 persistence 基础成立；cwd canonicalization、sender/sandbox、严格 reject、总量 bounds、redaction 仍有缺口 | `src/main/main.ts`、`src/preload/preload.cts`、`src/shared/persistence-store.ts`、旧 `src/project/project-workspace.cjs` |
| Diagnostics / Git Safety Audit | 旧 logger、support bundle、Git safety 有成熟边界但绑定旧产品；V1 当前没有对应产品入口；按 Native 模型后置 REWORK/REFERENCE | 旧 `src/main/runtime-logger.cjs`、`support-bundle.cjs`、`src/project/workspace-change-set.ts`、V1 logger/error/runtime |
| Legacy Contamination Audit | Conversation、Transcript、Task、Exec、Workflow、Review、Prompt、Project Context、复杂 Renderer、Multi-Agent 都是旧产品 truth，不得进入 V1 | 旧 `src/main/main.cjs`、`src/shared/*conversation*`、`src/workflow/*`、`src/review/*`、`src/renderer/app.js` |

详细逐项矩阵见：[PHASE-05-LEGACY-CAPABILITY-MATRIX.md](D:\办公\AI\Codex_Workbench_V1\docs\PHASE-05-LEGACY-CAPABILITY-MATRIX.md)。

## 3. 分类收口

### KEEP

V1 继续保留：

- App Server JSON-RPC client、Native Thread runtime、Native Turn/Item read model；
- Native identity、Thread binding、persistence relation、atomic save、Prompt Recovery、process-exit fail-closed recovery；
- Native approval broker、固定 Main/Preload IPC channel 和当前 fail-closed 边界；
- bounded native event normalization、bounded stderr/error information、Codex 子进程环境规范化；
- Codex-shaped navigation 和 Thread Workspace projection。

### REUSE

本阶段确认的即时 `REUSE` 项：**0 项**。

旧 donor 的 prompt-template parser、logger、path checker、Git safety 等均不能在当前范围内直接搬入：前者没有当前 V1 需求，后几者需要去除旧产品字段并按 V1 语义重写。

### REWORK

只记录后置候选，不在本阶段实现：

- Native reconnect/reconcile、lifecycle/no-orphan、端到端 timeout cleanup、interrupt 终态确认、event cursor/dedupe、capability preflight；
- cwd/project path canonicalization、realpath/目录/权限/越界拒绝；
- IPC sender 校验、严格 payload schema、输入总量 bounds、Electron sandbox/navigation/CSP；
- secret-safe structured logging、error/path redaction、rotation、Native-only diagnostics/support bundle。

### REFERENCE

旧 App Server session/capability/lifecycle 设计、logger/support/Git safety 测试边界、纯 prompt-template 算法只作为未来设计和测试参考。

### LEGACY / REMOVE / DO NOT MIGRATE

旧 Conversation、Transcript、Task/TaskController、Exec runner/gateway、Workflow、Review/Shadow、Prompt optimizer/history、Project Context、复杂 Renderer、Multi-Agent、Git Keep/Revert 和旧 Context Trace 均不迁入 V1。`REMOVE` 是迁移计划中的排除，不是删除旧 donor。

## 4. 实际迁移与 Native truth 审计

| 项目 | 结果 |
| --- | --- |
| actual_migrations | `0` |
| V1 product code changed | `0` |
| old donor files changed by this phase | `0` |
| legacy imports added to V1 | `0` |
| legacy persistence schema added | `0` |
| old IPC namespace added | `0` |
| old Git/Workflow/Review/Multi-Agent main path added | `0` |
| legacy dependencies removed | `0`（没有引入 donor 依赖） |
| Native Thread identity preserved | 是 |
| Native Turn/Item identity preserved | 是 |
| localRunId role | 仅本地 Prompt Recovery 关联，不是 Task/Conversation identity |
| second Conversation/Transcript/Task truth | 未添加 |
| fabricated continuation/history | 未添加；不拼接历史 Prompt 伪造上下文 |

## 5. 子代理生命周期与采用记录

四个子代理均按“派发 → 等待真正返回 → 主 Agent 审阅 → 采用结论 → 关闭”完成；没有在未返回结果时关闭。

| agent | task | adopted result | validation | final_status | closed_after_result |
| --- | --- | --- | --- | --- | --- |
| Planck (`01a00fc6-b682-78a0-912f-315808fd3013`) | Runtime Donor Audit | V1 runtime KEEP；lifecycle/reconnect 等后置 REWORK；migration 0 | 只读源码/报告核对，无文件修改 | completed | true |
| Nietzsche (`01a00fc6-b71c-7f50-a075-38989bca89b5`) | Security / IPC / Path Audit | V1 安全基础 KEEP；path/IPC/logger hardening 后置 REWORK | 只读源码与 path probe，无构建 | completed | true |
| Kepler (`01a00fc6-b7ee-7000-bccf-99705f7bc18d`) | Diagnostics / Git Safety Audit | logger/support 后置 REWORK；Git REFERENCE；migration 0 | 只读两仓库核心路径与历史测试 | completed | true |
| Archimedes (`01a00fc6-b8c8-7393-a4fe-863c826b34ca`) | Legacy Contamination Audit | 旧产品 truth 全部 LEGACY/REMOVE；纯算法仅 REFERENCE | 只读依赖/源码/文档审查 | completed | true |

Gate 状态：`running_subagents_at_gate: 0`。

## 6. 命令行验证

本阶段只有文档和分类矩阵变更，没有 Runtime code migration，因此没有重新启动真实 App Server smoke；Phase 1–4 的真实 smoke 继续作为来源工程证据，不冒充 Phase 5 新运行结果。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | PASS（TypeScript source/tests no-emit） |
| `npm test` | PASS，32/32 |
| `npm run build` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS；仅有 Windows LF→CRLF 提示，无 whitespace error |
| secret scan | PASS；未发现高风险 token/private-key 模式 |
| real App Server smoke | 未重跑；无 Runtime 代码改变，按本阶段 docs-only 边界不要求 |

## 7. Conversation Map 与 Git 保护

- `docs/WORKBENCH-V1-CONVERSATION-MAP.md` 已更新：Conversation Map 初始化为 `●`，Phase 5 为 `●`，Phase 6 保持 `○`；追加四个 Phase 5 子代理记录和当前 Gate 请求。
- 旧 donor `D:\办公\AI\Codex_Workbench` 保持原有 dirty baseline：`b459adb`，既有 adapter/runner/process-environment/document/test 修改未触碰。
- V1 工作树只包含本阶段文档变更；没有 reset、clean、checkout、stash、覆盖或删除用户数据。
- 推荐 docs-only commit message：`docs: complete legacy capability screening`。

## 8. 范围边界与已知限制

本阶段明确没有实现：Phase 6 Map Schema/Prompt/Patch Protocol/右侧 Panel/Conversation Map Runtime/Project Map Thread；也没有复活 Workflow、Review、Task Manager、Multi-Agent、Exec、Git Workbench、旧 Context/Transcript/Conversation。

已知限制是：审计发现的 path/IPC/logger/diagnostics/reconnect hardening 候选尚未实现。这些候选必须在后续独立阶段中明确需求、重新设计、补测试并接受 Gate，不能因旧 donor 已有实现就直接复制。

## 9. 阶段审查请求

```text
[CODEX_WORKBENCH_STAGE_REVIEW]
stage: Phase 5 — Legacy Capability Screening
commit: docs-only commit containing this report; final hash is recorded in the stage review
inventory_summary: four read-only audits complete; detailed matrix in PHASE-05-LEGACY-CAPABILITY-MATRIX.md
classification_summary: KEEP V1 native baseline; REUSE 0; REWORK deferred hardening; REFERENCE historical utilities; LEGACY/REMOVE old product truth
KEEP: V1 App Server/JSON-RPC, Native Thread runtime, identity/persistence/recovery, approval, fixed IPC, event bounds, process environment
REUSE: 0 immediate items
REWORK: native lifecycle/reconnect; path canonicalization; IPC strictness/sandbox; secret-safe logging/diagnostics; support bundle
REFERENCE: old session/capability/lifecycle/logger/support/Git safety boundaries; pure prompt-template algorithm
LEGACY: old adapters/Exec/Task/Workflow/Review/Prompt/Context/Renderer systems
REMOVE_DO_NOT_MIGRATE: Conversation/Transcript/Context Trace truth, runtime gateway, old IPC, Git Keep/Revert, Multi-Agent main path
actual_migrations: 0
v1_existing_capabilities_preserved: Native Thread/Turn/Item, App Server runtime, persistence/recovery, approval, IPC, renderer projection
legacy_dependencies_removed: 0; no donor dependency introduced
native_truth_audit: no second Conversation/Transcript/Task/Agent/Context truth; no fabricated continuation
tests: npm run check PASS; npm test 32/32 PASS; npm run build PASS; npm audit --omit=dev 0 vulnerabilities; diff/secret scan PASS
real_appserver_smoke: not rerun because no Runtime code migrated or changed in this docs-only stage
conversation_map_update: Map initialization ●; Phase 5 ●; Phase 6 ○
subagents:
  - Planck: completed, adopted, closed after result
  - Nietzsche: completed, adopted, closed after result
  - Kepler: completed, adopted, closed after result
  - Archimedes: completed, adopted, closed after result
running_subagents_at_gate: 0
legacy_project_status: old donor unchanged with pre-existing intentional dirty baseline
scope_boundary: no Phase 6 implementation and no old product-system resurrection
known_limitations: hardening candidates recorded but not implemented
blockers: none
gate: pending GPT review
```

请审查本阶段的 Legacy inventory、分类矩阵、0 项迁移决策、Native truth 边界和子代理生命周期。若 PASS，请给出 Phase 6 唯一执行指令；若 FIX/REDESIGN，请列出必须修改项。审查通过前不进入 Phase 6。
