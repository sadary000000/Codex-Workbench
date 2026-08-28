import { readFile, writeFile, rm } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after, "utf8");
}

function replaceOnce(text, search, replacement, label) {
  const first = text.indexOf(search);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(search, first + search.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
  return text.slice(0, first) + replacement + text.slice(first + search.length);
}

await patch("src/automation/types.ts", (text) => {
  text = replaceOnce(
    text,
    "  /** Immutable PolicyVersion identity selected when this intent was created; legacy records may omit it. */\n  policyVersionId?: string | null;\n  state: ActionIntentState;",
    "  /** Immutable PolicyVersion identity selected when this intent was created; legacy records may omit it. */\n  policyVersionId?: string | null;\n  /** Exact bounded provider-neutral Planner request descriptor; never the raw provider prompt. */\n  plannerRequestCanonical?: string | null;\n  state: ActionIntentState;",
    "ActionIntent plannerRequestCanonical",
  );
  text = replaceOnce(
    text,
    "  providerObservationRef?: string | null;\n  providerSemanticSha256?: string | null;\n}",
    "  providerObservationRef?: string | null;\n  providerSemanticSha256?: string | null;\n  /** Planner-only logical classification of this concrete provider attempt. */\n  plannerResultClassification?: \"INVALID_OUTPUT_RETRYABLE\" | null;\n}",
    "ActionAttempt plannerResultClassification",
  );
  return text;
});

await patch("src/automation/store.ts", (text) => {
  text = replaceOnce(
    text,
    "  expectedOutcomeRef?: string | null;\n  policyVersionId?: string | null;\n}\n\nexport interface ActionAttemptInput",
    "  expectedOutcomeRef?: string | null;\n  policyVersionId?: string | null;\n  /** Exact bounded provider-neutral Planner request descriptor. */\n  plannerRequestCanonical?: string | null;\n}\n\nexport interface ActionAttemptInput",
    "ActionIntentInput plannerRequestCanonical",
  );
  text = replaceOnce(
    text,
    "const item: ActionIntent = { intentId: id(input.intentId, \"intentId\"), projectId: project.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, actionType, targetRef, sideEffectClass: input.sideEffectClass, payloadRef, payloadHash, executionOptions, semanticSha256, idempotencyRef, expectedOutcomeRef, policyVersionId, state: \"PLANNED\", createdAt: now() };",
    "const item: ActionIntent = { intentId: id(input.intentId, \"intentId\"), projectId: project.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, actionType, targetRef, sideEffectClass: input.sideEffectClass, payloadRef, payloadHash, executionOptions, semanticSha256, idempotencyRef, expectedOutcomeRef, policyVersionId, plannerRequestCanonical: optionalText(input.plannerRequestCanonical, \"intent.plannerRequestCanonical\", 32_768), state: \"PLANNED\", createdAt: now() };",
    "persist plannerRequestCanonical",
  );
  const anchor = "  async attachActionAttemptProvider(input: { actionAttemptId: string; providerRequestRef?: string | null; providerObservationRef?: string | null; providerSemanticSha256?: string | null }): Promise<ActionAttempt> {";
  const method = `  /**\n   * Planner-only semantic classification. The provider action has already\n   * completed successfully, but its returned payload is not a valid Plan.\n   * Keep the successful receipt/attempt intact and fail the logical intent so\n   * a bounded explicit retry can use the existing FAILED -> REAUTHORIZE_RETRY\n   * transition. Unknown outcomes never enter this method.\n   */\n  async markPlannerAttemptInvalidOutput(actionAttemptId: string): Promise<ActionAttempt> {\n    return this.transaction((tx) => {\n      const attempt = tx.require(\"actionAttempts\", actionAttemptId);\n      const intent = tx.require(\"actionIntents\", attempt.intentId);\n      if (intent.actionType !== \"PLANNER_REQUEST\") throw new AutomationStoreError(\"AUTOMATION_CONFLICT\", \"Planner invalid-output classification requires a PLANNER_REQUEST ActionIntent.\");\n      const receipt = tx.table(\"actionReceipts\").find((item) => item.actionAttemptId === actionAttemptId);\n      if (!receipt || receipt.status !== \"SUCCEEDED\" || ![\"TERMINAL_CONFIRMED\", \"RESULT_OBSERVED\"].includes(receipt.outcomeCertainty)) {\n        throw new AutomationStoreError(\"AUTOMATION_CONFLICT\", \"Planner invalid-output retry requires a terminally confirmed successful provider receipt.\");\n      }\n      const updated: ActionAttempt = { ...attempt, plannerResultClassification: \"INVALID_OUTPUT_RETRYABLE\" };\n      tx.replace(\"actionAttempts\", updated);\n      tx.replace(\"actionIntents\", { ...intent, state: \"FAILED\" });\n      tx.appendAudit({ projectId: intent.projectId, entityType: \"ActionAttempt\", entityId: actionAttemptId, eventType: \"PLANNER_RESULT_INVALID_RETRYABLE\", actorType: \"AUTOMATION\", actorRef: null, boundedPayload: { dispatchNumber: attempt.dispatchNumber }, correlationId: intent.intentId, causationId: actionAttemptId });\n      return clone(updated);\n    });\n  }\n\n`;
  text = replaceOnce(text, anchor, method + anchor, "Planner invalid-output store method");
  return text;
});

await patch("src/automation/schema.ts", (text) => {
  text = replaceOnce(
    text,
    "    optionalString(item.policyVersionId ?? null, `actionIntents[${index}].policyVersionId`, 256);\n    if (item.idempotencyRef !== null)",
    "    optionalString(item.policyVersionId ?? null, `actionIntents[${index}].policyVersionId`, 256);\n    optionalString(item.plannerRequestCanonical ?? null, `actionIntents[${index}].plannerRequestCanonical`, 32 * 1024);\n    if (item.idempotencyRef !== null)",
    "schema ActionIntent planner descriptor",
  );
  text = replaceOnce(
    text,
    "    optionalString(item.providerSemanticSha256 ?? null, `actionAttempts[${index}].providerSemanticSha256`, 128);\n    optionalString(item.policyVersionId ?? null, `actionAttempts[${index}].policyVersionId`, 256);",
    "    optionalString(item.providerSemanticSha256 ?? null, `actionAttempts[${index}].providerSemanticSha256`, 128);\n    if (item.plannerResultClassification !== undefined && item.plannerResultClassification !== null) enumValue(item.plannerResultClassification, `actionAttempts[${index}].plannerResultClassification`, new Set([\"INVALID_OUTPUT_RETRYABLE\"]));\n    optionalString(item.policyVersionId ?? null, `actionAttempts[${index}].policyVersionId`, 256);",
    "schema ActionAttempt planner classification",
  );
  return text;
});

await patch("src/automation/planner-provider-integration.ts", (text) => {
  text = replaceOnce(
    text,
    "export interface PlannerReconcileInput {\n  readonly projectId: string;\n  readonly actionAttemptId: string;\n}\n\nexport interface PlannerIntegrationResult",
    "export interface PlannerReconcileInput {\n  readonly projectId: string;\n  readonly actionAttemptId: string;\n}\n\nexport interface PlannerRetryInput {\n  readonly projectId: string;\n  readonly actionIntentId?: string;\n  /** Compatibility alias: in the current model the logical Planner request identity is the ActionIntent identity. */\n  readonly logicalPlannerRequestId?: string;\n  readonly requirementVersionId?: string;\n  readonly requirementPayloadSha256?: string;\n  readonly policyVersionId?: string;\n}\n\nexport interface PlannerIntegrationResult",
    "PlannerRetryInput",
  );
  text = replaceOnce(
    text,
    "const MAX_LIST_ITEMS = 64;\nconst MAX_TEXT = 4_096;",
    "const MAX_LIST_ITEMS = 64;\nconst MAX_TEXT = 4_096;\nconst MAX_PLANNER_PROVIDER_ATTEMPTS = 2;",
    "planner retry bound",
  );
  text = replaceOnce(
    text,
    "      const existingPlan = promotedPlan(snapshot, existingIntent.intentId);\n      if (existingPlan) return emptyResult({ status: \"PLAN_READY\", actionIntentId: existingIntent.intentId, actionAttemptId: existingAttempt?.actionAttemptId ?? null, planVersion: clone(existingPlan), request });\n      if (existingAttempt?.providerRequestRef || existingIntent.state === \"UNCERTAIN\" || existingIntent.state === \"RECOVERY_REQUIRED\") {",
    "      const existingPlan = promotedPlan(snapshot, existingIntent.intentId);\n      if (existingPlan) return emptyResult({ status: \"PLAN_READY\", actionIntentId: existingIntent.intentId, actionAttemptId: existingAttempt?.actionAttemptId ?? null, planVersion: clone(existingPlan), request });\n      if (existingIntent.state === \"FAILED\" && existingAttempt?.plannerResultClassification === \"INVALID_OUTPUT_RETRYABLE\") {\n        return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: existingIntent.intentId, actionAttemptId: existingAttempt.actionAttemptId, providerRequestRef: this.providerRequestOpaque(snapshot, existingAttempt), providerRequestExternalRef: existingAttempt.providerRequestRef ?? null, request, errorCode: \"RETRY_AUTHORIZATION_REQUIRED\", errorMessage: \"The previous provider attempt completed, but its Planner payload was invalid. Use the explicit bounded Planner retry command.\" });\n      }\n      if (existingAttempt?.providerRequestRef || existingIntent.state === \"UNCERTAIN\" || existingIntent.state === \"RECOVERY_REQUIRED\") {",
    "existing retryable Planner result",
  );
  const reconcileAnchor = "  async reconcilePlannerRequest(input: PlannerReconcileInput): Promise<PlannerIntegrationResult> {";
  const retryMethod = `  async retryPlannerRequest(input: PlannerRetryInput): Promise<PlannerIntegrationResult> {\n    const snapshot = await this.store.snapshot();\n    const project = snapshot.automationProjects.find((item) => item.projectId === input.projectId);\n    if (!project) throw new PlannerProviderIntegrationError(\"PROJECT_NOT_FOUND\", \\`Automation Project \\${input.projectId} was not found.\\`);\n    const identityCount = Number(Boolean(input.actionIntentId)) + Number(Boolean(input.logicalPlannerRequestId));\n    if (identityCount !== 1) throw new PlannerProviderIntegrationError(\"INVALID_INPUT\", \"Planner retry requires exactly one logical request identity.\");\n    const logicalId = input.actionIntentId ?? input.logicalPlannerRequestId!;\n    const intent = snapshot.actionIntents.find((item) => item.projectId === project.projectId && item.intentId === logicalId) ?? null;\n    if (!intent || intent.actionType !== \"PLANNER_REQUEST\") throw new PlannerProviderIntegrationError(\"PLANNER_ACTION_NOT_FOUND\", \"The logical Planner request was not found in this project.\");\n    const existingPlan = promotedPlan(snapshot, intent.intentId);\n    const attempts = snapshot.actionAttempts.filter((item) => item.intentId === intent.intentId).sort((left, right) => left.dispatchNumber - right.dispatchNumber);\n    const latest = attempts.at(-1) ?? null;\n    if (existingPlan) return emptyResult({ status: \"PLAN_READY\", actionIntentId: intent.intentId, actionAttemptId: latest?.actionAttemptId ?? null, planVersion: clone(existingPlan) });\n    const request = requestFromIntent(intent);\n    const requirement = snapshot.requirementVersions.find((item) => item.requirementVersionId === request.requirementVersionId) ?? null;\n    if (!requirement || requirement.projectId !== project.projectId || project.activeRequirementVersionId !== requirement.requirementVersionId || ![\"CONFIRMED\", \"ACTIVE\"].includes(requirement.status) || requirement.payloadSha256 !== request.requirementPayloadSha256) {\n      throw new PlannerProviderIntegrationError(\"REQUIREMENT_NOT_CONFIRMED\", \"Planner retry requires the same exact active confirmed RequirementVersion and payload hash.\");\n    }\n    if ((input.requirementVersionId && input.requirementVersionId !== request.requirementVersionId) || (input.requirementPayloadSha256 && input.requirementPayloadSha256 !== request.requirementPayloadSha256)) {\n      throw new PlannerProviderIntegrationError(\"PLANNER_ACTION_MISMATCH\", \"Planner retry Requirement identity does not match the persisted logical request.\");\n    }\n    if (!intent.policyVersionId || intent.policyVersionId !== project.policyVersionId || (input.policyVersionId && input.policyVersionId !== intent.policyVersionId)) {\n      throw new PlannerProviderIntegrationError(\"PLANNER_ACTION_MISMATCH\", \"Planner retry requires the exact current PolicyVersion pinned by the logical request.\");\n    }\n    if (!latest) return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: intent.intentId, request, errorCode: \"ACTION_INCOMPLETE\", errorMessage: \"The logical Planner request has no provider attempt to retry.\" });\n    const latestReceipt = snapshot.actionReceipts.find((item) => item.actionAttemptId === latest.actionAttemptId) ?? null;\n    if (intent.state === \"UNCERTAIN\" || intent.state === \"RECOVERY_REQUIRED\" || latest.state === \"UNCERTAIN\" || latest.state === \"RECOVERY_REQUIRED\" || latestReceipt?.status === \"UNKNOWN\") {\n      return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: intent.intentId, actionAttemptId: latest.actionAttemptId, providerRequestRef: this.providerRequestOpaque(snapshot, latest), providerRequestExternalRef: latest.providerRequestRef ?? null, receiptId: latestReceipt?.receiptId ?? null, request, errorCode: \"RECONCILE_BEFORE_RETRY\", errorMessage: \"The latest Planner provider outcome is uncertain; reconcile the existing attempt before any retry.\" });\n    }\n    if (attempts.length >= MAX_PLANNER_PROVIDER_ATTEMPTS) {\n      return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: intent.intentId, actionAttemptId: latest.actionAttemptId, receiptId: latestReceipt?.receiptId ?? null, request, errorCode: \"RETRY_BUDGET_EXHAUSTED\", errorMessage: \"The bounded Planner provider-attempt budget is exhausted.\" });\n    }\n    if (intent.state !== \"FAILED\" || latest.state !== \"COMPLETED\" || latestReceipt?.status !== \"SUCCEEDED\" || latest.plannerResultClassification !== \"INVALID_OUTPUT_RETRYABLE\" || ![\"TERMINAL_CONFIRMED\", \"RESULT_OBSERVED\"].includes(latestReceipt.outcomeCertainty)) {\n      return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: intent.intentId, actionAttemptId: latest.actionAttemptId, receiptId: latestReceipt?.receiptId ?? null, request, errorCode: \"RETRY_NOT_AUTHORIZED\", errorMessage: \"Planner retry is only allowed after a terminally confirmed provider response was classified as invalid output.\" });\n    }\n\n    await this.store.transitionActionIntent(intent.intentId, \"REAUTHORIZE_RETRY\", { actorType: \"AUTOMATION\", correlationId: intent.intentId, causationId: latest.actionAttemptId, boundedPayload: { previousDispatchNumber: latest.dispatchNumber } });\n    const attempt = await this.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: intent.policyVersionId, executorRef: \"automation.planner-provider\" });\n    await this.store.transitionActionAttempt(attempt.actionAttemptId, \"START\", { actorType: \"AUTOMATION\", correlationId: intent.intentId, causationId: latest.actionAttemptId });\n    let accepted: ProviderRequestAccepted;\n    const requestCorrelation = correlation(intent, attempt, request);\n    try {\n      accepted = await this.provider.submit({ provider: this.provider.provider, operation: request.operation, workflowRole: \"PLANNER\", providerTargetRef: request.providerTargetRef, inputRef: request.inputRefs[0] ?? null, payloadRef: request.inputRefs[0] ?? null, correlation: requestCorrelation, plannerRequest: request });\n    } catch (error) {\n      if (isDefinitiveProviderRejection(error)) {\n        await this.recordFailed(attempt.actionAttemptId, error);\n        return emptyResult({ status: \"PROVIDER_FAILED\", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, request, errorCode: errorCode(error) ?? \"PROVIDER_REJECTED\", errorMessage: errorMessage(error) });\n      }\n      await this.recordSubmitUnknown(attempt.actionAttemptId, error);\n      return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, request, errorCode: \"SUBMIT_OUTCOME_UNKNOWN\", errorMessage: \\`Provider retry submit outcome is unknown; reconcile-only recovery is required. \\${errorMessage(error)}\\` });\n    }\n    if (accepted.provider !== this.provider.provider || accepted.providerTargetRef !== request.providerTargetRef) return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: \"ACCEPTED_IDENTITY_MISMATCH\", errorMessage: \"Provider retry acceptance did not preserve Planner target/provider identity; reconcile only.\" });\n    try { assertAcceptedPolicyProvenance(accepted, intent, attempt); } catch (error) { return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: \"ACCEPTED_POLICY_MISMATCH\", errorMessage: errorMessage(error) }); }\n    let requestExternal: { externalRefId: string; opaqueId: string };\n    try {\n      requestExternal = (await this.store.persistActionAttemptProviderRequest({ projectId: project.projectId, actionAttemptId: attempt.actionAttemptId, provider: accepted.provider, providerRequestRef: accepted.providerRequestRef, providerSemanticSha256: accepted.semanticRef ?? null })).externalRef;\n    } catch (error) {\n      return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: \"ACCEPTED_LOCAL_PERSISTENCE_UNCERTAIN\", errorMessage: errorMessage(error) });\n    }\n    await this.store.transitionActionIntent(intent.intentId, \"DISPATCHED\", { actorType: \"AUTOMATION\", correlationId: intent.intentId, causationId: latest.actionAttemptId });\n    return this.settleObserved({ projectId: project.projectId, intent, attempt: { ...attempt, providerRequestRef: requestExternal.externalRefId, providerSemanticSha256: accepted.semanticRef ?? null }, request, providerRequestRef: accepted.providerRequestRef, requestExternal, providerSemanticRef: accepted.semanticRef ?? null, reconcile: false });\n  }\n\n`;
  text = replaceOnce(text, reconcileAnchor, retryMethod + reconcileAnchor, "Planner retry method");
  text = replaceOnce(
    text,
    "    } catch (error) {\n      return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, errorCode: \"MALFORMED_PROVIDER_RESULT\", errorMessage: errorMessage(error) });\n    }",
    "    } catch (error) {\n      try { await this.store.markPlannerAttemptInvalidOutput(input.attempt.actionAttemptId); } catch (classificationError) {\n        return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, errorCode: \"RETRY_CLASSIFICATION_PERSIST_FAILED\", errorMessage: errorMessage(classificationError) });\n      }\n      return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, errorCode: \"MALFORMED_PROVIDER_RESULT\", errorMessage: errorMessage(error) });\n    }",
    "malformed Planner classification",
  );
  text = replaceOnce(
    text,
    "    if (!validation.valid || !validation.normalizedCandidate) return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, errorCode: \"VALIDATOR_REJECTED\", errorMessage: validation.errors.map((item) => `${item.code}:${item.path}`).join(\"; \").slice(0, 512) });",
    "    if (!validation.valid || !validation.normalizedCandidate) {\n      try { await this.store.markPlannerAttemptInvalidOutput(input.attempt.actionAttemptId); } catch (classificationError) {\n        return emptyResult({ status: \"RECOVERY_REQUIRED\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, errorCode: \"RETRY_CLASSIFICATION_PERSIST_FAILED\", errorMessage: errorMessage(classificationError) });\n      }\n      return emptyResult({ status: \"INVALID_PROVIDER_RESULT\", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, errorCode: \"VALIDATOR_REJECTED\", errorMessage: validation.errors.map((item) => `${item.code}:${item.path}`).join(\"; \").slice(0, 512) });\n    }",
    "validator Planner classification",
  );
  return text;
});

await patch("src/shared/webgpt-control-plane-contract.ts", (text) => {
  text = replaceOnce(
    text,
    "  { name: \"webgpt.requirement\", status: \"STABLE\", description: \"Provider-neutral Requirement alignment entry and recovery lifecycle.\" },\n  { name: \"webgpt.review-submit\"",
    "  { name: \"webgpt.requirement\", status: \"STABLE\", description: \"Provider-neutral Requirement alignment entry and recovery lifecycle.\" },\n  { name: \"webgpt.planner\", status: \"STABLE\", description: \"Provider-neutral Planner create, retry, reconcile, status, and result lifecycle.\" },\n  { name: \"webgpt.review-submit\"",
    "planner capability",
  );
  text = replaceOnce(
    text,
    "  \"webgpt.requirement.reconcile\",\n] as const;",
    "  \"webgpt.requirement.reconcile\",\n  \"webgpt.planner.create\",\n  \"webgpt.planner.reconcile\",\n  \"webgpt.planner.retry\",\n  \"webgpt.planner.status\",\n  \"webgpt.planner.result\",\n] as const;",
    "planner control commands",
  );
  text = replaceOnce(
    text,
    "  \"webgpt.requirement.reconcile\": \"webgpt.requirement\",\n});",
    "  \"webgpt.requirement.reconcile\": \"webgpt.requirement\",\n  \"webgpt.planner.create\": \"webgpt.planner\",\n  \"webgpt.planner.reconcile\": \"webgpt.planner\",\n  \"webgpt.planner.retry\": \"webgpt.planner\",\n  \"webgpt.planner.status\": \"webgpt.planner\",\n  \"webgpt.planner.result\": \"webgpt.planner\",\n});",
    "planner capability routing",
  );
  return text;
});

await patch("src/main/webgpt-control.ts", (text) => {
  text = replaceOnce(
    text,
    "export type WebGptControlCommandName = WebGptCliCommandName | \"webgpt.initialize\";",
    "export type WebGptControlCommandName = WebGptCliCommandName | \"webgpt.initialize\" | \"webgpt.planner.create\" | \"webgpt.planner.reconcile\" | \"webgpt.planner.retry\" | \"webgpt.planner.status\" | \"webgpt.planner.result\";",
    "planner control command type",
  );
  text = replaceOnce(
    text,
    "  requirementRoundId?: string;\n}",
    "  requirementRoundId?: string;\n  requirementVersionId?: string;\n  operation?: \"PLAN_REQUIREMENT\" | \"DETAIL_STAGE\";\n  priorPlanVersionId?: string;\n  targetStageId?: string;\n  planningConstraints?: string[];\n  inputRefs?: string[];\n  idempotencyRef?: string;\n  actionAttemptId?: string;\n  actionIntentId?: string;\n  logicalPlannerRequestId?: string;\n  plannerRequirementPayloadSha256?: string;\n  policyVersionId?: string;\n}",
    "planner control request fields",
  );
  text = replaceOnce(
    text,
    "  if (record.requirementRoundId !== undefined && (typeof record.requirementRoundId !== \"string\" || !record.requirementRoundId.trim() || record.requirementRoundId.length > 256)) return controlError(\"REQUIREMENT_ROUND_INVALID\", \"Requirement roundId 无效。\", record.command, requestId);\n  if (record.targetRequestId",
    "  if (record.requirementRoundId !== undefined && (typeof record.requirementRoundId !== \"string\" || !record.requirementRoundId.trim() || record.requirementRoundId.length > 256)) return controlError(\"REQUIREMENT_ROUND_INVALID\", \"Requirement roundId 无效。\", record.command, requestId);\n  for (const field of [\"requirementVersionId\", \"priorPlanVersionId\", \"targetStageId\", \"idempotencyRef\", \"actionAttemptId\", \"actionIntentId\", \"logicalPlannerRequestId\", \"plannerRequirementPayloadSha256\", \"policyVersionId\"] as const) {\n    const value = record[field];\n    if (value !== undefined && (typeof value !== \"string\" || !value.trim() || value.length > 256)) return controlError(\"PLANNER_FIELD_INVALID\", `Planner field ${field} is invalid.`, record.command, requestId);\n  }\n  if (record.operation !== undefined && record.operation !== \"PLAN_REQUIREMENT\" && record.operation !== \"DETAIL_STAGE\") return controlError(\"PLANNER_OPERATION_INVALID\", \"Planner operation is invalid.\", record.command, requestId);\n  for (const field of [\"planningConstraints\", \"inputRefs\"] as const) {\n    const value = record[field];\n    if (value !== undefined && (!Array.isArray(value) || value.length > 64 || value.some((item) => typeof item !== \"string\" || !item.trim() || item.length > 1_024))) return controlError(\"PLANNER_LIST_INVALID\", `Planner field ${field} is invalid.`, record.command, requestId);\n  }\n  if (record.targetRequestId",
    "planner control field validation",
  );
  text = replaceOnce(
    text,
    "    \"webgpt.requirement.reconcile\": [\"requirementSessionId\", \"requirementRoundId\", \"timeoutMs\"],\n  };",
    "    \"webgpt.requirement.reconcile\": [\"requirementSessionId\", \"requirementRoundId\", \"timeoutMs\"],\n    \"webgpt.planner.create\": [\"projectId\", \"providerTargetRef\", \"requirementVersionId\", \"operation\", \"priorPlanVersionId\", \"targetStageId\", \"planningConstraints\", \"inputRefs\", \"requestId\", \"idempotencyRef\"],\n    \"webgpt.planner.reconcile\": [\"projectId\", \"actionAttemptId\"],\n    \"webgpt.planner.retry\": [\"projectId\", \"actionIntentId\", \"logicalPlannerRequestId\", \"requirementVersionId\", \"plannerRequirementPayloadSha256\", \"policyVersionId\"],\n    \"webgpt.planner.status\": [\"projectId\", \"actionIntentId\"],\n    \"webgpt.planner.result\": [\"projectId\", \"actionIntentId\"],\n  };",
    "planner allowed fields",
  );
  text = replaceOnce(
    text,
    "    ...(typeof record.requirementRoundId === \"string\" ? { requirementRoundId: record.requirementRoundId.trim() } : {}),\n  };",
    "    ...(typeof record.requirementRoundId === \"string\" ? { requirementRoundId: record.requirementRoundId.trim() } : {}),\n    ...(typeof record.requirementVersionId === \"string\" ? { requirementVersionId: record.requirementVersionId.trim() } : {}),\n    ...(record.operation === \"PLAN_REQUIREMENT\" || record.operation === \"DETAIL_STAGE\" ? { operation: record.operation } : {}),\n    ...(typeof record.priorPlanVersionId === \"string\" ? { priorPlanVersionId: record.priorPlanVersionId.trim() } : {}),\n    ...(typeof record.targetStageId === \"string\" ? { targetStageId: record.targetStageId.trim() } : {}),\n    ...(Array.isArray(record.planningConstraints) ? { planningConstraints: record.planningConstraints.map((item) => String(item).trim()) } : {}),\n    ...(Array.isArray(record.inputRefs) ? { inputRefs: record.inputRefs.map((item) => String(item).trim()) } : {}),\n    ...(typeof record.idempotencyRef === \"string\" ? { idempotencyRef: record.idempotencyRef.trim() } : {}),\n    ...(typeof record.actionAttemptId === \"string\" ? { actionAttemptId: record.actionAttemptId.trim() } : {}),\n    ...(typeof record.actionIntentId === \"string\" ? { actionIntentId: record.actionIntentId.trim() } : {}),\n    ...(typeof record.logicalPlannerRequestId === \"string\" ? { logicalPlannerRequestId: record.logicalPlannerRequestId.trim() } : {}),\n    ...(typeof record.plannerRequirementPayloadSha256 === \"string\" ? { plannerRequirementPayloadSha256: record.plannerRequirementPayloadSha256.trim() } : {}),\n    ...(typeof record.policyVersionId === \"string\" ? { policyVersionId: record.policyVersionId.trim() } : {}),\n  };",
    "planner parsed return fields",
  );
  return text;
});

await patch("tests/stage-k1-c-planner-provider.test.ts", (text) => text + `\n\ntest(\"PRE-R2 retries a terminally observed invalid Planner payload once and promotes exactly once\", async () => {\n  const value = await fixture();\n  const provider = new FakePlannerProvider();\n  provider.response = \"not-json\";\n  try {\n    const service = createPlannerProviderIntegrationService({ store: value.store, provider });\n    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });\n    assert.equal(first.status, \"INVALID_PROVIDER_RESULT\");\n    assert.equal(provider.submitted.length, 1);\n    let snapshot = await value.store.snapshot();\n    assert.equal(snapshot.actionIntents[0]?.state, \"FAILED\", \"logical Planner request fails while provider receipt remains successful\");\n    assert.equal(snapshot.actionAttempts[0]?.state, \"COMPLETED\");\n    assert.equal(snapshot.actionAttempts[0]?.plannerResultClassification, \"INVALID_OUTPUT_RETRYABLE\");\n    assert.equal(snapshot.actionReceipts[0]?.status, \"SUCCEEDED\");\n    assert.equal(snapshot.planVersions.length, 0);\n\n    provider.response = candidate();\n    const second = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });\n    assert.equal(second.status, \"PLAN_READY\");\n    assert.equal(provider.submitted.length, 2);\n    snapshot = await value.store.snapshot();\n    assert.deepEqual(snapshot.actionAttempts.map((item) => item.dispatchNumber), [1, 2]);\n    assert.equal(snapshot.actionReceipts.length, 2);\n    assert.equal(snapshot.planVersions.length, 1);\n    assert.equal(snapshot.automationProjects[0]?.activePlanVersionId, second.planVersion?.planVersionId);\n\n    const replay = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });\n    assert.equal(replay.status, \"PLAN_READY\");\n    assert.equal(provider.submitted.length, 2, \"promotion replay must not create provider attempt #3\");\n    assert.equal((await value.store.snapshot()).planVersions.length, 1, \"Plan promotion remains exactly once\");\n  } finally {\n    await dispose(value);\n  }\n});\n\ntest(\"PRE-R2 refuses retry when the latest provider side effect is uncertain\", async () => {\n  const value = await fixture();\n  const provider = new FakePlannerProvider();\n  provider.mode = \"UNKNOWN\";\n  try {\n    const service = createPlannerProviderIntegrationService({ store: value.store, provider });\n    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });\n    assert.equal(first.status, \"RECOVERY_REQUIRED\");\n    const retry = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });\n    assert.equal(retry.status, \"RECOVERY_REQUIRED\");\n    assert.equal(retry.errorCode, \"RECONCILE_BEFORE_RETRY\");\n    assert.equal(provider.submitted.length, 1, \"unknown outcome must never blind-resend\");\n  } finally {\n    await dispose(value);\n  }\n});\n`);

// This bootstrap helper is intentionally ephemeral; the resulting source commit
// must contain only product/test/CI changes, not a permanent self-modifier.
await rm(new URL(import.meta.url), { force: true });
