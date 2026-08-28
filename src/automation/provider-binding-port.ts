import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestRef,
  ProviderResult,
  ProviderSubmitInput,
} from "./adapters.ts";
import { AutomationStore, AutomationStoreError } from "./store.ts";

export const PERSISTED_PROVIDER_EXECUTOR_PREFIX = "automation-provider-v1:" as const;

function encodeProviderExecutorRef(provider: string): string {
  const normalized = provider.trim();
  if (!normalized || normalized.length > 128 || /[\r\n]/.test(normalized)) throw new Error("PROVIDER_ID_INVALID");
  const encoded = `${PERSISTED_PROVIDER_EXECUTOR_PREFIX}${encodeURIComponent(normalized)}`;
  if (encoded.length > 256) throw new Error("PROVIDER_ID_INVALID");
  return encoded;
}

function boundProviderId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(PERSISTED_PROVIDER_EXECUTOR_PREFIX)) return null;
  try {
    const decoded = decodeURIComponent(value.slice(PERSISTED_PROVIDER_EXECUTOR_PREFIX.length)).trim();
    return decoded && decoded.length <= 128 && !/[\r\n]/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function uniqueBoundProviderId(values: Array<string | null>): string | null {
  const providers = [...new Set(values.filter((value): value is string => value !== null))];
  if (providers.length > 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Logical request contains conflicting persisted provider bindings.");
  return providers[0] ?? null;
}

/**
 * Decorates an executable provider with durable provider selection.
 *
 * The binding is written to the concrete ActionAttempt after the attempt is
 * created but before the provider's first external side effect. ActionIntent
 * is deliberately not mutated: its semanticSha256 remains the immutable hash
 * of the canonical action descriptor.
 *
 * A later attempt for the same logical ActionIntent must reuse the same
 * provider. The versioned executorRef binding closes the recovery window where
 * submit can become UNKNOWN before a provider request reference exists.
 */
export class PersistedProviderBindingPort implements AutomationProviderPort {
  readonly provider: AutomationProviderPort["provider"];
  private readonly store: AutomationStore;
  private readonly delegate: AutomationProviderPort;

  constructor(options: { store: AutomationStore; provider: AutomationProviderPort }) {
    this.store = options.store;
    this.delegate = options.provider;
    this.provider = options.provider.provider;
  }

  resolveTarget(input: Parameters<AutomationProviderPort["resolveTarget"]>[0]) {
    return this.delegate.resolveTarget(input);
  }

  capabilities() {
    return this.delegate.capabilities();
  }

  async submit(input: ProviderSubmitInput) {
    if (input.provider !== this.provider) throw new Error("PROVIDER_ID_MISMATCH");
    await this.persistBinding(input.correlation);
    return this.delegate.submit(input);
  }

  async observe(input: { providerRequestRef: ProviderRequestRef; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    if (input.correlation) await this.assertBinding(input.correlation);
    return this.delegate.observe(input);
  }

  async reconcile(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    await this.assertBinding(input.correlation);
    return this.delegate.reconcile(input);
  }

  async resolveRequestByCorrelation(input: { idempotencyRef: string; correlation: ProviderCorrelation }): Promise<ProviderRequestRef | null> {
    await this.assertBinding(input.correlation);
    return this.delegate.resolveRequestByCorrelation
      ? this.delegate.resolveRequestByCorrelation(input)
      : null;
  }

  async readResult(input: { providerRequestRef: ProviderRequestRef }): Promise<ProviderResult> {
    if (!this.delegate.readResult) throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    return this.delegate.readResult(input);
  }

  async waitResult(input: { providerRequestRef: ProviderRequestRef; timeoutMs: number }): Promise<ProviderResult> {
    if (!this.delegate.waitResult) throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    return this.delegate.waitResult(input);
  }

  async cancel(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    await this.assertBinding(input.correlation);
    if (!this.delegate.cancel) throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    return this.delegate.cancel(input);
  }

  private async persistBinding(correlation: ProviderCorrelation): Promise<void> {
    if (!correlation.actionIntentId || !correlation.actionAttemptId) throw new Error("PROVIDER_CORRELATION_REQUIRED");
    await this.store.transaction((tx) => {
      const intent = tx.require("actionIntents", correlation.actionIntentId!);
      const attempt = tx.require("actionAttempts", correlation.actionAttemptId!);
      if (intent.projectId !== correlation.projectId
        || attempt.intentId !== intent.intentId
        || attempt.policyVersionId !== correlation.policyVersionId
        || intent.idempotencyRef !== correlation.idempotencyRef) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider binding correlation does not match the persisted ActionIntent/ActionAttempt.");
      }

      const attempts = tx.table("actionAttempts").filter((candidate) => candidate.intentId === intent.intentId);
      const providerFromAttempts = attempts.map((candidate) => boundProviderId(candidate.executorRef));
      const providerFromRequests = attempts.map((candidate) => {
        if (!candidate.providerRequestRef) return null;
        return tx.table("externalRefs").find((ref) => ref.externalRefId === candidate.providerRequestRef)?.provider ?? null;
      });
      const providerFromReceipts = tx.table("actionReceipts")
        .filter((receipt) => attempts.some((candidate) => candidate.actionAttemptId === receipt.actionAttemptId))
        .map((receipt) => receipt.provider ?? null);
      const existing = uniqueBoundProviderId([...providerFromAttempts, ...providerFromRequests, ...providerFromReceipts]);
      if (existing && existing !== this.provider) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", `Logical request is already bound to provider ${existing}; provider switching is forbidden.`);
      }

      const currentBound = boundProviderId(attempt.executorRef);
      if (attempt.executorRef && !currentBound) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "ActionAttempt already has a non-provider executorRef; refusing to overwrite executor ownership.");
      }
      if (currentBound === this.provider) return;

      const executorRef = encodeProviderExecutorRef(this.provider);
      tx.replace("actionAttempts", { ...attempt, executorRef });
      tx.appendAudit({
        projectId: intent.projectId,
        entityType: "ActionAttempt",
        entityId: attempt.actionAttemptId,
        eventType: "PROVIDER_BOUND_BEFORE_DISPATCH",
        actorType: "AUTOMATION",
        actorRef: null,
        boundedPayload: { providerId: this.provider, actionAttemptId: attempt.actionAttemptId },
        correlationId: intent.intentId,
        causationId: attempt.actionAttemptId,
      });
    });
  }

  private async assertBinding(correlation: ProviderCorrelation): Promise<void> {
    if (!correlation.actionIntentId || !correlation.actionAttemptId) throw new Error("PROVIDER_CORRELATION_REQUIRED");
    const intent = await this.store.get("actionIntents", correlation.actionIntentId);
    const attempt = await this.store.get("actionAttempts", correlation.actionAttemptId);
    if (!intent || !attempt || intent.projectId !== correlation.projectId || attempt.intentId !== intent.intentId) throw new Error("PROVIDER_ACTION_INTENT_CORRELATION_INVALID");
    const existing = await persistedProviderIdForIntent(this.store, intent.intentId);
    if (!existing) throw new Error("PROVIDER_BINDING_REQUIRED");
    if (existing !== this.provider) throw new Error("PROVIDER_BINDING_MISMATCH");
  }
}

export async function persistedProviderIdForIntent(store: AutomationStore, actionIntentId: string): Promise<string | null> {
  const intent = await store.get("actionIntents", actionIntentId);
  if (!intent) return null;
  const document = await store.snapshot();
  const attempts = document.actionAttempts.filter((candidate) => candidate.intentId === actionIntentId);
  const providers = attempts.flatMap((attempt) => {
    const values: Array<string | null> = [boundProviderId(attempt.executorRef)];
    if (attempt.providerRequestRef) {
      values.push(document.externalRefs.find((ref) => ref.externalRefId === attempt.providerRequestRef)?.provider ?? null);
    }
    const receipt = document.actionReceipts.find((candidate) => candidate.actionAttemptId === attempt.actionAttemptId);
    values.push(receipt?.provider ?? null);
    return values;
  });
  return uniqueBoundProviderId(providers);
}
