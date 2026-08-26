# STAGE-K1-A Test Evidence

## Targeted tests

Command:

```text
node --experimental-strip-types --test tests/stage-k1-a-plan-domain.test.ts
```

Result: **3/3 passed**.

Coverage:

1. Complete Plan/Stage/Step fields round-trip through persistence and restart; current-plan query is pure.
2. Plan v1 remains byte-for-byte equivalent after Plan v2 creation; active selection is a separate pointer; stale, cross-project, and draft Requirement bindings fail closed; generic Plan replacement is rejected.
3. Legacy minimal v3 specs migrate to additive v4 fields; injected transaction failure preserves the canonical file hash.

## Full regression

Command:

```text
npm test
```

Result: **446/446 passed**, 0 failed, 0 cancelled.

The full run includes K0 persistence, migration, runtime-separation, policy, ledger, WebGPT boundary, and V1 regression tests. No real planner prompt, business chat, Step execution, or Native Thread was used by K1-A.

## Required commands

The required commands were attempted. Audit and diff-check passed. Check, build, and package:win are blocked by the worktree's missing local TypeScript/Electron dependencies. The scoped K1-A TypeScript check using an existing donor compiler passed.

```text
npm run check
npm audit --omit=dev
git diff --check
npm run build
npm run package:win
```

No command is marked PASS unless its exit code and output support that result.
