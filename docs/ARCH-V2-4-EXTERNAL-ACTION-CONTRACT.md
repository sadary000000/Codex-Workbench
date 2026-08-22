# ARCH-V2-4 External Action Contract

## Boundary

ARCH-V2-4 connects the existing Automation Action Domain to the existing WebGPT provider path. It does not create a second Action, Request, Receipt, Conversation, or Workflow truth.

```text
ActionIntent
  -> ActionAttempt
  -> existing WebGPT RequestManager / RequestRecord
  -> ProviderObservation
  -> AutomationStore ActionReceipt
```

`ProviderRequest` and `ProviderObservation` are adapter contracts. The persisted correlation is represented by existing `ActionAttempt`, `ActionReceipt`, `ExternalRef`, and `Evidence` records.

## Dispatch contract

`canDispatch(context)` is a pure conjunction over:

- runtime readiness;
- policy precondition;
- target identity validity;
- live resource availability;
- absence of a conflicting active action;
- absence of an unknown outcome for the same side effect;
- idempotency safety.

Any false condition returns a bounded blocker and prevents provider submission.

## Ownership

- Only `AutomationStore` writes `ActionReceipt`.
- WebGPT RequestManager continues to own `requests.json` and RequestRecord state.
- OperationArbiter continues to own live browser lease state.
- Provider observation never writes Requirement, Plan, or Workflow PASS.

## Compatibility

New provider fields are explicit on new writes. Schema validation infers safe defaults for legacy persisted ActionReceipt/ActionAttempt records without rewriting them.
