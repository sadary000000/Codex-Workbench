# PHASE-03：Codex-shaped Left Navigation

日期：2026-08-17
项目：`D:\办公\AI\Codex_Workbench_V1`
状态：Phase 3 完成，等待 GPT 审查

## 1. 阶段目标

在 Phase 2 已建立的 Native identity / Project / ThreadProjection 基础上，实现正式的 Codex 式左侧导航，并证明用户看到和切换的对象始终是真实 Native Thread。

本阶段没有实现完整 Thread Workspace、Turn/Item 流、Approval、Composer、Legacy、Map、Workflow、Review 或 Task Center。

## 2. 导航数据模型

导航由 `ProjectRecord[]` 与 `ThreadProjection[]` 派生，不建立新的 Conversation、Message、Transcript 或 Task 实体。

```text
Pinned
  → 所有 pinned=true 的 Native Thread 快捷入口

Projects
  → Project A
      → Project A 的 ThreadProjection
  → Project B
      → Project B 的 ThreadProjection

Recent
  → 仅 projectId=null 的 Standalone Native Thread
```

实现文件：`src/renderer/navigation-model.ts`

约束已固定：

- Project Thread 不进入 Recent；
- Pinned 只是同一 Thread 的快捷入口，不改变 `projectId`，不复制运行实体；
- Project 分组即 ThreadProjection 的实际归属；
- 展示和排序都使用 `nativeThreadId`、`updatedAt` 与已有投影字段；
- 持久化层仍以 `nativeThreadId` 为唯一 Thread key。

## 3. Native Thread 创建与切换

### Project Thread 创建

Project 内点击 `+` 后：

```text
读取 Project.cwd
→ 关闭当前 active Runtime slot（存在运行 Turn 时拒绝）
→ 调用真实 thread/start
→ 获得真实 nativeThreadId
→ 创建 ThreadProjection(projectId=目标 Project)
→ 写入 active native-thread-binding.json
→ 选中该 Thread
```

### Standalone Thread 创建

顶层“新建 Thread”使用应用默认 `cwd`，调用相同的 Native `thread/start` 链路，但创建：

```text
projectId = null
```

创建后只能进入 Recent，不会被错误归入任意 Project。

### Thread 切换

点击已有 Thread 时：

```text
读取已有 ThreadProjection
→ 使用 projection.cwd 创建/切换当前唯一 Runtime slot
→ 调用 thread/resume(nativeThreadId)
→ 调用 thread/read(nativeThreadId)
→ 校验 response ID 与目标 nativeThreadId 一致
→ 成功后更新 active binding
```

切换失败时不会创建替代 Thread，也不会修改目标 Thread 的 identity。当前 Turn 运行时拒绝切换并返回 `THREAD_SWITCH_BUSY`。

Runtime 新增 `startNewThread()`；显式 `resume()` 会先断开当前 client，再恢复目标 Native Thread，并保留目标 projection 已有的 Project/Standalone 归属。

## 4. Main / Preload / Renderer 边界

新增 IPC：

- `native-thread:create`
- `native-thread:switch`
- `persistence:threads:update`

Renderer 已实现最小正式侧栏：

- 置顶 Thread shortcuts；
- Project 展开/折叠；
- Project 内新建 Native Thread；
- Standalone 新建 Native Thread；
- Recent Standalone Thread；
- Pinned / unpinned；
- 当前选中 Thread 状态；
- 轻量 Project 创建入口。

中间区域保留 Phase 4 占位和 Native 调试操作，避免提前做完整 Thread Workspace。

## 5. 自动测试

新增/扩展覆盖：

- Pinned / Projects / Recent 派生规则；
- Project Thread 不进入 Recent；
- 空 Project 仍显示；
- Pinned 不改变 Project/Standalone 归属；
- 多 Native Thread 创建与 identity 隔离；
- Project A1 → A2 → Standalone S1 → A1 切换；
- 重启后 active binding 与 projection 恢复；
- resume/read failure 不静默替换 Native Thread；
- 仍没有 Workbench Conversation / Transcript / Task 真相层。

门禁结果：

```text
npm run check：PASS
npm test：20 passed / 0 failed
npm run build：PASS
npm audit --omit=dev：0 vulnerabilities
```

## 6. 真实 App Server smoke

可复现命令：

```powershell
npm run test:real:navigation
```

实际执行结果：

```text
Project：phase3-project
Project Threads：
  01a00f67-aca3-7840-ae83-3a3e2f3e0769
  01a00f68-042e-7113-b020-8087f2306b35
Standalone Thread：
  01a00f68-1bf2-7641-9fcd-599c7f61e0a5
切换顺序：A1 → A2 → S1
重启恢复：01a00f68-1bf2-7641-9fcd-599c7f61e0a5
真实 completed Turn events：4
```

真实验证包含：

- 创建两个 Project Native Thread 与一个 Standalone Native Thread；
- 三个 Thread 各完成一个真实 Turn；
- 切回 A1 后继续完成一个真实 Turn；
- 读取 A1、A2、S1 时返回的 `nativeThreadId` 均与目标一致；
- Runtime 重启后按 active binding 恢复到 S1；
- Project/Standalone projection 归属保持不变。

## 7. 已知限制

- 当前仍只有一个 active Runtime slot，不支持并发显示多个 App Server Runtime；
- 切换前如果存在运行中的 Turn，会安全拒绝，不自动替用户决定终止或继续；
- Project 创建使用轻量输入入口，尚未做路径选择器、Project 编辑和 Dashboard；
- 中间 Thread Workspace 仍是 Phase 4 占位；
- Pinned、Projects、Recent 目前是本地投影，不是新的产品级 Conversation 列表；
- 旧项目 `D:\办公\AI\Codex_Workbench` 仍只读参考，本阶段未修改。

## 8. 阶段边界

本阶段没有进入：

- Phase 4 完整 Thread Workspace；
- Thinking / Tool / Command / File / Web Item UI；
- Approval Card、正式 Composer、Reconnect Workspace；
- Phase 5 Legacy 筛选/迁移；
- Phase 6 Map；
- Workflow、Review、Task Manager；
- Exec 主链或历史 Prompt 拼接。

完成本报告后停止，等待 GPT 审查结果。
