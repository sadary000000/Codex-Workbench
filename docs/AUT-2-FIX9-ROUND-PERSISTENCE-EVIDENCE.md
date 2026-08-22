# AUT-2 Fix9 — Round Persistence Evidence

## Real Gate

```yaml
result: PASS_REAL_RUNTIME
project: workts
webgptProjectId: 371c3fb8-30ac-4943-9584-1915045ea34d
role: REQUIREMENT
chat: https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a891d7c-abf4-83e8-879a-d477e472576a
responseStatus: NEEDS_INPUT
questionCount: 5
roundSemanticDecision: NEXT_INTERACTION
```

真实响应通过 JSON、Requirement schema 和 semantic validation 后，正式生产链路将其应用到 Automation Store。结果：

| 检查项 | 实际结果 |
|---|---|
| `roundCount` | `2` |
| owning round | `round:b5228b16-ee61-466e-8056-88336f4f3d35` |
| `session.currentRoundId` | 与 owning round 相同 |
| 所有 Question 属于 owning round | `true` |
| `round.questionIds` 精确匹配 Question ids | `true` |
| orphan Question | `0` |
| session status | `WAITING_FOR_USER` |
| 事务回滚自动化测试 | PASS |
| 同语义重放 | PASS |
| 语义冲突 | fail-closed |

这次 Gate 使用既有 canonical Project Chat，未创建替代 Chat；证据文件只保留 bounded identity、数量、状态和哈希，不保存 Prompt/Response 正文、Cookie、Token 或完整聊天内容。

## Automated coverage

`tests/aut2-requirement-service.test.ts` 覆盖：问题所属 Round、精确 questionIds、Session currentRound、跨 Round answer、reconcile idempotency、semantic conflict、事务失败回滚、reopen 后无重复 Round。

## Machine evidence

- [AUT-2-FIX9-REAL-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FIX9-REAL-EVIDENCE.json)
- [AUT-2-FIX9-ROUND-PERSISTENCE-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FIX9-ROUND-PERSISTENCE-EVIDENCE.json)
