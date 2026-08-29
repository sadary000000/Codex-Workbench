import type {
  AutomationGovernanceProjectView,
  AutomationGovernanceStageView,
  AutomationGovernanceStepView,
} from "../shared/automation-governance-types.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string };
}

interface AutomationGovernanceActionApi {
  getAutomationGovernanceProject(projectId: string): Promise<IpcEnvelope<AutomationGovernanceProjectView>>;
  reconcileAutomationStep(projectId: string, executionAttemptId: string): Promise<IpcEnvelope>;
  verifyAutomationStep(projectId: string, executionAttemptId: string): Promise<IpcEnvelope>;
  reviewAutomationStep(
    projectId: string,
    executionAttemptId: string,
    decision: "APPROVE" | "REJECT",
    reviewerRef?: string | null,
  ): Promise<IpcEnvelope>;
  gateAutomationStage(
    projectId: string,
    stageSpecId: string,
    decision: "PASS" | "REJECT",
    gatekeeperRef?: string | null,
  ): Promise<IpcEnvelope>;
  advanceAutomationStage(projectId: string, stageSpecId: string): Promise<IpcEnvelope>;
  completeAutomationProject(projectId: string): Promise<IpcEnvelope>;
}

const LAUNCHER_ID = "automation-governance-inspector-launcher";
const ACTION_DIALOG_ID = "automation-governance-actions-dialog";
const ACTION_STYLE_ID = "automation-governance-actions-style";

