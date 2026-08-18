# Codex Workbench V1 — STAGE A Post-Acceptance Fix

## 阶段状态

- 阶段：`STAGE-A-POST-ACCEPTANCE-FIX`
- 范围：只闭环 orphan/invalid Thread 与 restart reopen lifecycle；不进入 STAGE B。
- 当前状态：实现与自动化/真实 CLI 验证完成，等待 GPT 审查和用户人工复测。
- Native Thread、Native Turn、Native Item 仍是运行事实；没有新增 Conversation/Transcript 第二事实源。

## 1. 两个真实问题与根因

### 问题 A：孤儿 Thread `no rollout found`

原链路在切换失败后由 Renderer 恢复先前可用 Thread。这样视觉上的点击目标与实际运行目标可能不同，Composer 还可能把消息发送到恢复后的 Thread。此前的本地清理路径也会把远端缺失误当成删除条件。

本次将 `no rollout found` 从普通 App Server 错误中单独分类为 Native identity unavailable：

```text
点击 X
→ X 的真实 resume/read 失败
→ Main 标记 X 为 unavailable，并清空当前隐式目标
→ Renderer 清空选中态和 Composer 目标
→ 禁止发送；不会改发 Y
```

不会自动删除本地 projection、Project 归属、Prompt recovery 记录或 `nativeThreadId`，也不会创建替代 Thread。

### 问题 B：重启后的过度恢复/复用

重启后 Renderer 只取得空闲状态时，持久化 binding 没有立即触发真实 resume；同时一次 resume 的 writer conflict、网络/读取失败可能把 projection 污染为永久 `failed`。用户再次点击时才会重新触发正确 resume，所以表现为“重新点开才恢复”。

本次改为：启动时仅按已有 binding 做一次真实 `start → resume/read` 尝试；失败保存真实错误但保留原 projection 状态，用户显式点击时再次对同一个 ID 做真实 resume/read，成功后清除 transient error 并回到 `ready`。active Turn 的 `recovery_required` 仍按原有安全策略保留，不伪造继续。

## 2. 变更文件与行为

- `src/main/main.ts`
  - `no rollout` 进入 `unavailable` fail-closed 分支。
  - 保留 projection/Project/Prompt/native ID；关闭该 ID 的本地 runtime，不做删除。
  - 失败目标会清空 Main 的 `currentNativeThreadId`，后台旧 runtime 即使仍存活也不再成为隐式 Composer 目标。
  - Composer IPC 在 `turn/start` 前校验目标 ID 与当前选中 ID、Runtime ID 一致。
  - 选择成功时先持久化 binding，再更新当前 ID；创建异常时 detach 已附着 runtime。
- `src/main/thread-availability.ts`
  - 新增只更新 projection 状态的 `markThreadUnavailable`，不改变身份和归属。
- `src/codex/native-thread-runtime.ts`
  - resume/read 失败保留原 projection 状态并保存 transient error。
  - writer conflict 继续保留原始原因，关闭/重试不创建新 Thread。
  - 成功 reopen 继续写回同一 ID 的 `ready` 和 `lastError: null`。
- `src/renderer/renderer.ts`
  - 失败点击不回退到旧 Thread 的可发送 UI，明确显示 `Native Thread 不可用`。
  - 无有效目标时清空 Composer、当前 Thread 视图和状态字段；只能显式切换其他 Thread。
  - 启动时按持久化 binding 自动做一次真实恢复；预期的“没有 binding”不制造噪声，其他失败保留错误。
  - 后台 Thread 的状态事件只更新导航诊断，不会在无选中态时偷偷选成当前 Thread。
  - 发送前校验 selected/requested/runtime 三个 ID 和 `READY` 状态。
- `src/shared/thread-target.ts`
  - 提取 Composer target truth 纯校验，保证三方身份一致且 Runtime ready。
- `src/shared/runtime-types.ts`、`src/shared/persistence-store.ts`、`src/renderer/index.html`
  - 增加 `unavailable` projection 状态及对应持久化/UI 显示。
- `src/shared/thread-state-store.ts`
  - 保留 binding，不再为远端缺失提供删除 binding 的路径。
- `src/shared/error-info.ts`
  - 对 `no rollout found` 与 writer conflict 分开分类。

## 3. Active Thread Truth 与 Composer guard

发送必须满足：

```text
composer requested nativeThreadId
== selected nativeThreadId
== runtime nativeThreadId
且 runtime.state == READY
```

任意 ID 缺失、X/Y 不一致、Runtime 非 `READY` 都返回 `THREAD_TARGET_MISMATCH`，不调用 `turn/start`。失败切换 X 时，Main 当前目标清空；Renderer 不显示 Y 为 X，也不接受 Y 的后台状态事件来重新建立 Composer 目标。

