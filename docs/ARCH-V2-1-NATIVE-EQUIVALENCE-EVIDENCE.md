# ARCH-V2-1 Native Equivalence Evidence

## Baseline

Base commit: `30a416b64fe12be9442b2a496eafb8d060cea598`

The baseline had an unconditional Conversation Map dynamic tool injection in `src/main/main.ts:createRuntime`. That made an ordinary Thread model-facing surface differ from the Native Codex baseline even when Map was not enabled.

## Evidence after implementation

### Ordinary Map OFF

`src/main/main.ts` now creates ordinary Threads with:

```ts
{ mapEnabled: false, mapToolEnabled: false }
```

`src/codex/native-thread-runtime.ts` derives `initialize.capabilities.experimentalApi` from a new-thread dynamic tool registration, not from a generic feature flag. The direct runtime test verifies:

```text
experimentalApi = false
thread/start.dynamicTools = absent
thread/start.developerInstructions = absent
dynamicToolsRegistered = false
```

### Resume protocol

Existing repository protocol evidence and real resumed-map smoke agree that Codex CLI 0.147.0 has no `thread/resume.dynamicTools` field. The implementation therefore sends no such field and does not claim registration. The real output was:

```json
{
  "resumeParamsHadDynamicTools": false,
  "sameTurn": "compatibility_fallback",
  "compatibilityFallbackToolCallCount": 1,
  "mapRevision": 1
}
```

### Identity and projection

All Map source entries remain keyed to the original Native Thread. Compatibility maintenance has a separate transport/runtime but is bounded to the original source cursor; it is not inserted into normal Thread projections or navigation.

## Regression evidence

- `npm run check`: PASS
- `npm test`: 302/302 PASS
- targeted Native/Map/Project Map tests: 37/37 PASS
- `npm run test:real:map`: PASS; real Map tool call count 1, revision 1
- `npm run test:real:resumed-map`: PASS; same Native ID, fallback call count 1, revision 1
- `npm run test:real:project-map`: PASS; two member Threads, one maintenance Thread, revision 2→3 after restart, maintenance excluded from navigation

