# WEB-REVIEW-SUBMIT-1 性能与真实基线

## 独立 Runner 真实基线

来源：`D:\办公\AI\Codex_ChatGPT_Submission_Runner`，HEAD `4bbd6a0abfcda4b3841f58a037bce203450b187b`。

| 指标 | 结果 |
| --- | ---: |
| 连续运行 | 10 |
| SENT | 10/10 |
| duplicate_send_count | 0 |
| median | 13,436 ms |
| p90 | 14,742 ms |
| max | 15,570 ms |
| 原始目标 median <=10 s | FAIL（差 3,436 ms） |
| 原始目标 p90 <=15 s | PASS |

分阶段的较慢部分是浏览器导航、Composer 稳定等待和 send 后页面响应，而不是重复发送。随后单次运行总耗时 10,644 ms；相同输入再次调用约 476 ms 返回 `ALREADY_SENT`，没有触发浏览器发送。

## Workbench 集成目标

Workbench 不复制上述 Runner 的浏览器，因此不能直接把 Runner 的 10 次计时当作 Workbench 集成性能 Gate。Workbench 集成只新增单次 Control Plane 操作预算 120 秒（CLI 125 秒），并复用既有 Arbiter、Page Adapter 和 WebContentsView。

必须在已登录 Workbench WebGPT 会话中补充一次正向 packaged smoke，记录：

```text
targetReadyMs
attachMs
summaryMs
sendMs
verifyMs
totalMs
state
verification
```

本报告不把尚未在该会话中执行的正向结果写成 PASS，也不通过重复真实 Prompt 来追求统计数字。

## Workbench packaged lifecycle evidence

本轮使用隔离 user-data-dir，未读取或导出用户登录态：

| smoke | 结果 | elapsed | Prompt |
| --- | --- | ---: | ---: |
| warm packaged Workbench + CLI | `CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL` | 304 ms | 0 |
| cold packaged CLI auto-start（修复后） | `webgpt status --json` 返回 `READY / WEBGPT_UNAVAILABLE` | 1,204 ms | 0 |

warm 结果说明 CLI 单次调用、Control Plane typed failure 和进程退出已收口；它不是正向网页提交。冷启动结果保留为边界证据，不能替代已运行 Workbench + 已登录 WebGPT 会话的正向 `SENT` smoke。
