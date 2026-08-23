# ARCH-V2-8 Stage Review

## Scope resolution

- Stage: ARCH-V2-8 — Capability / Frozen Confirmation / Compatibility Regression / Final Architecture Freeze
- Base/audit HEAD: 17f7c9bd096ec6aad94b8106af2a11157d25ec82
- This stage is confirmation and evidence assembly only.
- Product source code was not intentionally changed by ARCH-V2-8.
- Out of scope: AUT-2/AUT-3/AUT-4+, real business Prompt, new business Chat, WebGPT architecture redesign, V1 core refactor.

## Result

READY_FOR_GPT_FINAL_REVIEW

Do not write FINAL_FROZEN before GPT Gate and explicit user confirmation.

## Capability / compatibility

- Resolver-selected Codex CLI: 0.147.0, binary hash recorded.
- Direct App Server initialize: PASS.
- Schema generation: PASS.
- Observed Desktop App Server: 0.148.0-alpha.9, outside current Workbench verified allowlist 0.147.0; recorded as FAIL_WITH_EVIDENCE.
- Packaged official CLI status: bounded TIMEOUT after 15070 ms; recorded as FAIL_WITH_EVIDENCE.
- Independent final challenge rerun: NOT_READY; P0=1, P1=6, P2=2.

## Frozen contract

Native Thread/Turn/Item remains the sole conversation/message/runtime identity. Workbench persistence is projection/recovery metadata. WebGPT request Journal remains provider-local. Automation uses AutomationStore and provider-neutral ports. No second Conversation or Transcript truth was added.

## Compatibility regression

- npm test: 377/377 PASS.
- ARCH-V2-7 targeted: 30/30 PASS.
- Selected ARCH-V2-1~6: 64/64 PASS.
- Independent grouped audit: 584 assertions reported.
- check/build/package/audit/diff/secret scan: PASS as listed in TEST-SUMMARY.

## Challenge findings requiring GPT decision

Independent B/D/E audits identified a P0/P1 challenge set:

- possible idle zero-cost violation from ordinary startup initialization;
- missing enforcement of version/hash validation in all shared AppServerHost paths;
- Control Plane capability negotiation is not enforced per command;
- implicit diagnostics/startup persistence/migration side effects;
- incomplete candidate fallback and semantic identity preservation checks;
- activeSummary may expose non-live recovery states as active;
- Recovery Intent production side-effect wiring not proven;
- Provider Port/projection rebuild/legacy seam gaps.

These are not silently accepted limitations and no source fix was made in this confirmation stage.

## Subagents

- A — Capability/Protocol: completed, evidence integrated.
- B — Frozen Boundary: completed, challenge findings integrated.
- C — Compatibility Regression: completed, 584-assertion regression evidence integrated.
- D — Persistence/Recovery/Side-effect: completed, P1 evidence integrated.
- E — Independent Final Challenge rerun: completed, adopted; NOT_READY with P0=1, P1=6, P2=2.
- running_subagents_at_gate: 0.

## Safety and provenance

- No real business Prompt.
- No new business Chat.
- No Cookie, Token, browser profile, private ChatGPT content or production database in review package.
- Old donor D:\办公\AI\Codex_Workbench and D:\办公\AI\Auto_Agent remain read-only.
- Existing dirty/untracked workspace baseline is preserved and is disclosed; unrelated files are not cleaned/reset/stashed.

## Gate

READY_FOR_GPT_FINAL_REVIEW
