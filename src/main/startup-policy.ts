/**
 * Startup capability policy. Ordinary GUI startup must remain idle with
 * respect to optional Automation/WebGPT state; explicit commands and gates
 * are the activation boundary.
 */
const AUTOMATION_GATE_FLAGS = [
  "AUT2_REAL_WEBGPT_GATE",
  "AUT3_REAL_PLANNER_GATE",
  "AUT2_AUT3_FIX10_REAL_GATE",
] as const;

export type StartupPlan = Readonly<{
  automationAtStartup: boolean;
  controlPlaneAtStartup: boolean;
}>;

export interface StartupActions {
  initializeAutomation(): Promise<void>;
  startControlPlane(): Promise<void>;
}

export function explicitAutomationGate(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.AUT2_NORMAL_GUI_STORE_SMOKE === "1") return "AUT2_NORMAL_GUI_STORE_SMOKE";
  return AUTOMATION_GATE_FLAGS.find((name) => env[name] === "1") ?? null;
}

export function createStartupPlan(input: {
  env?: NodeJS.ProcessEnv;
  initialWebGptCommand?: string | null;
} = {}): StartupPlan {
  const automationAtStartup = explicitAutomationGate(input.env ?? process.env) !== null;
  const persistenceSmoke = (input.env ?? process.env).AUT2_NORMAL_GUI_STORE_SMOKE === "1";
  return {
    automationAtStartup,
    controlPlaneAtStartup: Boolean(input.initialWebGptCommand) || automationAtStartup && !persistenceSmoke,
  };
}

/** Execute only the capabilities admitted by the startup plan. */
export async function runStartupPlan(plan: StartupPlan, actions: StartupActions): Promise<void> {
  if (plan.automationAtStartup) await actions.initializeAutomation();
  if (plan.controlPlaneAtStartup) await actions.startControlPlane();
}
