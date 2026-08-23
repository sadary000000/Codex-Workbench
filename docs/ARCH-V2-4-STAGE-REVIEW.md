# ARCH-V2-4 — FIX ROUND 1 Stage Review

> **Current authoritative addendum:** FIX ROUND 2 is recorded in `ARCH-V2-4-FIX-ROUND-2.md`. The Round 1 record below is retained as historical provenance; do not read its old FIX-05/Provider-identity gap as the current implementation state.

## Scope resolution

```yaml
stage: ARCH-V2-4 External Action / Resource / Reconciliation Integration
previous_gate: FIX_REQUIRED (P0=3, P1=3, P2=1, BLOCKER=0)
base_commit: da9c7b9
implementation_commit: d304e70 plus uncommitted FIX ROUND 1 overlay
v1_core_changed: NO
real_webgpt_prompts: 0
scope_expanded: NO
```

本轮只执行上一轮 GPT 明确授权的 FIX-01～FIX-08。没有进入 ARCH-V2-5、AUT-2/AUT-3 或其它自动化产品层；没有修改旧 donor、`Auto_Agent` 或生产 Journal 的历史内容。

## Required Fix matrix

| Fix | 结果 | 证据/限制 |
|---|---|---|
| FIX-01 | PASS | `automationControl()` 不再调用 `reconcilePending(all)`；历史 reconcile 仍是显式路径；FIX-01/FIX-07 测试通过。 |
| FIX-02 | PASS_WITH_EVIDENCE | 第二次真实安全 smoke：`USER_CONTROL → control auto`、并发 Project Open、0 Prompt、Journal before/after unchanged；第一次 smoke 的旧断言和 SHA 变化保留披露。 |
| FIX-03 | PASS | production RequestManager adapter 的真实 composition 将 Arbiter `operationId/leaseRef/leaseEpoch/ownerKey` 映射到 ProviderRequest、ExternalRef、ResourceClaim；integration test 通过。 |
| FIX-04 | PASS | provider accepted 后一次性本地持久化故障进入 `UNKNOWN/RECOVERY_REQUIRED`；显式 reconcile 不再 submit；submit count 保持 1。 |
| FIX-05 | FAIL_WITH_EVIDENCE | `buildWebGptDispatchContext()` 已从现有 readiness classifier、live resource、target/runtime facts 派生，15 条无关历史和四类 blocker 测试通过；但审计发现 readiness 的 `reattachRequestId` 未贯穿 Bridge，缺少“Attempt 不增加”的 Bridge 级证据。未自行扩大修复。 |
| FIX-06 | PASS | 普通 terminal observe 为 `NOT_REQUIRED`；只有 explicit reconcile 的 terminal observe 为 `RECONCILED`。 |
| FIX-07 | PASS_WITH_EVIDENCE | 当前生产 Journal 作为 post-incident baseline；第二次 safe control smoke SHA 不变；没有 rollback、删除、terminalize 或猜测恢复。 |
| FIX-08 | FAIL_WITH_EVIDENCE | `check`、317 tests、audit、diff、secret scan 和 ARCH-V2-1/2/3 real regressions 通过；标准 `dist/package` 因运行中的 EXE 锁定而未能更新，隔离 `dist-stage-arch-v2-4` build/package 通过。 |

## Architecture boundary

```text
V1 Frozen Core
  Native Thread / Turn / Item truth
        |
        +-- WebGPT RequestManager / Request Journal / OperationArbiter
        |
        +-- Automation ActionIntent / ActionAttempt / ActionReceipt
              ExternalRef / Evidence / ResourceClaim
```

`OperationArbiter` 是唯一 live Browser lease truth；`ResourceClaim` 仅保存 workflow claim 与 lease correlation；ProviderRequest/Observation 不等于 Receipt；历史 Journal 不等于 live lease；Provider Observation 不写 Workflow/Requirement/Planner PASS。

## Automated and real evidence

```yaml
npm_run_check: PASS
npm_test: PASS (317/317)
npm_run_build: STANDARD_OUTPUT_BLOCKED_BY_RUNNING_EXE
npm_run_package_win: STANDARD_OUTPUT_BLOCKED_BY_RUNNING_EXE
isolated_build: PASS (dist-stage-arch-v2-4)
isolated_package: PASS (dist-stage-arch-v2-4/package)
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS (only CRLF normalization warnings)
scoped_secret_scan: PASS
real_control_auto: PASS_WITH_EVIDENCE
arch_v2_1_2_3_regression: PASS (navigation/workspace/multi-thread/shared-host/map/project-map/protocol)
real_prompt_count: 0
```

标准 package 失败是明确的文件锁错误：`EPERM unlink dist/package/Codex Workbench V1.exe`；没有强杀 Workbench 进程，没有删除用户文件。

## Subagents

本轮 A～E 及前置旧五个代理均收到继续工作的非中断消息；完成后逐一审核并关闭，Gate 时 `running_subagents=0`。

| 角色 | 代理 | 结果 | 处理 |
|---|---|---|---|
| A FIX-01/02 | Dalton | control/reconcile 分离、真实 control smoke 证据 | 采用，已关闭 |
| B FIX-03 | Ampere | production live lease correlation integration | 采用，已关闭 |
| C FIX-04/06 | Meitner | accepted/local-failure 与 reconcileState | 采用，已关闭 |
| D 独立 FIX-05 audit | Huygens | classifier/blocker matrix PASS；Bridge reattach evidence PARTIAL | 采用为 FAIL_WITH_EVIDENCE，已关闭 |
| E 独立 FIX-07/08 audit | Herschel | Journal safe smoke PASS；package/provenance PARTIAL | 采用，已关闭 |
| 旧五个 | Ohm/Fermat/Godel/Newton/Nietzsche | 自然返回只读审计；发现的未授权扩展风险已列入 out-of-scope | 审核后已关闭 |

## Disclosed findings

旧代理与本轮独立审计还发现：Bridge 级 same-semantic reattach、Provider observation identity 校验、ResourceClaim release/liveness 以及完整 production caller wiring 仍需 GPT 决定是否授权下一轮。它们没有在本轮被自行修复，详见 `ARCH-V2-4-OUT-OF-SCOPE-FINDINGS.md`。

## Gate

```text
REVIEW_READY_WITH_DISCLOSED_FAILS
```

无论存在上述 FAIL_WITH_EVIDENCE，本轮均按指令生成脱敏 Review Package，提交当前网页 GPT 并等待新的 Gate；不自行进入下一阶段。
