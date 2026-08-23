# ARCH-V2-6 Implementation Reality

## Implemented

- Provider-neutral DTO and `AutomationProviderPort` exist in `src/automation/adapters.ts`.
- WebGPT-side `WebGptAutomationProviderPort` owns target parsing, Role binding lookup, capability normalization and RequestManager calls.
- `observe()` is query-only; `reconcile()` is explicit.
- `EvidenceCorrelation` is bounded, immutable and queryable.
- Direct `features/webgpt` imports under `src/automation/**` are statically zero in the current tree.
- No AUT-2/AUT-3 real gate was activated and no real business prompt was sent.

## Not claimed

The older Requirement/Planner and External Action compatibility seams still expose historical Chat URL-shaped fields. They are not presented as a completed full migration. The stage review marks this partial and requests GPT direction.
