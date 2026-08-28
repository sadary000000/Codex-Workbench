# Workbench 当前架构边界图

本文档记录需要跨会话长期保持的**当前架构边界**。它不是完整系统设计书，而是防止后续开发再次把 Codex 已经拥有的 Runtime 能力在 Workbench 里重做一遍。

## 1. 总方向

Codex-Workbench 不是 Codex 的替代 Runtime，也不是 Codex Core 的 Fork。

目标形态是：

```text
Workbench
= Codex Native Harness / Runtime
+ Workbench 明确新增的 Product / Governance / Workflow 能力
```

优先执行路径：

```text
Workbench Product / Governance
        -> Codex Native Harness / Runtime
        -> Native tools / provider boundary
```

禁止退化成：

```text
Workbench pseudo-runtime
        -> duplicated Agent / Context / Tool / Sandbox state
        -> Codex
```

一句话原则：

```text
Codex owns HOW.
Workbench governs WHAT / WHY / WHEN / PASS.
```

## 2. 职责归属

| 领域 | 权威 Owner | Workbench 职责 |
|---|---|---|
| Thread / Turn / Item execution | Codex App Server | 引用、组织和展示 Native execution；不得复制 transcript truth |
| Context / Agent / Subagent | Codex Native Runtime | 只增加必要的产品选择/治理；不得自建第二 Agent Runtime |
| Tool / Shell / File Change / Sandbox / Approval | Codex Native Runtime | 适配 native protocol 与 UI；不得实现第二工具/安全运行时 |
| Native plan / diff / runtime event / native recovery | Codex Native Runtime | 读取并投影；不得重新解释成另一份执行状态 |
| Product Project shell | Workbench V1 persistence | 拥有 Product Project 元数据、cwd、导航和产品组织 |
| Product Project ↔ AutomationProject association | Workbench Product Shell | 只拥有跨域 identity association；不得复制 Automation lifecycle |
| RequirementVersion / PlanVersion | Workbench Automation | 拥有 immutable/versioned governance truth |
| Workflow / Stage / Step | Workbench Automation persistence | 拥有长期 workflow progression / governance state |
| Automation Policy | Workbench | 持久化唯一 `PolicyVersion`，结合 hard constraints / runtime capability 推导有效策略 |
| External Action | Provider/remote + Workbench reconciliation records | 持久化 intent / attempt / request / receipt correlation；unknown 必须 reconcile |
| Runtime Resource | live ownership / lease mechanism | 可持久化引用/投影，但 Evidence/UI 不得冒充 resource owner |
| Evidence / Audit | Workbench | 记录证据与治理历史，不拥有 worker/resource |
| Map / UI Projection | Workbench | 把 Requirement、Plan、Workflow、Change、Evidence、Review、PR/commit、Native/provider/resource refs 投影为导航结构 |

## 3. 五类 Truth

架构里存在多个 Truth 是刻意设计，因为它们描述的是不同领域。**禁止为了“统一”把它们压成一个 mega state table。**

### 3.1 Native Runtime Truth

Codex App Server 拥有：

- `Thread`；
- `Turn`；
- `Item`；
- native context / compaction；
- agent / subagent；
- tool execution；
- shell / file changes；
- sandbox / approvals；
- native plan；
- diff / runtime events；
- Native runtime recovery。

Workbench 可以持久化稳定 ID 或产品 projection，但 projection 永远不能反过来覆盖 Native execution state。

### 3.2 Workflow Truth

Workbench Automation persistence 拥有：

- Requirement / Plan versioning；
- Workflow；
- Stage；
- Step；
- Issue / Change / Gate；
- 相关 governance progression。

这些是产品流程事实，不是 Codex transcript。

### 3.3 External Action Truth

对于通过 provider/remote system 发生的副作用：

- provider / remote reality 决定事情实际上有没有发生；
- Workbench 拥有 durable intent / attempt / request / receipt / reconciliation records。

如果本地丢失响应而结果不确定：

```text
UNKNOWN
-> explicit reconcile
-> derive outcome
```

绝不：

```text
UNKNOWN
-> blind resend
```

### 3.4 Resource Truth

Browser、workspace writer、hardware 等稀缺资源的真实占用由**当前 live ownership / lease**决定。

历史 Evidence、Audit、ProviderRequest 或 UI 只能引用资源状态，不能因为“历史记录还非终态”就自动冒充当前 live owner。

### 3.5 Projection Truth

