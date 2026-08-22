# AUT-2 Fix8 Prompt / Schema / Test Matrix

## Contract sources

| Layer | Source | Fix8 observation |
|---|---|---|
| Shared model Prompt | `src/automation/requirement-webgpt-contract.ts` / `REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS` | Previously named `resolutionMode` without enumerating the allowed symbols; now explicitly lists all four symbols and bans `SINGLE_SELECT`. |
| Schema enum | `REQUIREMENT_QUESTION_RESOLUTION_MODES` | Strict values remain `USER_REQUIRED`, `ASSUMPTION_ALLOWED`, `AVAILABLE_CONTEXT`, `AUTO_INVESTIGATION`. |
| Parser | `parseRequirementSemanticResponse` / `validateNeedsInputPayload` | Strict rejection remains enabled; no alias or UI-label normalization added. |
| Diagnostics | `diagnoseRequirementResponse` | Emits bounded shape and field-level issue records; never stores response content. |
| Real adapter | `RequirementWebGptAdapter` | Fix8 uses `repairBudget.max=0`; schema failure would stop immediately without a repair Prompt. |
| Real Gate | `runAut2RealWebGptGate({ firstRoundOnly: true })` | At most one business Prompt, no answers, no draft, no confirmation, no repair. |

## Matrix

| Case | Input/condition | Expected | Result |
|---|---|---|---|
| Valid `USER_REQUIRED` | Blocking user fact | Parse and schema PASS | Automated PASS |
| Valid `ASSUMPTION_ALLOWED` | Non-blocking assumption | Parse and schema PASS | Automated PASS |
| Valid `AVAILABLE_CONTEXT` | Existing bounded context | Parse and schema PASS | Automated PASS |
| Valid `AUTO_INVESTIGATION` | Bounded automatic evidence | Parse and schema PASS | Automated PASS |
| Invalid `SINGLE_SELECT` | UI label in `resolutionMode` | `SCHEMA_INVALID`, exact enum issue | Automated PASS; historical real evidence reproduced |
| Missing required field | Question omits `question` / `whyNeeded` | Required-field issue with JSON path | Automated PASS |
| Unexpected field | Question includes unapproved field | Unexpected-key issue | Automated PASS |
| Wrong type | `questions` is not an array | Type issue | Automated PASS |
| Fix8 first real round | New shared Prompt, existing canonical Chat | JSON/schema/semantic PASS; `NEEDS_INPUT`; no repair | Real protocol PASS; overall Gate blocked later by persistence |

## Decision

The minimal correct change is Prompt-contract clarification only. The validator remains strict. Adding `SINGLE_SELECT` as an alias would make a UI vocabulary part of the machine protocol and is explicitly rejected.
