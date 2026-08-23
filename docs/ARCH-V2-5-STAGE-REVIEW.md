# ARCH-V2-5 Stage Review

## Scope resolution

```yaml
stage: ARCH-V2-5
official_name: PolicyVersion Resolver / Hard Constraints / Budget Authority
base_commit: 191557e
implementation_commit: 8660ebc
v1_core_changed: NO
aut2_aut3_activated: NO
real_business_prompts: 0
review_package_commit: pending-docs-commit
review_package: dist/review/ARCH-V2-5-REVIEW-PACKAGE.zip
package_sha256_sidecar: dist/review/ARCH-V2-5-REVIEW-PACKAGE.sha256
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
| Production caller migration | DISCLOSED | not activated; outside this foundation slice |
| V1 frozen core | PASS | changed-file scope audit |

## Changes

- Added `src/automation/effective-policy.ts` and exported it from `src/automation/index.ts`.
- Extended existing Automation persistence/schema/store types with typed policy payload and optional policy identity references.
- Added optional Authority injection to Requirement repair adapter without changing the legacy public contract.
- Added `tests/arch-v2-5-policy.test.ts`.

## Verification

```yaml
npm_run_check: PASS
npm_test: PASS (329/329)
arch_v2_5_targeted: PASS (7/7)
isolated_build: PASS
isolated_package: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
real_protocol_smoke: PASS (WEB-6.6 read-only, 0 prompts)
real_business_prompts: 0
```

真实 protocol smoke 只执行 `webgpt status`、版本不匹配 fixture 和不支持 capability
fixture；没有打开真实业务 Chat、没有发送 prompt、没有写入用户业务 Journal。

## Review status

```text
REVIEW_READY_WITH_DISCLOSED_LIMITATIONS
```

GPT 需要重点审查：是否在下一阶段授权把现有 AUT/CLI/WebGPT 业务入口全部接入同一个
PolicyBudgetAuthority，以及 legacy unpinned record 的迁移/拒绝策略。本阶段不自行扩大范围。
