# AUT-2 Fix9 — Requirement Round Identity Contract

## 结论

```yaml
stage: AUT-2 Fix9
roundSemanticDecision: NEXT_INTERACTION
storeInvariantRetained: YES
automatedGate: PASS
realGate: PASS_REAL_RUNTIME
implementationCommit: 2eb3018
```

## 语义决策

本项目选择 `NEXT_INTERACTION`。依据是现有 `RequirementAlignmentSession.currentRoundId`、等待用户回答的生命周期、答案按 `questionId` 提交的 API，以及已有 Store 的 round/question 交叉边界校验：一个等待用户回答的交互必须成为可恢复的当前 Round，下一次模型交互才可以在该 Round 完成后创建。

因此，`NEEDS_INPUT` 的原子顺序是：

```text
current response accepted
→ create next interaction Round
→ create Questions with nextRound.id
→ nextRound.questionIds = exactly those Question ids
→ session.currentRoundId = nextRound.id
→ session.status = WAITING_USER_INPUT
→ append bounded audit event
```

问题不会挂到旧 Round，也不会先挂到一个尚未拥有问题的未来 Round。用户答案继续提交到这些问题所属的当前交互 Round；全部 blocking 问题解决后，Round 才进入 `ANSWERED/COMPLETED` 生命周期。

## 不变量

- `q.roundId === round.id` 对 `round.questionIds` 中每一个问题成立。
- `WAITING_USER_INPUT.currentRoundId` 等于未解决 blocking questions 的 owning Round。
- 跨 Round `questionId` 引用和跨 Round answer 均 fail-closed。
- 同 request identity + 同 semantic result 重放只返回既有 Round/Questions，不重复创建。
- 同 identity + 不同 semantic result 返回 Automation conflict。
- transaction 中任意一步失败时，Round、Question、questionIds、Session 和 Audit 一起回滚。
- 不增加 migration，不放宽 Store invariant，不改 Native Thread/WebGPT V1 事实源。

## 变更边界

Fix9 改动集中在 Requirement service/store/schema/types 与真实 Gate 证据路径；AUT-3 Planner 另在同一实现提交中作为 AUT-2 通过后的受控条件阶段加入。没有修改旧 donor，也没有把 Workbench Conversation/Transcript 变成第二事实源。
