# Codex Workbench WebGPT — WEB-2 阶段审查包

状态：`PASS_CANDIDATE`

本阶段只实现统一 WebGPT Control Plane 与 CLI Foundation，不进入 WEB-3，不实现网页 ChatGPT 自动新建对话、发送 Prompt、等待 Response 或多账号。

## 1. Scope Resolution

### Stage

`WEB-2 — Unified WebGPT Control Plane + CLI Foundation`

### Goal

让 GUI、CLI 和未来 Automation 入口都复用同一个 Workbench Main、同一个 `WebGptWorkspace`、同一个 `WebContentsView`、同一个 Electron Session 和当前网页状态；CLI 只做本地薄客户端，不创建第二个 Browser Runtime。

### In scope

- Main-owned 本地 Control Plane；
- Windows per-instance Named Pipe；
- 本地动态 Control Plane descriptor 与鉴权；
- 版本化 JSON request/response；
- `status`、`open`、`current`、`screenshot`；
- `control user`、`control auto`；
- Workbench 未运行时 CLI 自动启动普通 GUI 并等待 ready；
- `workbenchInstanceId`、`webgptRuntimeId`、`sessionKey`、`revision` 同实例证据；
- CLI 错误码、退出码和截图路径安全边界；
- 保留 WEB-1 的 `--webgpt-open` 单实例兼容入口。

### Out of scope

- WEB-3：`new-chat`、`open-chat`、`send`、`wait`、`result`；
- 多账号、账号注册表和 Session 切换；
- Cookie、Token、密码导出或保存为普通账号字段；
- Playwright、Selenium、CDP、WebView2 自研自动化；
- File upload、Model switch、Multi-tab、Automation Service、Workflow、Verifier；
- V1 Native Thread / Runtime / Project / Composer / Map 事实模型重构。

### Expected product behavior

```text
GUI IPC ──────┐
CLI JSON ─────┼→ Main Control Plane → 唯一 WebGptWorkspace
未来入口 ────┘                         → 唯一 WebContentsView
                                        → 唯一 Electron Session
```

Workbench 未运行时：

```text
CLI → 读取 descriptor 失败 → 启动普通 Workbench GUI
    → 等待 Control Plane / Workbench ready
    → 返回结构化结果或有界超时错误
```

### Architecture boundary

```text
Native Thread / App Server V1 Core
            │ unchanged
            ▼
Workbench Main
  ├─ existing GUI IPC / Renderer bridge
  └─ WebGPT Control Plane (Named Pipe + JSON)
            │
            ▼
WebGptWorkspace → WebContentsView → ChatGPT page
                         │
                         └─ fixed Electron session: <userData>\webgpt\session
```

V1 核心不变量仍为：

```text
Native Thread = 唯一 Conversation identity
Native Turn / Native Item = 唯一消息和运行事实
Codex App Server = Runtime 主路径
```

### Gate

代码、契约、打包、安全边界、CLI/GUI 同实例 smoke 和 V1 真实回归通过；无 WEB-3 功能；等待 GPT 审查，不自动进入下一阶段。

## 2. Source documents

- 本轮用户提交的 `WEB-2 Unified WebGPT Control Plane + CLI Foundation` 唯一执行指令；
- `docs/WEBGPT-WEB1-CORE-WORKSPACE-FOUNDATION.md`；
- `docs/WEBGPT-ELECTRON-SPIKE.md`；
- `docs/WEBGPT-INTERNAL-OPEN-CLI-REVIEW.md`；
- `docs/BROWSER-CAPABILITY-SPIKE.md`；
- V1 冻结基线 `4a3d7c6 feat: implement webgpt core workspace foundation`。

本阶段没有把旧 Browser/App Server Spike 中的结论扩大成 WEB-3 能力。

## 3. Implementation

### Control Plane

`src/main/webgpt-control.ts`：

- `protocol version = 1`；
- Windows Named Pipe 使用每次 Workbench 实例随机 endpoint；
- descriptor 位于 `<userData>\webgpt\control-plane.json`；
- descriptor 使用随机 auth token，CLI 只在本机读取并通过 Pipe 鉴权；
- descriptor 原子发布/替换；
- server 仅接受 allowlist command；
- request 使用 `requestId`，response 不回传 auth token；
- Main handler 串行化 Control Plane 请求；
- server/CLI 都有有界 socket/整体超时；
- response identity 校验 `workbenchInstanceId`，避免连接到错误实例。

