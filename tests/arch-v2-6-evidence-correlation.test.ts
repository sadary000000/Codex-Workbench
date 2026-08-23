import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEvidenceCorrelation, EvidenceCorrelationError } from "../src/automation/evidence-correlation.ts";
import { AutomationStore } from "../src/automation/store.ts";

test("evidence correlation is bounded, opaque, immutable, and queryable", async () => {
  const correlation = createEvidenceCorrelation({
    workflowActionId: " action-1 ",
    requestId: "request-1",
    artifactRefs: ["artifact-1"],
    evidenceRefs: ["evidence-1"],
  });
  assert.equal(correlation.workflowActionId, "action-1");
  assert.deepEqual(correlation.artifactRefs, ["artifact-1"]);
  assert.equal(Object.isFrozen(correlation), true);
  assert.equal(Object.isFrozen(correlation.artifactRefs), true);
  assert.throws(() => createEvidenceCorrelation({ requestId: "request-1", evidenceRefs: ["duplicate", "duplicate"] }), EvidenceCorrelationError);
  assert.throws(() => createEvidenceCorrelation({ requestId: "request-1", nativeThreadId: "bad\nref" }), EvidenceCorrelationError);

  const root = await mkdtemp(join(tmpdir(), "arch-v2-6-correlation-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    await store.createAutomationProject({ projectId: "correlation-project", name: "Correlation fixture" });
    const persistedCorrelation = createEvidenceCorrelation({ requestId: "request-1" });
    await store.createEvidence({
      evidenceId: "evidence-correlation-1",
      projectId: "correlation-project",
      stageSpecId: null,
      stepSpecId: null,
      attemptId: null,
      type: "PROVIDER_OBSERVATION",
      source: "arch-v2-6-test",
      producer: "test",
      exitCode: 0,
      sha256: null,
      artifactRefId: null,
      metadata: { state: "COMPLETED" },
      correlation: persistedCorrelation,
    });
    const found = await store.listEvidenceByCorrelation({ requestId: "request-1" });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.evidenceId, "evidence-correlation-1");
    assert.deepEqual(await store.listEvidenceByCorrelation({ requestId: "missing" }), []);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
