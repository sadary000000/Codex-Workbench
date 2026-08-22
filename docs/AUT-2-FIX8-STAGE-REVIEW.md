# AUT-2 Fix8 Stage Review

```yaml
stage: AUT-2 Fix8 Requirement Schema Mismatch Forensics
base_commit: 712167e3a862290763b3ce806c30a31b97fdbef1
implementation_commit: 24a18e8
result: FIX_REQUIRED
exact_mismatch: $.payload.questions[0].resolutionMode
schema_rule: enum
received_value: SINGLE_SELECT
root_cause: PROMPT_CONTRACT / PROMPT_SCHEMA_DRIFT
detailed_category: MODEL_ENUM_DRIFT
minimal_fix: explicit enum list in shared Prompt; strict validator retained
repair_budget_increased: NO
new_repair_prompts: 0
new_real_business_prompts: 1
new_chats: 0
real_first_round: FAIL
first_round_status: FAIL
aut3_started: NO
review_package_sha256: reported at handoff; not embedded to avoid a self-referential archive hash
```

## Scope

In scope: forensic read of the existing bad response, sanitized field-level diagnostics, shared Prompt contract clarification, unit/contract tests, one bounded real first-round verification, and review evidence.

Out of scope: schema widening, identity recovery, Role redesign, new Chat/setup, repair retry, answer/draft closure, AUT-3, and unrelated Automation persistence fixes.

## Changes

- `src/automation/requirement-webgpt-contract.ts`
  - added bounded response shape and field-level validation issue diagnostics;
  - explicitly enumerated `resolutionMode` values in the shared Prompt;
  - retained strict schema validation.
- `src/automation/aut2-real-webgpt-gate.ts`
  - added first-round-only mode with one real Prompt and zero repair budget.
- `src/main/main.ts`
  - wires the bounded Fix8 first-round mode through the production Gate path.
- `scripts/aut2-real-webgpt-gate.ts`
  - requires existing Chat reuse in Fix8 mode and refuses new Chat fallback;
  - preserves cumulative budget accounting.
- `tests/aut2-requirement-webgpt-contract.test.ts`
  - validates enum, required/unexpected/type diagnostics and sanitized shape.
- `tests/aut2-requirement-service.test.ts`
  - verifies the shared Prompt contains the exact enum contract and UI-label prohibition.

## Historical and current evidence

The historical original and repair both had the same top-level envelope and schema-failure category. The historical original nested shape was not available, so no unproved nested diff is claimed. The zero-Prompt read of the repair response proved the exact enum mismatch. The Fix8 real first round then passed the same validator.

## Independent blocker

The valid Fix8 `NEEDS_INPUT` response exposed an existing persistence defect: the service creates question records with the current round ID while attaching them to a newly created next round. The store correctly rejects the cross-round reference. This is recorded only; it is not fixed in Fix8 because it is outside the schema-mismatch minimal-fix boundary.

## Regression and safety

- V1 Frozen Core: not intentionally changed.
- No Cookies/Tokens/private transcript stored.
- REQUIREMENT binding restored to the original Chat.
- PLANNER/REVIEWER unchanged.
- AUT-3 not started.

## Automated Gate

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS, 286/286 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS, only existing line-ending warnings |
| scoped high-confidence secret scan | PASS |
| JSON evidence parse | PASS |

## Real smoke

The packaged CLI/GUI path reused the existing canonical Chat and completed exactly one business Prompt. It produced a valid `NEEDS_INPUT` response with five questions and no repair. The production persistence step then failed closed on `AUTOMATION_SCHEMA_INVALID`; no second Prompt was attempted.

## Gate

`FIX_REQUIRED`: the schema mismatch is fixed and verified by one real response, but the production first-round path remains blocked by the independent round-boundary persistence defect.
