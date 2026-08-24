# AUT-R0 Stage Review

## Stage

`AUT-R0 — Provider-neutral InputRef + Requirement Production Rewire`

## Result

`PASS_CANDIDATE` for the provider-neutral implementation, production Control
Plane entry, and contract/regression gate. Real Requirement App Server smoke is
`NOT_RUN`; this report does not claim a live WebGPT acceptance result.

Implementation commit: `ae4eb95` (`feat: rewire requirement through
provider-neutral input refs`). Review-package/documentation commit is created
after this report is finalized.

## Architecture baseline

```text
Native Thread / Turn / Item = runtime truth
Codex App Server            = runtime main path
Requirement                 = domain state owned by Automation persistence
InputRef                    = opaque process-owned transient payload handle
Provider Port               = only external side-effect boundary
```

No second conversation truth, transcript truth, task truth, agent lifecycle
truth, or execution-history reconstruction was added.

## Implementation changes

- Added `src/automation/input-ref.ts` with owner-, kind-, hash-, and UTF-8
  length-checked opaque references.
- Added `src/automation/requirement-provider-dispatch.ts` to route Requirement
  production through the provider port and Action ledger.
- Added provider result read/wait capability and separate domain/provider
  semantic correlation fields.
- Added the production `webgpt.requirement start|draft|reconcile` Control Plane
  entry. It invokes the shared main-process Requirement service instead of
  merely materializing an unused composition.
- Added a bounded 305-second CLI budget for the three Requirement provider
  commands so a real WebGPT turn cannot be cut off by the ordinary 15-second
  Control Plane default.
- Rewired active Requirement response handling to a neutral envelope context;
  legacy Chat binding construction is not used by provider mode.
- Kept the original `WEBGPT_REQUEST` identity separate from provider request
  and observation references.
- Prevented missing-policy orphan intents and reset provider references when a
  `NEEDS_INPUT` response opens the next round.
- Persisted the Requirement round's ActionIntent/ActionAttempt before provider
  submission, and made accepted request/observation external-ref attachment
  transactional.
- Verified ProviderResult provider/request identity before terminal Receipt
  creation and release transient InputRef payloads after provider submission.
- Removed the legacy adapter from the production automation barrel.

## Scope and exclusions

In scope: InputRef contract, Requirement provider-neutral dispatch, identity,
ledger/recovery boundaries, regression tests, and evidence.

Out of scope: Automation workflows, Planner/Reviewer, new WebGPT UI, browser
protocol changes, V1 Frozen Core redesign, and old-donor changes.

## Subagent evidence

- Popper: read-only legacy caller/provider boundary audit — completed; no
  active legacy Requirement production caller remains after the Control Plane
  entry was added.
- McClintock: read-only InputRef/persistence/security audit — completed.
- Laplace: read-only policy/action/recovery regression audit — completed.
- Noether: independent challenge audit — completed; its three blocking
  findings were fixed and covered by targeted tests.

## Gate evidence

- Targeted AUT-R0 + Control Plane + legacy Requirement + provider boundary:
  25/25 PASS.
- `npm run check`: PASS.
- Full `npm test`: 414/414 PASS. `npm run build`, `npm run package:win`, and
  `npm audit --omit=dev` also PASS after the final code change.
- Existing packaged WEB-6.6 Control Plane protocol smoke: PASS, 0 new real
  prompts. AUT-R0 live Requirement provider smoke: NOT RUN.
- Real App Server smoke: NOT RUN; no false PASS claim.

## Production entry contract

```text
webgpt requirement start --project <automation-project>
  --webgpt-project <provider-project>
  --provider-target <opaque-target> --goal <goal>
webgpt requirement draft --session-id <alignment-session-id>
webgpt requirement reconcile --session-id <alignment-session-id>
```

The authenticated Control Plane session is separate from
`requirementSessionId`; no raw prompt, ChatGPT URL, DOM selector, browser page,
cookie, or session handle is accepted by this entry.

## Security

The review package must exclude cookies, tokens, passwords, browser profiles,
private chats, raw prompts, full production databases, and unrelated logs.
