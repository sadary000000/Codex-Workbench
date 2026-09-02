import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore } from "./store.ts";
import type {
  ActionAttempt,
  ActionIntent,
  ActionReceipt,
  AutomationDocument,
  Evidence,
  ExternalRef,
  PlanVersion,
  PlannerVerificationClass,
  StepRuntime,
  StepSpec,
} from "./types.ts";

const STEP_VERIFIER_PROTOCOL = "workbench-step-verifier-v1" as const;
const STEP_VERIFICATION_EVIDENCE = "STEP_VERIFICATION" as const;
const STEP_VERIFICATION_SOURCE = "WORKFLOW_TRUTH" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const HASH_MATCH_PLAN = /^result-sha256:([a-f0-9]{64})$/;
const VERIFICATION_CLASSES = new Set<PlannerVerificationClass>([
  "BUILD",
  "TEST",
  "GIT_DIFF",
  "GIT_STATUS",
  "FILE_EXISTS",
  "HASH_MATCH",
  "JSON_SCHEMA",
  "CLI_SMOKE",
  "HARDWARE_SMOKE",
  "CUSTOM_APPROVED",
]);

export type StepVerificationStatus =
  | "REVIEWING"
  | "FAILED"
  | "POLICY_MISSING"
  | "POLICY_INVALID"
  | "UNSUPPORTED_CLASS"
  | "NOT_READY";

export interface VerifyStepInput {
  readonly projectId: string;
  readonly executionAttemptId: string;
}

export interface StepVerificationResult {
  readonly status: StepVerificationStatus;
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly stepRuntimeId: string;
  readonly executionAttemptId: string;
  readonly planVersionId: string;
  readonly verificationClass: PlannerVerificationClass | null;
  readonly verificationEvidenceId: string | null;
  readonly expectedHash: string | null;
  readonly observedHash: string | null;
  readonly reason: string | null;
}

export class StepVerificationError extends Error {
  readonly code:
    | "STEP_VERIFICATION_PROJECT_NOT_FOUND"
    | "STEP_VERIFICATION_ATTEMPT_NOT_FOUND"
    | "STEP_VERIFICATION_CORRELATION_MISMATCH"
    | "STEP_VERIFICATION_PLAN_NOT_ACTIVE"
    | "STEP_VERIFICATION_PLAN_TRUTH_INVALID"
    | "STEP_VERIFICATION_NOT_VERIFYING";

  constructor(code: StepVerificationError["code"], message: string) {
    super(message);
    this.name = "StepVerificationError";
    this.code = code;
  }
}

interface VerificationPolicy {
  readonly verificationClass: PlannerVerificationClass;
  readonly verificationPlan: readonly string[];
  readonly expectedArtifacts: readonly string[];
}

type PolicyRead =
  | { readonly status: "OK"; readonly policy: VerificationPolicy }
  | { readonly status: "MISSING"; readonly reason: string }
  | { readonly status: "INVALID"; readonly verificationClass: PlannerVerificationClass | null; readonly reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

function policyFromDescriptor(input: {
  readonly verificationClass?: unknown;
  readonly verificationPlan?: unknown;
  readonly expectedArtifacts?: unknown;
}, source: "StepSpec" | "PlanVersion"): PolicyRead {
  const hasDescriptor = input.verificationClass !== undefined
    || input.verificationPlan !== undefined
    || input.expectedArtifacts !== undefined;
  if (!hasDescriptor) return { status: "MISSING", reason: `${source} has no verifier descriptor.` };

  const verificationClass = typeof input.verificationClass === "string"
    && VERIFICATION_CLASSES.has(input.verificationClass as PlannerVerificationClass)
    ? input.verificationClass as PlannerVerificationClass
    : null;
  const verificationPlan = stringList(input.verificationPlan);
  const expectedArtifacts = input.expectedArtifacts === undefined ? [] : stringList(input.expectedArtifacts);
  if (!verificationClass || !verificationPlan || verificationPlan.length === 0 || !expectedArtifacts) {
    return { status: "INVALID", verificationClass, reason: `${source} verifier descriptor is incomplete or malformed.` };
  }
  return { status: "OK", policy: { verificationClass, verificationPlan, expectedArtifacts } };
}

function readPolicy(plan: PlanVersion, step: StepSpec): PolicyRead {
  const stepPolicy = policyFromDescriptor(step, "StepSpec");
  if (stepPolicy.status !== "OK") return stepPolicy;

  // StepSpec is the operational authority. Structured Plan truth, when
  // present, is immutable provenance and must agree exactly; it is
  // never used to fill a missing StepSpec policy.
  if (!plan.canonicalPayload && !plan.payloadSha256) return stepPolicy;
  if (!plan.canonicalPayload || !plan.payloadSha256 || sha256Hex(plan.canonicalPayload) !== plan.payloadSha256) {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion canonicalPayload integrity does not match payloadSha256.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plan.canonicalPayload);
  } catch {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion canonicalPayload is not valid JSON.",
    );
  }
  const root = record(parsed);
  const steps = root && Array.isArray(root.steps) ? root.steps : null;
  if (!steps) {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion canonicalPayload has no Step candidates.",
    );
  }
  const entry = steps.map(record).find((item) => item?.stepSpecId === step.stepSpecId) ?? null;
  if (!entry || entry.stageSpecId !== step.stageSpecId || entry.stepKey !== step.stepKey || entry.specVersion !== step.specVersion) {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion verifier provenance does not correlate to the exact StepSpec identity.",
    );
  }
  const planPolicy = policyFromDescriptor(entry, "PlanVersion");
  if (planPolicy.status !== "OK" || policySha256(planPolicy.policy) !== policySha256(stepPolicy.policy)) {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion verifier provenance does not match the authoritative StepSpec policy.",
    );
  }
  return stepPolicy;
}

