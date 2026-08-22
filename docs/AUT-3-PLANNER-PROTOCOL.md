# AUT-3 Planner Protocol v1

## Envelope

唯一 envelope：

```json
{
  "plannerProtocolVersion": 1,
  "status": "READY",
  "payload": {
    "stages": [],
    "currentStage": {}
  }
}
```

允许状态只有：`READY`、`NEEDS_REQUIREMENT_CHANGE`、`BLOCKED`。字段、长度、数组数量、stage/step identity 和当前阶段形状均 bounded；无效 JSON、额外顶层键、未知状态或 schema drift fail-closed。

## JIT / typed verifier rules

- 至少两个 Stage；未来 Stage 只允许 summary。
- 恰好一个 current Stage 为 detailed；current Stage 至少两个步骤。
- Planner 只生成 `PLANNER_STEP` 语义。
- `verificationClass` 只能是 `BUILD`、`TEST`、`GIT_DIFF`、`GIT_STATUS`、`FILE_EXISTS`、`HASH_MATCH`、`JSON_SCHEMA`、`CLI_SMOKE`、`HARDWARE_SMOKE`、`CUSTOM_APPROVED`。
- 任意 shell-like verifier 被拒绝；`CUSTOM_APPROVED` 必须带非空 human gate。
- Planner 不得修改 Requirement/Policy；需要变化时返回 `NEEDS_REQUIREMENT_CHANGE`。

## Transport separation

`requestId`、`idempotencyKey`、semantic hash、PlanVersionId、StageSpecId、StepSpecId 由 Workbench/Runtime 生成并校验，不进入模型可信输出字段，也不从模型响应中接受伪造 identity。
