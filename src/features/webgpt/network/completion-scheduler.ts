import type { WebGptNetworkCompletionCandidate } from "./network-types.ts";

const FAST_CONFIRM_INTERVAL_MS = 300;
const FAST_CONFIRM_WINDOW_MS = 10_000;
const RECONCILIATION_INTERVAL_MS = 3_000;
const LEGACY_INTERVAL_MS = 800;

export class WebGptCompletionProbeScheduler {
  readonly networkMode: boolean;
  private fastConfirmUntil = 0;
  private candidateSeen = false;
  private fallbackUsed: boolean;
  private reconciliationProbeCount = 0;
  private confirmationProbeCount = 0;
  private nextProbeAt: number;

  constructor(networkMode: boolean, now = Date.now()) {
    this.networkMode = networkMode;
    this.fallbackUsed = !networkMode;
    this.nextProbeAt = now;
  }

  get candidateSeenValue(): boolean {
    return this.candidateSeen;
  }

  get nextProbeAtValue(): number {
    return this.nextProbeAt;
  }

  get fallbackUsedValue(): boolean {
    return this.fallbackUsed;
  }

  get reconciliationProbeCountValue(): number {
    return this.reconciliationProbeCount;
  }

  get confirmationProbeCountValue(): number {
    return this.confirmationProbeCount;
  }

  acceptCandidate(_candidate: WebGptNetworkCompletionCandidate, now = Date.now()): void {
    this.candidateSeen = true;
    this.fastConfirmUntil = now + FAST_CONFIRM_WINDOW_MS;
    this.nextProbeAt = now;
  }

  useFallback(now = Date.now()): void {
    this.fallbackUsed = true;
    this.nextProbeAt = now;
  }

  noteProbe(): void {
    if (this.candidateSeen) this.confirmationProbeCount += 1;
    else this.reconciliationProbeCount += 1;
  }

  scheduleNext(now = Date.now()): void {
    const interval = this.candidateSeen && now < this.fastConfirmUntil
      ? FAST_CONFIRM_INTERVAL_MS
      : this.networkMode
        ? RECONCILIATION_INTERVAL_MS
        : LEGACY_INTERVAL_MS;
    this.nextProbeAt = now + interval;
  }

  markCompletionUsedFallback(): void {
    if (!this.candidateSeen) this.fallbackUsed = true;
  }
}
