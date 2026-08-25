# STAGE-K0 Test Contract and Current Results

Date: `2026-08-26`

## Required gate commands

The final gate is not yet closed while full validation and packaging are in progress. Results below are current evidence, not a claim of completion.

| command | result | evidence / limitation |
|---|---|---|
| targeted Node test set | PASS | `74/74` after the re-authorized K0 changes and K0-D fixes |
| `npm run check` | ENVIRONMENT_BLOCKED / TYPECHECK_PASS | exact script cannot find `tsc` because project `node_modules` is empty; donor TypeScript `5.7.3` passed both production and test configs with temporary verification configs |
| `npm test` | PASS | `443/443` |
| `npm audit --omit=dev` | PASS | `0 vulnerabilities` |
| `git diff --check` | PASS | exit 0; CRLF normalization warnings only |
| `npm run build` | ENVIRONMENT_BLOCKED | exact build requires project-local `node_modules/typescript`; donor typecheck is independent evidence |
| `npm run package:win` | ENVIRONMENT_BLOCKED | exact script stops at the same missing project-local TypeScript dependency as `npm run build` |
| equivalent donor build | PASS | donor TypeScript emitted `dist-k0-build`; control-plane schema generation passed |
| secret scan | PASS | K0 package scope scan excludes cookies, tokens, browser profiles, prompts, and user chat content |

## Targeted command

```text
node --experimental-strip-types --test \
  tests/automation-foundation.test.ts \
  tests/automation-persistence.test.ts \
  tests/aut-r0-requirement-provider.test.ts \
  tests/aut2-requirement-service.test.ts \
  tests/arch-v2-4-external-action.test.ts \
  tests/arch-v2-4-fix-round-1.test.ts \
  tests/arch-v2-7-review-harness.test.ts \
  tests/aut3-planner.test.ts
```

Coverage includes explicit Requirement origins and predecessor chains, privacy/InputRef shape, SQLite row identity, raw legacy migration mapping, promotion rollback, current PolicyVersion pinning, project scope, accepted-provider UNKNOWN recovery, observation/receipt correlation, paused legacy Bridge composition, and USER confirmation synchronization.

## Real operations

```yaml
real_business_prompts: 0
new_business_chats: 0
```

K0 does not require or authorize a real business Prompt. No browser or Submission Runner operation is evidence for the local implementation gate.
