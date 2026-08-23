# ARCH-V2-7 Composition Isolation

`src/automation/composition-root.ts` is the minimal composition seam.

- `createProductionAutomationComposition(root)` creates the production Automation store path.
- `createReviewHarnessComposition(root, productionRoot)` creates the same Automation Store/Migration/Recovery services under an isolated root.
- The review root is rejected when it is equal to, inside, or contains the production root.
- Composition creates no directories; explicit store mutation/migration owns filesystem writes.
- Recovery classifier is injected as a pure function; WebGPT feature modules are not imported by Automation domain files.

Production `main.ts` now obtains its Automation store through this root. Review tests use the same `AutomationStore`, `WebGptExternalActionBridge`, `WebGptOperationArbiter`, migration service and recovery classifier with only temporary filesystem/provider fixtures.
