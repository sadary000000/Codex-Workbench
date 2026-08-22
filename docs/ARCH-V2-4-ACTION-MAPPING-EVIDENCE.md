# ARCH-V2-4 Action Mapping Evidence

Source: `tests/arch-v2-4-external-action.test.ts`, isolated temporary Automation Store.

The passing mapping test proves:

```text
ActionIntent -> ActionAttempt -> ProviderRequest -> ProviderObservation -> ActionReceipt
```

Observed assertions:

- one ActionIntent reaches `COMPLETED` only after terminal provider observation;
- one ActionAttempt carries provider request and observation references;
- one ActionReceipt is created for the Attempt;
- provider request/observation/resource lease are represented by three ExternalRef kinds;
- evidence is attached to the ActionAttempt, not a second transcript;
- ResourceClaim points to the existing attempt and mapped lease reference;
- no Requirement, Plan, or Workflow entity is created or changed by the bridge fixture.

The fixture is not a real WebGPT Prompt and is labelled as isolated contract evidence.
