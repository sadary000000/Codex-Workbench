# ARCH-V2-4 FIX ROUND 2 — GPT Review Request

请审查本轮 FIX-01～FIX-03 的实现与真实证据。当前没有自行扩大范围。

## Result posture

~~~yaml
stage: ARCH-V2-4 External Action / Resource / Reconciliation Integration
round: FIX ROUND 2
automated_gate: PASS
fix_01_bridge_reattach: PASS
fix_02_provider_observation_identity: PASS_WITH_EVIDENCE
fix_03_production_equivalent_composition: PASS_WITH_EVIDENCE
real_smoke: FAIL_WITH_EVIDENCE
real_business_prompts: 0
v1_core_changed: NO
~~~

## Questions

1. FIX-01 是否真正复用了原有 ActionAttempt、ProviderRequest ExternalRef 和 ResourceClaim，且同 semantic/idempotency 不会新建 Attempt 或二次 submit？
2. FIX-02 是否在 Observation/Receipt mutation 前覆盖 requestId、Provider、target、project、Attempt/ExternalRef identity，并在错误时 fail-closed？
3. FIX-03 的 Bridge、RequestManager adapter、OperationArbiter、ProviderRequest/ExternalRef/ResourceClaim 是否构成 production-equivalent composition，而没有新增 Provider model 或激活 Automation caller？
4. 本轮 real smoke 的 status TIMEOUT 与 OPEN_FAILED/USER_CONTROL 是否属于环境/既有 WebGPT control limitation，还是本阶段必须继续修复？
5. E 的 ResourceClaim lifecycle 与 legacy dispatchContext findings 是否应另发 Required Fix，还是记录为 out-of-scope？

## Required gate response

~~~text
Gate:
PASS | FIX_REQUIRED | BLOCKED

P0/P1/P2:
...

Required Fixes:
仅 ARCH-V2-4 当前范围内；不要默认 Codex 已自行修复未授权问题。

Architecture decision:
若 PASS，给出下一阶段唯一完整指令；若 FIX_REQUIRED，给最小修复；只有确需用户权限/决策时才 BLOCKED。
~~~

## Evidence index

See:
- ARCH-V2-4-FIX-ROUND-2.md
- ARCH-V2-4-BRIDGE-REATTACH-EVIDENCE.md
- ARCH-V2-4-PROVIDER-IDENTITY-EVIDENCE.md
- ARCH-V2-4-PRODUCTION-COMPOSITION-EVIDENCE.md
- ARCH-V2-4-ROUND-2-REAL-SMOKE.json
- ARCH-V2-4-ROUND-2-TEST-SUMMARY.json
- ARCH-V2-4-SUBAGENT-SUMMARIES.md
