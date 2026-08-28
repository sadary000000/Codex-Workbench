# R5 Native Runtime 去重审计

## 结论

`R5 — Native Runtime Dedup` 在源码 checkpoint `3a7c3509b7fff16fb10a2b598aa6a20c857cd7b6` 的结论为 **`AUDIT_PASS`**。

本次审计没有发现必须通过生产代码修改才能解决的重复 Native Runtime。当前 Codex-facing 主路径已经让 `Native Thread`、`Native Turn`、`Native Item` 保持为 Codex App Server 的执行事实。Workbench 只保留有边界的 controller state、产品 metadata、recovery correlation、UI projection、provider correlation 和 Map state，没有持久化竞争性的 Native transcript，也没有实现第二套 Codex tool / sandbox / subagent runtime。

`AUDIT_PASS` 的含义是：**退出条件由证据满足，不为了让阶段“看起来有改动”而制造重构。** 它从来不代表 merge approval。

## Handoff 路径更正

最初 R5 handoff 中列出的以下文件在审计 checkpoint 已经不存在：

- `src/codex/project-thread-store.ts`
- `src/codex/context-sharing.ts`
- `src/codex/agent-run-service.ts`
- `src/codex/tool-registry.ts`

真实生产面主要集中在：

- `src/codex/native-thread-runtime.ts`；
- App Server host/client adapter；
- `src/main/runtime-registry.ts`；
- Native provider adapter；
- read/projection code；
- 显式 Map maintenance path。

**禁止根据过时文件名推断架构。当前 Git tree + production caller 才是代码拓扑事实。**

## 证据矩阵

