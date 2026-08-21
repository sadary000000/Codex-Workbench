# WEBGPT-WEB6.5 Stage Review

```yaml
stage: WEB-6.5 Request Recovery, Idempotency & Targeted Latest Read
result: FIX_REQUIRED
gate_fix_commit: 0d8a39f
implementation_gate: PASS
real_chat_latest_out_without_separator: FAIL
real_chat_latest_out_with_electron_separator: PASS
real_role_latest_out: PASS
real_cold_start: PASS
v1_frozen_core_changed: NO
new_real_prompts: 0
next_stage: WEB-6.6 NOT_STARTED
```

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| current `latest` | PASS | Target Chat read, 26 bytes/hash |
| current `latest --out` | PASS | UTF-8 file, 26 bytes/hash |
| `chat latest` | PASS | Exact target, wrong-chat read count 0 |
| `chat latest --out` raw user order | FAIL | Windows `0xFFFFFFFF`, no output |
| `chat latest --out` with `EXE --` | PASS | exit 0, file/hash match |
| `role latest --out` | PASS | Temporary PLANNER binding, exact target |
| Role silent rebind | PASS | false; original binding restored |
| cold-start `execFile` | PASS | status exit 0, GUI alive |
| Browser Lease / target-aware read | PASS | 191/191 and real target read |
| WEB-5 recovery/idempotency contract | PASS | Automated regression; no new Prompt |
| V1 core integrity | PASS | No Native/V1 Frozen Core change |

## Root cause

Raw Control Plane `chat.latest` with `out` writes and returns correctly. `latest --out` also writes and returns correctly. Only the packaged EXE invocation with a valid URI followed by another value-bearing option and no Electron `--` separator exits at the native Electron boundary. The application handler and shared output writer are not reached in that failing invocation. This is not a navigation race, output flush race, timeout, or Control Plane response issue.

## Changes

- Added `src/main/webgpt-output.ts` as the common durable UTF-8 text writer.
- Routed `latest`, `chat latest`, `role latest`, and `result --out` through the common writer.
- Added deterministic writer tests: absolute/Unicode path, exclusive create, UTF-8 bytes, `sync`/`close`, and write failure.
- Added parser coverage for the explicit Electron separator form.

## Real invocation contract

The currently reliable Windows form is:

```text
Codex Workbench V1.exe -- webgpt chat latest --url <target> --out <absolute-temp> --json
```

The exact no-separator form requested by WEB-6.5 v2 remains a blocker and is intentionally not marked PASS.

## Automated verification

- `npm run check`: PASS
- `npm test`: PASS, 191/191
- `npm run build`: PASS
- `npm run package:win`: PASS
- `npm audit --omit=dev`: PASS，0 vulnerabilities
- `git diff --check`: PASS
- secret scan: PASS；未发现凭据形态值

## Scope boundary

No new Prompt, no WEB-6.6, no Automation, no V1 Frozen Core redesign, no shell launcher, no Cookie/Token/Profile evidence.
