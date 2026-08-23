# ARCH-V2-5 Out-of-Scope Findings

以下事项没有在本阶段偷偷改写：

1. AUT-2/AUT-3 历史 harness 的 prompt/new-chat counters 尚未全部迁移到 Authority。
2. 全部 WebGPT CLI/Request Manager 入口尚未使用 PolicyVersion pin/预算 authority。
3. legacy unpinned records 的批量迁移策略尚未确定。
4. Provider-neutral ports、Automation、Planner、Scheduler、Workflow 仍未启动。

这些是下一轮需要 GPT 明确授权的设计/迁移问题，不是本阶段已完成的能力。
