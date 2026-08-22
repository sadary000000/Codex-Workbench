# ARCH-V2-1 Out-of-Scope Findings

## Explicitly not implemented

- Shared CodexHost / shared App Server protocol connection: ARCH-V2-2.
- Provider boundary, WebGPT recovery and Request Manager changes.
- AUT-2/AUT-3 requirement/planner behavior.
- PolicyVersion, hard-constraint policy work.
- New Automation, Workflow, Scheduler or Planner functionality.
- UI redesign or a second Conversation/Transcript store.

## Accepted protocol limitation

Codex CLI 0.147.0 does not expose `dynamicTools` on `thread/resume`. Therefore an existing Thread cannot be made to claim a same-turn native Map tool merely by reopening it. The implementation uses a bounded compatibility maintenance path and records the original Native source identity.

## Evidence limitations

- The main Electron IPC composition root is not exercised by a GUI automation test in this stage; runtime-level contracts and real App Server smokes cover the protocol boundary.
- Approval UI, Stop UI race and source-jump DOM E2E remain outside this Map-focused stage; they are retained as frozen V1 regression evidence, not reimplemented here.
- The existing Workbench tree contains unrelated historical dirty/deleted review artifacts and local planning files. They were not cleaned, restored, staged or included in this stage package unless explicitly listed.

## Safety boundary

No cookies, tokens, browser profiles, user private conversations or authentication material are included in the review package.

