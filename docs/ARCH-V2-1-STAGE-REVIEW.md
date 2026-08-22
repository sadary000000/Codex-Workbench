# ARCH-V2-1 Stage Review

## Scope resolution

**Stage:** `ARCH-V2-1 Native Equivalence & Optional Feature Isolation`

**Goal:** Make ordinary Native Codex Thread behavior Map/OFF-equivalent to the official App Server surface as far as the current CLI ABI permits, while preserving explicit Map ON behavior and compatibility maintenance.

**In scope:** Map OFF model-facing payload isolation; Map activation authority; same-ID live enable transition; resume capability truth; Conversation/Project Map maintenance isolation; tests and real smoke evidence.

**Out of scope:** ARCH-V2-2 Shared CodexHost; Provider/Automation; WebGPT recovery; PolicyVersion; AUT-2/AUT-3; new Conversation/Transcript truth; UI redesign.

**Architecture boundary:** Native Thread/Turn/Item and Codex App Server remain authoritative. Map is a bounded optional sidecar and projection.

## Implementation

Changed stage files:

- `src/codex/native-thread-runtime.ts`
- `src/main/main.ts`
- `src/main/map-activation.ts`
- `src/main/project-map-manager.ts`
- `src/renderer/renderer.ts`
- `tests/native-thread-runtime.test.ts`
- `tests/map-activation.test.ts`
- `tests/project-map-manager.test.ts`

Key changes:

1. Ordinary Native Thread creation sends no Map fields.
2. Resume does not send unsupported `dynamicTools` and does not claim registration.
3. Map enable on an idle loaded Thread reattaches the same Native ID in sidecar compatibility mode; an active Turn is fail-closed.
4. Project Map disabled maintenance read cannot start a maintenance Runtime.
5. Map OFF UI text no longer claims that a native Map tool was registered.

## Gate evidence

- `npm run check`: PASS
- `npm test`: PASS, 302/302
- targeted Map/Native/Project Map tests: PASS, 37/37
- `npm run build`: PASS
- `npm run package:win`: PASS
- real new Map smoke: PASS
- real resumed Map fallback smoke: PASS
- real Project Map smoke: PASS
- Native IDs preserved; no replacement Thread created by the stage changes.

## Subagents

| Agent | Task | Natural completion/result |
| --- | --- | --- |
| Copernicus | Native model-facing surface audit | completed; confirmed OFF isolation and resume ABI boundary |
| Dirac | Map activation/lifecycle audit | completed; identified live enable gap and activation lifecycle |
| Cicero | negative/regression test design | completed; identified composition/idle evidence gaps |
| Franklin | frozen Native regression audit | completed; confirmed runtime identity and listed remaining UI/composition gaps |
| Goodall | independent architecture challenge | completed; identified live enable, resume flag and activation truth risks |

All five results were reviewed and incorporated. They were not allowed to modify the old donor or unrelated stages. All five completed agents were then closed/cleaned up; subsequent close checks returned `not_found` for every agent, and the gate records `running_subagents=0`.

## Known limitations

The current Codex CLI cannot register dynamic tools on `thread/resume`; existing Threads therefore use bounded compatibility maintenance rather than a false same-turn capability claim. Main Electron composition and GUI DOM E2E are not independently automated in this stage.

## Current gate

`PASS` after package creation, subagent cleanup, final hygiene checks and GPT review. GPT returned `PASS` with P0=0, P1=2 accepted limitations, P2=1, blocker=0. ARCH-V2-2 was explicitly authorized by the returned complete instruction; no ARCH-V2-2 implementation is included in this stage.

## Subagent gate

- Copernicus: closed/cleaned up
- Dirac: closed/cleaned up
- Cicero: closed/cleaned up
- Franklin: closed/cleaned up
- Goodall: closed/cleaned up
- `running_subagents=0`
