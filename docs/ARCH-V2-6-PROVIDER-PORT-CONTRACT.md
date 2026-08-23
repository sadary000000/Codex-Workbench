# ARCH-V2-6 Provider Port Contract

The contract is `AutomationProviderPort` in `src/automation/adapters.ts`.

It carries only:

- `ProviderTargetRef`, `ProviderRequestRef`, `ProviderResultRef`;
- bounded `ProviderCorrelation`;
- `ProviderTargetResolution`;
- `ProviderCapabilityFact`;
- `ProviderRequestAccepted`;
- `ProviderObservation`.

`resolveTarget`, `capabilities`, `submit`, `observe`, and explicit `reconcile` are separate operations. `observe` must not navigate, reconcile, acquire a write lease or submit a side effect.
