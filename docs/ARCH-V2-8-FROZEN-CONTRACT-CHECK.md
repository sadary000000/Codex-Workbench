# ARCH-V2-8 Frozen Contract Check

## Required invariants

| Contract | Result |
| --- | --- |
| Native Thread is the only Conversation identity | PASS |
| Native Turn / Native Item are the only message/runtime facts | PASS |
| Codex App Server remains the runtime main path | PASS |
| Workbench does not create Conversation truth | PASS |
| Workbench does not create Transcript truth | PASS |
| Workbench does not create Task truth | PASS |
| Workbench does not create hidden replacement Threads | PASS |
| Workbench does not reconstruct exec history | PASS |
| RuntimeRegistry / thread isolation is not redesigned | PASS |
| AUT-2 and AUT-3 remain paused | PASS |
| Final freeze is not silently performed | PASS |

## Side-effect evidence

The real probe performed only App Server `initialize`. It did not call Thread creation, Turn creation, resume/read, or Prompt send. The recorded counts are:

```yaml
real_business_prompts: 0
new_business_chats: 0
thread_started: false
turn_started: false
prompt_sent: false
```

## Boundary statement

Round 4 changes the App Server compatibility bootstrap and attestation adjacent to the frozen core. It does not change identity ownership or introduce a competing product fact source.
