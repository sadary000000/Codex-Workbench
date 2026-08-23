# ARCH-V2-5 FIX ROUND 1 Regression Evidence

| Regression | Result | Evidence |
|---|---|---|
| ARCH-V2-1 Native/Map boundaries | PASS | source full suite and prior stage evidence |
| ARCH-V2-2 Shared Host/generated protocol | PASS | npm run test:protocol:arch-v2-2 |
| ARCH-V2-3 Query/Command/Reconcile | PASS | source full suite and prior stage evidence |
| ARCH-V2-4 External Action safety | PASS | targeted ARCH-V2-4 tests and source full suite |
| V1 Frozen Core | PASS | selected source diff contains no Native identity redesign |
| No real business Prompt | PASS | realBusinessPrompts=0 |

The read-only WEB-6.6 Control Plane smoke used the running Workbench descriptor.
VERSION_MISMATCH and CAPABILITY_NOT_SUPPORTED fixtures passed. The status subprocess
returned legacy package exit code 2147483651 because the standard package is already
running; that launch caveat is recorded and is not reclassified as a protocol pass.
