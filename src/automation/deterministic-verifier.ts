import { createHash } from "node:crypto";
import { AutomationStore } from "./store.ts";
import type {
  ActionAttempt,
  ActionIntent,
  ActionReceipt,
  AutomationDocument,
  Evidence,
  ExecutionAttempt,
  PlanVersion,
  StepRuntime,
} from "./types.ts";

const VERIFIER_PRODUCER = "workbench.deterministic-verifier.v1" as const;
const VERIFIER_EVIDENCE_TYPE = "STEP_VERIFICATION_DECISION" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const HASH_INSTRUCTION = /^sha256:([a-f0-9]{64})$/;

export type DeterministicVerificationStatus =
  | "PASS"
  | "FAIL"
  | "NOT_READY"
  | "POLICY_MISSING"
  | "POLICY_INVALID"
  | "STALE_PLAN"
  | "UNSUPPORTED"
  | "EVIDENCE_INCOMPLETE";

export interface VerifyStepInput {
  readonly projectId: string;
  readonly executionAttemptId: string;
}

export interface DeterministicVerificationResult {
  readonly status: DeterministicVerificationStatus;
  readonly projectId: string;
  readonly planVersionId: string | null;
  readonly stepSpecId: string;
  readonly stepRuntimeId: string | null;
  readonly executionAttemptId: string;
  readonly verificationClass: string | null;
  readonly evidenceId: string | null;
  readonly expectedResultHash: string | null;
  readonly observedResultHash: string | null;
  readonly reason: string;
}

export class DeterministicVerifierError extends Error {
  readonly code:
    | "VERIFIER_PROJECT_NOT_FOUND"
    | "VERIFIER_ATTEMPT_NOT_FOUND"
    | "VERIFIER_CORRELATION_INVALID"
    | "VERIFIER_STATE_CONFLICT";

  constructor(code: DeterministicVerifierError["code"], message: string) {
    super(message);
    this.name = "DeterministicVerifierError";
    this.code = code;
  }
}

interface ExecutionTruth {
  readonly document: AutomationDocument;
  readonly attempt: ExecutionAttempt;
  readonly runtime: StepRuntime;
  readonly plan: PlanVersion;
  readonly intent: ActionIntent | null;
  readonly actionAttempt: ActionAttempt | null;
  readonly receipt: ActionReceipt | null;
  readonly requestRef: string | null;
}

