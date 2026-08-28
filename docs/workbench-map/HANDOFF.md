# Workbench 当前交接 Checkpoint

新的会话如果只想最快恢复上下文，按以下顺序阅读：

1. `README.md` — Map 的用途和证据规则；
2. `ROADMAP.md` — 整个项目从起点到未来的完整节点；
3. `ARCHITECTURE.md` — 当前冻结 ownership / truth boundary；
4. `GIT_WORKFLOW.md` — branch / CI / merge discipline；
5. R5/R6/R7 审计文件 — 当前迁移为何推进到 R7；
6. 本文件 — 精确继续点。

## 1. Repository Checkpoint

- Repository：`sadary000000/Codex-Workbench`
- 正式稳定基线：`codex/workbench-v1`
- 当前集成分支：`workbench/next`
- 本轮“全项目 Map + 中文文档”重建前的 `workbench/next` code/docs checkpoint：`abd15c39e07aa736721c977c07de9b98eb6c6360`
- 当前真实 branch head：**以远端 Git ref 为准**；本文件属于持续更新的 projection，不把自身 SHA 当 Git truth。

## 2. 当前远端分支模型

清理后只保留：

```text
main
codex/workbench-v1
workbench/next
feature/r7-map-entity-references
```

说明：

- `main` 是遗留历史线，和当前 Workbench 主历史不是普通祖先/后继关系，暂不自动处理；
- `codex/workbench-v1` 是稳定基线；
- `workbench/next` 是当前集成线；
- `feature/r7-map-entity-references` 是当前唯一短命 feature branch。

旧 `arch/**`、旧 `docs/workbench-handoff-map`、旧 `fix/**-exact-head-verify` 分支已经清理。

## 3. PR 状态

- PR #2：Planner retry/source-integrity，已合入；
- PR #3–#8：**已关闭、未 merge**；旧 branch 已删除；其 stacked commits 已经由 `workbench/next` 历史继承；
- PR #9：**Draft / open / 未 merge**，R7 当前实现分支。

PR #9：

```text
feature/r7-map-entity-references
  -> workbench/next
```

已验证 feature exact head：

```text
efd27cc9cc8bd854be011cc87aba67453b4ffcce
```

该 tree 的标准 exact-head CI 已通过：typecheck、全量 tests、build PASS。

> Stage/CI/Map 状态从来不自动授予 merge approval。

## 4. 已完成架构审计

### R5 — Native Runtime Dedup

状态：`AUDIT_PASS`。

结论：

- Codex App Server 仍是 Thread/Turn/Item truth；
- Workbench 没有 durable duplicate Native transcript；
- 没有第二 agent/subagent/tool/sandbox runtime；
- Map maintenance 是受限 Workbench 增量能力，执行仍是 Codex Native；
- 没有证明需要 R5 production refactor。

证据：`R5_NATIVE_RUNTIME_AUDIT.md`。

### R6 — Manual / Automation Decouple

状态：`AUDIT_PASS`。

结论：

- 普通 GUI startup 不初始化 Automation/WebGPT persistence；
- Manual `native-runtime:*` 直接进入 Native Runtime；
- Product `ProjectRecord` 属于 V1 persistence；
- `AutomationProject` 属于独立 `automation.db`；
- Requirement/Planner 需要真实 AutomationProject；
- 没有自动 Product Project -> AutomationProject identity collapse。

证据：`R6_MANUAL_AUTOMATION_AUDIT.md`。

## 5. 当前工程阶段：R7 Projection / Map

R7 当前已经证明 Map 的 ownership 基础是正确的：

- `MapStore` 是独立 JSON sidecar，只写 `MapDocument` projection；
- Map mutation 没有写 Native/Automation/provider/resource truth 的接口；
- `MapNode.sources` 使用 Native Thread/Turn/Item source trace，不复制 Native item body；
- Project Map context read 有 project membership 和 request/turn/bytes 边界；
- maintenance 使用真实 Codex Native Thread/Turn；
- Map 不是第二 transcript / Agent Runtime。

### PR #9 已实现的 R7 slice

#### R7.1 — Typed Projection Reference

Map node 可以保存 identity-only reference：

```text
domain / entityType / entityId
```

不复制外部 mutable state。

#### R7.2 — Readonly UI Surface

Renderer 只读显示 typed reference identity，不自动读取 Automation/GitHub/provider 状态，不伪造跳转。

#### R7.3 — Producer Safety Boundary

- legacy `add_node` 不再静默丢 typed reference；
- maintenance prompt 明确禁止从名称、自然语言、URL 或同名 `projectId` 猜跨域 ID；
- 只有 owner-confirmed stable identity 才能成为 reference。

## 6. 已确认但尚未实现的 Product Association

Product Project ↔ AutomationProject 语义已经冻结为：

```text
Product Project 1 : N AutomationProject
```

规则：

1. **显式绑定**；
2. 不通过名字、同名 `projectId`、上下文、Map 自动猜；
3. unlink 只删除 association；
4. **绝不因为 unlink 删除 AutomationProject**；
5. association 由 **Workbench Product Shell** 拥有；
6. association 只保存 identity，不复制 Automation lifecycle/status；
7. Map 只投影 association，不成为 association truth；
8. association 未实现前，不自动生成 RequirementVersion/PlanVersion 等跨域 Map producer。

这是 `CURRENT_DECISION / WAITING_IMPLEMENTATION`。

## 7. 下一步

R7 不应继续为了“多接几个实体”而让模型猜 ID。

安全继续顺序：

1. review PR #9 最终 R7 typed-reference diff；
2. 判断 R7 是否已经满足当前 projection foundation exit；
3. association 如果要实现，先设计 Product-Shell-owned persistence + 显式 UI/command lifecycle，而不是把关系塞进 MapStore；
4. association 不做时，也可以把 R7 以“foundation completed, producer gated”收口；
5. 然后进入 **R8 — Migration / Dead Code** 只读审计；
6. R8 只在 owner 证明后删除 legacy/duplicate path；
7. R8 后执行 Direct Codex vs Workbench Native A/B。

## 8. Resume Protocol

新会话继续时：

1. 查询 `workbench/next` 远端 exact SHA；
2. 查询 PR #9 当前 head/state/CI，不能依赖本文档缓存状态；
3. 先读 `ROADMAP.md`，不要只从 R7 开始而忘掉历史路线；
4. 任何架构修改先对照 `ARCHITECTURE.md` 冻结不变量；
5. Production change 前先证明具体 ownership violation 或 bounded product gap；
6. feature branch 只用于 bounded slice；
7. 不创建 exact-head validation helper branch；
8. 新 branch/push 前声明 exact branch/base，并说明不会 merge；
9. merge 与 branch deletion 分别需要明确授权；
10. durable checkpoint 改变时同步 `ROADMAP.md` / `HANDOFF.md` / `roadmap.json`。

## 9. 不可破坏的继续约束

- Native Thread/Turn/Item 是 execution truth；
- 不复制第二 transcript；
- Manual V1 不依赖 Automation；
- Product Project != AutomationProject；
- Product Project ↔ AutomationProject = 1:N explicit association；unlink != delete；
- RequirementVersion/PlanVersion 是 Workbench governance truth；
- unknown provider side effect -> reconcile，禁止 blind resend；
- Evidence/Audit 不拥有 resource lease；
- Map 是 Projection / Governance increment，不是 duplicate native planning；
- 不实现第二 sandbox / Native tool executor / subagent runtime；
- 不让 optional Workbench feature 无必要污染普通 Native Codex context。