### CLI contract

```text
Codex Workbench V1.exe webgpt status --json
Codex Workbench V1.exe webgpt open --json
Codex Workbench V1.exe webgpt current --json
Codex Workbench V1.exe webgpt screenshot --out <png-path> --json
Codex Workbench V1.exe webgpt control user --json
Codex Workbench V1.exe webgpt control auto --json
```

查询响应带有：

```json
{
  "version": 1,
  "requestId": "opaque-request-id",
  "ok": true,
  "command": "webgpt.status",
  "result": {},
  "identity": {
    "workbenchInstanceId": "opaque-instance-id",
    "webgptRuntimeId": "opaque-runtime-id",
    "sessionKey": "default",
    "revision": 19
  }
}
```

未实现命令、未知参数和不支持账号参数返回 `CLI_INVALID_ARGUMENT`、非零退出码；服务端失败返回结构化 error。没有把 debug log、Cookie、Token、密码或 Session 文件内容写入响应。

截图规则：只允许 `.png`，只允许当前 cwd、Workbench userData 或系统临时目录，拒绝 WebGPT Session 目录，拒绝覆盖现有文件，限制 25 MB，并返回尺寸、字节数和 SHA256，不返回 base64。

### GUI compatibility

`--webgpt-open` 保留为兼容入口；Renderer/Preload 仍通过已有 WebGPT bridge 打开 Workspace。CLI 查询和控制不绕过 Renderer 去创建第二个 Browser，而是直接调用 Main 中的同一个 Workspace。

### Page health correction

`src/features/webgpt/runtime/webgpt-workspace.ts` 和 Main 状态聚合补充了失败页判定：`chrome-error://`、加载错误、缺少 ChatGPT composer 时不再报告健康；再次 `open` 时可以重新尝试错误页加载。一次网络瞬断不会被伪装成健康页面。

## 4. Files changed

本次实现 commit `95d35d5 feat: implement webgpt unified control plane cli` 包含：

- `src/main/webgpt-control.ts`：Control Plane、descriptor、Named Pipe、CLI client；
- `src/main/webgpt-command.ts`：CLI allowlist/parser；
- `src/main/main.ts`：Main server、身份、请求队列、CLI auto-start、截图安全；
- `src/preload/preload.cts`：既有 WebGPT 打开请求 bridge；
- `src/renderer/renderer.ts`：既有 GUI WebGPT 请求的状态收敛；
- `src/features/webgpt/runtime/webgpt-workspace.ts`：页面失败/健康状态修正；
- `tests/webgpt-command.test.ts`；
- `tests/webgpt-control-contract.test.ts`：协议、descriptor、鉴权 socket。

没有把 `dist-stage-a/`、`指导文档/*.docx`、历史 Spike 报告或其他用户未提交文件加入 commit。

## 5. Test evidence

### Automated gate

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，132/132 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS；仅 Git 换行提示 |
| secret scan | PASS；未发现 key/token/private-key 模式 |

### Contract tests

已覆盖：

- CLI allowlist、JSON flag、未知参数拒绝；
- versioned Control request；
- 不支持 `webgpt.send`；
- per-instance descriptor 发布/读取；
- 正确 token 可通过 socket；
- 错误 token 返回 `CONTROL_UNAUTHORIZED`；
- requestId 保持；
- response 不含 authToken。

### Real V1 regression

| Smoke | Result |
|---|---|
| `npm run test:real:navigation` | PASS |
| `npm run test:real:workspace` | PASS |
| `npm run test:real:multi-thread` | PASS |
| `npm run test:real:composer-capability` | PASS |
| `npm run test:real:composer-persistence` | PASS |
| `npm run test:real:project-lifecycle` | PASS |
| `npm run test:real:reliability` | PASS |
| `npm run test:real` fresh isolated state | PASS，返回 `NATIVE_THREAD_SMOKE_OK`，测试 Thread 已清理 |

