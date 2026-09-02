import type {
  ActionIntentState,
  ActionAttemptState,
  AutomationProjectLifecycle,
  ExecutionAttemptLifecycle,
  RequirementAlignmentRoundStatus,
  RequirementAlignmentSessionStatus,
  RequirementAssumptionStatus,
  RequirementQuestionStatus,
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

/** Requirement alignment is a bounded, user-confirmable sub-protocol. */
export const requirementAlignmentSessionStateMachine = new StateMachine<RequirementAlignmentSessionStatus, string>("RequirementAlignmentSession", [
  { from: "DRAFT", event: "START", to: "ACTIVE" },
  { from: "DRAFT", event: "OPEN", to: "OPEN" },
  { from: "DRAFT", event: "CANCEL", to: "CANCELLED" },
  { from: "ACTIVE", event: "ASK_BATCH", to: "WAITING_FOR_USER" },
  { from: "ACTIVE", event: "OPEN_ROUND", to: "WAITING_FOR_USER" },
  { from: "ACTIVE", event: "BLOCK", to: "BLOCKED" },
  { from: "ACTIVE", event: "COMPLETE", to: "RESOLVED" },
  { from: "ACTIVE", event: "CANCEL", to: "CANCELLED" },
  { from: "OPEN", event: "ASK_BATCH", to: "WAITING_FOR_USER" },
  { from: "OPEN", event: "OPEN_ROUND", to: "WAITING_FOR_USER" },
  { from: "OPEN", event: "BLOCK", to: "BLOCKED" },
  { from: "OPEN", event: "COMPLETE", to: "RESOLVED" },
  { from: "OPEN", event: "CANCEL", to: "CANCELLED" },
  { from: "WAITING_FOR_USER", event: "ANSWER_BATCH", to: "ACTIVE" },
  { from: "WAITING_AUTOMATIC_EVIDENCE", event: "EVIDENCE_READY", to: "ACTIVE" },
  { from: "WAITING_AUTOMATIC_EVIDENCE", event: "BLOCK", to: "BLOCKED" },
  { from: "WAITING_FOR_USER", event: "RESOLVE", to: "ACTIVE" },
  { from: "WAITING_FOR_USER", event: "BLOCK", to: "BLOCKED" },
  { from: "WAITING_FOR_USER", event: "CONFIRM", to: "CONFIRMED" },
  { from: "WAITING_FOR_USER", event: "CANCEL", to: "CANCELLED" },
  { from: "BLOCKED", event: "RESOLVE_BLOCKER", to: "ACTIVE" },
  { from: "BLOCKED", event: "RESOLVE", to: "ACTIVE" },
  { from: "BLOCKED", event: "CANCEL", to: "CANCELLED" },
  { from: "RESOLVED", event: "CONFIRM", to: "CONFIRMED" },
  { from: "RESOLVED", event: "CANCEL", to: "CANCELLED" },
  { from: "CONFIRMED", event: "SUPERSEDE", to: "SUPERSEDED" },
]);

export const requirementAlignmentRoundStateMachine = new StateMachine<RequirementAlignmentRoundStatus, string>("RequirementAlignmentRound", [
  { from: "DRAFT", event: "OPEN", to: "OPEN" },
  { from: "DRAFT", event: "START", to: "ACTIVE" },
  { from: "DRAFT", event: "CANCEL", to: "CANCELLED" },
  { from: "OPEN", event: "ASK_BATCH", to: "WAITING_FOR_USER" },
  { from: "OPEN", event: "START", to: "ACTIVE" },
  { from: "OPEN", event: "BLOCK", to: "BLOCKED" },
  { from: "OPEN", event: "CANCEL", to: "CANCELLED" },
  { from: "ACTIVE", event: "ASK_BATCH", to: "WAITING_FOR_USER" },
  { from: "ACTIVE", event: "BLOCK", to: "BLOCKED" },
  { from: "ACTIVE", event: "RESOLVE", to: "RESOLVED" },
  { from: "ACTIVE", event: "CANCEL", to: "CANCELLED" },
  { from: "WAITING_FOR_USER", event: "ANSWER_BATCH", to: "ACTIVE" },
  { from: "WAITING_AUTOMATIC_EVIDENCE", event: "EVIDENCE_READY", to: "ACTIVE" },
  { from: "WAITING_AUTOMATIC_EVIDENCE", event: "BLOCK", to: "BLOCKED" },
  { from: "WAITING_FOR_USER", event: "RESOLVE", to: "RESOLVED" },
  { from: "WAITING_FOR_USER", event: "BLOCK", to: "BLOCKED" },
  { from: "WAITING_FOR_USER", event: "CANCEL", to: "CANCELLED" },
  { from: "BLOCKED", event: "RESOLVE_BLOCKER", to: "ACTIVE" },
  { from: "BLOCKED", event: "RESOLVE", to: "RESOLVED" },
  { from: "BLOCKED", event: "CANCEL", to: "CANCELLED" },
  { from: "RESOLVED", event: "CONFIRM", to: "CONFIRMED" },
]);

export const requirementQuestionStateMachine = new StateMachine<RequirementQuestionStatus, string>("RequirementQuestion", [
  { from: "OPEN", event: "ANSWER", to: "ANSWERED" },
  { from: "OPEN", event: "ASSUME", to: "ASSUMED" },
  { from: "OPEN", event: "RESOLVE", to: "RESOLVED" },
  { from: "OPEN", event: "SKIP", to: "SKIPPED" },
  { from: "OPEN", event: "CANCEL", to: "CANCELLED" },
  { from: "PENDING", event: "ANSWER", to: "ANSWERED" },
  { from: "PENDING", event: "ASSUME", to: "ASSUMED" },
  { from: "PENDING", event: "RESOLVE", to: "RESOLVED" },
  { from: "PENDING", event: "SKIP", to: "SKIPPED" },
  { from: "PENDING", event: "CANCEL", to: "CANCELLED" },
  { from: "ANSWERED", event: "RESOLVE", to: "RESOLVED" },
  { from: "ASSUMED", event: "RESOLVE", to: "RESOLVED" },
]);

export const requirementAssumptionStateMachine = new StateMachine<RequirementAssumptionStatus, string>("RequirementAssumption", [
  { from: "PROPOSED", event: "ACTIVATE", to: "ACTIVE" },
  { from: "PROPOSED", event: "ACCEPT", to: "ACCEPTED" },
  { from: "PROPOSED", event: "CONFIRM", to: "CONFIRMED" },
  { from: "PROPOSED", event: "REJECT", to: "REJECTED" },
  { from: "ACTIVE", event: "ACCEPT", to: "ACCEPTED" },
  { from: "ACTIVE", event: "CONFIRM", to: "CONFIRMED" },
  { from: "ACTIVE", event: "REJECT", to: "REJECTED" },
  { from: "ACCEPTED", event: "SUPERSEDE", to: "SUPERSEDED" },
  { from: "CONFIRMED", event: "SUPERSEDE", to: "SUPERSEDED" },
]);

export const requirementSessionStateMachine = requirementAlignmentSessionStateMachine;
export const requirementRoundStateMachine = requirementAlignmentRoundStateMachine;

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
  // Recovery is an auditable transition in the existing StepRuntime machine.
  // It is legal only after a definitively failed terminal attempt has been
  // classified safe for a brand-new Attempt/ActionIntent.
  { from: "TERMINAL", event: "RETRY", to: "READY" },
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
  { from: "UNCERTAIN", event: "REAUTHORIZE_RETRY", to: "DISPATCH_ELIGIBLE" },
  { from: "RECOVERY_REQUIRED", event: "REAUTHORIZE_RETRY", to: "DISPATCH_ELIGIBLE" },
  { from: "FAILED", event: "REAUTHORIZE_RETRY", to: "DISPATCH_ELIGIBLE" },
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
