# AUT-2 需求对齐与基线

## 阶段定位

AUT-2 只建立 Requirement Alignment / Confirmation / Change Request 的领域基线与 WebGPT 合同边界。它不是 Planner、Reviewer、Native Executor、Scheduler 或 Workflow UI，也没有启动任何真实 Native 执行。

当前基线：`AUT-1.5` 持久化已生产化；实现提交：`fe2bf56`。

## 对齐流程

1. 用户给出目标后，系统按独立问题批次建立一个 Alignment Session / Round。
2. 阻塞事实必须由用户回答；不能用静默默认值代替。
3. 非阻塞事实可以在明确标记为 `ASSUMPTION_ALLOWED` 后形成显式假设；假设包含影响、置信度、来源和状态。
4. `AVAILABLE_CONTEXT` 只接收已由调用方提供且通过 egress policy 的 bounded context；不会自行读取项目文件或聊天历史。
5. `AUTO_INVESTIGATION` 没有证据提供者时进入 `WAITING_AUTOMATIC_EVIDENCE`；不会伪造答案。
6. WebGPT 返回 `NEEDS_INPUT` 时一次性加入独立缺失问题；返回 `READY_FOR_DRAFT` 才创建 Draft RequirementVersion。
7. RequirementVersion 只有用户显式确认后才成为项目 active version。

## 证据

- 批量问题、答案、显式假设、自动证据和状态迁移：`tests/aut2-requirement-service.test.ts`、`tests/aut2-requirement-domain.test.ts`。
- 关闭数据库再重新打开后，等待中的 Alignment Session 与自动证据完成状态保持：`tests/aut2-requirement-service.test.ts`。
- v2 JSON 与 v2 SQLite 迁移保留项目、RequirementVersion、审计链和 hash：`tests/automation-persistence.test.ts`。

## 明确未实现

- 不创建 Planner/Reviewer 任务。
- 不把 RequirementVersion 转成执行计划。
- 不启动 Native Thread、Native Turn 或 Native Item。
- 不自动修改项目文件，不读取 Cookie、Token、Transcript、raw HTML 或私人聊天内容。
