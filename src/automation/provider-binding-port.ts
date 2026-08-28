import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestRef,
  ProviderResult,
  ProviderSubmitInput,
} from "./adapters.ts";
import { AutomationStore, AutomationStoreError } from "./store.ts";

export const PERSISTED_PROVIDER_ID_KEY = "providerId" as const;

function boundProviderId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Decorates an executable provider with durable provider selection.
 *
 * The binding is written after ActionIntent/ActionAttempt creation but before
 * the provider's first external side effect. This closes the recovery window
 * where submit could become UNKNOWN before a provider request ref exists. A
 * logical request may not switch providers on retry/reconcile.
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
      const existing = boundProviderId(intent.executionOptions[PERSISTED_PROVIDER_ID_KEY]);
      if (existing && existing !== this.provider) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", `Logical request is already bound to provider ${existing}; provider switching is forbidden.`);
      }
      if (existing === this.provider) return;
      tx.replace("actionIntents", {
        ...intent,
        executionOptions: {
          ...intent.executionOptions,
          [PERSISTED_PROVIDER_ID_KEY]: this.provider,
        },
      });
      tx.appendAudit({
        projectId: intent.projectId,
        entityType: "ActionIntent",
        entityId: intent.intentId,
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
    if (!correlation.actionIntentId) throw new Error("PROVIDER_CORRELATION_REQUIRED");
    const intent = await this.store.get("actionIntents", correlation.actionIntentId);
    if (!intent || intent.projectId !== correlation.projectId) throw new Error("PROVIDER_ACTION_INTENT_CORRELATION_INVALID");
    const existing = boundProviderId(intent.executionOptions[PERSISTED_PROVIDER_ID_KEY]);
    if (!existing) throw new Error("PROVIDER_BINDING_REQUIRED");
    if (existing !== this.provider) throw new Error("PROVIDER_BINDING_MISMATCH");
  }
}

export async function persistedProviderIdForIntent(store: AutomationStore, actionIntentId: string): Promise<string | null> {
  const intent = await store.get("actionIntents", actionIntentId);
  return intent ? boundProviderId(intent.executionOptions[PERSISTED_PROVIDER_ID_KEY]) : null;
}
