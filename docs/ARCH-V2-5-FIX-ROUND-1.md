# ARCH-V2-5 FIX ROUND 1

stage: ARCH-V2-5 FIX ROUND 1
base_commit: 49efa07
implementation_commit: 880e3ee
v1_core_changed: NO
aut2_aut3_restored: NO
real_business_prompts: 0
gate: READY_FOR_GPT_REVIEW

本轮处理 GPT 指出的 production Budget caller closure、production consumer
evidence、legacy unpinned fail-closed 和 reservation lifecycle。没有进入
ARCH-V2-6，也没有恢复 AUT-2/AUT-3。

## FIX-01 Production Budget Caller Closure

ACTIVE_PRODUCTION：

- webgpt.send / RequestManager Prompt：新 Request 先获取并持久化当前
  PolicyVersion ID，真正 dispatch 前按该 ID 做 authorizePinned、reserve、commit。
- webgpt.new-chat、project new-chat 和 RequestManager 隐式 NewChat：在同一
  PolicyVersion authority 下 authorize、reserve、commit 后才进入浏览器 side effect。
- Repair 的 reservation commit boundary 已移动到不可逆 transport call 之前；
  pre-dispatch rejection 仍释放，未知结果不退款。

PAUSED_NOT_EXECUTABLE：

- AUT-2 Requirement Gate 与 AUT-3 Planner 只在显式测试/gate 环境变量下运行。
- 本轮没有恢复其真实 Prompt，也没有把它们伪装成当前生产 caller。

TEST_ONLY：

- arch-v2-5-production-consumers.test.ts 的 Authority fixture、Prompt/Retry/
  NewChat matrix 和 reservation assertions。
- External Action bridge 的 bounded observation/contract tests。

LEGACY_READ_ONLY：

- Request Journal 的 status、inspect、readLatest、reconcile query 只读路径；
- 旧 operation budget、arbiter diagnostics、planner/retry metadata 和 parser
  只作为历史/诊断资料，不能直接产生生产网页副作用。

## FIX-02 Production consumer evidence

生产风格测试证明：

1. PROMPT、RETRY、NEW_CHAT 分别获取固定 PolicyVersion ID；
2. reservation 的 correlationId 与 operation correlation 一致；
3. 同 correlation 的第二次调用在 provider side effect 前被拒绝；
4. 预算耗尽在 provider/browser call 前被拒绝；
5. RequestManager fixture 记录 pin，并在 Prompt 预算耗尽时 submitPrompt
   调用数保持不变。

这些是本地 fake workspace/temporary AutomationStore 证据，不是线上 ChatGPT
Prompt，也不冒充真实网页业务闭环。

## FIX-03 Legacy unpinned fail-closed

- 旧 Journal 缺少 policyVersionId 时，normalize 只把它表示为 null，不静默写入
  latest，也不替换历史身份。
- status/read/inspect/display 可以继续读取该记录。
- 生产 RequestManager 对缺 pin 的 Prompt/Repair/Retry/NewChat 在副作用前返回
  POLICY_PIN_REQUIRED；没有 fallback latest、替代 policy 或替代 Request。
- 只有新命令显式获取并持久化当前 pin，或未来明确的 pin/migrate/authorize
  操作，才允许进入副作用路径。

## P2 Reservation lifecycle

1. pre-dispatch failure：release，且 release 幂等；
2. commit immediately before provider/browser dispatch：计数归属该 operation；
3. dispatch 后抛错/未知结果：保持 committed，不退款、不重放。

测试覆盖 double release、commit 后 release 不退款、duplicate correlation、
exhaustion block。当前 host 内的 reservation 使用单一 authority，跨进程/重启
后的预算计数耐久化仍是已披露限制。

## Scope boundary

未修改 Native Thread/Turn/Item、V1 Conversation truth、Runtime Registry、
WebGPT 页面协议、Automation workflow、Planner、Scheduler 或下一阶段架构。
