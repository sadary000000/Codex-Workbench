# ARCH-V2-7 Recovery Intent Contract

`classifyRecoveryIntent()` is pure. It receives persisted ActionIntent/Attempt/Receipt correlation plus provider observation and ephemeral live-lease facts. It performs no store write, lease acquisition, reconcile, navigation, input, or provider submit.

## Dispositions

| Disposition | Meaning | Next action |
|---|---|---|
| `SAFE_TO_RESUME_LOCAL` | no provider submit/correlation exists | resume local preparation only |
| `REATTACH_PROVIDER_REQUEST` | existing provider correlation exists | reattach same request/Attempt |
| `RECONCILE_REQUIRED` | correlation is unresolved or unavailable | reconcile existing correlation |
| `WAITING_EXTERNAL` | provider request is pending/running | wait for external outcome |
| `POLICY_PIN_REQUIRED` | side-effecting record has no immutable pin | stop and pin explicitly |
| `RESOURCE_BUSY` | live lease belongs to another operation | wait for live resource |
| `UNSUPPORTED` / `CORRUPT` | unknown state or identity mismatch | stop |
| `TERMINAL` | terminal receipt is already canonical | no action |

Invariant: `blindResendAllowed` is the literal type/value `false`. A historical `ResourceClaim` does not imply a live Browser lease. Reattach never creates a new ActionAttempt.
