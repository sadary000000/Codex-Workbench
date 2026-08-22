# AUT-2 Final Requirement Closure — Real Evidence

## 结论

```yaml
stage: AUT-2 Final Requirement Closure
result: PASS_CANDIDATE
roundPersistence: PASS_REAL_RUNTIME
answersToDraft: PASS_REAL
explicitUserConfirmation: PASS_REAL_RUNTIME
gptSelfConfirmation: BLOCKED
```

## Scope / identity

```yaml
project: workts
projectId: 371c3fb8-30ac-4943-9584-1915045ea34d
role: REQUIREMENT
originalBindingRestored: true
newChats: 0
```

Fix9 真实 Gate 后，通过正式 answer API 提交五个已持久化问题的 synthetic answers：Python、invalid input 使用 stderr/non-zero、`SUM=<integer>`、允许负数、要求 automated tests。答案关闭 owning Round，未产生跨 Round 引用。

## Answers → Draft

| 检查项 | 结果 |
|---|---|
| real business prompt | `1`，无 repair |
| final alignment status | `READY_FOR_DRAFT` |
| RequirementVersion | `DRAFT` |
| canonicalPayload | present |
| payloadSha256 | `3b92cbc83427152818da74964b03fe417efbb10a08f291ea66cd2de932368def` |
| active version after Draft | 与 Draft version 相同 |
| GPT self-confirmation | `NOT_REQUESTED` |

## Explicit USER confirmation

调用正式 `confirmRequirement(..., actor=USER)` 后：

- `DRAFT → CONFIRMED`；
- `AutomationProject.activeRequirementVersionId` 指向 confirmed version；
- `WEBGPT` actor 被拒绝；
- `SYSTEM` actor 被拒绝；
- REQUIREMENT binding 恢复原 Chat，PLANNER/REVIEWER 未改变。

## Budget and safety

累计真实网页 Prompt：`12/12` hard maximum；repair：`3/3`，本轮新增 repair `0`；新 Chat：`2/3`，本轮新增 `0`。达到 hard maximum 后不再发送 AUT-2 Prompt。

原始 Prompt/Response 正文未写入证据；只记录 request identity、状态、长度/哈希和 bounded schema 摘要。V1 Core 与 WebGPT V1 未修改。

机器证据：[AUT-2-FIX9-ANSWERS-DRAFT-REAL-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FIX9-ANSWERS-DRAFT-REAL-EVIDENCE.json)
