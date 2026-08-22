# AUT-2 Fix11 — Canonical Role Reachability

## 结论

Role Registry 中三项绑定记录存在，但本次没有获得 Workbench WebGPT Runtime 的实时 Browser 页面，因此只能判定为 `NOT_PROVEN`，不能写成 PASS。

| Role | Registry 状态 | Registry target | 本次实时可读性 |
| --- | --- | --- | --- |
| REQUIREMENT | BOUND | `https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc` | NOT_PROVEN |
| PLANNER | BOUND | `https://chatgpt.com/c/6a865d2c-69fc-83ee-9845-1c236f19d7b9` | NOT_PROVEN |
| REVIEWER | BOUND | `https://chatgpt.com/c/6a865d36-a53c-83ee-aa28-d4cbd50c85b3` | NOT_PROVEN |

Project ID：`371c3fb8-30ac-4943-9584-1915045ea34d`。

## Runtime 证据

只读打包状态探针得到：

```text
workbench: READY
webgpt: UNAVAILABLE
controlOwner: null
currentUrl: empty / not observed
pageHealthy: false
browserResource: null
```

这不是 Codex 当前 ambient 浏览器页面的状态；不能把 ambient URL 当成 Workbench WebGPT 页面。由于没有实时页面，未执行导航、点击、输入或 Prompt。

## 身份调查结论

- 历史 Fix6 的 `g-p-...` 目标已由用户确认删除；属于 `DELETED_CHAT` / `STALE_BINDING` 历史证据。
- 历史 Fix5/Fix10 证明存在 `IDENTITY_SOURCE_MISMATCH`：页面导航可以成功，但 `chat/latest` 身份/历史确认失败。
- 当前证据没有证明 `g-p-` 被错误改写成 `g-`，所以 `ROUTE_ALIAS` 和 `CANONICALIZATION_BUG` 仍是 `NOT_PROVEN`。
- 生产代码继续要求 `target URL == actual page URL == latest response chatUrl`，不允许仅按 conversationId、当前页面或 fallback Chat 认定成功。

## Gate 影响

精确 REQUIREMENT Chat 只有在真实 `open/readLatest` 成功且 Project/Role/Target 全部一致后，才能解锁 AUT-2 的两条业务 Prompt。当前不满足，故 AUT-2、AUT-3 均未运行真实业务 Prompt。
