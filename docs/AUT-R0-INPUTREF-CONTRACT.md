# AUT-R0 InputRef Contract

## Scope

AUT-R0 introduces an opaque, process-owned `InputRef` boundary for Requirement
production. The Requirement prompt is a transient provider payload; it is not a
durable Automation truth source.

## Contract

`InputRefRegistry.register()` accepts:

- `kind`: currently `REQUIREMENT_PROMPT` or `OTHER`;
- `payload`: the in-process string payload;
- `ownerRef`: the request identity that is allowed to resolve it.

It returns an opaque `automation-input-v1:<sha256>` reference plus SHA-256 and
UTF-8 byte length metadata. `resolve()` validates the reference, kind, owner,
hash, and byte length before a provider can receive it. Unicode length is
measured in UTF-8 bytes rather than JavaScript UTF-16 code units.

## Persistence boundary

Durable round state stores only `inputRef`, `inputSha256`, and `inputLength`.
It never stores the raw prompt. The registry is process-owned and ephemeral;
after a restart an unresolved reference fails closed and requires recovery
through an already accepted provider request. Recovery never reconstructs or
resends the raw prompt.

## Ownership and identity

The Requirement request id is the InputRef owner. A different request cannot
resolve the payload. Domain semantic identity and provider execution semantic
identity are separate: the provider-owned semantic is learned from acceptance
and is the value retained on the ActionAttempt for later reconciliation.

## Non-goals

- No cookie, token, browser profile, or raw prompt is persisted by this
  contract.
- No second Requirement transcript or conversation store is introduced.
- No provider-specific URL or current-chat fallback is representable in the
  provider-neutral dispatch input.
