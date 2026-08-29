# Failures

The repository gate passed. The required semantic failure is isolated to AB-READ-003-native-ownership.

## AB-READ-003-native-ownership

Expected compact JSON boolean object:
```json
{"ordinaryNativeUsesSharedHost":true,"conversationMapOwnsFallbackRuntime":false,"projectMapOwnsDirectCompatibilityClient":false,"automationNativeCreatesRuntime":false}
```

All 16 formal observations returned `projectMapOwnsDirectCompatibilityClient: true`; the Direct observations at sequence positions 6 and the additional Direct positions 1, 4, and 6 also contained a prose prefix, which independently violates the exact JSON validator. These are preserved as raw trial evidence; no model response was retried.

### Failed trial IDs

- AB-READ-003-native-ownership-additional-001-direct (direct, formal-additional)
- AB-READ-003-native-ownership-additional-002-workbench (workbench, formal-additional)
- AB-READ-003-native-ownership-additional-003-workbench (workbench, formal-additional)
- AB-READ-003-native-ownership-additional-004-direct (direct, formal-additional)
- AB-READ-003-native-ownership-additional-005-workbench (workbench, formal-additional)
- AB-READ-003-native-ownership-additional-006-direct (direct, formal-additional)
- AB-READ-003-native-ownership-additional-007-direct (direct, formal-additional)
- AB-READ-003-native-ownership-additional-008-workbench (workbench, formal-additional)
- AB-READ-003-native-ownership-001-direct (direct, formal)
- AB-READ-003-native-ownership-002-workbench (workbench, formal)
- AB-READ-003-native-ownership-003-workbench (workbench, formal)
- AB-READ-003-native-ownership-004-direct (direct, formal)
- AB-READ-003-native-ownership-005-workbench (workbench, formal)
- AB-READ-003-native-ownership-006-direct (direct, formal)
- AB-READ-003-native-ownership-007-direct (direct, formal)
- AB-READ-003-native-ownership-008-workbench (workbench, formal)
See `analysis/validator-results.json` and each `formal*/AB-READ-003-native-ownership*/validator.json` for the complete per-trial record.

No Workbench-only envelope or static ownership injection was detected. The optional write case was not run.
