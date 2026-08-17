import assert from "node:assert/strict";
import test from "node:test";
import { isNativeApprovalMethod, isValidNativeApprovalResponse, noAdditionalPermissions } from "../src/shared/native-approval.ts";

test("accepts only known native approval methods", () => {
  assert.equal(isNativeApprovalMethod("item/commandExecution/requestApproval"), true);
  assert.equal(isNativeApprovalMethod("item/fileChange/requestApproval"), true);
  assert.equal(isNativeApprovalMethod("item/permissions/requestApproval"), true);
  assert.equal(isNativeApprovalMethod("workbench/approval"), false);
});

test("validates command and file approval decisions without inventing a protocol", () => {
  assert.equal(isValidNativeApprovalResponse("item/commandExecution/requestApproval", { decision: "accept" }), true);
  assert.equal(isValidNativeApprovalResponse("item/commandExecution/requestApproval", { decision: "acceptForSession" }), true);
  assert.equal(isValidNativeApprovalResponse("item/commandExecution/requestApproval", { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["allow read"] } } }), true);
  assert.equal(isValidNativeApprovalResponse("item/commandExecution/requestApproval", { decision: { madeUp: true } }), false);
  assert.equal(isValidNativeApprovalResponse("item/fileChange/requestApproval", { decision: "decline" }), true);
  assert.equal(isValidNativeApprovalResponse("item/fileChange/requestApproval", { decision: "approved" }), false);
});

test("uses a native permissions response for denying extra access", () => {
  const response = noAdditionalPermissions();
  assert.equal(isValidNativeApprovalResponse("item/permissions/requestApproval", response), true);
  assert.equal(isValidNativeApprovalResponse("item/permissions/requestApproval", { decision: "decline" }), false);
  assert.equal(isValidNativeApprovalResponse("item/permissions/requestApproval", { decision: { permissions: {}, scope: "turn", extra: true } }), false);
});
