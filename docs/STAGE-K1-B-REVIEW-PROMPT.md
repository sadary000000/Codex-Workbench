# STAGE-K1-B Review Prompt

请只审查本 ZIP 中的 STAGE-K1-B Validator/JIT scope。请明确返回独立字段：

```yaml
Gate: PASS | FIX_REQUIRED | BLOCKED | REDESIGN
Status: <explicit status>
```

不要把 `PASS_CANDIDATE` 当作 `Gate: PASS`。本轮不包含 GPT Planner、Provider、Step execution、真实 Prompt、业务 Chat、K1-C 或 K1-D。