function policySha256(policy: VerificationPolicy): string {
  return sha256Hex(canonicalize({
    expectedArtifacts: [...policy.expectedArtifacts],
    verificationClass: policy.verificationClass,
    verificationPlan: [...policy.verificationPlan],
  }, "stepVerificationPolicy"));
}

function actionForAttempt(document: AutomationDocument, executionAttemptId: string): ActionIntent | null {
  return document.actionIntents.find(
    (item) => item.actionType === "STEP_EXECUTION" && item.attemptId === executionAttemptId,
  ) ?? null;
}

function latestActionAttempt(document: AutomationDocument, intentId: string): ActionAttempt | null {
  return document.actionAttempts
    .filter((item) => item.intentId === intentId)
    .sort((left, right) => right.dispatchNumber - left.dispatchNumber)[0] ?? null;
}

function receiptFor(document: AutomationDocument, actionAttemptId: string): ActionReceipt | null {
  return document.actionReceipts.find((item) => item.actionAttemptId === actionAttemptId) ?? null;
}

function requestExternal(document: AutomationDocument, actionAttempt: ActionAttempt): ExternalRef | null {
  if (!actionAttempt.providerRequestRef) return null;
  return document.externalRefs.find((item) => item.externalRefId === actionAttempt.providerRequestRef) ?? null;
}

function verificationEvidence(document: AutomationDocument, executionAttemptId: string): Evidence | null {
  return document.evidences.find(
    (item) => item.type === STEP_VERIFICATION_EVIDENCE
      && item.attemptId === executionAttemptId
      && item.producer === STEP_VERIFIER_PROTOCOL,
  ) ?? null;
}

function result(input: {
  status: StepVerificationStatus;
  projectId: string;
  stageSpecId: string;
  stepSpecId: string;
  runtime: StepRuntime;
  executionAttemptId: string;
  planVersionId: string;
  verificationClass: PlannerVerificationClass | null;
  verificationEvidenceId?: string | null;
  expectedHash?: string | null;
  observedHash?: string | null;
  reason?: string | null;
}): StepVerificationResult {
  return {
    status: input.status,
    projectId: input.projectId,
    stageSpecId: input.stageSpecId,
    stepSpecId: input.stepSpecId,
    stepRuntimeId: input.runtime.stepRuntimeId,
    executionAttemptId: input.executionAttemptId,
    planVersionId: input.planVersionId,
    verificationClass: input.verificationClass,
    verificationEvidenceId: input.verificationEvidenceId ?? null,
    expectedHash: input.expectedHash ?? null,
    observedHash: input.observedHash ?? null,
    reason: input.reason ?? null,
  };
}

/**
 * Deterministic workflow verifier over already-persisted truth only.
 *
 * It never opens a Native Turn, invokes a provider, executes shell text,
 * reads a transcript, or owns a sandbox. v1 auto-verifies HASH_MATCH by
 * comparing immutable Plan policy to the terminal-confirmed Step receipt hash.
 * Other verifier classes remain fail-closed in VERIFYING until a dedicated
 * evidence adapter exists.
 */
