# ARCH-V2-6 Dependency Evidence

`tests/arch-v2-6-provider-boundary.test.ts` recursively scans `src/automation/**/*.ts` and asserts no `features/webgpt` direct import remains. The test passed. Provider runtime imports are confined to `src/features/webgpt/automation/webgpt-provider-port.ts`.

This is a source-boundary assertion, not a claim that every legacy data field has already been renamed.
