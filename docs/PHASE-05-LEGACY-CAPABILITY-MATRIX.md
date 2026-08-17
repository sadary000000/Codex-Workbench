# Phase 5 — Legacy Capability Screening / Donor Selection

日期：2026-08-17
阶段：Phase 5 审计与分类已完成，待阶段 Gate 审查
V1：`D:\办公\AI\Codex_Workbench_V1`
旧 donor：`D:\办公\AI\Codex_Workbench`（只读）

## 1. 结论摘要

本阶段对旧 Workbench 的 Runtime/process、Security/IPC/Path、Diagnostics/Git Safety 和 Legacy Contamination 做了四项只读审计，并由主 Agent 交叉复核。

最终结论是：

- V1 的 Native Thread → Native Turn → Native Item 主运行事实成立，旧 Runtime/Task/Conversation 实现不替换。
- 本阶段没有发现“必须直接复制旧 donor 代码才能完成当前 V1 范围”的能力。
- 实际代码迁移：**0 项**。
- V1 已有能力按 `KEEP` 保留；旧实现只在少数边界问题上作为 `REFERENCE`。
- 已确认的真实后续重工候选，不在本阶段偷偷扩展为新产品能力：Native reconnect/reconcile、严格 cwd/path 校验、IPC sender/sandbox hardening、secret-safe structured logging、support diagnostics 和可选 Git 只读信息。
- Conversation、Transcript、Task、Exec、Workflow、Review、Prompt history、Project Context、复杂 Renderer、Multi-Agent 和 Git Workbench 均不进入 V1 主链。

“REMOVE / DO NOT MIGRATE”表示从 V1 迁移候选、import、IPC、持久化和测试依赖中移除，不表示授权删除旧 donor 文件。本阶段没有删除、覆盖或修改旧 donor。

## 2. 分类标准与 V1 不变量

