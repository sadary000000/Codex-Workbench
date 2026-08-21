import type {
  ActionIntentState,
  ActionAttemptState,
  AutomationProjectLifecycle,
  ExecutionAttemptLifecycle,
  StepRuntimeLifecycle,
  StepSpecStatus,
} from "./types.ts";

export interface StateTransition<S extends string, E extends string = string> {
  from: S;
  event: E;
  to: S;
}

export class StateTransitionError extends Error {
  readonly machine: string;
  readonly from: string;
  readonly event: string;

  constructor(machine: string, from: string, event: string) {
    super(`Illegal ${machine} transition: ${from} + ${event}`);
    this.machine = machine;
    this.from = from;
    this.event = event;
    this.name = "StateTransitionError";
  }
}

export class StateMachine<S extends string, E extends string = string> {
  private readonly transitions = new Map<string, S>();
  readonly name: string;

  constructor(name: string, definitions: readonly StateTransition<S, E>[]) {
    this.name = name;
    for (const definition of definitions) {
      const key = `${definition.from}\u0000${definition.event}`;
      if (this.transitions.has(key)) throw new Error(`Duplicate ${name} transition: ${definition.from} + ${definition.event}`);
      this.transitions.set(key, definition.to);
    }
  }

  transition(from: S, event: E): S {
    const next = this.transitions.get(`${from}\u0000${event}`);
    if (!next) throw new StateTransitionError(this.name, from, event);
    return next;
  }

  canTransition(from: S, event: E): boolean {
    return this.transitions.has(`${from}\u0000${event}`);
  }
}

export const automationProjectStateMachine = new StateMachine<AutomationProjectLifecycle, string>("AutomationProject", [
  { from: "DRAFT", event: "ALIGN_REQUIREMENTS", to: "ALIGNING_REQUIREMENTS" },
  { from: "ALIGNING_REQUIREMENTS", event: "CONFIRM_REQUIREMENTS", to: "REQUIREMENTS_CONFIRMED" },
  { from: "REQUIREMENTS_CONFIRMED", event: "START_PLANNING", to: "PLANNING" },
  { from: "PLANNING", event: "PLAN_READY", to: "READY" },
  { from: "READY", event: "START", to: "RUNNING" },
  { from: "RUNNING", event: "PAUSE", to: "PAUSED" },
  { from: "PAUSED", event: "RESUME", to: "RUNNING" },
  { from: "RUNNING", event: "BLOCK", to: "BLOCKED" },
  { from: "PAUSED", event: "BLOCK", to: "BLOCKED" },
  { from: "BLOCKED", event: "UNBLOCK", to: "PAUSED" },
  { from: "RUNNING", event: "COMPLETE", to: "COMPLETED" },
  { from: "RUNNING", event: "FAIL", to: "FAILED" },
  { from: "PAUSED", event: "CANCEL", to: "CANCELLED" },
  { from: "BLOCKED", event: "CANCEL", to: "CANCELLED" },
]);

export const stepSpecStateMachine = new StateMachine<StepSpecStatus, string>("StepSpec", [
  { from: "ACTIVE", event: "SUPERSEDE", to: "SUPERSEDED" },
]);

export const stepRuntimeStateMachine = new StateMachine<StepRuntimeLifecycle, string>("StepRuntime", [
  { from: "NOT_STARTED", event: "READY", to: "READY" },
  { from: "READY", event: "START", to: "RUNNING" },
  { from: "RUNNING", event: "VERIFY", to: "VERIFYING" },
  { from: "VERIFYING", event: "REVIEW", to: "REVIEWING" },
  { from: "REVIEWING", event: "COMPLETE", to: "TERMINAL" },
  { from: "RUNNING", event: "FAIL", to: "TERMINAL" },
  { from: "VERIFYING", event: "FAIL", to: "TERMINAL" },
  { from: "REVIEWING", event: "FAIL", to: "TERMINAL" },
  { from: "READY", event: "CANCEL", to: "TERMINAL" },
  { from: "RUNNING", event: "CANCEL", to: "TERMINAL" },
]);

export const executionAttemptStateMachine = new StateMachine<ExecutionAttemptLifecycle, string>("ExecutionAttempt", [
  { from: "CREATED", event: "START", to: "RUNNING" },
  { from: "RUNNING", event: "COMPLETE", to: "COMPLETED" },
  { from: "RUNNING", event: "FAIL", to: "FAILED" },
  { from: "RUNNING", event: "BLOCK", to: "BLOCKED" },
  { from: "RUNNING", event: "CANCEL", to: "CANCELLED" },
  { from: "RUNNING", event: "UNCERTAIN", to: "UNCERTAIN" },
  { from: "UNCERTAIN", event: "RECONCILE", to: "COMPLETED" },
  { from: "UNCERTAIN", event: "RECOVERY_REQUIRED", to: "RECOVERY_REQUIRED" },
]);

export const actionIntentStateMachine = new StateMachine<ActionIntentState, string>("ActionIntent", [
  { from: "PLANNED", event: "MARK_DISPATCH_ELIGIBLE", to: "DISPATCH_ELIGIBLE" },
  { from: "DISPATCH_ELIGIBLE", event: "BEGIN_DISPATCH", to: "DISPATCHING" },
  { from: "DISPATCHING", event: "DISPATCHED", to: "DISPATCHED" },
  { from: "DISPATCHING", event: "UNCERTAIN", to: "UNCERTAIN" },
  { from: "DISPATCHING", event: "RECOVERY_REQUIRED", to: "RECOVERY_REQUIRED" },
  { from: "DISPATCHED", event: "COMPLETE", to: "COMPLETED" },
  { from: "DISPATCHED", event: "FAIL", to: "FAILED" },
  { from: "DISPATCHED", event: "UNCERTAIN", to: "UNCERTAIN" },
  { from: "UNCERTAIN", event: "RECONCILE", to: "COMPLETED" },
  { from: "UNCERTAIN", event: "RECOVERY_REQUIRED", to: "RECOVERY_REQUIRED" },
  { from: "DISPATCH_ELIGIBLE", event: "CANCEL", to: "CANCELLED" },
]);

export const actionAttemptStateMachine = new StateMachine<ActionAttemptState, string>("ActionAttempt", [
  { from: "CREATED", event: "START", to: "RUNNING" },
  { from: "CREATED", event: "UNCERTAIN", to: "UNCERTAIN" },
  { from: "RUNNING", event: "COMPLETE", to: "COMPLETED" },
  { from: "RUNNING", event: "FAIL", to: "FAILED" },
  { from: "RUNNING", event: "UNCERTAIN", to: "UNCERTAIN" },
  { from: "UNCERTAIN", event: "RECOVERY_REQUIRED", to: "RECOVERY_REQUIRED" },
]);
