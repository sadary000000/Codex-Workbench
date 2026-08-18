# Codex Workbench V1 — STAGE J 最终集成验收 / Release Candidate

日期：2026-08-19
状态：`STAGE J RC READY / V1 FINAL MANUAL ACCEPTANCE PENDING`
范围：STAGE A–I 最终集成审计、最小可靠性修复、全量自动化/真实 App Server 回归、最终打包与文档收口。

> 本报告不写 `V1 FINAL FROZEN`。STAGE J 自动化与真实回归 Gate 已完成；最终冻结仍等待用户最后一次人工总体验收。

## 1. scope resolution

- 正式阶段：`STAGE J — V1 Final Integrated Acceptance / Release Freeze`。
- 不新增一级功能、不做新的 UI 设计、不扩 Scope；只做最终审计、必要的最小 BUG 修复、回归、RC 打包和证据整理。
- STAGE H 尚未独立完成的 Manual Functional Acceptance 按用户要求合并到本阶段最终人工总体验收。
- 不进入 STAGE K。

### architecture boundary

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → 唯一消息与运行事实
Codex App Server → V1 Runtime 主路径
```

Workbench 没有重新建立 Conversation truth、Transcript truth、Task truth、Agent lifecycle truth、Context truth 或 Exec-history reconstruction。Project Map 的维护 Thread 是明确隔离的 sidecar/maintenance runtime，不是用户 Thread 的替代身份。

## 2. stage status

| 阶段 | 最终状态 | 说明 |
| --- | --- | --- |
| A | PASS / FROZEN | Multi-Thread Runtime 基线 |
| B | PASS / FROZEN | Workspace Scroll / Composer 基础 |
| C | PASS / FROZEN | UI Projection / Diagnostics 分层 |
| D | PASS / FROZEN | Thread 标题与左侧导航状态 |
| E | PASS / FROZEN | Thread Header / Conversation Stream |
| F | PASS / FROZEN | Composer Capability / Approval / Persistence |
| G | PASS / FROZEN | Project lifecycle / ownership / safety；UI convergence 已在 I 处理 |
| H | AUTOMATED/REAL PASS；FINAL MANUAL MERGED INTO J | 不独立声称用户人工 PASS |
| I | PASS / FROZEN | 用户明确确认 `STAGE I FIX 测试通过` |
| J | FINAL RC — AWAITING USER FINAL ACCEPTANCE | 本报告完成自动化/真实回归收口 |

### STAGE I / H freeze records

- STAGE I FIX Automated / Implementation Gate：PASS。
- STAGE I Manual GUI Acceptance：PASS；唯一人工依据是用户明确确认 `STAGE I FIX 测试通过`，没有补写未经用户陈述的逐项观察。
- STAGE I 冻结提交：`370b9b56eb5d9dc1b03f4d3d600eb6e29aec5cec`。
- STAGE H 保持 `Automated Gate: PASS`、`Real App Server Gate: PASS`、`Manual Functional Acceptance: PENDING`；剩余人工验收并入 J，状态为 `PASS_AUTOMATED / MANUAL_MERGED_TO_STAGE_J`，没有伪造 H 独立用户 PASS。

## 3. architecture / identity final audit

- Native Thread 是用户对话身份；只有明确新建 Thread 才产生新 `nativeThreadId`。
- Native Turn / Native Item 是消息、状态、Approval、Tool、Diagnostics 和 source trace 的运行事实。
- `resume`、`restart`、`reopen`、writer conflict、orphan/no-rollout、Project rename/remove、pin/unpin、Sidebar collapse、Map source jump、Composer setting change 均保留原 `nativeThreadId`。
- 选中 Thread、运行 Runtime、Composer target 在发送前保持同一 Thread 目标；点击失败时不静默 fallback 到另一个 Thread。
- Project Map maintenance runtime 与普通 Thread Registry 隔离；它是辅助 sidecar，不是隐藏 replacement Thread system。

## 4. runtime / recovery final

本轮发现并修复两个 P1 跨 Thread 状态污染问题，修复提交：

`09cd467b12937f0642d8b8b67a6fb763d23a301f` — `fix: harden v1 final release candidate`

### fixes applied

1. `src/main/main.ts`：后台 Thread unavailable/no-rollout 失败不再无条件清空 `currentNativeThreadId`；只有失败目标仍是当前选中 Thread 时才清空。
2. `src/renderer/renderer.ts`：`NATIVE_THREAD_UNAVAILABLE` 只在 operation target 等于当前选中 Thread 时清空当前 UI；后台失败不会覆盖 B。
3. `src/renderer/renderer.ts`：非选中 Thread 的 completed/interrupted Turn 清理自己的 draft；failed/unknown Turn 保留自己的 draft，避免 Prompt 静默丢失。
4. 新增 `tests/stage-j-reliability-contract.test.ts`，3/3 contract tests 锁定上述跨 Thread / Prompt recovery 行为。

### final behavior

- process exit / reconnect / explicit reopen：保留同一 nativeThreadId。
- transient resume failure：保留错误与恢复状态，显式 reopen 重新真实 resume/read。
- writer conflict：按同 Thread 报错，不抢锁、不换 ID、不新建替代 Thread。
- orphan/no-rollout：fail-closed，保留本地 identity/ownership，不静默删除、不 fallback send。
- failed/interrupted Turn：不会永久污染 Thread；Composer target 与运行 target 不一致时禁止发送。
- Stop、Approval、live events 和 Diagnostics 按 nativeThreadId 隔离。

## 5. multi-thread / workspace / responsive

- A/B 并行 real smoke PASS；不同 Thread 不再因 active Turn 触发旧式 `THREAD_SWITCH_BUSY`，切换不会关闭后台 Runtime。
- Approval、Stop、Diagnostics、Composer target、Model/Reasoning preference 与 activity state 按 Thread 隔离。
- STAGE I 的 outer page-level scroll、Sidebar 独立列表滚动、Workspace/Conversation 独立滚动、Diagnostics Bottom Drawer、固定底部 Composer、Compact Composer、responsive layout 和 Map/right-panel compatibility 已通过实现/自动化/真实回归 Gate。
- 人工结论仅引用用户明确确认的 `STAGE I FIX 测试通过`，没有擅自扩写 1600/1280/1024/约 800px 的逐项 GUI 观察。
- Stage B 的 Composer 常驻、底部跟随、Jump to latest、用户上滚不抢位置继续保留。

## 6. composer / approval / project

- Model、Reasoning、Access/Approval、Send/Stop、textarea max-height/internal scroll、per-thread preference、restart persistence、Requested/Sent Diagnostics 均保留。
- capability discovery 使用真实能力；不支持的保存值 fail-closed，不 silent fallback；Attachment 仍为 `deferred / unsupported`。
- Approval 以 `nativeThreadId + rpcId` 隔离；Allow、Deny、Stop during pending Approval、wrong owner fail-closed 均有 contract/real evidence，稳定 GUI Allow/Deny 仍需用户最终验收。
- Add、duplicate canonical path、rename、Open in Explorer、remove、restart、external missing cwd 均有 smoke/contract 覆盖。
- Remove Project 不删除真实磁盘目录或文件；Thread 不换 nativeThreadId，remove 后安全 detach 到 Standalone/Recent；missing cwd fail-closed，不自动创建替代目录。

## 7. diagnostics / map / persistence

- Diagnostics 按 nativeThreadId 隔离，可查看 raw thread/read、Turn/Item、Requested/Sent、错误和 source trace。
- Conversation Map、resumed map、Project Map、context、pause/resume smoke 均通过；Map source jump 定位真实 Native Turn/Item。本阶段没有重做 Map UI 或 semantic rules。
- `workbench-state.json`、displayTitle、composerPreferences、Projects、ownership、pinned、sidebar state 和 canonical cwd 已纳入审计及 persistence smoke。
- 缺少 `workbench-state.json` 按首次运行空状态处理；极旧/稀疏 state 缺少 projectId/pinned/lastError 等字段时迁移覆盖不完整。低层 Store API 的 canonical cwd 约束主要由 Main 入口保证；本轮未发现 startup crash、wrong-thread send 或 identity replacement。
- `PromptRecoveryRecord` 是有意的 draft recovery copy，不是第二 Transcript truth。

## 8. bugs found / fixes

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| 后台 A no-rollout/unavailable 清空选中 B | UI/active truth 可能被错误清空 | `09cd467` 条件化 Main selected target 清理 |
| 后台失败 Turn 删除自己的 draft | 失败 Prompt 可能静默丢失 | `09cd467` 按 terminal status 清理/保留 draft |
| 后台 unavailable 事件清空 B Renderer | selected/runtime 表现可能不一致 | `09cd467` 仅 selected operation 清空 UI |

没有发现需要扩大 Scope 的新一级功能或阻塞性 P1；本阶段没有顺手重做冻结模块。

## 9. tests

| 验证 | 结果 |
| --- | --- |
| `npm run check` | PASS |
| `npm test` | PASS，116/116 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS，无 whitespace error |
| secret scan | PASS，覆盖 src/scripts/docs/package metadata |
| Stage J contract | PASS，3/3 |

### real smoke matrix

以下正式 real smoke 均在最终修复后完成。`project-map` 首次遇到测试状态中的 transient failed Turn，清理测试脚本创建的残留 `.real-smoke` 绑定后重跑 PASS；基础 `test:real` 首次遇到 TLS/stream disconnected，使用测试清理开关重跑 PASS。首次异常未隐藏，最终 Gate 采用成功重跑结果。

| 命令 | 最终结果 |
| --- | --- |
| `npm run test:real` | PASS（清理测试状态后重跑） |
| `npm run test:real:navigation` | PASS |
| `npm run test:real:workspace` | PASS |
| `npm run test:real:multi-thread` | PASS |
| `npm run test:real:composer-capability` | PASS |
| `npm run test:real:composer-persistence` | PASS |
| `npm run test:real:project-lifecycle` | PASS |
| `npm run test:real:reliability` | PASS |
| `npm run test:real:map` | PASS |
| `npm run test:real:resumed-map` | PASS |
| `npm run test:real:project-map` | PASS（清理测试状态后重跑） |
| `npm run test:real:context` | PASS |
| `npm run test:real:map-pause` | PASS |

`.real-smoke` 测试目录及测试产生的临时绑定已移出到可恢复临时目录 `C:\Users\sadar\AppData\Local\Temp\codex-workbench-v1-real-smoke-stale-20260819`；没有删除不确定资源。

## 10. final release candidate package

- 固定路径：[Codex Workbench V1.exe](D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe)。
- package 创建时间：`2026-08-19T07:35:02.8427754+08:00`。
- 文件大小：`225441792` bytes。
- SHA-256：`31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`。
- 代码来源：`09cd467b12937f0642d8b8b67a6fb763d23a301f`。
- metadata：`name=codex-workbench-v1`、`version=0.1.0`、`type=module`、`main=dist/main/main.js`。
- 该 EXE 是当前最终修复提交生成的固定 `dist/package` RC，不使用旧 artifact 冒充。
- package 前生成的 package-local `user-data/logs` 已移动到可恢复备份目录 `C:\Users\sadar\AppData\Local\Temp\codex-workbench-v1-package-user-data-backup-20260819`，未删除用户文件。

### GPT review FIX — package provenance

GPT 审查指出 STAGE H 与 STAGE J 的 EXE SHA-256 相同，需要排除 stale package。复核结果如下：

- Git ancestry 通过：`552c28c → 09cd467 → 7a3738b`；`09cd467` 确实是当前源码祖先。
- `scripts/package-win.mjs` 复制 `node_modules/electron/dist/electron.exe` 后只重命名为 `Codex Workbench V1.exe`；因此固定 Electron 外壳的 SHA 相同是预期行为，不能单独证明复用了旧 app。
- 从当前源码使用临时输出目录重建成功：`C:\Users\sadar\AppData\Local\Temp\codex-workbench-v1-stage-j-package-20260819`。
- 标准包与临时重建包的 `dist/main/main.js` SHA 均为 `36B796FF0B886EAF27A3448F07283A23A303AB513A4717CC0C1AF1DBE7437209`；`dist/renderer/renderer.js` SHA 均为 `D03F52E8EF2E61EAB52442C288F17D027F509EF4B9AA9A29822467716A32B38D`；`package.json` SHA 均为 `1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F`。
- 标准包 `resources/app/dist/main/main.js:311` 包含 `if (currentNativeThreadId === id)`；临时重建包同样包含。临时包 Renderer 还包含 `selectedNativeThreadId === operationThreadId` 与失败 draft 保留逻辑。
- 结论：不存在 stale app 证据，`09cd467` 已进入当前标准包的 app resources；关闭目标 EXE 后已正式重跑 `npm run package:win`，标准路径重新写入并完成复核，Package Provenance Gate PASS。

## 11. security / Git scope

- secret scan PASS；没有发现 API key、private key、Token、Cookie、password 或测试凭据被纳入变更。
- 用户未提交文件保持原状态且未 add：`dist-stage-a/`、`指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`、`指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`。
- 旧 donor `D:\办公\AI\Codex_Workbench` 只读、未修改；它保留进入本轮前的既有 dirty baseline，本轮未执行 reset、clean、stash、checkout 或 commit。Auto_Agent 旧项目未作为产品工作目录、未修改。
- 本轮没有加入 Workflow、Review、Git Workbench、Browser、Multi-Agent 产品层、Prompt Templates、Attachment 假实现、Map semantic redesign 或 Project Dashboard。

## 12. subagents

| Agent | 任务 | 自然完成 | 结果/采用 | 验证 | 最终状态 |
| --- | --- | --- | --- | --- | --- |
| Nash | Architecture / Identity Final Audit | 是 | 唯一事实源、nativeThreadId 隔离 PASS；采用 sidecar limitation | 代码、tests、reports 对照 | completed；审核后关闭 |
| Poincare | Runtime / Reliability Final Audit | 是 | 定位两个 P1 cross-thread 污染点；修复采用 | 3 contract tests + full/real regression | completed；审核后关闭 |
| Singer | UI / Layout Final Audit | 是 | shell/sidebar/workspace/diagnostics/composer/responsive PASS | code/resource/contract/build evidence | completed；审核后关闭 |
| Bacon | Persistence / Project Final Audit | 是 | ownership/filesystem safety PASS；记录 state migration 边界 | persistence/project smokes + source audit | completed；审核后关闭 |
| Kuhn | Test / Package / Security Final Audit | 是 | matrix/package/security/git boundary PASS；记录 GUI/metadata 限制 | final matrix/hash/audit/scan | completed；审核后关闭 |

`running_subagents_at_gate: 0`。五个子代理均自然完成、由主 Agent 审核整合后关闭，没有因等待时间提前终止。

## 13. accepted limitations / deferred items

- Attachment：`deferred / unsupported`。
- 没有可用 Electron viewport GUI harness；Stage I 人工结论只采用用户明确的阶段级确认。
- Approval 的稳定真实 GUI Allow/Deny E2E、Explorer 的真实 GUI 操作仍需用户最后验收；contract/real smoke 不能冒充 GUI PASS。
- 极旧/稀疏 `workbench-state.json` 的部分字段迁移覆盖不完整；缺 state 按首次运行空状态处理。
- RuntimeRegistry closeAll/ensure 并发窗口、空 stop target race 属于已识别 P2 hardening 边界，本轮未观察为阻塞性问题。
- Project Map maintenance Thread 是隔离 sidecar，不是用户可见对话替代；其远端生命周期不作为用户 Thread identity。
- package 脚本会重建 `dist/package`，当前 package 未嵌入独立 provenance manifest；报告以 source commit、创建时间、文件大小和 SHA-256 绑定 RC。
- UI 深度 polish、Attachment 等超出本阶段范围的项目不在 J 内扩展。

## 14. final user manual acceptance checklist

用户使用固定路径 EXE，只需最后一次总体验收：

1. A/B Native Thread 并行运行、切换和输出归属不串。
2. Stop 只停止目标 Thread，另一 Thread 不受影响。
3. Approval Allow/Deny 正常；Approval 不串 Thread，Deny 不执行。
4. 正常关闭、重启、Reopen 后历史可读且 nativeThreadId 相同。
5. 安全制造一次失败后，失败 Prompt 不静默丢失，修正条件后可重发。
6. A/B 的 Model、Reasoning、Access/Approval 等配置独立保存并在重启后恢复。
7. Project Add/duplicate/rename/remove 安全；Remove 不删除目录和文件。
8. Project cwd 被外部移动/删除后明确 fail-closed，不偷换目录或 Project。
9. 左侧 Sidebar 固定区与 Thread/Project 列表独立滚动。
10. Conversation 独立滚动；长对话上滚时不被新输出抢回。
11. Diagnostics Bottom Drawer 向上展开，内部可查看且不把 Composer 滚走。
12. Composer 固定在底部，Send/Stop 和 textarea 可用。
13. 约 800px 窄窗口以及 1024/1280/1600px 下无 page-level/horizontal overflow，控件可操作。
14. Map source jump 定位到正确 Native Turn/Item，Diagnostics source trace 对应。
15. 点击失败或 Thread 不可用时禁止 wrong-thread send；当前实际 active Thread 清晰。
16. 任何恢复/切换都不静默替换 nativeThreadId，不创建隐藏 replacement Thread。

## 15. final gate

```text
STAGE J Automated Final Gate: PASS
STAGE J Real App Server Gate: PASS
STAGE J Architecture / Scope Audit: PASS
STAGE J Package Gate: PASS
STAGE J Temporary Rebuild Provenance: PASS
STAGE J Standard Repackage: PASS
STAGE J Security / Git Scope Gate: PASS
STAGE J Manual Final Acceptance: PENDING
STAGE J: RC READY
V1 FINAL MANUAL ACCEPTANCE: PENDING
STAGE K: NOT_STARTED / FORBIDDEN
```

标准 package provenance 已复核；等待用户最后一次总体验收。在用户明确确认之前不写 `V1 FINAL FROZEN`。

## 16. requested handoff fields

```text
[CODEX_WORKBENCH_STAGE_REVIEW]
stage: STAGE J
official_stage_name: V1 Final Integrated Acceptance / Release Freeze
stage_i_freeze_commit: 370b9b56eb5d9dc1b03f4d3d600eb6e29aec5cec
base_commit: 552c28c
implementation_or_fix_commit: 09cd467b12937f0642d8b8b67a6fb763d23a301f
final_report_commit: 207b06dc80fd8c033c4978fb12eccfb4cb31b4b0 (document-introducing commit)

