# STAGE H — 人工回归验收 / Reliability Hardening

日期：2026-08-18  
状态：Automated Gate PASS；Real App Server Gate PASS；Manual Functional Acceptance PENDING；剩余人工验收已合并到 STAGE J Final Manual Acceptance
范围：只对 STAGE A–G 已实现能力做可靠性回归和最小缺陷修复；不进入 STAGE I。

本报告不将 STAGE H 写成独立用户 PASS。由于用户明确要求不再拆分 H 与 J 多轮，H 的剩余人工功能验收并入 STAGE J 最终总体验收。

## 1. scope resolution

正式阶段名称：`STAGE H — 人工回归验收 / Reliability Hardening`

目标：

- 对多 Thread、Runtime、Workspace、Navigation、Message Projection、Composer、Project lifecycle 和 Map 兼容路径执行真实任务、异常、重启/恢复回归。
- 修复会造成误发、丢 Prompt、错误替换 Native Thread、错误状态污染、孤儿 Runtime、失效 Project cwd 仍显示可用等可靠性问题。
- 不新增一级产品能力，不建立 Conversation/Transcript/Task/Agent/Context 第二事实源。

本阶段范围：

- Runtime process exit、resume/reopen、FAILED/RECOVERY_REQUIRED 重试。
- selected Thread / Runtime / Composer target 一致性和 orphan fail-closed。
- 并发 turn 启动、Stop/Approval 目标隔离、跨 Thread event/Approval 防串线。
- 失败 Turn 的 Prompt 保留、正常完成/中断后的 Draft 清理。
- Project cwd 外部失效、canonical path 去重、Project Map 状态降级和旧 Map Runtime 回收。
- STAGE A–G 自动化与真实 smoke 回归。

本阶段不做：

- STAGE I 的视觉 Polish、title bar、图标、字体、滚动条、hover/animation 和像素级 Codex 对齐。
- Attachment 能力、Workflow/Task/Multi-Agent、Git/Browser/Review 产品层。
- 旧 donor 修改、远端 Native Thread 删除、Workbench Transcript 重建。

## 2. architecture boundary

