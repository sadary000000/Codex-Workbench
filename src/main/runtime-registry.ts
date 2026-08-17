import type { RuntimeState } from "../shared/runtime-types.ts";

export interface RuntimeHandle {
  readonly nativeThreadId: string | null;
  readonly state: RuntimeState;
  close(): Promise<void>;
}

/**
 * Keeps one execution handle per Native Thread.
 *
 * Navigation selects a handle; it does not close the other handles. The
 * registry deliberately has no concurrency limit: Codex/App Server remains
 * the authority for resource and protocol failures.
 */
export class RuntimeRegistry<T extends RuntimeHandle> {
  private readonly runtimes = new Map<string, T>();
  private readonly starts = new Map<string, Promise<T>>();

  get(nativeThreadId: string): T | null {
    return this.runtimes.get(nativeThreadId) ?? null;
  }

  has(nativeThreadId: string): boolean {
    return this.runtimes.has(nativeThreadId);
  }

  list(): Array<{ nativeThreadId: string; runtime: T }> {
    return [...this.runtimes.entries()].map(([nativeThreadId, runtime]) => ({ nativeThreadId, runtime }));
  }

  attach(nativeThreadId: string, runtime: T): T {
    const id = nativeThreadId.trim();
    if (!id) throw new Error("Native Thread ID is required for registry attach.");
    const existing = this.runtimes.get(id);
    if (existing && existing !== runtime) {
      const error = new Error(`Native Thread runtime is already attached: ${id}`) as Error & { code: string };
      error.code = "RUNTIME_DUPLICATE";
      throw error;
    }
    this.runtimes.set(id, runtime);
    return runtime;
  }

  detach(nativeThreadId: string, runtime?: T): boolean {
    const current = this.runtimes.get(nativeThreadId);
    if (!current || (runtime && current !== runtime)) return false;
    this.runtimes.delete(nativeThreadId);
    return true;
  }

  async ensure(nativeThreadId: string, factory: () => Promise<T>): Promise<T> {
    const id = nativeThreadId.trim();
    if (!id) throw new Error("Native Thread ID is required for registry ensure.");
    const existing = this.runtimes.get(id);
    if (existing) return existing;
    const pending = this.starts.get(id);
    if (pending) return pending;
    const start = factory().then((runtime) => {
      this.runtimes.set(id, runtime);
      this.starts.delete(id);
      return runtime;
    }, (error) => {
      this.starts.delete(id);
      throw error;
    });
    this.starts.set(id, start);
    return start;
  }

  async close(nativeThreadId: string): Promise<void> {
    const id = nativeThreadId.trim();
    const runtime = this.runtimes.get(id);
    if (runtime) {
      this.runtimes.delete(id);
      await runtime.close();
      return;
    }
    const pending = this.starts.get(id);
    if (!pending) return;
    const started = await pending.catch(() => null);
    if (!started) return;
    this.runtimes.delete(id);
    await started.close();
  }

  async closeAll(): Promise<void> {
    const entries = [...this.runtimes.entries()];
    const pending = [...this.starts.values()];
    this.runtimes.clear();
    await Promise.all([
      ...entries.map(async ([, runtime]) => runtime.close()),
      ...pending.map(async (start) => {
        const runtime = await start.catch(() => null);
        if (runtime) await runtime.close();
      }),
    ]);
    this.starts.clear();
    this.runtimes.clear();
  }
}
