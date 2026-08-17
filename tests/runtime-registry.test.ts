import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRegistry, type RuntimeHandle } from "../src/main/runtime-registry.ts";

class FakeRuntime implements RuntimeHandle {
  readonly state = "READY" as const;
  closeCount = 0;
  readonly nativeThreadId: string;

  constructor(nativeThreadId: string) {
    this.nativeThreadId = nativeThreadId;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

test("keeps one runtime per Native Thread and deduplicates concurrent startup", async () => {
  const registry = new RuntimeRegistry<FakeRuntime>();
  const starts: string[] = [];
  const factories = new Map<string, () => Promise<FakeRuntime>>();
  for (const id of ["native-a", "native-b"]) {
    factories.set(id, async () => {
      starts.push(id);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return new FakeRuntime(id);
    });
  }

  const [a1, a2, b] = await Promise.all([
    registry.ensure("native-a", factories.get("native-a")!),
    registry.ensure("native-a", factories.get("native-a")!),
    registry.ensure("native-b", factories.get("native-b")!),
  ]);

  assert.strictEqual(a1, a2);
  assert.notStrictEqual(a1, b);
  assert.deepEqual(starts.sort(), ["native-a", "native-b"]);
  assert.deepEqual(registry.list().map(({ nativeThreadId }) => nativeThreadId).sort(), ["native-a", "native-b"]);

  await registry.closeAll();
  assert.equal(a1.closeCount, 1);
  assert.equal(b.closeCount, 1);
  assert.equal(registry.list().length, 0);
});

test("rejects replacing a live runtime for the same Native Thread", () => {
  const registry = new RuntimeRegistry<FakeRuntime>();
  const first = new FakeRuntime("native-a");
  const second = new FakeRuntime("native-a");
  registry.attach("native-a", first);
  assert.throws(
    () => registry.attach("native-a", second),
    (error: any) => error?.code === "RUNTIME_DUPLICATE",
  );
  assert.strictEqual(registry.get("native-a"), first);
});
