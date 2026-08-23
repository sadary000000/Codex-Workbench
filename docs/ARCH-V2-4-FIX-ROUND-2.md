# ARCH-V2-4 FIX ROUND 2 — GPT Guided Review-First Loop

## Scope resolution

~~~yaml
stage: ARCH-V2-4 External Action / Resource / Reconciliation Integration
round: FIX ROUND 2
base_commit: d387c999456abce16746db7d8d28b9d2670b2be4
prior_round_commit: a2cdcf1
authorized_fixes:
  - FIX-01 Bridge same-semantic reattach
  - FIX-02 provider observation identity
  - FIX-03 production-equivalent composition
v1_core_changed: NO
webgpt_business_prompts: 0
scope_expanded: NO
gate_posture: REVIEW_READY_WITH_DISCLOSED_REAL_SMOKE_LIMITATION
~~~

本轮严格按 GPT Gate 的 FIX-01～FIX-03 执行。没有进入 ARCH-V2-5、AUT-2/AUT-3、Planner、Workflow、Scheduler 或 WebGPT 业务 Prompt；没有修改旧 donor、Auto_Agent、V1 Frozen Core 或生产 Journal 历史内容。

## FIX-01 — Bridge same-semantic reattach

已在 WebGptExternalActionBridge 中接通现有 readiness classifier 输出的 reattachRequestId。满足以下条件时，Bridge 在创建新的 ActionAttempt 或调用 provider.submit 之前：

1. idempotency key 与 ActionIntent 一致；
2. semanticSha256 一致；
3. project、role、规范化 targetChatUrl 一致；
4. classifier 提供的 WebGPT request record 与持久化 ProviderRequest ExternalRef、ActionAttempt、ResourceClaim 恰好一一对应；
5. 目标不是已有非 UNKNOWN terminal receipt。

随后只调用既有 provider.reconcile，并在同一 Attempt/ProviderRequest 上记录观察结果。缺少或歧义的 correlation 会 fail-closed，不创建替代 Attempt、ProviderRequest 或 ResourceClaim。

Bridge-level test 证明：submitCount=1、reconcileCount=1，重新 dispatch 前后 Attempt 数量和 ProviderRequest ExternalRef 数量不变，最终 receipt 为 RECONCILED。

## FIX-02 — Provider observation identity

recordObservation 现在在创建 Observation ExternalRef、Observation Evidence、Attempt link 或 Receipt 之前校验：

- providerRequestId；
- Provider identity；
- expected/input、ProviderRequest、Observation 三方规范化 targetChatUrl；
- project identity；
- persisted ActionAttempt → ProviderRequest ExternalRef；
- ProviderRequest ExternalRef 的 project/kind/provider/opaqueId。

任一边不一致都抛出 PROVIDER_OBSERVATION_CORRELATION_MISMATCH，不进入 accepted-unknown fallback，不写 terminal receipt，不触发 redispatch。新增 provider-request target mismatch test 覆盖了 provider.submit 返回错误目标的情况。

## FIX-03 — production-equivalent composition

已有真实 composition test 使用：

~~~text
WebGptExternalActionBridge
  -> createWebGptRequestManagerActionAdapter
  -> existing WebGptRequestManager
  -> existing OperationArbiter/live Browser lease
  -> ProviderRequest / ExternalRef / ResourceClaim
~~~

本轮没有把 Workflow/Requirement/Planner caller 激活，也没有发送真实业务 Prompt。caller activation 保持 PAUSED / NOT ACTIVATED；测试只验证适配器、租约字段和身份边界。

## Changed files

本轮产品/测试改动：

- src/automation/webgpt-external-action.ts
- tests/arch-v2-4-external-action.test.ts

已有子代理 B 的独立提交：

- a2cdcf1 fix: fail closed on webgpt observation identity mismatch

本轮主线还包含子代理 A 的 Bridge reattach 与主 Agent 的 target/project/role hardening，以及对应测试。旧 donor 与 Auto_Agent 均未修改。

## Verification

~~~yaml
npm_run_check: PASS
npm_test: PASS (322/322)
arch_v2_2_protocol: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS
scoped_secret_scan: PASS
standard_build: FAIL_WITH_EVIDENCE
standard_build_error: EPERM unlink dist/package/d3dcompiler_47.dll (running Workbench output locked)
isolated_build: PASS
isolated_package: PASS
real_webgpt_prompts: 0
~~~

标准 dist/package 被运行中的 Workbench 输出锁定，未强杀进程；隔离输出为 D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-4-round-2\package。标准 package 不能在锁定期间宣称 provenance PASS。

## Regression posture

- ARCH-V2-1/2/3 的既有 Native/Map/Shared Host/Query-Command-Reconcile 证据继续保留；
- ARCH-V2-2 generated protocol repeatability 本轮重新运行并 PASS；
- 全量 322 tests PASS；
- 本轮不重复运行会发送真实业务 Prompt 的 navigation/map/workspace/multi-thread smoke，避免违反“0 real business prompts”边界；上一轮已记录其 PASS，本轮将其作为历史回归证据，不冒充本轮新鲜 Prompt 证据；
- WebGPT protocol smoke 本轮新运行 0 Prompt：VERSION_MISMATCH 与 CAPABILITY_NOT_SUPPORTED fixtures PASS，但 status 返回 TIMEOUT；
- WebGPT arbiter smoke 本轮新运行 0 Prompt：isolated package 的 open 返回 USER_CONTROL/OPEN_FAILED，未到达后续 control assertions。

## Independent challenge findings

子代理 E 的独立挑战发现以下两点，本轮不属于 FIX-01～03 的授权范围，因此只记录：

1. ResourceClaim 在历史 terminal 路径上的 ACQUIRED 状态可能被误读为 live lease；唯一 live lease truth 仍是 OperationArbiter。没有在本轮重写 ResourceClaim lifecycle。
2. legacy dispatchContext 仍作为 test-only compatibility escape hatch 存在；production caller 应使用 dispatchFacts。没有在本轮删除兼容入口或激活 Automation caller。

## Safety

本轮 realPromptCount=0。审查资料不包含 Cookie、Token、Password、Browser profile、private chat content、full Journal 或 prompt body。真实 smoke 只输出有限错误码、协议版本、计数和哈希，不包含认证值。

## Gate

~~~text
FIX-01: PASS
FIX-02: PASS_WITH_EVIDENCE
FIX-03: PASS_WITH_EVIDENCE
automated_gate: PASS
real_smoke_gate: FAIL_WITH_EVIDENCE
review: READY_FOR_GPT
~~~

按照 review-first 协定，本轮将完整披露上述真实 smoke 限制，生成审查包并提交当前 Architecture Review 对话，等待 GPT 的 PASS/FIX_REQUIRED/BLOCKED 结果；不自行扩大修复范围。
