# ARCH-V2-8 Deferred Debt — Final Reconciled Set

```yaml
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
technicalGate: FAIL_WITH_EVIDENCE
finalFrozen: false
P0: 0
P1: 5
P2: 3
```

当前只保留三项已证实、非阻塞、对冻结契约无影响的 P2：

| id | debt | severity | blocking | frozen_contract_impact |
|---|---|---|---|---|
| P2-01 | 无完整 user-facing production projection rebuild command | P2 | false | NONE |
| P2-02 | 无 user-facing migration command | P2 | false | NONE |
| P2-03 | legacy URL-shaped seam 仅保留 `TEST_ONLY / LEGACY_READ_ONLY` | P2 | false | NONE |

## Boundary

以上三项均不阻塞，但当前 `technicalGate=FAIL_WITH_EVIDENCE` 的原因是 5 个独立 P1；P2 不等于已经实现，也不允许改变 Native Thread、Native Turn/Item、App Server Runtime 或 V1 Frozen Core 的唯一事实边界。

多账号/session、Planner、Reviewer、Workflow/Scheduler 等属于后续 Automation 范围，本阶段不实现、不计入当前 P2 数量，也不提前声明能力。

## Current count

```yaml
P0: 0
P1: 5
P2: 3
finalFrozen: false
```
