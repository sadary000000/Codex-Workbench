import { randomUUID } from "node:crypto";
import { AutomationStore, AutomationStoreError, type ActionReceiptInput } from "./store.ts";
import {
  encodeProviderReferenceOpaqueId,
  isProviderReference,
  providerReferenceCarrierKind,
  providerReferenceOpaqueId,
  readProviderReference,
  type ProviderReferenceRole,
} from "./provider-reference.ts";
import type {
  ActionAttempt,
  ActionIntent,
  ActionOutcomeCertainty,
  ActionReceipt,
  AutomationDocument,
  ExternalRef,
  RecoveryState,
} from "./types.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(): string {
  return new Date().toISOString();
}

function optionalText(value: string | null | undefined, field: string, max = 4_096): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must be bounded and non-empty.`);
  return normalized;
}

function boundedList(value: string[] | undefined, field: string): string[] {
  if (!value) return [];
  if (value.length > 128 || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) {
    throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must contain bounded references.`);
  }
  return [...new Set(value)];
}

function compatibleRef(ref: ExternalRef, input: { projectId: string; provider: string; role: ProviderReferenceRole; providerOpaqueId: string }): boolean {
  const decoded = readProviderReference(ref);
  return ref.projectId === input.projectId
    && ref.provider === input.provider
    && decoded?.role === input.role
    && decoded.providerOpaqueId === input.providerOpaqueId;
}

function createNeutralRef(input: {
  projectId: string;
  provider: string;
  role: ProviderReferenceRole;
  providerOpaqueId: string;
}): ExternalRef {
  let opaqueId: string;
  try {
    opaqueId = encodeProviderReferenceOpaqueId(input.role, input.providerOpaqueId);
  } catch (error) {
    throw new AutomationStoreError("AUTOMATION_INVALID", error instanceof Error ? error.message : "Provider reference is invalid.", error);
  }
  return {
    externalRefId: randomUUID(),
    projectId: input.projectId,
    kind: providerReferenceCarrierKind(input.role),
    provider: optionalText(input.provider, "externalRef.provider", 256)!,
    opaqueId,
    createdAt: now(),
  };
}

function compatibilityProjection(ref: ExternalRef): ExternalRef {
  const decoded = readProviderReference(ref);
  if (!decoded || decoded.format !== "NEUTRAL_V1") return ref;
  return { ...ref, opaqueId: decoded.providerOpaqueId };
}

function assertProviderRefs(intent: ActionIntent, attempt: ActionAttempt, requestRef: ExternalRef | null, observationRef: ExternalRef | null): void {
  if (requestRef) {
    if (requestRef.projectId !== intent.projectId || !isProviderReference(requestRef, "REQUEST")) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request ExternalRef is outside the ActionIntent project or has the wrong role.");
    }
    if (attempt.providerRequestRef && attempt.providerRequestRef !== requestRef.externalRefId) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request ExternalRef does not match the ActionAttempt correlation.");
    }
  }
  if (observationRef) {
    if (observationRef.projectId !== intent.projectId || !isProviderReference(observationRef, "OBSERVATION")) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation ExternalRef is outside the ActionIntent project or has the wrong role.");
    }
    if (attempt.providerObservationRef && attempt.providerObservationRef !== observationRef.externalRefId) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation ExternalRef does not match the ActionAttempt correlation.");
    }
  }
  if (requestRef && observationRef) {
    if (requestRef.provider !== observationRef.provider) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request and observation references use different providers.");
    const requestOpaque = providerReferenceOpaqueId(requestRef, "REQUEST");
    const observationOpaque = providerReferenceOpaqueId(observationRef, "OBSERVATION");
    if (!requestOpaque || !observationOpaque || requestOpaque !== observationOpaque) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation does not identify the correlated provider request.");
    }
  }
}

/**
 * Provider-neutral persistence on the frozen Automation v4 schema.
 *
 * v4's WEBGPT_PROVIDER_* kind values are treated only as compatibility
 * carriers. New rows put provider identity in ExternalRef.provider and a
 * versioned neutral role/opaque-id envelope in ExternalRef.opaqueId. Existing
 * legacy rows remain valid and are reused without rewriting.
 *
 * snapshotProviderTruth() exposes the physical neutral envelope. snapshot()
 * returns a compatibility projection so pre-R2 consumers continue to receive
 * the original raw provider request id until those consumers are migrated.
 */
export class ProviderNeutralAutomationStore extends AutomationStore {
  async snapshotProviderTruth(): Promise<AutomationDocument> {
    return super.snapshot();
  }

