# WEB-REVIEW-SUBMIT-1 测试与回归

日期：2026-08-24

## 自动化结果

| 命令 | 结果 |
| --- | --- |
| `npm run check` | PASS |
| 定向 `tests/webgpt-review-submission.test.ts` | 4/4 PASS |
| `npm test` | 406/406 PASS |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run package:win`（isolated output） | PASS |
| `git diff --check` | 无 whitespace error（仅已有 CRLF 警告） |

新增/覆盖的契约包括：

1. 单次显式 CLI 命令，不猜目标；
2. 首次发送后相同语义返回 `ALREADY_SENT` 且不再次调用浏览器；
3. 显式幂等 key 发生目标/ZIP/摘要漂移返回 `IDEMPOTENCY_CONFLICT`；
4. `UNKNOWN_AFTER_SEND` 必须先 reconcile，只有确认不存在同一消息才允许再次发送；
5. 发送确认不接受 Composer 清空作为唯一证据。

## 打包证据

打包使用独立临时输出目录，避免删除或覆盖用户当前 dirty 的标准 `dist/package`：

```text
C:\Users\sadar\AppData\Local\Temp\codex-workbench-web-review-submit-1-7770ccb3d8ee4210bb3717734f8b4a17
```

该目录的 GUI 与 CLI 包均由当前 Workbench 源码构建，`npm run package:win` 返回 PASS。

## 真实 smoke 边界

独立 Runner 已有真实网页证据，详见 `WEB-REVIEW-SUBMIT-1-BENCHMARK.md`。Workbench 的正向网页提交依赖其自身 WebGPT WebContentsView 的登录态和 AUTO_CONTROL，不能用 Codex 内置 Browser 或独立 Runner 代替。本轮隔离未登录 profile 的实际结果是 `CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL`，没有发送 Prompt；不应输入账号密码或继续发送。

修复后的 packaged CLI lifecycle smoke：冷启动 `webgpt status --json` 约 1,204 ms 返回；`webgpt open --json` 约 8,492 ms；warm `status` 约 241 ms；`close` 约 217 ms。均未发送 Prompt，关闭后没有留下目标 Workbench 进程。

未执行 GPT 回复等待；本阶段只验证用户消息进入 ChatGPT 页面。
