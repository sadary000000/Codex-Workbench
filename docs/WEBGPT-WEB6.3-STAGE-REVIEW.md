# WEBGPT WEB-6.3 Stage Review

## Review status

```yaml
stage: WEB-6.3 Network Completion Candidate Integration
result: PASS_CANDIDATE
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
implementation_commit: 86e881fdf23fe039aa9910cde7dc27eee9b14130
v1_frozen_core_changed: NO
new_software_or_plugin_installed: NO
```

## Executive summary

本阶段将 WebGPT Network lifecycle 接入为完成候选触发器，但保留既有 Page Probe
作为最终确认。真实打包 EXE 在 `workts` Project 下完成一次候选到 `COMPLETED` 的闭环；
observer 不可用时确定性地退回低频 Page Probe。没有新增第二套 Conversation truth、
Transcript truth 或 Request truth，也没有自动重发 Prompt。

## Gate matrix

| Gate | 证据 | 结果 |
|---|---|---|
| Network observer attach/lifecycle | `tests/webgpt-network-observer.test.ts` | PASS |
| Unique candidate correlation | correlator unit/contract tests + real Gate A | PASS |
| Ambiguous/no candidate fail-closed | correlator tests | PASS |
| `loadingFailed` exclusion | observer test | PASS |
| Navigation/stale invalidation | observer test | PASS |
| Candidate event → bounded Page Probe | real Gate A | PASS |
| Network path regular-probe reduction | scheduler test + real diagnostics | PASS |
| Observer unavailable fallback | deterministic FakeDebugger Gate B | PASS |
| Recovery/idempotency/no blind resend | existing Request Manager regression | PASS |
| Real latest packaged EXE | `WEBGPT-WEB6.3-REAL-GATE.json` | PASS |

## Real Gate A evidence

```yaml
project: workts
runId: web6.3-1787247730873-c0a6db65
requestId: wgpt-1fa17ea1-4cdd-4cf9-a4f3-4159df4a5915
observerMode: NETWORK
observerHealth: AVAILABLE
candidateUnique: true
candidateState: COMPLETION_CANDIDATE
candidateEmitted: true
finalState: COMPLETED
resultAvailable: true
fallbackUsed: false
pageProbeCount: 12
reconciliationProbeCount: 1
confirmationProbeCount: 11
promptCount: 1
rateLimitObserved: false
```

The real evidence JSON is sanitized. It does not contain the Prompt body, Assistant body,
Cookie, Token, browser profile, or private network payload.

## Real Gate B evidence

The deterministic test-only observer-unavailable path returns `UNAVAILABLE/FALLBACK`,
does not emit a candidate, and leaves the existing Page Probe path available. No second
real Prompt was needed for this Gate.

## Verification record

```yaml
base_commit: 441afa33da6c2704d5ab7d2b8b611dde816c6503
npm_run_check: PASS
npm_test: PASS (172/172)
npm_run_build: PASS
npm_run_package_win: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS
secret_scan: PASS
```

Package provenance at review preparation:

```yaml
package_path: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
outer_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```

## Changed scope

Only the WebGPT feature path, its network observer/correlator/scheduler, the narrow public
diagnostics projection, deterministic tests, and the real smoke script changed. No old donor,
V1 Frozen Core, Native Thread/Turn/Item model, Project Map, or unrelated product surface was
modified.

## Known limitations / deferred

- Network lifecycle remains a candidate signal, not a GPT completion truth source.
- Ambiguous or unavailable observer paths intentionally use fallback Page Probe.
- Gate B does not claim a manually induced real network failure.
- Browser Pane and Automation remain out of scope.
- No UI or CLI contract expansion beyond bounded `webgpt status` diagnostics was made.

## Review request

请审查：候选关联信号是否足够保守、Page Probe 最终权威边界是否保持、observer
不可用 fallback 是否满足 V1 安全原则，以及是否允许把 WEB-6.3 标记为 PASS/FROZEN。
