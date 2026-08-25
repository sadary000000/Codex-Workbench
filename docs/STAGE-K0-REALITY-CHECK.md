# STAGE-K0 Reality Check — Re-authorized Mainline

Date: `2026-08-26` (Asia/Shanghai)

## Scope state

```yaml
historical_k0: HOLD / EXPERIMENTAL IMPLEMENTATION
current_k0: REAUTHORIZED_MAINLINE_VALIDATED_PENDING_GPT
hold_reuse_audit: PASS_WITH_CONTROLLED_REUSE
automation_schema_version: 4
real_business_prompts: 0
new_business_chats: 0
```

The historical K0 implementation is retained for audit and reuse decisions. It
is not treated as a completed Gate. Only the explicit current Stage-K0
authorization defines the current implementation scope.

## Current foundation boundaries

```yaml
domain_ownership: IMPLEMENTED
persistence_boundary: IMPLEMENTED
action_recovery_contract: IMPLEMENTED
provider_neutral_boundary: IMPLEMENTED
targeted_tests: 74/74 PASS
  full_node_tests: 443/443 PASS
  audit: 0 vulnerabilities
  diff_check: PASS
  typecheck: PASS_WITH_DONOR_DEPENDENCY
  equivalent_build: PASS_WITH_DONOR_TYPESCRIPT
  exact_build_package: ENVIRONMENT_BLOCKED
k0_challenge: PASS_WITH_FIVE_FIXES
gpt_gate: PENDING
```

## Closed risks

- Every new RequirementVersion receives explicit bounded origin provenance and
  an immediate predecessor when applicable.
- Active Requirement pointers cannot point to DRAFT or SUPERSEDED versions.
- USER confirmation supersedes the prior active version and synchronizes the
  associated alignment Session/Round.
- Project-scoped PolicyVersion and provider correlation are required.
- Accepted provider identity mismatch or local persistence failure becomes
  durable UNKNOWN / RECOVERY_REQUIRED; no blind resend is permitted.
- SQLite row identity and project identity are checked at load time.
- Requirement alignment ActionIntent payloads accept only the opaque
  `automation-input-v1:<sha256>` shape.
- Legacy production Bridge execution is paused; the provider-neutral Port is
  the only live composition path.
- Accepted provider UNKNOWN recording is atomic and optional evidence/lease
  writes cannot reopen a duplicate-send window.
- Raw legacy migration collections are explicitly mapped or rejected; the
  raw-source mapping delta is persisted as bounded migration metadata.
- Fresh side-effect intents cannot pin an old PolicyVersion after a project
  policy advance.

## Boundary protection

No K0 implementation is allowed to modify Native Thread/Turn/Item truth, the
Workbench UI, Submission Runner, browser profiles, cookies, tokens, or user
chat content. No real business Prompt or new Chat was used.

Final Gate remains open until the review package is built and the fixed
Submission Runner returns explicit Gate and Status. Exact local build/package
commands remain environment-blocked because this checkout's project
`node_modules` is empty; equivalent donor typecheck/build output is recorded.
