# ARCH-V2-6 Target Resolution

`createWebGptRoleTargetRef(projectId, role)` creates:

```text
webgpt-role-v1:<encoded-project-id>:<normalized-role>
```

Only the WebGPT adapter parses it. Resolution checks the provider-owned Role binding and returns `AVAILABLE`, `UNAVAILABLE`, or `UNKNOWN` with a neutral capability code. A workflow role mismatch is fail-closed. The returned resolution never includes `chatUrl`.
