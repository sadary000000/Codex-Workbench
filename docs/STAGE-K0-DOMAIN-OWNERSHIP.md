# STAGE-K0 Domain Ownership

Status: `IMPLEMENTED / VALIDATION IN PROGRESS`

## Owners

```text
AutomationProject
  ├─ RequirementOrigin
  ├─ RequirementVersion chain
  ├─ PolicyVersion pointer
  └─ ActionIntent → ActionAttempt → ActionReceipt
```

Automation owns workflow/action domain facts. Codex Runtime remains the owner
of Native Thread/Turn/Item facts. WebGPT owns browser/session/ChatGPT request
state. No Automation record is a transcript or a replacement Native runtime.

## Requirement invariants

- `RequirementOrigin` is a bounded, auditable identity record with explicit
  origin type/source and an immutable reference.
- `RequirementVersion` owns canonical payload/hash metadata and is immutable
  after insertion except for the existing bounded status projection.
- Version 1 has no predecessor; later versions name the immediate predecessor
  in the same AutomationProject.
- Duplicate versions, multiple roots, orphan origins, cross-project links, and
  URL-shaped origin references fail closed.
- Active selection is a project pointer and does not rewrite historical
  versions.

## Evidence

- `src/automation/types.ts`
- `src/automation/schema.ts`
- `src/automation/store.ts`
- `src/automation/requirement-service.ts`
- `tests/automation-foundation.test.ts`
- `tests/automation-persistence.test.ts`

Raw prompts, browser handles, cookies, tokens, DOM selectors, and native
transcripts are not RequirementOrigin ownership.
