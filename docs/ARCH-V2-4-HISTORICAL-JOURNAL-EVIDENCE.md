# ARCH-V2-4 Historical Journal Evidence

Production Request Journal audit started as read-only, but the existing packaged WebGPT control smoke later mutated the file; this is recorded as a gate blocker.

```yaml
path: C:/Users/sadar/AppData/Roaming/codex-workbench-v1/webgpt/requests/requests.json
version: 2
request_count_before_and_after: 85
state_counts:
  COMPLETED: 50
  FAILED: 11
  PAUSED_FOR_USER: 2
  QUEUED: 1
  RECOVERY_REQUIRED: 21
sha256_before_real_smoke: E116AC8E7C4B914F849D4BD82FD774C37F643EA47796D969D3DB634E2B5E77B0
sha256_after_real_smoke: 7D2F2CD73E151BF9FAA01B91B0FCFA36B9FFED23B2A1EFDF4B15A0F4838661CE
journal_mutated: YES
mutation_trigger: existing packaged WEBGPT control.auto path during WEB-6.4 regression smoke
restore_attempted: NO
semantic_difference_recovered: NO
```

No request prompt, result body, Cookie, Token, or private chat content is included in this evidence. The ARCH-V2-4 implementation itself did not write this file; the existing real `control.auto` regression path did mutate it while reconciling existing recovery records. No cleanup, deletion, guessed restore, or further reconcile was attempted after detection.

The 15-record readiness test is isolated and does not modify this production file. State counts and request count remained the same in the before/after audit, but the byte hash changed; therefore this is a real gate blocker, not a claimed read-only PASS.
