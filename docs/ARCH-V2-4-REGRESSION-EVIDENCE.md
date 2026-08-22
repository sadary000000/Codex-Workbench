# ARCH-V2-4 Regression Evidence

## Passing regressions

| Boundary | Result | Evidence |
|---|---|---|
| Native navigation/restart | PASS | `npm run test:real:navigation` |
| Native workspace interrupt/continue/restart | PASS | `npm run test:real:workspace` |
| Native multi-thread isolation | PASS | `npm run test:real:multi-thread` |
| Shared Codex Host recovery | PASS | `npm run test:real:shared-host-recovery` |
| Generated protocol repeatability | PASS | `npm run test:protocol:arch-v2-2` |
| Conversation Map runtime | PASS | `npm run test:real:map` |
| Project Map isolation/restart | PASS | `npm run test:real:project-map` |
| WebGPT Control Plane protocol, zero prompts | PASS | `npm run test:real:webgpt:protocol` |

## Existing regression boundary not passing

`npm run test:real:webgpt:arbiter` returned `FAIL`: packaged `control auto` timed out after `open` returned `USER_CONTROL`. The evidence recorded `realPromptCount=0`, `cookiesRead=false`, `tokensRead=false`, `privatePageContentLogged=false`, and `globalNewChatClicked=false`. During this smoke, the existing `control.auto` -> `WebGptRequestManager.automationControl()` path also changed the production Request Journal byte hash from `E116...E77B0` to `7D2F...661CE` while keeping request/state counts unchanged. No restore was attempted because no trusted backup was available. This is a blocking existing WebGPT Control/Journal boundary, not an ARCH-V2-4 Action Domain PASS.

This failure is disclosed rather than reclassified as PASS.