`npm run test:real` 第一次使用项目已有 `.real-smoke` 状态时返回了既有 `no rollout found`；没有修改产品代码。随后使用 `CODEX_V1_SMOKE_STATE_DIR` 指向独立临时目录并开启脚本清理，完整重跑通过。这是历史 smoke 状态残留，不是本次 WebGPT Control Plane 回归失败；该事实保留在本报告中。

## 6. Real CLI / GUI smoke

### Same runtime

使用最新打包 EXE：

`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`

最终稳定实例观察到：

```text
workbenchInstanceId: 4d5a819e-9e9b-47f8-914b-c6a73cebe1d5
webgptRuntimeId:    fb38d990-2a9b-4613-ac4b-cbeb159fa5d5
sessionKey:         default
currentUrl:         https://chatgpt.com/
pageHealthy:        true
```

`webgpt.open`、`webgpt.current`、`webgpt.screenshot` 返回的 identity 保持同一 pair；控制权命令返回 `USER_CONTROL` / `AUTO_CONTROL`，没有创建第二个 Runtime。

### Auto-start

在 GUI 已优雅关闭、没有 Workbench 窗口时执行：

```text
webgpt status --json
```

结果：CLI exit 0，自动启动普通 Workbench GUI；稳定等待后 `workbench=READY`、`webgpt=READY`。随后执行 `webgpt open --json` 和 `webgpt current --json` 成功，仍是上述同一实例身份；Computer Use accessibility tree 确认只有一个 Workbench 窗口。

自动启动最初几秒可能报告 `webgpt=UNHEALTHY`，原因是真实网络页面尚未稳定；状态探针现在会诚实返回非健康，等待后恢复 `READY`，没有把错误页伪装成健康。

### GUI observation

最终 accessibility tree 真实包含：

- `WebGPT Browser Workspace`；
- `文档 ChatGPT`；
- `https://chatgpt.com/`；
- `页面就绪`；
- WebGPT/ChatGPT composer。

窗口计数为 1。没有通过网页输入、提交 ChatGPT 消息、读取账号名、导出 Cookie 或 Token。

### Screenshot

同一最终 runtime 的 CLI screenshot 成功：

```text
尺寸：861 × 512
字节：31812
SHA256：9B1C9C3672950CFC31CB1DD368DD442C332290D71131EAEE8CED86BD2388BA17
证据文件：C:\Users\sadar\AppData\Local\Temp\codex-workbench-web2-autostart-b507585b846a4fe883d57928859673d3.png
```

该截图只保留在本机临时目录，没有复制到报告或 Git，避免把用户网页内容随审查包传播。

### Error paths

- 已存在截图目标：exit 1，`SCREENSHOT_OUTPUT_EXISTS`；
- 越权截图路径：exit 1，`SCREENSHOT_OUTPUT_OUTSIDE_ALLOWLIST`；
- 未知命令：exit 2，`CLI_INVALID_ARGUMENT`；
- 不支持账号参数：exit 2，`CLI_INVALID_ARGUMENT`。

## 7. Remote page security

WEB-1 原有边界保持：

- ChatGPT/限定登录域名导航白名单；
- `contextIsolation: true`；
- `nodeIntegration: false`；
- WebGPT 页面无 V1 preload bridge；
- 权限请求、下载、新窗口默认拒绝；
- WebGPT 页面探针只返回有限 metadata，不返回任意正文/DOM；
- Control Plane 不接受 URL、脚本、Cookie、Token 或文件系统命令。

## 8. V1 regression / core behavior

```text
v1_core_behavior_changed: NO
```

本次只在 V1 Main 增加 WebGPT extension point 和 CLI Control Plane；Native Thread、Native Turn/Item、App Server、Project、Composer、Map 的事实模型没有重建。上述 real smoke 已验证导航、workspace、并行 Thread、Composer、Project 和 recovery 主链。

## 9. Subagents

三名子代理均自然完成后才关闭，未修改共享工作树：

