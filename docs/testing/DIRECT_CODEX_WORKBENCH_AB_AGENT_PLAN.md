# Direct Codex vs Workbench Native A/B Agent Plan

Protocol version: **1.0.0**

This file defines the Codex coordinator/subagent topology for the A/B profile. Do not improvise a different agent graph during execution.

## 1. Coordinator — `ab-coord`

Owns orchestration and immutable experiment identity only.

Responsibilities:

- freeze the control-plane/harness commit;
- resolve the exact execution target;
- create isolated worktrees and external evidence root;
- materialize frozen prompts;
- run the deterministic repository gate;
- run binary/model discovery and pin one model/effort;
- enforce all barriers below;
- launch subagents only when they have useful work;
- own the formal trial order and ensure only one timed trial runs at a time on the measurement host;
- collect immutable evidence;
- dispatch analysis only after timing cannot be contaminated;
- obtain independent review;
- emit the final schema-compliant result.

Forbidden:

- modifying experiment inputs after the first formal trial;
- changing model/effort between arms;
- repairing product code during the run;
- allowing multiple timed model trials to contend on the same measurement host;
- deleting failed-trial evidence;
- treating an old result as evidence for a newer commit.

## 2. Agent A — `protocol-audit`

Starts after: **B0_FROZEN**.

Read-only tasks:

- hash the six frozen authority files;
- verify protocol versions agree;
- verify cases JSON and result schema parse;
- verify formal sequence is counterbalanced and contains equal arm counts;
- verify required case IDs are unique;
- verify the controlled runner is present at the frozen target.

Output: `preflight/protocol-audit.json`.

May run in parallel with Agent B and repository dependency installation.

## 3. Agent B — `native-parity-static-audit`

Starts after: **B0_FROZEN**.

Read-only production audit. Inspect at least:

- `src/main/main.ts`
- `src/codex/native-thread-runtime.ts`
- `src/codex/app-server-host.ts`
- `src/main/project-map-manager.ts`
- `src/main/map-coordinator.ts`
- `src/main/native-provider-runtime-adapter.ts`

Required answers:

```text
ordinary_native_shared_host: true|false
ordinary_native_dynamic_tools: true|false
ordinary_native_workbench_developer_instructions: true|false
conversation_map_independent_runtime: true|false
project_map_direct_compat_client: true|false
automation_native_creates_runtime: true|false
unclassified_runtime_owner_count: integer
```

Expected parity shape for the current architecture is:

```text
true, false, false, false, false, false, 0
```

Do not edit source to achieve that shape.

Output: `preflight/native-parity-static-audit.json` plus occurrence inventory.

May run concurrently with Agent A and dependency installation because it is read-only and requires no installed packages.

## 4. Coordinator repository-gate lane

Starts after: **B0_FROZEN**.

Run:

```text
npm ci
npm run typecheck
node --experimental-strip-types --test tests/ab-native-parity-contract.test.ts tests/r8-shared-native-runtime-composition.test.ts tests/app-server-host.test.ts
npm test
npm run build
```

This lane is not a model-performance measurement and may overlap with Agents A/B.

On completion create barrier **B1_REPOSITORY_GREEN**.

## 5. Agent C — `environment-model-pin`

Starts after: **B1_REPOSITORY_GREEN** and Agents A/B complete.

Tasks:

- capture OS/architecture/CPU summary;
- capture Node/npm/Git versions;
- run `AB_DISCOVER=1 node --experimental-strip-types scripts/ab-native-arm.ts`;
- verify binary provenance is concrete and accepted;
- choose the unique default model from model/list;
- pin default reasoning effort when present;
- record authentication availability without copying credentials;
- create `preflight/selection.json`.

This agent must finish before any benchmark warmup.

On success create barrier **B2_MODEL_PINNED**.

## 6. Agent D — `fixture-preparer`

Starts after: **B1_REPOSITORY_GREEN**.

May run in parallel with Agent C because it does not run Codex model turns.

Tasks:

- materialize every case prompt to external evidence storage;
- hash prompts;
- verify read-only target workspace is clean;
- prepare a recipe for fresh detached worktrees for write trials;
- do not begin a formal trial;
- do not create write-case mutations yet.

Output: `preflight/fixtures.json`.

On completion contributes to barrier **B3_EXPERIMENT_READY**.

## 7. Barrier B3_EXPERIMENT_READY

Coordinator may start warmup only when all are true:

- B0 frozen target/protocol established;
- protocol audit PASS;
- static Native parity audit PASS;
- repository gate PASS;
- binary/model/effort pinned;
- prompts/fixtures prepared;
- no unresolved protocol deviation affects comparability.

## 8. Agent E — `timed-trial-executor`

This is the **only** agent allowed to run formal timed Direct/Workbench model trials on the measurement host.

Starts after: **B3_EXPERIMENT_READY**.

Responsibilities:

1. run the required warmup pair;
2. execute required cases in cases-file order;
3. execute each case's formal arm sequence exactly;
4. capture trial files and validators;
5. calculate only the minimal coefficient-of-variation value required to decide whether the predefined additional sequence is needed;
6. run at most the one predefined variance-escalation sequence;
7. run authorized external-transient replacement trials only at the end of a case;
8. optionally run the workspace-write stratum if its equivalence preflight passes.

Important isolation rule:

