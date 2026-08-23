# ARCH-V2-4 FIX ROUND 3 — GPT Guided Reliability Closeout

## Scope resolution

```yaml
stage: ARCH-V2-4 External Action / Resource / Reconciliation Integration
round: FIX ROUND 3
base_commit: 4568bcc2c3b112fd863711d043fc1e3b6f8629e9
implementation_commit: 282979a
prior_gate: FIX_REQUIRED (P0=0, P1=2, P2=1, BLOCKER=0)
authorized_fixes:
  - P1-01: make WEB-6.4 Arbiter smoke isolated, owned, and deterministic
  - P1-02: close WEB-6.6 status timeout at readiness/control-plane boundary
  - retain journal, prompt, and package safety evidence
v1_core_changed: NO
webgpt_business_prompts: 0
scope_expanded: NO
standard_package: locked by running Workbench; not force-terminated
isolated_package: D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-4-round-3\package
gate_posture: READY_FOR_GPT_REVIEW
```

本轮只处理 GPT Round 2 明确授权的两个 P1 证据闭环：WEB-6.4 Arbiter smoke 的隔离/所有权问题，以及 WEB-6.6 status 在 Browser view 尚未 ready 时的超时问题。没有重做 ResourceClaim、Bridge、Action、Request Manager、V1 Frozen Core 或 WebGPT 架构；没有发送真实业务 Prompt。

## Root causes and fixes

### P1-01 — WEB-6.4 Arbiter smoke

Round 2 的失败来自测试进程复用了正在运行的标准 Workbench user-data/descriptor，导致 smoke 连接到错误的运行时所有权，不能把结果归因到本轮 Arbiter。Round 3 的 smoke 现在：

- 为每次默认运行创建唯一临时 user-data 目录；
- 用单个 `--user-data-dir=<path>` 参数启动隔离的 packaged Workbench；
- 等待自有 Control Plane descriptor，并检查自有进程是否提前退出；
- 只允许测试结束时结束自己启动的 PID，不触碰用户运行中的 Workbench；
- 用 `control user → control auto → open`、并发 `open`、用户接管阻断、释放后 status 覆盖租约生命周期；
- 全程 `maxRealPrompts=0`，不依赖项目或 ChatGPT 私有页面内容。

这属于 smoke harness/root-cause 修复，没有改变 Browser Arbiter 的资源容量、队列或 Action 语义。

### P1-02 — WEB-6.6 status timeout

根因是 Control Plane status 在 WebContentsView 尚未 ready、正在 loading 或 view 已关闭时仍调用 `executeJavaScript` 页面探针。该调用可能一直 pending，最终被外层 15 秒 Control Plane deadline 截断。

本轮在 `WebGptWorkspace.getPageState()` 增加最小 fail-safe：closed/destroyed/not-ready/loading 时返回已有 bounded page state；导航/加载完成处理器仍会在页面可探测时刷新。这样 status 能报告 `workbench=READY`、`webgpt=UNAVAILABLE` 等真实状态，而不把启动中的正常状态误报成 timeout。没有删除原始错误，也没有把 WebGPT readiness 伪造成 ready。

## Evidence

| Gate | Result | Evidence |
|---|---|---|
| WEB-6.4 Arbiter real smoke | PASS | `ARCH-V2-4-WEB6-4-ARBITER-REAL-SMOKE.md` and sanitized JSON |
| WEB-6.6 status real smoke | PASS | `ARCH-V2-4-WEB6-6-STATUS-SMOKE.md` and sanitized JSON |
| Journal immutability in this round | PASS | `ARCH-V2-4-JOURNAL-SAFETY-EVIDENCE.md` |
| Business prompt budget | PASS | 0 prompts sent |
| V1 Frozen Core | PASS | no V1 core files changed |

### WEB-6.4 result summary

