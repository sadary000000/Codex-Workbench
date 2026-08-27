# STAGE-K1-D FIX ROUND 1 Source Evidence Index

The package lists only the bounded implementation and evidence surfaces for
this fix round. Raw requirement/prompt/assistant content is intentionally not
included.

| Path | Role | Evidence |
| --- | --- | --- |
| `src/features/webgpt/runtime/webgpt-workspace.ts` | navigation revision, page-probe timeout, target identity quiet window | workspace/request-manager tests |
| `src/features/webgpt/runtime/webgpt-request-manager.ts` | pre-dispatch state, bounded lease/deadline, no-send recovery | request-manager tests |
| `src/features/webgpt/runtime/webgpt-role-session-service.ts` | bound target identity assertion | role-session tests |
| `src/features/webgpt/automation/webgpt-provider-port.ts` | dispatch admission and `NOT_DISPATCHED` mapping | provider boundary tests |
| `src/automation/planner-provider-contract.ts` | provider-neutral Planner contract | K1-C/K1-D tests |
| `src/automation/planner-provider-integration.ts` | production Planner composition | K1-C/K1-D tests |
| `src/automation/stage-k1-d-real-planner-smoke.ts` | bounded real-smoke evidence writer | sanitized evidence JSON |
| `scripts/stage-k1-d-real-planner-smoke.ts` | packaged smoke entry point | build/package result |
| `tests/webgpt-request-manager.test.ts` | request/recovery identity coverage | 473-test run |
| `tests/arch-v2-6-provider-boundary.test.ts` | provider acceptance/no-send coverage | 473-test run |
| `tests/stage-k1-c-planner-provider.test.ts` | known pre-dispatch Planner failure | 473-test run |
| `tests/stage-k1-d-real-planner-smoke.test.ts` | K1-D smoke contract coverage | 473-test run |
| `docs/STAGE-K1-D-REAL-PLANNER-EVIDENCE.json` | latest sanitized smoke evidence | no raw content |

The shared worktree contains earlier user-owned files and artifacts. They were
not copied wholesale into this package and were not cleaned or reset.

