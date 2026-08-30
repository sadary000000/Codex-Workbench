import type {
  AutomationPlannerRecoveryView,
  AutomationRequirementProjectView,
} from "../shared/automation-requirement-types.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string };
}

interface PlannerRecoveryApi {
  getAutomationRequirementProject(projectId: string): Promise<IpcEnvelope<AutomationRequirementProjectView>>;
  reconcileAutomationPlan(projectId: string, actionAttemptId: string): Promise<IpcEnvelope>;
  retryAutomationPlan(projectId: string, actionIntentId: string): Promise<IpcEnvelope>;
  getAutomationPlannerStatus(projectId: string, actionIntentId: string): Promise<IpcEnvelope>;
  getAutomationPlannerResult(projectId: string, actionIntentId: string): Promise<IpcEnvelope>;
}

const LAUNCHER_ID = "automation-governance-inspector-launcher";
const DIALOG_ID = "automation-requirement-planner-dialog";
const ACTION_ATTRIBUTE = "data-requirement-planner-action";
const CHECKED_PROJECT_ATTRIBUTE = "plannerRestartRecoveryProject";
const RECOVERY_NODE_ATTRIBUTE = "plannerRestartRecovery";

let refreshInFlight = false;
let refreshQueued = false;
let runningAction = false;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function api(): PlannerRecoveryApi | null {
  return (window as unknown as { codexWorkbenchV1?: PlannerRecoveryApi }).codexWorkbenchV1 ?? null;
}

function projectSelect(): HTMLSelectElement | null {
  return document.getElementById(LAUNCHER_ID)?.querySelector<HTMLSelectElement>(".automation-governance-launcher-controls select") ?? null;
}

function plannerDialog(): HTMLDialogElement | null {
  return document.getElementById(DIALOG_ID) as HTMLDialogElement | null;
}

function plannerCard(dialog: HTMLDialogElement): HTMLElement | null {
  const create = dialog.querySelector<HTMLButtonElement>(`button[${ACTION_ATTRIBUTE}="planner-create"]`);
  return create?.closest<HTMLElement>(".automation-rp-card") ?? null;
}

function plannerActions(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>(".automation-rp-actions");
}

function statusNode(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(".automation-rp-status");
}

function errorMessage(response: IpcEnvelope): string {
  const code = response.error?.code?.trim();
  const message = response.error?.message?.trim();
  if (code && message) return `${code}: ${message}`;
  return message || code || "Planner recovery operation failed.";
}

function setStatus(dialog: HTMLDialogElement, message: string, kind: "idle" | "ok" | "error" = "idle"): void {
  const status = statusNode(dialog);
  if (!status) return;
  status.textContent = message;
  status.className = "automation-rp-status";
  if (kind === "ok") status.classList.add("is-ok");
  if (kind === "error") status.classList.add("is-error");
}

function appendValue(container: HTMLElement, label: string, value: string | number | null): void {
  const item = node("div", "automation-rp-meta-item");
  item.append(
    node("span", "automation-rp-meta-label", label),
    node("code", "automation-rp-meta-value", value == null || value === "" ? "—" : String(value)),
  );
  container.append(item);
}

function existingAction(card: HTMLElement, action: string): boolean {
  return Boolean(card.querySelector(`button[${ACTION_ATTRIBUTE}="${action}"]`));
}

function recoveredButton(label: string, action: string, run: () => Promise<IpcEnvelope>): HTMLButtonElement {
  const button = node("button", "debug-button automation-rp-button", label);
  button.type = "button";
  button.setAttribute(ACTION_ATTRIBUTE, action);
  button.dataset[RECOVERY_NODE_ATTRIBUTE] = "true";
  button.addEventListener("click", () => void runRecoveredAction(button, action, run));
  return button;
}

function workingMessage(action: string): string {
  return {
    "planner-reconcile": "对账规划器状态 · 正在读取规划器 / 恢复状态",
    "planner-retry": "重试规划 · 正在重试精确规划意图",
    "planner-status": "读取规划器状态 · 正在读取规划器状态",
    "planner-result": "读取规划结果 · 正在读取规划结果",
  }[action] ?? "Planner 恢复 · 正在读取持久化状态";
}

function completedMessage(action: string): string {
  return {
    "planner-reconcile": "对账 Planner 已完成；已重新读取持久化 Planner 状态。",
    "planner-retry": "重试同一 Planner 意图已完成；已重新读取持久化 Planner 状态。",
    "planner-status": "Planner 状态已读取；已重新读取持久化 Planner 状态。",
    "planner-result": "Planner 结果已读取；已重新读取持久化 Planner 状态。",
  }[action] ?? "Planner 恢复操作已完成。";
}

