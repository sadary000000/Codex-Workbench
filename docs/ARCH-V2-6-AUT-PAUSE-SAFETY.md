# ARCH-V2-6 AUT Pause Safety

AUT-2 and AUT-3 remain explicitly paused. This round did not run their real gate entrypoints and sent zero real business prompts. The provider adapter has an independent fail-closed capability test: when runtime readiness is false, the provider submit method rejects before resolving input or calling RoleSession submit (`submitCount = 0`).

The existing AUT harness/persistence isolation findings remain out of scope and are not marked fixed.
