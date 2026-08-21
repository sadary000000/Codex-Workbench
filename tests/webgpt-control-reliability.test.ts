import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_PLANE_ERROR_CODES,
  canonicalControlPlaneErrorCode,
  normalizeControlPlaneError,
} from "../src/shared/control-plane-errors.ts";
import { presentWebGptCliOutput } from "../src/main/webgpt-cli-presenter.ts";
import { WebGptOperationArbiter } from "../src/features/webgpt/runtime/webgpt-operation-arbiter.ts";

test("WEB-6.7 exposes the complete stable Control Plane error taxonomy", () => {
  assert.deepEqual(CONTROL_PLANE_ERROR_CODES, [
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "BUSY",
    "OVERLOADED",
    "TIMEOUT",
    "RECOVERY_REQUIRED",
    "USER_CONTROL",
    "VERSION_MISMATCH",
    "CAPABILITY_NOT_SUPPORTED",
    "TARGET_CHAT_MISMATCH",
    "INTERNAL_ERROR",
  ]);
  assert.equal(canonicalControlPlaneErrorCode("WEBGPT_OPERATION_BUSY"), "BUSY");
  assert.equal(canonicalControlPlaneErrorCode("WEBGPT_TARGET_CHAT_MISMATCH"), "TARGET_CHAT_MISMATCH");
  assert.equal(canonicalControlPlaneErrorCode("CONTROL_RESPONSE_TIMEOUT"), "TIMEOUT");
  assert.equal(canonicalControlPlaneErrorCode("unknown-runtime-error"), "INTERNAL_ERROR");
});

test("WEB-6.7 normalizes legacy errors without leaking their raw code or sensitive details", () => {
  const error = normalizeControlPlaneError({
    code: "WEBGPT_OPERATION_BUSY",
    message: "browser is busy",
    details: {
      reason: "active_write",
      queueDepth: 2,
      prompt: "must not cross the Control Plane boundary",
    },
  });
  assert.equal(error.code, "BUSY");
  assert.equal(error.retryable, true);
  assert.equal(error.userAction, "retry");
  assert.deepEqual(error.details, { reason: "active_write", queueDepth: 2, legacyCode: "WEBGPT_OPERATION_BUSY" });
  assert.equal("prompt" in (error.details ?? {}), false);

  const recovery = normalizeControlPlaneError({ code: "ROLE_CHAT_MISMATCH", message: "wrong target" });
  assert.equal(recovery.code, "TARGET_CHAT_MISMATCH");
  assert.equal(recovery.retryable, false);
  assert.equal(recovery.userAction, "reopen_target_chat");
});

test("WEB-6.7 CLI Presenter gives one JSON line and stable exit codes", () => {
  const invalid = presentWebGptCliOutput({ json: true }, {
    version: 1,
    requestId: "invalid-1",
    ok: false,
    command: "webgpt.status",
    error: { code: "CLI_INVALID_ARGUMENT", message: "bad flag", retryable: false },
  });
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.stderr, "");
  assert.equal(invalid.stdout.endsWith("\n"), true);
  assert.equal(JSON.parse(invalid.stdout).error.code, "INVALID_ARGUMENT");

  const busy = presentWebGptCliOutput({ json: true }, {
    version: 1,
    requestId: "busy-1",
    ok: false,
    command: "webgpt.latest",
    error: { code: "WEBGPT_OPERATION_BUSY", message: "busy", retryable: true },
  });
  assert.equal(busy.exitCode, 1);
  assert.equal(JSON.parse(busy.stdout).error.code, "BUSY");
  assert.equal(JSON.parse(busy.stdout).error.details.legacyCode, "WEBGPT_OPERATION_BUSY");

  const success = presentWebGptCliOutput({ json: false }, {
    version: 1,
    requestId: "ok-1",
    ok: true,
    command: "webgpt.status",
    result: { workbench: "READY" },
  });
  assert.equal(success.exitCode, 0);
  assert.match(success.stdout, /webgpt\.status: OK/);
  assert.equal(success.stderr, "");
});

test("WEB-6.7 bounded Browser Arbiter distinguishes BUSY from OVERLOADED", async () => {
  const arbiter = new WebGptOperationArbiter({ maxQueueSize: 1 });
  arbiter.enterAutomationControl();
  const active = await arbiter.acquire({ source: "CLI", ownerKey: "active", operationType: "SEND" });
  const queued = arbiter.acquire({ source: "CLI", ownerKey: "queued", operationType: "OPEN_CHAT" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await assert.rejects(
    () => arbiter.acquire({ source: "CLI", ownerKey: "overloaded", operationType: "SEND" }),
    (error: unknown) => {
      const candidate = error as { code?: string; retryable?: boolean; retryAfterMs?: number; details?: Record<string, unknown> };
      assert.equal(candidate.code, "WEBGPT_OPERATION_OVERLOADED");
      assert.equal(candidate.retryable, true);
      assert.equal(candidate.retryAfterMs, 1_000);
      assert.deepEqual(candidate.details, { reason: "queue_capacity", queueDepth: 1, queueLimit: 1 });
      return true;
    },
  );

  await assert.rejects(
    () => arbiter.withRead({ source: "CLI", ownerKey: "reader", operationType: "CURRENT" }, () => "unreachable"),
    (error: unknown) => {
      const candidate = error as { code?: string; retryable?: boolean; retryAfterMs?: number };
      assert.equal(candidate.code, "WEBGPT_OPERATION_BUSY");
      assert.equal(candidate.retryable, true);
      assert.equal(candidate.retryAfterMs, 250);
      return true;
    },
  );

  active.release("COMPLETED");
  const released = await queued;
  released.release("COMPLETED");
  assert.equal(arbiter.getDiagnostics().queueLimit, 1);
});
