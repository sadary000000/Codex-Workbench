# Workbench 全项目工程地图

本目录是 Codex-Workbench 的**长期工程导航与交接层**。目标不是只记录“现在正在做什么”，而是让人类或新的 AI/Codex 会话在不依赖旧聊天记录的情况下，能够从项目起点一路理解到当前状态和后续路线。

这里保存的是整个项目的结构化历史：产品冻结、V1 原生重建、人工验收 UI、WebGPT、Automation、Architecture Rebaseline、Native-first 去重迁移、当前 R7/R8 路线，以及已经明确但尚未实现的产品决策。

## 这个目录是什么

`docs/workbench-map/` 是 **Projection / Handoff Surface（投影与交接面）**。

它负责连接：

- 项目为什么开始；
- 每一条历史实施线做过什么；
- 哪些节点已经完成、归档、替代或审计通过；
- 当前架构为什么采用 Native-first；
- 当前真实开发节点在哪里；
- 下一阶段从哪里安全继续；
- 关键决策、证据、PR、commit 和分支之间是什么关系。

它与 Workbench 产品里的 Map 概念保持同一原则：**用明确节点、关系、来源和状态连接工程事实，而不是依靠重新阅读整段聊天来猜项目状态。**

## 这个目录不是什么

这里**不是新的 Runtime Truth，也不是第二套 Workflow State Machine**。

权威事实仍按领域分离：

| 领域 | 权威事实源 |
|---|---|
| Native Runtime Truth | Codex App Server：`Thread` / `Turn` / `Item` / native runtime events |
| Workflow Truth | Workbench Automation persistence |
| External Action Truth | provider / remote system + reconciled Workbench records |
| Resource Truth | live runtime ownership / lease |
| Projection Truth | Workbench UI、Map、以及本目录 |

如果本文档与当前源码、数据库或真实 Runtime 冲突，**修正文档，不得为了让 Map 看起来正确而反向修改事实源。**

## 证据优先级

完整项目历史包含早期规划、当时的 Gate 报告和后来已经推进过的实现。判断当前事实时统一采用：

```text
当前 pinned source / 当前 Git tree
> 当前测试、schema、production composition
> 已确认的 Frozen Contract / 产品决策
> 历史阶段报告与 Gate 状态
> 早期路线规划与当时的实现推测
```

因此旧文档里的 `PASS`、`BLOCKED`、`NEXT` 只表示**当时的历史状态**，不能覆盖今天的源码事实。

节点来源使用以下语义：

- `SOURCE_CURRENT`：当前源码/测试可以直接证明；
- `PRODUCT_INTENT`：历史材料或用户确认的产品决策，用于解释“为什么”；
- `HISTORICAL_STATUS`：旧阶段当时的状态，只用于保留项目历史；
- `CURRENT_DECISION`：当前明确确认、但可能尚未实现的产品/架构决策。

## 建议阅读顺序

1. [`ROADMAP.md`](./ROADMAP.md) — **整个项目从起点到未来的完整节点图**；
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — 当前 Native-first 职责边界、五类 Truth 和冻结不变量；
3. [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md) — 当前分支、CI、集成和版本发布规则；
4. [`R5_NATIVE_RUNTIME_AUDIT.md`](./R5_NATIVE_RUNTIME_AUDIT.md) — R5 Native Runtime 去重审计；
5. [`R6_AUDIT_TARGETS.md`](./R6_AUDIT_TARGETS.md) 与 [`R6_MANUAL_AUTOMATION_AUDIT.md`](./R6_MANUAL_AUTOMATION_AUDIT.md) — Manual / Automation 解耦证据；
6. [`R7_AUDIT_TARGETS.md`](./R7_AUDIT_TARGETS.md) — Projection / Map 当前审计边界；
7. [`HANDOFF.md`](./HANDOFF.md) — 当前准确 checkpoint 和继续工作协议；
8. [`roadmap.json`](./roadmap.json) — 面向工具/AI bootstrap 的机器可读索引。

## 状态词汇

人类可读文档统一使用以下状态：

- **历史已完成**：当时实施/Gate 已闭环，但不代表仍是当前架构；
- **历史归档 / 已替代**：节点必须保留在项目历史中，但其方案或状态已被后续路线取代；
- **审计通过**：通过源码/测试证据确认边界，无需为了推进阶段而强制改生产代码；
- **当前进行**：现在正在审计或实现；
- **计划**：已排定但尚未开始；
- **产品决策 / 等待实现**：语义已经确认，但实现还没进入当前主线；
- **阻塞**：存在明确依赖，不能安全继续；
- **历史待核实**：知道节点存在，但当前证据不足以恢复其完整原始说明。

## 当前项目状态分工

以后严格分开三件事：

- **Git**：代码历史、短命 feature 分支、长期集成点；
- **Workbench Map**：项目路线、历史节点、当前阶段、决策、依赖和证据引用；
- **GitHub Actions**：测试、exact-ref 验证和可丢弃的验证产物。

**禁止再用 Git branch 保存 CI 证据或充当 Roadmap 状态数据库。**

## 更新规则

以下变化发生时必须更新本目录：

- 架构 ownership 或冻结不变量变化；
- Roadmap 节点新增、完成、替代、阻塞或重新排序；
- 重要审计产生 PASS / CHANGE 结论；
- 集成分支、正式 PR、commit checkpoint 或 Release 发生变化；
- 产品决策被用户确认；
- 发现历史节点缺失或旧 handoff 已经过时；
- 下一会话的安全继续点发生变化。

普通代码编辑如果没有改变工程路线或交接状态，不必机械更新 Map。

## Git 安全规则

分支创建、push、PR、merge、branch deletion 是不同操作。创建/推送实现分支前必须明确 branch 和 base ref；**Map 中显示“完成”从来不等于获得 merge 或删除分支的授权。**