The isolated package completed with `result=PASS`, `userDataIsolated=true`, descriptor ready, owned process alive during the run, `capacity=1`, and final `mode=FREE` with `lastOperation.state=RELEASED`. Concurrent `open` produced one `ok=true` result and one `USER_CONTROL`; explicit user control blocked another automatic `open`, and `control auto` released the block. `rateLimitObserved=false`.

### WEB-6.6 result summary

The isolated package completed with status in 177ms and `ok=true`; protocol version was `1.0`, workbench state was `READY`, WebGPT state was `UNAVAILABLE` because the fresh isolated browser had no authenticated page, and no timeout occurred. The mismatch fixture returned `VERSION_MISMATCH`; the unsupported capability fixture returned `CAPABILITY_NOT_SUPPORTED`; both were fail-closed. `newRealPrompts=0`.

### Journal safety

The production Journal path was read-only hashed before and after the isolated smokes. Both measurements were SHA256 `E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B`, 118057 bytes. No real business prompt was sent and no Journal content is included in the package. Historical Round 1 mutation remains disclosed; this round does not claim an all-time invariant.

## Changed files in Round 3

```text
src/features/webgpt/runtime/webgpt-workspace.ts
scripts/real-webgpt-web6.4-arbiter-smoke.ts
scripts/real-webgpt-web6.6-protocol-smoke.ts
docs/ARCH-V2-4-FIX-ROUND-3.md
docs/ARCH-V2-4-WEB6-4-ARBITER-REAL-SMOKE.md
docs/ARCH-V2-4-WEB6-6-STATUS-SMOKE.md
docs/ARCH-V2-4-JOURNAL-SAFETY-EVIDENCE.md
docs/ARCH-V2-4-REGRESSION-ROUND-3.md
docs/ARCH-V2-4-TEST-SUMMARY-ROUND-3.json
docs/ARCH-V2-4-SOURCE-EVIDENCE-ROUND-3.md
docs/ARCH-V2-4-GPT-REVIEW-ROUND-3.md
docs/ARCH-V2-4-SUBAGENT-SUMMARIES-ROUND-3.md
docs/ARCH-V2-4-PROVENANCE-ROUND-3.txt
docs/ARCH-V2-4-ROUND-3-PACKAGE-MANIFEST.md
```

The existing dirty tree contains unrelated historical docs/artifacts; they are not part of this list and will not be staged.

## Verification posture

```yaml
npm_run_check: PASS
npm_test: PASS (322/322)
npm_run_build_isolated: PASS
npm_run_package_isolated: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS (line-ending warnings only)
scoped_secret_scan: PASS (source and ZIP credential-shape scan)
web6_4_arbiter_real_smoke: PASS
web6_6_status_real_smoke: PASS
arch_v2_4_real_business_prompts: 0
```

## Subagents

Five required agents ran to natural completion and were closed only after review. Their findings are recorded in `ARCH-V2-4-SUBAGENT-SUMMARIES-ROUND-3.md`; Gate-time `running_subagents=0`.

## Known limitations and retained challenge findings

- The standard `dist/package` is still locked by a running user Workbench and is not claimed as the Round 3 packaged provenance. The isolated package is the reproducible evidence artifact.
- A fresh isolated browser has no authenticated WebGPT page; WEB-6.6 therefore proves bounded protocol/status behavior, not a logged-in ChatGPT roundtrip.
- The independent safety challenge found historical ResourceClaim lifecycle ambiguity and test-only legacy dispatch context. Those are retained as disclosed findings; no unauthorized redesign was performed.
- Historical Journal SHA mutation from an earlier round remains part of incident provenance and is not rewritten by this round.

## Gate

```text
P1-01 WEB-6.4: PASS
P1-02 WEB-6.6: PASS
P2 Journal/prompt/package safety: PASS_WITH_EVIDENCE
automated_gate: PASS
real_smoke_gate: PASS_WITH_EVIDENCE
review: READY_FOR_GPT
```

This report is submitted for GPT review. No WEB-6.8/next architecture work is started automatically.
