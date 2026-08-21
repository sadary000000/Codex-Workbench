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

## WebGPT envelope

WebGPT Requirement role 只允许三个机器状态：

- `NEEDS_INPUT`：带 bounded `missingInputs`。
- `READY_FOR_DRAFT`：带 bounded draft。
- `BLOCKED`：带 bounded reason/code/retryable。

请求必须绑定显式 `projectId + role=REQUIREMENT + chatRef`，并携带 `requestId`、`idempotencyKey`、`semanticSha256`。当前 Chat、latest Chat、页面当前位置都不能作为 fallback。

`RequirementWebGptAdapter` 在提交前验证 Registry 中的显式 BOUND target，在请求完成后只解析 bounded response；不会自动重试。协议解析器支持一个调用方提供的 repair candidate，预算固定为最多 1 次；原始响应、修复响应和网页正文不写入 Automation Store。

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
