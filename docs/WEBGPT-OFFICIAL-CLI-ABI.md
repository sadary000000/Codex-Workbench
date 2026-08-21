# WebGPT 官方 CLI ABI

## 状态

```yaml
stage: WEB-6.5 Final
result: FIX_REQUIRED
public_cli: Codex Workbench CLI.exe
gui: Codex Workbench V1.exe
no_user_separator: PASS
shell: NO
new_real_prompts: 0
```

本文冻结当前可审查的外部 CLI 边界。它不把 CLI 变成第二套 WebGPT Runtime，也不改变 V1 Frozen Core 的 Native Thread / Turn / Item 事实源。

## 正式入口

CLI 与 GUI 放在同一个 `dist\package` 目录：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI Runtime.exe
```

用户不需要 Electron 参数分隔符，支持的调用形态是：

```text
Codex Workbench CLI.exe webgpt status --json
Codex Workbench CLI.exe webgpt open --json
Codex Workbench CLI.exe webgpt close --json
Codex Workbench CLI.exe webgpt control auto --json
Codex Workbench CLI.exe webgpt latest --out <absolute-file> --json
Codex Workbench CLI.exe webgpt chat latest --url <chat-url> --out <absolute-file> --json
Codex Workbench CLI.exe webgpt role latest --project <project-id> --role <role> --out <absolute-file> --json
```

参数由 Node `execFile` 直接传递，`shell: false`。CLI front door 不调用 `cmd.exe`、PowerShell 或 shell 拼接，也不要求用户输入 `--`。

## 边界与链路

```text
Codex Workbench CLI.exe
        │  same-package stdio firewall
        ▼
Codex Workbench CLI Runtime.exe
        │  shared parser + runWebGptCli
        ▼
per-user authenticated Control Plane
        │
        ├─ 已有 Workbench：复用同一个 GUI Workbench / WebGPT Runtime
        └─ 冷启动：只按需启动同目录 Codex Workbench V1.exe
```

CLI front door 只负责 argv/stdio、子进程转发和退出码；真正的 WebGPT 操作仍由现有 Control Plane、Request Manager、Browser Lease、Page Adapter 和 Role Registry 完成。CLI 不创建 Conversation truth、Transcript truth、Task truth 或隐藏替代 Chat。

## 正常关闭

```text
Codex Workbench CLI.exe webgpt close --json
```

该命令通过已认证的 Control Plane 请求 Workbench 走现有 Electron `before-quit` 清理路径，返回
`closeMode: "GRACEFUL"` 后再退出。它不强杀进程、不操作窗口坐标，也不使用 Windows 应用控制。
当没有正在运行的 Workbench 实例时，返回 `WORKBENCH_NOT_RUNNING`，不会为了执行 close
而冷启动新的 GUI。

## 输出 ABI

- `--json`：stdout 是一条 JSON 响应；错误也保持 JSON，退出码为 `0`（成功）、`1`（Control Plane/运行时业务错误）、`2`（CLI 参数错误）。
- `--out <absolute-file>`：只适用于受支持的文本读取命令；使用 UTF-8、独占创建、写入同步并关闭后才返回成功。
- `--out` 成功时 stdout 只返回元数据，不重复输出 Assistant 正文。
- 目标 Chat 不匹配、Role 目标不可确认、输出文件冲突等情况 fail-closed，不 fallback 到当前页面、不换 nativeThread/Chat、不重发 Prompt。

## 冷启动 / 热连接证据

2026-08-21 使用最新 package、Node `execFile`、`shell: false` 验证：

- 冷启动 `webgpt status --json`：CLI exit `0`，Workbench `READY`；首次仅查询 Workbench 时 WebGPT 可能仍为 `UNAVAILABLE`，随后 `webgpt open --json` 初始化 Browser Runtime。
- `webgpt open --json`：exit `0`，`ready=true`。
- 随后的 `webgpt status --json`：Workbench/WebGPT 均 `READY`。
- `webgpt control auto --json`：exit `0`，状态为 `AUTO_CONTROL`。
- `workbenchInstanceId=82db6339-ec6d-45b3-a645-2638e8c8aa41`、`webgptRuntimeId=70b3396a-dff3-431e-be33-306f517c69ea` 在 open/status/control-auto 响应中保持一致。
- GUI 与 CLI 均未因 CLI 调用创建第二个 Workbench 主窗口。

## 当前 Gate 结论

官方 CLI front door、无分隔符 ABI、同实例 Control Plane、`latest --out` 与 `chat latest --out` 已有真实通过证据。当前不能把整套 ABI 标为 PASS：已有 PLANNER Role Binding 在本次真实 `role latest --out` 中被 ChatGPT 页面重定向为非目标页面，返回 `WEBGPT_TARGET_CHAT_MISMATCH`，且没有生成输出文件。该失败是安全拒绝，不是错误发送。

此外，当前没有可用的原生 C/C++ 编译器或 .NET SDK；打包使用 Windows inbox `csc.exe` 生成 CLI front door。因此该 6.5 版本的 CLI PE 依赖目标 Windows 的 .NET Framework，不是 self-contained native PE。这是待 GPT 审查的明确限制，不能隐瞒为“零运行时依赖”。

## 安全边界

审查证据不包含 Cookie、Token、Browser Profile、Prompt 正文、Assistant 正文或用户私人聊天内容。真实测试本轮 `new_real_prompts=0`，只读取既有完成记录和既有 Role Binding。
