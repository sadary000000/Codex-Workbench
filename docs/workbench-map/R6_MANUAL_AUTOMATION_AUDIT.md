# R6 Manual / Automation 解耦审计

## 结论

`R6 — Manual / Automation Decouple` 在源码 checkpoint `68d813b707326e4079992c26435bfbe53a148982` 的结论为 **`AUDIT_PASS`**。

没有证明需要生产代码修改：Manual V1 startup 与 Native Thread/Turn execution 不依赖 Automation 初始化；Workbench Product `ProjectRecord` 与 Automation `AutomationProject` 也由不同 persistence / lifecycle owner 管理。

## 1. Manual Startup Independence

`src/main/startup-policy.ts` 明确把普通 GUI startup 定义为对可选 Automation/WebGPT 状态保持 idle。

`createStartupPlan()` 只有显式 Automation gate 才设置 `automationAtStartup`，`runStartupPlan()` 也只有该 flag 为 true 时才调用 `initializeAutomation()`。

`tests/arch-v2-8-startup-idle.test.ts` 用 filesystem/store evidence 锁定：

- 普通 GUI startup 不产生 Automation/control-plane event；
- 不构造 `AutomationStore`；
- filesystem snapshot 不变化；
- 不出现 automation/webgpt/sqlite/control artifact；
- WebGPT control 和 persistence smoke 都必须显式 opt-in。

`ensureAutomationPersistence()` 是 lazy Automation/WebGPT boundary，不是 Manual runtime 前置条件。

分类：`MANUAL_INDEPENDENCE_PASS`。

## 2. Manual Execution Path

Renderer/Preload 的 Manual Native 操作走 `native-runtime:*` IPC，Main handler 直接路由到当前 `NativeThreadRuntime` / runtime registry：

- start -> `startCurrentRuntime()`；
- resume/switch -> Native runtime selection/resume；
- read -> `NativeThreadRuntime.readThread()`；
- turn -> 校验 exact selected Native target 后调用 `startTurnAccepted()`；
- approval / interrupt / server request 仍属于 Native runtime path。

没有发现 Manual Thread/Turn 依赖：

- Workflow；
- RequirementVersion；
- PlanVersion；
- AutomationProject；
- AutomationStore。

Automation 需要 Native provider 时是反方向单向复用：只能向已经 attach 的 Native runtime submit，target 不存在则 fail-closed。共享 infrastructure 不等于 Manual 依赖 Automation。

分类：`MANUAL_INDEPENDENCE_PASS`。

## 3. Product Project Ownership

Workbench Product Project truth 是 V1 persistence 中的 `ProjectRecord`：

- identity：`ProjectRecord.projectId`；
- product data：name / cwd / timestamps / metadata；
- relationship：`ThreadProjection` -> Product Project，用于导航/cwd grouping。

`V1PersistenceStore.createProject()` 在没有传入 projectId 时自己生成 UUID。正常 Renderer create flow 只传 `{name, cwd}`，所以 Product Project identity 由 V1 persistence 创建，不来自 Automation。

`tests/persistence-store.test.ts` 也把它作为独立 `workbench-state.json` store 测试。

## 4. AutomationProject Ownership

Automation Project 是另一实体：

- identity：`AutomationProject.projectId`；
- workflow data：lifecycle、active RequirementVersion、active PlanVersion、PolicyVersion、revision；
- owner：AutomationStore / `automation.db`。

`AutomationStore.createAutomationProject()` 可以独立生成 Automation ID。

Requirement alignment 开始时会：

```text
tx.require("automationProjects", projectId)
```

Planner 同样查 `snapshot.automationProjects`，不存在则 `PROJECT_NOT_FOUND`。

`tests/automation-foundation.test.ts` 明确验证独立 SQLite `automation.db`，并验证 migration 不导入 V1/WebGPT state。

生产 control-plane command 也把输入明确描述成 Automation project，并只把该 ID 传给 Automation service。没有发现根据当前 Product Project 自动创建 AutomationProject 或默认假设两者 ID 相等的生产路径。

分类：`IDENTITY_BOUNDARY_PASS`。

## 5. Legacy `WORKBENCH_PROJECT` ExternalRef

Automation v4 仍保留 `WORKBENCH_PROJECT` 作为 provider workflow `SCOPE` 的 serialized carrier kind。

这只是 compatibility vocabulary，不代表 Product Project ownership。

`src/automation/workflow-provider-reference.ts` 明确：

- `ExternalRef.provider` 才是 provider identity authority；
- neutral envelope 才是 workflow role authority；
- carrier kind 名称是 legacy serialization vocabulary。

该 ExternalRef correlation 不读取、创建、更新或拥有 V1 `ProjectRecord`，因此不构成 identity collapse。

## 6. Separation Matrix

| 关注点 | Product Project | AutomationProject |
|---|---|---|
| Persistence | V1 Workbench persistence (`workbench-state.json`) | Automation persistence (`automation.db`) |
| 主要职责 | Product shell、cwd、navigation、Thread grouping | Workflow / governance project lifecycle |
| 正常创建 | Renderer -> V1 persistence，在这里生成 UUID | 显式 AutomationStore creation |
| Native Thread 关系 | `ThreadProjection` 可绑定 Product Project | Native IDs 只通过显式 provider/evidence/external refs |
| Requirement/Plan lifecycle | 不拥有 | 拥有 active RequirementVersion / PlanVersion / PolicyVersion refs |
| Startup requirement | 普通 GUI path 可直接使用 | 只有 explicit/lazy Automation activation |

## 7. 后续明确的 Association 产品语义

R6 审计证明两个 Project domain 独立之后，产品层进一步确认了关联规则：

```text
Product Project 1 : N AutomationProject
```

- association 由 Workbench Product Shell 拥有；
- 必须显式建立；
- 禁止用相同名字、相同字段名 `projectId` 或上下文推断；
- unlink 只删除 association，不删除 AutomationProject；
- association 只保存 identity，不复制 Automation lifecycle/status；
- Map 只能投影该 association，不成为 association truth owner。

该语义是当前 `CURRENT_DECISION`，尚未作为生产 association store 进入 `workbench/next`。

## Exit Decision

R6 exit condition 已满足：

> Manual V1 保持独立于 Automation；Product Project 与 AutomationProject 保持不同 identity / persistence / lifecycle domain。

没有证明 `DECOUPLE_CHANGE`，因此不为架构对称性制造 R6 production adapter。

后续阶段：`R7 — Projection / Map`。
