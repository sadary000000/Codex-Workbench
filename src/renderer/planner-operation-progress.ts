const DIALOG_ID = "automation-requirement-planner-dialog";
const CREATE_ACTION = "planner-create";
const SLOW_HINT_AFTER_MS = 8_000;

function plannerStatus(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(".automation-rp-status");
}

function stopProgress(timer: ReturnType<typeof setInterval> | null): void {
  if (timer !== null) clearInterval(timer);
}

function installPlannerOperationProgress(): void {
  const dialog = document.getElementById(DIALOG_ID);
  if (!dialog || dialog.dataset.plannerProgressInstalled === "true") return;
  dialog.dataset.plannerProgressInstalled = "true";

  let timer: ReturnType<typeof setInterval> | null = null;
  let runId = 0;

  const beginCreatePlanProgress = (): void => {
    const status = plannerStatus(dialog);
    if (!status || status.classList.contains("is-error") || status.classList.contains("is-ok")) return;
    stopProgress(timer);
    const currentRun = ++runId;
    const startedAt = Date.now();

    const renderProgress = (): void => {
      if (currentRun !== runId) return;
      const current = plannerStatus(dialog);
      if (!current) {
        stopProgress(timer);
        timer = null;
        return;
      }
      if (current.classList.contains("is-error") || current.classList.contains("is-ok")) {
        stopProgress(timer);
        timer = null;
        return;
      }
      const existing = current.textContent ?? "";
      if (existing && !existing.startsWith("Create Plan")) {
        stopProgress(timer);
        timer = null;
        return;
      }
      const elapsedMs = Date.now() - startedAt;
      const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
      const phase = elapsedMs < 2_000
        ? "Create Plan · 正在核对 exact Native target"
        : "Create Plan · 等待 Planner 接受/返回";
      const slowHint = elapsedMs >= SLOW_HINT_AFTER_MS ? " · 响应较慢；请勿重复提交" : "";
      current.textContent = `${phase} · 已等待 ${elapsedSeconds}s${slowHint}`;
    };

    renderProgress();
    timer = setInterval(renderProgress, 1_000);
  };

  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(`button[data-requirement-planner-action="${CREATE_ACTION}"]`)
      : null;
    if (!target) return;
    // The Planner's own click handler runs first. A cancelled confirmation does
    // not enter its busy state or write the "Create Plan" status, so start the
    // presentation timer only after that synchronous handler has had a chance.
    queueMicrotask(() => {
      const status = plannerStatus(dialog);
      if (status?.textContent?.startsWith("Create Plan") && !status.classList.contains("is-error") && !status.classList.contains("is-ok")) {
        beginCreatePlanProgress();
      }
    });
  });

  const status = plannerStatus(dialog);
  if (status) {
    const observer = new MutationObserver(() => {
      const message = status.textContent ?? "";
      if (status.classList.contains("is-error") && /TIMEOUT|RECOVERY|UNKNOWN|APP_SERVER_TIMEOUT/i.test(message) && !message.includes("勿再次提交")) {
        status.textContent = `${message}；请求结果可能不确定，请先使用 Reconcile Planner / Planner Status，勿再次提交。`;
      }
      if (status.classList.contains("is-error") || status.classList.contains("is-ok")) {
        runId += 1;
        stopProgress(timer);
        timer = null;
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installPlannerOperationProgress();
}
