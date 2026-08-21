# WEBGPT-WEB6.5 — CLI 定向读取 / Windows 官方入口收口

## 结论

```yaml
stage: WEB-6.5 Final
result: FIX_REQUIRED
official_cli_front_door: PASS
no_electron_separator_required: PASS
latest_out: PASS
chat_latest_out: PASS
role_latest_out: FIX_REQUIRED
new_real_prompts: 0
v1_frozen_core_changed: NO
web6_6_started: NO
```

本轮验证的是打包后的 `Codex Workbench CLI.exe`，调用没有使用 `--` 分隔符，也没有使用 shell。此前 Electron 原生参数边界导致的 `0xFFFFFFFF` 已不再出现：外层 CLI 现在先接收完整 argv，再把内部标记和用户参数传给同目录 CLI Runtime。

## 真实命令矩阵

| 命令 | exitCode | signal | JSON | 输出文件 | 结果 |
|---|---:|---|---|---|---|
| `webgpt status --json`（冷启动） | 0 | null | 有效 | N/A | PASS；Workbench READY |
| `webgpt open --json` | 0 | null | 有效 | N/A | PASS；WebGPT ready |
| `webgpt status --json`（热连接） | 0 | null | 有效 | N/A | PASS；Workbench/WebGPT READY |
| `webgpt control auto --json` | 0 | null | 有效 | N/A | PASS；AUTO_CONTROL |
| `webgpt latest --out <temp> --json` | 0 | null | 有效 | 26 bytes | PASS |
| `webgpt chat latest --url <existing-chat> --out <temp> --json` | 0 | null | 有效 | 26 bytes | PASS |
| `webgpt role latest --project <existing> --role PLANNER --out <temp> --json` | 1 | null | 有效 | 不存在 | FIX_REQUIRED；WEBGPT_TARGET_CHAT_MISMATCH |
| 非法 `--out` 值 | 2 | null | 有效 | N/A | PASS；CLI_INVALID_ARGUMENT |

`latest` 与 `chat latest` 文件 SHA-256 均为 `b3bf787547cc7db959cab5609f672adde34d91fe4ea38a0949922dbb2f8a94f7`，stdout 只含 JSON 元数据，没有重复 Assistant 正文。

## Role 失败的真实边界

PLANNER 的既有本地 Binding 仍为 `BOUND`，但在本次读取期间 ChatGPT 页面最终回到非 Chat 路由，安全检查无法确认当前页面等于 Binding 目标，返回：

```text
WEBGPT_TARGET_CHAT_MISMATCH
```

没有 fallback 到另一个 Chat，没有静默 rebind，没有替换 `chatUrl`，没有写输出文件，也没有发送 Prompt。`chat latest` 对一个已有完成记录的目标读取正常，说明问题发生在该现有 Role Binding 的真实页面可达性/稳定性，而不是 CLI argv 或文本 writer。

## 实现边界

- `tools/official-cli/Program.cs`：Windows console front door，`UseShellExecute=false`，双向转发 stdout/stderr，返回 child exit code。
- `scripts/package-win.mjs`：同包复制 GUI、CLI Runtime，并使用 Windows inbox `csc.exe` 生成 CLI front door。
- `src/main/main.ts`：官方内部模式直接走已有 `runCliInvocation` / Control Plane，不创建 GUI BrowserWindow。
- `src/main/webgpt-control.ts`：冷启动时将 fallback GUI 路径固定为同包 `Codex Workbench V1.exe`。
- `tests/official-cli-contract.test.ts`：覆盖入口、打包边界、无分隔符 parser 和官方模式静态合同。

## 已接受的待审查限制

1. 当前已有 Role Binding 的真实页面不稳定，`role latest --out` 仍需 FIX 或由 GPT 接受为环境阻塞；本轮不 rebind、不创建 Chat、不发送 Prompt。
2. 当前机器没有 .NET SDK 或原生 C/C++ 编译器，CLI front door 由 Windows inbox `csc.exe` 生成，目标机需有 Windows .NET Framework；不能声明 self-contained native PE。

## 保护边界

本轮没有修改 Native Thread / Turn / Item、Runtime Registry、Conversation truth、Request Manager 语义或 Browser 核心；没有进入 WEB-6.6；没有读取或写入 Cookie、Token、Browser Profile；没有新增真实 Prompt。
