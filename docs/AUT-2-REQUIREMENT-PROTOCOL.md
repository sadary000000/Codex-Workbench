# AUT-2 Requirement Protocol

## Canonical Requirement payload

协议版本为 `1`，Canonical payload 只允许以下字段：

```yaml
schemaVersion: 1
goal: string
scope: string[]
outOfScope: string[]
functionalRequirements: string[]
technicalConstraints: string[]
environmentConstraints: string[]
acceptanceCriteria: string[]
riskConstraints: string[]
externalDependencies: string[]
assumptions: string[]
humanApprovalPoints: string[]
knownDeferredGates: string[]
createdFromAlignmentSessionId: string
```

对象键、字符串长度、数组数量、嵌套深度和功能需求非空均在边界层校验。Canonical JSON 的 SHA-256 写入 `RequirementVersion.payloadSha256`，不可通过普通替换改变。

## WebGPT model response and trusted envelope

WebGPT Requirement role 只允许三个机器状态：

- `NEEDS_INPUT`：`payload.questions` 至少一项，可带 bounded `assumptions`。
- `READY_FOR_DRAFT`：`payload.draft` 为 bounded semantic draft。
- `BLOCKED`：`payload.code`、`payload.reason`、`payload.retryable` 三项均必填。

模型输出是唯一的 semantic response，顶层键严格为：

```json
{
  "requirementProtocolVersion": 1,
  "status": "NEEDS_INPUT | READY_FOR_DRAFT | BLOCKED",
  "payload": {}
}
```

模型不得输出 `projectId`、`role`、`chatRef`、`requestId`、`idempotencyKey`、`semanticSha256`，也不得生成 `questionId`、`alignmentRoundId`、`alignmentSessionId`、`requirementVersionId`、`auditEventId` 或 `payloadSha256`。这些字段属于本地可信 Runtime/Domain 事实，由 Adapter 在 semantic response 通过验证后附加为 trusted envelope。

请求必须绑定显式 `projectId + role=REQUIREMENT + chatRef`，并携带 `requestId`、`idempotencyKey`、`semanticSha256`。当前 Chat、latest Chat、页面当前位置都不能作为 fallback。

`RequirementWebGptAdapter` 在提交前验证 Registry 中的显式 BOUND target，在请求完成后只解析 bounded semantic response，并在本地附加 trusted transport envelope；不会自动重试业务请求。协议解析器支持一个调用方提供的 repair candidate，预算固定为最多 1 次；原始响应、修复响应和网页正文不写入 Automation Store。

## 状态边界

```text
WAITING_FOR_USER
        └─ explicit answer / explicit assumption ─> RESOLVED

WAITING_AUTOMATIC_EVIDENCE
        └─ evidence provider result ─> RESOLVED

RESOLVED ── WebGPT READY_FOR_DRAFT ─> DRAFT RequirementVersion
DRAFT ── USER confirmation ─> CONFIRMED / project.activeRequirementVersionId
```

任何不满足合同的 response、target、semantic hash 或状态都 fail-closed。

## Fix 4 initial alignment rule

当 AlignmentSession 尚无已回答问题且尚无本地 Draft 时，Service Prompt 明确要求模型返回 NEEDS_INPUT，不得直接返回 READY_FOR_DRAFT；同一响应应批量提出独立未决问题。AUT-2 synthetic Gate 要求至少三条独立问题，具体覆盖编程语言、非法输入、输出格式、负数规则和自动化测试需求中的未决事实。模型仍只提供 semantic question fields，questionId、roundId 和 session 状态由本地生成。