interface VerifierPolicy {
  readonly verificationClass: string;
  readonly verificationPlan: readonly string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicEvidenceId(input: {
  planVersionId: string;
  planPayloadSha256: string;
  stepSpecId: string;
  executionAttemptId: string;
  expected: string;
  observed: string;
}): string {
  return `verify:${sha256([input.planVersionId, input.planPayloadSha256, input.stepSpecId, input.executionAttemptId, input.expected, input.observed].join("\u0000"))}`;
}

function result(input: {
  status: DeterministicVerificationStatus;
  truth: ExecutionTruth;
  verificationClass?: string | null;
  evidenceId?: string | null;
  expectedResultHash?: string | null;
  observedResultHash?: string | null;
  reason: string;
}): DeterministicVerificationResult {
  return {
    status: input.status,
    projectId: input.truth.attempt.projectId,
    planVersionId: input.truth.plan?.planVersionId ?? null,
    stepSpecId: input.truth.attempt.stepSpecId,
    stepRuntimeId: input.truth.runtime?.stepRuntimeId ?? null,
    executionAttemptId: input.truth.attempt.attemptId,
    verificationClass: input.verificationClass ?? null,
    evidenceId: input.evidenceId ?? null,
    expectedResultHash: input.expectedResultHash ?? null,
    observedResultHash: input.observedResultHash ?? null,
    reason: input.reason,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readVerifierPolicy(plan: PlanVersion, stepSpecId: string): { policy: VerifierPolicy | null; status: "OK" | "MISSING" | "INVALID" } {
  if (!plan.canonicalPayload || !plan.payloadSha256 || !SHA256.test(plan.payloadSha256)) return { policy: null, status: "MISSING" };
  if (sha256(plan.canonicalPayload) !== plan.payloadSha256) return { policy: null, status: "INVALID" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(plan.canonicalPayload);
  } catch {
    return { policy: null, status: "INVALID" };
  }
  const candidate = asRecord(parsed);
  if (!candidate || candidate.planVersionId !== plan.planVersionId || candidate.projectId !== plan.projectId || candidate.requirementVersionId !== plan.requirementVersionId || candidate.requirementPayloadSha256 !== plan.requirementPayloadSha256 || !Array.isArray(candidate.steps)) {
    return { policy: null, status: "INVALID" };
  }
  const matches = candidate.steps.map(asRecord).filter((step): step is Record<string, unknown> => step?.stepSpecId === stepSpecId);
  if (matches.length !== 1) return { policy: null, status: "INVALID" };
  const step = matches[0]!;
  const hasAny = step.verificationClass !== undefined || step.verificationPlan !== undefined || step.expectedArtifacts !== undefined;
  if (!hasAny) return { policy: null, status: "MISSING" };
  if (typeof step.verificationClass !== "string" || !Array.isArray(step.verificationPlan) || step.verificationPlan.length === 0 || step.verificationPlan.some((item) => typeof item !== "string" || item.length === 0 || item.length > 2_048)) {
    return { policy: null, status: "INVALID" };
  }
  return { policy: { verificationClass: step.verificationClass, verificationPlan: step.verificationPlan as string[] }, status: "OK" };
}

function existingDecision(document: AutomationDocument, truth: ExecutionTruth): Evidence | null {
  return document.evidences.find((item) =>
    item.projectId === truth.attempt.projectId
    && item.stepSpecId === truth.attempt.stepSpecId
    && item.attemptId === truth.attempt.attemptId
    && item.type === VERIFIER_EVIDENCE_TYPE
    && item.producer === VERIFIER_PRODUCER
    && item.metadata.planVersionId === truth.plan.planVersionId
    && item.metadata.planPayloadSha256 === truth.plan.payloadSha256,
  ) ?? null;
}

function executionAction(document: AutomationDocument, attemptId: string): ActionIntent | null {
  return document.actionIntents.find((item) => item.actionType === "STEP_EXECUTION" && item.attemptId === attemptId) ?? null;
}

function latestAttempt(document: AutomationDocument, intentId: string): ActionAttempt | null {
  return document.actionAttempts
    .filter((item) => item.intentId === intentId)
    .sort((left, right) => right.dispatchNumber - left.dispatchNumber)[0] ?? null;
}

/**
 * Provider-neutral deterministic governance verifier.
 *
 * The first executable class is intentionally HASH_MATCH only. It compares
 * immutable Plan policy against an already-persisted successful execution
 * receipt. It performs no file reads, shell commands, provider calls, Codex
 * turns, or tool execution. Unsupported verification classes remain in
 * VERIFYING until a separately reviewed deterministic evidence adapter exists.
 */
export class DeterministicStepVerifier {
  readonly store: AutomationStore;

  constructor(store: AutomationStore) {
    this.store = store;
  }

  async verify(input: VerifyStepInput): Promise<DeterministicVerificationResult> {
    const truth = await this.truth(input);
    const prior = existingDecision(truth.document, truth);
    if (prior) return this.replayDecision(truth, prior);

    if (truth.plan.status !== "ACTIVE" || truth.document.automationProjects.find((item) => item.projectId === input.projectId)?.activePlanVersionId !== truth.plan.planVersionId) {
      return result({ status: "STALE_PLAN", truth, reason: "The ExecutionAttempt belongs to a PlanVersion that is no longer active." });
    }
    if (truth.runtime.currentAttemptId !== truth.attempt.attemptId || truth.attempt.lifecycle !== "COMPLETED" || truth.runtime.lifecycle !== "VERIFYING") {
      return result({ status: "NOT_READY", truth, reason: "Deterministic verification requires the exact current COMPLETED ExecutionAttempt while StepRuntime is VERIFYING." });
    }

    const descriptor = readVerifierPolicy(truth.plan, truth.attempt.stepSpecId);
    if (descriptor.status === "MISSING") return result({ status: "POLICY_MISSING", truth, reason: "The active immutable PlanVersion has no verifier descriptor for this Step." });
    if (descriptor.status === "INVALID" || !descriptor.policy) return result({ status: "POLICY_INVALID", truth, reason: "The immutable PlanVersion verifier descriptor is missing correlation or failed integrity checks." });
    if (descriptor.policy.verificationClass !== "HASH_MATCH") {
      return result({ status: "UNSUPPORTED", truth, verificationClass: descriptor.policy.verificationClass, reason: `Verification class ${descriptor.policy.verificationClass} has no reviewed deterministic evaluator in this slice.` });
    }
    if (descriptor.policy.verificationPlan.length !== 1) {
      return result({ status: "POLICY_INVALID", truth, verificationClass: descriptor.policy.verificationClass, reason: "HASH_MATCH requires exactly one sha256:<hex> instruction." });
    }
    const instruction = HASH_INSTRUCTION.exec(descriptor.policy.verificationPlan[0]!);
    if (!instruction) {
      return result({ status: "POLICY_INVALID", truth, verificationClass: descriptor.policy.verificationClass, reason: "HASH_MATCH instruction must be exactly sha256:<64 lowercase hex>." });
    }
    const expected = instruction[1]!;
    const observed = truth.receipt?.resultHash ?? null;
    if (!truth.intent || !truth.actionAttempt || !truth.receipt || truth.receipt.status !== "SUCCEEDED" || !["TERMINAL_CONFIRMED", "RESULT_OBSERVED"].includes(truth.receipt.outcomeCertainty) || !observed || !SHA256.test(observed)) {
      return result({ status: "EVIDENCE_INCOMPLETE", truth, verificationClass: descriptor.policy.verificationClass, expectedResultHash: expected, observedResultHash: observed, reason: "HASH_MATCH requires one terminally successful STEP_EXECUTION receipt with a valid resultHash." });
    }

    const decision = observed === expected ? "PASS" as const : "FAIL" as const;
    const evidenceId = deterministicEvidenceId({
      planVersionId: truth.plan.planVersionId,
      planPayloadSha256: truth.plan.payloadSha256!,
      stepSpecId: truth.attempt.stepSpecId,
      executionAttemptId: truth.attempt.attemptId,
      expected,
      observed,
    });
    let evidence: Evidence;
    try {
      evidence = await this.store.createEvidence({
        evidenceId,
        projectId: truth.attempt.projectId,
        stageSpecId: truth.attempt.stageSpecId,
        stepSpecId: truth.attempt.stepSpecId,
        attemptId: truth.attempt.attemptId,
        type: VERIFIER_EVIDENCE_TYPE,
        source: "AUTOMATION_EXECUTION_RECEIPT",
        producer: VERIFIER_PRODUCER,
        exitCode: decision === "PASS" ? 0 : 1,
        sha256: observed,
        artifactRefId: null,
        metadata: {
          decision,
          verificationClass: descriptor.policy.verificationClass,
          planVersionId: truth.plan.planVersionId,
          planPayloadSha256: truth.plan.payloadSha256!,
          expectedResultHash: expected,
          observedResultHash: observed,
        },
        correlation: {
          workflowActionId: truth.intent.intentId,
          requestId: truth.requestRef,
          nativeThreadId: null,
          nativeTurnId: truth.receipt.provider === "NATIVE" ? truth.requestRef : null,
          resourceLeaseId: null,
          artifactRefs: [],
          evidenceRefs: [],
        },
      });
    } catch (error) {
      const refreshed = await this.store.snapshot();
      const duplicate = existingDecision(refreshed, { ...truth, document: refreshed });
      if (!duplicate || duplicate.evidenceId !== evidenceId) throw error;
      evidence = duplicate;
    }
    return this.applyDecision({ ...truth, document: await this.store.snapshot() }, evidence, decision, expected, observed, descriptor.policy.verificationClass);
  }

  private async truth(input: VerifyStepInput): Promise<ExecutionTruth> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) throw new DeterministicVerifierError("VERIFIER_PROJECT_NOT_FOUND", `Automation Project was not found: ${input.projectId}`);
    const attempt = document.executionAttempts.find((item) => item.attemptId === input.executionAttemptId && item.projectId === input.projectId);
    if (!attempt) throw new DeterministicVerifierError("VERIFIER_ATTEMPT_NOT_FOUND", `ExecutionAttempt was not found: ${input.executionAttemptId}`);
    const runtime = document.stepRuntimes.find((item) => item.stepSpecId === attempt.stepSpecId);
    const stage = document.stageSpecs.find((item) => item.stageSpecId === attempt.stageSpecId);
    const plan = stage ? document.planVersions.find((item) => item.planVersionId === stage.planVersionId) : null;
    if (!runtime || !stage || !plan || plan.projectId !== project.projectId || stage.stageSpecId !== attempt.stageSpecId) {
      throw new DeterministicVerifierError("VERIFIER_CORRELATION_INVALID", "ExecutionAttempt, StepRuntime, StageSpec, and PlanVersion correlation is incomplete.");
    }
    const intent = executionAction(document, attempt.attemptId);
    const actionAttempt = intent ? latestAttempt(document, intent.intentId) : null;
    const receipt = actionAttempt ? document.actionReceipts.find((item) => item.actionAttemptId === actionAttempt.actionAttemptId) ?? null : null;
    const requestExternal = actionAttempt?.providerRequestRef ? document.externalRefs.find((item) => item.externalRefId === actionAttempt.providerRequestRef) ?? null : null;
    return { document, attempt, runtime, plan, intent, actionAttempt, receipt, requestRef: requestExternal?.opaqueId ?? null };
  }

  private async replayDecision(truth: ExecutionTruth, evidence: Evidence): Promise<DeterministicVerificationResult> {
    const decision = evidence.metadata.decision;
    if (decision !== "PASS" && decision !== "FAIL") throw new DeterministicVerifierError("VERIFIER_CORRELATION_INVALID", "Persisted verifier decision evidence has an unsupported decision value.");
    const expected = typeof evidence.metadata.expectedResultHash === "string" ? evidence.metadata.expectedResultHash : null;
    const observed = typeof evidence.metadata.observedResultHash === "string" ? evidence.metadata.observedResultHash : null;
    const verificationClass = typeof evidence.metadata.verificationClass === "string" ? evidence.metadata.verificationClass : null;
    return this.applyDecision(truth, evidence, decision, expected, observed, verificationClass);
  }

  private async applyDecision(
    truth: ExecutionTruth,
    evidence: Evidence,
    decision: "PASS" | "FAIL",
    expected: string | null,
    observed: string | null,
    verificationClass: string | null,
  ): Promise<DeterministicVerificationResult> {
    const current = await this.store.get("stepRuntimes", truth.runtime.stepRuntimeId);
    if (!current) throw new DeterministicVerifierError("VERIFIER_CORRELATION_INVALID", "StepRuntime disappeared while applying verifier decision.");
    if (decision === "PASS") {
      if (current.lifecycle === "VERIFYING") {
        await this.store.transitionStepRuntime(current.stepRuntimeId, "REVIEW", {
          actorType: "AUTOMATION",
          actorRef: VERIFIER_PRODUCER,
          correlationId: truth.intent?.intentId ?? truth.attempt.attemptId,
          causationId: evidence.evidenceId,
          boundedPayload: { verifierDecision: "PASS", evidenceId: evidence.evidenceId },
        });
      } else if (current.lifecycle !== "REVIEWING") {
        throw new DeterministicVerifierError("VERIFIER_STATE_CONFLICT", `PASS evidence cannot be applied from StepRuntime ${current.lifecycle}.`);
      }
    } else {
      if (current.lifecycle === "VERIFYING") {
        await this.store.transitionStepRuntime(current.stepRuntimeId, "FAIL", {
          actorType: "AUTOMATION",
          actorRef: VERIFIER_PRODUCER,
          correlationId: truth.intent?.intentId ?? truth.attempt.attemptId,
          causationId: evidence.evidenceId,
          boundedPayload: { verifierDecision: "FAIL", evidenceId: evidence.evidenceId },
        });
      } else if (current.lifecycle !== "TERMINAL" || current.terminalResult !== "FAILED") {
        throw new DeterministicVerifierError("VERIFIER_STATE_CONFLICT", `FAIL evidence cannot be applied from StepRuntime ${current.lifecycle}.`);
      }
    }
    return result({
      status: decision,
      truth,
      verificationClass,
      evidenceId: evidence.evidenceId,
      expectedResultHash: expected,
      observedResultHash: observed,
      reason: decision === "PASS" ? "Observed execution result hash matches immutable Plan verifier policy." : "Observed execution result hash does not match immutable Plan verifier policy.",
    });
  }
}
