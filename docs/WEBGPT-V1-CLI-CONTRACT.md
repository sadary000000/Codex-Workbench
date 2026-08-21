# WebGPT V1 Official CLI Contract

## 官方入口

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
```

同目录：

```text
Codex Workbench V1.exe          Desktop Runtime / GUI / Browser Host
Codex Workbench CLI Runtime.exe 同包内部转发运行时，不是第二 WebGPT Core
```

官方 CLI front door 使用 Node `execFile` 等价的 `shell: false` 传参，不能依赖 PowerShell/cmd 拼接、Electron `--` 分隔符或窗口坐标。CLI 通过已认证本机 Named Pipe Control Plane 复用现有 GUI/Browser Runtime。

## 全局输出约定

| 模式 | stdout | stderr | exit code |
|---|---|---|---:|
| human success | 命令名和格式化 JSON | 空 | 0 |
| human failure | 空 | `COMMAND: ERROR [CODE] message` | 1/2 |
| `--json` success | 单行 JSON | 空 | 0 |
| `--json` failure | 单行 JSON | 空 | 1/2 |

参数错误 canonical 为 `INVALID_ARGUMENT` / exit 2；Control Plane、业务或运行时错误 exit 1。`--out` 只用于受支持的文本读取/结果命令，接受相对或绝对输入但最终必须在允许路径内，使用 UTF-8、独占创建且写入关闭后才报告成功；输出失败不能伪称成功。CLI Runtime 缺失、wrapper 启动失败和 Electron 未处理异常在 `--json` 下仍返回单行 JSON Envelope。

## 命令矩阵

| 命令 | 必要参数 | 结果 |
|---|---|---|
| `webgpt status` | 无 | runtime/page/control health |
| `webgpt open` | 无 | 打开/准备单一 Browser Runtime |
| `webgpt current` | 无 | 当前页 bounded URL/state |
| `webgpt close` | 无 | graceful close；无实例时 `WORKBENCH_NOT_RUNNING` |
| `webgpt latest` | 可选 `--out <file>` | 当前安全 latest 读取 |
| `webgpt screenshot` | `--out <png>` | debug/evidence screenshot |
| `webgpt control user` | 无 | USER_CONTROL |
| `webgpt control auto` | 无 | AUTO_CONTROL |
| `webgpt new-chat` | 无 | 新 Chat 页面动作 |
| `webgpt open-chat` | `--url <chat-url>` | 精确 Chat URL 导航 |
| `webgpt chat latest` | `--url <chat-url>`；可选 `--out` | 目标 Chat latest |
| `webgpt send` | `--text` 或 `--file`；可选 `--idempotency-key` | Request identity |
| `webgpt wait` | `--request-id`；可选 `--timeout-ms` | 等待，不等同 cancel |
| `webgpt result` | `--request-id`；可选 `--out` | 读取已确认结果 |
| `webgpt request status` | `--request-id` | 状态/reconcile |
| `webgpt request list` | `--active` | active Request 列表 |
| `webgpt project inspect` | `--name <project-name>` | bounded DOM inspection |
| `webgpt project open` | `--name <project-name>` | Project route/context confirmation |
| `webgpt project create` | `--name <project-name>` | confirmed remote Project identity |
| `webgpt project new-chat` | `--name <project-name>` | Project Chat context；无 Prompt 不伪造 Chat |
| `webgpt role list` | `--project <id>` | Project roles |
| `webgpt role status` | `--project <id> --role <role>` | exact binding status |
| `webgpt role new` | `--project <id> --role <role>` | PENDING/explicit binding lifecycle |
| `webgpt role bind` | `--project --role --url`；可选 `--replace` | exact Chat binding |
| `webgpt role open` | `--project --role` | 精确目标 Chat 导航 |
| `webgpt role latest` | `--project --role`；可选 `--out` | 精确目标 latest |
| `webgpt initialize` | Control Plane protocol/client fields | handshake/capability |

Role 值仅允许 `REQUIREMENT`、`PLANNER`、`REVIEWER`。Project name 采用 bounded exact/semantic DOM matching；CLI 不使用坐标和固定 XPath 深度。

## 协议

```text
protocolVersion = 1.0
wire version    = 1
initialize      = modern requests required
transport       = authenticated local Named Pipe
```

初始化后，业务请求绑定 `sessionId`、`clientInfo` 和 capability。协议 Schema 单一来源为 `src/shared/webgpt-control-plane-contract.ts`，构建产物为 `contracts/control-plane.schema.json`。版本不匹配返回 `VERSION_MISMATCH`，未支持能力返回 `CAPABILITY_NOT_SUPPORTED`。

## Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "BUSY",
    "message": "资源当前被占用。",
    "retryable": true,
    "retryAfterMs": 250,
    "userAction": "retry",
    "details": {}
  }
}
```

canonical code：`INVALID_ARGUMENT`、`NOT_FOUND`、`BUSY`、`OVERLOADED`、`TIMEOUT`、`RECOVERY_REQUIRED`、`USER_CONTROL`、`VERSION_MISMATCH`、`CAPABILITY_NOT_SUPPORTED`、`TARGET_CHAT_MISMATCH`、`INTERNAL_ERROR`。

## 不变量

- CLI 不创建第二 Conversation/Transcript/Task truth。
- `--out` 不把错误写成成功，也不覆盖已有不一致结果。
- Target mismatch、Role mismatch、Project 未确认时 fail-closed。
- `wait` timeout 不触发 Prompt retry。
- CLI `close` 通过 graceful Electron quit 路径，不强杀 Workbench。
- 本契约不包含 Cookie、Token、Browser profile 或私人聊天内容。
