# STAGE-K1-D FIX ROUND 4 — Subagent Findings

This record summarizes three read-only investigations started for FIX ROUND 4. All three completed naturally. They were not given permission to send a Planner prompt, create a ProviderAttempt, navigate a page, rebind a role, promote a Plan, or enter K2.

## SA1 — Runtime ownership

- Agent: `Confucius` (`01a043b6-cd76-7b61-be16-650c7b1e3ec0`)
- Finding: the outer Runner launches the official CLI, launches Workbench, polls status, and reads evidence. It has no Playwright, Puppeteer, WebDriver, Selenium, external CDP, page/DOM, tab, clipboard, or direct ChatGPT control path.
- Ownership finding: actual navigation, page probes, observer state, and Composer operations belong to Workbench main/WebGPT workspace/page adapter/internal debugger. FIX ROUND 4 must keep recovery inside that boundary.
- Caveat: the legacy positive smoke path contains `control auto`; the new reconcile-only mode avoids that path and does not acquire control until exact durable correlation has passed.

## SA2 — Exact Attempt #2 correlation

- Agent: `Popper` (`01a043b6-ce1d-7be2-ac38-fd30ba764fc7`)
- Finding: the Request Journal has one exact WebGPT Request for the declared project/role/target, with the declared prompt and semantic hashes, `sendStartedAt` present, `RECOVERY_REQUIRED`, `REQUEST_NOT_VERIFIABLE`, no result path/hash/bytes, and a non-terminal generating page observation.
- Finding: the role registry is bound to the stable Planner Chat identity and the URL aliases are equivalent under the shared identity function.
- Blocker: the current Automation SQLite snapshot does not contain the exact FIX ROUND 4 ActionIntent, Attempt #1, Attempt #2, receipt, provider request external ref, provider observation external ref, or project correlation needed to prove that the Request belongs to the declared ActionAttempt #2.
- Safety conclusion: `submittedAt` being null does not restore retry budget; `sendStartedAt` already consumed the provider-attempt budget.

## SA3 — Result and promotion

- Agent: `Gibbs` (`01a043b6-cef7-7a03-b398-9fc3b40bed32`)
- Finding: no existing response can currently be safely attributed to Attempt #2. The documented 144-byte completed response is evidence for Attempt #1 and cannot be transferred to Attempt #2.
- Required recovery behavior: reconcile only the exact existing Request after exact durable correlation, then require strict envelope/schema validation, K1-B validation, and exactly-once promotion guards. No resubmit is permitted.
- Additional risk noted: nullable result-integrity fields, nullable baseline assistant count, and a legacy Planner service bypass require the current fail-closed production guard.

## Converged decision

All three investigations converge on `BLOCKED_MISSING_CORRELATION`. The Workbench reconcile-only entry therefore stops before AUTO_CONTROL, page navigation, Composer access, provider reconciliation, or plan promotion. It records bounded hashes and IDs only; it does not record raw prompt or response content.
