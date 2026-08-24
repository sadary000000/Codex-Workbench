import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseWebGptCliInvocation } from "../src/main/webgpt-command.ts";
import { WebGptReviewSubmissionService } from "../src/features/webgpt/review-submission/webgpt-review-submission-service.ts";
import type { ReviewSubmissionWorkspacePort } from "../src/features/webgpt/review-submission/review-submission-types.ts";

function workspace(options: { failAfterSend?: boolean } = {}): ReviewSubmissionWorkspacePort & { submitCount: number; reconcileCount: number } {
  let submitCount = 0;
  let reconcileCount = 0;
  return {
    get submitCount() { return submitCount; },
    get reconcileCount() { return reconcileCount; },
    async submitReviewPackage(input) {
      submitCount += 1;
      if (options.failAfterSend && submitCount === 1) {
        const error = Object.assign(new Error("verification not observed"), { code: "WEBGPT_REVIEW_UNKNOWN_AFTER_SEND", retryable: false });
        throw error;
      }
      return {
        targetUrl: input.target === "current" ? "https://chatgpt.com/c/current" : input.target,
        beforeUserMessageCount: 2,
        afterUserMessageCount: 3,
        verification: { markerFound: true, composerEmpty: true },
        timings: { targetReadyMs: 2, attachMs: 3, summaryMs: 4, sendMs: 5, verifyMs: 6, totalMs: 20 },
      };
    },
    async reconcileReviewSubmission(input) {
      reconcileCount += 1;
      return { targetUrl: input.target === "current" ? "https://chatgpt.com/c/current" : input.target, found: false, userMessageCount: 2, latestUserText: "" };
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-review-submit-"));
  const zipPath = join(root, "review.zip");
  const summaryPath = join(root, "summary.txt");
  await writeFile(zipPath, "zip-fixture");
  await writeFile(summaryPath, "WEB_REVIEW_SUBMIT_TEST\nsummary");
  return { root, zipPath, summaryPath };
}

test("WEB-REVIEW-SUBMIT-1 CLI is one explicit command with no target guessing", () => {
  assert.deepEqual(parseWebGptCliInvocation([
    "workbench",
    "webgpt",
    "review-submit",
    "--zip", "D:\\review.zip",
    "--summary-file", "D:\\summary.txt",
    "--target", "current",
    "--json",
  ]), {
    kind: "command",
    command: {
      name: "webgpt.review-submit",
      json: true,
      zipPath: "D:\\review.zip",
      summaryPath: "D:\\summary.txt",
      target: "current",
    },
  });
  assert.equal(parseWebGptCliInvocation(["workbench", "webgpt", "review-submit", "--zip", "a.zip", "--summary-file", "a.txt", "--target", "https://example.com/c/nope"]).kind, "error");
});

test("review submission ledger returns ALREADY_SENT without a second browser send", async () => {
  const files = await fixture();
  const firstWorkspace = workspace();
  const service = new WebGptReviewSubmissionService({ workspace: firstWorkspace, storageDirectory: join(files.root, "ledger") });
  const input = { zipPath: files.zipPath, summary: "WEB_REVIEW_SUBMIT_TEST\nsummary", target: "current" as const };
  const first = await service.submitReview(input);
  assert.equal(first.state, "SENT");
  assert.equal(firstWorkspace.submitCount, 1);
  const secondWorkspace = workspace();
  const second = await new WebGptReviewSubmissionService({ workspace: secondWorkspace, storageDirectory: join(files.root, "ledger") }).submitReview(input);
  assert.equal(second.state, "ALREADY_SENT");
  assert.equal(secondWorkspace.submitCount, 0);
  const ledger = await readFile(join(files.root, "ledger", "submissions.jsonl"), "utf8");
  assert.equal(ledger.trim().split(/\r?\n/).length, 2);
});

test("explicit idempotency key rejects semantic drift instead of reusing a prior send", async () => {
  const files = await fixture();
  const storageDirectory = join(files.root, "ledger");
  const firstWorkspace = workspace();
  const firstService = new WebGptReviewSubmissionService({ workspace: firstWorkspace, storageDirectory });
  const first = await firstService.submitReview({
    zipPath: files.zipPath,
    summary: "WEB_REVIEW_SUBMIT_TEST\nsummary",
    target: "current",
    idempotencyKey: "fixed-review-key",
  });
  assert.equal(first.state, "SENT");

  const secondWorkspace = workspace();
  const second = await new WebGptReviewSubmissionService({ workspace: secondWorkspace, storageDirectory }).submitReview({
    zipPath: files.zipPath,
    summary: "WEB_REVIEW_SUBMIT_TEST\nchanged summary",
    target: "current",
    idempotencyKey: "fixed-review-key",
  });
  assert.equal(second.state, "FAILED_FINAL");
  assert.equal(second.error?.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(secondWorkspace.submitCount, 0);
});

test("UNKNOWN_AFTER_SEND reconciles before allowing a retry", async () => {
  const files = await fixture();
  const firstWorkspace = workspace({ failAfterSend: true });
  const storageDirectory = join(files.root, "ledger");
  const input = { zipPath: files.zipPath, summary: "WEB_REVIEW_SUBMIT_TEST\nsummary", target: "current" as const };
  const first = await new WebGptReviewSubmissionService({ workspace: firstWorkspace, storageDirectory }).submitReview(input);
  assert.equal(first.state, "UNKNOWN_AFTER_SEND");
  const recoveryWorkspace = workspace();
  const second = await new WebGptReviewSubmissionService({ workspace: recoveryWorkspace, storageDirectory }).submitReview(input);
  assert.equal(second.state, "SENT");
  assert.equal(recoveryWorkspace.reconcileCount, 1);
  assert.equal(recoveryWorkspace.submitCount, 1);
});
