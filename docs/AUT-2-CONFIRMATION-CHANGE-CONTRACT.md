# AUT-2 Confirmation / Change Request Contract

## 用户确认

- 只有 `actor=USER` 可以确认 RequirementVersion。
- 确认时必须提交用户看到的 `expectedPayloadSha256`。
- hash 不一致返回 `STALE_CONFIRMATION`，不改变 active version。
- 已确认版本的 canonical payload、版本号、创建时间和 supersedes 关系不可变。
- 重复确认同一个已经 active 的版本是幂等读取，不会创建第二版本。

## Change Request

Change Request 保存：

```yaml
changeRequestId
projectId
baseRequirementVersionId
requestedChange
reason
sourceActor
status
basePayloadSha256
candidatePayloadSha256
candidateRequirementVersionId
impactAnalysis
```

Change 分析使用排序后的 deterministic semantic diff，输出 affected sections、acceptance/risk/dependency impact 和 `replanLevel`。候选 RequirementVersion 是新的 immutable draft；旧版本仍保留，确认时变为 `SUPERSEDED`，候选版本变为 `CONFIRMED` 并成为 active。任何候选 hash 过期、Actor 非 USER 或状态不符均拒绝。

## 证据

`tests/aut2-change-request.test.ts` 覆盖 no-op、对象键顺序、hash、敏感键、候选 diff 和审计 proof；`tests/aut2-requirement-service.test.ts` 覆盖用户确认、stale hash、旧版本 supersede 与 active version 收敛。
