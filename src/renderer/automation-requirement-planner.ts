import type { RuntimeSnapshot } from "../shared/runtime-types.ts";
import type {
  AutomationRequirementContentView,
  AutomationRequirementProjectView,
  AutomationRequirementQuestionView,
} from "../shared/automation-requirement-types.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string };
}

interface RequirementStartReceipt {
  projectId: string;
  alignmentSessionId: string;
  status: string;
  currentRoundId: string | null;
}

interface RequirementDraftReceipt {
  projectId: string;
  alignmentSessionId: string;
  roundId: string;
  status: string;
  draftRequirementVersionId: string | null;
}

interface PlannerReceipt {
  status: string;
  actionIntentId: string | null;
  actionAttemptId: string | null;
  planVersionId: string | null;
  blockingQuestions: string[];
  missingRequirementFields: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

interface PlannerStatusReceipt {
  actionIntentId: string;
  actionAttemptId: string | null;
  state: string;
  attemptState: string | null;
  recoveryState: string | null;
  receiptStatus: string | null;
  planVersionId: string | null;
}

interface PlannerResultReceipt {
  actionIntentId: string;
  actionAttemptId: string | null;
  receiptStatus: string | null;
  planVersionId: string | null;
}

interface AutomationRequirementPlannerApi {
  getState(): Promise<IpcEnvelope<RuntimeSnapshot>>;
  getAutomationRequirementProject(projectId: string): Promise<IpcEnvelope<AutomationRequirementProjectView>>;
  startAutomationRequirement(projectId: string, goal: string, providerTargetRef: string): Promise<IpcEnvelope<RequirementStartReceipt>>;
  requestAutomationRequirementDraft(sessionId: string): Promise<IpcEnvelope<RequirementDraftReceipt>>;
  reconcileAutomationRequirement(sessionId: string, roundId?: string | null): Promise<IpcEnvelope<RequirementDraftReceipt>>;
  answerAutomationRequirementQuestions(sessionId: string, roundId: string | null | undefined, answers: Record<string, string>): Promise<IpcEnvelope>;
  confirmAutomationRequirement(projectId: string, requirementVersionId: string, expectedPayloadSha256: string): Promise<IpcEnvelope>;
  createAutomationPlan(projectId: string, providerTargetRef: string, requirementVersionId?: string | null): Promise<IpcEnvelope<PlannerReceipt>>;
  reconcileAutomationPlan(projectId: string, actionAttemptId: string): Promise<IpcEnvelope<PlannerReceipt>>;
  retryAutomationPlan(projectId: string, actionIntentId: string): Promise<IpcEnvelope<PlannerReceipt>>;
  getAutomationPlannerStatus(projectId: string, actionIntentId: string): Promise<IpcEnvelope<PlannerStatusReceipt>>;
  getAutomationPlannerResult(projectId: string, actionIntentId: string): Promise<IpcEnvelope<PlannerResultReceipt>>;
}

const LAUNCHER_ID = "automation-governance-inspector-launcher";
const DIALOG_ID = "automation-requirement-planner-dialog";
const STYLE_ID = "automation-requirement-planner-style";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, action: string): HTMLButtonElement {
  const element = node("button", "debug-button automation-rp-button", label);
  element.type = "button";
  element.dataset.requirementPlannerAction = action;
  return element;
}

function errorMessage(response: IpcEnvelope): string {
  const code = response.error?.code?.trim();
  const message = response.error?.message?.trim();
  if (code && message) return `${code}: ${message}`;
  return message || code || "Automation operation failed.";
}

function appendValue(container: HTMLElement, label: string, value: string | number | null | undefined): void {
  const item = node("div", "automation-rp-meta-item");
  item.append(node("span", "automation-rp-meta-label", label), node("code", "automation-rp-meta-value", value == null || value === "" ? "—" : String(value)));
  container.append(item);
}

function renderList(title: string, values: string[]): HTMLElement {
  const section = node("section", "automation-rp-content-block");
  section.append(node("strong", "", title));
  if (values.length === 0) {
    section.append(node("span", "muted", "—"));
    return section;
  }
  const list = document.createElement("ul");
  for (const value of values) list.append(node("li", "", value));
  section.append(list);
  return section;
}

