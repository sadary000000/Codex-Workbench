# ARCH-V2-5 Reservation Lifecycle

~~~text
reserve
  |-- pre-dispatch rejection --> release exactly once
  |-- commit immediately before side effect --> committed
                                  |-- success/failure/unknown: no refund
~~~

## Rules

1. reserve creates one active reservation keyed by operation and correlation.
2. Duplicate correlation is rejected; it cannot create a second provider call.
3. Release is idempotent and only valid before commit.
4. Commit is the irreversible local boundary immediately before dispatch.
5. Any outcome after commit, including transport exception or unknown provider
   result, remains consumed and requires reconciliation rather than refund/replay.
6. Exhaustion is rejected before the provider/browser call.

## Evidence

arch-v2-5-production-consumers.test.ts covers:

- release twice leaves usage at zero;
- commit followed by release does not refund;
- duplicate and exhaustion do not reach the fake provider;
- PROMPT/RETRY/NEW_CHAT use one authority and correlation.

The PolicyVersion is durable; reservation counters currently live in the single
Workbench host authority and are not durable across a process restart. This is a
known limitation, not a hidden second authority.
