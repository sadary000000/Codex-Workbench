const PLANNER_DIALOG_ID = "automation-requirement-planner-dialog";
const GOVERNANCE_DIALOG_ID = "automation-governance-actions-dialog";
const SLOW_HINT_AFTER_MS = 8_000;

interface OperationProgressSpec {
  label: string;
  initialPhase: string;
  waitingPhase?: string;
  waitingAfterMs?: number;
  slowHint?: string;
}

interface DialogProgressConfig {
  dialogId: string;
  statusSelector: string;
  buttonSelector: string;
  actionAttribute: string;
  specs: Readonly<Record<string, OperationProgressSpec>>;
}

const PLANNER_OPERATION_SPECS: Readonly<Record<string, OperationProgressSpec>> = Object.freeze({
  "target-refresh": {
    label: "刷新运行目标",
    initialPhase: "正在读取运行时状态",
  },
  "questions-answer": {
    label: "提交需求问题答案",
    initialPhase: "正在提交需求问题答案",
    waitingPhase: "等待工作流状态返回",
    waitingAfterMs: 2_000,
  },
  "requirement-start": {
    label: "开始需求澄清",
    initialPhase: "正在核对精确的 Native 目标",
    waitingPhase: "等待需求会话返回",
    waitingAfterMs: 2_000,
  },
  "requirement-draft": {
    label: "生成需求草案",
    initialPhase: "正在提交提供方续接请求",
    waitingPhase: "等待需求提供方返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "requirement-reconcile": {
    label: "对账需求状态",
    initialPhase: "正在读取需求提供方 / 恢复状态",
  },
  "requirement-confirm": {
    label: "确认需求",
    initialPhase: "正在写入精确需求状态",
  },
  "planner-create": {
    label: "创建计划",
    initialPhase: "正在核对精确的 Native 目标",
    waitingPhase: "等待规划器接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "planner-reconcile": {
    label: "对账规划器状态",
    initialPhase: "正在读取规划器 / 恢复状态",
  },
  "planner-retry": {
    label: "重试规划",
    initialPhase: "正在重试精确规划意图",
    waitingPhase: "等待规划器接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "planner-status": {
    label: "读取规划器状态",
    initialPhase: "正在读取规划器状态",
  },
  "planner-result": {
    label: "读取规划结果",
    initialPhase: "正在读取规划结果",
  },
});

const GOVERNANCE_OPERATION_SPECS: Readonly<Record<string, OperationProgressSpec>> = Object.freeze({
  "step-execute": {
    label: "执行步骤",
    initialPhase: "正在核对精确的 Native 执行目标",
    waitingPhase: "等待执行器接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "step-reconcile": {
    label: "对账执行步骤",
    initialPhase: "正在读取执行尝试 / 恢复状态",
  },
  "step-verify": {
    label: "验证步骤",
    initialPhase: "等待验证器返回验证结果",
  },
  "step-review-approve": {
    label: "审查通过",
    initialPhase: "正在写入不可变审查证据",
  },
  "step-review-reject": {
    label: "审查拒绝",
    initialPhase: "正在写入不可变审查证据",
  },
  "stage-gate-pass": {
    label: "阶段门禁通过",
    initialPhase: "正在写入阶段门禁决策",
  },
  "stage-gate-reject": {
    label: "阶段门禁拒绝",
    initialPhase: "正在写入阶段门禁决策",
  },
  "stage-advance": {
    label: "推进阶段",
    initialPhase: "正在重新读取并推进阶段状态",
  },
  "project-complete": {
    label: "完成项目",
    initialPhase: "正在校验最终治理状态",
  },
});

function progressStatus(dialog: HTMLElement, selector: string): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(selector);
}

function terminalStatus(status: HTMLElement): boolean {
  return status.classList.contains("is-error") || status.classList.contains("is-ok");
}

function stopProgress(timer: ReturnType<typeof setInterval> | null): void {
  if (timer !== null) clearInterval(timer);
}

