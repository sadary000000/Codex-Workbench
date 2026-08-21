# WebGPT V1 Final Freeze

## 状态

```yaml
stage: WEB-6.9 WebGPT V1 Final Freeze Review
result: FINAL_FREEZE_CANDIDATE
web6_5r: PASS_FROZEN
web6_6: PASS_FROZEN
web6_7: PASS_FROZEN
web6_8: PASS_FROZEN
new_real_prompts_in_web6_9: 0
automation: NOT_STARTED
v1_frozen_core_changed: NO
```

本文件是 WebGPT V1 的冻结说明。它冻结当前已经实现并有证据支持的边界，不新增 Automation、Runtime Health、State Awareness、Project Delete/Rename、多账号或完整 Chat Transcript 能力。

## 最终产品边界

```text
V1 Frozen Core
    |
    +-- WebGPT extension surface
          +-- one Electron Browser Runtime
          +-- one persistent ChatGPT session
          +-- Control Plane / Official CLI
          +-- Request Manager / Request Journal
          +-- Browser Operation Arbiter
          +-- Role Registry
          +-- Project Registry
          +-- Page Probe + Network completion candidate
```

WebGPT 是 V1 之上的扩展壳，不是第二套 Codex，不是第二套 Native Thread，也不建立第二套 Conversation、Transcript、Task 或 Exec History 事实源。

## 冻结事实源边界

以下边界是硬约束：

| 对象 | 不等于 | 说明 |
|---|---|---|
| Native Thread | WebGPT Request | Native Thread 继续由 App Server / V1 Runtime 管理 |
| Native `agent_role` | WebGPT Role Registry role | 两者属于不同域，不能互相推导 |
| Workbench Project | Native Thread | 本地项目归属不改写 Native identity |
| WebGPT Request | Native Turn | 网页请求有自己的 `requestId` 与 idempotency 语义 |
| Network request id | Recovery identity | 网络请求编号只用于一次候选关联 |
| Current Browser Page | Task identity | 当前页只能作为目标校验输入 |
| Map | Runtime truth | Map 仍是受限增强侧车，不替代 Native 事实 |

V1 Frozen Core 仍以 Native Thread / Turn / Item、RuntimeRegistry、Native Approval、Native Sandbox、Workspace、Renderer projection 和 V1 Map 为准。WebGPT 不反向成为 V1 Core 的业务依赖。

## Browser Runtime 与 Session

- 只有一个 `WebGptWorkspace` / `WebContentsView` 路径；没有隐藏的第二 Browser Runtime。
- Browser capacity 固定为 `1`，所有改变页面的自动操作必须取得 Browser Lease。
- Session 通过 Electron `session.fromPath()` 持久化到应用 user-data 下的 WebGPT session 目录。
- 远程页面使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 的 WebContentsView；没有 V1 preload bridge。
- 允许导航仅限 ChatGPT 与受限登录 origin；新窗口、下载和权限请求默认拒绝。
- Network Observer 只收集 host、路径类别、method、resource type、状态、数据块计数和时间等元数据；不读取响应正文、Cookie 或 Token。

主 Electron app shell 的 `sandbox: false` 是本地 Renderer shell 配置，不是远程 ChatGPT WebContentsView 的安全边界；远程 WebGPT view 的安全配置单独维持为 sandboxed。

## Control Ownership

```text
USER_CONTROL > AUTO_CONTROL
```

用户接管会使自动操作 fail-closed，暂停队列并增加 control epoch；恢复自动控制必须显式执行 reconcile/交还。自动操作不能绕过 Arbiter，也不能在页面被用户控制时导航、输入或发送 Prompt。

## Request 生命周期与不重发保证

每个 WebGPT Request 具有：

- `requestId`
- 可选 `idempotencyKey`
- `semanticSha256`
- Request Journal 记录
- 目标 Project / Role / Chat 元数据

语义：

```text
same idempotencyKey + same semanticSha256
    -> 返回原 Request / reattach，不重发

same idempotencyKey + changed semantics
    -> IDEMPOTENCY_CONFLICT，拒绝覆盖和重发

wait timeout
    -> 只结束等待，不等同于 cancel，也不触发盲目重发

submitted state uncertain / restart
    -> reconcile 或 RECOVERY_REQUIRED，不自动重新发送
```

Workbench 重启会把未完成记录置为 `RECOVERY_REQUIRED`，保留 identity 和必要的安全摘要；恢复路径必须重新校验目标 Chat、控制权和页面状态。

## Completion 语义

生产完成链路冻结为：

```text
Network Observer
    -> COMPLETION_CANDIDATE
    -> bounded Page Probe
    -> COMPLETED
```

`NETWORK_STREAM_END` 只是候选，不等于最终完成。最终确认依赖目标页、User/Assistant 计数、Composer/生成状态和文本稳定性等受限页面探针。截图仅用于 debug/evidence，不进入完成状态机；不使用 OCR 或图像识别作为必需输入。

