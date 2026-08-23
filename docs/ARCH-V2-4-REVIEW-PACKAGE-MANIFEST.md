# ARCH-V2-4 FIX ROUND 1 Review Package Manifest

## Provenance

```yaml
repository: D:\办公\AI\Codex_Workbench_V1
branch: master
base_commit: da9c7b9
implementation_commit: d304e70
current_source_overlay: uncommitted and selectively listed below
legacy_project: D:\办公\AI\Auto_Agent (not modified)
old_donor: D:\办公\AI\Codex_Workbench (read-only, not modified)
```

## Current-stage changed files

```text
src/automation/webgpt-external-action.ts
src/features/webgpt/runtime/webgpt-operation-arbiter.ts
src/features/webgpt/runtime/webgpt-request-manager.ts
scripts/real-webgpt-web6.4-arbiter-smoke.ts
tests/arch-v2-4-external-action.test.ts
tests/arch-v2-4-fix-round-1.test.ts
docs/ARCH-V2-4-*.md
```

The current-stage tracked source diff is 270 insertions and 15 deletions before the final nullable-smoke mechanical correction; unrelated existing dirty/untracked files were not staged or included.

## Verification provenance

```text
npm run check: PASS
npm test: 317/317 PASS
npm run build (standard dist): blocked by running EXE lock (EPERM)
npm run package:win (standard dist): blocked by same lock
CODEX_WORKBENCH_DIST=dist-stage-arch-v2-4 npm run build: PASS
CODEX_WORKBENCH_DIST=dist-stage-arch-v2-4 npm run package:win: PASS
npm audit --omit=dev: 0 vulnerabilities
git diff --check: PASS
scoped secret scan: PASS
```

## Review contents

The ZIP contains this manifest, the ARCH-V2-4 stage/fix/evidence docs, the sanitized WEBGPT-6.4 real-gate JSON, the regression matrix and the GPT review request. It excludes cookies, tokens, passwords, browser profiles, private chat content, prompt bodies, full Journal contents and Automation DB.