| 分类 | 含义 | 默认行动 |
| --- | --- | --- |
| `KEEP` | V1 已有等价或更好的稳定能力 | 保留 V1，不迁旧代码 |
| `REUSE` | 独立、成熟且 V1 当前确实缺少的基础设施 | 仅在有明确需求时最小移植并补测试 |
| `REWORK` | 有价值但绑定旧产品，或 V1 需要按 Native 模型重做 | 只吸收边界和测试思想，后置重写 |
| `REFERENCE` | 有历史、协议或测试参考价值，但当前没有真实缺口 | 记录，不实现 |
| `LEGACY` | 旧产品体系能力，和 V1 当前范围不一致 | 只留旧仓库，不进入 V1 |
| `REMOVE / DO NOT MIGRATE` | 会制造第二套事实或违反冻结边界 | 明确禁止迁入 V1 |

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → Codex App Server 返回的运行事实
Codex App Server → V1 Runtime 主路径
Workbench → 产品壳 + Project/UI projection + 最小 persistence/recovery + 薄适配 + UI
```

不得重新引入 Workbench Conversation、Transcript、Task/TaskController、Agent/Context truth、Exec history reconstruction、Workflow/Review 主链、Prompt history 对话事实、旧 Git Workbench、复杂 Renderer shell 或自研 Multi-Agent 产品系统。

## 3. V1 当前基线与审计纠偏

| 能力 | V1 当前证据 | 收口分类 | 审计后的准确表述 |
| --- | --- | --- | --- |
| App Server / JSON-RPC / Native Thread/Turn/Item | `src/codex/app-server-client.ts`、`src/codex/native-thread-runtime.ts`、Phase 1–4 报告与 smoke | `KEEP` | 已有真实 initialize、thread/start/read/resume、turn/start/interrupt、continue/restart；不以旧 adapter 替换 |
| Process lifecycle / timeout / stderr / recovery | `src/codex/app-server-client.ts`、`src/codex/native-thread-runtime.ts`、`src/shared/error-info.ts` | `KEEP` + 后置 `REWORK` | 基础 lifecycle、timeout、stderr、process-exit/recovery 已有；no-orphan、child-error、端到端 cleanup、真正 reconnect/reconcile 仍是后续候选 |
| Native approval broker | `src/main/main.ts`、`src/shared/native-approval.ts` | `KEEP` | 固定 Native approval 方法、allowlist、pending/timeout/close cleanup；不迁旧 Workflow 审批模型 |
| Main/Preload IPC | `src/main/main.ts`、`src/preload/preload.cts` | `KEEP` + 安全 `REWORK` | 固定 channel、上下文隔离和 fail-closed 边界已存在；sender 校验、严格 reject、sandbox/导航/CSP 仍需后置 hardening |
| Project/Thread projection 与 persistence | `src/shared/persistence-store.ts`、`src/shared/thread-state-store.ts` | `KEEP` + 路径 `REWORK` | Native identity、关系校验、原子保存和 corruption fail-closed 已有；cwd canonicalization、realpath/目录校验尚不完整 |
| Prompt Recovery | `src/codex/native-thread-runtime.ts`、`src/shared/runtime-types.ts` | `KEEP` | `localRunId` 只是本地恢复关联，不是 Task/Conversation ID；不自动重发 Prompt |
| Logger / error boundary | `src/shared/logger.ts`、`src/shared/error-info.ts` | `KEEP` 基础 + `REWORK` 安全契约 | 当前有 bounded 信息和日志接线，但尚非 donor 级 secret-safe JSONL、路径脱敏、轮转和分类契约；不能把初稿的“完整 structured logger”当成事实 |
| Git safety / Keep/Revert | V1 当前没有对应产品能力 | `REFERENCE` / `LEGACY` | 旧 repo/status/change-set 只作未来设计参考；不在 V1 添加 Git Workbench |
| Environment diagnostics / support bundle | V1 当前没有对应入口 | `REWORK`（后置） | 旧能力绑定旧 Workflow/Package/Browser 状态，未来若有真实支持需求按 Native runtime 重新设计 |

本次特别纠正初稿中的三处表述：V1 没有旧 donor 那种实际 capability probe；Phase 4 的 failure/restart 证据不等于完整 live reconnect；V1 logger/path 只有基础能力，不能提前宣称已具备完整安全诊断契约。

## 4. Donor 能力分类矩阵

### 4.1 A — Runtime / process 基础设施

| Legacy source | V1 existing | 分类 | 决策、证据与后续边界 |
| --- | --- | --- | --- |
| `D:\办公\AI\Codex_Workbench\src\codex\app-server-client.ts` | `D:\办公\AI\Codex_Workbench_V1\src\codex\app-server-client.ts` | `KEEP` | V1 已覆盖 request/response、notification、server request、bounded stderr、parse/process error、timeout；不整块迁移旧 client |
| `D:\办公\AI\Codex_Workbench\src\codex\app-server-session.ts` | `native-thread-runtime.ts` 的 start/resume/read/recovery | `REFERENCE` + 局部 `REWORK` | 旧 session 的 reconnect/reconcile、duplicate dedupe、lifecycle trace 有参考价值，但绑定旧 session/product；未来按 nativeThreadId + `thread/read` 重做 |
| `D:\办公\AI\Codex_Workbench\src\codex\app-server-adapter.ts`、`codex-adapter.ts` | V1 Native runtime | `LEGACY` / `REFERENCE` | 混合 Exec、Conversation、Task 和 adapter 产品边界；只参考错误/协议经验，不迁 adapter |
| `D:\办公\AI\Codex_Workbench\src\codex\codex-process-runner.ts`、`src\p0-02-runner.ts` | V1 App Server child process | `LEGACY` | 旧 Exec runner、Abort/taskkill/任务状态不属于 V1 Native Thread；不迁 Exec session |
| `D:\办公\AI\Codex_Workbench\src\codex\app-server-capabilities.ts` | V1 `app-server-capabilities.ts` | `KEEP` + 后置 `REWORK` | V1 有 initialize validator 和静态 required method 声明，但没有真正 probe/version/schema capability preflight；不复制旧 probe，未来按 V1 协议补 |
| `D:\办公\AI\Codex_Workbench\src\codex\codex-process-environment.ts` | V1 同名环境规范化 | `KEEP` | V1 已有子进程代理环境规范化；本阶段不重复迁移 |
| `D:\办公\AI\Codex_Workbench\src\runtime\runtime-command-gateway.cjs` | 无对应 V1 产品层 | `REMOVE / DO NOT MIGRATE` | 以 `conversation.runtime.select`、`task.*`、`workflow.*`、Exec transport 为中心，会重新建立旧主链 |

Runtime 收口：V1 主链保留，旧 donor 代码迁移 0 项；后置候选是 lifecycle evidence、端到端 timeout cleanup、reconnect/reconcile、事件 cursor/dedupe、interrupt 终态确认和 capability preflight。

### 4.2 B — Security / IPC / Path / Validation

| Legacy source / pattern | V1 existing | 分类 | 决策、证据与后续边界 |
| --- | --- | --- | --- |
| 旧 `src/shared/ipc.cjs`、旧 preload command allowlist | V1 `main.ts` + `preload.cts` 固定 channel API | `REFERENCE`; V1 边界 `KEEP` | 只吸收“窄 channel、Main-owned resource、严格 payload”原则，不迁旧大范围 channel/schema |
| 旧 `src/project/project-workspace.cjs` 的 absolute/realpath/stat/权限检查 | V1 persistence/cwd 字符串规范化 | `REWORK` | 审计确认 V1 尚未完整拒绝 relative、不存在文件、traversal-like path、symlink/junction；未来提取无状态 path validator，不能直接搬旧 project 层 |
| 旧 `src/main/execution-target.cjs` | V1 无 Exec target 产品 | `LEGACY` / `DO NOT MIGRATE` | 绑定 Exec、sandbox、Task；不把旧 execution target 变成 V1 抽象 |
| 旧 `src/main/workspace-manager.cjs` | V1 无临时 Git workspace | `LEGACY` / `DO NOT MIGRATE` | 服务旧 Exec workspace smoke；V1 当前 read-only policy 不需要 |
| 旧 preload 的类型/长度/allowlist 模式 | V1 有基础 slice/bounds/类型分支 | `REWORK`（设计参考） | V1 部分输入仍采用 `String(...).slice()`/cast 而不是严格拒绝；未来按 V1 channel schema 重做，不迁业务 command |
| 旧 Electron `sandbox:true`、导航/弹窗防护模式 | V1 当前 window 基础配置 | `REWORK`（安全 hardening） | sender 校验、sandbox、will-navigate、外部窗口和 CSP 是真实安全候选；本阶段不改变窗口代码，避免无 smoke 的跨层变更 |
| 旧 persistence/path state schema | V1 `persistence-store.ts` / `thread-state-store.ts` | `REMOVE / DO NOT MIGRATE` | 旧 schema 含 Conversation/Task/Context truth；只参考原子写入和 corruption handling |

Security 收口：没有可直接移植且不需重设计的 `REUSE` 项；path/IPC/logging hardening 是后置 `REWORK`，不在本阶段伪装成已完成或引入新产品面。

### 4.3 C — Diagnostics / Support Information

| Legacy source | V1 existing | 分类 | 决策、证据与后续边界 |
| --- | --- | --- | --- |
| `D:\办公\AI\Codex_Workbench\src\main\runtime-logger.cjs` | V1 `src/shared/logger.ts` | `REWORK` | 旧 logger 的 allowlist、敏感 key 过滤、路径脱敏、JSONL、rotation、recent summary 有价值；字段含旧 Task/Workflow/Git 语义，不能原文件迁移 |
| `D:\办公\AI\Codex_Workbench\src\shared\error-info.ts` / 错误分类经验 | V1 `src/shared/error-info.ts`、App Server/runtime codes | `REFERENCE` + 后置 `REWORK` | 保留 V1 Native error codes；未来分离 secret-safe technical details 与 user-facing message，不把旧 Task message 带入 |
| `D:\办公\AI\Codex_Workbench\src\main\environment-diagnostics.cjs` | V1 无诊断入口 | `REWORK`（后置） | 旧检查绑定 package metadata、Workflow persistence、Browser Review；未来只检查 V1 Native runtime、Codex、persistence 和环境 |
| `D:\办公\AI\Codex_Workbench\src\main\support-bundle.cjs` | V1 无 support bundle | `REWORK`（后置） | 旧 bundle 的路径保护、bounded/sanitized output 可参考；未来必须移除 Workflow/Review 摘要、Prompt、Token、绝对路径和 raw payload |
| `D:\办公\AI\Codex_Workbench\src\shared\codex-context-trace-state.cjs` | V1 runtime snapshot/error/recovery | `REMOVE / DO NOT MIGRATE` | 强制 `conversationId`、`taskId`、`turnId`、Exec binding，会制造第二套 Context truth；最多未来重写 native identity/recovery diagnostics 子集 |
| 旧 P6 diagnostics/support tests | V1 当前无对应阶段 | `REFERENCE` | 只复用测试边界和隐私要求，不复制旧产品 schema |

Diagnostics 收口：V1 logger/error 的基础接线保留，完整 secret-safe diagnostics 不属于本阶段已交付能力；当前实际迁移仍为 0。

### 4.4 D — Git safety baseline

| Legacy source / capability | V1 existing | 分类 | 决策、证据与后续边界 |
| --- | --- | --- | --- |
| `project-workspace.cjs` repo detection/status | V1 不调用 Git | `REFERENCE` | 未来只读 project information 可按 `rev-parse --show-toplevel`、status、timeout、dirty evidence 重写；当前不添加 Git subsystem |
| `project-snapshot.ts` / `workspace-change-set.ts` | V1 无 workspace-write | `REFERENCE` | baseline race、用户变更保护、targeted rollback 有参考价值；不迁入 V1 当前主链 |
| `app-server-workspace-write-policy.ts` | V1 固定 read-only/approval never | `LEGACY` / `REFERENCE` | 旧 M4B workspace-write/PowerShell policy 服务旧产品；只保留安全测试思想 |
| `changes.keep` / `changes.revert` / Diff / Review UI | V1 无对应命令 | `REMOVE / DO NOT MIGRATE` | 会重新建立 Git Workbench 与 Review 主心智 |
| shell/destructive command deny | V1 当前不执行 Git/write command | `REFERENCE` | 未来如扩大写入能力再建立独立 allowlist；本阶段不实现 |

Git 收口：没有当前 V1 Git capability gap；“旧 donor 有成熟 Git safety”不是新增 Git 子系统的理由。

### 4.5 E — Legacy product contamination boundary

| Legacy area | 典型来源 | 分类 | 明确决策 |
| --- | --- | --- | --- |
| Workbench Conversation truth | `src/shared/conversation-state.cjs`、`conversation-runtime-binding-state.cjs` | `REMOVE / DO NOT MIGRATE` | Native Thread 是唯一对话身份 |
| Transcript truth | `src/shared/conversation-transcript-state.cjs`、transcript tests | `REMOVE / DO NOT MIGRATE` | 不生成第二份消息事实链 |
| Task / TaskController | `src/main/task-controller.ts`、task lifecycle/CLI | `LEGACY / DO NOT MIGRATE` | 不建立 Task truth、Task Manager 或 Parent/Child |
| Exec-only state | `src/runtime/*`、旧 CLI task commands、P0 runner | `LEGACY / REMOVE` | Exec 不进入 V1 新主链 |
| Workflow V1/V2 | `src/workflow/*`、workflow state/orchestrator | `LEGACY / DO NOT MIGRATE` | 不复活 Workflow scheduler、shadow 或 acceptance 主链 |
| Review | `src/review/*` | `LEGACY / DO NOT MIGRATE` | 不把 PASS/FIX/REDESIGN/BLOCKED 旧协议带成 V1 核心 |
| Prompt optimizer/generator/history | `src/prompt/*`、prompt history state | `LEGACY / DO NOT MIGRATE` | 不迁 Prompt 产品体系或历史作为对话事实 |
| Project Context product schema | 旧 `project-context`、`*context*` state | `LEGACY / DO NOT MIGRATE` | 不把旧技术栈/规则/约束 Context truth 带入 Native Thread |
| Complex Renderer shell | 旧 `src/renderer/app.js`、workflow/editor/task shell | `LEGACY / REMOVE` | V1 Renderer 只消费 Native read model/event projection |
| Multi-Agent orchestration | `workflow-v2-orchestrator.cjs`、assignedAgent/executor roles | `REMOVE / DO NOT MIGRATE` | 不自研 Parent/Child/Agent 产品系统；原生 Thread 只作为 Codex 运行事实 |
| Prompt template parser/render 的纯算法 | 旧 `prompt-template-parser.cjs`、`prompt-template.cjs` | `REFERENCE`（未来可 `REUSE`） | 目前 V1 没有 Prompt Template 需求；未来必须以新命名空间和独立测试重写，不直接复制旧产品文件 |

## 5. 主 Agent 交叉审核结论

四项结果没有形成需要改变 V1 主路线的冲突，主要形成以下纠偏：

1. **Runtime**：Phase 1–4 已有的是 restart/resume/recovery 证据，不等于完整 live reconnect；旧 session 只作参考。
2. **Security**：V1 的 cwd/persistence path、IPC sender、sandbox、payload reject 和总量 bounds 仍有真实 hardening 候选；不能写成“旧安全能力已全部复用”。
3. **Diagnostics**：V1 `logger.ts`/`error-info.ts` 是 bounded 基础，不是完整 secret-safe structured logging；旧 logger 只能后置重写。
4. **Legacy boundary**：旧 Conversation/Transcript/Task/Exec/Workflow/Review/Prompt/Context/Renderer/Multi-Agent 不是可复用的“功能模块”，而是同一套产品 truth，全部禁止进入 V1 主路径。
5. **Scope**：以上候选均不构成当前 Phase 5 必须新增产品能力的理由；本阶段只完成筛选和证据记录，实际 donor code migration 为 0。

## 6. 子代理审计记录

| agent | task | result | adopted | validation | final_status | closed_after_result |
| --- | --- | --- | --- | --- | --- | --- |
| Planck (`01a00fc6-b682-78a0-912f-315808fd3013`) | Runtime Donor Audit | 确认 V1 Runtime 主链足够保留；识别 lifecycle/no-orphan、timeout cleanup、reconnect/reconcile、dedupe、capability preflight 为后置候选 | KEEP V1 runtime；REWORK 候选；donor migration 0 | 静态读取 V1/旧 donor/Phase 1–4 证据；未改文件、未运行测试 | completed | true |
| Nietzsche (`01a00fc6-b71c-7f50-a075-38989bca89b5`) | Security / IPC / Path Audit | 确认窄 IPC、Native identity、approval、persistence 基础成立；发现 cwd canonicalization、sender/sandbox、strict reject、bounds、redaction 缺口 | KEEP 基础；path/IPC/logger 安全后置 REWORK；不直接复制 donor | 静态源码与只读 path probe；未改文件、未构建 | completed | true |
| Kepler (`01a00fc6-b7ee-7000-bccf-99705f7bc18d`) | Diagnostics / Git Safety Audit | 确认旧 donor 有成熟 logger/support/Git safety，但均含旧产品绑定；V1 当前无 support/Git 产品入口 | logger/support 按 Native 模型后置 REWORK；Git REFERENCE；migration 0 | 静态读取两仓库核心路径与历史测试；未改文件、未运行构建/smoke | completed | true |
| Archimedes (`01a00fc6-b8c8-7393-a4fe-863c826b34ca`) | Legacy Contamination Audit | 证明旧 donor 是 Conversation→Transcript→Task/Exec→Workflow/Review/Context/Renderer 的整体产品系统；仅极少纯算法可未来重写 | 旧产品层全部 LEGACY/REMOVE；纯模板算法仅 REFERENCE；不迁移 | 静态依赖/源码/文档审查；未改文件、未运行测试 | completed | true |

四个子代理均在返回最终结果后由主 Agent 审阅并关闭；阶段 Gate 时运行中的子代理数量为 0。

## 7. 实际迁移与依赖污染审计

| 项目 | 结果 |
| --- | --- |
| actual_migrations | `0` |
| V1 product code changed | `0` |
| old donor files changed by this phase | `0` |
| legacy imports added to V1 | `0` |
| legacy persistence schema added | `0` |
| second Conversation/Transcript/Task truth added | `0` |
| old IPC channel namespace added | `0` |
| old Git/Workflow/Review/Multi-Agent main path added | `0` |
| legacy dependencies removed | `0`（本阶段没有迁入，因此无需删除；旧 donor 保持原状态） |

Phase 5 的“0 项代码迁移”不是遗漏，而是审计后的最小安全结果：当前 V1 的真实运行链已经存在，旧 donor 的剩余成熟能力要么没有当前产品入口，要么必须按 Native Thread 语义重新设计，不能直接搬运。

## 8. 验收范围与后续候选

本阶段允许的交付是 inventory、分类、证据和边界，不提前实施 Phase 6 Map Schema/Prompt/Patch/UI/Project Map，也不实现 Workflow、Review、Task Manager、Multi-Agent、Exec、Git Workbench 或第二套 Context/Transcript/Conversation。

后续若进入独立 hardening 或真实支持需求，候选优先级为：

1. cwd/project path canonicalization、realpath/目录/权限/越界拒绝；
2. IPC sender 校验、严格 payload schema、Electron sandbox/navigation/CSP；
3. secret-safe structured logging、error redaction、总量 bounds 和 rotation；
4. App Server lifecycle/no-orphan、端到端 timeout cleanup、reconnect/reconcile、event dedupe；
5. Native-only diagnostics/support bundle；
6. 只有明确的 Git 信息需求出现后，才设计只读 Git safety utility。

这些是后续议题，不是本阶段已实现能力。若未来实现，必须以独立文件/测试、无 Legacy import、最小范围和相应 smoke/Gate 重新审查。

## 9. 保护声明

- 旧 donor 当前既有 dirty baseline 保持不变；没有 reset、clean、checkout、commit、stash 或格式化。
- 本阶段没有修改 V1 Runtime、Sidebar、Thread Workspace、Map、Phase 6 产品代码。
- 旧测试/旧 smoke 通过只作为来源工程证据，不冒充本阶段重新运行的 V1 结果。
- 本阶段下一步只做阶段报告、最终命令验证和 GPT 审查；不进入 Phase 6，直到收到审查结果。
