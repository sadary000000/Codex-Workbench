import type { AutomationProviderPort } from "../automation/adapters.ts";

/**
 * Cap only the optional synchronous wait primitive exposed by a provider.
 *
 * This wrapper does not submit, retry, reconcile, cancel, or reinterpret any
 * provider outcome. A capped wait may time out sooner, after which the
 * existing Automation state machine remains responsible for returning a
 * recovery identity and requiring explicit reconcile-only progress.
 */
export function capProviderSynchronousWait(
  provider: AutomationProviderPort,
  maxWaitTimeoutMs: number,
): AutomationProviderPort {
  if (!Number.isFinite(maxWaitTimeoutMs) || maxWaitTimeoutMs < 1 || maxWaitTimeoutMs > 120_000) {
    throw new Error("PROVIDER_WAIT_CAP_INVALID");
  }
  const waitCapMs = Math.trunc(maxWaitTimeoutMs);

  return {
    provider: provider.provider,
    resolveTarget: (input) => provider.resolveTarget(input),
    capabilities: () => provider.capabilities(),
    submit: (input) => provider.submit(input),
    observe: (input) => provider.observe(input),
    reconcile: (input) => provider.reconcile(input),
    ...(provider.resolveRequestByCorrelation
      ? { resolveRequestByCorrelation: (input) => provider.resolveRequestByCorrelation!(input) }
      : {}),
    ...(provider.readResult
      ? { readResult: (input) => provider.readResult!(input) }
      : {}),
    ...(provider.waitResult
      ? {
          waitResult: (input) => {
            const requestedTimeoutMs = Number.isFinite(input.timeoutMs)
              ? Math.max(1, Math.trunc(input.timeoutMs))
              : waitCapMs;
            return provider.waitResult!({
              ...input,
              timeoutMs: Math.min(requestedTimeoutMs, waitCapMs),
            });
          },
        }
      : {}),
    ...(provider.cancel
      ? { cancel: (input) => provider.cancel!(input) }
      : {}),
  };
}
