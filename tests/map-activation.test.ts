import assert from "node:assert/strict";
import test from "node:test";
import { isConversationMapSidecarEnabled } from "../src/main/map-activation.ts";

test("Conversation Map sidecar activation requires an available enabled status", () => {
  assert.equal(isConversationMapSidecarEnabled({ available: false, enabled: true }), false);
  assert.equal(isConversationMapSidecarEnabled({ available: true, enabled: false }), false);
  assert.equal(isConversationMapSidecarEnabled({ available: true, enabled: true }), true);
  assert.equal(isConversationMapSidecarEnabled(null), false);
});
