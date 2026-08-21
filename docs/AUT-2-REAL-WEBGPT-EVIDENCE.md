# AUT-2 Real WebGPT Evidence

## 测试边界

- 最大新 Chat：1（本次实际为 0）。
- 最大真实 Prompt：5（本次实际为 0）。
- 最大 repair：1（本次真实网页为 0；contract test 覆盖 1 次上限）。
- 不扫描历史 Chat，不创建 Role，不使用多账号，不并发发送。

## 已执行的打包 CLI 探针

执行脚本：`scripts/aut2-real-webgpt-smoke.ts`，通过 Node `execFile` 调用：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe webgpt status --json
```

观察结果：

```yaml
workbench: READY
webgpt: UNAVAILABLE
currentUrl: ""
pageHealthy: false
realPromptCount: 0
```

本次运行没有提供可复用的显式 WebGPT Project/REQUIREMENT binding，且 WebGPT runtime 报告 `UNAVAILABLE`，因此立即停止，没有发送真实网页 Prompt，也没有声称真实 Requirement round-trip PASS。该结果是环境阻塞/未验证，不是代码 contract 失败。

## 可验证的非网页证据

- `tests/aut2-requirement-webgpt-contract.test.ts`：协议 v1、精确 REQUIREMENT role/binding、semantic hash、bounded JSON、NEEDS_INPUT/READY/BLOCKED、最多一次 repair。
- `tests/aut2-requirement-webgpt-adapter.test.ts`：显式绑定、target mismatch fail-closed、timeout/failure/malformed response 不重发。
- `tests/aut2-requirement-service.test.ts`：服务层使用稳定 request/idempotency identity，并拒绝 current-chat fallback。
- `scripts/aut2-normal-gui-store-smoke.mjs`：正常打包 GUI 宿主启动并重新打开 Automation SQLite store，未使用 `ELECTRON_RUN_AS_NODE`。

## 结论

AUT-2 的 WebGPT integration boundary 已完成并通过 contract/unit 证据；真实网页闭环在当前环境未执行，不能写成 Real WebGPT PASS。用户后续提供已登录且绑定稳定的测试 Project/REQUIREMENT Chat 后，最多补 1 个 synthetic Prompt 即可继续取证。