function element(tag: keyof HTMLElementTagNameMap, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function actionButton(label: string, action: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "debug-button automation-governance-action-button";
  button.dataset.governanceAction = action;
  button.textContent = label;
  return button;
}

function responseError(response: IpcEnvelope): string {
  const code = response.error?.code?.trim();
  const message = response.error?.message?.trim();
  if (code && message) return `${code}: ${message}`;
  return message || code || "Governance command failed.";
}

function installStyles(): void {
  if (document.getElementById(ACTION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ACTION_STYLE_ID;
  style.textContent = `
    #${ACTION_DIALOG_ID} { width: min(860px, 92vw); max-height: 86vh; border: 1px solid var(--border); border-radius: 10px; background: #202020; color: #ececec; }
    #${ACTION_DIALOG_ID}::backdrop { background: #0009; }
    #${ACTION_DIALOG_ID} .automation-governance-actions-shell { display: grid; gap: 12px; min-width: 0; }
    #${ACTION_DIALOG_ID} .automation-governance-actions-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; padding-bottom: 10px; border-bottom: 1px solid var(--border); background: #202020; z-index: 1; }
    #${ACTION_DIALOG_ID} .automation-governance-actions-header h2 { margin: 0; font-size: 16px; }
    #${ACTION_DIALOG_ID} .automation-governance-actions-body { display: grid; gap: 10px; min-width: 0; overflow: auto; }
    #${ACTION_DIALOG_ID} .automation-governance-command-note { padding: 9px; border: 1px solid #444; border-radius: 7px; color: #bcbcbc; font-size: 11px; line-height: 1.5; }
    #${ACTION_DIALOG_ID} .automation-governance-command-status { min-height: 18px; font-size: 11px; }
    #${ACTION_DIALOG_ID} .automation-governance-command-status.is-error { color: var(--danger); }
    #${ACTION_DIALOG_ID} .automation-governance-command-status.is-ok { color: #9de3c4; }
    #${ACTION_DIALOG_ID} .automation-governance-action-project,
    #${ACTION_DIALOG_ID} .automation-governance-action-stage,
    #${ACTION_DIALOG_ID} .automation-governance-action-step { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: #242424; }
    #${ACTION_DIALOG_ID} .automation-governance-action-step { background: #202020; border-color: #383838; }
    #${ACTION_DIALOG_ID} .automation-governance-action-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    #${ACTION_DIALOG_ID} .automation-governance-action-title code { color: #9fbeb1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${ACTION_DIALOG_ID} .automation-governance-action-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    #${ACTION_DIALOG_ID} .automation-governance-action-button[data-destructive="true"] { color: var(--danger); }
    #${ACTION_DIALOG_ID} .automation-governance-action-steps { display: grid; gap: 7px; }
    #${ACTION_DIALOG_ID} .automation-governance-action-missing { color: #777; font-size: 11px; }
  `;
  document.head.append(style);
}

function requireConfirmation(message: string): boolean {
  return window.confirm(message);
}

function installAutomationGovernanceActions(): void {
  const launcher = document.getElementById(LAUNCHER_ID);
  if (!launcher || document.getElementById(ACTION_DIALOG_ID)) return;
  const controls = launcher.querySelector<HTMLElement>(".automation-governance-launcher-controls");
  const projectSelect = controls?.querySelector<HTMLSelectElement>("select");
  if (!controls || !projectSelect) return;

  const api = (window as unknown as { codexWorkbenchV1?: AutomationGovernanceActionApi }).codexWorkbenchV1;
  if (!api) return;
  installStyles();

  const openActionsButton = actionButton("治理操作", "open-actions");
  controls.append(openActionsButton);

  const dialog = document.createElement("dialog");
  dialog.id = ACTION_DIALOG_ID;
  const shell = document.createElement("div");
  shell.className = "automation-governance-actions-shell";
  const header = document.createElement("div");
  header.className = "automation-governance-actions-header";
  const title = element("h2", "", "Automation Governance Actions");
  const close = actionButton("关闭", "close");
  close.addEventListener("click", () => dialog.close());
  header.append(title, close);
  const status = element("div", "automation-governance-command-status", "");
  const body = document.createElement("div");
  body.className = "automation-governance-actions-body";
  shell.append(header, status, body);
  dialog.append(shell);
  document.body.append(dialog);

  let currentProjectId = "";
  let busy = false;

  const setBusy = (value: boolean): void => {
    busy = value;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button[data-governance-action]")) {
      if (button.dataset.governanceAction !== "close") button.disabled = value;
    }
    openActionsButton.disabled = value || !projectSelect.value.trim();
  };

  const setStatus = (message: string, kind: "idle" | "ok" | "error" = "idle"): void => {
    status.textContent = message;
    status.className = "automation-governance-command-status";
    if (kind === "ok") status.classList.add("is-ok");
    if (kind === "error") status.classList.add("is-error");
  };

  const refresh = async (): Promise<void> => {
    if (!currentProjectId) return;
    const response = await api.getAutomationGovernanceProject(currentProjectId);
    if (!response.ok || !response.result) {
      body.replaceChildren(element("p", "automation-governance-command-status is-error", responseError(response)));
      return;
    }
    title.textContent = `${response.result.project.name} · Governance Actions`;
    renderActions(response.result);
  };

  const run = async (label: string, command: () => Promise<IpcEnvelope>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const response = await command();
      if (!response.ok) {
        setStatus(responseError(response), "error");
      } else {
        setStatus(`${label} 已提交；已重新读取 workflow truth。`, "ok");
      }
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed.`, "error");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const renderStep = (view: AutomationGovernanceProjectView, step: AutomationGovernanceStepView): HTMLElement => {
    const card = document.createElement("section");
    card.className = "automation-governance-action-step";
    const heading = document.createElement("div");
    heading.className = "automation-governance-action-title";
    heading.append(element("strong", "", step.stepKey), element("code", "", step.stepSpecId));
    card.append(heading);

    if (!step.attempt) {
      card.append(element(
        "span",
        "automation-governance-action-missing",
        "尚无 ExecutionAttempt。fresh Execute 需要显式 Native thread target，将在独立 target-selector slice 中接入。",
      ));
      return card;
    }

    const attemptId = step.attempt.attemptId;
    card.append(element("code", "automation-governance-action-missing", `attempt: ${attemptId}`));
    const actions = document.createElement("div");
    actions.className = "automation-governance-action-buttons";

    const reconcile = actionButton("Reconcile", "step-reconcile");
    reconcile.addEventListener("click", () => void run("Reconcile Step", () => api.reconcileAutomationStep(view.project.projectId, attemptId)));

    const verify = actionButton("Verify", "step-verify");
    verify.addEventListener("click", () => void run("Verify Step", () => api.verifyAutomationStep(view.project.projectId, attemptId)));

    const approve = actionButton("Review APPROVE", "step-review-approve");
    approve.addEventListener("click", () => {
      if (!requireConfirmation(`Approve Step ${step.stepKey}? Review evidence is immutable for this attempt.`)) return;
      void run("Review APPROVE", () => api.reviewAutomationStep(view.project.projectId, attemptId, "APPROVE"));
    });

    const reject = actionButton("Review REJECT", "step-review-reject");
    reject.dataset.destructive = "true";
    reject.addEventListener("click", () => {
      if (!requireConfirmation(`Reject Step ${step.stepKey}? This records immutable REJECT review evidence.`)) return;
      void run("Review REJECT", () => api.reviewAutomationStep(view.project.projectId, attemptId, "REJECT"));
    });

    actions.append(reconcile, verify, approve, reject);
    card.append(actions);
    return card;
  };

  const renderStage = (view: AutomationGovernanceProjectView, stage: AutomationGovernanceStageView): HTMLElement => {
    const card = document.createElement("section");
    card.className = "automation-governance-action-stage";
    const heading = document.createElement("div");
    heading.className = "automation-governance-action-title";
    heading.append(element("strong", "", `${stage.ordinal + 1}. ${stage.name || stage.stageKey}`), element("code", "", stage.stageSpecId));
    card.append(heading);

    const actions = document.createElement("div");
    actions.className = "automation-governance-action-buttons";
    const pass = actionButton("Gate PASS", "stage-gate-pass");
    pass.addEventListener("click", () => {
      if (!requireConfirmation(`Record PASS Stage Gate for ${stage.name || stage.stageKey}?`)) return;
      void run("Stage Gate PASS", () => api.gateAutomationStage(view.project.projectId, stage.stageSpecId, "PASS"));
    });
    const reject = actionButton("Gate REJECT", "stage-gate-reject");
    reject.dataset.destructive = "true";
    reject.addEventListener("click", () => {
      if (!requireConfirmation(`Record REJECT Stage Gate for ${stage.name || stage.stageKey}?`)) return;
      void run("Stage Gate REJECT", () => api.gateAutomationStage(view.project.projectId, stage.stageSpecId, "REJECT"));
    });
    const advance = actionButton("Advance Stage", "stage-advance");
    advance.addEventListener("click", () => void run("Advance Stage", () => api.advanceAutomationStage(view.project.projectId, stage.stageSpecId)));
    actions.append(pass, reject, advance);
    card.append(actions);

    const steps = document.createElement("div");
    steps.className = "automation-governance-action-steps";
    for (const step of stage.steps) steps.append(renderStep(view, step));
    card.append(steps);
    return card;
  };

  const renderActions = (view: AutomationGovernanceProjectView): void => {
    body.replaceChildren();
    body.append(element(
      "div",
      "automation-governance-command-note",
      "这些按钮只是已有 main-process governance commands 的薄入口。UI 不判断合法状态；每个 command 都由后端重新校验 workflow truth，并在成功或失败后重新读取 projection。",
    ));

    const project = document.createElement("section");
    project.className = "automation-governance-action-project";
    const projectHeading = document.createElement("div");
    projectHeading.className = "automation-governance-action-title";
    projectHeading.append(element("strong", "", view.project.name), element("code", "", view.project.projectId));
    const projectActions = document.createElement("div");
    projectActions.className = "automation-governance-action-buttons";
    const complete = actionButton("Complete Project", "project-complete");
    complete.addEventListener("click", () => {
      if (!requireConfirmation(`Project ${view.project.name} completion will be projected only if final governance truth passes. Continue?`)) return;
      void run("Complete Project", () => api.completeAutomationProject(view.project.projectId));
    });
    projectActions.append(complete);
    project.append(projectHeading, projectActions);
    body.append(project);

    for (const stage of view.stages) body.append(renderStage(view, stage));
    setBusy(busy);
  };

  openActionsButton.addEventListener("click", async () => {
    const projectId = projectSelect.value.trim();
    if (!projectId || busy) return;
    currentProjectId = projectId;
    body.replaceChildren(element("p", "automation-governance-command-note", "正在读取最新 Governance Projection…"));
    setStatus("");
    if (!dialog.open) dialog.showModal();
    setBusy(true);
    try {
      await refresh();
    } catch (error) {
      body.replaceChildren(element("p", "automation-governance-command-status is-error", error instanceof Error ? error.message : "Governance actions unavailable."));
    } finally {
      setBusy(false);
    }
  });

  const updateLauncherState = (): void => {
    openActionsButton.disabled = busy || !projectSelect.value.trim();
  };
  projectSelect.addEventListener("change", updateLauncherState);
  const observer = new MutationObserver(updateLauncherState);
  observer.observe(projectSelect, { childList: true, subtree: true, attributes: true });
  updateLauncherState();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installAutomationGovernanceActions();
}
