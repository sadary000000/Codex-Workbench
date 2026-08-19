# Codex Workbench WebGPT — WEB-1 Core Workspace Foundation

状态：`PASS_WITH_LIMITATIONS`

本阶段是 WEB-0 可行性 Spike 后的最小正式实现。范围限定为独立 Browser Workspace 基础，不进入 Automation、Workflow、Browser UI 自动操作或网页 ChatGPT Prompt/Response 闭环。

## 1. Scope Resolution

### Stage

`WEB-1 — WebGPT Core Workspace Foundation`

### Goal

在 Workbench 中提供一个独立的 WebGPT 顶级入口和 Browser Workspace，使用 Electron 原生 `WebContentsView` 加载 `chatgpt.com`，保留用户手动控制、稳定会话目录和未来服务接口边界，同时不改变 V1 Frozen Core。

### In scope

- WebGPT 顶级 Sidebar 入口；
- 独立 `WebContentsView` Browser Workspace；
- ChatGPT 首页/对话 URL、标题和有限页面状态；
- Back / Forward / Reload；
- Workspace 显示、隐藏、边界同步和窗口尺寸变化；
- 用户手动在嵌入页面中操作；
- Edge 打开当前 ChatGPT URL；
- `<userData>\\webgpt\\session` 稳定会话目录；
- `USER_CONTROL`、`AUTO_CONTROL`、`PAUSED` 基础状态；
- `WebGptPublicService` 公共接口骨架；
- 远程页面隔离、导航白名单、权限/下载默认拒绝。

### Out of scope

- Automation Service、Workflow、Verifier 或多 Agent；
- 自动输入 Prompt、自动点击 Send、等待网页 Response；
- 文件上传、附件提取、多 Tab；
- Playwright、Selenium、CDP 或 WebView2 自研自动化；
- ChatGPT 私有 API 逆向；
- V1 Runtime / Thread / Project / Composer / Map 重构；
- 自动登录、密码、Cookie、Token 导出。

### Architecture boundary

```text
Workbench local Renderer
        │ narrow WebGPT IPC bridge
        ▼
Main process WebGptWorkspace
        │ dedicated Electron Session + WebContentsView
        ▼
https://chatgpt.com/
```

V1 核心事实继续保持：

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → 唯一消息和运行事实
Codex App Server → V1 Runtime 主路径
```

WebGPT 不是 Conversation、Transcript、Task 或 Native Thread 的第二事实源。WebGPT 顶级入口也不加入 Pinned / Projects / Recent 导航模型。

## 2. 实现内容

### 新增独立 Feature

- `src/features/webgpt/types.ts`
  - `WebGptPublicService`；
  - `WebGptState`、`WebGptPageState`、`WebGptHealthStatus`；
  - `WebGptScreenshot`、边界和 Deferred Result；
  - 自动 Prompt/Response 方法保留为明确的 deferred 结果。
- `src/features/webgpt/adapter/webgpt-page-adapter.ts`
  - ChatGPT 与登录域名白名单；
  - URL 规范化；
  - 有界页面探针，只返回 URL、标题、登录状态、Composer/生成状态和 Assistant 数量；
  - 不把网页正文或任意 DOM 内容暴露为 Workbench 事实。
- `src/features/webgpt/session/webgpt-session.ts`
  - 使用固定路径 `<userData>\\webgpt\\session`；
  - 由 Electron `session.fromPath(..., { cache: true })` 管理会话；
  - 不导出密码、Cookie 或 Token。
- `src/features/webgpt/runtime/webgpt-workspace.ts`
  - 使用 `WebContentsView`；
  - Browser 生命周期、状态和控制方法；
  - 页面导航、标题、加载失败和页面状态回传；
  - Back / Forward / Reload / Screenshot / Edge handoff；
  - 用户控制、自动控制占位和暂停状态。
- `src/features/webgpt/index.ts`
  - 独立 Feature 导出边界。

### V1 仅增加的 Extension Points

- `src/main/main.ts`
  - 增加 WebGPT IPC channel 和窄 sender 校验；
  - WebGPT Workspace 延迟初始化，创建失败不阻塞普通 Workbench 启动；
  - 退出时关闭已创建的 WebGPT Workspace。
- `src/preload/preload.cts`
  - 保持既有 `codexWorkbenchV1` bridge 不变；
  - 新增独立、固定 API 的 `codexWorkbenchWebGPT` bridge；
  - 没有把 V1 API 注入远程 WebGPT 页面。
- `src/renderer/renderer.ts`
  - 增加顶级入口、Workspace 控件、状态显示和 bounds 同步；
  - Thread/Project 操作打开时隐藏 WebGPT，避免两个 Workspace 视觉重叠。
- `src/renderer/index.html`
  - 增加 WebGPT 顶级入口、Toolbar、URL/标题/页面状态和浏览器宿主区域；
  - WebGPT Workspace 在 Composer 之后，不改变 V1 Composer/Conversation 结构。
- `scripts/package-win.mjs`
  - 将 `dist/features` 纳入 Windows package；
  - 没有改变 App Server 或 Native Runtime 打包逻辑。

## 3. Remote Page Security

WebGPT `WebContentsView` 使用：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
无 preload
```

