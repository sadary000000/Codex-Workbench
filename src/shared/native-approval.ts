type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 4_096);
}

function validCommandDecision(value: unknown): boolean {
  if (value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel") return true;
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length !== 1) return false;
  const amendment = record(candidate.acceptWithExecpolicyAmendment);
  if (amendment) return Object.keys(amendment).length === 1 && stringList(amendment.execpolicy_amendment);
  const network = record(candidate.applyNetworkPolicyAmendment);
  const policy = record(network?.network_policy_amendment);
  return Boolean(
    network && Object.keys(network).length === 1 && policy
      && Object.keys(policy).length === 2
      && (policy.action === "allow" || policy.action === "deny")
      && typeof policy.host === "string" && policy.host.length <= 4_096,
  );
}

function validPermissionsResponse(value: unknown): boolean {
  const candidate = record(value);
  const permissions = record(candidate?.permissions);
  if (!candidate || !permissions || Object.keys(candidate).some((key) => !["permissions", "scope", "strictAutoReview"].includes(key))) return false;
  if (candidate.scope !== undefined && candidate.scope !== "turn" && candidate.scope !== "session") return false;
  if (candidate.strictAutoReview !== undefined && candidate.strictAutoReview !== null && typeof candidate.strictAutoReview !== "boolean") return false;
  return Object.keys(permissions).every((key) => key === "fileSystem" || key === "network");
}

/** Native App Server request methods for which Workbench has a real response contract. */
export function isNativeApprovalMethod(method: string): boolean {
  return method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/permissions/requestApproval";
}

/** Validates the response envelope before it is returned to the native JSON-RPC request. */
export function isValidNativeApprovalResponse(method: string, response: unknown): boolean {
  const candidate = record(response);
  if (!candidate || Object.keys(candidate).length !== 1 || !("decision" in candidate)) return false;
  if (method === "item/commandExecution/requestApproval") return validCommandDecision(candidate.decision);
  if (method === "item/fileChange/requestApproval") {
    return candidate.decision === "accept"
      || candidate.decision === "acceptForSession"
      || candidate.decision === "decline"
      || candidate.decision === "cancel";
  }
  if (method === "item/permissions/requestApproval") return validPermissionsResponse(candidate.decision);
  return false;
}

export function noAdditionalPermissions(scope: "turn" | "session" = "turn"): { decision: Record<string, unknown> } {
  return { decision: { permissions: { fileSystem: null, network: null }, scope } };
}
