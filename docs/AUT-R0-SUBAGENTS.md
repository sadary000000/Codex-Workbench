# AUT-R0 Subagent Record

All four subagents were read-only audits. They completed naturally before the
Gate; none was terminated for time or replaced with a guessed result.

| Agent | Assignment | Result | Adopted |
|---|---|---|---|
| Popper (`01a03363-c74c-7cd0-a397-aba81e48ddd4`) | Legacy Requirement caller/provider boundary | No active legacy production caller remained after the authenticated Requirement Control Plane entry; paused legacy adapter remains test-only/read-only. | Yes: caller inventory and boundary checks |
| McClintock (`01a03363-c7f7-7540-bf91-686251b0c9b1`) | InputRef, persistence, security boundary | InputRef is opaque, process-owned, hash/length/owner checked; raw prompt is not durably persisted; restart resolution fails closed. | Yes: contract and security evidence |
| Laplace (`01a03363-c8ca-7ee3-ac43-bc65843549f8`) | Policy, Action ledger, recovery regression | Required PolicyVersion → ActionIntent → ActionAttempt → ProviderRequest → Observation/Receipt chain remains mandatory; unknown outcomes cannot blind resend. | Yes: targeted regression coverage |
| Noether (`01a0336d-3ada-7143-a29c-8d6f7bbc7b69`) | Independent challenge review | Found composition-root caller gap, pre-submit round correlation gap, and ProviderResult identity validation gap. | Yes: all three were fixed and tested |

The four audits did not authorize scope expansion into Automation, Planner,
Reviewer, browser UI, or a second conversation/requirement truth.
