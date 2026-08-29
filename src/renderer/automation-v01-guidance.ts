const ROOT_ID = "automation-governance-inspector-launcher";

function installAutomationV01Guidance(): void {
  const launcher = document.getElementById(ROOT_ID);
  if (!launcher) return;

  const heading = launcher.querySelector<HTMLElement>(".automation-governance-launcher-heading strong");
  const subtitle = launcher.querySelector<HTMLElement>(".automation-governance-launcher-heading span");
  const controls = launcher.querySelector<HTMLElement>(".automation-governance-launcher-controls");
  const note = launcher.querySelector<HTMLElement>(":scope > span.muted");

  if (heading) heading.textContent = "Automation Workflow";
  if (subtitle) subtitle.textContent = "选择已关联项目，然后按 1 → 2 推进";

  const inspectButton = controls
    ? Array.from(controls.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => !candidate.dataset.governanceAction && !candidate.dataset.requirementPlannerAction,
      )
    : undefined;
  if (inspectButton) inspectButton.textContent = "状态 / 证据";

  const requirementButton = controls?.querySelector<HTMLButtonElement>(
    'button[data-requirement-planner-action="open"]',
  );
  if (requirementButton) requirementButton.textContent = "1 · Requirement / Plan";

  const governanceButton = controls?.querySelector<HTMLButtonElement>(
    'button[data-governance-action="open-actions"]',
  );
  if (governanceButton) governanceButton.textContent = "2 · Execute / Review / Complete";

  if (note) {
    note.textContent =
      "v0.1 基本流程：先查看状态；1 Requirement / Plan → 2 Execute → Reconcile（如需）→ Verify → Review → Gate → Advance；重复 Stage 后 Complete Project。所有动作仍由后端重新校验 workflow truth。";
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installAutomationV01Guidance();
}