额外策略：

- 只允许 HTTPS 的 `chatgpt.com`、明确的 OpenAI/Google/Apple/Microsoft 登录域名；
- 非白名单导航和重定向被阻止；
- 新窗口被阻止；
- 专用 Session 的权限检查和权限请求默认拒绝；
- 下载默认取消；
- Edge handoff 只接受规范化后的 ChatGPT URL；
- WebGPT 页面只能通过有限 IPC 状态 API 与本地壳交互；
- 页面探针不返回正文、Cookie、Token 或任意 DOM 快照。

V1 原有本地 Renderer 的既有 IPC 面不在 WEB-1 重做；本阶段没有把远程 WebGPT 页面连接到该 bridge，也没有把主窗口导航到远程页面。

## 4. Public Service Boundary

已提供：

```text
openWorkspace()
openHome()
openChat(url)
getCurrentUrl()
getPageState()
takeScreenshot()
requestUserControl()
returnAutomationControl()
getHealthStatus()
```

自动化相关方法存在于接口以固定未来边界，但当前始终返回：

```text
supported: false
code: WEBGPT_AUTO_CONTROL_DEFERRED
```

因此 WEB-1 没有偷偷实现网页 Prompt/Response 自动化。

## 5. Tests and Evidence

### Automated

- `npm run check`：PASS；
- `npm test`：`128/128 PASS`；
- `npm run build`：PASS；
- `npm run package:win`：PASS；
- `npm audit --omit=dev`：`found 0 vulnerabilities`；
- `git diff --check`：PASS（仅有 Git 的换行提示）；
- secret scan：PASS，未发现扫描模式命中。

新增契约覆盖：

- WebGPT 是顶级入口且不属于 Automation；
- `src/features/webgpt` 被 TypeScript build 和 Windows package 纳入；
- 远程页面没有 V1 preload bridge；
- `contextIsolation`、`nodeIntegration`、`sandbox`、权限拒绝和下载拒绝策略存在；
- 导航白名单和页面状态边界有界。

### Real App Server regression

- `npm run test:real:navigation`：PASS；创建/切换多个 Native Thread，并以同一 Native Thread 完成重启恢复；
- `npm run test:real:workspace`：PASS；中断后继续、读取和重启恢复保持同一 Native Thread；
- `npm run test:real:multi-thread`：PASS；两个 Native Thread 并行运行，事件按 Thread 隔离；
- `npm run test:real:composer-capability`：PASS；模型、Reasoning、Approval、Sandbox 请求诊断保持 Native Thread；
- `npm run test:real:composer-persistence`：PASS；A/B Thread Composer 配置独立持久化；
- `npm run test:real:project-lifecycle`：PASS；Project 生命周期及重启后的同一 Native Thread 身份保持。

上述 smoke 使用脚本自带的临时状态和清理逻辑；没有把临时 Native Thread 作为产品历史留下。

