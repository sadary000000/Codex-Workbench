# Direct Codex vs Workbench Native A/B Runbook

Protocol version: **1.0.0**

This protocol measures whether the ordinary Workbench Native path preserves Codex Native semantics and whether the Workbench adapter introduces material cost when optional Workbench features are not active. Codex executes this protocol; it does not redesign it during a run.

## 1. Operational definition

For this profile, the two arms are deliberately defined at the same Codex App Server boundary:

- **Arm A / `direct`**: one verified `AppServerProcessClient` talks directly to the Codex App Server using initialize -> thread/start -> turn/start. No `NativeThreadRuntime`, Map coordinator, Automation provider, or Workbench UI is in the measured path.
- **Arm B / `workbench`**: the same verified Codex binary is reached through the production-isomorphic `AppServerHost -> NativeThreadRuntime` composition. No Map dynamic tools are registered and no Automation provider dispatch is used.

This is the primary Native-runtime parity experiment. It intentionally does **not** compare Codex TUI rendering against Electron rendering. UI/CLI end-to-end UX benchmarking is a separate profile.

The controlled runner is `scripts/ab-native-arm.ts`. Do not replace it with an ad-hoc shell harness.

## 2. Authority files

The A/B protocol consists of:

1. `docs/testing/DIRECT_CODEX_WORKBENCH_AB_RUNBOOK.md`
2. `docs/testing/DIRECT_CODEX_WORKBENCH_AB_AGENT_PLAN.md`
3. `docs/testing/DIRECT_CODEX_WORKBENCH_AB_CASES.json`
4. `docs/testing/DIRECT_CODEX_WORKBENCH_AB_SCHEMA.json`
5. `scripts/ab-native-arm.ts`
6. `tests/ab-native-parity-contract.test.ts`

When this profile is launched from the repository-owned test control plane, the deferred/active pointer must bind an exact harness commit. Freeze that commit and copy these six files into the external evidence directory before any trial. Never re-read newer remote versions during the run.

## 3. Non-negotiable comparability rules

A formal result is comparable only when all of the following hold:

- both arms use the same exact repository target commit;
- both arms use the same resolved Codex executable and the same binary SHA-256;
- the binary passes Workbench's verified App Server protocol provenance check;
- both arms use the same explicit model ID;
- both arms use the same reasoning effort when an effort is pinned;
- both arms receive byte-identical prompt text for a case;
- both arms use `approvalPolicy=never`;
- both arms use the same turn sandbox policy;
- network access inside the requested sandbox is false;
- thread/start uses the same `cwd`, `ephemeral=false`, `approvalPolicy=never`, and initial `sandbox=read-only` envelope;
- optional Map/governance features are absent from the ordinary Workbench Native measured path;
- formal timed trials never run concurrently on the same host/runtime resources;
- a task failure is not retried merely to obtain a PASS.

If one of these rules cannot be proved, mark the affected case `NOT_COMPARABLE` and do not hide it inside aggregate latency statistics.

## 4. Safety rules

During A/B execution:

- never run against the user's mutable working tree;
- never reset, clean, stash, amend, or overwrite user changes;
- create detached isolated worktrees at the exact target commit;
- never merge, push, force-push, delete branches, or modify repository settings;
- do not edit product source/tests to repair a failed trial;
- do not change model, reasoning effort, prompt, sandbox, or validator between arms;
- never use historical CI as a substitute for a formal trial;
- do not expose or copy authentication material into evidence;
- never infer unavailable token, compaction, retry, or provider-model fields. Record `null` when not explicitly observable.

## 5. Evidence layout

Create a run ID:

```text
native-ab-<UTC timestamp>-<short target SHA>
```

Store evidence outside all Git worktrees:

```text
<OS temp>/codex-workbench-tests/<run-id>/
  protocol/
  preflight/
  prompts/
  warmup/
  trials/
    <case-id>/
      001-direct/
      002-workbench/
      ...
  analysis/
    direct/
    workbench/
    paired/
  review/
  result.json
```

Each trial directory must contain at least:

- `events.jsonl` — runner stdout;
- `stderr.txt`;
- `trial.json` — case ID, arm, ordinal, target SHA, workspace path, prompt SHA-256, model, effort, sandbox, start/end UTC, exit code, replacement-of field if any;
- validator evidence;
- pre/post Git status for the trial workspace when the case can mutate files.

Do not write benchmark evidence into the source worktree.

## 6. Phase P0 — Freeze target and protocol

Coordinator only.

