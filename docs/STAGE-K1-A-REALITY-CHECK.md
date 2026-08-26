# STAGE-K1-A Reality Check

更新时间：2026-08-26（Asia/Shanghai）

## Scope

本阶段只执行 **STAGE-K1-A — Plan Domain & Persistence**。目标是把已经存在的计划版本、阶段规格、步骤规格和持久化能力收敛为可审计的领域基础。不得在本阶段接入 GPT Planner、Provider、Executor、Verifier、Scheduler 或真实 WebGPT。

## Existing / Reusable

| 能力 | 现状 | K1-A 处理 |
| --- | --- | --- |
| `AutomationProject.activePlanVersionId` | 已存在，属于 Project 持久化文档 | KEEP；补充显式的 active-version command/query 与一致性测试 |
| `PlanVersion` | 已存在，含 project、RequirementVersion、version、status、`supersedes` 等字段 | REUSE；将 `supersedes` 作为唯一前驱引用，保持精确 RequirementVersion 绑定 |
| `StageSpec` | 已存在，但只有 key/goal/status/ordinal 等最小字段 | REWORK；增加 K1-A 的 name/objective/dependency/acceptance/detail/assumption/risk 数据 |
| `StepSpec` | 已存在，但只有 kind/goal/risk/side-effect 等最小字段 | REWORK；增加 objective、inputs、expectedOutputs、acceptance、assumptions、constraints |
| SQLite persistence | 已存在，使用文档快照、事务写入、审计追加与边界检查 | KEEP；只做兼容性增量和 K1-A 定向证据 |
| v0/v1/v2/v3 → v4 migration | 已存在并带备份、回滚、恢复证据 | KEEP；不破坏 K0 migration contract |
| `get/list/snapshot` | 已存在并通过 snapshot 读取 | KEEP；补充无写入/无副作用断言 |
| K0 audit and frozen boundaries | 已完成并冻结 | KEEP；不修改 V1 Frozen Core、K0 runtime 或 Submission Runner |

## Missing / Required

- StageSpec 的可持久化计划域字段：`name`、`objective`、`dependsOn`、`acceptanceCriteria`、`detailLevel`、`assumptions`、`risks`。
- StepSpec 的可持久化计划域字段：`objective`、`inputs`、`expectedOutputs`、`acceptanceCriteria`、`assumptions`、`constraints`。
- 新版本写入时的有界字段/数组约束和旧最小记录的兼容读取。
- `setActivePlanVersion` 与 `getCurrentPlanVersion`，并确保 active pointer 是选择事实而不是可变版本实体的替代品。
- 创建 Plan 时对项目、RequirementVersion、版本前驱和跨项目引用的 fail-closed 检查。
- Plan v1 → v2 的不可变性、历史可读性、重启后恢复和迁移/回滚的 K1-A 定向测试。

## Existing Historical / Out of Scope

`src/automation/planner-contract.ts`、`src/automation/planner-service.ts` 中已有较完整的 Planner 路径。它们是此前代码中的既有 donor/历史实现；本阶段不扩展、不调用、不把它们当作 K1-A 的 GPT/Provider 实现证据。任何 Planner prompt、normalizer、Provider request 或真实 WebGPT smoke 均保持暂停状态。

## Boundary Decision

本轮采用兼容增量：不为仅增加字段而升级既有 automation document schema version；新记录写入完整 K1-A 字段，旧 v4 最小记录继续可读，并由验证层按兼容规则处理缺失的新增字段。若审计证明必须升级 schema，必须沿用既有 K0 migration/backup/rollback 合同，不能直接改数据库或重置历史。

## Safety Invariants

```text
RequirementVersion.projectId == PlanVersion.projectId
PlanVersion.requirementVersionId is exact (no latest/nearest substitution)
activePlanVersionId points to a same-project, readable PlanVersion
Plan/Stage/Step reads do not write or mutate persistence
Plan v1 remains byte/value-equivalent after creating Plan v2
K1-A performs no provider dispatch, native action, real prompt, or new business chat
```
## Classification Summary

```text
KEEP: existing persistence, migration/rollback, snapshot reads, K0 boundaries
REUSE: PlanVersion, activePlanVersionId, existing lineage field supersedes
REWORK: StageSpec/StepSpec schema and write validation
ADD: active pointer command/query, K1-A targeted tests and evidence documents
DROP: none
HISTORICAL_RESOLVED: existing Planner GPT path is not used by K1-A
```
