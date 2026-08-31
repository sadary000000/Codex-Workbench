import { createHash } from "node:crypto";
import type { RuntimeState, ThreadReadView, TurnResult } from "../shared/runtime-types.ts";
import type { ProviderRuntimeCapability } from "../automation/adapters.ts";
import type { NativeProviderRuntimePort, NativeProviderTurnState, NativeProviderTurnView } from "../codex/automation/native-provider-port.ts";

interface SharedNativeRuntime {
  readonly nativeThreadId: string | null;
  readonly state: RuntimeState;
  snapshot(): { activeTurnId: string | null };
  startTurnAccepted(prompt: string, options?: { approvalPolicy?: "never" | "on-request"; sandboxPolicy?: { type: "readOnly" } }): Promise<{
    acceptance: { turnId: string; nativeThreadId: string };
    completion: Promise<TurnResult>;
  }>;
  readThread(): Promise<ThreadReadView>;
  refreshProjectionFromRead(read?: ThreadReadView): Promise<ThreadReadView>;
  interruptTurn(): Promise<{ ok: true; turnId: string }>;
}

export interface NativeRuntimeRegistryPort {
  get(nativeThreadId: string): SharedNativeRuntime | null;
  list(): Array<{ nativeThreadId: string; runtime: SharedNativeRuntime }>;
}

interface TurnOwner {
  readonly nativeThreadId: string;
  completion: Promise<TurnResult> | null;
  completed: TurnResult | null;
}

function boundedId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) throw new Error(`${field}_INVALID`);
  return normalized;
}

function statusText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const candidate of [record.type, record.status, record.phase]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().toLowerCase();
  }
  return null;
}

function turnState(value: unknown): NativeProviderTurnState {
  const status = statusText(value);
  if (!status) return "UNKNOWN";
  if (["active", "running", "inprogress", "in_progress", "pending", "started"].includes(status)) return "RUNNING";
  if (status === "completed") return "COMPLETED";
  if (status === "failed") return "FAILED";
  if (status === "interrupted" || status === "cancelled" || status === "canceled") return "INTERRUPTED";
  return "UNKNOWN";
}

function resultState(value: TurnResult["status"]): NativeProviderTurnState {
  if (value === "completed") return "COMPLETED";
  if (value === "failed") return "FAILED";
  if (value === "interrupted") return "INTERRUPTED";
  return "UNKNOWN";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finalMessage(read: ThreadReadView, turnId: string): string | null {
  const turn = read.turns.find((candidate) => candidate.id === turnId);
  if (!turn) return null;
  const messages = turn.items
    .filter((item) => item.type === "agentMessage")
    .map((item) => text(item.text))
    .filter((item): item is string => item !== null);
  return messages.at(-1) ?? null;
}

function hash(value: string | null): string | null {
  return value === null ? null : createHash("sha256").update(value, "utf8").digest("hex");
}

function fromCompletion(result: TurnResult): NativeProviderTurnView {
  return {
    nativeThreadId: result.nativeThreadId,
    nativeTurnId: result.turnId,
    state: resultState(result.status),
    response: result.finalMessage,
    resultHash: hash(result.finalMessage),
  };
}

function fromRead(read: ThreadReadView, turnId: string): NativeProviderTurnView | null {
  const turn = read.turns.find((candidate) => candidate.id === turnId);
  if (!turn) return null;
  const response = finalMessage(read, turnId);
  return {
    nativeThreadId: read.nativeThreadId,
    nativeTurnId: turnId,
    state: turnState(turn.status),
    response,
    resultHash: hash(response),
  };
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const bounded = Math.min(Math.max(Math.trunc(timeoutMs), 1), 120_000);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("NATIVE_PROVIDER_WAIT_TIMEOUT"), { code: "NATIVE_PROVIDER_WAIT_TIMEOUT" })), bounded);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Composition adapter over Workbench's existing RuntimeRegistry.
 *
 * It never starts/resumes/creates a NativeThreadRuntime. Missing targets fail
 * closed. The only dispatch primitive is startTurnAccepted on an already
 * attached runtime, so Native provider execution cannot fork a second Codex
 * App Server/runtime trunk behind Automation's back.
 */
export class SharedNativeProviderRuntimeAdapter implements NativeProviderRuntimePort {
  private readonly registry: NativeRuntimeRegistryPort;
  private readonly runtimeId: string;
  private readonly turns = new Map<string, TurnOwner>();

  constructor(options: { registry: NativeRuntimeRegistryPort; runtimeId: string }) {
    this.registry = options.registry;
    this.runtimeId = boundedId(options.runtimeId, "NATIVE_RUNTIME_ID");
  }

  async hasThread(nativeThreadId: string): Promise<boolean> {
    return this.registry.get(boundedId(nativeThreadId, "NATIVE_THREAD_ID")) !== null;
  }