1. Record bootstrap/control-plane HEAD and target repository identity.
2. Resolve the exact A/B execution target from the repository test-control pointer.
3. Fetch the target without moving the user's branch.
4. Create a detached target worktree at the exact target SHA.
5. Verify `git rev-parse HEAD` equals the configured SHA.
6. Verify the target worktree begins clean.
7. Copy the six authority files from this exact commit into `protocol/`.
8. Record SHA-256 for every copied protocol file.
9. From this point onward, all agents use the frozen copies for instructions and the detached target worktree for executable code.

If the target SHA or protocol files cannot be established exactly, verdict = `BLOCKED`.

## 7. Phase P1 — Deterministic repository gate

In the detached target worktree run once, outside formal timing:

```text
npm ci
npm run typecheck
node --experimental-strip-types --test tests/ab-native-parity-contract.test.ts tests/r8-shared-native-runtime-composition.test.ts tests/app-server-host.test.ts
npm test
npm run build
```

These commands validate the harness and target repository. Their durations are **not** A/B performance metrics.

A deterministic failure here prevents the real A/B benchmark from producing PASS. Preserve evidence and return `FAIL` unless the failure is clearly external infrastructure.

## 8. Phase P2 — Codex binary and model discovery

Use the A/B runner itself so discovery uses the same verified App Server transport as the formal experiment:

```text
AB_DISCOVER=1 node --experimental-strip-types scripts/ab-native-arm.ts
```

Capture stdout/stderr.

The discovery run must:

- resolve one Codex command;
- report a concrete binary path and SHA-256;
- pass the Workbench binary provenance check;
- initialize App Server with `experimentalApi=false`;
- return `model/list`.

Select the single entry marked as the default model. Pin its exact `model`/`id` value as `AB_MODEL` for the whole experiment. If its `defaultReasoningEffort` is non-empty, pin that exact value as `AB_EFFORT`; otherwise omit `AB_EFFORT` for both arms.

If there is no unique usable default model, stop `BLOCKED`. Do not pick a favorite model manually during the run.

Record the resolved binary provenance, model ID, and effort in `preflight/selection.json`.

## 9. Phase P3 — Prepare cases and fixtures

Read the frozen `DIRECT_CODEX_WORKBENCH_AB_CASES.json`.

For every case:

1. Materialize the exact `prompt` string into `prompts/<case-id>.txt` using UTF-8 with no extra prose.
2. Record SHA-256 of the prompt file.
3. Confirm both arms will point to the same prompt file and same exact target commit.

### Repository-target fixtures

Read-only cases may reuse one clean detached target worktree because formal trials are serialized and the sandbox is read-only. Before and after every trial record:

```text
git status --porcelain=v1
```

Any change makes that trial FAIL and invalidates reuse until a new detached worktree is created. Never clean the changed worktree to conceal the deviation.

### Throwaway-copy fixtures

A write case gets a fresh detached worktree at the same target SHA for **every** formal trial. Do not reuse a mutated workspace between arms or trial ordinals.

The validator's `allowedChangedPaths` is an allowlist, not a suggestion. Any other changed path is a scope deviation.

## 10. Phase P4 — Runner invocation

Every formal arm invocation uses this shape from the exact target worktree:

```text
AB_ARM=<direct|workbench>
AB_WORKSPACE=<absolute trial workspace>
AB_PROMPT_FILE=<absolute prompt file>
AB_MODEL=<pinned model>
AB_EFFORT=<pinned effort, only when non-null>
AB_SANDBOX=<read-only|workspace-write>
node --experimental-strip-types scripts/ab-native-arm.ts
```

Redirect stdout to that trial's `events.jsonl` and stderr to `stderr.txt` without altering the command semantics.

The runner emits:

- `run_start` with prompt hash, model, effort, sandbox, binary provenance and intended envelopes;
- `appserver_request` / `appserver_response` with the actual request method/params and local request latency;
- raw Native events;
- Workbench turn-request diagnostics where applicable;
- `run_result` with terminal status, final message and elapsed measurements.

A trial with a non-zero process exit is a failed trial unless Section 13 classifies it as an external transient eligible for a replacement trial.

## 11. Phase P5 — Warmup

Warmup exists only to remove one-time process/cache effects from formal results.

Use `AB-READ-001-exact-reply` once per arm in this fixed order:

```text
direct
workbench
```

Warmup results must be preserved but excluded from formal statistics and task-success rates.

If warmup proves the two arms are not comparable (different binary/model/prompt/envelope), stop before formal trials.

## 12. Phase P6 — Formal counterbalanced trials

For each required case, execute exactly the `formalSequence` from `DIRECT_CODEX_WORKBENCH_AB_CASES.json`:

