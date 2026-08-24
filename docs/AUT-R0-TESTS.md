# AUT-R0 Verification

## Targeted tests

Command:

```text
node --experimental-strip-types --test tests/aut-r0-requirement-provider.test.ts tests/webgpt-command.test.ts tests/webgpt-control-contract.test.ts
```

Result: **25/25 PASS**.

Coverage includes:

- opaque InputRef registration and provider Action ledger wiring;
- no raw Requirement prompt in the persisted snapshot;
- provider acceptance with a distinct provider semantic identity;
- accepted-but-unresolved recovery and no blind resend;
- missing InputRef fail-closed behavior;
- owner and UTF-8 byte metadata validation;
- legacy Requirement regression and draft identity replay;
- `NEEDS_INPUT` next-round identity reset;
- provider policy/capability/target boundary and paused seam classification.

The targeted set also covers the production Requirement Control Plane parser,
pre-side-effect round ActionAttempt persistence, ProviderResult identity
mismatch fail-closed behavior, and post-submit InputRef release.

## Static/type verification

`npm run check`: **PASS**.

## Real App Server smoke

`NOT RUN` in this isolated AUT-R0 implementation pass. No live WebGPT
provider session was attached to the test fixture, so no real-provider PASS is
claimed. The existing WebGPT provider boundary and real-smoke scripts remain
unchanged and should be run in an environment with the existing signed-in
runtime before treating this stage as a real production gate.

Full test suite: **414/414 PASS**.

Build/package/audit: `npm run build`, `npm run package:win`, and
`npm audit --omit=dev` all **PASS**. The packaged WEB-6.6 Control Plane
protocol smoke also **PASS** with zero new real prompts. A live AUT-R0
Requirement provider smoke was not run and is intentionally not claimed.

## Known audit follow-ups

The read-only policy/recovery audit identified broader hardening candidates
around accepted-side-effect persistence fault injection and generic receipt
invariants. They are recorded for the GPT Gate and are not silently expanded
into AUT-R0 beyond the provider-neutral Requirement path.
