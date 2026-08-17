import assert from "node:assert/strict";
import test from "node:test";
import { validateInitializeResult } from "../src/codex/app-server-capabilities.ts";

test("fails closed for an unknown App Server userAgent format", () => {
  assert.throws(
    () => validateInitializeResult({ userAgent: "future-app-server", codexHome: "C:/fake/.codex" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_VERSION_UNKNOWN",
  );
});
