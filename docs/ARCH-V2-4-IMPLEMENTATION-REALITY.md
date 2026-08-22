# ARCH-V2-4 Implementation Reality

> ARCH-V2-4 基线与实现现实记录。历史审计段落保留开工前事实；实现段落只记录当前已落地并由测试验证的能力。

## Scope Resolution

### Stage

`ARCH-V2-4 — External Action / Resource / Reconciliation Integration`

### Goal

把现有 Automation Action Domain、WebGPT Request Journal、Operation Arbiter 和 Action Readiness 连接成一条可审计、可重试安全、显式 reconcile 的最小垂直链路：

```text
ActionIntent → ActionAttempt → ProviderRequest → ProviderObservation
             → explicit reconcile → ActionReceipt
ResourceClaim → existing live Resource Lease / Operation Arbiter reference
```

### In scope

- 复用现有 `ActionIntent`、`ActionAttempt`、`ActionReceipt`、`ExternalRef`、`ResourceClaim`。
- 为 WebGPT provider request correlation、provider observation、attempt mapping、receipt evidence 和 live resource lease reference 增加最小必要连接。
- 让 `canDispatch(actionContext)` 以运行时状态、目标身份、活跃资源、未知副作用和幂等安全为条件，并保持查询纯度与显式 reconcile 边界。
- 覆盖同目标未知结果、同幂等键语义冲突、历史非终态但不相关、真实 live lease、重试创建新 Attempt 等 contract/fixture 测试。

### Out of scope

- Requirement/Planner 重做。
- ARCH-V2-5 PolicyVersion 激活。
- ARCH-V2-6 provider-neutral ports。
- AUT-2/AUT-3、AUT-4+、Automation/Workflow/Scheduler 产品实现。
- Shared Codex Host、Map、Renderer、V1 Frozen Core 重构。
- 真实 AUT-2/AUT-3 Prompt、真实 ChatGPT 新 Chat、真实网页副作用。
- 清理、删除、改写生产 Request Journal 历史。

### Architecture boundary

```text
V1 Frozen Core
  Native Thread / Turn / Item truth
        │
        ├── WebGPT Provider
        │     RequestRecord / Journal / OperationArbiter / Browser Lease
        │
        └── Automation Action Domain
              ActionIntent / ActionAttempt / ActionReceipt / ExternalRef / ResourceClaim
```

`ProviderRequest` 不是 `ActionReceipt`；历史 Request 状态不是 live Resource ownership；`ResourceClaim` 不是 live lease；Provider Observation 不直接生成 Workflow PASS。

## Reality Audit

### Q1 — ActionIntent / ActionAttempt / ActionReceipt 当前字段与持久化

已存在并由 `src/automation/store.ts`、`src/automation/schema.ts`、`src/automation/types.ts` 持久化到 Automation document/SQLite 表：

- `ActionIntent`：`intentId`、项目/阶段/步骤/执行引用、`actionType`、`targetRef`、`sideEffectClass`、payload 引用/摘要、`executionOptions`、`semanticSha256`、`idempotencyRef`、预期结果引用、状态和创建时间。
- `ActionAttempt`：`actionAttemptId`、`intentId`、`dispatchNumber`、状态、开始/完成时间、`executorRef`、`recoveryState`。
- `ActionReceipt`：每个 Attempt 最多一个 Receipt；包含状态、外部状态、退出码、结果摘要、外部引用、创建时间、`reconcileState`。`UNKNOWN` 强制 `RECOVERY_REQUIRED`。
- `ExternalRef`：项目、类型、provider、opaqueId、创建时间。已有 `WEBGPT_REQUEST` 类型。
- `ResourceClaim`：资源类型/键、共享模式、请求/获取/释放时间、状态、ownerAttemptId。

当前已存在幂等 ActionIntent 去重和 UNKNOWN Receipt 约束。ARCH-V2-4 已补 provider request/observation correlation、outcome certainty、evidence refs 以及 lease ref/epoch 语义，并保持旧记录读取兼容。

### Q2 — 当前没有运行时消费者的字段

