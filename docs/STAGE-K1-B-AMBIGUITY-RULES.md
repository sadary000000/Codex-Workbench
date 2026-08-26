# STAGE-K1-B Ambiguity Rules

Ambiguity is represented explicitly under `candidate.ambiguity`.

```yaml
ambiguity:
  blockingQuestions: []
  missingRequirementFields: []
  assumptions: []
```

- One or more `blockingQuestions` or `missingRequirementFields` yields `PLANNING_NEEDS_REQUIREMENT_INPUT`, `valid=false`, and no persistence permission.
- Only explicit non-blocking `assumptions` yields `VALID_WITH_ASSUMPTIONS`, `valid=true`, with a warning that remains visible in the result.
- No ambiguity yields `VALID` if all other rules pass.
- Structural/identity/JIT errors take precedence over ambiguity classification and yield `INVALID`.
- The Validator does not turn an assumption into a silent default and does not answer a blocking question.

This split prevents a status label from being mistaken for a successful Gate and keeps Requirement truth owned by the exact RequirementVersion.