  override async snapshot(): Promise<AutomationDocument> {
    const document = await super.snapshot();
    return { ...document, externalRefs: document.externalRefs.map((ref) => compatibilityProjection(ref)) };
  }

  override async persistActionAttemptProviderRequest(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerRequestRef: string;
    providerSemanticSha256?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request project does not match the ActionIntent project.");
      const providerRequestRef = optionalText(input.providerRequestRef, "externalRef.opaqueId", 384)!;
      const existing = tx.table("externalRefs").find((ref) => compatibleRef(ref, {
        projectId: input.projectId,
        provider: input.provider,
        role: "REQUEST",
        providerOpaqueId: providerRequestRef,
      }));
      const externalRef = existing ?? createNeutralRef({ projectId: input.projectId, provider: input.provider, role: "REQUEST", providerOpaqueId: providerRequestRef });
      if (!existing) tx.insert("externalRefs", externalRef);
      const requestOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerRequestRef === externalRef.externalRefId);
      if (requestOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request ExternalRef is already attached to another ActionAttempt.");
      assertProviderRefs(intent, attempt, externalRef, null);
      const updated: ActionAttempt = {
        ...attempt,
        providerRequestRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({
        projectId: intent.projectId,
        entityType: "ActionAttempt",
        entityId: attempt.actionAttemptId,
        eventType: "PROVIDER_REQUEST_PERSISTED",
        actorType: "AUTOMATION",
        actorRef: null,
        boundedPayload: { providerRequestRef: externalRef.externalRefId, providerRefFormat: "provider-neutral-v1" },
        correlationId: intent.intentId,
        causationId: null,
      });
      return { externalRef: clone(externalRef), attempt: clone(updated) };
    });
  }

  override async persistActionAttemptProviderObservation(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerObservationRef: string;
    providerRequestExternalRef?: string | null;
    providerSemanticSha256?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation project does not match the ActionIntent project.");
      const requestExternalRefId = input.providerRequestExternalRef ?? attempt.providerRequestRef;
      const requestExternalRef = requestExternalRefId ? tx.require("externalRefs", requestExternalRefId) : null;
      const providerObservationRef = optionalText(input.providerObservationRef, "externalRef.opaqueId", 384)!;
      const existing = tx.table("externalRefs").find((ref) => compatibleRef(ref, {
        projectId: input.projectId,
        provider: input.provider,
        role: "OBSERVATION",
        providerOpaqueId: providerObservationRef,
      }));
      const externalRef = existing ?? createNeutralRef({ projectId: input.projectId, provider: input.provider, role: "OBSERVATION", providerOpaqueId: providerObservationRef });
      if (!existing) tx.insert("externalRefs", externalRef);
      assertProviderRefs(intent, attempt, requestExternalRef, externalRef);
      const observationOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerObservationRef === externalRef.externalRefId);
      if (observationOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation ExternalRef is already attached to another ActionAttempt.");
      const updated: ActionAttempt = {
        ...attempt,
        providerRequestRef: requestExternalRef?.externalRefId ?? attempt.providerRequestRef ?? null,
        providerObservationRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({
        projectId: intent.projectId,
        entityType: "ActionAttempt",
        entityId: attempt.actionAttemptId,
        eventType: "PROVIDER_OBSERVATION_PERSISTED",
        actorType: "AUTOMATION",
        actorRef: null,
        boundedPayload: { providerObservationRef: externalRef.externalRefId, providerRefFormat: "provider-neutral-v1" },
        correlationId: intent.intentId,
        causationId: null,
      });
      return { externalRef: clone(externalRef), attempt: clone(updated) };
    });
  }

  override async recordAcceptedProviderUnknown(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerRequestRef: string;
    providerSemanticSha256?: string | null;
    externalStatus?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt; receipt: ActionReceipt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Accepted provider request project does not match the ActionIntent project.");
      const existingReceipt = tx.table("actionReceipts").find((receipt) => receipt.actionAttemptId === input.actionAttemptId);
      if (existingReceipt) {
        const existingExternal = existingReceipt.providerRequestRef ? tx.require("externalRefs", existingReceipt.providerRequestRef) : null;
        if (!existingExternal || !isProviderReference(existingExternal, "REQUEST")) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Existing ActionReceipt lacks its accepted provider request reference.");
        return { externalRef: clone(existingExternal), attempt: clone(attempt), receipt: clone(existingReceipt) };
      }
      const rawRequestRef = optionalText(input.providerRequestRef, "externalRef.opaqueId", 384)!;
      const existingExternal = tx.table("externalRefs").find((ref) => compatibleRef(ref, {
        projectId: input.projectId,
        provider: input.provider,
        role: "REQUEST",
        providerOpaqueId: rawRequestRef,
      }));
      const externalRef = existingExternal ?? createNeutralRef({ projectId: input.projectId, provider: input.provider, role: "REQUEST", providerOpaqueId: rawRequestRef });
      if (!existingExternal) tx.insert("externalRefs", externalRef);
      const requestOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerRequestRef === externalRef.externalRefId);
      if (requestOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Accepted provider request ExternalRef is already attached to another ActionAttempt.");
      assertProviderRefs(intent, attempt, externalRef, null);
      const updatedAttempt: ActionAttempt = {
        ...attempt,
        providerRequestRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
        state: "UNCERTAIN",
        recoveryState: "RECOVERY_REQUIRED",
      };
      tx.replace("actionAttempts", updatedAttempt);
      const receipt: ActionReceipt = {
        receiptId: randomUUID(),
        actionAttemptId: input.actionAttemptId,
        status: "UNKNOWN",
        externalStatus: optionalText(input.externalStatus ?? "ACCEPTED_UNKNOWN_RESULT", "receipt.externalStatus", 256),
        exitCode: null,
        resultHash: null,
        externalRefs: [externalRef.externalRefId],
        createdAt: now(),
        reconcileState: "RECOVERY_REQUIRED",
        provider: optionalText(input.provider, "receipt.provider", 256),
        providerRequestRef: externalRef.externalRefId,
        providerObservationRef: null,
        outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
        evidenceRefs: [],
      };
      tx.insert("actionReceipts", receipt);
      tx.replace("actionIntents", { ...intent, state: "UNCERTAIN" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: attempt.actionAttemptId, eventType: "ACCEPTED_PROVIDER_UNKNOWN_PERSISTED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { providerRequestRef: externalRef.externalRefId, providerRefFormat: "provider-neutral-v1" }, correlationId: intent.intentId, causationId: null });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: receipt.receiptId, eventType: "ACTION_RECEIPT_RECORDED", actorType: "SYSTEM", actorRef: null, boundedPayload: { status: receipt.status, reconcileState: receipt.reconcileState }, correlationId: intent.intentId, causationId: null });
      return { externalRef: clone(externalRef), attempt: clone(updatedAttempt), receipt: clone(receipt) };
    });
  }

  override async createActionReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (tx.table("actionReceipts").some((receipt) => receipt.actionAttemptId === input.actionAttemptId)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "An ActionReceipt already exists for this ActionAttempt.");
      if (input.status === "UNKNOWN" && input.reconcileState !== undefined && input.reconcileState !== "RECOVERY_REQUIRED") throw new AutomationStoreError("AUTOMATION_CONFLICT", "An UNKNOWN ActionReceipt must remain in RECOVERY_REQUIRED state.");
      const reconcileState = input.status === "UNKNOWN" ? "RECOVERY_REQUIRED" : input.reconcileState ?? "NOT_REQUIRED";
      const defaultCertainty: ActionOutcomeCertainty = input.status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : input.status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME";
      const providerRequestRef = optionalText(input.providerRequestRef, "receipt.providerRequestRef", 256);
      const providerObservationRef = optionalText(input.providerObservationRef, "receipt.providerObservationRef", 256);
      const requestExternal = providerRequestRef ? tx.require("externalRefs", providerRequestRef) : null;
      const observationExternal = providerObservationRef ? tx.require("externalRefs", providerObservationRef) : null;
      assertProviderRefs(intent, attempt, requestExternal, observationExternal);
      const evidenceRefs = boundedList(input.evidenceRefs, "receipt.evidenceRefs");
      for (const evidenceRef of evidenceRefs) tx.require("evidences", evidenceRef);
      const receipt: ActionReceipt = {
        receiptId: input.receiptId ?? randomUUID(),
        actionAttemptId: input.actionAttemptId,
        status: input.status,
        externalStatus: optionalText(input.externalStatus, "receipt.externalStatus", 256),
        exitCode: input.exitCode ?? null,
        resultHash: optionalText(input.resultHash, "receipt.resultHash", 128),
        externalRefs: boundedList(input.externalRefs, "receipt.externalRefs"),
        createdAt: now(),
        reconcileState,
        provider: optionalText(input.provider, "receipt.provider", 256),
        providerRequestRef,
        providerObservationRef,
        outcomeCertainty: input.outcomeCertainty ?? defaultCertainty,
        evidenceRefs,
      };
      tx.insert("actionReceipts", receipt);
      const nextAttemptState = input.status === "SUCCEEDED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "UNCERTAIN";
      const nextRecovery: RecoveryState = input.status === "UNKNOWN" ? "RECOVERY_REQUIRED" : input.status === "SUCCEEDED" ? "COMPLETED" : "FAILED";
      tx.replace("actionAttempts", { ...attempt, state: nextAttemptState, completedAt: now(), recoveryState: nextRecovery });
      tx.replace("actionIntents", { ...intent, state: input.status === "SUCCEEDED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "UNCERTAIN" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: receipt.receiptId, eventType: "ACTION_RECEIPT_RECORDED", actorType: "SYSTEM", actorRef: null, boundedPayload: { status: receipt.status, reconcileState: receipt.reconcileState }, correlationId: null, causationId: null });
      return clone(receipt);
    });
  }

  override async reconcileActionReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {
    return this.transaction((tx) => {
      const existing = tx.table("actionReceipts").find((receipt) => receipt.actionAttemptId === input.actionAttemptId);
      if (!existing) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "No existing ActionReceipt is available for reconciliation.");
      if (existing.status !== "UNKNOWN") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Only an UNKNOWN ActionReceipt may be reconciled.");
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      const requestedCertainty = input.outcomeCertainty ?? (input.status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : input.status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME");
      if (input.status === "SUCCEEDED" && !["TERMINAL_CONFIRMED", "RESULT_OBSERVED"].includes(requestedCertainty)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "A successful reconciliation requires terminally confirmed provider outcome certainty.");
      if (input.status === "FAILED" && requestedCertainty !== "TERMINAL_FAILED") throw new AutomationStoreError("AUTOMATION_CONFLICT", "A failed reconciliation requires terminal-failed provider outcome certainty.");
      if (input.status === "UNKNOWN" && ["TERMINAL_CONFIRMED", "RESULT_OBSERVED", "TERMINAL_FAILED"].includes(requestedCertainty)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "An UNKNOWN reconciliation cannot claim terminal provider certainty.");
      const providerRequestRef = optionalText(input.providerRequestRef ?? existing.providerRequestRef, "receipt.providerRequestRef", 256);
      const providerObservationRef = optionalText(input.providerObservationRef ?? existing.providerObservationRef, "receipt.providerObservationRef", 256);
      const requestExternal = providerRequestRef ? tx.require("externalRefs", providerRequestRef) : null;
      const observationExternal = providerObservationRef ? tx.require("externalRefs", providerObservationRef) : null;
      assertProviderRefs(intent, attempt, requestExternal, observationExternal);
      const evidenceRefs = boundedList([...(existing.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])], "receipt.evidenceRefs");
      for (const evidenceRef of evidenceRefs) tx.require("evidences", evidenceRef);
      const next: ActionReceipt = {
        ...existing,
        status: input.status,
        externalStatus: optionalText(input.externalStatus ?? existing.externalStatus, "receipt.externalStatus", 256),
        exitCode: input.exitCode ?? existing.exitCode,
        resultHash: optionalText(input.resultHash ?? existing.resultHash, "receipt.resultHash", 128),
        externalRefs: boundedList([...(existing.externalRefs ?? []), ...(input.externalRefs ?? [])], "receipt.externalRefs"),
        reconcileState: input.status === "UNKNOWN" ? "RECOVERY_REQUIRED" : "RECONCILED",
        provider: optionalText(input.provider ?? existing.provider, "receipt.provider", 256),
        providerRequestRef,
        providerObservationRef,
        outcomeCertainty: requestedCertainty,
        evidenceRefs,
      };
      tx.replace("actionReceipts", next);
      const nextAttemptState = input.status === "SUCCEEDED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "UNCERTAIN";
      const nextRecovery: RecoveryState = input.status === "SUCCEEDED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "RECOVERY_REQUIRED";
      tx.replace("actionAttempts", { ...attempt, state: nextAttemptState, completedAt: input.status === "UNKNOWN" ? attempt.completedAt : now(), recoveryState: nextRecovery, providerObservationRef: providerObservationRef ?? attempt.providerObservationRef ?? null });
      tx.replace("actionIntents", { ...intent, state: input.status === "SUCCEEDED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "UNCERTAIN" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: existing.receiptId, eventType: "ACTION_RECEIPT_RECONCILED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { status: next.status, outcomeCertainty: next.outcomeCertainty, reconcileState: next.reconcileState }, correlationId: intent.intentId, causationId: null });
      return clone(next);
    });
  }
}
