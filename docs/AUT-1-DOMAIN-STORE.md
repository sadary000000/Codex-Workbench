# AUT-1 Domain Store

## 定位

AUT-1 是 `PROVISIONAL_FOUNDATION`，不是 Automation 产品实现，也不冻结 AUT-0。它只提供一个与 V1 Native/WebGPT 持久化完全独立的本地 Domain Store 原语。

数据文件名为 `automation.db`，当前采用 JSON 文档格式，使用 `automationSchemaVersion` 标识 schema 版本。该文件不读取、不导入、不复制 Native Thread/Turn/Item、ChatGPT Transcript、Prompt/Response、Cookie、Token、Browser Profile 或 WebGPT 页面内容。

## 实体边界

| 表 | 用途 | 允许保存的内容 |
| --- | --- | --- |
| `automationProjects` | Automation 项目容器和生命周期 | 名称、生命周期、版本指针、revision |
| `requirementVersions` | 需求版本 | 外部 `contentRef` / `structuredPayloadRef`，不保存正文 |
| `planVersions` / `stageSpecs` / `stepSpecs` | 版本化计划定义 | 版本号、目标、风险和副作用类别 |
| `executionAttempts` | StepSpec 的执行尝试 | attempt 状态、时间、终态 |
| `actionIntents` | 外部动作的意图 | 目标 opaque ref、幂等引用、副作用类别 |
| `actionAttempts` / `actionReceipts` | 动作尝试和外部收据 | 受限状态、hash、外部引用、恢复状态 |
| `checkpoints` | 可重载的恢复游标 | 版本、attempt、receipt、workspace/resource/evidence 引用 |
| `externalRefs` | 外部系统身份 | provider + opaque ID |
| `evidences` / `artifactRefs` | 证据索引 | 类型、来源、hash、受限 artifact 引用 |
| `resourceClaims` | 资源声明 | resource type/key、模式、owner attempt、租约状态 |
| `workspaceSnapshots` | 工作区快照摘要 | canonical path 和分支/commit/fingerprint 摘要 |
| `policyVersions` | 策略版本占位 | preset 和有界标量 payload |
| `auditEvents` | 追加式事实链 | 状态变更摘要、sequence、hash 链和 bounded metadata |

## Store 语义

- 单个 `AutomationStore` 通过串行 transaction queue 作为唯一写入口。
- transaction 在内存 draft 上执行，成功后统一做 schema 校验，再写临时文件、`fsync`、同目录 `rename`；回调异常或 schema 失败不会替换旧快照。
- `automation.db` 缺失时创建空 v1 文档；显式 v0 fixture 可迁移到 v1；未来版本拒绝加载。
- 所有跨表引用在提交前检查存在性和项目归属。
- 审计事件只能由 `appendAudit()` 追加；sequence 连续，`prevHash` 和 `hash` 在加载时校验。

## 版本化原则

Requirement、Plan、StageSpec、StepSpec 都用显式 version/specVersion 和 `supersedes` 表达版本关系。旧记录保留为 `SUPERSEDED`，新的记录获得新的 identity；ExecutionAttempt 永远绑定具体 `stepSpecId`，不会被新版本静默替换。

## 非目标

本阶段不接入 `main`/IPC，不调用 Codex App Server、Native Runtime、WebGPT Runtime，也不提供调度器、Planner、Reviewer、Workflow Engine 或 Automation UI。
