# ARCH-V2-5 Policy Pinning

Policy pin 包含 `policyVersionId`、`projectId`、`version`、`correlationId`、`pinnedAt`。
`pinCurrentPolicy` 从 project 当前 pointer 读取并生成 pin；`assertPolicyPin` 和
`resolvePinnedEffectivePolicy` 在版本、项目或 ID 不一致时 fail closed。

新建 ActionIntent、ActionAttempt、Checkpoint 保留同一 policy identity；schema 还验证
ActionAttempt 必须与父 ActionIntent pin 一致。旧记录允许缺失字段，仅用于兼容读取，不能
被当作带 pin 的新 in-flight operation。

证据：`src/automation/store.ts:851-898,1152-1192,1269-1297`；`src/automation/schema.ts:687-732`。
