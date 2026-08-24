# WEB-REVIEW-SUBMIT-1 设计与实现边界

## 目标

提供一次 CLI 调用完成 Review ZIP + 摘要的网页提交：

```text
Workbench CLI
  -> Control Plane
  -> WebGptReviewSubmissionService
  -> existing WebGptWorkspace / WebContentsView / Page Adapter
  -> SENT or typed failure
```

没有引入第二个浏览器、第二个 Session、Playwright、系统文件选择器或全局剪贴板。

## CLI

```powershell
Codex Workbench V1.exe webgpt review-submit `
  --zip "D:\review\PACKAGE.zip" `
  --summary-file "D:\review\SUMMARY.txt" `
  --target current `
  --json
```

`--target` 也接受显式 `https://chatgpt.com/...` Chat URL；不接受任意网站。`--target-url` 是兼容别名。摘要从本地 UTF-8 文本读取，ZIP 与摘要只在本次服务调用中读取并计算哈希。

## 状态与错误

```text
PREPARING -> TARGET_READY -> FILE_ATTACHED -> MESSAGE_READY -> SENDING -> SENT
```

失败状态包括 `ALREADY_SENT`、`TARGET_NOT_READY`、`AUTH_REQUIRED`、`FAILED_RETRYABLE`、`FAILED_FINAL`、`UNKNOWN_AFTER_SEND`、`CONTROL_NOT_AVAILABLE`。

发送成功的最低确认是 marker 命中或用户消息数量增加；仅 Composer 变空不算成功。发送动作已经发生但确认超时，必须先查找同一 marker 的用户消息，再决定是否重试。

## 文件上传与 Composer

Page Adapter 通过语义 DOM 脚本定位可见的附件入口和 `input[type=file]`，使用 Electron WebContents Debugger 的 `DOM.setFileInputFiles` 设置文件。摘要写入可见 `DIV.ProseMirror`/contenteditable，使用既有脚本与 `insertText` 受控回退。没有坐标点击、系统文件对话框或全局剪贴板。

## 幂等 Ledger

Ledger 路径：`<Electron userData>/webgpt/review-submissions/submissions.jsonl`。

默认 `submissionId = SHA256(canonicalTarget + ZIP SHA256 + summary SHA256)`。调用方显式提供 `idempotencyKey` 时，同一 key 的目标、ZIP 或摘要发生变化会返回 `IDEMPOTENCY_CONFLICT`，不会复用或重新发送。已有 `SENT` 返回 `ALREADY_SENT`。

该 Ledger 是 Review Submission sidecar，仅服务于提交恢复与幂等，不替代 Native Thread / Native Turn / Native Item，也不成为 Workbench Conversation truth。

## 架构不变量

- V1 Frozen Core 未改变。
- Native Thread 仍是唯一 Conversation identity。
- WebGPT 仍是 Workbench 的既有顶层能力，不下沉到 Automation。
- WebGPT Submission Service 只编排一次受控网页动作，不等待 GPT 回复，不解析 Review Gate。
