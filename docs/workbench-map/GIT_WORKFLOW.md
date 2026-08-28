# Workbench Git 与验证工作流

本文档定义 Codex-Workbench 当前的 branch / CI / integration discipline。目标是：**验证要严谨，但仓库不能再靠大量长期分支保存中间状态。**

## 1. 三种系统各做一件事

- **Git**：保存代码历史、短命 feature 工作和 durable integration points；
- **`docs/workbench-map/`**：保存整个项目 Roadmap、当前阶段、架构 ownership、决策与 handoff；
- **GitHub Actions**：保存 exact-ref validation、测试日志和可丢弃 artifacts。

禁止再用 Git branch 代替 CI 记录或项目状态数据库。

## 2. 当前远端分支模型

清理后当前仓库保持极简结构：

```text
main
codex/workbench-v1
workbench/next
feature/r7-map-entity-references   # 当前 R7 Draft 工作分支
```

含义：

- `main`：遗留历史线；与当前 Workbench 主历史并非普通前后继关系，暂不自动 merge / delete；
- `codex/workbench-v1`：当前正式稳定基线 / integration-release target；
- `workbench/next`：当前长期集成开发线；
- `feature/*`：只有具体 bounded slice 需要隔离时才创建，完成后及时清理。

过去 R2–R4 的 `arch/**`、`docs/workbench-handoff-map`，以及仅用于 CI 的 `fix/**-exact-head-verify` 分支已经完成历史使命并清理。它们的 commit / PR / Actions 记录仍由 GitHub 历史保留。

## 3. 标准开发流

```text
feature/<bounded-slice>
        ↓ review / CI
workbench/next
        ↓ 阶段完整闭环 + 全量验证
codex/workbench-v1
        ↓
Tag / Release
```

### 3.1 什么时候建 feature branch

只有当具体实现需要隔离时：

- 一刀生产代码修改；
- 需要独立 Draft PR review；
- 失败实验不希望直接污染 integration branch。

不要因为以下原因创建分支：

- 记录 R5/R6/R7 做到哪；
- 触发 exact-head CI；
- 保存测试日志；
- 保存一次性 evidence；
- 仅仅为了“每一步都有一个 branch”。

### 3.2 feature branch 规则

1. 从当时的 `workbench/next` exact head 创建；
2. 一个 branch 对应一个 bounded implementation slice；
3. CI / test evidence 放 PR 和 Actions；
4. 完成并获得明确 integration/merge approval 后进入 `workbench/next`；
5. branch deletion 仍是单独操作，需要明确授权；
6. 不创建 helper validation branch。

## 4. Exact-head CI

`.github/workflows/ci.yml` 已经改为直接验证真实 ref，不需要 `fix/**` 辅助分支。

支持：

- push `workbench/next`；
- push `codex/workbench-v1`；
- PR targeting 两条 integration branch；
- `workflow_dispatch` 指定 branch / tag / exact commit SHA。

PR CI 必须 checkout：

```text
github.event.pull_request.head.sha
```

而不是把 synthetic merge ref 当成 PR head truth。

标准验证链：

```text
npm ci
npm run typecheck
npm test
npm run build
```

需要额外保存的日志、coverage、benchmark bundle、build bundle 等优先使用 GitHub Actions Artifact，并设置合理 retention；不要 commit 到源码分支。

## 5. Map 与 Git 的关系

Roadmap stage 不是 Git branch。

例如 R7 可以包含多个实现 slice，但 Roadmap 的 R7 节点只描述：

- 目标；
- ownership；
- 当前状态；
- evidence；
- exit condition。

具体 commit / PR 是该节点的 evidence reference，而不是 Roadmap 本身。

因此：

```text
R7 ACTIVE
!= 必须存在 arch-r7 branch
```

## 6. 阶段完成

当一个完整 R-stage 满足 exit criteria 时：

1. 更新 `ROADMAP.md`、`HANDOFF.md`、`roadmap.json`；
2. 对 `workbench/next` exact head 跑完整 CI；
3. review `workbench/next` 对正式基线的完整 diff；
4. 根据实际 release/integration 策略打开或更新正式 PR；
5. **只有明确批准后才 merge**；
6. 对具有长期价值的 checkpoint 使用 Tag / Release，而不是永久保留阶段 branch。

## 7. Tag / Release

完成的重要版本应优先通过 Tag / Release 发现，例如：

```text
v0.x.0
workbench-v0.x-r8
```

Release 至少记录：

- stage / version；
- exact SHA；
- architecture/map checkpoint；
- CI / benchmark 结果；
- migration / compatibility notes。

Git 保留历史，Map 解释历史，Release 标记可交付里程碑。

## 8. 第二个 Lab 仓库政策

普通产品开发**不要**拆到第二个仓库。

只有出现明显独立的大型实验资产时，才考虑类似 `Codex-Workbench-Lab`：

- 大型 benchmark dataset；
- stress / fuzz corpus；
- generated fixture；
- 可丢弃 research prototype；
- 大体积实验产物；
- 与正式产品不同的 secrets / access requirement。

正式 Workbench 产品代码继续只在本仓库演进。

原则：

```text
实验数据可以去 Lab
产品代码不要在两个仓库间漂移
```

## 9. 当前历史分支清理状态

已经清理：

- R2–R4 旧 `arch/**` stacked branches；
- `docs/workbench-handoff-map`；
- 旧 `fix/**-exact-head-verify` validation branches。

旧 Draft PR #3–#8 已关闭且未 merge；其历史 commit/CI/Conversation 仍可从 GitHub 查询，不需要依靠 branch 名长期存活。

当前唯一短命工作分支是：

```text
feature/r7-map-entity-references
```

它对应 Draft PR #9，在 R7 完整处理前保留；后续是否 merge/delete 仍分别需要明确授权。

## 10. Git 操作安全规则

以下动作永远分开看：

```text
create branch
push
open PR
merge PR
close PR
delete branch
```

一个动作获得授权，不自动授权其他动作。

特别是：

- Map 标记 `完成` != merge approval；
- CI PASS != merge approval；
- PR closed != branch deletion approval；
- branch 已被 integration line 包含 != 可以未经确认删除。

新 branch/push 前必须明确 branch 和 base ref；禁止 force update。
