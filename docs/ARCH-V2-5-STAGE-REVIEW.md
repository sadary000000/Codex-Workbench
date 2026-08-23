# ARCH-V2-5 Stage Review

## Scope resolution

```yaml
stage: ARCH-V2-5 FIX ROUND 1
official_name: Production Policy Authority / Budget Consumer Closure
base_commit: 49efa07
implementation_commit: 880e3ee
v1_core_changed: NO
aut2_aut3_activated: NO
real_business_prompts: 0
review_package_commit: pending-docs-commit
review_package: dist/review/ARCH-V2-5-FIX-ROUND-1-REVIEW-PACKAGE.zip
package_sha256_sidecar: dist/review/ARCH-V2-5-FIX-ROUND-1-REVIEW-PACKAGE.sha256
```

## Goal and architecture boundary

```text
Action / Command
      -> EffectivePolicy Resolver
          HardConstraints ∩ PolicyVersion ∩ RuntimeCapability
      -> decision + bounded evidence + PolicyPin
      -> CLI/adapter/automation caller (future wiring remains explicit)
```

`Native Thread/Turn/Item`、WebGPT Runtime、Request Manager、AUT requirement/Planner 业务事实
未被替换。ARCH-V2-5 只在 Automation 层增加策略解析、证据和 pin 合约。

## Gate matrix

| Gate | 本地状态 | 证据 |
|---|---|---|
| EffectivePolicy intersection | PASS | `effective-policy.ts` + 7/7 targeted tests |
| HardConstraints cannot be relaxed | PASS | `applyHardConstraintOverride` tests |
| PolicyVersion reuse and typed persistence | PASS | store persistence test + source inventory |
| Policy pinning | PASS | resolver/store mismatch tests |
| Human Gate as policy result | PASS | explicit `REQUIRE_HUMAN_GATE` test |
| Four-kind budget authority | PASS | reservation/commit/release/correlation test |
| Runtime capability intersection | PASS | WAITING/UNSUPPORTED tests |
| Production caller migration | PASS | active WebGPT Prompt/NewChat callers use one persisted authority; paused/legacy paths are classified and fail closed |
| Legacy unpinned mutation | PASS | read/display remains available; Prompt/Repair/Retry/NewChat require an explicit pin |
| Reservation lifecycle | PASS | abort-before-dispatch releases once; committed/unknown outcome is never refunded |
| V1 frozen core | PASS | changed-file scope audit |

## Changes

- Added `src/automation/effective-policy.ts` and exported it from `src/automation/index.ts`.
- Extended existing Automation persistence/schema/store types with typed policy payload and optional policy identity references.
- Added optional Authority injection to Requirement repair adapter without changing the legacy public contract.
- Added `tests/arch-v2-5-policy.test.ts`.

## Verification

```yaml
npm_run_check: PASS
npm_test: 336/337 (one pre-existing review-staging copy failure; source suite 336/336)
arch_v2_5_targeted: PASS (7/7)
isolated_build: PASS
isolated_package: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
arch_v2_2_protocol_regression: PASS
real_protocol_smoke: PASS (WEB-6.6 fixtures, 0 prompts; status subprocess caveat recorded)
real_business_prompts: 0
```

源码测试通过 336/336。npm test 额外发现的唯一失败来自用户已有的
dist-stage-arch-v2-5/review-staging/tests/arch-v2-5-policy.test.ts；该旧 staging
拷贝引用缺失的 review-staging/src/automation/canonical.ts，本轮未删除、覆盖或修复它。

真实 protocol smoke 只执行 webgpt status、版本不匹配 fixture 和不支持 capability
fixture；没有发送真实业务 Prompt。复用已运行 Workbench 的 Control Plane 时，
initialize 两个 fixture 均 PASS；status 子命令仍返回旧标准包启动退出码
2147483651，未被冒充为业务成功，已在 FIX ROUND 1 报告中单独披露。

## Review status

```text
READY_FOR_GPT_REVIEW
```

GPT 需要重点审查：是否在下一阶段授权把现有 AUT/CLI/WebGPT 业务入口全部接入同一个
PolicyBudgetAuthority，以及 legacy unpinned record 的迁移/拒绝策略。本阶段不自行扩大范围。

## FIX ROUND 1 Addendum

The previous foundation review returned FIX_REQUIRED for production caller closure,
production consumer evidence, legacy unpinned fail-closed and reservation lifecycle.
This addendum records the closure implemented in 880e3ee.

- Active production Prompt/NewChat callers now use the stable WebGptPolicyAuthority.
- New Request records persist a read-only acquired PolicyVersion ID before dispatch.
- Historical records with missing policyVersionId stay readable but fail with
  POLICY_PIN_REQUIRED before Prompt/Repair/Retry/NewChat side effects.
- PROMPT, RETRY and NEW_CHAT consumer matrix evidence proves pin, reservation,
  correlation, duplicate rejection and exhaustion blocking.
- Repair reservation commits immediately before irreversible transport dispatch;
  pre-dispatch failure releases exactly once and unknown outcomes are not refunded.
- AUT-2 and AUT-3 remain paused and were not restored.

Current local result is READY_FOR_GPT_REVIEW. Full evidence is in
ARCH-V2-5-FIX-ROUND-1.md and the supporting inventory, lifecycle, regression,
test-summary, subagent and sanitized JSON evidence files.

## FIX ROUND 2 Addendum

GPT's next review returned `FIX_REQUIRED` with P0=0, P1=2 and P2=1. This round
closed the two P1 findings without changing the policy architecture:

- `package.json` now limits `npm test` and `npm run test:unit` to the formal
  `tests/**/*.test.ts` tree. The historical `dist-stage-arch-v2-5/review-staging`
  copy was not removed or modified.
- `src/main/main.ts` now keeps normal packaged startup alive after policy
  initialization. The explicit `AUT2_NORMAL_GUI_STORE_SMOKE=1` branch retains the
  one-shot smoke behavior; it no longer runs on normal startup.
- The WEB-6.6 smoke waits for the packaged descriptor, verifies packaged direct
  `initialize -> webgpt.status`, and verifies the packaged official CLI Runtime
  against the same isolated userData. Both return bounded deterministic JSON.

Final round evidence is in `ARCH-V2-5-FIX-ROUND-2.md` and
`dist-stage-arch-v2-5-fix-round-2/review/WEBGPT-WEB6.6-REAL-GATE.json`.

```yaml
fix_round_2_implementation_commit: 40b79cb
npm_test: 336/336
packaged_status: PASS
official_cli_runtime_status: PASS
new_real_prompts: 0
v1_core_changed: NO
aut2_aut3_activated: NO
gate: READY_FOR_GPT_REVIEW
```
