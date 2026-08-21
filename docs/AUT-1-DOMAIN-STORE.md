# AUT-1 Domain Store

## 定位

AUT-1 仍是 `PROVISIONAL_FOUNDATION`，不冻结 AUT-0，不进入 AUT-2，也不接入真实 Native/WebGPT 执行。它提供独立的本地 Automation domain store 原语。

`automation.db` 当前是 schema v2 JSON 文档。它不读取或复制 Native Thread/Turn/Item、ChatGPT Transcript、Cookie、Token、Browser Profile 或 WebGPT 页面状态。RequirementVersion 是例外中的明确结构化真值边界：只允许写入 bounded、canonical、经过敏感字段拒绝的结构化 payload，并由 SHA-256 绑定；不允许把原始 Prompt/Transcript/Response 当作 payload。

## 实体边界

| 表 | 用途 | 事实边界 |
| --- | --- | --- |
| `automationProjects` | Automation 项目容器和生命周期 | 名称、生命周期、版本指针、revision |
| `requirementVersions` | 自包含需求版本 | `canonicalPayload` + `payloadSha256` 是需求真值；content/structured ref 仅为可选 provenance |
| `planVersions` / `stageSpecs` | 版本化计划定义 | 版本号、目标、状态、supersedes |
| `stepSpecs` | 不可变步骤定义 | id/stage/key/specVersion/kind/goal/risk/sideEffect/specStatus；不含运行态 |
| `stepRuntimes` | 步骤运行态 | lifecycle、terminalResult、waitReason、currentAttemptId、revision、更新时间 |
| `executionAttempts` | 绑定精确 StepSpec 的执行尝试 | attempt 状态、时间、终态 |
| `actionIntents` | 外部动作语义意图 | target/payload/options、`semanticSha256`、幂等引用、副作用类别 |
| `actionAttempts` / `actionReceipts` | 动作尝试和外部收据 | 受限状态、hash、opaque refs、恢复状态 |
| `checkpoints` | 可重载恢复游标 | 版本、Stage、StepSpec、StepRuntime、attempt、receipt 及资源/证据引用 |
| `externalRefs` | 外部系统身份 | provider + opaque ID |
| `evidences` / `artifactRefs` | 证据索引 | 类型、来源、hash、受限 artifact 引用 |
| `resourceClaims` | 资源声明 | resource type/key、模式、owner attempt、状态 |
| `workspaceSnapshots` | 工作区快照摘要 | canonical path 和 branch/commit/fingerprint 摘要 |
| `policyVersions` | 策略版本占位 | preset 和 bounded scalar payload |
| `auditEvents` | 追加式事实链 | state mutation 摘要、sequence、prevHash、hash 和 bounded metadata |

## 语义不变量

- `StepSpec` 是 immutable definition；它只能由新的版本 supersede，不能承载 READY/RUNNING/TERMINAL。
- `StepRuntime` 是独立 mutable execution state；每个新 StepSpec 创建一个初始 runtime，ExecutionAttempt 绑定精确 StepSpec，并在同一 transaction 更新 runtime 的 currentAttemptId。
- `RequirementVersion.canonicalPayload` 必须是稳定 canonical JSON object，最大 32 KiB，有限深度/节点数，禁止敏感键；`payloadSha256 = SHA-256(UTF-8(canonicalPayload))`。
- `ActionIntent.semanticSha256` 由 actionType、targetRef、sideEffectClass、payloadRef/payloadHash、expectedOutcomeRef 和 executionOptions 的 canonical descriptor 计算，不包含 intentId、idempotencyRef、时间或运行态。
- 同一 project 的同一 idempotencyRef 若语义 hash 不同，直接 `AUTOMATION_CONFLICT`；不会产生替代 Intent 或第二个动作尝试。
- Checkpoint 必须能从 currentStepSpecId 定位到相同 StepRuntime；receipt 的项目归属通过 ActionAttempt → ActionIntent 推导，不依赖不存在的 `ActionReceipt.projectId`。

## Store 语义

- 单个 `AutomationStore` 通过串行 transaction queue 作为唯一写入口。
- transaction 在内存 draft 上执行，成功后统一 schema/foreign-reference 校验，再写同目录临时文件、`fsync`、`rename`；回调异常或 schema 失败不会替换旧快照。
- schema v0 只接受显式 `schemaVersion: 0`；schema v1 显式迁移到 v2；缺失版本、冲突版本和未来版本 fail closed。
- v1 迁移为旧 StepSpec 生成 `specStatus + StepRuntime`，为旧 RequirementVersion 生成明确的 legacy reference envelope 并计算 hash；不伪造旧正文。
- 审计事件只能由 `appendAudit()` 追加；sequence 连续，`prevHash` 和 `hash` 在加载时重新校验。

## 非目标

本阶段不接入 `main`/IPC，不调用 Codex App Server、Native Runtime、WebGPT Runtime，不提供调度器、Planner、Reviewer、Verifier、Workflow Engine 或 Automation UI。