| Surface | 分类 | Ownership / 证据结论 |
|---|---|---|
| `src/codex/native-thread-runtime.ts` | `NATIVE_ADAPTER_PASS` | `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`thread/read` 委托 Codex App Server。Native ID 来自 App Server response/event，Workbench 不生成伪 ID。Local `RuntimeState` / active-turn 只是进程 controller state，不是 Native history 替代品。 |
| `src/shared/thread-read-model.ts` | `NATIVE_ADAPTER_PASS` | 把 `thread/read` 解析成只读 convenience model，保留 `raw`，明确不发明 Conversation/Transcript/Task 语义或 placeholder ID。 |
| `src/shared/persistence-store.ts` prompt recovery | `NATIVE_ADAPTER_PASS` | Durable recovery 只保存 `promptSha256`、length/ref、Native IDs/status 等有边界 identity/correlation。raw prompt 在持久化前被规范化掉。 |
| `src/codex/app-server-host.ts` | `NATIVE_ADAPTER_PASS` | 普通 Main App Server transport 为多个 Native Thread handle 提供共享 host；routing 没有实现第二 approval/tool/runtime engine。 |
| `src/main/runtime-registry.ts` | `NATIVE_ADAPTER_PASS` | 内存中的 `nativeThreadId -> live handle` registry；不持久化 Thread truth，也不建立竞争 execution scheduler。 |
| `src/main/native-provider-runtime-adapter.ts` | `NATIVE_ADAPTER_PASS` | Automation 只能通过已经 attach 的 Native runtime dispatch；target 缺失时 fail-closed，不偷偷创建/resume 另一 runtime。Observe 是 query-only；reconcile 读取同一 Native Turn，最多刷新 Workbench projection。 |
| `src/codex/automation/native-provider-port.ts` | `NATIVE_ADAPTER_PASS` | provider request identity 以 Native Turn ID 为权威。Unknown outcome 走 observe/reconcile，不制造第二 Turn，也不 blind resend。 |
| `src/codex/composer-capabilities.ts` | `NATIVE_ADAPTER_PASS` | 把 App Server model capability / UI preference 映射为 native turn option；approval/sandbox 是协议参数，不是 Workbench 自己执行审批/沙箱。 |
| `src/renderer/message-projection.ts` 与 Thread UI | `WORKBENCH_INCREMENT_PASS` | Native read/event 只转换为 display card；renderer local state 用于 UI/draft，不是持久 Native transcript。 |
| `src/codex/map-tool.ts`、`src/main/map-coordinator.ts`、`src/main/project-map-manager.ts` | `WORKBENCH_INCREMENT_PASS` | Map 是 Workbench 显式 projection 能力。Maintenance 仍由真实 Codex Native Thread/Turn + bounded dynamic tool 执行；MapStore 只拥有 Map projection。 |
| `src/automation/state-machine.ts` | `WORKBENCH_INCREMENT_PASS` | 这是 Automation Workflow Truth，不是 Codex Thread/Turn/Agent 执行替代品。 |

## Transcript / Context 结论

审计路径中不存在 Workbench 对 Native transcript 的 durable 副本：

- 历史 Turn/Item 从 `thread/read` 现场读取并投影；
- `ThreadProjection` 保存产品导航 metadata 与 bounded last-known runtime metadata，不保存 Turn/Item body；
- Prompt recovery 保存 digest/length/correlation，不保存 raw submitted prompt；
- UI message projection 由 Native read/event 派生，不是独立 conversation DB。

回归证据：`tests/arch-v2-7-prompt-recovery.test.ts` 明确验证 persistence file 中不存在 raw prompt，重新打开 persistence 后也无法取回 raw prompt。

## Agent / Subagent / Tool 结论

审计源码树中没有独立的：

- Workbench agent runner；
- Workbench subagent runtime；
- generic Native tool executor / registry；
- 第二 sandbox / approval runtime。

Native collaboration-agent tool call 等仍按 Native Item 解析。Workbench dynamic Map tool 是窄范围 product-side channel，通过 Codex App Server server request 处理，并不替代 Codex native tool runtime。

Automation state machine 属于合法 Workflow Truth。不能因为它也有 state/transition，就把它误判成 LLM Agent Runtime。

## App Server Process Topology

普通 user-facing Native Thread 已共享生产 `AppServerHost` transport，这一能力来自 `ARCH-V2-2` 及其真实 multi-thread smoke evidence。

Map 有有意保留的兼容例外：

- resumed Conversation Map compatibility fallback；
- Project Map maintenance/update；
- bounded Project Map context reader。

这些路径在当前 CLI ABI 下可能启动 isolated `AppServerProcessClient` 或 hidden/ephemeral Native maintenance Thread，原因包括 `thread/resume` 的 dynamicTools 能力限制以及 Map 的独立 bounded capability domain。

这**不构成第二 Native execution truth**：maintenance 仍然由 Codex Native Thread/Turn 执行，scope 明确，并且只写 Map projection state。

Process reuse 仍可以作为 R7/R8 optimization 评估，但只有在 CLI/native capability 明确允许时才改，不能为了减少进程数破坏 Map ownership / ABI 边界。

相关历史文档：

- `docs/ARCH-V2-1-MAP-ACTIVATION-CONTRACT.md`
- `docs/ARCH-V2-2-RUNTIME-REALITY.md`
- `docs/ARCH-V2-2-SPAWN-TOPOLOGY.md`

## 已有回归证据

R5 复用了已有测试，而不是新增 no-op production diff：

- `tests/arch-r2-shared-native-runtime.test.ts` — Native target 缺失 fail-closed；reconcile 不重新 dispatch `turn/start`；显式 reconcile 只刷新 projection；
- `tests/arch-v2-7-prompt-recovery.test.ts` — raw prompt 永不持久化；
- `tests/native-thread-runtime.test.ts` — Native runtime identity/turn/read/recovery；
- `tests/app-server-host.test.ts` — shared Host routing 与 per-thread isolation；
- `tests/thread-read-model.test.ts` — read-only Native thread parsing；
- `tests/message-projection.test.ts` — Native value 的 renderer projection；
- `tests/composer-capabilities.test.ts` — capability/preference/native-option mapping；
- Map coordinator/manager tests — explicit Map projection 与 compatibility maintenance 行为。

## Exit Decision

R5 exit condition 已满足：

> Codex-facing Workbench 代码是 Native adapter / projection / product logic，而不是竞争性的 Thread / Context / Agent / Tool Runtime。

没有证明 `DUPLICATE_RUNTIME_CHANGE`。

因此 R5 不应为了形式感再创建生产 feature branch。该阶段已经以证据型 `AUDIT_PASS` 结束，后续进入 R6（现已同样审计通过）与 R7。