```text
direct
workbench
workbench
direct
workbench
direct
direct
workbench
```

This yields four formal observations per arm while balancing first/last and local time-order effects.

Rules:

- one formal timed trial at a time on the measurement host;
- do not run `npm test`, log parsing, static audit, package install, indexing, or another model trial concurrently on the same constrained host;
- do not deliberately sleep between successful trials;
- preserve the declared order even after a task failure;
- allow already scheduled later trials to run so the failure surface is complete.

After the first eight formal trials for a case, calculate coefficient of variation for `internalElapsedMs` separately for each arm. If either arm exceeds the configured `0.20` threshold, run the configured additional counterbalanced sequence once. Preserve both original and additional observations. Do not keep adding repetitions until the desired answer appears.

## 13. External-transient replacement policy

Do not retry task failures, wrong answers, scope deviations, sandbox failures, protocol rejections, provenance failures, or deterministic App Server errors.

One replacement trial is allowed at the **end of that case** only when the original trial clearly failed because of external transient infrastructure, such as an authenticated model-service transport outage that is not shown to be arm-specific.

Requirements:

- preserve the failed original trial;
- set `replacementOf` to the original trial ID;
- use the same arm/config/prompt/fixture state;
- never delete the original from counts;
- exclude the external-transient original from latency summaries but include it in infrastructure-reliability reporting.

More than one external-transient replacement for the same arm/case makes that case `INCONCLUSIVE`.

## 14. Optional workspace-write stratum

`AB-WRITE-001-workspace-write` is intentionally non-required for the primary parity verdict.

Before formal write trials, run one sandbox capability probe for each arm on fresh throwaway worktrees. If both arms can enforce the declared workspace-write boundary, run the normal warmup/formal logic for this case.

If one platform/runtime cannot provide equivalent workspace-write semantics, record `NOT_COMPARABLE_ENVIRONMENT` for this case and continue the required read-only benchmark. Do not weaken sandbox settings to force comparability.

A known platform issue is not permission to use `danger-full-access`.

## 15. Task validators

Validators are mechanical.

### `exact-final-message`

Trim only one terminal line-ending sequence from the reported final message. Otherwise require exact string equality.

### `json-subset`

Parse the final message as one JSON object. Every key/value in `expected` must exist and equal exactly. Extra keys fail when the case prompt says no extra keys.

### `file-and-exact-final-message`

Require:

- final message exact match;
- target file exists with exact bytes/text;
- Git changed paths equal the validator allowlist;
- no other file was created, modified, staged, deleted, or renamed.

A validator failure is a task failure. Do not ask the model to repair its result.

## 16. Metric extraction

Extract metrics independently from immutable trial evidence after all timed trials finish, unless analysis runs on physically isolated compute that cannot contend with the measurement host.

For each trial record:

- `taskSuccess` from the validator;
- `processElapsedMs` from runner `run_result`;
- `internalElapsedMs` from runner `run_result`;
- `threadStartMs` from matching `appserver_response(method=thread/start)`;
- `turnStartAckMs` from matching `appserver_response(method=turn/start)`;
- `tokenUsage` only from explicit numeric usage fields emitted by Codex; otherwise `null`;
- `compactionCount` only from explicit Codex events/fields whose semantics identify compaction; otherwise `null`;
- `retryCount` only from explicit observable retries or protocol-authorized replacement records; opaque provider retries remain `null`;
- `toolCallCount` from distinct explicitly typed tool-execution items/events; unknown item types are retained separately and never guessed into this count;
- `scopeDeviationCount` from filesystem/Git evidence;
- `modelVisibleWorkbenchInjection` by comparing the actual direct/workbench request envelopes and checking for Workbench-only `developerInstructions`, `dynamicTools`, prompt prefix/suffix, extra model-visible input, or governance payload.

Do not derive token counts from text length. Do not infer compaction from long context. Do not infer hidden retries from latency.

## 17. Envelope parity checks

For every paired case/config, compare actual `appserver_request` evidence.

Required ordinary Native parity:

- `thread/start.cwd` equal;
- `thread/start.approvalPolicy` equal and `never`;
- `thread/start.ephemeral` equal and `false`;
- `thread/start.sandbox` equal and `read-only`;
- neither arm has `dynamicTools`;
- neither arm has Workbench `developerInstructions`;
- `turn/start.input` byte-equivalent after JSON decoding;
- explicit `model`, `effort`, `approvalPolicy`, `sandboxPolicy` equal;
- no extra Workbench governance/Map/Automation field is present in the Workbench arm.

