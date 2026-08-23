# ARCH-V2-5 Source Evidence Index

## Product source

- `src/automation/effective-policy.ts` — resolver, pin, hard boundary, budget authority。
- `src/automation/store.ts` — PolicyVersion persistence and execution identity binding。
- `src/automation/schema.ts` — bounded schema and project/pin reference checks。
- `src/automation/sqlite-persistence.ts` — persistence privacy boundary。
- `src/automation/requirement-webgpt-adapter.ts` — optional repair authority injection。
- `src/automation/types.ts` / `src/automation/index.ts` — type and public export surface。

## Test source

- `tests/arch-v2-5-policy.test.ts` — stage-specific contract tests。

## Real evidence

- `dist-stage-arch-v2-5/WEBGPT-WEB6.6-REAL-GATE.json` — sanitized read-only protocol smoke;
  auth token presence is only boolean and token value is not persisted。

## Scope protection

No files under `D:\办公\AI\Codex_Workbench` or `D:\办公\AI\Auto_Agent` were used as write
targets. No V1 Frozen Core runtime files were modified by this stage.