- no Agent F/G log analysis may execute on the same constrained host while E is timing a trial;
- if F/G can be placed on demonstrably separate compute/storage that cannot contend with E, Coordinator may start them on completed immutable cases; otherwise wait for B4.

Agent E cannot interpret the final product verdict.

On completion create barrier **B4_TIMING_COMPLETE**.

## 9. Agent F — `direct-evidence-analysis`

Starts after: **B4_TIMING_COMPLETE**, unless isolated non-contending analysis compute is proven.

Analyze Direct-arm immutable evidence only:

- task validator outcomes;
- internal/process latency;
- thread/start and turn/start acknowledgement latency;
- explicit token usage availability/values;
- explicit tool-call items;
- explicit compaction evidence;
- explicit retry/replacement evidence;
- scope deviations;
- Direct actual App Server request envelopes.

Output: `analysis/direct/summary.json`.

Do not compare against Workbench yet.

## 10. Agent G — `workbench-evidence-analysis`

Same start rule as Agent F.

Analyze Workbench-arm immutable evidence only with the same metric definitions.

Additionally inventory local-only Workbench diagnostics separately so they cannot be mistaken for model-visible payload.

Output: `analysis/workbench/summary.json`.

Agents F and G should run in parallel after B4.

## 11. Agent H — `paired-comparator`

Starts after: Agents F and G complete.

Tasks:

- match Direct/Workbench observations by case/config;
- verify actual prompt hashes/configs/binary provenance match;
- compare actual thread/start and turn/start envelopes;
- detect model-visible Workbench-only fields;
- compute required per-case aggregates and deltas;
- calculate `performanceAssessment` mechanically from Runbook Section 19;
- do not choose final verdict by intuition.

Output: `analysis/paired/comparison.json`.

On completion create barrier **B5_ANALYSIS_COMPLETE**.

## 12. Agent I — `independent-review`

Starts only after **B5_ANALYSIS_COMPLETE**.

Must not have participated in trial execution or metric aggregation.

Review raw evidence and Runbook Section 21 questions. Recompute a sample of validators and aggregates directly from raw files.

Output:

```json
{
  "reviewStatus": "PASS|FAIL|BLOCKED|INCONCLUSIVE",
  "recommendedVerdict": "PASS|FAIL|BLOCKED|INCONCLUSIVE",
  "performanceAssessment": "EQUIVALENT_OR_BETTER|MIXED|MATERIAL_REGRESSION|INCONCLUSIVE",
  "releaseRecommendation": "PROCEED|INVESTIGATE_WORKBENCH_OVERHEAD|DO_NOT_PROMOTE|RETEST_REQUIRED",
  "protocolDeviations": [],
  "findings": []
}
```

Reviewer must not rerun a model trial merely because a result is surprising.

## 13. Execution DAG

```text
Coordinator freeze exact protocol + target
                 |
                 v
             B0_FROZEN
        _________|________________
       |         |                |
       v         v                v
 Agent A     Agent B        repository gate
 protocol    static audit    npm ci/typecheck/
 audit                       targeted/full/build
       |         |                |
       |         |                v
       |         |        B1_REPOSITORY_GREEN
       |         |                |
       |         |        ________|________
       |         |       |                 |
       |         |       v                 v
       |         |   Agent C           Agent D
       |         |   model pin         fixtures
       |         |       |                 |
       +---------+-------+-----------------+
                         |
                         v
                 B3_EXPERIMENT_READY
                         |
                         v
                  Agent E timed trials
                  (single timing owner)
                         |
                         v
                    B4_TIMING_COMPLETE
                         |
                  _______|_______
                 |               |
                 v               v
              Agent F         Agent G
              Direct          Workbench
                 |               |
                 +-------+-------+
                         |
                         v
                      Agent H
                   paired compare
                         |
                         v
                   B5_ANALYSIS_COMPLETE
                         |
                         v
                      Agent I
                independent review
                         |
                         v
                   Coordinator result
```

## 14. Parallelism policy

Parallelize aggressively where it cannot change formal measurements:

- protocol audit + static ownership audit + dependency/repository gate: parallel;
- model discovery + fixture preparation: parallel after repository gate;
- Direct evidence analysis + Workbench evidence analysis: parallel after timing;
- independent reviewer: serialized after complete analysis.

Never parallelize on the same measurement host:

- Direct and Workbench timed trials;
- two cases' timed trials;
- heavy build/test/log-analysis work with timed trials.

The goal is to eliminate avoidable waiting without buying speed by contaminating the experiment.

## 15. No idle-agent rule

Do not launch an agent before its dependency barrier merely to make it wait. Launch at the earliest point where it has independent useful work.

One owner per responsibility. Do not create multiple agents to run the same formal trial or recompute the same summary unless the independent reviewer is explicitly sampling it.

## 16. Failure propagation

- exact identity/protocol/auth/model unavailable -> `BLOCKED` candidate;
- deterministic repo/static parity failure -> `FAIL` candidate; do not start formal timing;
- task or envelope semantic regression -> continue remaining scheduled evidence, then `FAIL` candidate;
- one external transient -> preserve + authorized replacement at case end;
- repeated external instability -> affected case `INCONCLUSIVE`;
- optional write case non-comparable -> record separately, do not fail required read-only parity;
- missing raw evidence -> prevents PASS.

No subagent may convert a failure into success by changing the implementation or protocol.