| Agent | Task | Result | Adopted / validation | Final status |
|---|---|---|---|---|
| Zeno `01a01b19-2693-7062-8310-d91504367e2c` | Control Plane architecture audit | 建议 Main-owned Control Plane、Named Pipe、identity/revision/serialization | 采纳；对应实现和 132 tests、real CLI smoke 验证 | completed，已关闭 |
| Wegener `01a01b19-2b56-7b92-9d15-1e04e84e1e76` | Security/lifecycle audit | 指出固定 Pipe、auth、截图覆盖、timeout 风险 | 采纳动态 endpoint、auth、拒绝覆盖、尺寸限制、健康状态修正 | completed，已关闭 |
| Planck `01a01b19-2ff7-7c90-bc57-0ed33da95e10` | Regression test matrix audit | 提供 T01–T18 同实例和 V1 regression 矩阵 | 采纳；CLI/GUI、V1 real smoke 全部执行 | completed，已关闭 |

```text
running_subagents_at_gate: 0
```

## 10. Package / workspace status

### Final package

```text
path: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
outer EXE SHA256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```

Packaged app resource hashes：

```text
resources/app/dist/main/main.js
DB6C68CB3416A642B37B21C87F9612C7593DB53BF43D552305179DD8297EF45C

resources/app/dist/renderer/renderer.js
DEEF47EB971C4BAC306B61130704F9B7A3EF122768E77500673938B781FF4BE1

resources/app/package.json
1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F

resources/app/dist/main/webgpt-control.js
46327D41EEE4F7D6AC0E92F6C392D673E1450F837A84580801327490F4AB1AE9

resources/app/dist/features/webgpt/runtime/webgpt-workspace.js
B1EE9A1FBA497113D172AA0F48F3F4A4C6273342B843D57D3601FCF4EB72CEB2
```

### User files

- `dist-stage-a/`：保持用户原有未提交状态，未加入；
- `指导文档/*.docx`：保持用户原有未提交状态，未加入；
- `docs/BROWSER-CAPABILITY-SPIKE.md`、`docs/WEBGPT-ELECTRON-SPIKE.md`、`docs/WEBGPT-INTERNAL-OPEN-CLI-REVIEW.md`：未加入本次 implementation commit；
- 未创建、修改或删除账号凭据文件；
- 本报告是本阶段唯一新增审查文档。

### Legacy projects

- `D:\办公\AI\Codex_Workbench`：只读检查，保持原有 dirty baseline，未 reset/clean/stash/commit；
- `D:\办公\AI\Auto_Agent`：只读检查，保持 clean，未修改。

## 11. Known limitations / blockers

- WEB-3 网页 Chat roundtrip 未实现，按范围明确 deferred；
- 多账号 Session 管理未实现，按范围明确 deferred；
- ChatGPT 页面依赖外部网络和站点 DOM；首次启动的瞬时网络失败会先显示 `UNHEALTHY`，需要等待或重新 `open`，不会静默报告 READY；
- CLI 是同一 GUI EXE 的薄客户端；目前没有另行打包独立 `workbench-cli.exe`；
- Windows GUI EXE 的重定向样本在 JSON 前出现 CRLF 空白，之后是单个 JSON object、无 debug 行；按 JSON 语法可由标准解析器读取。若未来要求严格逐行无前导空白，可单独做 CLI launcher polish，不属于 WEB-3；
- Control Plane descriptor 存在本机 userData 中，auth token 不出现在响应/日志；没有把 Windows Named Pipe ACL 重新实现为产品级账号系统，后续可单独做安全加固审查。

没有阻塞 WEB-2 当前 Gate 的问题。

## 12. Final review state

```text
[CODEX_WORKBENCH_WEBGPT_WEB2_STAGE_REVIEW]

stage: WEB-2
result: PASS_CANDIDATE
control_plane: PASS
cli_same_runtime: PASS
cli_auto_start_workbench: PASS
cli_json_contract: PASS
control_ownership_sync: PASS
screenshot_same_browser: PASS
remote_page_security: PASS
v1_core_behavior_changed: NO
v1_regression: PASS（fresh isolated smoke；默认历史 smoke 状态残留已单独记录）
multi_account: DEFERRED
web3: DEFERRED
implementation_commit: 95d35d5
review_package: docs/WEBGPT-WEB2-STAGE-REVIEW.md
blocking_issues: none
non_blocking_issues: transient external page/network readiness; CLI launcher polish; future Pipe ACL hardening
recommended_next_stage: WEB-3（需 GPT 明确批准后另行执行）
```

本阶段完成后停止，不进入 WEB-3。请手动提交本报告给 GPT 审查。
