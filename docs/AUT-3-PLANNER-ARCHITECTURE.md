# AUT-3 Planner + Structured Workflow Architecture

## 状态

```yaml
stage: AUT-3
scope: PLAN ONLY
implementationCommit: 2eb3018
automatedContract: PASS
realPlannerGate: FIX_REQUIRED
nativeExecutor: NOT_STARTED
reviewer: NOT_STARTED
```

## Boundary

```text
CONFIRMED RequirementVersion
        ↓ exact requirement hash binding
PlannerAutomationService
        ↓ exact PLANNER Role / WebGPT Request Manager
PlannerEnvelope v1
        ↓ local contract + policy validation
PlanVersion / StageSpec / StepSpec / StepRuntime
```

AUT-3 不建立第二套 Conversation、Transcript、Task 或 Context truth。Native/WebGPT 仍是外部运行事实；Automation Store 只保存 Requirement、Plan 和受控生命周期投影。Planner 只产生 `PLANNER_STEP` 语义，系统侧未来才可生成 VERIFY/CHECKPOINT/HUMAN_GATE 等 system steps；本阶段没有 Executor、Reviewer 或 Workflow execution。

## Persistence boundary

- RequirementVersion 必须是 active `CONFIRMED`，并以 canonical payload hash 精确绑定。
- PlanVersion immutable；显式 replan 才 supersede 旧版本。
- Planner request identity/idempotency 属于受信任 Runtime metadata，不由模型生成。
- `AUT3_AUTOMATION_PROJECT_ID` 与 `AUT3_WEBGPT_PROJECT_ID` 明确分离，避免将 Automation Project 当成网页 Project。
