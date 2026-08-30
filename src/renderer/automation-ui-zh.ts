const TARGET_DIALOGS = [
  "#automation-requirement-planner-dialog",
  "#automation-governance-actions-dialog",
] as const;

const EXACT_TRANSLATIONS = new Map<string, string>([
  ["Requirement / Planner", "需求 / 规划"],
  ["Provider Target · Native Runtime Truth", "Provider 目标 · Native 运行时真值"],
  ["已显式选择 target", "已显式选择目标"],
  ["exact identity matches current Runtime Truth", "精确身份与当前运行时真值一致"],
  ["Execute/start 前需要 exact identity match", "执行 / 启动前需要精确身份匹配"],
  ["刷新 Runtime Target", "刷新运行时目标"],
  ["Requirement Questions", "需求问题"],
  ["blocking", "阻塞"],
  ["non-blocking", "非阻塞"],
  ["Requirement Alignment", "需求对齐"],
  ["not started", "未开始"],
  ["session status", "会话状态"],
  ["goal", "目标"],
  ["current round", "当前轮次"],
  ["latest draft", "最新草案"],
  ["Request / Continue Draft", "请求 / 继续生成草案"],
  ["Reconcile Provider", "对账 Provider"],
  ["Confirm exact Requirement", "确认当前 Requirement"],
  ["Goal", "目标"],
  ["Scope", "范围"],
  ["Out of scope", "范围外"],
  ["Functional requirements", "功能需求"],
  ["Technical constraints", "技术约束"],
  ["Environment constraints", "环境约束"],
  ["Acceptance criteria", "验收标准"],
  ["Risk constraints", "风险约束"],
  ["External dependencies", "外部依赖"],
  ["Assumptions", "假设"],
  ["Human approval points", "人工确认点"],
  ["Deferred gates", "延后门禁"],
  ["Planner", "规划器"],
  ["no active PlanVersion", "无活动 PlanVersion"],
  ["active RequirementVersion", "活动 RequirementVersion"],
  ["active PlanVersion", "活动 PlanVersion"],
  ["Create Plan on selected Native Thread", "在所选 Native Thread 上创建 Plan"],
  ["Reconcile Planner", "对账 Planner"],
  ["Retry exact Planner intent", "重试同一 Planner 意图"],
  ["Planner Status", "Planner 状态"],
  ["Planner Result", "Planner 结果"],
  ["operation status", "操作状态"],
  ["ActionIntent", "动作意图（ActionIntent）"],
  ["ActionAttempt", "动作尝试（ActionAttempt）"],
  ["receipt", "回执"],
  ["attempt state", "尝试状态"],
  ["recovery", "恢复状态"],
  ["Planner blocking questions", "Planner 阻塞问题"],
  ["Missing Requirement fields", "缺失的 Requirement 字段"],
  ["Requirement Projection Integrity", "Requirement 投影完整性"],
  ["Native Executor Target", "Native 执行器目标"],
  ["Runtime Truth", "运行时真值"],
  ["已显式选择的 Executor Target", "已显式选择的执行器目标"],
  ["Execute on selected Native Thread", "在所选 Native Thread 上执行"],
  ["Reconcile", "对账"],
  ["Verify", "验证"],
  ["Review APPROVE", "审核：通过"],
  ["Review REJECT", "审核：拒绝"],
  ["Gate PASS", "阶段门禁：通过"],
  ["Gate REJECT", "阶段门禁：拒绝"],
  ["Advance Stage", "推进阶段"],
  ["Complete Project", "完成项目"],
  ["Automation Governance Actions", "Automation 治理操作"],
  ["Start Requirement", "开始 Requirement"],
  ["Request Requirement Draft", "请求 Requirement 草案"],
  ["Reconcile Requirement", "对账 Requirement"],
  ["Confirm Requirement", "确认 Requirement"],
  ["提交 Requirement answers", "提交 Requirement 回答"],
  ["Retry Planner", "重试 Planner"],
  ["Read Planner Status", "读取 Planner 状态"],
  ["Read Planner Result", "读取 Planner 结果"],
  ["Execute Step", "执行 Step"],
  ["Reconcile Step", "对账 Step"],
  ["Verify Step", "验证 Step"],
  ["Stage Gate PASS", "阶段门禁通过"],
  ["Stage Gate REJECT", "阶段门禁拒绝"],
]);

