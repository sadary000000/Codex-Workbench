# R6 Manual / Automation 解耦审计目标

`R6 — Manual / Automation Decouple` 在 R5 Native Runtime 审计通过后启动。该阶段目前已经完成，本文保留当时的审计问题，作为为什么可以判定 `AUDIT_PASS` 的证据索引。

## 冻结产品规则

1. Manual V1 必须在 Automation 不启用时独立可用。
2. Workbench `Project` 是产品/导航壳，必须与 `AutomationProject` 保持不同 identity / lifecycle domain。
3. Automation 可以复用 Native Runtime infrastructure；Manual 不能反向依赖 Automation lifecycle、Policy、数据库可用性或 workflow identity。

## 主要审计问题

### 1. Startup Independence

需要证明：

- 普通 Electron startup 是否必须先初始化 Automation database/composition 才能使用 Manual Native Thread UI？
- Automation persistence 不可用时，Manual Native runtime 是否会被不必要地拖垮？
- Automation-only gate/smoke 是否与正常 Manual startup 隔离？
- Automation 是否可以只在显式调用 Automation feature 时 lazy initialize，同时保持 provider/policy boundary？

主要代码面：

- `src/main/main.ts`
- `src/main/startup-policy.ts`
- `src/automation/composition-root.ts`
- `src/automation/production-path-contract.ts`

### 2. Project Identity Separation

需要证明：

- `ProjectRecord.projectId` 是否只属于 Workbench Product shell / navigation binding？
- `AutomationProject.projectId` 是否由 Automation persistence 创建/拥有，而不是静默复用 Product Project ID？
- 两个领域需要关联时，是否必须通过显式 reference/association，而不是 type collapse / implicit equality？
- provider/requirement/planner 是否从 Automation Truth 获得 Automation project identity，而不是误用当前 Manual Project？

主要代码面：

- `src/shared/persistence-store.ts`
- `src/automation/schema.ts`
- `src/automation/store.ts`
- provider / requirement / planner composition 与跨域 binding。

### 3. Manual Execution Path

需要证明：

- Manual `thread/start`、`thread/resume`、`thread/read`、`turn/start`、approval、interrupt、composer capability 是否直接调用 Native runtime，而不是经过 Automation workflow state？
- 完全不存在 `AutomationProject` / Workflow / RequirementVersion / PlanVersion 时，Manual 是否仍可工作？
- shared provider/runtime adapter 是否是 Automation 单向消费 Native infrastructure，而不是 Manual 反向依赖 Automation？

主要代码面：

- `src/main/main.ts`
- `src/codex/native-thread-runtime.ts`
- `src/main/runtime-registry.ts`
- `src/main/native-provider-runtime-adapter.ts`

## 分类

使用 evidence-first 规则：

- `MANUAL_INDEPENDENCE_PASS` — Manual path 没有必需的 Automation lifecycle dependency；
- `IDENTITY_BOUNDARY_PASS` — Product Project 与 AutomationProject 保持不同 owner，只允许显式 correlation；
- `DECOUPLE_CHANGE` — 证明存在真实 production dependency / identity collapse，需要 bounded migration；
- `NEEDS_EVIDENCE` — caller/lifecycle 证据不足，暂时不能安全归类。

不要为了类型对称或“架构看起来更漂亮”而拆类型、加 adapter。只有真实 dependency / identity-owner violation 才值得生产代码修改。

## 后续新增的产品决策

R6 审计之后，Product Project ↔ AutomationProject 的关联语义已经进一步确认：

```text
Product Project 1 : N AutomationProject
```

- 必须显式绑定；
- 禁止根据名字、同名 `projectId`、上下文或 Map 猜绑定；
- unlink 只删除 association，不删除 AutomationProject；
- association 由 Workbench Product Shell 拥有。

这个决策进一步强化了 R6 的 `IDENTITY_BOUNDARY_PASS`，但 association 本身尚未在当前集成线实现。
