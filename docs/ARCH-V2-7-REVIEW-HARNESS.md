# ARCH-V2-7 Review Harness

The harness in `tests/fixtures/arch-v2-7-review-harness.ts` is production-equivalent at the service boundary:

- real `AutomationStore` and SQLite transaction/writer behavior;
- real `WebGptExternalActionBridge` and `WebGptOperationArbiter`;
- bounded provider fixture with counters and opaque request IDs only;
- temporary root and no userData, WebGPT profile, cookies, tokens or business Prompt;
- fault worker for crash-before-commit and post-intent restart scenarios.

It does not copy the production state machine. It replaces only provider transport, clock/filesystem location and process boundary. The 13 harness tests cover query purity, explicit migration, commit fault, projection rebuild, pre-submit restart, UNKNOWN recovery, reattach/no-resend, terminal receipt, ResourceClaim/live lease and policy pin.