const PHRASE_TRANSLATIONS: ReadonlyArray<readonly [string, string]> = [
  [" · Requirement / Planner", " · 需求 / 规划"],
  [" · Governance Actions", " · 治理操作"],
  ["Requirement v", "Requirement 版本 v"],
  ["Answer: ", "回答："],
  ["runtime state: ", "运行时状态："],
  ["Provider continuation uses persisted provider binding; UI does not resend a target or choose a provider.", "Provider 续写使用已持久化的 Provider 绑定；界面不会重新发送目标，也不会重新选择 Provider。"],
  ["Planner action receipts只保留恢复所需 identity/status；Plan 内容和最终 workflow truth 继续从 governance projection 读取。", "Planner 动作回执只保留恢复所需的身份与状态；Plan 内容和最终工作流真值继续从治理投影读取。"],
  ["当前 projection 未报告完整性问题。", "当前投影未报告完整性问题。"],
  ["当前 Runtime Thread 已变化；Execute 前必须重新选择。", "当前运行时 Thread 已变化；执行前必须重新选择。"],
  ["Execute 前还会再次读取 Runtime Truth 并校验 exact identity。", "执行前还会再次读取运行时真值并校验精确身份。"],
  ["exact Native executor target", "精确 Native 执行器目标"],
  ["ambient current thread", "隐式当前 Thread"],
  ["The bounded Planner provider-attempt budget is exhausted.", "Planner 的有限 Provider 尝试次数已用尽。"],
  ["Automation operation failed.", "Automation 操作失败。"],
  ["Governance command failed.", "治理操作失败。"],
  ["Requirement / Planner workspace unavailable.", "需求 / 规划工作区不可用。"],
  ["Create Plan · ", "创建 Plan · "],
  ["Request Requirement Draft · ", "请求 Requirement 草案 · "],
  ["Reconcile Requirement · ", "对账 Requirement · "],
  ["Execute Step · ", "执行 Step · "],
  ["Reconcile Step · ", "对账 Step · "],
  ["Verify Step · ", "验证 Step · "],
  ["Review APPROVE · ", "审核通过 · "],
  ["Review REJECT · ", "审核拒绝 · "],
  ["Stage Gate PASS · ", "阶段门禁通过 · "],
  ["Stage Gate REJECT · ", "阶段门禁拒绝 · "],
  ["Advance Stage · ", "推进阶段 · "],
  ["Complete Project · ", "完成项目 · "],
  ["Start Requirement · ", "开始 Requirement · "],
  ["Confirm Requirement · ", "确认 Requirement · "],
  ["Retry Planner · ", "重试 Planner · "],
  ["Read Planner Status · ", "读取 Planner 状态 · "],
  ["Read Planner Result · ", "读取 Planner 结果 · "],
];

function localizedText(value: string): string {
  const exact = EXACT_TRANSLATIONS.get(value.trim());
  if (exact !== undefined) {
    const leading = value.match(/^\s*/)?.[0] ?? "";
    const trailing = value.match(/\s*$/)?.[0] ?? "";
    return `${leading}${exact}${trailing}`;
  }
  let localized = value;
  for (const [source, target] of PHRASE_TRANSLATIONS) {
    localized = localized.split(source).join(target);
  }
  return localized;
}

function isTechnicalNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest("code, pre, textarea, input, option, script, style"));
}

function localizeTextNode(node: Text): void {
  if (isTechnicalNode(node)) return;
  const next = localizedText(node.data);
  if (next !== node.data) node.data = next;
}

function localizeElement(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    localizeTextNode(current as Text);
    current = walker.nextNode();
  }
}

function targetDialogFor(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return null;
  return element.closest(TARGET_DIALOGS.join(","));
}

function installAutomationChineseUi(): void {
  for (const selector of TARGET_DIALOGS) {
    const dialog = document.querySelector(selector);
    if (dialog) localizeElement(dialog);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData" && mutation.target instanceof Text) {
        if (targetDialogFor(mutation.target)) localizeTextNode(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        const dialog = targetDialogFor(node);
        if (!dialog) continue;
        if (node instanceof Text) localizeTextNode(node);
        else if (node instanceof Element) localizeElement(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installAutomationChineseUi();
}
