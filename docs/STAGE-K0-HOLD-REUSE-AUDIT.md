# STAGE-K0 HOLD Reuse Audit

Date: `2026-08-26` (Asia/Shanghai)
Stage: `STAGE-K0 — Automation Foundation`
Entry: `AUT-R0 PASS / CLOSED; Scope Recovery RESTORED`

## Audit boundary

The prior K0 implementation is retained as `HOLD_NOT_MAINLINE` at
`ece5363ddb13272678f25ad7f72e0e9c09ebcd45`. This audit compares the actual
AUT-R0 mainline at `fad58d95b3a6b7925e8e9c66e4bda636b6981005` (implementation
content equivalent to `392b4f7`) with that retained commit. No production
file was changed before this audit was recorded.

The reuse decision is file/hunk scoped. It is not a blanket restoration of the
HOLD commit and does not authorize Planner, Executor, Scheduler, Verifier,
Review/Gate workflow, or Submission Runner work.

## Decision matrix

| concern | decision | current evidence | compatibility / required action |
|---|---|---|---|
| `RequirementOrigin` | `REUSE` | Mainline `src/automation/types.ts` is schema v3 and has no first-class origin collection; the HOLD adds bounded origin identity/type/source metadata. | Reuse the bounded model and same-project/originRef validation. Do not persist raw prompt, URL, DOM, cookie, token, or session state. |
| `RequirementVersion` chain | `REUSE` | Mainline already owns immutable RequirementVersion payload/hash and active selection, but lacks the complete predecessor/origin closure. | Reuse HOLD predecessor, duplicate-root, cross-project, and immutable-field checks; re-run against current Requirement alignment files. |
| Automation schema changes | `REWORK` | Mainline schema is v3; HOLD introduces v4. Current dirty AUT-2 tests and domain files must remain intact. | Reapply the v4 delta as a controlled patch and validate compatibility with current uncommitted AUT-2 files; no unrelated schema redesign. |
| SQLite migration | `REUSE` | Mainline has explicit SQLite persistence and migration entry points; HOLD adds v3→v4 row materialization and metadata validation. | Reuse transaction/backup/promote behavior and preserve the real production path boundary. |
| JSON migration | `REUSE` | Mainline has JSON migration/inspection paths. | Reuse source validation, side-by-side candidate, identity verification, backup, promotion, and fail-closed rollback. |
| rollback semantics | `REUSE` | Mainline already has candidate/backup boundaries; HOLD adds rollback evidence for partial promotion and interrupted migration. | Reuse only with current path and writer-authority checks; never promote a partial candidate. |
| identity comparison | `REUSE` | Mainline has canonical/stable identity helpers. | Extend the canonical comparison to origin/version/payload and migration metadata without creating a second truth. |
| `PolicyVersion` scope/pinning | `REUSE` | Mainline has policy authority, effective-policy intersection, and provider admission. | Reuse project scope and exact pin checks; no latest-policy fallback. |
| accepted-side-effect correlation | `REUSE` | AUT-R0 already persists ActionAttempt/Provider correlation and requires recovery for uncertain acceptance. | Reuse durable idempotency reattachment and correlation validation; no new dispatch path. |
| reconcile boundary | `REUSE` | Mainline has explicit provider reconcile seams and fail-closed control-plane validation. | Reuse reconcile-only recovery and keep generic reconcile from bypassing the Automation ledger. |
| provider-neutral boundary | `REUSE` | `src/automation/adapters.ts` is a neutral port; the WebGPT implementation is an injected adapter seam. | Keep `src/automation/**` free of direct concrete WebGPT imports. Revalidate the production import inventory. |
| existing K0 tests | `REWORK` | HOLD tests cover the intended invariants, but their assertions and fixtures were authored against the HOLD tree. | Port/re-run only targeted tests that remain in K0 scope; do not weaken assertions or delete failures. |
| K0 documentation/evidence | `REWORK` | Existing K0 docs say `PASS / FROZEN` while the implementation was previously HOLD. | Rewrite current-stage docs with actual source evidence, commit, timestamps, package hash, and explicit Gate/Status. |
| Planner/Executor/Scheduler/Verifier/Review workflow | `DROP` | These are explicitly out of scope and are not foundation ownership. | Preserve any existing files as user work; do not include them in K0 implementation changes. |
| browser/session/transcript state | `DROP` | Frozen contract assigns WebGPT/browser state to the WebGPT boundary and Native transcript to Codex Runtime Truth. | Do not promote transient state or duplicate conversation/transcript truth into Automation persistence. |

## Reuse method

The accepted implementation path is controlled file-level reuse of the audited
HOLD hunks, followed by targeted and full validation. A blanket cherry-pick of
`ece5363` is not used because the current worktree contains preserved,
uncommitted AUT-2/AUT-3/WebGPT files that must not be overwritten or staged.

## Gate for moving beyond the audit

Production edits are allowed only for the four K0 contracts: domain ownership,
persistence boundary, action/recovery contract, and provider-neutral boundary.
The first implementation pass must retain AUT-R0 no-blind-resend behavior,
Native Runtime Truth, and the zero-real-business-Prompt default.