export class DeterministicStepVerificationService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async verify(input: VerifyStepInput): Promise<StepVerificationResult> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) {
      throw new StepVerificationError(
        "STEP_VERIFICATION_PROJECT_NOT_FOUND",
        `AutomationProject was not found: ${input.projectId}`,
      );
    }

    const attempt = document.executionAttempts.find((item) => item.attemptId === input.executionAttemptId);
    if (!attempt || attempt.projectId !== input.projectId) {
      throw new StepVerificationError(
        "STEP_VERIFICATION_ATTEMPT_NOT_FOUND",
        `ExecutionAttempt was not found for project: ${input.executionAttemptId}`,
      );
    }

    const step = document.stepSpecs.find((item) => item.stepSpecId === attempt.stepSpecId);
    const stage = step ? document.stageSpecs.find((item) => item.stageSpecId === step.stageSpecId) : null;
    const plan = stage ? document.planVersions.find((item) => item.planVersionId === stage.planVersionId) : null;
    const runtime = document.stepRuntimes.find((item) => item.stepSpecId === attempt.stepSpecId);
    if (!step || !stage || !plan || !runtime || stage.stageSpecId !== attempt.stageSpecId || runtime.currentAttemptId !== attempt.attemptId) {
      throw new StepVerificationError(
        "STEP_VERIFICATION_CORRELATION_MISMATCH",
        "ExecutionAttempt, StepRuntime, StepSpec, StageSpec, and PlanVersion identities do not correlate.",
      );
    }
    if (plan.projectId !== input.projectId || plan.status !== "ACTIVE" || project.activePlanVersionId !== plan.planVersionId) {
      throw new StepVerificationError(
        "STEP_VERIFICATION_PLAN_NOT_ACTIVE",
        "Verifier refuses to advance a Step from a non-active PlanVersion.",
      );
    }

    const policyRead = readPolicy(plan, step);
    if (policyRead.status === "MISSING") {
      return result({
        status: "POLICY_MISSING",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: null,
        reason: policyRead.reason,
      });
    }
    if (policyRead.status === "INVALID") {
      return result({
        status: "POLICY_INVALID",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policyRead.verificationClass,
        reason: policyRead.reason,
      });
    }

    const policy = policyRead.policy;
    const planPayloadSha256 = plan.payloadSha256;
    if (!planPayloadSha256) {
      throw new StepVerificationError(
        "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
        "Structured verifier policy requires PlanVersion.payloadSha256.",
      );
    }
    const fingerprint = policySha256(policy);
    const existing = verificationEvidence(document, attempt.attemptId);
    if (existing) {
      if (existing.metadata.policySha256 !== fingerprint || existing.metadata.planPayloadSha256 !== planPayloadSha256) {
        throw new StepVerificationError(
          "STEP_VERIFICATION_CORRELATION_MISMATCH",
          "Existing Step verification Evidence is bound to a different immutable policy.",
        );
      }
      const outcome = existing.metadata.outcome;
      const expectedHash = typeof existing.metadata.expectedHash === "string" ? existing.metadata.expectedHash : null;
      const observedHash = typeof existing.metadata.observedHash === "string" ? existing.metadata.observedHash : null;
      if (outcome === "PASS") {
        if (runtime.lifecycle === "VERIFYING") {
          await this.store.transitionStepRuntime(runtime.stepRuntimeId, "REVIEW", {
            actorType: "AUTOMATION",
            actorRef: STEP_VERIFIER_PROTOCOL,
            boundedPayload: { evidenceId: existing.evidenceId, verificationClass: policy.verificationClass, outcome: "PASS" },
            correlationId: attempt.attemptId,
            causationId: existing.evidenceId,
          });
        } else if (runtime.lifecycle !== "REVIEWING") {
          throw new StepVerificationError(
            "STEP_VERIFICATION_CORRELATION_MISMATCH",
            "PASS Evidence does not match the current StepRuntime lifecycle.",
          );
        }
        return result({
          status: "REVIEWING",
          projectId: input.projectId,
          stageSpecId: stage.stageSpecId,
          stepSpecId: step.stepSpecId,
          runtime,
          executionAttemptId: attempt.attemptId,
          planVersionId: plan.planVersionId,
          verificationClass: policy.verificationClass,
          verificationEvidenceId: existing.evidenceId,
          expectedHash,
          observedHash,
        });
      }
      if (outcome === "FAIL") {
        if (runtime.lifecycle === "VERIFYING") {
          await this.store.transitionStepRuntime(runtime.stepRuntimeId, "FAIL", {
            actorType: "AUTOMATION",
            actorRef: STEP_VERIFIER_PROTOCOL,
            boundedPayload: { evidenceId: existing.evidenceId, verificationClass: policy.verificationClass, outcome: "FAIL" },
            correlationId: attempt.attemptId,
            causationId: existing.evidenceId,
          });
        } else if (runtime.lifecycle !== "TERMINAL" || runtime.terminalResult !== "FAILED") {
          throw new StepVerificationError(
            "STEP_VERIFICATION_CORRELATION_MISMATCH",
            "FAIL Evidence does not match the current StepRuntime lifecycle.",
          );
        }
        return result({
          status: "FAILED",
          projectId: input.projectId,
          stageSpecId: stage.stageSpecId,
          stepSpecId: step.stepSpecId,
          runtime,
          executionAttemptId: attempt.attemptId,
          planVersionId: plan.planVersionId,
          verificationClass: policy.verificationClass,
          verificationEvidenceId: existing.evidenceId,
          expectedHash,
          observedHash,
        });
      }
      throw new StepVerificationError(
        "STEP_VERIFICATION_CORRELATION_MISMATCH",
        "Existing Step verification Evidence has an unsupported outcome.",
      );
    }

    if (runtime.lifecycle !== "VERIFYING") {
      throw new StepVerificationError(
        "STEP_VERIFICATION_NOT_VERIFYING",
        `StepRuntime is not eligible for deterministic verification: ${runtime.lifecycle}.`,
      );
    }
    if (attempt.lifecycle !== "COMPLETED" || attempt.terminalResult !== "COMPLETED") {
      return result({
        status: "NOT_READY",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policy.verificationClass,
        reason: "ExecutionAttempt is not terminal-successful.",
      });
    }
    if (policy.verificationClass !== "HASH_MATCH") {
      return result({
        status: "UNSUPPORTED_CLASS",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policy.verificationClass,
        reason: `Verifier class ${policy.verificationClass} has no side-effect-free v1 evidence adapter.`,
      });
    }
    if (policy.verificationPlan.length !== 1) {
      return result({
        status: "POLICY_INVALID",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policy.verificationClass,
        reason: "HASH_MATCH requires exactly one result-sha256:<hash> instruction.",
      });
    }

    const match = HASH_MATCH_PLAN.exec(policy.verificationPlan[0]!);
    if (!match) {
      return result({
        status: "POLICY_INVALID",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policy.verificationClass,
        reason: "HASH_MATCH instructions are data, not executable text; expected result-sha256:<64 lowercase hex>.",
      });
    }

    const expectedHash = match[1]!;
    const intent = actionForAttempt(document, attempt.attemptId);
    const actionAttempt = intent ? latestActionAttempt(document, intent.intentId) : null;
    const receipt = actionAttempt ? receiptFor(document, actionAttempt.actionAttemptId) : null;
    if (!intent || !actionAttempt || !receipt || receipt.status !== "SUCCEEDED"
      || receipt.outcomeCertainty !== "TERMINAL_CONFIRMED" || !receipt.resultHash || !SHA256.test(receipt.resultHash)) {
      return result({
        status: "NOT_READY",
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        verificationClass: policy.verificationClass,
        expectedHash,
        reason: "No terminal-confirmed successful STEP_EXECUTION receipt hash is available.",
      });
    }

    const observedHash = receipt.resultHash;
    const outcome = observedHash === expectedHash ? "PASS" as const : "FAIL" as const;
    const evidenceId = `step-verification:${sha256Hex(
      `${STEP_VERIFIER_PROTOCOL}\u0000${attempt.attemptId}\u0000${planPayloadSha256}\u0000${fingerprint}`,
    )}`;
    const external = requestExternal(document, actionAttempt);
    const evidence = await this.store.createEvidence({
      evidenceId,
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      attemptId: attempt.attemptId,
      type: STEP_VERIFICATION_EVIDENCE,
      source: STEP_VERIFICATION_SOURCE,
      producer: STEP_VERIFIER_PROTOCOL,
      exitCode: null,
      sha256: observedHash,
      artifactRefId: null,
      metadata: {
        expectedHash,
        observedHash,
        outcome,
        planPayloadSha256,
        planVersionId: plan.planVersionId,
        policySha256: fingerprint,
        verificationClass: policy.verificationClass,
        verifierProtocol: STEP_VERIFIER_PROTOCOL,
      },
      correlation: {
        workflowActionId: intent.intentId,
        requestId: null,
        nativeThreadId: null,
        nativeTurnId: external?.kind === "NATIVE_TURN" && external.provider === "NATIVE" ? external.opaqueId : null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [],
      },
    });

    await this.store.transitionStepRuntime(runtime.stepRuntimeId, outcome === "PASS" ? "REVIEW" : "FAIL", {
      actorType: "AUTOMATION",
      actorRef: STEP_VERIFIER_PROTOCOL,
      boundedPayload: { evidenceId: evidence.evidenceId, verificationClass: policy.verificationClass, outcome },
      correlationId: attempt.attemptId,
      causationId: evidence.evidenceId,
    });

    return result({
      status: outcome === "PASS" ? "REVIEWING" : "FAILED",
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      runtime,
      executionAttemptId: attempt.attemptId,
      planVersionId: plan.planVersionId,
      verificationClass: policy.verificationClass,
      verificationEvidenceId: evidence.evidenceId,
      expectedHash,
      observedHash,
    });
  }
}