stage_status:
  A: PASS / FROZEN
  B: PASS / FROZEN
  C: PASS / FROZEN
  D: PASS / FROZEN
  E: PASS / FROZEN
  F: PASS / FROZEN
  G: PASS / FROZEN
  H: AUTOMATED/REAL PASS; FINAL MANUAL MERGED INTO J
  I: PASS / FROZEN (user-confirmed)
  J: RC READY / FINAL MANUAL ACCEPTANCE PENDING

architecture_final: PASS
identity_final: PASS
runtime_recovery_final: PASS after minimal cross-thread fix
multi_thread_final: PASS
workspace_final: PASS by implementation/automated/real evidence; final GUI acceptance pending
composer_final: PASS by contract/real evidence; final GUI acceptance pending
approval_final: contract/real evidence PASS; GUI Allow/Deny pending
project_lifecycle_final: PASS by smoke/contract evidence; final GUI acceptance pending
diagnostics_map_final: PASS
persistence_final: PASS with sparse legacy migration limitations recorded

bugs_found: 2 P1 cross-thread state/draft pollution issues
fixes_applied: 09cd467; 3 Stage J contract tests; full regression rerun
tests: check PASS; 116/116 tests PASS; build PASS; package PASS; audit 0 vulnerabilities; diff-check PASS; secret scan PASS
real_smoke_matrix: all required real smokes PASS after documented transient/test-state cleanup reruns

package:
  path: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
  sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
  source_commit: 09cd467b12937f0642d8b8b67a6fb763d23a301f

security: PASS
git_scope: PASS; only intended product fix/docs commits, user files untouched
local_user_files_status: preserved and untracked; not added/modified/deleted
legacy_project_status: D:\办公\AI\Codex_Workbench read-only; pre-existing dirty baseline preserved; no reset/clean/stash/checkout/commit
subagents: Nash/Poincare/Singer/Bacon/Kuhn all naturally completed, reviewed, adopted as applicable, then closed
running_subagents_at_gate: 0
accepted_limitations: legacy sparse-state migration edges, no Electron GUI harness, maintenance sidecar boundary, package provenance not embedded
deferred_items: Attachment; final GUI Approval/Explorer and final integrated manual acceptance; STAGE I user-confirmed stage-level GUI only
blockers: none for RC; final user acceptance is required
manual_final_acceptance_required: yes
gate: RC_READY_FOR_USER_FINAL_ACCEPTANCE
```

完成本报告后 STOP；不进入 STAGE K。