function renderRequirementContent(content: AutomationRequirementContentView): HTMLElement {
  const wrapper = node("div", "automation-rp-content-grid");
  const goal = node("section", "automation-rp-content-block wide");
  goal.append(node("strong", "", "Goal"), node("p", "", content.goal));
  wrapper.append(
    goal,
    renderList("Scope", content.scope),
    renderList("Out of scope", content.outOfScope),
    renderList("Functional requirements", content.functionalRequirements),
    renderList("Technical constraints", content.technicalConstraints),
    renderList("Environment constraints", content.environmentConstraints),
    renderList("Acceptance criteria", content.acceptanceCriteria),
    renderList("Risk constraints", content.riskConstraints),
    renderList("External dependencies", content.externalDependencies),
    renderList("Assumptions", content.assumptions),
    renderList("Human approval points", content.humanApprovalPoints),
    renderList("Deferred gates", content.knownDeferredGates),
  );
  return wrapper;
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${DIALOG_ID} { width: min(960px, 94vw); max-height: 88vh; border: 1px solid var(--border); border-radius: 10px; background: #202020; color: #ececec; }
    #${DIALOG_ID}::backdrop { background: #0009; }
    #${DIALOG_ID} .automation-rp-shell { display: grid; gap: 12px; min-width: 0; }
    #${DIALOG_ID} .automation-rp-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; z-index: 2; padding-bottom: 10px; border-bottom: 1px solid var(--border); background: #202020; }
    #${DIALOG_ID} .automation-rp-header h2, #${DIALOG_ID} h3 { margin: 0; }
    #${DIALOG_ID} .automation-rp-body { display: grid; gap: 12px; min-width: 0; overflow: auto; }
    #${DIALOG_ID} .automation-rp-status { min-height: 18px; font-size: 11px; }
    #${DIALOG_ID} .automation-rp-status.is-error { color: var(--danger); }
    #${DIALOG_ID} .automation-rp-status.is-ok { color: #9de3c4; }
    #${DIALOG_ID} .automation-rp-card { display: grid; gap: 9px; padding: 11px; border: 1px solid var(--border); border-radius: 8px; background: #242424; min-width: 0; }
    #${DIALOG_ID} .automation-rp-card-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    #${DIALOG_ID} .automation-rp-card-heading code { color: #9fbeb1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${DIALOG_ID} .automation-rp-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    #${DIALOG_ID} .automation-rp-target-grid, #${DIALOG_ID} .automation-rp-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 7px; }
    #${DIALOG_ID} .automation-rp-meta-item { display: grid; gap: 3px; min-width: 0; padding: 7px; border-radius: 6px; background: #1c1c1c; }
    #${DIALOG_ID} .automation-rp-meta-label { color: #777; font-size: 10px; }
    #${DIALOG_ID} .automation-rp-meta-value { color: #c5d8d0; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${DIALOG_ID} textarea { box-sizing: border-box; width: 100%; min-height: 72px; resize: vertical; }
    #${DIALOG_ID} .automation-rp-question-list { display: grid; gap: 8px; }
    #${DIALOG_ID} .automation-rp-question { display: grid; gap: 6px; padding: 9px; border: 1px solid #383838; border-radius: 7px; background: #202020; }
    #${DIALOG_ID} .automation-rp-question-meta { display: flex; flex-wrap: wrap; gap: 6px; color: #858585; font-size: 10px; }
    #${DIALOG_ID} .automation-rp-option-list { display: flex; flex-wrap: wrap; gap: 5px; }
    #${DIALOG_ID} .automation-rp-option { padding: 2px 6px; border: 1px solid #444; border-radius: 999px; color: #bbb; font-size: 10px; }
    #${DIALOG_ID} .automation-rp-content-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; }
    #${DIALOG_ID} .automation-rp-content-block { display: grid; gap: 6px; padding: 9px; border: 1px solid #383838; border-radius: 7px; background: #202020; font-size: 11px; }
    #${DIALOG_ID} .automation-rp-content-block.wide { grid-column: 1 / -1; }
    #${DIALOG_ID} .automation-rp-content-block p, #${DIALOG_ID} .automation-rp-content-block ul { margin: 0; }
    #${DIALOG_ID} .automation-rp-content-block ul { padding-left: 18px; }
    #${DIALOG_ID} .automation-rp-integrity.is-degraded { border-color: #744844; }
    #${DIALOG_ID} .automation-rp-integrity ul { margin: 0; padding-left: 18px; color: var(--danger); font-size: 11px; }
    #${DIALOG_ID} .automation-rp-planner-receipt { display: grid; gap: 7px; padding: 9px; border: 1px dashed #444; border-radius: 7px; }
    #${DIALOG_ID} .automation-rp-note { color: #999; font-size: 11px; line-height: 1.5; }
  `;
  document.head.append(style);
}

function installRequirementPlannerWorkspace(): void {
  if (document.getElementById(DIALOG_ID)) return;
  const launcher = document.getElementById(LAUNCHER_ID);
  const controls = launcher?.querySelector<HTMLElement>(".automation-governance-launcher-controls");
  const projectSelect = controls?.querySelector<HTMLSelectElement>("select");
  if (!launcher || !controls || !projectSelect) return;

  const api = (window as unknown as { codexWorkbenchV1?: AutomationRequirementPlannerApi }).codexWorkbenchV1;
  if (!api) return;
  installStyles();

  const openButton = button("Requirement / Planner", "open");
  controls.append(openButton);

  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  const shell = node("div", "automation-rp-shell");
  const header = node("div", "automation-rp-header");
  const title = node("h2", "", "Requirement / Planner");
  const close = button("关闭", "close");
  close.addEventListener("click", () => dialog.close());
  header.append(title, close);
  const status = node("div", "automation-rp-status");
  const body = node("div", "automation-rp-body");
  shell.append(header, status, body);
  dialog.append(shell);
  document.body.append(dialog);

  let currentProjectId = "";
  let currentView: AutomationRequirementProjectView | null = null;
  let runtimeSnapshot: RuntimeSnapshot | null = null;
  let selectedTargetRef: string | null = null;
  let lastPlanner: PlannerReceipt | PlannerStatusReceipt | PlannerResultReceipt | null = null;
  let busy = false;

  const setStatus = (message: string, kind: "idle" | "ok" | "error" = "idle"): void => {
    status.textContent = message;
    status.className = "automation-rp-status";
    if (kind === "ok") status.classList.add("is-ok");
    if (kind === "error") status.classList.add("is-error");
  };

  const targetIsCurrent = (): boolean => Boolean(selectedTargetRef && runtimeSnapshot?.nativeThreadId === selectedTargetRef);

  const setBusy = (value: boolean): void => {
    busy = value;
    for (const item of dialog.querySelectorAll<HTMLButtonElement>("button[data-requirement-planner-action]")) {
      if (item.dataset.requirementPlannerAction === "close") continue;
      if (value) {
        item.disabled = true;
        continue;
      }
      if (item.dataset.requiresRuntimeTarget === "true") {
        item.disabled = !runtimeSnapshot?.nativeThreadId;
        continue;
      }
      if (item.dataset.requiresActiveRequirement === "true") {
        item.disabled = !currentView?.project.activeRequirementVersionId || !targetIsCurrent();
        continue;
      }
      if (item.dataset.requiresSelectedTarget === "true") {
        item.disabled = !targetIsCurrent();
        continue;
      }
      item.disabled = false;
    }
    openButton.disabled = value || !projectSelect.value.trim();
  };

  const readRuntime = async (): Promise<IpcEnvelope<RuntimeSnapshot>> => {
    const response = await api.getState();
    runtimeSnapshot = response.ok && response.result ? response.result : null;
    return response;
  };

  const refreshProjection = async (): Promise<IpcEnvelope<AutomationRequirementProjectView>> => {
    const response = await api.getAutomationRequirementProject(currentProjectId);
    currentView = response.ok && response.result ? response.result : null;
    if (currentView) render(currentView);
    else body.replaceChildren(node("p", "automation-rp-status is-error", errorMessage(response)));
    return response;
  };

  const runAndRefresh = async <T>(label: string, operation: () => Promise<IpcEnvelope<T>>, capture?: (value: T) => void): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const response = await operation();
      if (!response.ok || response.result === undefined) {
        setStatus(errorMessage(response), "error");
      } else {
        capture?.(response.result);
        setStatus(`${label} 已提交；已重新读取 workflow truth。`, "ok");
      }
      await refreshProjection();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed.`, "error");
      await refreshProjection().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const exactTargetPreflight = async (): Promise<IpcEnvelope<RuntimeSnapshot>> => {
    const expected = selectedTargetRef;
    if (!expected) return { ok: false, error: { code: "NATIVE_TARGET_REQUIRED", message: "请先显式选择当前 Native Thread。" } };
    const response = await readRuntime();
    if (!response.ok || !response.result) return response;
    if (response.result.nativeThreadId !== expected) {
      return { ok: false, error: { code: "NATIVE_TARGET_CHANGED", message: "Runtime Truth 已切换到另一 Native Thread，请刷新并重新选择 target。" } };
    }
    return response;
  };

  const renderTarget = (view: AutomationRequirementProjectView): HTMLElement => {
    const card = node("section", "automation-rp-card");
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", "Provider Target · Native Runtime Truth"), node("code", "", view.project.projectId));
    card.append(heading);
    const grid = node("div", "automation-rp-target-grid");
    const runtime = node("div", "automation-rp-meta-item");
    runtime.append(node("span", "automation-rp-meta-label", "当前已附着 Native Thread"), node("code", "automation-rp-meta-value", runtimeSnapshot?.nativeThreadId ?? "—"), node("span", "automation-rp-meta-label", `state: ${runtimeSnapshot?.state ?? "UNAVAILABLE"}`));
    const selected = node("div", "automation-rp-meta-item");
    selected.append(node("span", "automation-rp-meta-label", "已显式选择 target"), node("code", "automation-rp-meta-value", selectedTargetRef ?? "—"), node("span", "automation-rp-meta-label", targetIsCurrent() ? "exact identity matches current Runtime Truth" : "Execute/start 前需要 exact identity match"));
    grid.append(runtime, selected);
    card.append(grid);
    const actions = node("div", "automation-rp-actions");
    const refresh = button("刷新 Runtime Target", "target-refresh");
    refresh.addEventListener("click", () => void runAndRefresh("刷新 Runtime Target", async () => {
      const response = await readRuntime();
      return response.ok && response.result ? { ok: true, result: response.result } : response;
    }));
    const select = button("选择当前 Native Thread", "target-select");
    select.dataset.requiresRuntimeTarget = "true";
    select.addEventListener("click", () => {
      const target = runtimeSnapshot?.nativeThreadId ?? null;
      if (!target) {
        setStatus("当前没有已附着的 Native Thread。", "error");
        return;
      }
      selectedTargetRef = target;
      setStatus(`已选择 exact Native target: ${target}`, "ok");
      render(view);
      setBusy(false);
    });
    actions.append(refresh, select);
    card.append(actions);
    return card;
  };

  const renderQuestions = (view: AutomationRequirementProjectView): HTMLElement | null => {
    const round = view.alignment?.round;
    if (!round || round.questions.length === 0) return null;
    const card = node("section", "automation-rp-card");
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", "Requirement Questions"), node("code", "", round.alignmentRoundId));
    card.append(heading);
    const list = node("div", "automation-rp-question-list");
    const editable: Array<{ question: AutomationRequirementQuestionView; input: HTMLTextAreaElement }> = [];
    for (const question of round.questions) {
      const item = node("article", "automation-rp-question");
      item.append(node("strong", "", question.question));
      if (question.whyNeeded) item.append(node("span", "automation-rp-note", question.whyNeeded));
      const meta = node("div", "automation-rp-question-meta");
      meta.append(node("span", "", `#${question.ordinal + 1}`), node("span", "", question.blocking ? "blocking" : "non-blocking"), node("span", "", question.resolutionMode), node("span", "", question.status));
      item.append(meta);
      if (question.options.length > 0) {
        const options = node("div", "automation-rp-option-list");
        for (const option of question.options) options.append(node("span", "automation-rp-option", option));
        item.append(options);
      }
      if (question.answer !== null) {
        item.append(node("p", "", `Answer: ${question.answer}`));
      } else {
        const input = document.createElement("textarea");
        input.maxLength = 4_096;
        input.placeholder = question.defaultRecommendation ? `回答…（建议：${question.defaultRecommendation}）` : "回答…";
        input.dataset.questionId = question.questionId;
        item.append(input);
        editable.push({ question, input });
      }
      list.append(item);
    }
    card.append(list);
    if (editable.length > 0 && view.alignment) {
      const submit = button("提交这些答案", "questions-answer");
      submit.addEventListener("click", () => {
        const answers: Record<string, string> = {};
        for (const entry of editable) {
          const value = entry.input.value.trim();
          if (value) answers[entry.question.questionId] = value;
        }
        if (Object.keys(answers).length === 0) {
          setStatus("至少填写一个尚未解决的问题。", "error");
          return;
        }
        const session = view.alignment!.session.alignmentSessionId;
        void runAndRefresh("提交 Requirement answers", () => api.answerAutomationRequirementQuestions(session, round.alignmentRoundId, answers));
      });
      const answerActions = node("div", "automation-rp-actions");
      answerActions.append(submit);
      card.append(answerActions);
    }
    return card;
  };

  const renderAlignment = (view: AutomationRequirementProjectView): HTMLElement => {
    const card = node("section", "automation-rp-card");
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", "Requirement Alignment"), node("code", "", view.alignment?.session.alignmentSessionId ?? "not started"));
    card.append(heading);

    if (!view.alignment) {
      const goal = document.createElement("textarea");
      goal.maxLength = 4_096;
      goal.placeholder = "描述这个 AutomationProject 要实现的目标…";
      const start = button("Start Requirement", "requirement-start");
      start.dataset.requiresSelectedTarget = "true";
      start.addEventListener("click", () => {
        const text = goal.value.trim();
        if (!text) {
          setStatus("Requirement goal 不能为空。", "error");
          return;
        }
        const target = selectedTargetRef;
        if (!target) return;
        void runAndRefresh("Start Requirement", async () => {
          const preflight = await exactTargetPreflight();
          if (!preflight.ok) return { ok: false, error: preflight.error };
          return api.startAutomationRequirement(view.project.projectId, text, target);
        });
      });
      const startActions = node("div", "automation-rp-actions");
      startActions.append(start);
      card.append(goal, startActions);
      card.append(node("span", "automation-rp-note", "Start 只建立 Requirement alignment session；provider draft 是独立动作，不会被 UI 隐式重试。"));
      return card;
    }

    const meta = node("div", "automation-rp-meta-grid");
    appendValue(meta, "session status", view.alignment.session.status);
    appendValue(meta, "goal", view.alignment.session.goal);
    appendValue(meta, "current round", view.alignment.session.currentRoundId);
    appendValue(meta, "latest draft", view.alignment.session.latestDraftVersionId);
    card.append(meta);

    const actions = node("div", "automation-rp-actions");
    const draft = button("Request / Continue Draft", "requirement-draft");
    draft.addEventListener("click", () => {
      const sessionId = view.alignment!.session.alignmentSessionId;
      void runAndRefresh("Request Requirement Draft", () => api.requestAutomationRequirementDraft(sessionId));
    });
    const reconcile = button("Reconcile Provider", "requirement-reconcile");
    reconcile.addEventListener("click", () => {
      const sessionId = view.alignment!.session.alignmentSessionId;
      void runAndRefresh("Reconcile Requirement", () => api.reconcileAutomationRequirement(sessionId, view.alignment!.session.currentRoundId));
    });
    actions.append(draft, reconcile);
    card.append(actions, node("span", "automation-rp-note", "Provider continuation uses persisted provider binding; UI does not resend a target or choose a provider."));
    return card;
  };

  const renderRequirement = (view: AutomationRequirementProjectView): HTMLElement | null => {
    const requirement = view.requirement;
    if (!requirement) return null;
    const card = node("section", "automation-rp-card");
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", `Requirement v${requirement.version}`), node("code", "", requirement.requirementVersionId));
    card.append(heading);
    const meta = node("div", "automation-rp-meta-grid");
    appendValue(meta, "status", requirement.status);
    appendValue(meta, "payload SHA-256", requirement.payloadSha256);
    appendValue(meta, "created", requirement.createdAt);
    appendValue(meta, "confirmed", requirement.confirmedAt);
    card.append(meta, renderRequirementContent(requirement.content));
    if (!requirement.confirmedAt) {
      const confirm = button("Confirm exact Requirement", "requirement-confirm");
      confirm.addEventListener("click", () => {
        if (!window.confirm(`确认 Requirement ${requirement.requirementVersionId}\nSHA-256: ${requirement.payloadSha256}\n\n确认后该 exact hash 将成为 active Requirement truth。`)) return;
        void runAndRefresh("Confirm Requirement", () => api.confirmAutomationRequirement(view.project.projectId, requirement.requirementVersionId, requirement.payloadSha256));
      });
      const confirmActions = node("div", "automation-rp-actions");
      confirmActions.append(confirm);
      card.append(confirmActions);
    }
    return card;
  };

  const renderPlannerReceipt = (): HTMLElement | null => {
    const receipt = lastPlanner;
    if (!receipt) return null;
    const wrapper = node("div", "automation-rp-planner-receipt");
    const meta = node("div", "automation-rp-meta-grid");
    if ("status" in receipt) appendValue(meta, "operation status", receipt.status);
    if ("state" in receipt) appendValue(meta, "intent state", receipt.state);
    appendValue(meta, "ActionIntent", receipt.actionIntentId);
    appendValue(meta, "ActionAttempt", receipt.actionAttemptId);
    appendValue(meta, "PlanVersion", receipt.planVersionId);
    if ("receiptStatus" in receipt) appendValue(meta, "receipt", receipt.receiptStatus);
    if ("attemptState" in receipt) appendValue(meta, "attempt state", receipt.attemptState);
    if ("recoveryState" in receipt) appendValue(meta, "recovery", receipt.recoveryState);
    wrapper.append(meta);
    if ("blockingQuestions" in receipt && receipt.blockingQuestions.length > 0) wrapper.append(renderList("Planner blocking questions", receipt.blockingQuestions));
    if ("missingRequirementFields" in receipt && receipt.missingRequirementFields.length > 0) wrapper.append(renderList("Missing Requirement fields", receipt.missingRequirementFields));
    if ("errorMessage" in receipt && receipt.errorMessage) wrapper.append(node("p", "automation-rp-status is-error", `${receipt.errorCode ?? "PLANNER"}: ${receipt.errorMessage}`));
    return wrapper;
  };

  const plannerIntentId = (): string | null => lastPlanner?.actionIntentId ?? null;
  const plannerAttemptId = (): string | null => lastPlanner?.actionAttemptId ?? null;

  const renderPlanner = (view: AutomationRequirementProjectView): HTMLElement => {
    const card = node("section", "automation-rp-card");
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", "Planner"), node("code", "", view.project.activePlanVersionId ?? "no active PlanVersion"));
    card.append(heading);
    const meta = node("div", "automation-rp-meta-grid");
    appendValue(meta, "active RequirementVersion", view.project.activeRequirementVersionId);
    appendValue(meta, "active PlanVersion", view.project.activePlanVersionId);
    card.append(meta);

    const actions = node("div", "automation-rp-actions");
    const create = button("Create Plan on selected Native Thread", "planner-create");
    create.dataset.requiresActiveRequirement = "true";
    create.addEventListener("click", () => {
      const requirementVersionId = view.project.activeRequirementVersionId;
      const target = selectedTargetRef;
      if (!requirementVersionId) {
        setStatus("需要先有 active confirmed RequirementVersion。", "error");
        return;
      }
      if (!target) return;
      if (!window.confirm(`用 active Requirement ${requirementVersionId} 在 exact Native Thread ${target} 上创建 Plan？`)) return;
      void runAndRefresh("Create Plan", async () => {
        const preflight = await exactTargetPreflight();
        if (!preflight.ok) return { ok: false, error: preflight.error };
        return api.createAutomationPlan(view.project.projectId, target, requirementVersionId);
      }, (receipt) => { lastPlanner = receipt; });
    });
    actions.append(create);

    const actionAttemptId = plannerAttemptId();
    if (actionAttemptId) {
      const reconcile = button("Reconcile Planner", "planner-reconcile");
      reconcile.addEventListener("click", () => void runAndRefresh("Reconcile Planner", () => api.reconcileAutomationPlan(view.project.projectId, actionAttemptId), (receipt) => { lastPlanner = receipt; }));
      actions.append(reconcile);
    }
    const actionIntentId = plannerIntentId();
    if (actionIntentId) {
      const retry = button("Retry exact Planner intent", "planner-retry");
      retry.addEventListener("click", () => void runAndRefresh("Retry Planner", () => api.retryAutomationPlan(view.project.projectId, actionIntentId), (receipt) => { lastPlanner = receipt; }));
      const plannerStatus = button("Planner Status", "planner-status");
      plannerStatus.addEventListener("click", () => void runAndRefresh("Read Planner Status", () => api.getAutomationPlannerStatus(view.project.projectId, actionIntentId), (receipt) => { lastPlanner = receipt; }));
      const result = button("Planner Result", "planner-result");
      result.addEventListener("click", () => void runAndRefresh("Read Planner Result", () => api.getAutomationPlannerResult(view.project.projectId, actionIntentId), (receipt) => { lastPlanner = receipt; }));
      actions.append(retry, plannerStatus, result);
    }
    card.append(actions);
    const receipt = renderPlannerReceipt();
    if (receipt) card.append(receipt);
    card.append(node("span", "automation-rp-note", "Planner action receipts只保留恢复所需 identity/status；Plan 内容和最终 workflow truth 继续从 governance projection 读取。"));
    return card;
  };

  const renderIntegrity = (view: AutomationRequirementProjectView): HTMLElement => {
    const card = node("section", `automation-rp-card automation-rp-integrity${view.integrity.status === "DEGRADED" ? " is-degraded" : ""}`);
    const heading = node("div", "automation-rp-card-heading");
    heading.append(node("strong", "", "Requirement Projection Integrity"), node("code", "", view.integrity.status));
    card.append(heading);
    if (view.integrity.issues.length > 0) {
      const list = document.createElement("ul");
      for (const issue of view.integrity.issues) list.append(node("li", "", issue));
      card.append(list);
    } else {
      card.append(node("span", "muted", "当前 projection 未报告完整性问题。"));
    }
    return card;
  };

  function render(view: AutomationRequirementProjectView): void {
    body.replaceChildren();
    title.textContent = `${view.project.name} · Requirement / Planner`;
    body.append(renderTarget(view), renderAlignment(view));
    const questions = renderQuestions(view);
    if (questions) body.append(questions);
    const requirement = renderRequirement(view);
    if (requirement) body.append(requirement);
    body.append(renderPlanner(view), renderIntegrity(view));
    setBusy(busy);
  }

  openButton.addEventListener("click", async () => {
    const projectId = projectSelect.value.trim();
    if (!projectId || busy) return;
    if (currentProjectId !== projectId) {
      selectedTargetRef = null;
      runtimeSnapshot = null;
      lastPlanner = null;
    }
    currentProjectId = projectId;
    currentView = null;
    body.replaceChildren(node("p", "automation-rp-note", "正在读取 Requirement workflow truth 与 Runtime Truth…"));
    setStatus("");
    if (!dialog.open) dialog.showModal();
    setBusy(true);
    try {
      const runtime = await readRuntime();
      if (!runtime.ok || !runtime.result) setStatus(errorMessage(runtime), "error");
      await refreshProjection();
    } catch (error) {
      body.replaceChildren(node("p", "automation-rp-status is-error", error instanceof Error ? error.message : "Requirement / Planner workspace unavailable."));
    } finally {
      setBusy(false);
    }
  });

  const updateLauncher = (): void => {
    openButton.disabled = busy || !projectSelect.value.trim();
  };
  projectSelect.addEventListener("change", updateLauncher);
  const observer = new MutationObserver(updateLauncher);
  observer.observe(projectSelect, { childList: true, subtree: true, attributes: true });
  updateLauncher();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installRequirementPlannerWorkspace();
}
