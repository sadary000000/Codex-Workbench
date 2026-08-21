# AUT-2 Requirement Contract Drift Audit — Gate Fix 4

## 审计范围

本审计对照 Requirement Prompt Builder、`RequirementWebGptAdapter`、共享 contract/validator、协议文档、自动化测试和真实 Gate 证据。审计不保存 Prompt/Response 正文，只记录字段、结构和 bounded diagnostics。

## Canonical boundary

Fix 4 将模型输出固定为 semantic-only response：

```json
{
  "requirementProtocolVersion": 1,
  "status": "NEEDS_INPUT | READY_FOR_DRAFT | BLOCKED",
  "payload": {}
}
```

`projectId`、`role`、`chatRef`、`requestId`、`idempotencyKey`、`semanticSha256` 以及 question/round/session/Requirement/Audit/payload hash 等 ID 不再由模型提供；Adapter/Service 在本地验证后组装 trusted envelope 和 domain identity。

## Field matrix

| field | Prompt | Parser / validator | Tests | Real evidence | Final decision |
|---|---|---|---|---|---|
| `requirementProtocolVersion` | 固定为 `1` | 必须为 `1` | PASS | Fix4 首次语义响应为 `1` | 保留为共享常量 |
| `projectId` | 禁止模型回显 | 本地 binding 注入；模型伪造拒绝 | PASS | Fix3 曾回显，Fix4 目标为不回显 | trusted local only |
| `role` | 禁止模型回显 | 本地固定 `REQUIREMENT` | PASS | Fix3 曾回显，Fix4 不依赖其作为事实 | trusted local only |
| `requestId` | 禁止模型回显 | Runtime accepted ID / 本地 request identity | PASS | Fix4 记录 bounded request ID | trusted local only |
| `idempotencyKey` | 禁止模型回显 | 本地生成并绑定请求 | PASS | Fix4 记录 bounded key | trusted local only |
| `semanticSha256` | 不作为模型字段 | 本地请求/语义上下文 hash | PASS | 只记录 hash，不记录正文 | trusted local only |
| `status` | 仅允许三种状态 | discriminated union 严格校验 | PASS | 首次真实响应 `READY_FOR_DRAFT` 合法，但不满足首轮 Gate 语义 | 初始对齐强制 `NEEDS_INPUT` |
| `alignmentStatus` | 不属于模型字段 | 由本地 Session/Round 状态派生 | PASS | 未作为模型事实源 | local projection only |
| `payload` | 按 status 选择唯一 payload | 混合 payload fail-closed | PASS | Fix4 首次响应结构解析通过 | 共享 contract source |
| `questions` | `NEEDS_INPUT` 必填且批量 | 本地生成 questionId/roundId | PASS；新增首轮提示回归 | 首轮未形成 questions，Gate FAIL | 至少 3 个独立缺口由首轮提示明确要求 |
| `assumptions` | 可选 semantic assumptions | 本地生成 assumptionId，来源受控 | PASS | 未进入有效真实 NEEDS_INPUT | 保留 optional bounded 字段 |
| `draft` | `READY_FOR_DRAFT` 必填 | Service 本地映射 RequirementVersion | PASS | 首次响应虽为 READY，但被首轮 Gate 拦截 | 仅在 NEEDS_INPUT/answers 后接受 |
| `code/reason/retryable` | `BLOCKED` 三字段必填 | 严格校验并写 bounded audit | PASS | 未触发 | 保留 fail-closed blocked 分支 |

## Root cause and resolution

Fix3 的真实响应同时包含 transport identity，造成 Prompt、Parser、Validator 和真实响应之间的 contract drift；随后 repair 又出现不平衡 JSON。Fix4 已消除“模型负责 transport identity”的设计漂移，并让 Prompt/validator/tests 共享 `REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS`。

Fix4 首次真实调用证明 semantic-only 解析链路有效，但模型在没有明确“首轮必须提问”的提示下合法返回 `READY_FOR_DRAFT`，不满足 A11 的批量对齐 Gate。修复已在 `requirement-service.ts` 增加首轮强制 `NEEDS_INPUT`、至少三条独立问题以及五类 synthetic 缺口的提示，并新增服务回归断言。

第二次真实 Gate 未发送业务 Prompt：稳定 Chat 复用返回 `USER_CONTROL`，显式 `control auto` 在已有 recovery lease 活跃时超时；setup/new-chat 累计预算已耗尽，因此按 fail-closed 规则阻止新 Chat 和新 Prompt。

## Remaining limitation

Fix4 当前没有取得完整的真实链路证据（`NEEDS_INPUT → answers → READY_FOR_DRAFT → USER confirmation`）。因此不能将 AUT-2 标记为 `PASS_CANDIDATE`，也不得进入 AUT-3。
