# GPT Review Submission — ARCH-V2-8 FIX ROUND 4

请审查本轮 ABI-native compatibility gate。Round 3 的 P1 根因是错误要求 Codex 0.147.0 `InitializeResponse` 返回不存在的 `protocolVersion` / response `capabilities`。本轮已依据真实 resolver 与生成 schema 改为：

```text
InitializeRequest  = clientInfo + capabilities.experimentalApi
InitializeResponse = codexHome + platformFamily + platformOs + userAgent
```

请重点核对：

1. response 校验是否严格但只针对 verified generated schema；
2. request capability、binary provenance、schema provenance、server identity 是否仍 fail closed；
3. Native Thread、Shared Host、Map、Project Map 是否继续走 shared bootstrap；
4. negative gate 是否在 initialize 之前阻止 Thread/Turn/Prompt；
5. 是否保持 V1 Frozen Core 的 Native Thread/Turn/Item truth；
6. 是否有足够证据进入 final human freeze，而不是本轮自行冻结。

审查结论请使用：

```text
[ARCH_V2_8_FIX_ROUND_4_REVIEW_RESULT]
requested_gate: PASS | FIX_REQUIRED | BLOCKED
```

本轮状态：`finalFrozen=false`，`AUT-2/AUT-3=PAUSED`，真实业务 Prompt=0，真实业务 Chat=0。

