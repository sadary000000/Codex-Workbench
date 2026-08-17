# Codex Workbench V1 人工验收清单

状态：待用户人工 GUI 验收

这份清单只记录用户实际操作结果。Codex 已完成自动化检查和 CLI smoke，但不代替用户勾选 GUI PASS。每项完成后请在“结果”栏填写 `PASS`、`FAIL` 或 `N/A`，若失败请保留截图和时间。

## 验收准备

1. 工作目录：`D:\办公\AI\Codex_Workbench_V1`。
2. 运行：`npm run build`，然后 `npm run dev`。
3. 结果：窗口正常启动，主界面可见；失败时没有静默退出。

## 主链与导航

| 编号 | 操作 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| 1 | 创建一个 Standalone Thread，发送一条简单 Prompt | 回复显示在当前 Native Thread，Prompt 没有消失 | 待填写 |
| 2 | 创建一个 Project，再在其中创建两个 Thread | 两个 Thread 都属于该 Project，身份没有串线 | 待填写 |
| 3 | 在 Pinned、Projects、Recent 间切换 | Project Thread 不进入 Recent；Standalone Thread 可进入 Recent；Pinned 只是快捷入口 | 待填写 |
| 4 | 在两个 Thread 间来回切换并继续发送 Prompt | 每条回复仍属于正确的 Native Thread，不出现串线 | 待填写 |
| 5 | 在 Turn 运行中点击 Stop，再继续发送 Prompt | 只有当前 Turn 被中断；原 Thread 和 interrupted Turn 保留 | 待填写 |
| 6 | 关闭并重新启动 Workbench | 上次选中的 Thread、导航投影和可恢复状态正确回来 | 待填写 |

## Thread Workspace

| 编号 | 操作 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| 7 | 执行会产生处理状态、命令/工具、文件或搜索事件的 Prompt | Native Turn/Item 事件按真实状态显示；未知 Item 不导致主界面崩溃 | 待填写 |
| 8 | 触发需要批准的操作（如环境允许） | Approval 状态和操作结果可见，拒绝不会伪造成功 | 待填写 |
| 9 | 在回复生成中滚动、跳到最新、再次发送 | Composer、滚动和发送状态正常，不丢失已输入 Prompt | 待填写 |
| 10 | 观察网络/Runtime 异常提示（如实际发生） | 断线或失败可见；不会静默替换 Thread 或伪造 continuation | 待填写 |

## Conversation Map

| 编号 | 操作 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| 11 | 打开右侧 Conversation Map | Panel 可打开/关闭，树和同步状态可见，不遮蔽正常回答 | 待填写 |
| 12 | 在新 Thread 中完成一轮工作 | Map 按当前工作增量更新，来源指向真实 Thread/Turn | 待填写 |
| 13 | Pause Map，完成一轮 Turn，再 Resume | Pause 期间显示 dirty；Resume 后只追增量，正常回答不受影响 | 待填写 |
| 14 | 重启 Workbench 后打开同一个 Thread 的 Map | Map、cursor/dirty 状态可恢复；不会新建替代 Thread | 待填写 |

## Project Map

| 编号 | 操作 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| 15 | 在 Project Map scope 打开 Project Map | 显示 Project tree、dirty/syncing/error/confirmation 状态和 Update 入口 | 待填写 |
| 16 | 让一个有 Conversation Map 的 Thread 和一个没有 Map 的 Thread 都产生工作，点击 Update/Open | Project Map 同时吸收两个来源；来源锚点可区分 | 待填写 |
| 17 | 在 Project Map 中点击来源跳转 | 跳回正确的 Native Thread/Turn/Item，不跳错会话 | 待填写 |
| 18 | 点击“查看维护对话” | 看到只读维护视图；hidden maintenance Thread 不出现在普通 Recent/Project 导航中 | 待填写 |
| 19 | 触发需要用户确认的重大路线变更 | 界面明确显示需要通过正常对话确认，不自动应用 | 待填写 |
| 20 | 重启后再次 Update Project Map | Project Map、per-source cursor、revision/dirty 状态继续工作，不执行无必要 Full Rebuild | 待填写 |

## 验收结论

- 用户验收日期：待填写
- Workbench 版本/commit：`待填写`
- 通过项：待填写
- 失败项及复现：待填写
- 是否允许进入真实使用观察期：待填写
- 是否发现需要明确开启 Phase 7 的真实缺口：待填写
