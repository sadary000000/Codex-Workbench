# Codex Workbench V1

这是全新、独立的 Codex Workbench V1 工程。旧项目 `D:/办公/AI/Codex_Workbench` 只作为 donor/reference，不是本项目的运行时依赖。

当前范围是 Phase 0 + Phase 1 + Phase 2：证明 Codex App Server Native Thread 垂直链路，并建立 Native identity、Project/ThreadProjection、Standalone Thread、Prompt Recovery 和 restart/reliability 基础。当前不包含正式导航、完整 Thread Workspace、Map、Workflow、Review、Prompt 工具、Git 工作台或 Legacy Conversation 迁移。

## 快速开始

```powershell
npm install
npm run check
npm test
npm run build
npm run dev
```

默认使用当前工作目录作为 Codex App Server `cwd`。如需指定目录：

```powershell
$env:CODEX_WORKBENCH_CWD = 'D:\path\to\project'
npm run dev
```

真实只读 Native Thread smoke：

```powershell
$env:CODEX_WORKBENCH_CWD = (Get-Location).Path
npm run test:real
```

真实 smoke 会在指定 state 目录维护两个本地薄投影文件：`native-thread-binding.json` 和 `workbench-state.json`；不会复制 Native Thread 历史。

Phase 1 交付记录见 [docs/PHASE-01-NATIVE-THREAD-FOUNDATION.md](<D:/办公/AI/Codex_Workbench_V1/docs/PHASE-01-NATIVE-THREAD-FOUNDATION.md>)。

Phase 2 交付记录见 [docs/PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md](<D:/办公/AI/Codex_Workbench_V1/docs/PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md>)。
