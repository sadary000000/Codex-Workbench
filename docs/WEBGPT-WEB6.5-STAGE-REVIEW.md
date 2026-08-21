# WEBGPT-WEB6.5 Final — 官方 CLI ABI 审查报告

## Executive Summary

```yaml
stage: WEB-6.5 Official CLI ABI Final Closeout
result: FIX_REQUIRED
v1_core_changed: NO
automation_layer_changed: NO
new_real_prompts: 0
next_stage: WEB-6.6 NOT_STARTED
```

官方 `Codex Workbench CLI.exe` 已经成为可直接调用的 Windows argv/stdio 入口。用户无需输入 Electron 的 `--`，CLI 通过同包 CLI Runtime 复用现有 Control Plane，冷启动时按需复用/启动同包 GUI Workbench。入口、JSON 错误、退出码、`latest --out` 和 `chat latest --out` 已通过真实 `execFile` 验证。

整套 Gate 仍不能标 PASS：当前既有 PLANNER Role Binding 的真实页面读取返回 `WEBGPT_TARGET_CHAT_MISMATCH`，没有输出文件；同时 CLI front door 是 Windows inbox C# 编译产物，依赖目标机 .NET Framework，不能宣称 self-contained native PE。按照证据，最终状态保留 `FIX_REQUIRED`，不把失败包装成冻结通过。

## Architecture Boundary

```text
V1 Frozen Core
    └─ WebGPT Feature
        ├─ Electron Browser Runtime
        ├─ Codex Workbench CLI.exe        (public stdio front door)
        ├─ Codex Workbench CLI Runtime.exe (same-package Electron CLI host)
        ├─ Control Plane
        ├─ Request Manager
        └─ Role Registry
```

WebGPT 是 V1 上的扩展能力，不是第二套 Codex，也不是第二套 Conversation truth。Native Thread / Turn / Item、V1 Runtime Registry、Request Journal 和页面投影边界没有被重建。

## Implementation

| 文件 | 变更 |
|---|---|
| `tools/official-cli/Program.cs` | 新增无 shell 的 Windows console front door；同包转发 argv、stdout、stderr 和 child exit code。 |
| `scripts/package-win.mjs` | 输出 GUI、CLI front door、CLI Runtime；使用现有 Windows inbox `csc.exe`，不安装新软件。 |
| `src/main/main.ts` | 增加官方内部模式，直接走已有 CLI/Control Plane，不进入 GUI BrowserWindow 初始化分支。 |
| `src/main/webgpt-control.ts` | 官方 CLI 冷启动 fallback 固定到同包 GUI EXE。 |
| `tests/official-cli-contract.test.ts` | 静态 ABI、打包边界、parser 和官方模式合同。 |

没有修改 Native Thread / Turn / Item、Runtime Registry、Request Manager 的业务语义、Browser Adapter 或 V1 Frozen Core。

## Official CLI Gate

| Gate | 结果 | 证据 |
|---|---|---|
| public CLI file | PASS | `dist\package\Codex Workbench CLI.exe` |
| no user `--` separator | PASS | Node `execFile` 直接传入 `webgpt ...` |
| shell / cmd / PowerShell | PASS | `shell=false`；源代码无 shell launcher |
| invalid argv | PASS | exit 2、有效 JSON、`CLI_INVALID_ARGUMENT` |
| cold Workbench start | PASS | exit 0、Workbench READY；初次 status 可能尚未初始化 WebGPT |
| explicit WebGPT open | PASS | exit 0、`ready=true` |
| warm attach | PASS | 同 `workbenchInstanceId` / `webgptRuntimeId`，status READY |
| same Control Plane | PASS | `control auto` 和 status 复用同实例 |
| `latest --out` | PASS | 26 bytes、UTF-8、hash 一致 |
| `chat latest --out` | PASS | 26 bytes、hash 一致、目标 Chat 校验通过 |
| `role latest --out` | FIX_REQUIRED | `WEBGPT_TARGET_CHAT_MISMATCH`、无输出文件 |
| native `0xFFFFFFFF` crash | PASS | 当前官方入口矩阵未复现 |
| new real prompts | PASS | 0 |

## Runtime Identity Evidence

以下为本次 `webgpt open` → `status` → `control auto` 的安全运行标识；不包含 URL、Prompt 或页面正文：

```yaml
workbenchInstanceId: 82db6339-ec6d-45b3-a645-2638e8c8aa41
webgptRuntimeId: 70b3396a-dff3-431e-be33-306f517c69ea
sessionKey: default
control_after_auto: AUTO_CONTROL
```

这些标识在同一轮 open/status/control-auto 中保持一致，证明 CLI 不是每条命令新建独立 Workbench Runtime。

## Role Safety / Failure Evidence

已有 PLANNER Binding 仍保持本地状态；真实 `role latest --out` 无法确认页面已落到该绑定目标，返回 `WEBGPT_TARGET_CHAT_MISMATCH`。该路径：

- 不把当前页面当作目标 Role Chat；
- 不 fallback 到另一个 Chat；
- 不 silent rebind；
- 不改 `nativeThreadId` 或 Role `chatUrl`；
- 不创建 Chat；
- 不发送 Prompt；
- 不生成输出文件。

该结果是 fail-closed 的安全行为，但代表 Role latest Real Gate 尚未通过。

## Automated Verification

| 命令 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，195/195 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS |
| secret scan | PASS；限定审查文件无凭据形态值 |

## Package Provenance

```yaml
implementation_commit: e255041
freeze_commit: b36237a
review_package_commit: FINAL_HANDOFF_COMMIT
package: D:\办公\AI\Codex_Workbench_V1\dist\package
gui_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_exe_sha256: 1B83C919CD67C9247269E08767DB12E13E4F93481FFD7868F81EBA15F388DD67
cli_runtime_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
main_bundle_sha256: DEC232D46B36377DDF4E9BB29C9DBC824D5A8043B3872A8FF02D39F975EE7474
renderer_bundle_sha256: 94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
official_cli_source_sha256: 009473D4E2DE3EF4EA2DB03E42FBD1B3BF05EF4454EA5524964CC8B48A4D3648
```

Electron 外壳 EXE 与 CLI Runtime 使用同一 Electron binary hash；应用 provenance 通过 packaged resources 与 source hash 审查。CLI front door 没有独立 JS bundle，source hash 记录在上面。

## Deferred Issues

1. Role latest 的既有 Role Binding 在本次真实页面恢复中不可确认；需要下一次明确授权的 Role target 修复或人工确认，不在 Final freeze 阶段静默 rebind。
2. CLI front door 当前依赖 Windows .NET Framework；因本机无 .NET SDK / 原生编译器，本轮没有安装软件，也没有伪造 self-contained 结论。
3. 不进入 WEB-6.6，不实现 Automation、Planner、Reviewer 或 Workflow Engine。

## Privacy / Scope

测试只使用已有完成请求与已有 Role Binding 的元数据；没有扫描历史聊天、读取 Cookie/Token/Profile、写入用户私人聊天或创建新 Chat。旧 donor 和 `Auto_Agent` 均不在本轮修改范围。

## Gate

```yaml
official_cli_abi: PASS
targeted_latest_gate: FIX_REQUIRED
overall: FIX_REQUIRED
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```
