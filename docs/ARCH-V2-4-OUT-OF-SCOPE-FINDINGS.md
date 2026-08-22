# ARCH-V2-4 Out-of-Scope Findings

## Existing WebGPT control recovery smoke

The packaged WEB-6.4 arbiter smoke still has a failure path: after `webgpt open` reports `USER_CONTROL`, `webgpt control auto` timed out. This stage did not alter Control Plane or WebGPT control recovery because that is outside ARCH-V2-4's External Action / Resource / Reconciliation scope.

That same existing path changed the production Request Journal byte hash during the smoke. Request count and state counts remained unchanged, but no trusted pre-test backup was available for a safe restore. The final gate is therefore blocked; no guessed restore or cleanup was performed.

## Not implemented here

- AUT-2/AUT-3 real Prompt or external side effect;
- Requirement/Planner/Workflow PASS propagation;
- Action Domain second provider implementation;
- persistent live lease store;
- production Request Journal cleanup or migration;
- PolicyVersion activation (ARCH-V2-5);
- provider-neutral ports (ARCH-V2-6);
- Automation, Scheduler, Planner, Workflow or multi-project orchestration;
- V1 Frozen Core, Native Thread/Turn/Item, Map, Renderer or Shared Host redesign.
