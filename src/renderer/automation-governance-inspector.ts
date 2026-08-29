import type {
  AutomationGovernanceEvidenceView,
  AutomationGovernanceProjectView,
  AutomationGovernanceStageView,
  AutomationGovernanceStepView,
} from "../shared/automation-governance-types.ts";

interface IpcEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { message?: string };
}

interface AutomationGovernanceReadApi {
  getAutomationGovernanceProject(projectId: string): Promise<IpcEnvelope<AutomationGovernanceProjectView>>;
}

interface AssociatedAutomationProject {
  projectId: string;
  name: string;
}

const ROOT_ID = "automation-governance-inspector-launcher";
const DIALOG_ID = "automation-governance-inspector-dialog";
const STYLE_ID = "automation-governance-inspector-style";

function textElement(tag: keyof HTMLElementTagNameMap, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function addMeta(container: HTMLElement, label: string, value: string | number | null | undefined): void {
  const item = document.createElement("div");
  item.className = "automation-governance-meta-item";
  item.append(
    textElement("span", "automation-governance-meta-label", label),
    textElement("code", "automation-governance-meta-value", displayValue(value)),
  );
  container.append(item);
}

function evidenceBadge(evidence: AutomationGovernanceEvidenceView | null, emptyLabel: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "automation-governance-badge";
  if (!evidence) {
    badge.classList.add("is-muted");
    badge.textContent = emptyLabel;
    return badge;
  }
  badge.textContent = `${evidence.type} · ${evidence.state}`;
  if (evidence.state === "PASS" || evidence.state === "APPROVE") badge.classList.add("is-pass");
  if (evidence.state === "FAIL" || evidence.state === "REJECT") badge.classList.add("is-reject");
  return badge;
}

function renderEvidence(label: string, evidence: AutomationGovernanceEvidenceView | null): HTMLElement {
  const block = document.createElement("div");
  block.className = "automation-governance-evidence";
  const heading = document.createElement("div");
  heading.className = "automation-governance-evidence-heading";
  heading.append(textElement("strong", "", label), evidenceBadge(evidence, "尚无证据"));
  block.append(heading);
  if (!evidence) return block;

  const meta = document.createElement("div");
  meta.className = "automation-governance-meta-grid compact";
  addMeta(meta, "evidenceId", evidence.evidenceId);
  addMeta(meta, "producer", evidence.producer);
  addMeta(meta, "source", evidence.source);
  addMeta(meta, "timestamp", evidence.timestamp);
  addMeta(meta, "sha256", evidence.sha256);
  addMeta(meta, "actorRef", evidence.actorRef);
  if (evidence.verificationClass) addMeta(meta, "verificationClass", evidence.verificationClass);
  block.append(meta);
  return block;
}

function renderStep(step: AutomationGovernanceStepView): HTMLElement {
  const article = document.createElement("article");
  article.className = "automation-governance-step";

  const heading = document.createElement("div");
  heading.className = "automation-governance-step-heading";
  const title = document.createElement("div");
  title.append(
    textElement("strong", "", step.stepKey),
    textElement("code", "automation-governance-inline-id", step.stepSpecId),
  );
  heading.append(title);
  if (step.runtime) {
    const runtimeBadge = textElement("span", "automation-governance-badge", step.runtime.lifecycle);
    if (step.runtime.terminalResult === "COMPLETED") runtimeBadge.classList.add("is-pass");
    if (step.runtime.terminalResult === "FAILED") runtimeBadge.classList.add("is-reject");
    heading.append(runtimeBadge);
  } else {
    heading.append(textElement("span", "automation-governance-badge is-muted", "未创建 runtime"));
  }
  article.append(heading, textElement("p", "automation-governance-objective", step.objective));

  const meta = document.createElement("div");
  meta.className = "automation-governance-meta-grid";
  addMeta(meta, "risk", step.riskClass);
  addMeta(meta, "sideEffect", step.sideEffectClass);
  addMeta(meta, "runtime", step.runtime?.lifecycle);
  addMeta(meta, "runtime result", step.runtime?.terminalResult);
  addMeta(meta, "wait reason", step.runtime?.waitReason);
  addMeta(meta, "attempt", step.attempt ? `#${step.attempt.attemptNumber} · ${step.attempt.lifecycle}` : null);
  addMeta(meta, "attempt result", step.attempt?.terminalResult);
  article.append(meta);

  const evidence = document.createElement("div");
  evidence.className = "automation-governance-evidence-grid";
  evidence.append(renderEvidence("Verification", step.verification), renderEvidence("Review", step.review));
  article.append(evidence);
  return article;
}

function renderStage(stage: AutomationGovernanceStageView): HTMLElement {
  const details = document.createElement("details");
  details.className = "automation-governance-stage";
  details.open = stage.isCurrent;

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "automation-governance-stage-title";
  title.append(
    textElement("strong", "", `${stage.ordinal + 1}. ${stage.name || stage.stageKey}`),
    textElement("code", "automation-governance-inline-id", stage.stageSpecId),
  );
  const badges = document.createElement("span");
  badges.className = "automation-governance-stage-badges";
  if (stage.isCurrent) badges.append(textElement("span", "automation-governance-badge is-current", "当前 Stage"));
  badges.append(evidenceBadge(stage.gate, "Stage Gate 未决"));
  summary.append(title, badges);
  details.append(summary, textElement("p", "automation-governance-objective", stage.objective));

  const meta = document.createElement("div");
  meta.className = "automation-governance-meta-grid";
  addMeta(meta, "stageKey", stage.stageKey);
  addMeta(meta, "detailLevel", stage.detailLevel);
  addMeta(meta, "dependsOn", stage.dependsOn.length > 0 ? stage.dependsOn.join(", ") : null);
  addMeta(meta, "steps", stage.steps.length);
  details.append(meta);

  const steps = document.createElement("div");
  steps.className = "automation-governance-steps";
  if (stage.steps.length === 0) {
    steps.append(textElement("p", "muted", "此 Stage 没有可投影的 Step。"));
  } else {
    for (const step of stage.steps) steps.append(renderStep(step));
  }
  details.append(steps);
  return details;
}

function renderProject(view: AutomationGovernanceProjectView, body: HTMLElement): void {
  body.replaceChildren();

  const header = document.createElement("section");
  header.className = "automation-governance-project-summary";
  header.append(
    textElement("h3", "", view.project.name),
    textElement("code", "automation-governance-project-id", view.project.projectId),
  );

  const meta = document.createElement("div");
  meta.className = "automation-governance-meta-grid";
  addMeta(meta, "lifecycle", view.project.lifecycle);
  addMeta(meta, "RequirementVersion", view.project.activeRequirementVersionId);
  addMeta(meta, "PlanVersion", view.project.activePlanVersionId);
  addMeta(meta, "Plan status", view.plan?.status);
  addMeta(meta, "Plan version", view.plan?.version);
  addMeta(meta, "Plan SHA-256", view.plan?.payloadSha256);
  addMeta(meta, "runtime source", view.runtimePosition?.source);
  addMeta(meta, "current Stage", view.runtimePosition?.currentStageSpecId);
  header.append(meta);

  const integrity = document.createElement("section");
  integrity.className = "automation-governance-integrity";
  const integrityHeading = document.createElement("div");
  integrityHeading.className = "automation-governance-section-heading";
  const integrityBadge = textElement("span", "automation-governance-badge", view.integrity.status);
  integrityBadge.classList.add(view.integrity.status === "OK" ? "is-pass" : "is-reject");
  integrityHeading.append(textElement("strong", "", "Integrity"), integrityBadge);
  integrity.append(integrityHeading);
  if (view.integrity.issues.length > 0) {
    const list = document.createElement("ul");
    list.className = "automation-governance-issues";
    for (const issue of view.integrity.issues) list.append(textElement("li", "", issue));
    integrity.append(list);
  } else {
    integrity.append(textElement("p", "muted", "当前 projection 未报告完整性问题。"));
  }

  const stages = document.createElement("section");
  stages.className = "automation-governance-stage-list";
  stages.append(textElement("h3", "", "Stages"));
  if (view.stages.length === 0) {
    stages.append(textElement("p", "muted", "当前 Plan 没有可投影的 Stage。"));
  } else {
    for (const stage of view.stages) stages.append(renderStage(stage));
  }

  body.append(header, integrity, stages);
}

function collectAssociatedProjects(list: HTMLElement): AssociatedAutomationProject[] {
  const projects: AssociatedAutomationProject[] = [];
  for (const row of list.querySelectorAll<HTMLElement>(".project-automation-row")) {
    const projectId = row.querySelector<HTMLElement>(".project-automation-summary code")?.textContent?.trim() ?? "";
    if (!projectId) continue;
    const name = row.querySelector<HTMLElement>(".project-automation-summary strong")?.textContent?.trim() || projectId;
    projects.push({ projectId, name });
  }
  return projects;
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} { display: grid; gap: 7px; padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: #202020; }
    #${ROOT_ID} .automation-governance-launcher-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    #${ROOT_ID} .automation-governance-launcher-heading span { color: var(--muted); font-size: 11px; }
    #${ROOT_ID} .automation-governance-launcher-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
    #${ROOT_ID} select { min-width: 0; }
    #${DIALOG_ID} { width: min(920px, 92vw); max-height: 86vh; border: 1px solid var(--border); border-radius: 10px; background: #202020; color: #ececec; }
    #${DIALOG_ID}::backdrop { background: #0009; }
    #${DIALOG_ID} .automation-governance-dialog-shell { display: grid; gap: 14px; min-width: 0; }
    #${DIALOG_ID} .automation-governance-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; padding-bottom: 10px; background: #202020; border-bottom: 1px solid var(--border); z-index: 1; }
    #${DIALOG_ID} .automation-governance-dialog-header h2 { margin: 0; font-size: 16px; }
    #${DIALOG_ID} .automation-governance-dialog-body { display: grid; gap: 12px; min-width: 0; overflow: auto; }
    #${DIALOG_ID} h3 { margin: 0; font-size: 14px; }
    #${DIALOG_ID} code { font-family: ui-monospace, Consolas, monospace; }
    #${DIALOG_ID} .automation-governance-project-summary, #${DIALOG_ID} .automation-governance-integrity { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: #242424; }
    #${DIALOG_ID} .automation-governance-project-id, #${DIALOG_ID} .automation-governance-inline-id { color: #9fbeb1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${DIALOG_ID} .automation-governance-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 7px; }
    #${DIALOG_ID} .automation-governance-meta-grid.compact { grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); }
    #${DIALOG_ID} .automation-governance-meta-item { display: grid; min-width: 0; gap: 3px; padding: 7px; border-radius: 6px; background: #1c1c1c; }
    #${DIALOG_ID} .automation-governance-meta-label { color: #777; font-size: 10px; }
    #${DIALOG_ID} .automation-governance-meta-value { overflow: hidden; color: #c5d8d0; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    #${DIALOG_ID} .automation-governance-section-heading, #${DIALOG_ID} .automation-governance-evidence-heading, #${DIALOG_ID} .automation-governance-step-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    #${DIALOG_ID} .automation-governance-badge { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px; border: 1px solid #4a4a4a; border-radius: 999px; color: #c8c8c8; font-size: 10px; white-space: nowrap; }
    #${DIALOG_ID} .automation-governance-badge.is-current { border-color: #7d6536; color: #efc77a; }
    #${DIALOG_ID} .automation-governance-badge.is-pass { border-color: #3d5d51; color: #9de3c4; }
    #${DIALOG_ID} .automation-governance-badge.is-reject { border-color: #744844; color: var(--danger); }
    #${DIALOG_ID} .automation-governance-badge.is-muted { color: #777; }
    #${DIALOG_ID} .automation-governance-stage-list, #${DIALOG_ID} .automation-governance-steps { display: grid; gap: 9px; }
    #${DIALOG_ID} .automation-governance-stage { border: 1px solid var(--border); border-radius: 8px; background: #242424; overflow: hidden; }
    #${DIALOG_ID} .automation-governance-stage > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; cursor: pointer; }
    #${DIALOG_ID} .automation-governance-stage-title { display: grid; min-width: 0; gap: 3px; }
    #${DIALOG_ID} .automation-governance-stage-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
    #${DIALOG_ID} .automation-governance-stage > :not(summary) { margin-inline: 12px; }
    #${DIALOG_ID} .automation-governance-stage > .automation-governance-steps { margin-bottom: 12px; }
    #${DIALOG_ID} .automation-governance-objective { margin-block: 0 10px; color: #b9b9b9; font-size: 12px; line-height: 1.55; }
    #${DIALOG_ID} .automation-governance-step { display: grid; gap: 8px; padding: 10px; border: 1px solid #383838; border-radius: 7px; background: #202020; }
    #${DIALOG_ID} .automation-governance-step-heading > div { display: grid; min-width: 0; gap: 3px; }
    #${DIALOG_ID} .automation-governance-evidence-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
    #${DIALOG_ID} .automation-governance-evidence { display: grid; gap: 7px; padding: 8px; border: 1px solid #333; border-radius: 6px; }
    #${DIALOG_ID} .automation-governance-issues { margin: 0; padding-left: 20px; color: var(--danger); font-size: 12px; }
    #${DIALOG_ID} .automation-governance-error { color: var(--danger); }
  `;
  document.head.append(style);
}

function installAutomationGovernanceInspector(): void {
  if (document.getElementById(ROOT_ID)) return;
  const associationList = document.querySelector<HTMLElement>("#project-automation-list");
  if (!associationList) return;

  const api = (window as unknown as { codexWorkbenchV1?: AutomationGovernanceReadApi }).codexWorkbenchV1;
  installStyles();

  const launcher = document.createElement("section");
  launcher.id = ROOT_ID;
  const heading = document.createElement("div");
  heading.className = "automation-governance-launcher-heading";
  heading.append(textElement("strong", "", "Governance Inspector"), textElement("span", "", "只读 workflow truth"));
  const controls = document.createElement("div");
  controls.className = "automation-governance-launcher-controls";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "选择 AutomationProject 查看 Governance");
  const inspectButton = document.createElement("button");
  inspectButton.type = "button";
  inspectButton.className = "debug-button";
  inspectButton.textContent = "查看 Governance";
  controls.append(select, inspectButton);
  launcher.append(heading, controls, textElement("span", "muted", "读取 Governance Projection；不会执行 Step、Review、Gate、Advance 或 Complete。"));
  associationList.insertAdjacentElement("afterend", launcher);

  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  const shell = document.createElement("div");
  shell.className = "automation-governance-dialog-shell";
  const dialogHeader = document.createElement("div");
  dialogHeader.className = "automation-governance-dialog-header";
  const dialogTitle = textElement("h2", "", "Automation Governance");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "debug-button";
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", () => dialog.close());
  dialogHeader.append(dialogTitle, closeButton);
  const dialogBody = document.createElement("div");
  dialogBody.className = "automation-governance-dialog-body";
  shell.append(dialogHeader, dialogBody);
  dialog.append(shell);
  document.body.append(dialog);

  const refreshProjects = (): void => {
    const previous = select.value;
    const projects = collectAssociatedProjects(associationList);
    select.replaceChildren();
    if (projects.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "暂无已关联 AutomationProject";
      select.append(option);
      select.disabled = true;
      inspectButton.disabled = true;
      return;
    }
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.projectId;
      option.textContent = `${project.name} · ${project.projectId}`;
      select.append(option);
    }
    if (projects.some((project) => project.projectId === previous)) select.value = previous;
    select.disabled = false;
    inspectButton.disabled = !api;
  };

  const observer = new MutationObserver(refreshProjects);
  observer.observe(associationList, { childList: true, subtree: true });
  refreshProjects();

  inspectButton.addEventListener("click", async () => {
    const projectId = select.value.trim();
    if (!projectId || !api) return;
    inspectButton.disabled = true;
    dialogTitle.textContent = "Automation Governance";
    dialogBody.replaceChildren(textElement("p", "muted", "正在读取 Governance Projection…"));
    if (!dialog.open) dialog.showModal();
    try {
      const response = await api.getAutomationGovernanceProject(projectId);
      if (!response.ok || !response.result) {
        const message = response.error?.message || "Governance Projection 暂时不可用。";
        dialogBody.replaceChildren(textElement("p", "automation-governance-error", message));
        return;
      }
      dialogTitle.textContent = `${response.result.project.name} · Governance`;
      renderProject(response.result, dialogBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Governance Projection 读取失败。";
      dialogBody.replaceChildren(textElement("p", "automation-governance-error", message));
    } finally {
      inspectButton.disabled = false;
    }
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installAutomationGovernanceInspector();
}
