# STAGE-K0 Provider-neutral Boundary

Status: `IMPLEMENTED / VALIDATION IN PROGRESS`

## Boundary

Automation Core depends on neutral contracts in `src/automation/adapters.ts`.
The verified WebGPT implementation is injected through the provider port and
composition root. Automation does not own browser objects, Chat URLs, DOM
selectors, or session state.

```text
Automation Provider Port
        ↓ injected adapter
WebGPT runtime / browser boundary
```

The production Automation tree has no direct concrete WebGPT imports. Generic
reconcile remains fail-closed; the formal Requirement provider path carries
the ActionAttempt/provider correlation and uses explicit reconcile.

## Policy and capability

Provider admission requires the exact project-scoped PolicyVersion pin,
effective-policy intersection, and available runtime capability. Missing or
drifting authority fails closed before input resolution or browser mutation.

## Evidence

- `src/automation/adapters.ts`
- `src/automation/provider-seam-classification.ts`
- `src/automation/webgpt-policy-authority.ts`
- `src/automation/requirement-provider-dispatch.ts`
- `src/features/webgpt/automation/webgpt-provider-port.ts`
- `src/main/main.ts`
- `tests/arch-v2-6-provider-boundary.test.ts`
- `tests/automation-foundation.test.ts`

This stage does not add a new WebGPT runtime, browser UI, Submission Runner
integration, or Automation product workflow.