Workbench Map、UI 以及 `docs/workbench-map/` 都是 derived projection。

它们的职责是：

- 导航；
- 关联；
- 解释；
- handoff；
- 展示 checkpoint。

它们不创建 Native/Workflow/Provider/Resource execution truth。

## 4. Effective Policy

有效 Runtime policy 是推导值，而不是另一份独立持久 Policy：

```text
EffectivePolicy
= persisted PolicyVersion
+ hard constraints
+ runtime capability
```

Provider / Runtime adapter 可以消费该结果，但不得再创建竞争的 policy authority。

## 5. Product Project ↔ AutomationProject 关联决策

该语义已经确认，后续实现必须遵守。

### 5.1 Cardinality

```text
Product Project 1 : N AutomationProject
```

一个 Product Project 可以关联多个 AutomationProject。

### 5.2 建立关系

必须**显式绑定**。

允许：

- 创建 AutomationProject 时显式选择 Product Project；
- 在 Product Project 内执行明确“关联 Automation”动作；
- 未来其他显式产品动作。

禁止：

- 因为名字相同就自动绑定；
- 因为两个对象都有 `projectId` 就认为 ID 同域；
- 从自然语言上下文猜；
- 从 Map 节点猜；
- 从 URL/标题/最近使用记录模糊匹配。

### 5.3 解除关系

```text
unlink association
!= delete AutomationProject
```

解绑只删除 association。Product Project 和 AutomationProject 的生命周期继续独立。

### 5.4 Association 的 Owner

Association 属于 **Workbench Product Shell**。

建议语义只保存 identity：

```text
ProjectAssociation {
  productProjectId
  domain
  entityType
  entityId
  createdAt
}
```

不得在 association 里复制 Automation 的 status、active Requirement、Plan、Policy 或 workflow lifecycle。

### 5.5 与 Map 的关系

Map 只能：

```text
读取 authoritative association
-> 生成 typed projection reference
```

Map 不得自己创建或拥有 association truth。

在显式 association 尚未实现之前，跨域 RequirementVersion / PlanVersion 等 Map producer 必须 fail-closed，不能根据同名项目或上下文猜 ID。

## 6. 冻结不变量

除非明确重新打开 Architecture Decision，否则以下规则视为架构约束：

1. Native `Thread / Turn / Item` 是唯一 execution truth。
2. Workbench 不持久化第二套 Native transcript。
3. Manual V1 必须在 Automation 不启用时独立可用。
4. Workbench Product Project 与 `AutomationProject` 是不同 identity / lifecycle domain。
5. Product Project ↔ AutomationProject 为 **1:N 显式 association**；解绑不删除 AutomationProject。
6. `RequirementVersion` / `PlanVersion` 是 Workbench governance truth。
7. Unknown external side effect 必须 reconcile，禁止 blind resend。
8. WebGPT exact-target 无法证明时 fail-closed。
9. Evidence / Audit 与 worker / resource ownership 分离。
10. Map 是 Workbench 增量能力，不能因为 Codex 有 native plan 就删除。
11. Map / UI / handoff docs 只拥有 Projection Truth，不得反向写其他 truth domain。
12. Workbench 不实现第二套 sandbox / tool runtime / subagent runtime。
13. Optional Workbench feature 关闭时，不应无必要污染普通 Native Codex model-visible context。
14. Query / Command / Reconcile 必须保持语义分离；query 不隐藏 mutation/reconcile。

## 7. Context Hygiene

为了避免 Workbench 增量功能损害 Codex 原生模型行为：

- 不重写 Native history；
- 不把完整旧 transcript 每轮重新注入；
- 不为每个 Step 重复注入完整 Requirement/Plan；
- Map 默认不作为大块上下文注入模型；
- Evidence 只提供当前 blocker / acceptance 相关摘要和引用；
- 大文本优先给 path/ref，由 Codex 按需读取；
- Structured output 优先 native `outputSchema`；
- 业务状态存在 Workbench DB，不为了“让模型记住”而反复写入 model context。

## 8. 变更规则

如果未来实现与上述不变量冲突，不得把冲突当成普通 refactor 静默解决。

必须先记录：

1. 要改变哪条 invariant；
2. 为什么；
3. 影响哪一个 Truth domain；
4. 数据/兼容迁移影响；
5. 对 Native model behavior 的影响；
6. 测试/benchmark/evidence；
7. 用户或架构审批结论。

只有完成这一步，才能改变冻结边界。
