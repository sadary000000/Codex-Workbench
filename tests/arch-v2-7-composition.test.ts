import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createProductionAutomationComposition,
  createReviewHarnessComposition,
} from "../src/automation/index.ts";

test("production and review composition roots have distinct persistence paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-composition-"));
  const productionRoot = join(root, "production");
  const reviewRoot = join(root, "review");
  const production = createProductionAutomationComposition(productionRoot);
  const review = createReviewHarnessComposition(reviewRoot, productionRoot);
  try {
    assert.equal(production.mode, "PRODUCTION");
    assert.equal(review.mode, "REVIEW_HARNESS");
    assert.notEqual(production.paths.automationDbPath, review.paths.automationDbPath);
    assert.equal(production.store.filePath, production.paths.automationDbPath);
    assert.equal(review.store.filePath, review.paths.automationDbPath);
    assert.equal((await readdir(root)).sort().join(","), "");
  } finally {
    await production.close();
    await review.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("review composition refuses production-root overlap", () => {
  assert.throws(
    () => createReviewHarnessComposition("C:/fixture/production/review", "C:/fixture/production"),
    /AUTOMATION_REVIEW_ROOT_OVERLAPS_PRODUCTION_ROOT/,
  );
});