新增 `src/automation/webgpt-external-action.ts` 作为最小 WebGPT 外部动作桥：ProviderRequest/Observation 只作为 provider adapter contract，持久化 correlation 通过现有 ActionAttempt/ActionReceipt/ExternalRef/Evidence 表达；不新增 Request Journal、Receipt 或 live lease store。

### Q3 — WebGPT RequestRecord correlation / idempotency

`src/features/webgpt/types.ts` 的 `WebGptRequestRecord` 已有：`requestId`、`idempotencyKey`、`semanticSha256`、`projectId`、`role`、`targetChatUrl`、运行态 state、页面/Chat 地址、Prompt 摘要、提交/完成时间、结果文件摘要、页面状态、错误。`WebGptRequestManager` 将 Journal 保存在 `requests.json`，同幂等键语义不一致时返回 `IDEMPOTENCY_CONFLICT`，同键同语义返回已有记录，不直接新发。

### Q4 — Fix11 scope-aware classifier

`src/automation/webgpt-action-readiness.ts` 已存在且由 `src/main/main.ts` 的 action preflight 调用。它区分 live browser resource、同目标未决工作、同幂等键同语义可 reattach、同幂等键语义冲突、无关历史非终态和不可读取状态。该 classifier 是纯函数，不持久化、不导航、不 reconcile。ARCH-V2-4 应扩展/复用它，不建立第二套 readiness engine。

### Q5 — activeSummary / global Journal calls

`activeSummary()` 当前返回全部非终态 Request，主要用于 status/preflight 诊断；主流程随后加载记录并交给 scope-aware classifier，而不是仅以 `activeSummary().length === 0` 作为全局阻塞条件。`automationControl()` 当前会显式调用 `reconcilePending()`，逐个 reconcile `RECOVERY_REQUIRED`/`INDETERMINATE` 记录；这不是 query path，但需要在 ARCH-V2-4 记录为控制操作边界并验证不会盲发。

### Q6 — OperationArbiter owner / epoch / operation info

现有 `WebGptOperationArbiter` 仍是进程内、容量为 1 的 live browser operation owner。ARCH-V2-4 为现有 operation identity/diagnostics 增加 `leaseEpoch`，并由 bridge 将 provider 传回的 lease ref/epoch 映射到现有 ResourceClaim；没有独立持久化的 `ResourceLease` entity 或第二个 live lease store。

### Q7 — ResourceClaim 生产消费者

`ResourceClaim` 仍不是 live browser lease。bridge 只保存 provider/arbiter lease 的 ExternalRef 与 epoch 证据，并把 claim 映射为既有 live lease 的关联，不负责创建、释放或替代 OperationArbiter 的 live ownership。

### Q8 — AUT-2/AUT-3 对 WebGPT RequestManager 的直接调用

AUT-2/AUT-3 gate 代码和 `main.ts` 直接使用 `openWorkspace`、Role Service submit、`waitForRequest`、`getResult`、preflight/readiness 等既有路径。当前它们没有把 ActionIntent/ActionAttempt/ActionReceipt 接入 WebGPT dispatch，也没有让 Provider 写 Workflow/Requirement/Plan PASS。该边界必须保持。

### Q9 — WebGPT request → Requirement/Planner mapping

Requirement Service 当前为 WebGPT request 创建 `ExternalRef(kind=WEBGPT_REQUEST, provider=WEBGPT, opaqueId=requestId)`，并将引用/semantic hash 绑定到 alignment round/session；Planner Adapter 通过 Role Session + RequestManager 发送、等待和读取结果。两者尚未创建 ActionIntent/Attempt/Receipt 映射。

### Q10 — retry same request/attempt

RequestManager 的同 `idempotencyKey` + 同 `semanticSha256` 会返回已有 Request，语义不同时拒绝；它不会因调用重复自动创建新 provider send。当前 bridge 已把每次 ActionAttempt 的 providerRequestRef/semantic 显式持久化；terminal failure 后下一次 dispatch 创建新的 ActionAttempt 与 provider request，UNKNOWN outcome 则拒绝盲发并要求显式 reconcile。

### Q11 — reconcile observation / writes

现有 RequestManager 的 `reconcileRequest()` 仍是 WebGPT RequestRecord 的显式 provider 操作；bridge adapter 将其结果转换为 ProviderObservation，随后由 AutomationStore 的 `reconcileActionReceipt()` 更新同一个 UNKNOWN Receipt，不重新发送 Prompt，也不创建第二 Receipt。

