# ARCH-V2-1 GPT Review Record

## Submission state

`PASS` — GPT reviewed the sanitized inline submission in the current Architecture Review conversation. The local ZIP remained the provenance artifact; the browser file tile was not used as the sole evidence source.

## Review scope sent

- ARCH-V2-1 Native Equivalence & Optional Feature Isolation
- Map OFF ordinary Native Thread payload isolation
- Map ON new-thread real tool regression
- resumed Thread protocol boundary and compatibility fallback
- live Map enable same-ID reattach
- Project Map OFF maintenance-read fail-closed
- no Shared CodexHost / Automation / WebGPT / AUT changes

## Package safety

The submitted material must contain only stage documents, bounded evidence, test summaries, provenance and hashes. It must not contain cookies, tokens, browser profiles, passwords, private ChatGPT content or unrelated historical artifacts.

## Gate

```yaml
gate: PASS
findings:
  P0: 0
  P1: 2
  P2: 1
  blocker: 0
architecture_decision:
  arch_v2_1: PASS
  map_off_model_facing_isolation: PASS
  optional_idle_isolation: PASS_WITH_CURRENT_SCOPE
  map_on_new_thread_native_tool: PASS
  resumed_thread_compatibility: PASS
  project_map: PASS
  native_identity_preserved: YES
  replacement_thread_created: NO
  shared_codex_host_started: NO
  webgpt_scope_entered: NO
  automation_scope_entered: NO
  aut2_aut3: REMAIN_PAUSED
next_stage: ARCH-V2-2 Shared CodexHost / Generated Protocol / Runtime Dedup
```

GPT accepted the two P1 limitations without blocking this stage: no independent Main Electron/GUI composition E2E, and the current Codex CLI 0.147.0 `thread/resume` ABI cannot register `dynamicTools`, so existing Threads use an explicit bounded compatibility fallback. P2 is the remaining full enable/pause/disable lifecycle negative coverage. No ARCH-V2-2 code was included in this Gate.
