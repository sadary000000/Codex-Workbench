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
    label: "刷新 Runtime Target",
    initialPhase: "正在读取 Runtime Truth",
  },
  "questions-answer": {
    label: "提交 Requirement answers",
    initialPhase: "正在提交 Requirement answers",
    waitingPhase: "等待 workflow truth 返回",
    waitingAfterMs: 2_000,
  },
  "requirement-start": {
    label: "Start Requirement",
    initialPhase: "正在核对 exact Native target",
    waitingPhase: "等待 Requirement session 返回",
    waitingAfterMs: 2_000,
  },
  "requirement-draft": {
    label: "Request Requirement Draft",
    initialPhase: "正在提交 provider continuation",
    waitingPhase: "等待 Requirement provider 返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "requirement-reconcile": {
    label: "Reconcile Requirement",
    initialPhase: "正在读取 Requirement provider / recovery truth",
  },
  "requirement-confirm": {
    label: "Confirm Requirement",
    initialPhase: "正在写入 exact Requirement truth",
  },
  "planner-create": {
    label: "Create Plan",
    initialPhase: "正在核对 exact Native target",
    waitingPhase: "等待 Planner 接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "planner-reconcile": {
    label: "Reconcile Planner",
    initialPhase: "正在读取 Planner / recovery truth",
  },
  "planner-retry": {
    label: "Retry Planner",
    initialPhase: "正在重试 exact Planner intent",
    waitingPhase: "等待 Planner 接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "planner-status": {
    label: "Read Planner Status",
    initialPhase: "正在读取 Planner status",
  },
  "planner-result": {
    label: "Read Planner Result",
    initialPhase: "正在读取 Planner result",
  },
});

const GOVERNANCE_OPERATION_SPECS: Readonly<Record<string, OperationProgressSpec>> = Object.freeze({
  "step-execute": {
    label: "Execute Step",
    initialPhase: "正在核对 exact Native executor target",
    waitingPhase: "等待 Executor 接受/返回",
    waitingAfterMs: 2_000,
    slowHint: "响应较慢；请勿重复提交",
  },
  "step-reconcile": {
    label: "Reconcile Step",
    initialPhase: "正在读取 ExecutionAttempt / recovery truth",
  },
  "step-verify": {
    label: "Verify Step",
    initialPhase: "等待 verifier 返回验证结果",
  },
  "step-review-approve": {
    label: "Review APPROVE",
    initialPhase: "正在写入 immutable review evidence",
  },
  "step-review-reject": {
    label: "Review REJECT",
    initialPhase: "正在写入 immutable review evidence",
  },
  "stage-gate-pass": {
    label: "Stage Gate PASS",
    initialPhase: "正在写入 Stage Gate decision",
  },
  "stage-gate-reject": {
    label: "Stage Gate REJECT",
    initialPhase: "正在写入 Stage Gate decision",
  },
  "stage-advance": {
    label: "Advance Stage",
    initialPhase: "正在重新读取并推进 stage truth",
  },
  "project-complete": {
    label: "Complete Project",
    initialPhase: "正在校验 final governance truth",
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
      status.textContent = `${message}；请求结果可能不确定，请先使用 Reconcile Planner / Planner Status，勿再次提交。`;
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