  async resolveTurnByPromptSha256(input: { nativeThreadId: string; promptSha256: string; excludeTurnIds: readonly string[] }): Promise<string | null> {
  const nativeThreadId = boundedId(input.nativeThreadId, "NATIVE_THREAD_ID");
  const promptSha256 = input.promptSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(promptSha256)) throw new Error("NATIVE_PROMPT_SHA256_INVALID");
  const runtime = this.registry.get(nativeThreadId);
  if (!runtime) return null;
  const excluded = new Set(input.excludeTurnIds.map((turnId) => boundedId(turnId, "NATIVE_TURN_ID")));
  const read = await runtime.readThread();
  if (read.nativeThreadId !== nativeThreadId) throw new Error("NATIVE_TURN_THREAD_MISMATCH");
  const matches = read.turns
    .filter((turn) => turn.id !== null && !excluded.has(turn.id))
    .filter((turn) => turn.items.some((item) => item.type === "userMessage" && typeof item.text === "string" && hash(item.text) === promptSha256))
    .map((turn) => turn.id!)
    .filter((turnId, index, values) => values.indexOf(turnId) === index);
  if (matches.length !== 1) return null;
  const nativeTurnId = boundedId(matches[0]!, "NATIVE_TURN_ID");
  const existing = this.turns.get(nativeTurnId);
  this.turns.set(nativeTurnId, { nativeThreadId, completion: existing?.completion ?? null, completed: existing?.completed ?? null });
  return nativeTurnId;
}

  async runtimeCapability(): Promise<ProviderRuntimeCapability> {
    const attached = this.registry.list();
    const available = attached.some(({ runtime }) => !["FAILED", "DISCONNECTED", "RECOVERY_REQUIRED", "CLOSED"].includes(runtime.state));
    return {
      capabilityVersion: "native-shared-runtime-v1",
      runtimeId: this.runtimeId,
      status: available ? "READY" : "UNAVAILABLE",
      supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
      allowDataEgress: false,
      allowSideEffects: false,
    };
  }

  async startTurn(input: { nativeThreadId: string; prompt: string }): Promise<{ nativeTurnId: string }> {
    const nativeThreadId = boundedId(input.nativeThreadId, "NATIVE_THREAD_ID");
    const runtime = this.registry.get(nativeThreadId);
    if (!runtime) throw Object.assign(new Error("NATIVE_TARGET_UNAVAILABLE:TARGET_UNREACHABLE"), { code: "NATIVE_TARGET_UNAVAILABLE:TARGET_UNREACHABLE" });
    const started = await runtime.startTurnAccepted(input.prompt, { approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } });
    if (started.acceptance.nativeThreadId !== nativeThreadId) throw new Error("NATIVE_TURN_THREAD_MISMATCH");
    const nativeTurnId = boundedId(started.acceptance.turnId, "NATIVE_TURN_ID");
    const owner: TurnOwner = { nativeThreadId, completion: started.completion, completed: null };
    this.turns.set(nativeTurnId, owner);
    started.completion.then((result) => {
      const current = this.turns.get(nativeTurnId);
      if (current) current.completed = result;
    }, () => undefined);
    return { nativeTurnId };
  }

  async readTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    const turnId = boundedId(nativeTurnId, "NATIVE_TURN_ID");
    const known = this.turns.get(turnId);
    if (known?.completed) return fromCompletion(known.completed);
    const located = await this.locate(turnId, false);
    if (located) return located.view;
    throw Object.assign(new Error("NATIVE_TURN_NOT_FOUND"), { code: "NATIVE_TURN_NOT_FOUND" });
  }

  async reconcileTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    const turnId = boundedId(nativeTurnId, "NATIVE_TURN_ID");
    const located = await this.locate(turnId, true);
    if (located) return located.view;
    const known = this.turns.get(turnId);
    if (known?.completed) return fromCompletion(known.completed);
    throw Object.assign(new Error("NATIVE_TURN_NOT_FOUND"), { code: "NATIVE_TURN_NOT_FOUND" });
  }

  async waitTurn(nativeTurnId: string, timeoutMs: number): Promise<NativeProviderTurnView> {
    const turnId = boundedId(nativeTurnId, "NATIVE_TURN_ID");
    const known = this.turns.get(turnId);
    if (!known?.completion) return this.readTurn(turnId);
    const result = await timeout(known.completion, timeoutMs);
    known.completed = result;
    return fromCompletion(result);
  }

  async interruptTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    const turnId = boundedId(nativeTurnId, "NATIVE_TURN_ID");
    const owner = this.turns.get(turnId);
    if (!owner) throw Object.assign(new Error("NATIVE_TURN_NOT_FOUND"), { code: "NATIVE_TURN_NOT_FOUND" });
    const runtime = this.registry.get(owner.nativeThreadId);
    if (!runtime || runtime.snapshot().activeTurnId !== turnId) throw Object.assign(new Error("NATIVE_TURN_NOT_ACTIVE"), { code: "NATIVE_TURN_NOT_ACTIVE" });
    const interrupted = await runtime.interruptTurn();
    if (interrupted.turnId !== turnId) throw new Error("NATIVE_TURN_INTERRUPT_ID_MISMATCH");
    return this.reconcileTurn(turnId);
  }

  private async locate(turnId: string, reconcile: boolean): Promise<{ runtime: SharedNativeRuntime; view: NativeProviderTurnView } | null> {
    const owner = this.turns.get(turnId);
    const candidates = owner
      ? [{ nativeThreadId: owner.nativeThreadId, runtime: this.registry.get(owner.nativeThreadId) }]
      : this.registry.list().map(({ nativeThreadId, runtime }) => ({ nativeThreadId, runtime }));
    for (const candidate of candidates) {
      if (!candidate.runtime) continue;
      try {
        const read = await candidate.runtime.readThread();
        const view = fromRead(read, turnId);
        if (!view) continue;
        this.turns.set(turnId, { nativeThreadId: candidate.nativeThreadId, completion: owner?.completion ?? null, completed: owner?.completed ?? null });
        if (reconcile) {
          try {
            await candidate.runtime.refreshProjectionFromRead(read);
          } catch (error) {
            if (view.state === "COMPLETED" || view.state === "FAILED" || view.state === "INTERRUPTED") {
              return { runtime: candidate.runtime, view };
            }
            throw error;
          }
        }
        return { runtime: candidate.runtime, view };
      } catch {
        // A query failure on one attached runtime is not evidence that another
        // attached runtime cannot own the requested historical Turn.
      }
    }
    return null;
  }
}
