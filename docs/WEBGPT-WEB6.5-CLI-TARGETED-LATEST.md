# WEBGPT-WEB6.5 — CLI 定向读取 / Windows 输出 Gate Fix v2

## 结论

```yaml
stage: WEB-6.5 CLI Targeted Latest Read
result: FIX_REQUIRED
gate_fix_commit: 0d8a39f
new_real_prompts: 0
v1_frozen_core_changed: NO
web6_6_started: NO
```

本轮没有把失败包装成 PASS。共享文本 writer、Raw Control Plane、`latest --out`、目标 Chat 读取和 Role 读取均通过；但用户要求的**无 Electron 参数分隔符**调用：

```text
Codex Workbench V1.exe webgpt chat latest --url <Chat URL> --out <absolute-temp> --json
```

在 Windows + Electron 43.3.0 原生启动层仍以 `0xFFFFFFFF` 退出，未产生 stdout/stderr 或输出文件。加入 Electron 参数分隔符后的等价调用通过：

```text
Codex Workbench V1.exe -- webgpt chat latest --url <Chat URL> --out <absolute-temp> --json
```

因此当前 Gate 是 `FIX_REQUIRED`；不能把安全分隔符 workaround 冒充为原始命令已修复。

## Scope

### In scope

- `webgpt latest --out`、`webgpt chat latest --url ... --out`、`webgpt role latest ... --out` 的统一文本输出生命周期。
- Windows Node `execFile` 的冷启动、Control Plane、目标导航、Lease 释放和文件持久化顺序。
- 目标 Chat 精确读取、临时 Role Binding 读取和恢复。
- WEB-5 recovery/idempotency 自动回归，不重做真实 Prompt 中断实验。

### Out of scope

- 不进入 WEB-6.6；不新增 Automation、Planner、Reviewer 或 Workflow。
- 不修改 Native Thread / Turn / Item、V1 Runtime Registry、Conversation truth 或 Browser 架构。
- 不发送 Prompt，不扫描历史 Chat，不读取 Cookie/Token/Browser Profile。

## Root cause evidence

### Reproduction

使用最新打包 EXE、Node `execFile`、`shell: false`、绝对临时路径和已完成 Chat：

| 调用 | exitCode | signal | stdout/stderr | 文件 |
|---|---:|---|---:|---|
| `chat latest --url <URI> --json` | 0 | null | 正常 JSON / 0 | N/A |
| `chat latest --url <URI> --out <absolute> --json` | 4294967295 (`0xFFFFFFFF`) | null | 0 / 0 | 不存在 |
| Raw Control Plane 同等 `chat.latest + out` | 正常 | N/A | JSON | 26 bytes |
| `latest --out <absolute> --json`（目标 Chat 已打开） | 0 | null | 正常 JSON / 0 | 26 bytes |
| `-- webgpt chat latest --url <URI> --out <absolute> --json` | 0 | null | 正常 JSON / 0 | 26 bytes |

当 URI 参数后跟带值选项时，`https://...`、`file://...` 等合法 URI 均可复现该原生退出；非 URI 字符串不会复现。加 `--` 后由应用解析 CLI 参数，Control Plane 与 writer 均正常。这证明失败发生在 Electron 原生参数边界，早于 `main.ts`、Control Plane 和文件 writer；增加等待不能修复。

## Implementation

- `src/main/webgpt-output.ts`：新增唯一文本输出 helper。
  - `open(outputPath, "wx")`，拒绝覆盖。
  - UTF-8 Buffer 写入。
  - `sync()` 完成持久化，再 `close()` 文件句柄。
  - 冲突和写入错误由上层映射为明确错误。
- `src/main/main.ts`：`latest`、`chat latest`、`role latest` 统一调用该 helper；`result --out` 也复用，未复制三套输出语义。
- CLI 解析器保留并测试 Electron `--` 参数分隔符形式；没有引入 shell 或 `cmd /c`。

## Real Gate

### Chat latest

- 目标 Chat `chat latest --json`：PASS，`textLength=26`，结果 hash 为 `b3bf787547cc7db959cab5609f672adde34d91fe4ea38a0949922dbb2f8a94f7`。
- 原始无分隔符 `--out`：FAIL，`0xFFFFFFFF`，无文件。
- 加 `--` 分隔符：PASS，exit `0`、signal `null`、文件 26 bytes，文件 hash 与读取结果一致。
- stdout 仅为 JSON 元数据，未重复输出 Assistant 正文。

### Role latest

- 使用测试 Project 的临时 PLANNER Binding 指向同一已完成 Chat；不发送 Prompt。
- `role latest --out --json`：PASS，exit `0`、signal `null`、文件 26 bytes，hash 一致。
- 读取期间未 silent rebind；原 Binding 已恢复，恢复后 URL/状态一致。

### Cold start

- Workbench 未运行时，Node `execFile` `webgpt status --json`：exit `0`，`signal=null`，约 2.3 s，Workbench `READY`。
- GUI 进程保持运行。
- 目标 Chat 重新读取后 `latest --out`：PASS。

## Regression / automated verification

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，191/191 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS |
| secret scan | PASS；未发现凭据形态值 |

WEB-5 recovery/idempotency：自动化 regression PASS；本轮按指令不重新发送 Prompt，不重复执行 fresh in-flight restart/no-resend Real Gate。

## Privacy / evidence boundary

报告和审查包只记录状态、计数、长度、hash、错误码、退出码、耗时和受限 URL 形态；不包含 Prompt、Assistant 正文、Cookie、Token、Browser Profile 或私人聊天内容。

## Known limitation / blocker

Electron 43.3.0 的 packaged EXE 需要在应用参数前使用 `--`，才能把合法 URI 后的 CLI value options 从 Electron 原生命令行解析中隔离出来。现有应用 JavaScript 无法在原生退出后补救。要让用户完全不写 `--` 的原始命令也通过，需要修改外层原生 launcher 或采用固定的 `--` 调用约定；本轮禁止引入新的 launcher，因此保留为 `FIX_REQUIRED`。

## Boundary

不进入 WEB-6.6，不自动提交 GPT，不自动发送任何新 Prompt。