### Packaged startup observation

使用最新：

`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`

已确认：

- EXE 可以启动；
- accessibility tree 同时发现 `open-webgpt`、`new-standalone-thread`、Composer 和 Developer / Diagnostics；
- 测试实例已正常关闭；
- WebGPT session 尚未因本次启动产生人工登录状态。

当前 Computer Use 对该 Electron 窗口返回 `coordinate input geometry is unavailable`，截图捕获也返回 Windows `SetIsBorderRequired ... E_NOINTERFACE`。因此没有把“点开 WebGPT、加载 ChatGPT、手工登录、Edge 打开当前 URL”冒充为本机 GUI PASS。

## 6. Manual Acceptance Required

以下需要用户在最新 EXE 中人工确认：

1. 点击顶级 WebGPT 后，嵌入 Workspace 显示 `https://chatgpt.com/`；
2. 登录页面在 Workspace 内可见，由用户手工完成登录，不向 Workbench 提供密码；
3. 关闭并重新打开 Workbench 后，专用 `<userData>\\webgpt\\session` 保留登录状态；
4. URL/标题、Back / Forward / Reload 正常；
5. 浏览器区域可随窗口变化正确 resize，隐藏后 V1 Thread/Composer 正常；
6. 在 WebGPT 中用户可以正常手工输入；
7. Edge 按钮只打开当前 ChatGPT URL；
8. WebGPT 权限请求、下载和非白名单站点被拒绝；
9. 自动化占位方法显示 deferred，不执行网页 Send；
10. V1 Thread/Project/Composer/Map 仍无回归。

## 7. Known Limitations

- 登录仍是用户手工操作；正式 WebGPT Session 与 Edge、WEB-0 Spike 临时 profile 相互独立；
- WEB-1 不做网页 ChatGPT 最小 Prompt/Response roundtrip；
- 页面状态探针依赖 ChatGPT 当前 DOM 语义，未来页面改版可能需要适配；
- 当前没有多 Tab、文件上传、附件或自动化控制权 lease；
- 本次环境无法完成 Electron WebContentsView 的点按/截图 GUI 证据，需用户人工验收；
- V1 本地 Renderer 的既有 Core IPC 防护不是 WEB-1 的重构范围，后续若允许应单独审计，不能将其写成 WebGPT 远程页面已获得权限。

## 8. Temporary Files and User Data

- 没有新增临时测试脚本；复用了仓库已有 real smoke scripts；
- real smoke 临时状态由脚本创建并清理；
- WEB-0 Spike 的历史证据仍在 `docs/WEBGPT-ELECTRON-SPIKE.md`，未修改；
- WebGPT 正式会话目录由应用运行时创建在 `<userData>\\webgpt\\session`，本轮未删除；
- `dist-stage-a/`、既有 Spike 报告、用户 `指导文档/*.docx` 保持原状态，未加入本阶段提交；
- 未安装新软件、插件或系统组件；
- 旧 donor `D:\办公\AI\Codex_Workbench` 未修改；
- `D:\办公\AI\Auto_Agent` 未修改。

## 9. Package Provenance

最新 package：

`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`

SHA256：

```text
outer EXE: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
main.js: 63FB6B4F43F02AFF263D31B053E85ECCD45D9E9DD92C3F794AE9F4B8513E57C2
renderer.js: D4B118D02217CCE3F63EB3169D5CD48D2BB3A2CE29C9BFEF11F6FEBDBC0110B6
package.json: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
webgpt-workspace.js: 1C1F928114A5BF92CB0D56C9E273DD92E13BD020CC84B96A8B7E2F3501CAE358
```

## 10. Result

`PASS_WITH_LIMITATIONS`

代码、契约、打包、安全边界和 V1 real regression 已通过；Browser Workspace 的真实页面加载、人工登录持久化、Edge handoff 仍需用户在最新 EXE 中手工确认。完成这些人工项前，不把 WEB-1 标记为完全冻结，也不进入下一阶段实现。
