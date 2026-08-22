# ARCH-V2-3 WebGPT Query Evidence

## Query paths

- `WebGptRequestManager.requestStatus(requestId)` 默认 `reconcile=false`。
- `webgpt.request.status` 只读取 Request Journal 记录，不自动导航、恢复或提交 Prompt。
- `webgpt.request.list --active` 只读取现有 Journal 的非终态摘要。
- `webgpt.latest` / `webgpt.current` 保持现有页面 probe 语义；目标 Chat 的 `chat.latest` 与 role latest 是显式目标导航型读取，不把导航伪装成 status 查询。

## Evidence

- `tests/webgpt-request-manager.test.ts`: `WebGPT reconciliation is explicit and status does not perform it`。
- 同一测试验证 `requestStatus()` 不打开目标 Chat，而显式 `reconcileRequest()` 才打开目标 Chat；不重放原 Prompt。
- `tests/webgpt-command.test.ts` 与 `tests/webgpt-control-contract.test.ts` 验证 `request reconcile --request-id` 及 Control Plane allowlist。

## Realism boundary

本阶段没有向 ChatGPT 网页发送真实 Prompt，也没有读取 Cookie、Token 或私人聊天内容。上述证据是隔离的高保真 runtime fixture；真实 WebGPT 页面 smoke 仅在不需要 Prompt 的现有回归范围内执行并单独记录。
