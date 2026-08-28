# Git and Validation Workflow

This file defines the branch and CI discipline for Codex-Workbench. Its goal is to keep the repository easy to understand while still preserving rigorous validation.

## Core rule

Use each system for one job:

- **Git** stores code history and durable integration points.
- **`docs/workbench-map/`** stores project stage, handoff, ownership, and route state.
- **GitHub Actions** stores validation runs and disposable test artifacts.

Do not use branches as a substitute for CI records or project-state bookkeeping.

## Long-lived branches

The intended long-lived development shape is:

- `main` — repository-level branch retained by the project owner.
- `codex/workbench-v1` — formal Workbench integration/release target.
- `workbench/next` — active integration branch for the current R-stage work.

Existing `arch/**` branches from the R2-R4 stacked delivery are legacy checkpoints and remain until that stack is deliberately resolved. Do not create new long-lived architecture checkpoint branches merely to record progress.

## Short-lived implementation branches

When a bounded change needs isolation, branch from the current `workbench/next` head using a short-lived `feature/**` branch.

Typical flow:

`workbench/next -> feature/<bounded-slice> -> review/CI -> workbench/next`

Rules:

1. One branch should represent one bounded implementation slice, not a roadmap stage database.
2. Tests and review evidence belong to Actions/PRs, not a second validation branch.
3. After an implementation slice is integrated and branch deletion is explicitly approved, the temporary feature branch should be removed.
4. Do not create `fix/**-exact-head-verify` or similar branches solely to trigger CI.

## Exact-head validation

`.github/workflows/ci.yml` is designed to validate exact refs without helper branches.

- Pushes to `workbench/next` and `codex/workbench-v1` run CI.
- PRs targeting either integration branch run CI.
- PR CI checks out `github.event.pull_request.head.sha`, not the synthetic merge ref.
- Manual `workflow_dispatch` accepts an optional `ref` that may be a branch, tag, or commit SHA.

The verification path remains:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

If additional validation outputs are worth retaining temporarily, upload them as GitHub Actions artifacts rather than committing them or creating a branch for them.

## Stage completion

A roadmap stage such as R5 can contain multiple bounded feature slices on `workbench/next`. The stage is not considered formally integrated merely because those slices are green.

When the full stage satisfies its exit criteria:

1. Update `ROADMAP.md`, `HANDOFF.md`, and `roadmap.json`.
2. Run the full validation path on the exact `workbench/next` head.
3. Review the complete diff against `codex/workbench-v1`.
4. Open or update the formal integration PR.
5. Merge only after explicit approval.
6. After formal integration, create a version tag/release when useful for durable milestone discovery.

## Releases and tags

Tags/releases are preferred over permanent branches for completed milestone discovery. A release checkpoint should identify:

- stage/version;
- exact commit SHA;
- architecture/map checkpoint;
- validation result;
- meaningful migration or compatibility notes.

Git history remains the historical record; the Map should describe the current route rather than preserve every obsolete checkpoint in prose.

## Separate Lab repository policy

Do **not** create a second repository for ordinary product development or intermediate implementation branches. That creates cross-repository synchronization and provenance problems.

A future `Codex-Workbench-Lab`-style repository is justified only if experiments produce materially separate assets such as very large benchmark datasets, generated fixtures, stress/fuzz corpora, disposable research prototypes, or different secret/access requirements.

Formal Workbench product code should continue to evolve in this repository.

## Legacy validation branch cleanup

The following branches were created only to trigger exact-head CI under the old workflow and have no independent product value:

- `fix/arch-r3-exact-head-verify`
- `fix/arch-r3-resource-exact-head-verify`
- `fix/arch-r4-native-budget-exact-head-verify`
- `fix/arch-r4-webgpt-budget-exact-head-verify`

They are obsolete under the new CI model. Delete them once branch deletion is explicitly approved and an authenticated deletion interface is available. Their historical CI runs remain GitHub Actions evidence; the branch names do not need to survive.
