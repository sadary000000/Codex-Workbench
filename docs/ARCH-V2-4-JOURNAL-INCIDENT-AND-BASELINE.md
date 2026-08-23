# ARCH-V2-4 FIX-07 Journal Incident and Post-Incident Baseline

## Safety rules followed

- no rollback from guessed state;
- no deletion, bulk terminalization or Journal clearing;
- no fabricated old SHA;
- no full Journal copied into the review package;
- only read/hash plus safe control smoke.

## Recorded incident

An earlier control/arbiter smoke observed `E116AC8E...E2B5E77B0 → 7D2F2CD7...F4838661CE` and a timeout boundary. No trusted backup exists and the exact historical byte delta is not recoverable from available evidence. The evidence is preserved as an incident, not rewritten.

## Current baseline

```yaml
path: C:\Users\sadar\AppData\Roaming\codex-workbench-v1\webgpt\requests\requests.json
sha256: E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B
bytes: 118057
requestCount: 85
stateCounts: RECOVERY_REQUIRED=21, PAUSED_FOR_USER=3, FAILED=11, COMPLETED=50
lastWriteUtc: 2026-08-23T03:39:42.3001111Z
```

The second safe control smoke observed this SHA before and after unchanged, with `realPromptCount=0`. This baseline is descriptive only; historical nonterminal records are never treated as live leases.
