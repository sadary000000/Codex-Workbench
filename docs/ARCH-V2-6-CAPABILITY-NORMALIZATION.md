# ARCH-V2-6 Capability Normalization

The WebGPT adapter maps local control facts to neutral facts:

| Provider fact | Neutral code |
|---|---|
| runtime not ready | `TARGET_UNREACHABLE` |
| session not authenticated | `UNAUTHENTICATED` |
| browser operation occupied | `BUSY` |
| all required facts ready | `AVAILABLE` |

Submission requires an `AVAILABLE` fact. A denied capability fails before input resolution or RoleSession submit, and the negative test asserts submit count remains zero.
