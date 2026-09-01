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

export type WorkspaceFileObservationStatus = "EXISTS" | "MISSING" | "INVALID" | "UNAVAILABLE";

export interface WorkspaceFileObservation {
  readonly status: WorkspaceFileObservationStatus;
  readonly relativePath: string;
  readonly reason: string | null;
}

/**
 * Read-only adapter owned by the process that already owns Native runtime/workspace truth.
 * The verifier never executes shell text or starts a model turn through this port.
 */
export interface WorkspaceFileVerificationPort {
  observeFile(input: {
    readonly providerTargetRef: string;
    readonly relativePath: string;
  }): Promise<WorkspaceFileObservation>;
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

function readPolicy(plan: PlanVersion, step: StepSpec): PolicyRead {
  if (!plan.canonicalPayload || !plan.payloadSha256) {
    return { status: "MISSING", reason: "The active PlanVersion predates structured verifier policy truth." };
  }
  if (sha256Hex(plan.canonicalPayload) !== plan.payloadSha256) {
    throw new StepVerificationError(
      "STEP_VERIFICATION_PLAN_TRUTH_INVALID",
      "PlanVersion canonicalPayload hash does not match payloadSha256.",
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
      "Persisted verifier policy does not correlate to the exact StepSpec identity.",
    );
  }

  const hasDescriptor = entry.verificationClass !== undefined
    || entry.verificationPlan !== undefined
    || entry.expectedArtifacts !== undefined;
  if (!hasDescriptor) {
    return { status: "MISSING", reason: "The exact Step has no persisted verifier descriptor." };
  }

  const verificationClass = typeof entry.verificationClass === "string"
    && VERIFICATION_CLASSES.has(entry.verificationClass as PlannerVerificationClass)
    ? entry.verificationClass as PlannerVerificationClass
    : null;
  const verificationPlan = stringList(entry.verificationPlan);
  const expectedArtifacts = entry.expectedArtifacts === undefined ? [] : stringList(entry.expectedArtifacts);
  if (!verificationClass || !verificationPlan || verificationPlan.length === 0 || !expectedArtifacts) {
    return {
      status: "INVALID",
      verificationClass,
      reason: "The persisted verifier descriptor is incomplete or malformed.",
    };
  }

  return { status: "OK", policy: { verificationClass, verificationPlan, expectedArtifacts } };
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
 * It never opens a Native Turn, invokes a provider, executes shell text, or
 * owns a sandbox. v0.1 supports HASH_MATCH over terminal receipt truth and a
 * bounded FILE_EXISTS adapter over the exact Native workspace. Every other
 * verifier class remains fail-closed in VERIFYING until a dedicated adapter
 * exists.
 */
export class DeterministicStepVerificationService {
  readonly store: AutomationStore;
  readonly workspaceFiles: WorkspaceFileVerificationPort | null;

  constructor(options: {
    readonly store: AutomationStore;
    readonly workspaceFiles?: WorkspaceFileVerificationPort | null;
  }) {
    this.store = options.store;
    this.workspaceFiles = options.workspaceFiles ?? null;
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
      const existingReason = typeof existing.metadata.reason === "string" ? existing.metadata.reason : null;
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
          reason: existingReason,
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
          reason: existingReason,
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

    if (policy.verificationClass === "FILE_EXISTS") {
      return this.verifyFileExists({
        document,
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        planPayloadSha256,
        policy,
        fingerprint,
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
        reason: `Verifier class ${policy.verificationClass} has no side-effect-free v0.1 evidence adapter.`,
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

  private async verifyFileExists(input: {
    readonly document: AutomationDocument;
    readonly projectId: string;
    readonly stageSpecId: string;
    readonly stepSpecId: string;
    readonly runtime: StepRuntime;
    readonly executionAttemptId: string;
    readonly planVersionId: string;
    readonly planPayloadSha256: string;
    readonly policy: VerificationPolicy;
    readonly fingerprint: string;
  }): Promise<StepVerificationResult> {
    if (input.policy.expectedArtifacts.length === 0) {
      return result({
        status: "POLICY_INVALID",
        projectId: input.projectId,
        stageSpecId: input.stageSpecId,
        stepSpecId: input.stepSpecId,
        runtime: input.runtime,
        executionAttemptId: input.executionAttemptId,
        planVersionId: input.planVersionId,
        verificationClass: "FILE_EXISTS",
        reason: "FILE_EXISTS requires at least one workspace-relative expectedArtifacts path.",
      });
    }
    if (!this.workspaceFiles) {
      return result({
        status: "NOT_READY",
        projectId: input.projectId,
        stageSpecId: input.stageSpecId,
        stepSpecId: input.stepSpecId,
        runtime: input.runtime,
        executionAttemptId: input.executionAttemptId,
        planVersionId: input.planVersionId,
        verificationClass: "FILE_EXISTS",
        reason: "The read-only workspace file verification adapter is unavailable.",
      });
    }

    const intent = actionForAttempt(input.document, input.executionAttemptId);
    if (!intent?.targetRef) {
      return result({
        status: "NOT_READY",
        projectId: input.projectId,
        stageSpecId: input.stageSpecId,
        stepSpecId: input.stepSpecId,
        runtime: input.runtime,
        executionAttemptId: input.executionAttemptId,
        planVersionId: input.planVersionId,
        verificationClass: "FILE_EXISTS",
        reason: "FILE_EXISTS requires the exact persisted STEP_EXECUTION targetRef.",
      });
    }

    const observations = await Promise.all(input.policy.expectedArtifacts.map((relativePath) =>
      this.workspaceFiles!.observeFile({ providerTargetRef: intent.targetRef!, relativePath })));
    const invalid = observations.find((item) => item.status === "INVALID");
    if (invalid) {
      return result({
        status: "POLICY_INVALID",
        projectId: input.projectId,
        stageSpecId: input.stageSpecId,
        stepSpecId: input.stepSpecId,
        runtime: input.runtime,
        executionAttemptId: input.executionAttemptId,
        planVersionId: input.planVersionId,
        verificationClass: "FILE_EXISTS",
        reason: invalid.reason ?? `Invalid expected artifact path: ${invalid.relativePath}`,
      });
    }
    const unavailable = observations.find((item) => item.status === "UNAVAILABLE");
    if (unavailable) {
      return result({
        status: "NOT_READY",
        projectId: input.projectId,
        stageSpecId: input.stageSpecId,
        stepSpecId: input.stepSpecId,
        runtime: input.runtime,
        executionAttemptId: input.executionAttemptId,
        planVersionId: input.planVersionId,
        verificationClass: "FILE_EXISTS",
        reason: unavailable.reason ?? `Workspace observation unavailable: ${unavailable.relativePath}`,
      });
    }

    const outcome = observations.every((item) => item.status === "EXISTS") ? "PASS" as const : "FAIL" as const;
    const missing = observations.filter((item) => item.status === "MISSING").map((item) => item.relativePath);
    const observationDescriptor = canonicalize({
      expectedArtifacts: [...input.policy.expectedArtifacts],
      observations: observations.map((item) => ({ relativePath: item.relativePath, status: item.status })),
      providerTargetRef: intent.targetRef,
    }, "workspaceFileVerification");
    const observedHash = sha256Hex(observationDescriptor);
    const reason = outcome === "PASS"
      ? `Verified ${observations.length} expected workspace file(s).`
      : `Missing expected workspace file(s): ${missing.join(", ")}`;
    const evidenceId = `step-verification:${sha256Hex(
      `${STEP_VERIFIER_PROTOCOL}\u0000${input.executionAttemptId}\u0000${input.planPayloadSha256}\u0000${input.fingerprint}`,
    )}`;
    const actionAttempt = latestActionAttempt(input.document, intent.intentId);
    const external = actionAttempt ? requestExternal(input.document, actionAttempt) : null;
    const evidence = await this.store.createEvidence({
      evidenceId,
      projectId: input.projectId,
      stageSpecId: input.stageSpecId,
      stepSpecId: input.stepSpecId,
      attemptId: input.executionAttemptId,
      type: STEP_VERIFICATION_EVIDENCE,
      source: STEP_VERIFICATION_SOURCE,
      producer: STEP_VERIFIER_PROTOCOL,
      exitCode: null,
      sha256: observedHash,
      artifactRefId: null,
      metadata: {
        expectedArtifactsJson: JSON.stringify(input.policy.expectedArtifacts),
        observedArtifactsJson: JSON.stringify(observations.map((item) => ({ path: item.relativePath, status: item.status }))),
        observedHash,
        outcome,
        planPayloadSha256: input.planPayloadSha256,
        planVersionId: input.planVersionId,
        policySha256: input.fingerprint,
        reason,
        verificationClass: "FILE_EXISTS",
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

    await this.store.transitionStepRuntime(input.runtime.stepRuntimeId, outcome === "PASS" ? "REVIEW" : "FAIL", {
      actorType: "AUTOMATION",
      actorRef: STEP_VERIFIER_PROTOCOL,
      boundedPayload: { evidenceId: evidence.evidenceId, verificationClass: "FILE_EXISTS", outcome },
      correlationId: input.executionAttemptId,
      causationId: evidence.evidenceId,
    });

    return result({
      status: outcome === "PASS" ? "REVIEWING" : "FAILED",
      projectId: input.projectId,
      stageSpecId: input.stageSpecId,
      stepSpecId: input.stepSpecId,
      runtime: input.runtime,
      executionAttemptId: input.executionAttemptId,
      planVersionId: input.planVersionId,
      verificationClass: "FILE_EXISTS",
      verificationEvidenceId: evidence.evidenceId,
      observedHash,
      reason,
    });
  }
}