继续冻结：

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → 唯一运行与消息事实
Codex App Server → V1 Runtime 主路径
RuntimeRegistry<nativeThreadId> → 多 Thread Runtime 隔离
```

本阶段没有新增第二套产品事实。Project Map 仍是受边界约束的 Map sidecar/maintenance Runtime，不成为普通 Conversation 或 Transcript。

## 3. stage G freeze

- Stage G freeze commit：`fe4eb14` — `docs: freeze stage g with ui polish deferred`
- Project lifecycle / ownership / safety：用户已确认 PASS。
- UI convergence：用户明确 deferred，分类为 `ACCEPTED UX GAP`，目标为 STAGE I。
- Stage H implementation base：`fe4eb14`。

## 4. implementation

Stage H implementation commit：`1c6dbcc` — `feat: harden stage h reliability`

主要变更：

1. `NativeThreadRuntime`
   - 同一 Runtime 的 concurrent `turn/start` 在进入 App Server 前互斥，避免两个 Prompt 同时通过 busy 检查并覆盖 active Turn。
   - App Server process exit 的持久化等待并保留原始 `APP_SERVER_PROCESS_EXIT`，正常 close 不再用通用 close 错误覆盖真实退出原因。
   - `readThread` 过程中若已观察到进程退出，保留 `DISCONNECTED`，不降级为错误的普通 `RECOVERY_REQUIRED`。
   - event 中携带其他 Native Thread ID 时 fail-closed 丢弃，不向当前 Runtime 派发跨 Thread 事件。
   - failed/unknown Turn 仍保留 Prompt recovery record；正常 close 保留最后已知 Native Turn ID。
   - interrupt 与 Turn terminal notification 竞态下使用已捕获 localRunId，避免空引用和覆盖已完成 Turn 状态。

2. `Main`
   - 显式重新打开 `FAILED` / `RECOVERY_REQUIRED` / `DISCONNECTED` / `CLOSED` / `IDLE` Runtime 时先摘除旧 handle、关闭旧 client，再对同一 `nativeThreadId` 真实 resume/read。
   - Composer server request 校验消息 Thread ID 与 Runtime owner 一致，不一致直接 fail-closed。
   - Stop 前只取消目标 Thread 的 pending Approval。
   - Project Thread 创建和 Project Map Manager 使用统一 cwd 校验。
   - Project Map metadata 清理失败时返回 `metadataCleanup: "failed"`，不再报告为完全成功；不递归删除用户目录。

3. `Renderer`
   - `NATIVE_THREAD_UNAVAILABLE` 到达 Renderer 后清除旧 selected/runtime/composer 目标，明确进入不可用状态；不会把 Prompt 发送到后台仍存活的其他 Thread。
   - orphan/失效切换前保留对应 Native Thread 草稿。
   - 只有 `completed` / `interrupted` Turn 清理 Composer Draft；failed/unknown/recovery_required 保留 Prompt 并显示恢复错误。
   - Project Map metadata cleanup partial result 明确提示 Diagnostics。

4. `Persistence / Project Map`
   - persistence boundary 使用 normalized/absolute path key，拒绝 `child/../project` 等 canonical alias duplicate。
   - 生产 Main 注入真实 cwd validator；Project Map status 对外部移动/删除的 cwd 返回 `available: false` 和 `PROJECT_CWD_NOT_FOUND`，不修改 Project metadata。
   - maintenance Map Runtime 替换前先关闭旧的非 READY Runtime，避免丢失 client handle。

5. 回归资产
   - 新增 `scripts/real-reliability-smoke.ts` 和 `npm run test:real:reliability`。
   - 新增并发 Turn、failed Prompt、Project cwd、canonical path 和 fail-closed contract 覆盖。

## 5. regression matrix

| 区域 | 命令/证据 | 结果 |
|---|---|---|
| TypeScript | `npm run check` | PASS |
| Unit/contract | `npm test` | PASS，108/108 |
| Build | `npm run build` | PASS |
| Package | `npm run package:win` | PASS |
| Dependency audit | `npm audit --omit=dev` | PASS，0 vulnerabilities |
| Diff hygiene | `git diff --check` | PASS |
| Secret scan | `rg` patterns for API/private keys | PASS，SECRET_SCAN_PASS |
| Navigation | `npm run test:real:navigation` | PASS；Project/Standalone、切换、重启同 ID |
| Workspace | `npm run test:real:workspace` | PASS；interrupt/continue/restart 同 ID |
| Multi-thread | `npm run test:real:multi-thread` | PASS；A/B Turn 与 eventMarkers 隔离 |
| Composer capability | `npm run test:real:composer-capability` | PASS；真实 model/effort；Approval broker 真实卡片仍需人工触发 |
| Composer persistence | `npm run test:real:composer-persistence` | PASS；按 Thread 持久化 |
| Project lifecycle | `npm run test:real:project-lifecycle` | PASS；真实 Project cwd，重启同 ID |
| Runtime reliability | `npm run test:real:reliability` | PASS；杀 App Server 后 DISCONNECTED、同 ID resume/read、missing cwd |
| Conversation Map | `npm run test:real:map` | PASS；dynamic tool patch、revision 1 |
| Resumed Map | `npm run test:real:resumed-map` | PASS；compatibility fallback、revision 1 |
| Project Map | `npm run test:real:project-map` | PASS；2 member Threads、maintenance Thread、restart revision 3、context request 1 |
| Context tool | `npm run test:real:context` | PASS；responseSuccess true |
| Map pause/resume | `npm run test:real:map-pause` | PASS；paused dirty、resume cursor、revision 1 |

以上真实 smoke 均针对 `D:\办公\AI\Codex_Workbench_V1`，没有修改旧 donor。

## 6. runtime / recovery

已覆盖：

- App Server process exit during `turn/start`：Runtime 进入 `DISCONNECTED`，Prompt recovery metadata 保留。
- App Server process exit 后重新创建 Runtime：同一 `nativeThreadId`，真实 `thread/resume` / `thread/read`，状态回到 READY。
- `FAILED` / `RECOVERY_REQUIRED` 重新显式打开：Main 不复用失效 client。
- 正常 close：不清空最后已知 Native Turn ID。
- 空 Thread 的首次 no-rollout/materialization 行为仍遵循 App Server 新 Thread 生命周期 fallback；已 materialized/resumed Thread 不伪造历史。

## 7. multi-thread / writer conflict / orphan / Approval

- A/B Native Thread 后台并行、切换不关闭后台 Runtime、Stop 目标隔离：真实 smoke PASS。
- 同 Thread writer conflict：Native identity 不替换，已有 unit/contract 回归 PASS。
- no-rollout/orphan：保留 projection、Project ownership、nativeThreadId；fail-closed contract PASS。当前新增 real reliability smoke 覆盖真实进程退出和失效 cwd；稳定制造远端 no-rollout 仍受外部 rollout 生命周期影响，未宣称真实 no-rollout PASS。
- pending Approval：Stop 只取消目标 Thread；消息 Thread ID 与 Runtime owner 不一致时 fail-closed。
- Approval allow/deny 的真实 UI 卡片和用户操作仍列入人工验收，不以 CLI 结果冒充 GUI PASS。

## 8. workspace / navigation / message stream / diagnostics

- Composer 常驻、Conversation 独立滚动、Jump to latest 和 user-scroll protection：沿用 STAGE B 自动化与真实 workspace 回归；最新 packaged EXE 仍需用户人工确认。
- failed Turn 不再永久污染 Thread identity；失败 Prompt 保留，显式 reopen 后可以继续恢复路径。
- Native title/displayTitle/sidebar/header、Pinned/Projects/Recent、Map source trace、Diagnostics raw/source：既有 STAGE D/E/G 回归保持，Stage H 未改变 Native identity 或 Map 规则。
- Renderer 收到失效 Thread 错误后清空旧 selected/composer target，防止“界面显示 X、实际发送 Y”。

## 9. composer capability / project lifecycle

- Model、Reasoning、Approval policy、Sandbox policy 的 per-Thread persistence 与 restart real smoke PASS。
- Unsupported saved value 的 contract/unit coverage PASS；附件继续 deferred/unsupported，不补假能力。
- Project add/duplicate/rename/open/remove、Thread detach、磁盘不删除、restart ownership real smoke PASS。
- 外部删除 Project cwd：Project record 不被静默删除或改写；Project Map status fail-closed 为不可用。
- Project Map cleanup 失败现在显式返回 partial result，不递归删除用户路径。

## 10. subagents

四个子代理均自然运行到完成，主 Agent 审核结果后关闭；没有子代理修改共享工作树。

| Agent | 任务 | 结果与采用情况 |
|---|---|---|
| Carver | Runtime/recovery audit | 发现 stale Runtime、process-exit metadata、failed Prompt、并发/interrupt 风险；采用其中与本阶段直接相关的修复和测试建议。 |
| Harvey | Multi-thread/Approval isolation audit | 发现 no-rollout Renderer 分裂、Stop Approval、Runtime reopen、并发 turn、owner mismatch 等；采用 fail-closed UI、Stop/owner 校验、reopen 和互斥。 |
| Beauvoir | Project persistence/safety audit | 确认 remove 不删磁盘/不换 ID；发现 canonical path、missing cwd、Map cleanup partial、旧 Map Runtime 等；采用最小安全修复。 |
| Jason | Regression matrix audit | 指出需区分 CLI/GUI、补跑最新 package、保存 limitation；采用回归矩阵和人工验收边界。 |

`running_subagents_at_gate: 0`

## 11. packaged artifact

- 固定路径：[Codex Workbench V1.exe](D:/办公/AI/Codex_Workbench_V1/dist/package/Codex%20Workbench%20V1.exe)
- Build/package：PASS
- 对应实现 commit：`1c6dbcc7dbee11277e0ee76fec286e835570935a`
- 文件大小：225,441,792 bytes
- SHA-256：`31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`
- 没有自动启动 GUI 代替用户人工验收；最新 EXE 是人工回归基线。

## 12. manual acceptance merged into STAGE J

以下人工功能验收项目仍需在 STAGE J 最终用户验收中完成；本报告不将其写成 H 独立 PASS。

请用户使用上面的最新 EXE 复测以下功能性项目；CLI/static test 不等同 GUI PASS：

1. A/B Thread 同时运行，切换、Stop、Approval 不串线。
2. 关闭/杀掉 App Server 后重新打开同一 Thread，确认同一 Native Thread 恢复，不生成替代 Thread。
3. 点击失效/不可用 Thread，确认明确显示不可用且 Send 灰掉/禁止，不能把消息发到另一个 Thread；再显式切换正常 Thread 后发送。
4. 失败 Turn 后 Prompt 仍保留；恢复/重新打开后可继续操作。
5. 长对话 Composer 常驻、上滚不抢位置、Jump to latest、A/B 滚动位置和输出归属正确。
6. Header、User/Assistant、Thinking、Tool/File/Search、Approval、failed/interrupted 的轻量投影正常。
7. Diagnostics 可查看 nativeThreadId、Turn/Item、raw event、完整错误；Map source jump 仍定位正确。
8. Composer model/reasoning/approval/sandbox 按 Thread 保存，重启后恢复；unsupported saved value fail-closed。
9. Project add/duplicate/rename/open/remove；remove 不删磁盘，Thread 仍是同一 ID 并安全解绑。
10. 外部移动/删除 Project cwd 后，Project Map/创建 Project Thread 明确不可用，不自动创建替代 Project。
11. 双客户端同 Thread 冲突仍显示 `WRITER_CONFLICT`，不换 ID。
12. 重新打开 Workbench 后最后选择 Thread 和侧栏 ownership 正确。

## 13. accepted limitations / deferred

- 没有 Electron 自动化 GUI harness；上节人工清单必须由用户使用最新 packaged EXE 验收。
- 真实 Approval allow/deny 需要用户触发对应 command/file 权限场景；Composer real smoke 已标出 `manual-trigger-required`。
- 稳定制造远端 `no rollout found` 受 Codex rollout 生命周期和外部服务影响；contract 已覆盖，不能将本报告的 process-exit smoke 说成 no-rollout real smoke。
- Attachment 仍 deferred/unsupported。
- UI convergence / Visual Polish 明确 deferred to STAGE I，当前不作为 STAGE H 缺陷处理，除非影响功能使用或误操作。
- Project Map maintenance Thread 的远端清理边界、无损本地 metadata cleanup retry 仍按既有 Stage G limitation 管理；本阶段只确保 cleanup failure 可见且不递归删除用户目录。

## 14. legacy / local file status

旧 donor `D:\办公\AI\Codex_Workbench` 保持原 dirty baseline，未执行 reset、clean、stash、checkout、format 或 commit。

当前用户本地文件保持未纳入：

- `dist-stage-a/`
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`

## 15. gate

```text
Automated Gate: PASS
Real App Server Gate: PASS
Manual Functional Acceptance: PENDING
STAGE H: PASS_AUTOMATED / MANUAL_MERGED_TO_STAGE_J
Packaged Build: PASS
Manual GUI Acceptance: REQUIRED / NOT CLAIMED
STAGE I: PASS / FROZEN
STAGE J: IN_PROGRESS
```

STAGE H 本身不独立冻结；剩余人工功能验收由 STAGE J 最终总体验收承接。