async function runRecoveredAction(button: HTMLButtonElement, action: string, run: () => Promise<IpcEnvelope>): Promise<void> {
  if (runningAction) return;
  const dialog = plannerDialog();
  if (!dialog) return;
  runningAction = true;
  for (const item of dialog.querySelectorAll<HTMLButtonElement>(`button[data-${RECOVERY_NODE_ATTRIBUTE.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}="true"]`)) item.disabled = true;
  button.disabled = true;
  setStatus(dialog, workingMessage(action));
  try {
    const response = await run();
    if (!response.ok) {
      setStatus(dialog, errorMessage(response), "error");
    } else {
      const open = document.getElementById(LAUNCHER_ID)?.querySelector<HTMLButtonElement>(`button[${ACTION_ATTRIBUTE}="open"]`);
      open?.click();
      setStatus(dialog, completedMessage(action), "ok");
    }
    await refreshRecovery(true);
  } catch (error) {
    setStatus(dialog, error instanceof Error ? error.message : "Planner recovery operation failed.", "error");
  } finally {
    runningAction = false;
    for (const item of dialog.querySelectorAll<HTMLButtonElement>(`button[${ACTION_ATTRIBUTE}]`)) {
      if (item.dataset[RECOVERY_NODE_ATTRIBUTE] === "true") item.disabled = false;
    }
  }
}

function removeRecoveryNodes(card: HTMLElement): void {
  for (const item of card.querySelectorAll<HTMLElement>(`[data-${RECOVERY_NODE_ATTRIBUTE.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}="true"]`)) item.remove();
}

function renderRecovery(projectId: string, card: HTMLElement, recovery: AutomationPlannerRecoveryView | null): void {
  removeRecoveryNodes(card);
  card.dataset[CHECKED_PROJECT_ATTRIBUTE] = projectId;
  if (!recovery) return;

  const actions = plannerActions(card);
  const backend = api();
  if (!actions || !backend) return;

  if (recovery.actionAttemptId && !existingAction(card, "planner-reconcile")) {
    const actionAttemptId = recovery.actionAttemptId;
    actions.append(recoveredButton("Reconcile Planner", "planner-reconcile", () => backend.reconcileAutomationPlan(projectId, actionAttemptId)));
  }
  if (!existingAction(card, "planner-retry")) {
    const actionIntentId = recovery.actionIntentId;
    actions.append(recoveredButton("Retry exact Planner intent", "planner-retry", () => backend.retryAutomationPlan(projectId, actionIntentId)));
  }
  if (!existingAction(card, "planner-status")) {
    const actionIntentId = recovery.actionIntentId;
    actions.append(recoveredButton("Planner Status", "planner-status", () => backend.getAutomationPlannerStatus(projectId, actionIntentId)));
  }
  if (!existingAction(card, "planner-result")) {
    const actionIntentId = recovery.actionIntentId;
    actions.append(recoveredButton("Planner Result", "planner-result", () => backend.getAutomationPlannerResult(projectId, actionIntentId)));
  }

  if (!card.querySelector(".automation-rp-planner-receipt:not([data-planner-restart-recovery=\"true\"])")) {
    const receipt = node("div", "automation-rp-planner-receipt");
    receipt.dataset[RECOVERY_NODE_ATTRIBUTE] = "true";
    const meta = node("div", "automation-rp-meta-grid");
    appendValue(meta, "intent state", recovery.intentState);
    appendValue(meta, "ActionIntent", recovery.actionIntentId);
    appendValue(meta, "ActionAttempt", recovery.actionAttemptId);
    appendValue(meta, "PlanVersion", recovery.promotedPlanVersionId);
    appendValue(meta, "attempt state", recovery.attemptState);
    appendValue(meta, "recovery", recovery.recoveryState);
    appendValue(meta, "尝试序号", recovery.dispatchNumber);
    receipt.append(meta, node("span", "automation-rp-note", "已从持久化 workflow truth 恢复 Planner 操作身份；不会自动重发请求。"));
    const note = card.querySelector(".automation-rp-note");
    if (note) card.insertBefore(receipt, note);
    else card.append(receipt);
  }
}

async function refreshRecovery(force = false): Promise<void> {
  const dialog = plannerDialog();
  const select = projectSelect();
  const backend = api();
  if (!dialog?.open || !select || !backend) return;
  const projectId = select.value.trim();
  const card = plannerCard(dialog);
  if (!projectId || !card) return;
  if (!force && card.dataset[CHECKED_PROJECT_ATTRIBUTE] === projectId) return;
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const response = await backend.getAutomationRequirementProject(projectId);
    const currentCard = plannerCard(dialog);
    if (!currentCard || select.value.trim() !== projectId) return;
    if (!response.ok || !response.result) {
      if (force) setStatus(dialog, errorMessage(response), "error");
      currentCard.dataset[CHECKED_PROJECT_ATTRIBUTE] = projectId;
      return;
    }
    renderRecovery(projectId, currentCard, response.result.plannerRecovery);
  } finally {
    refreshInFlight = false;
  }
}

function scheduleRefresh(force = false): void {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    void refreshRecovery(force);
  });
}

function installPlannerRestartRecovery(): void {
  const dialog = plannerDialog();
  const select = projectSelect();
  if (!dialog || !select || dialog.dataset.plannerRestartRecoveryInstalled === "true") return;
  dialog.dataset.plannerRestartRecoveryInstalled = "true";

  const observer = new MutationObserver(() => {
    if (!dialog.open) return;
    const card = plannerCard(dialog);
    const projectId = select.value.trim();
    if (card && projectId && card.dataset[CHECKED_PROJECT_ATTRIBUTE] !== projectId) scheduleRefresh();
  });
  observer.observe(dialog, { childList: true, subtree: true });
  observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  select.addEventListener("change", () => scheduleRefresh(true));
  scheduleRefresh();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installPlannerRestartRecovery();
}
