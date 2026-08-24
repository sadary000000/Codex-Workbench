# AUT-R0 Reality Check

## Scope

本记录对应 `AUT-R0 — Provider-neutral InputRef + Requirement Production Rewire`。
它只记录开工前对当前仓库生产调用链、边界和持久化现状的盘点；不把历史真实 Gate、暂停 Gate 或旧兼容适配器误记为新的生产实现。

## Repository baseline

- Workbench V1：`D:\办公\AI\Codex_Workbench_V1`
- 当前提交：`0edcec5 fix: normalize automation database path boundary`
- 远端提交目标：`origin/codex/workbench-v1`
- 本轮不操作 `main`，不修改旧 donor `D:\办公\AI\Codex_Workbench`。
- 仓库在本轮开始前已有大量用户未提交的文档、证据包、dist-stage 和其他改动；它们不属于 AUT-R0，实施时必须保持未触碰。

## Current production seam

### 已存在且可执行的中立 Provider Port

`src/automation/adapters.ts` 定义了 `AutomationProviderPort` 以及 opaque 的：

- `ProviderTargetRef`
- `ProviderRequestRef`
- `ProviderResultRef`
- `ProviderSubmitInput.inputRef`
- `ProviderCorrelation`
- `ProviderObservation`

`src/features/webgpt/automation/webgpt-provider-port.ts` 是当前 WebGPT provider-owned 实现。它负责把 opaque target ref 解析为 WebGPT 运行时绑定，并把 opaque input ref 交给进程拥有的 `InputRefRegistry` 解析。

### 开工前 Requirement 服务仍是旧传输形态

`src/automation/requirement-service.ts` 当前接收：

- `IWebGPTRequirementService`
- `RequirementChatBinding.chatRef`
- 原始 `prompt` 传输对象

开工前的 `requestDraft()` 会在内存中构造 prompt，然后直接调用旧 `this.webgpt.submit(request)`；Requirement 对话响应也由旧适配器直接解析为 `RequirementEnvelope`。这条旧路径没有把 prompt 变成 opaque `InputRef`，也没有经由 `AutomationProviderPort` 的统一 correlation/policy/action ledger。

本轮完成后的 active caller 是主进程 authenticated Control Plane 的
`webgpt.requirement.start|draft|reconcile`，它调用共享
`RequirementAutomationService` provider mode。旧 `webgpt` 分支仍只为暂停/兼容测试保留。

### 旧适配器与调用位置

`src/automation/requirement-webgpt-adapter.ts` 是 legacy/test-only 适配器，包含 `chatUrl`、`chatRef` 和旧的 role/request observation port。`src/automation/aut2-real-webgpt-gate.ts` 仍有对它的引用，但该 Gate 由显式环境开关控制并属于暂停的历史真实验证路径；它不能作为 AUT-R0 的新生产入口。

本轮目标不是删除兼容测试契约，而是把新的 Requirement 生产入口改为 provider-neutral；旧适配器必须继续 fail-closed/仅兼容，不得被新的生产装配重新启用。

## Persistence findings

- `RequirementAlignmentSession` / `RequirementAlignmentRound` 已持久化 request ref、semantic hash 和 draft 状态，但没有 durable opaque input reference。
- `WebGptRequestManager` 内存中保留 prompt，持久化 journal 只保留 prompt 长度和 hash，不保存 prompt 原文。
- `ExternalRefKind` 已有 `WEBGPT_PROVIDER_REQUEST`、`WEBGPT_PROVIDER_OBSERVATION`、`WEBGPT_ROLE_BINDING` 等中立引用类型，但没有专门的 input ref 类型。
- `RequirementVersion` 的 canonical structured payload/hash 是领域事实；本轮不把 raw prompt 或 transcript 写入 Requirement truth。

## Required AUT-R0 delta

1. 新增 provider-neutral、不可猜测的 `InputRef` 注册/解析边界；持久化只记录 ref、hash、长度和 kind，不记录 raw prompt。
2. Requirement 生产路径使用 opaque `ProviderTargetRef` 和 `AutomationProviderPort`，不把 `chatRef`/URL 放入新的生产输入。
3. 统一使用已有 policy/correlation/action-attempt/request/observation/receipt 语义，避免创建第二套对话、transcript 或执行事实。
4. Provider 结果读取必须仍以 opaque request/result ref 为边界；不可在 `src/automation` 直接导入 WebGPT feature 实现。
5. 已接受的请求在重启或结果不确定时进入 recovery/reconcile 语义；不能因为 `InputRef` 缓存为空就盲目再次发送。

## Explicit non-goals

- 不修改 V1 Frozen Core、Native Thread/Turn/Item、Runtime Registry 或 WebGPT 页面操作逻辑。
- 不把 AUT-2 legacy real gate 变成普通启动流程。
- 不删除旧兼容测试所需的 `RequirementChatBinding`；但它不能成为新生产装配的事实源。
- 不提交本轮开始前已有的 dist/review、dist-stage、指导文档或无关用户文件。
