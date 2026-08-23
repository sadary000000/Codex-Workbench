# ARCH-V2-4 Journal Safety Evidence — FIX ROUND 3

## Measurement

```yaml
path: C:\Users\sadar\AppData\Roaming\codex-workbench-v1\webgpt\requests\requests.json
before_sha256: E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B
after_sha256: E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B
before_bytes: 118057
after_bytes: 118057
sha_unchanged: true
real_business_prompts: 0
```

The hashes were measured immediately before and after the isolated WEB-6.4 and WEB-6.6 smokes. Those smokes used temporary user-data directories, so they did not target the production Journal.

## Boundary

- No full Journal content is copied into the review package.
- No prompt body or response body was logged.
- No Cookie, Token, Password or browser profile is included.
- This is a Round 3 unchanged measurement, not a claim that the Journal has never changed. The historical Round 1 mutation remains disclosed in `ARCH-V2-4-HISTORICAL-JOURNAL-EVIDENCE.md` and prior Round 2 reports.
