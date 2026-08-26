# STAGE-K1-B Reality Check

更新时间：2026-08-26（Asia/Shanghai）

## Scope and entry

本轮只实现 **STAGE-K1-B — Validator & JIT Rules**。K1-A 的 Plan/Stage/Step 持久化基础已存在；本轮不进入 K1-C/K1-D，不接入 GPT Planner/Provider，不执行 Step，不发送真实 Prompt，不创建业务 Chat。

## Existing / reusable

| 能力 | 现状 | K1-B 处理 |
| --- | --- | --- |
| `RequirementVersion.canonicalPayload` + `payloadSha256` | 当前 Requirement 内容真相与指纹已由 K0/K1-A 持有 | KEEP / REUSE；Validator 只比对 exact id/project/status/hash，不复制 raw payload |
| `PlanVersion` / `StageSpec` / `StepSpec` | K1-A 已提供持久化类型、父级引用、版本 lineage 与 JIT additive fields | REUSE；本轮使用独立内存 `PlanCandidate`，不把它当已激活实体 |
| `validatePlannerEnvelope` | 历史 Planner transport contract，已有 allowlist 和初步 JIT 检查 | KEEP / HISTORICAL_RESOLVED；不复制其 transport DTO，不改 Provider path |
| `validateAutomationDocument` | 持久化文档结构/引用检查 | KEEP；不把 persistence validator 与 Candidate semantic validator 混为一谈 |
| snapshot / detached reads | Store 已有纯读基础 | REUSE；新增 Validator 无 Store/Provider 依赖 |
| Plan predecessor / active pointer | K1-A 已有字段与显式选择命令 | REUSE；本轮只验证 transition，不写 pointer、不激活 |

## Add / rework

| 项目 | 决定 |
| --- | --- |
| 独立 `PlanCandidate` 与 `NormalizedPlanCandidate` | ADD；只作为未持久化、未授权的内存候选 |
| 结构、依赖、JIT、Step actionability、Requirement correlation | ADD；唯一 Candidate semantic validator 位于 `src/automation/planner-validator.ts` |
| ambiguity result | ADD；区分 `INVALID`、`PLANNING_NEEDS_REQUIREMENT_INPUT`、`VALID_WITH_ASSUMPTIONS` |
| PlanVersion transition check | ADD；只返回问题，不修改旧版本或 active pointer |
| 历史 `persistPlannerPlan` / WebGPT Planner | HISTORICAL_RESOLVED；本轮不接入、不把旧 lossy promotion 路径冒充 K1-B 证据 |

## Boundary evidence

```yaml
production_code_changed:
  - src/automation/planner-validator.ts
  - src/automation/index.ts
test_code_changed:
  - tests/stage-k1-b-validator-jit.test.ts
provider_calls: 0
real_prompts: 0
new_business_chats: 0
executed_steps: 0
active_pointer_mutations: 0
```

K1-B 的 Validator 不负责持久化、激活、Provider dispatch、Executor 授权或 Review 自动推进。任何 Candidate promotion 必须在未来明确授权的阶段中先调用本纯 Validator，再由独立的显式持久化/激活命令处理。

## Challenge closure

SA3 identified the risk that a future promotion caller could bypass this pure
validator, and also required fail-closed checks for plan identity reuse,
predecessor lineage, vague Stage text, and invalid ambiguity normalization.
K1-B closes the boundary with `requireValidatedPlanCandidate(...)`: it throws
for invalid or requirement-blocked candidates and returns only a detached,
normalized candidate. It still does not persist or activate anything. The
historical `persistPlannerPlan` path remains explicitly out of scope and is
not evidence of K1-B promotion safety.

```yaml
candidate_promotion_bypass: FAIL_CLOSED_GUARD_PRESENT
challenge_findings: CLOSED_WITHIN_K1_B_SCOPE
```