### Q12 — Journal active/blocking statuses

WebGPT 的运行/恢复状态包括 `QUEUED`、`SUBMITTING`、`SUBMITTED`、`GENERATING`、`TIMEOUT`、`INDETERMINATE`、`RECOVERY_REQUIRED` 等；`activeSummary` 将全部非 `COMPLETED`/`FAILED`/`CANCELED` 记录列出。当前是否阻塞某个 Action 由 scope-aware classifier + live arbiter diagnostics 决定，不应由历史 Journal 条数决定。

### Q13 — Provider outcome 与 ActionReceipt double-write

当前不存在 ProviderRequest/ProviderObservation/ActionReceipt 双写链路；WebGPT Role Service 的 `handleTerminal` 只更新 Role binding metadata，RequestManager 的 terminal callback 不写 Receipt。因此当前风险是缺少单一写入路径，而不是已发现的双写实现。ARCH-V2-4 必须明确仅 Automation Action Domain 写 ActionReceipt。

### Q14 — 历史 Request 错误阻塞无关 scope

已有 classifier contract 测试证明：无关项目/Role/target 的历史非终态记录在浏览器资源空闲时为 `HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE`，不阻塞；同目标未决记录、不可读记录、同幂等键语义冲突仍 fail-closed。ARCH-V2-4 又增加 15 条无关历史 Journal 回归和 bridge 的 live lease/unknown/retry 证据；真实生产 Journal 只做只读审计，不把历史条数当全局阻塞条件。

## Initial Gap Matrix

| 能力 | 当前事实 | ARCH-V2-4 最小补齐 |
|---|---|---|
| Action Domain | 已有三实体和持久化 | 保持单一模型，补最小 provider/observation/evidence 关联 |
| Provider Request | WebGPT RequestRecord 已有 | bridge 以 provider ExternalRef/Attempt mapping 关联，不复制 Request Journal |
| Provider Observation | 已由 adapter contract + evidence 表达 | 只记录 provider 观察，不能直接写 Workflow PASS |
| Action Receipt | Action Store 单写 | dispatch 创建单一 Receipt；显式 reconcile 更新同一 UNKNOWN Receipt |
| Resource Claim | 持久化但不拥有 live resource | 保存既有 arbiter/provider lease ref/epoch，不建第二租约库 |
| Readiness | 现有 scope-aware 纯 classifier | `canDispatch(actionContext)` 以七项安全事实做纯 fail-closed conjunction |
| Retry | Request 幂等已有；Attempt 递增已有 | terminal failure 才新 Attempt + 新 ProviderRequest，未知结果禁止盲发 |
| Journal | 历史事实只读 | 生产读取只读/hash unchanged，disposition 独立于历史事实 |

## Audit Boundary / Safety

- 本初始盘点未修改产品代码、生产 Journal、用户本地规划文件或旧 donor。
- 后续实现不得清理/删除/终结历史 Journal，不得创建空生产 Journal。
- 真实 Gate 不发送 AUT-2/AUT-3 Prompt；只做生产 Request Journal 只读审计、隔离 provider fixture 和安全的 live lease 读取。

## Sources

- `src/automation/types.ts`
- `src/automation/store.ts`
- `src/automation/schema.ts`
- `src/automation/state-machine.ts`
- `src/automation/webgpt-action-readiness.ts`
- `src/automation/requirement-service.ts`
- `src/automation/requirement-webgpt-adapter.ts`
- `src/automation/planner-webgpt-adapter.ts`
- `src/features/webgpt/types.ts`
- `src/features/webgpt/runtime/webgpt-request-manager.ts`
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts`
- `src/features/webgpt/runtime/webgpt-role-session-service.ts`
- `src/main/main.ts`
- `tests/webgpt-action-readiness.test.ts`
- `tests/webgpt-request-manager.test.ts`
- `tests/webgpt-operation-arbiter.test.ts`
- `tests/automation-foundation.test.ts`
- `tests/automation-persistence.test.ts`

## Status

`IMPLEMENTATION_COMPLETE — internal gate evidence and review package are being finalized.`