function installDialogOperationProgress(config: DialogProgressConfig): void {
  const dialog = document.getElementById(config.dialogId);
  if (!dialog || dialog.dataset.operationProgressInstalled === "true") return;
  dialog.dataset.operationProgressInstalled = "true";

  let timer: ReturnType<typeof setInterval> | null = null;
  let runId = 0;

  const beginProgress = (spec: OperationProgressSpec): void => {
    const status = progressStatus(dialog, config.statusSelector);
    if (!status || terminalStatus(status)) return;
    stopProgress(timer);
    const currentRun = ++runId;
    const startedAt = Date.now();

    const renderProgress = (): void => {
      if (currentRun !== runId) return;
      const current = progressStatus(dialog, config.statusSelector);
      if (!current) {
        stopProgress(timer);
        timer = null;
        return;
      }
      if (terminalStatus(current)) {
        stopProgress(timer);
        timer = null;
        return;
      }
      const existing = current.textContent ?? "";
      if (existing && !existing.startsWith(spec.label)) {
        stopProgress(timer);
        timer = null;
        return;
      }
      const elapsedMs = Date.now() - startedAt;
      const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
      const waitingAfterMs = spec.waitingAfterMs ?? 2_000;
      const phase = spec.waitingPhase && elapsedMs >= waitingAfterMs ? spec.waitingPhase : spec.initialPhase;
      const slowHint = elapsedMs >= SLOW_HINT_AFTER_MS
        ? ` · ${spec.slowHint ?? "响应较慢；请勿重复操作"}`
        : "";
      current.textContent = `${spec.label} · ${phase} · 已等待 ${elapsedSeconds}s${slowHint}`;
    };

    renderProgress();
    timer = setInterval(renderProgress, 1_000);
  };

  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(config.buttonSelector)
      : null;
    if (!target) return;
    const action = target.getAttribute(config.actionAttribute);
    const spec = action ? config.specs[action] : undefined;
    if (!spec) return;
    dialog.dataset.operationProgressAction = action ?? "";

    // Existing action handlers synchronously enter their busy state before the
    // first provider/IPC await. A cancelled confirmation or validation failure
    // therefore leaves the button enabled and does not start a fake timer.
    queueMicrotask(() => {
      const status = progressStatus(dialog, config.statusSelector);
      if (!target.disabled || !status || terminalStatus(status)) return;
      if (!(status.textContent ?? "").startsWith(spec.label)) return;
      beginProgress(spec);
    });
  });

  const status = progressStatus(dialog, config.statusSelector);
  if (status) {
    const observer = new MutationObserver(() => {
      if (!terminalStatus(status)) return;
      runId += 1;
      stopProgress(timer);
      timer = null;
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
}

function installPlannerRecoveryGuidance(): void {
  const dialog = document.getElementById(PLANNER_DIALOG_ID);
  if (!dialog || dialog.dataset.plannerRecoveryGuidanceInstalled === "true") return;
  const status = progressStatus(dialog, ".automation-rp-status");
  if (!status) return;
  dialog.dataset.plannerRecoveryGuidanceInstalled = "true";

  const applyGuidance = (): void => {
    const message = status.textContent ?? "";
    if (status.classList.contains("is-error") && /TIMEOUT|RECOVERY|UNKNOWN|APP_SERVER_TIMEOUT/i.test(message) && !message.includes("勿再次提交")) {
      const action = dialog.dataset.operationProgressAction ?? "";
      const requirementOutcome = action.startsWith("requirement-") || action === "questions-answer" || /Requirement/i.test(message);
      const recoveryAction = requirementOutcome
        ? "请先使用“对账需求状态”读取已接受请求的权威结果"
        : "请先使用“对账规划器状态”或“读取规划器状态”";
      status.textContent = `${message}；请求结果可能不确定，${recoveryAction}，勿再次提交。`;
    }
  };

  const observer = new MutationObserver(applyGuidance);
  observer.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  applyGuidance();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installDialogOperationProgress({
    dialogId: PLANNER_DIALOG_ID,
    statusSelector: ".automation-rp-status",
    buttonSelector: "button[data-requirement-planner-action]",
    actionAttribute: "data-requirement-planner-action",
    specs: PLANNER_OPERATION_SPECS,
  });
  installDialogOperationProgress({
    dialogId: GOVERNANCE_DIALOG_ID,
    statusSelector: ".automation-governance-command-status",
    buttonSelector: "button[data-governance-action]",
    actionAttribute: "data-governance-action",
    specs: GOVERNANCE_OPERATION_SPECS,
  });
  installPlannerRecoveryGuidance();
}
