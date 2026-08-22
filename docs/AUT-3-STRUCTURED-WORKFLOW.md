# AUT-3 Structured Workflow Implementation

## 已实现

- `planner-contract.ts`：bounded discriminated union、JIT shape、typed verifier、schema error。
- `planner-service.ts`：exact confirmed Requirement binding、JIT request、idempotent replay、explicit replan、stale detection。
- `planner-webgpt-adapter.ts`：exact PLANNER Role、Request Manager transport、完成态检查、response envelope validation。
- `store.ts` / `schema.ts` / `types.ts`：immutable PlanVersion、Requirement hash binding、StageSpec、current Stage StepSpec/StepRuntime 原子持久化。
- `aut3-real-planner-gate.ts`：只做真实 Gate 证据，不启动 Executor/Reviewer。

## Automated Gate

`tests/aut3-planner.test.ts`：3/3 PASS，覆盖：

1. READY / NEEDS_REQUIREMENT_CHANGE / BLOCKED 与 JIT/typed verifier 形状；
2. 原子 Plan persistence、immutable version 和 idempotent replay；
3. explicit replan supersede 与 Requirement change stale detection。

## Real Gate limitation

精确 PLANNER binding、Requirement confirmed fixture、角色保护和 WebGPT project boundary 均通过；但最新隔离 Request Journal 真实请求仍为 `RECOVERY_REQUIRED`，所以当前没有真实 Planner response 可验证 structured plan。不得以自动化 fixture 代替真实 Planner Gate。
