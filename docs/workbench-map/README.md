# Workbench Handoff Map

This directory is the durable navigation layer for the Codex-Workbench project.

It is designed for two audiences:

1. Humans who need to understand the project, current architectural direction, and delivery status without reconstructing old chat history.
2. AI/Codex sessions that need a bounded, structured checkpoint before continuing implementation or review work.

## What this directory is

`docs/workbench-map/` is a **projection and handoff surface**. It summarizes the current engineering route, frozen architecture decisions, delivery checkpoints, and the next safe continuation point.

It is intentionally similar in spirit to the Workbench Map product concept: important project entities are connected through explicit stages, dependencies, decisions, evidence, and delivery references instead of being buried in narrative history.

## What this directory is not

This directory is **not** a new source of runtime truth and must never be used to implement a second execution state machine.

Authoritative ownership remains separated by domain:

- Native execution truth: Codex App Server (`Thread`, `Turn`, `Item`, native runtime events).
- Workflow truth: Workbench automation persistence.
- External action truth: the provider/remote system plus reconciled Workbench records.
- Resource truth: live runtime ownership/lease state.
- Projection truth: Workbench UI, Map, and this handoff documentation.

If this documentation disagrees with an authoritative runtime or persisted source, fix the documentation; do not mutate runtime truth to make the map look correct.

## Reading order

Start here, then read:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — frozen responsibility boundaries and invariants.
- [`ROADMAP.md`](./ROADMAP.md) — stage graph, status, dependencies, and exit criteria.
- [`HANDOFF.md`](./HANDOFF.md) — current checkpoint and exact continuation instructions.
- [`roadmap.json`](./roadmap.json) — machine-readable projection for future tooling or AI bootstrap.

## Update rule

Update this directory whenever a change materially affects one of the following:

- architecture ownership or a frozen invariant;
- roadmap stage status or dependency;
- stacked PR/branch/commit checkpoint;
- the next safe implementation or audit action;
- a newly discovered risk that changes how the next session should proceed.

Routine code edits do not need a map update unless they change the handoff state.

## Status vocabulary

Use these status values consistently:

- `MERGED` — integrated into the target branch.
- `STACKED_DRAFT` — implemented and reviewed/validated locally or in CI, but still waiting for explicit merge approval.
- `ACTIVE` — current audit or implementation stage.
- `PLANNED` — ordered future work, not started.
- `BLOCKED` — cannot safely continue until a named dependency or decision is resolved.

## Safety rule for handoff

A future session should treat branch creation, pushes, merges, and branch deletion as distinct operations. Before creating/pushing a new implementation branch, state the exact branch and base ref. Never merge or delete branches merely because this map says a stage is complete; those actions require explicit approval.
