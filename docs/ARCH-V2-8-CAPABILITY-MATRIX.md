# ARCH-V2-8 Capability / Reality Matrix

| Capability or invariant | Verified evidence | Status |
| --- | --- | --- |
| Codex 0.147.0 binary resolution | Resolver path and exact SHA-256 contract | PASS |
| Stable version boundary | Stable `0.147.0` parser rejects prerelease/future mismatch | PASS |
| Initialize request `clientInfo` | Request validator and contract tests | PASS |
| Initialize request `experimentalApi` | Explicit boolean request capability and mismatch test | PASS |
| Initialize response ABI | Four generated verified response fields | PASS |
| Schema provenance | Same-binary generated schema provenance assertion | PASS |
| Server identity attestation | `userAgent` plus binary/schema attestation | PASS |
| Unsupported operations | Existing capability registry fails closed | PASS |
| Native Thread shared bootstrap | Source audit and runtime tests | PASS |
| Shared Host shared bootstrap | Host tests and attestation | PASS |
| Map / Project Map shared bootstrap | Source audit in Round 4 contract test | PASS |
| Negative gate side-effect boundary | No Thread, Turn, or Prompt on invalid gate | PASS |
| Native Thread identity ownership | Frozen baseline check | PASS |
| Native Turn / Item runtime ownership | Frozen baseline check | PASS |
| Second Conversation / Transcript truth | Explicitly absent | PASS |
| Final human freeze | Awaiting explicit final freeze action | NOT_YET |

```yaml
P0: 0
P1: 0
P2: 3
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
finalFrozen: false
```
