# Architecture Baseline v2 — Final Freeze Candidate

## Identity and truth ownership

```text
Native Thread = only Conversation identity
Native Turn / Native Item = only message and runtime facts
Codex App Server = runtime main path
Workbench = product shell + UI projection + minimal persistence/recovery + Map enhancement
```

The baseline does not contain a second Conversation truth, Transcript truth, Task truth, hidden replacement Thread, or exec-history reconstruction.

## Compatibility baseline

```yaml
stage: ARCH-V2-8 FIX ROUND 4
implementation_commit: fe30b94e090ea2bfd2b2ef78b700bf81d72e5db3
codex_version: codex-cli 0.147.0
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
finalFrozen: false
AUT-2: PAUSED
AUT-3: PAUSED
P0: 0
P1: 0
P2: 3
real_business_prompts: 0
new_business_chats: 0
```

## App Server ABI

The verified `InitializeRequest` contains `clientInfo` and an explicit boolean `capabilities.experimentalApi`.

The verified `InitializeResponse` requires only:

```text
codexHome
platformFamily
platformOs
userAgent
```

`protocolVersion` and response-side `capabilities` are not required response fields for this verified 0.147.0 ABI. Unknown extra fields are tolerated, while missing verified fields, wrong version, wrong binary, wrong schema, or mismatched request capability fail closed.

## Production boundary

Native Thread, Shared Host, Map, and Project Map use the shared bootstrap and carry binary/schema/request attestation. `skipInitialize` is accepted only for a Host-owned client with verified attestation. No alternate initializer or second runtime truth was introduced.

## Freeze status

This file is a final baseline candidate for human freeze review. It is not itself a freeze operation; `finalFrozen` remains `false` until the user/GPT-approved final freeze action.
