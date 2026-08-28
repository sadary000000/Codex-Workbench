# R7 Projection / Map 审计目标

`R7 — Projection / Map` 在 R5、R6 都以证据满足退出条件后启动，目前是**当前进行阶段**。

冻结规则：

> Map 是 Workbench 的增量 Projection / Governance 能力。不能因为 Codex 有 native plan 就删除 Map；同时 Map 也绝不能成为第二个 Runtime / Workflow truth owner。

## 1. Projection Ownership

需要回答：

- `MapStore` 中哪些数据是 Map 自己有权拥有的 projection？
- 哪些数据只能保存 bounded identity/reference？
- Map mutation 能否直接改写 Native Thread/Turn/Item、Automation Workflow、provider 或 live resource truth？
- stale Map record 是否从 authoritative domain 重新投影，而不是拿 Map 反向覆盖 owner？

真实主要代码面：

- `src/shared/map-store.ts`
- `src/shared/map-types.ts`
- `src/main/map-coordinator.ts`
- `src/main/project-map-manager.ts`
- Map IPC / renderer projection path。

> 早期 handoff 曾写成不存在的 `src/map/map-store.ts` / `src/map/map-types.ts`。该路径已确认过时，后续必须以真实 Git tree 为准。

## 2. Context Boundaries

需要回答：

- Conversation Map 如何获得当前 Native Thread context？
- Project Map 如何读取成员 Thread context？
- context read 是否 bounded / read-only？
- Map 是否积累无边界第二 transcript/document store？
- maintenance prompt/model output 是否与 authoritative Native history 分离？

主要代码面：

- `src/main/map-coordinator.ts`
- `src/main/project-map-manager.ts`
- `src/codex/map-tool.ts`
- Map 使用的 Native `thread/read` adapter。

当前已获得的审计证据表明：Project Map context reader 只允许当前 Product Project 的成员 Thread，并有请求数/Turn/bytes 等边界；读取源是 Native `thread/read`，不是持久化第二 transcript。

## 3. Maintenance Execution

需要回答：

- Map maintenance 是否由真实 Codex Native Thread/Turn 执行，而不是 private pseudo-agent runtime？
- hidden/ephemeral maintenance Thread 是否显式 scope，并与普通用户 Thread identity 分离？
- dynamic tool 是否只暴露 Map projection mutation，而不是 generic filesystem/tool runtime？
- isolated App Server 例外是否由当前 capability/ABI 约束造成，而不是意外复制普通 runtime trunk？

R5 已证明 maintenance 仍属于 Codex-native execution；R7 继续评估 process reuse/ABI 优化，但不能通过优化破坏 ownership。

## 4. Governance Linkage

Map 最终应能够引用但不拥有：

- RequirementVersion；
- PlanVersion；
- Workflow / Stage / Step；
- ChangeRequest；
- Evidence / Review；
- PR / commit；
- Native Thread / Turn / Item；
- provider action；
- resource identity。

跨域 link 必须使用 owner/type/id 之类的 stable identity reference，禁止复制 mutable object。

### 当前 R7 typed reference 设计

Draft PR #9 当前把 Map typed reference 收敛为 identity-only：

```text
domain / entityType / entityId
```

约束：

- 不保存外部 title/status/payload；
- legacy `sources` 的 Native source-trace 语义保持不变；
- Renderer 只读显示 reference identity；
- 不自动 resolver 外部 mutable state；
- maintenance 不得根据名称、自然语言、URL 或同名 `projectId` 猜 reference。

## 5. Product Usefulness

需要回答：

- Map 是否真正成为长期项目导航/progress/handoff surface，而不只是 maintenance plumbing？
- 哪些缺失 link 是 Workbench 真正增量，而不是重复 native plan/status UI？
- 文档 handoff map 能否作为产品 Map 的来源/参考，而不把 docs 变成 Runtime Truth？

当前已确认的 `MAP_PRODUCT_GAP`：原 Map source 主要只能指 Native Thread/Turn/Item，缺少统一的跨域 typed identity reference。PR #9 正在补这层基础。

## 6. Product Project ↔ AutomationProject Gate

R7 审计进一步确认：Product Project 与 AutomationProject 没有可安全自动推断的 identity equality。

当前产品决策：

```text
Product Project 1 : N AutomationProject
```

- association 必须显式创建；
- unlink 不删除 AutomationProject；
- association 由 Workbench Product Shell 拥有；
- Map 只投影 association；
- association 未实现前，不自动生成 RequirementVersion / PlanVersion 等跨域 producer。

因此“Map 支持 typed reference”不等于“模型可以自动猜 typed reference”。

## 7. Classification

每个被审计 surface 使用：

- `PROJECTION_BOUNDARY_PASS` — 只读取 authoritative domain，并只拥有 Map projection；
- `MAP_INCREMENT_PASS` — 属于 Codex Native 不提供的 Workbench 产品/治理增量；
- `PROJECTION_LEAK_CHANGE` — Map 被证明拥有/修改其他 truth domain，或持久化 unsafe duplicate；
- `MAP_PRODUCT_GAP` — ownership 正确，但存在值得实现的明确导航/投影缺口；
- `NEEDS_EVIDENCE` — caller/persistence/runtime 证据还不足。

生产代码修改只有两种充分理由：

1. 证明存在具体 `PROJECTION_LEAK_CHANGE`；
2. 证明存在 bounded、用户价值明确的 `MAP_PRODUCT_GAP`。

禁止为了减少 LOC 或“更像 Codex”删除 Map 产品语义。