## Role Registry

Role 只允许：`REQUIREMENT`、`PLANNER`、`REVIEWER`。

```text
Project + Role -> exact Chat binding
```

发送、latest、open 都必须验证精确目标 Chat。目标不一致、页面跳转或绑定失效时返回 mismatch/recovery；不会扫描 Sidebar/history，不会静默绑定当前页面，不会把 Prompt 发到 fallback Chat。

## Project Lifecycle

当前冻结能力：

```text
project inspect
project open
project create
project new-chat
```

`project create` 必须取得真实远端 Project identity；重复名称在再次浏览器动作前拒绝。`project open` 必须确认目标 Project context/route；`project new-chat` 在不发送 Prompt 的模式下只准备目标 Project Chat context，第一次 Prompt 后才 materialize 真实 Chat identity，不伪造 `/c/` URL。

以下不属于 V1：delete、rename、migration、batch management。

## Persistence Review

| 持久化对象 | 保存内容 | 不保存/不承担 |
|---|---|---|
| Browser Session | Electron session profile 的浏览器登录状态 | 不导出 Cookie/Token，不作为报告证据 |
| Request Journal | request identity、语义摘要、状态、目标元数据、结果摘要 | 不保存完整 Transcript，不盲目重放 |
| Role Registry | Project/Role 到精确 Chat URL 的安全绑定元数据 | 不扫描历史，不静默 rebind |
| Project Registry | 远端 Project id/name/confirmed URL | 不代表本地 Workbench Project，不实现删除 |
| Control Plane descriptor | 本机 endpoint、运行实例身份、运行时认证链路 | 运行时 auth token 不进入报告/审查包 |
| Protocol schema | 版本、命令、capability、Envelope 结构 | 不含用户 session 值 |

WebGPT 不持久化完整 ChatGPT Transcript 作为产品事实源；页面文本只在当前请求读取和受限结果输出路径中使用。

## Error / Recovery Contract

Control Plane 对外 canonical error code 固定为：

```text
INVALID_ARGUMENT
NOT_FOUND
BUSY
OVERLOADED
TIMEOUT
RECOVERY_REQUIRED
USER_CONTROL
VERSION_MISMATCH
CAPABILITY_NOT_SUPPORTED
TARGET_CHAT_MISMATCH
INTERNAL_ERROR
```

错误 Envelope 至少包含 `code`、`message`、`retryable`，可选 `retryAfterMs`、`userAction` 和 bounded `details`。`BUSY` 表示资源存在但被暂时占用；`OVERLOADED` 表示队列容量已满，二者不能混用。

## Official CLI ABI

```text
dist/package/Codex Workbench CLI.exe  = 唯一受支持外部 CLI
dist/package/Codex Workbench V1.exe  = Desktop Runtime / GUI / Browser Host
Codex Workbench CLI Runtime.exe       = 同包内部实现细节，不是第二 WebGPT Core
```

CLI front door 使用 Node `execFile` / `shell: false` 语义转发到已认证 Named Pipe Control Plane；不调用 `cmd.exe`、PowerShell、窗口坐标或 Windows 应用控制。`--json` 输出单行 JSON，成功/业务失败/参数失败退出码分别为 0/1/2；受支持的文本读取命令可使用 `--out`，以 UTF-8 独占创建并在持久化完成后报告成功。

## 安全边界

- 不使用 ChatGPT 私有 API。
- 不导出 Cookie、Token、密码或 Browser profile。
- 不把 Network payload、完整 Prompt/Assistant transcript 写入冻结审查包。
- 不允许 WebGPT 远程页访问 Node/fs/child_process。
- 只允许 ChatGPT/受限登录 origin。
- 所有输出诊断字段使用 allowlist 和长度上限。

## WEB-6.8 残留

WEB-6.8 真实 smoke 曾创建两个测试 Project，未删除；这是因为 Project Delete 明确不在 WEB-6.8 scope，也没有在本阶段临时新增删除能力。该残留是已记录的非阻断限制，不改变 V1 identity，也不包含用户私人聊天内容。

## Freeze Decision

在 WEB-6.9 的自动 Gate 中复用 WEB-6.5R/6.6/6.7/6.8 的冻结证据，并完成当前 213/213 测试、build/package/audit/diff/secret 检查后，WebGPT V1 可提交为 `FINAL_FREEZE_CANDIDATE` 供 GPT 最终审查。冻结后本阶段不自动进入 Automation，也不规划后续阶段。

## WEB-6.9 最小冻结修复

- Project Registry 对非法、ID/URL 不一致和重复持久化身份整体 fail-closed，禁止静默丢记录。
- Official CLI wrapper、Electron CLI catch 和 Presenter 在 `--json` 异常路径保持单行 canonical JSON Envelope。
- 以上修复只位于 WebGPT Registry/CLI reliability 边界，没有改变 Native Thread/Turn/Item、Runtime Registry、Browser Runtime、Request Manager 或 V1 Core 事实源。