Any model-visible Workbench-only difference is a semantic parity failure even if the final answer happens to match.

Local-only diagnostics/events do not count as model-visible injection.

## 18. Aggregation

For each arm/case compute from valid formal trials:

- trial count;
- task successes and success rate;
- median and arithmetic mean of `internalElapsedMs`;
- median `threadStartMs`;
- median `turnStartAckMs`;
- median explicit token usage when present in every included trial, otherwise report availability and per-trial values without inventing a median across missing data;
- total explicit tool calls;
- total explicit compactions when observable;
- total protocol-authorized replacements;
- scope deviations.

For each case calculate paired/arm delta:

```text
medianDeltaMs = workbenchMedianMs - directMedianMs
medianRatio = workbenchMedianMs / directMedianMs
successRateDelta = workbenchSuccessRate - directSuccessRate
```

If `directMedianMs` is zero or unavailable, `medianRatio=null`.

## 19. Performance materiality

Performance is reported separately from semantic verdict.

Classify `performanceAssessment`:

- `EQUIVALENT_OR_BETTER`: no required case has a Workbench median regression that exceeds both 10% and 1000 ms.
- `MATERIAL_REGRESSION`: at least two required cases exceed both 15% and 1000 ms, or `AB-READ-001-exact-reply` exceeds both 25% and 500 ms after variance escalation rules are satisfied.
- `MIXED`: measurements are comparable but fall between the rules above.
- `INCONCLUSIVE`: too few comparable observations or external instability prevents a defensible comparison.

These thresholds are product-test materiality bands, not claims of statistical significance.

## 20. Semantic verdict and release recommendation

Top-level `verdict` is one of `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`.

### PASS

Requires:

- deterministic repository gate passed;
- binary/model/config comparability proved;
- all required cases have comparable formal observations from both arms;
- Workbench required-case task success rate is not lower than Direct;
- envelope parity passes;
- no model-visible Workbench injection is detected in ordinary Native mode;
- no Workbench-only duplicate runtime ownership is observed by the static contract;
- no material protocol deviation affects interpretation.

PASS does **not** mean performance is automatically acceptable; read `performanceAssessment`.

### FAIL

Use for deterministic semantic/product failures such as:

- Workbench lower task-success rate on required cases;
- model-visible Workbench-only prompt/tool/governance injection;
- direct/workbench request envelope mismatch not explained by the declared arm boundary;
- duplicate runtime owner detected;
- deterministic repository/typecheck/test/build failure;
- tracked-file scope deviation in required read-only trials.

### BLOCKED

Use when exact target/protocol/binary/model/authentication or safe isolated workspaces cannot be established.

### INCONCLUSIVE

Use when external instability or insufficient comparable evidence prevents a reliable result without proving a product defect.

Set `releaseRecommendation`:

- `PROCEED` only when verdict=PASS and performanceAssessment is `EQUIVALENT_OR_BETTER` or a documented `MIXED` result has no material regression;
- `INVESTIGATE_WORKBENCH_OVERHEAD` when verdict=PASS but performanceAssessment=`MATERIAL_REGRESSION`;
- `DO_NOT_PROMOTE` when verdict=FAIL;
- `RETEST_REQUIRED` for BLOCKED/INCONCLUSIVE.

## 21. Independent review

The independent reviewer must inspect raw evidence, not only summaries, and answer:

1. Was the protocol commit frozen before execution?
2. Was one exact target SHA used by both arms?
3. Did both arms use the same verified Codex binary/model/effort/prompt/sandbox?
4. Were formal trials serialized and counterbalanced exactly?
5. Did any replacement violate Section 13?
6. Did actual request envelopes remain model-visible equivalent?
7. Did Workbench Native add any Map/governance/Automation payload?
8. Are unavailable metrics represented as null rather than inferred?
9. Are task validators mechanically satisfied?
10. Does the final verdict follow Sections 19-20?

Reviewer must not rerun failed trials or edit code.

## 22. Final output

Write `result.json` conforming to `DIRECT_CODEX_WORKBENCH_AB_SCHEMA.json` and preserve all evidence at the reported evidence root.

The final human summary must state at minimum:

- exact tested commit;
- exact Codex binary SHA;
- pinned model/effort;
- required-case success rates by arm;
- per-case median latency delta/ratio;
- token/tool/compaction/retry availability and results;
- model-visible Workbench injection result;
- semantic verdict;
- performance assessment;
- release recommendation;
- every protocol deviation.

An old A/B PASS applies only to the exact tested commit. It never silently blesses a newer branch head.
