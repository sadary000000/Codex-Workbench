import assert from "node:assert/strict";
import test from "node:test";
import { errorInfo, isNoRolloutError, isWriterConflictError } from "../src/shared/error-info.ts";

test("classifies Codex thread-store writer conflicts without discarding the raw cause", () => {
  const error = {
    name: "AppServerClientError",
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC -32600: thread-store conflict",
    stderr: "thread already has an active writer",
  };
  assert.equal(isWriterConflictError(error), true);
  const info = errorInfo(error);
  assert.equal(info.name, "WriterConflictError");
  assert.equal(info.code, "WRITER_CONFLICT");
  assert.match(info.message, /另一个 Codex 客户端/);
  assert.match(info.cause ?? "", /thread-store conflict/);
  assert.match(info.stderr, /active writer/);
});

test("does not collapse unrelated App Server protocol errors into writer conflicts", () => {
  const info = errorInfo({
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC -32600: no rollout found",
  });
  assert.equal(info.code, "APP_SERVER_PROTOCOL_REJECTED");
  assert.notEqual(info.code, "WRITER_CONFLICT");
});

test("classifies a missing native rollout separately from transport and writer failures", () => {
  assert.equal(isNoRolloutError({
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC -32600: no rollout found for thread id native-thread",
  }), true);
  assert.equal(isNoRolloutError({
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC -32600: thread-store conflict",
    stderr: "already has an active writer",
  }), false);
  assert.equal(isNoRolloutError({
    code: "APP_SERVER_TIMEOUT",
    message: "no rollout found",
  }), false);
});