## 4. Orphan handling

`no rollout found` 只表示当前 Native Thread 无法被 Codex App Server resume/read。处理结果：

- projection 继续存在，`nativeThreadId` 不替换。
- Project ownership、标题、Prompt recovery 数据不删除。
- projection 标记为 `unavailable`，保留原始错误。
- 关闭对应本地 runtime，取消对应 approval；不影响其他 Thread 的后台 runtime。
- Composer fail-closed；不 fallback send、不创建 replacement Thread。
- 用户稍后显式重新打开时仍会尝试同一 ID，成功可收敛为 `ready`。

## 5. Restart / reopen handling

- Renderer 初始化后读取持久化 binding，并调用已有 `native-runtime:start`；不是新建 Thread。
- Runtime 记录本次是否尝试了 resume；resume 失败时保留原 `lastKnownState`，只更新真实 `lastError`。
- writer conflict、暂时不可用、传输失败与 active-turn recovery 分开保留；不会把一次自动恢复失败直接当作永久 projection 事实。
- 用户显式点击使用同一 `nativeThreadId` 的 `switch → resume/read`；成功写回 `ready`、清除 transient error，ID 不变。

## 6. 自动化验证

### Contract / unit

- `npm run check`：PASS。
- `npm test`：PASS，66/66。
- 覆盖：
  - orphan 标记为 `unavailable`，projection/Project/Prompt/native ID 保留。
  - resume/read no-rollout 失败保持原投影状态，第二次同 ID resume 成功，`startCalls` 不增加。
  - Composer selected/requested/runtime ID 不一致或 Runtime 非 ready 时 fail-closed。
  - writer conflict 保持 `WRITER_CONFLICT`，后续同 ID retry 成功，不创建 Thread。
  - 两个 Native Thread 并行运行、只中断目标 Thread、事件不串线。

### Build / dependency / hygiene

- `npm run build`：PASS。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：最终门禁执行并记录。
- secret scan：最终门禁执行并记录；只扫描本阶段变更文本，不扫描用户保留的二进制资料。

## 7. Real App Server smoke

以下脚本均使用临时 persistence/state 目录，并在 finally 中调用真实 App Server 的 `thread/delete` 清理测试 Thread：

- `npm run test:real:navigation`：PASS；项目/Standalone Thread 创建、按原 ID 切换、重启恢复同一 ID、turn event 归属通过。
- `npm run test:real:workspace`：PASS；真实 Thread 中断、继续、`thread/read`、重启后同 ID resume/read 通过。
- `npm run test:real:multi-thread`：PASS；A/B 并行 turn 完成、事件按 Thread 隔离通过。

当前没有稳定、可控且不破坏用户数据的真实 `no rollout found` 制造条件，因此不声称已经真实触发该错误；该分支由 `isNoRolloutError`、`markThreadUnavailable`、Runtime retry contract 覆盖。真实 smoke 已覆盖可重新 reopen 并恢复同一 Native Thread 的部分。

## 8. 用户人工复测

修复后只需复测新增问题：

1. 点击失效/不可用 Thread：显示不可用；Composer 禁止发送，不能发送到其他 Thread。
2. 显式切回正常 Thread：Send 正常，消息和 Thread ID 归属正确。
3. 关闭 Workbench 后重新打开曾被 Codex Desktop 使用的 Thread：自动恢复失败时显示真实错误/待重试，不永久污染为 failed；再次点击后同一 nativeThreadId 恢复 ready。
4. 同 Thread 双客户端：仍显示 `WRITER_CONFLICT`，不创建替代 Thread；关闭另一客户端后重试成功。

## 9. 子代理与旧 donor

- Newton：只读审计了 orphan cleanup、binding 顺序、Renderer rollback、缺失测试；结果已整合。
- Parfit：只读审计了重启时 binding 未自动 resume、writer conflict 投影污染；结果已整合。
- 两个子代理均未写产品文件；审查整合后关闭。Gate 时 `running_subagents = 0`。
- 旧 donor `D:\办公\AI\Auto_Agent`：未修改，最终状态保持 clean。

## 10. 范围边界与已知限制

- 不进入 STAGE B；不重做 RuntimeRegistry、Navigation、Map 规则或产品层。
- 不自动删除孤儿 projection；远端删除/数据恢复不在本阶段范围。
- 不把 GUI 人工验收伪装成 CLI 通过；上述第 8 节仍需用户复测。
- App Server 的真实 `no rollout found` 不能安全稳定制造，故使用 contract/integration evidence，不冒充真实触发。
