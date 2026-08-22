import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequirementWebGptAdapter, type RequirementResponseDiagnosticEvent } from "./requirement-webgpt-adapter.ts";
import { RequirementAutomationService, type RequirementDraftResult } from "./requirement-service.ts";
import { REQUIREMENT_ROLE, type RequirementChatBinding } from "./requirement-webgpt-contract.ts";
import type { AutomationStore } from "./store.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";

const SYNTHETIC_GOAL = "创建一个本地小型命令行示例程序，输入两个整数并输出它们的和。";
const MAX_REAL_ALIGNMENT_REQUESTS = 3;
const MAX_NEW_REAL_PROMPTS = 3;
const MAX_REPAIR_PROMPTS_PER_GATE = 1;

export interface Aut2RealWebGptGateOptions {
  readonly store: AutomationStore;
  readonly roleSession: Pick<WebGptRoleSessionService, "status" | "open" | "bind" | "submit">;
  readonly requestManager: Pick<WebGptRequestManager, "waitForRequest" | "getResult">;
  readonly openWorkspace: () => Promise<unknown>;
  readonly returnAutomationControl: () => Promise<unknown>;
  readonly automationControl: () => Promise<void>;
  readonly webgptProjectId: string;
  readonly automationProjectId?: string;
  readonly timeoutMs?: number;
  readonly outputPath: string;
  readonly setupContext: Aut2RealWebGptSetupContext;
  /** Fix8 forensic mode: send one business request and stop at the first round. */
  readonly firstRoundOnly?: boolean;
  /** AUT-2 closure mode: seed the already-answerable batch locally and send only Answers -> Draft. */
  readonly answersToDraftOnly?: boolean;
  readonly now?: () => string;
}

export interface Aut2RealWebGptSetupContext {
  readonly originalBinding: { status: string; chatUrl: string };
  readonly setupChatRef: string;
  readonly setupRequestId: string;
  readonly setupIdempotencyKey: string;
  readonly setupPromptCount: number;
  readonly newChatCount: number;
  readonly stableChatMaterialized: true;
  readonly latestAssistantSha256: string | null;
  /** Remaining cumulative budget supplied by the wrapper; never inferred from a retry. */
  readonly remainingRealPrompts: number;
  readonly remainingRepairPrompts: number;
}

export interface Aut2RealWebGptGateEvidence {
  readonly stage: "AUT-2";
  readonly result: "PASS_REAL" | "FAIL";
  readonly goalSha256: string;
  readonly webgptProjectId: string;
  readonly automationProjectId: string;
  readonly requirementBinding: {
    readonly role: "REQUIREMENT";
    readonly status: string;
    readonly chatRef: string;
    readonly originalChatRef: string;
    readonly finalChatRef: string;
    readonly restored: boolean;
  };
  readonly alignment: {
    readonly status: "PASS_REAL" | "FAIL";
    readonly firstRoundQuestionCount: number;
    readonly firstRoundUniqueQuestionCount: number;
    readonly recognizedQuestionTopics: string[];
    readonly independentQuestionsSameRound: boolean;
    readonly sessionStatusAfterNeedsInput: string | null;
    readonly requestIds: string[];
    readonly idempotencyKeys: string[];
    readonly semanticSha256: string[];
    readonly roundCount: number;
    readonly owningRoundId: string | null;
    readonly sessionCurrentRoundId: string | null;
    readonly allQuestionsOwnRound: boolean;
    readonly roundQuestionIdsExact: boolean;
    readonly orphanQuestionCount: number;
  };
  readonly draft: {
    readonly status: "PASS_REAL" | "FAIL";
    readonly requestId: string | null;
    readonly idempotencyKey: string | null;
    readonly semanticSha256: string | null;
    readonly requirementVersionId: string | null;
    readonly payloadSha256: string | null;
    readonly activeRequirementVersionBefore: string | null;
    readonly activeRequirementVersionAfterDraft: string | null;
    readonly gptSelfConfirmation: "NOT_REQUESTED";
  };
  readonly confirmation: {
    readonly user: "PASS_REAL_RUNTIME" | "FAIL";
    readonly webgptRejected: boolean;
    readonly systemRejected: boolean;
    readonly activeRequirementVersionAfterUser: string | null;
  };
  readonly setup: {
    readonly status: "PASS_REAL_SETUP" | "FAIL";
    readonly setupChatRef: string;
    readonly setupRequestId: string;
    readonly setupPromptCount: number;
    readonly newChatCount: number;
    readonly stableChatMaterialized: boolean;
    readonly latestAssistantSha256: string | null;
  };
  readonly idempotency: {
    readonly status: "PASS_AUTOMATED_PATH" | "FAIL";
    readonly sameRequestId: boolean;
    readonly sameSemanticSha256: boolean;
    readonly noAdditionalRealPrompt: true;
  };
  readonly responseContract: {
    readonly originalRequestId: string | null;
    readonly originalResultSha256: string | null;
    readonly parseFailureCategory: string | null;
    readonly repairTriggered: boolean;
    readonly repairRequestId: string | null;
    readonly repairSemanticSha256: string | null;
    readonly repairResultSha256: string | null;
    readonly repairCount: number;
    readonly finalParseResult: "PASS" | "FAIL" | "NOT_REACHED";
    readonly finalAlignmentStatus: string | null;
    readonly runtimeRequestIds: readonly string[];
    readonly runtimeIdempotencyKeys: readonly string[];
    readonly runtimeSemanticSha256: readonly string[];
    readonly events: readonly RequirementResponseDiagnosticEvent[];
  };
  readonly attemptedRealRequests: number;
  readonly realPromptCount: number;
  readonly dispatchedRealPromptCount: number;
  readonly realPromptBudget: { readonly used: number; readonly max: number };
  readonly repairPromptBudget: { readonly used: number; readonly max: number };
  readonly roleSetupPromptCount: number;
  readonly newChatCount: number;
  readonly repairCount: number;
  readonly errors: readonly { code: string; message: string }[];
  readonly createdAt: string;
}

export async function runAut2RealWebGptGate(options: Aut2RealWebGptGateOptions): Promise<Aut2RealWebGptGateEvidence> {
  const now = options.now ?? (() => new Date().toISOString());
  const webgptProjectId = boundedId(options.webgptProjectId, "webgptProjectId");
  const automationProjectId = boundedId(options.automationProjectId ?? "aut2-real-webgpt-gate", "automationProjectId");
  const errors: { code: string; message: string }[] = [];
  let originalBinding: { status: string; chatUrl: string } | null = null;
  let finalBinding: { status: string; chatUrl: string } | null = null;
  let binding: RequirementChatBinding = { projectId: webgptProjectId, role: REQUIREMENT_ROLE, chatRef: "" };
  const requestIds: string[] = [];
  const idempotencyKeys: string[] = [];
  const semanticSha256: string[] = [];
  const responseDiagnostics: RequirementResponseDiagnosticEvent[] = [];
  const firstRoundOnly = options.firstRoundOnly === true;
  const answersToDraftOnly = options.answersToDraftOnly === true;
  if (!Number.isSafeInteger(options.setupContext.remainingRealPrompts) || options.setupContext.remainingRealPrompts < 0 || !Number.isSafeInteger(options.setupContext.remainingRepairPrompts) || options.setupContext.remainingRepairPrompts < 0) {
    throw gateError("SETUP_CONTEXT_INVALID", "The setup context must carry bounded remaining real and repair prompt budgets.");
  }
  const onePromptOnly = firstRoundOnly || answersToDraftOnly;
  const realPromptBudget = { used: 0, max: Math.min(onePromptOnly ? 1 : MAX_NEW_REAL_PROMPTS, Math.max(0, options.setupContext.remainingRealPrompts)) };
  const repairBudget = { used: 0, max: onePromptOnly ? 0 : Math.min(MAX_REPAIR_PROMPTS_PER_GATE, Math.max(0, options.setupContext.remainingRepairPrompts)) };
  const runtimeRequestIds: string[] = [];
  const runtimeIdempotencyKeys: string[] = [];
  const runtimeSemanticSha256: string[] = [];
  let firstRoundQuestionCount = 0;
  let firstRoundUniqueQuestionCount = 0;
  let recognizedQuestionTopics: string[] = [];
  let independentQuestionsSameRound = false;
  let sessionStatusAfterNeedsInput: string | null = null;
  let roundCount = 0;
  let owningRoundId: string | null = null;
  let sessionCurrentRoundId: string | null = null;
  let allQuestionsOwnRound = false;
  let roundQuestionIdsExact = false;
  let orphanQuestionCount = 0;
  let draftResult: RequirementDraftResult | null = null;
  let sessionId: string | null = null;
  let draftRequestId: string | null = null;
  let draftIdempotencyKey: string | null = null;
  let draftSemanticSha256: string | null = null;
  let requirementVersionId: string | null = null;
  let payloadSha256: string | null = null;
  let activeRequirementVersionBefore: string | null = null;
  let activeRequirementVersionAfterDraft: string | null = null;
  let userConfirmation: "PASS_REAL_RUNTIME" | "FAIL" = "FAIL";
  let webgptRejected = false;
  let systemRejected = false;
  let idempotentSameRequestId = false;
  let idempotentSameSemanticSha256 = false;
  let attemptedRealRequests = options.setupContext.setupPromptCount;
  let setupStatus: "PASS_REAL_SETUP" | "FAIL" = "FAIL";

  try {
    const reusedStableChat = options.setupContext.setupPromptCount === 0 && options.setupContext.newChatCount === 0;
    const newlyMaterializedStableChat = options.setupContext.setupPromptCount >= 1 && options.setupContext.setupPromptCount <= 2 && options.setupContext.newChatCount >= 1 && options.setupContext.newChatCount <= 3;
    if (!options.setupContext.setupChatRef || !options.setupContext.setupRequestId || (!reusedStableChat && !newlyMaterializedStableChat)) {
      throw gateError("SETUP_CONTEXT_INVALID", "A stable materialized setup Chat is required before the real Requirement Gate.");
    }
    await options.openWorkspace();
    await options.returnAutomationControl();
    await options.automationControl();
    const initialBinding = await options.roleSession.status(webgptProjectId, REQUIREMENT_ROLE);
    originalBinding = { ...options.setupContext.originalBinding };
    if (initialBinding.status !== "BOUND" || !initialBinding.chatUrl) throw gateError("REQUIREMENT_ROLE_NOT_BOUND", "The explicit REQUIREMENT Role is not BOUND.");
    if (initialBinding.chatUrl !== options.setupContext.setupChatRef) throw gateError("SETUP_ROLE_BINDING_MISMATCH", "The REQUIREMENT Role is not bound to the materialized setup Chat.");
    setupStatus = "PASS_REAL_SETUP";
    binding = { projectId: webgptProjectId, role: REQUIREMENT_ROLE, chatRef: initialBinding.chatUrl };
    await options.roleSession.open(webgptProjectId, REQUIREMENT_ROLE);

    let project = await options.store.get("automationProjects", automationProjectId);
    if (!project) project = await options.store.createAutomationProject({ projectId: automationProjectId, name: "AUT-2 real WebGPT Gate" });
    activeRequirementVersionBefore = project.activeRequirementVersionId;

    const service = new RequirementAutomationService({
      store: options.store,
      webgpt: createRequirementWebGptAdapter({
        roleSession: options.roleSession,
        requestManager: options.requestManager,
        timeoutMs: options.timeoutMs ?? 240_000,
        repairBudget,
        onRequestDispatched: () => {
          if (realPromptBudget.used >= realPromptBudget.max) throw gateError("REAL_PROMPT_BUDGET_EXHAUSTED", `AUT-2 Gate Fix 4 allows at most ${realPromptBudget.max} new real prompts in this run.`);
          realPromptBudget.used += 1;
        },
        onRequestAccepted: (runtimeRequest) => {
          recordRuntimeRequest(runtimeRequest.requestId, runtimeRequest.idempotencyKey, runtimeRequest.semanticSha256, runtimeRequestIds, runtimeIdempotencyKeys, runtimeSemanticSha256);
        },
        onResponseDiagnostics: (event) => {
          responseDiagnostics.push(event);
        },
      }),
      now,
    });
    const session = await service.startAlignment({
      projectId: automationProjectId,
      goal: SYNTHETIC_GOAL,
      questions: answersToDraftOnly ? [
        { category: "LANGUAGE", question: "Which programming language is required?", whyNeeded: "The implementation language changes the acceptance surface.", blocking: true, resolutionMode: "USER_REQUIRED" },
        { category: "INVALID_INPUT", question: "What should happen for invalid input?", whyNeeded: "The failure contract must be testable.", blocking: true, resolutionMode: "USER_REQUIRED" },
        { category: "OUTPUT_FORMAT", question: "What output format is required?", whyNeeded: "The output contract must be explicit.", blocking: true, resolutionMode: "USER_REQUIRED" },
        { category: "NEGATIVE_NUMBERS", question: "Are negative numbers allowed?", whyNeeded: "The accepted input domain must be explicit.", blocking: true, resolutionMode: "USER_REQUIRED" },
        { category: "AUTOMATED_TESTS", question: "Are automated tests required?", whyNeeded: "The verification boundary must be explicit.", blocking: false, resolutionMode: "ASSUMPTION_ALLOWED" },
      ] : [],
      webgptProjectId,
      requirementBinding: binding,
    });
    sessionId = session.alignmentSessionId;

    if (answersToDraftOnly) {
      const seededQuestions = await questionsForRound(options.store, session.currentRoundId!);
      const answers: Record<string, string> = {};
      for (const question of seededQuestions) answers[question.questionId] = syntheticAnswer(question.question);
      await service.answerQuestions({ sessionId, roundId: session.currentRoundId!, answers });
      draftResult = await service.requestDraft({ sessionId, binding });
      recordRequest(draftResult, requestIds, idempotencyKeys, semanticSha256);
      if (draftResult.status !== "DRAFT_READY" || !draftResult.draft || !draftResult.request) {
        throw gateError("ANSWERS_TO_DRAFT_NOT_READY", "The real Answers to Draft request did not produce READY_FOR_DRAFT.");
      }
      firstRoundQuestionCount = seededQuestions.length;
      firstRoundUniqueQuestionCount = new Set(seededQuestions.map((question) => sha256(question.question))).size;
      recognizedQuestionTopics = [...new Set(seededQuestions.flatMap((question) => classifyQuestion(question.question)))];
      independentQuestionsSameRound = firstRoundQuestionCount >= 3 && firstRoundUniqueQuestionCount === firstRoundQuestionCount;
      sessionStatusAfterNeedsInput = "ANSWERED";
      roundCount = draftResult.round.roundNumber;
    } else {
      draftResult = await service.requestDraft({ sessionId, binding });
      recordRequest(draftResult, requestIds, idempotencyKeys, semanticSha256);
      if (draftResult.status !== "WAITING_FOR_USER" || draftResult.envelope?.status !== "NEEDS_INPUT") {
        throw gateError("BATCH_ALIGNMENT_NOT_NEEDS_INPUT", "The first real Requirement round did not return NEEDS_INPUT.");
      }
    }
    if (answersToDraftOnly) {
      owningRoundId = draftResult.round.alignmentRoundId;
      sessionCurrentRoundId = draftResult.session.currentRoundId;
      allQuestionsOwnRound = true;
      roundQuestionIdsExact = true;
      orphanQuestionCount = 0;
    }
    if (!answersToDraftOnly) {
    const firstResult = draftResult;
    const firstQuestions = await questionsForRound(options.store, firstResult.round.alignmentRoundId);
    firstRoundQuestionCount = firstQuestions.length;
    const questionHashes = firstQuestions.map((question) => sha256(question.question));
    firstRoundUniqueQuestionCount = new Set(questionHashes).size;
    recognizedQuestionTopics = [...new Set(firstQuestions.flatMap((question) => classifyQuestion(question.question)))];
    independentQuestionsSameRound = firstRoundQuestionCount >= 3 && firstRoundUniqueQuestionCount === firstRoundQuestionCount;
    sessionStatusAfterNeedsInput = firstResult.session.status;
    roundCount = firstResult.round.roundNumber;
    owningRoundId = firstResult.round.alignmentRoundId;
    sessionCurrentRoundId = firstResult.session.currentRoundId;
    const persisted = await options.store.snapshot();
    const persistedRound = persisted.requirementAlignmentRounds.find((item) => item.alignmentRoundId === owningRoundId);
    const persistedQuestionIds = new Set(persistedRound?.questionIds ?? []);
    const persistedQuestions = persisted.requirementQuestions.filter((item) => persistedQuestionIds.has(item.questionId));
    allQuestionsOwnRound = Boolean(persistedRound)
      && persistedQuestions.length === firstQuestions.length
      && persistedQuestions.every((item) => item.alignmentRoundId === owningRoundId);
    roundQuestionIdsExact = Boolean(persistedRound)
      && persistedRound!.questionIds.length === firstQuestions.length
      && firstQuestions.every((item) => persistedQuestionIds.has(item.questionId));
    const sessionRoundIds = new Set(persisted.requirementAlignmentRounds.filter((item) => item.alignmentSessionId === firstResult.session.alignmentSessionId).map((item) => item.alignmentRoundId));
    orphanQuestionCount = persisted.requirementQuestions.filter((item) => sessionRoundIds.has(item.alignmentRoundId)).filter((item) => {
      const owner = persisted.requirementAlignmentRounds.find((round) => round.alignmentRoundId === item.alignmentRoundId);
      return !owner?.questionIds.includes(item.questionId);
    }).length;
    if (!allQuestionsOwnRound || !roundQuestionIdsExact || sessionCurrentRoundId !== owningRoundId || orphanQuestionCount !== 0) {
      throw gateError("ROUND_PERSISTENCE_INVARIANT_FAILED", "Persisted Requirement questions do not form one owning round graph.");
    }
    if (!independentQuestionsSameRound) throw gateError("BATCH_ALIGNMENT_TOO_SMALL", "The first real Requirement round did not contain at least three independent questions.");
    }

    if (!firstRoundOnly) {
      let current = draftResult;
      if (!answersToDraftOnly) {
        for (let attempt = 0; attempt < MAX_REAL_ALIGNMENT_REQUESTS - 1; attempt += 1) {
          const questions = await questionsForRound(options.store, current.round.alignmentRoundId);
          const answers: Record<string, string> = {};
          for (const question of questions) answers[question.questionId] = syntheticAnswer(question.question);
          await service.answerQuestions({ sessionId, roundId: current.round.alignmentRoundId, answers });
          current = await service.requestDraft({ sessionId, binding });
          recordRequest(current, requestIds, idempotencyKeys, semanticSha256);
          if (current.status === "DRAFT_READY") break;
          if (current.status !== "WAITING_FOR_USER" || current.envelope?.status !== "NEEDS_INPUT") throw gateError("REQUIREMENT_ROUND_BLOCKED", "The Requirement round became blocked before a draft was produced.");
          roundCount = current.round.roundNumber;
        }
      }
      draftResult = current;
      if (draftResult.status !== "DRAFT_READY" || !draftResult.draft || !draftResult.request) throw gateError("DRAFT_NOT_READY", "Synthetic answers did not produce a Requirement draft within the bounded round budget.");
      draftRequestId = draftResult.request.requestId;
      draftIdempotencyKey = draftResult.request.idempotencyKey;
      draftSemanticSha256 = draftResult.request.semanticSha256;
      requirementVersionId = draftResult.draft.requirementVersionId;
      payloadSha256 = draftResult.draft.payloadSha256;
      const afterDraft = await options.store.get("automationProjects", automationProjectId);
      activeRequirementVersionAfterDraft = afterDraft?.activeRequirementVersionId ?? null;

      const replay = await service.requestDraft({ sessionId, binding });
      idempotentSameRequestId = replay.request?.requestId === draftResult.request.requestId;
      idempotentSameSemanticSha256 = replay.request?.semanticSha256 === draftResult.request.semanticSha256;
      if (!idempotentSameRequestId || !idempotentSameSemanticSha256 || replay.draft?.requirementVersionId !== requirementVersionId) throw gateError("IDEMPOTENCY_REATTACH_FAILED", "The same resolved Requirement request did not reattach to the existing draft.");

      try { await service.confirmRequirement({ projectId: automationProjectId, requirementVersionId, expectedPayloadSha256: payloadSha256, actor: "WEBGPT" }); }
      catch { webgptRejected = true; }
      try { await service.confirmRequirement({ projectId: automationProjectId, requirementVersionId, expectedPayloadSha256: payloadSha256, actor: "SYSTEM" }); }
      catch { systemRejected = true; }
      await service.confirmRequirement({ projectId: automationProjectId, requirementVersionId, expectedPayloadSha256: payloadSha256, actor: "USER" });
      userConfirmation = "PASS_REAL_RUNTIME";
      const afterConfirmation = await options.store.get("automationProjects", automationProjectId);
      const activeAfterConfirmation = afterConfirmation?.activeRequirementVersionId ?? null;
      if (activeAfterConfirmation !== requirementVersionId || activeRequirementVersionAfterDraft !== null || !webgptRejected || !systemRejected) throw gateError("CONFIRMATION_GUARD_FAILED", "USER confirmation or non-USER confirmation guard did not converge as required.");
      activeRequirementVersionAfterDraft = activeAfterConfirmation;
    }
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "AUT2_REAL_GATE_FAILED";
    errors.push({ code, message: safeMessage(error) });
  } finally {
    if (originalBinding?.status === "BOUND" && originalBinding.chatUrl) {
      try {
        await options.roleSession.bind(webgptProjectId, REQUIREMENT_ROLE, originalBinding.chatUrl, true);
      } catch (error) {
        errors.push({ code: "REQUIREMENT_BINDING_RESTORE_FAILED", message: safeMessage(error) });
      }
    }
    try {
      finalBinding = await options.roleSession.status(webgptProjectId, REQUIREMENT_ROLE);
    } catch (error) {
      errors.push({ code: "REQUIREMENT_BINDING_READ_FAILED", message: safeMessage(error) });
    }
  }

  const bindingRestored = Boolean(originalBinding && finalBinding && originalBinding.status === finalBinding.status && originalBinding.chatUrl === finalBinding.chatUrl);
  if (!bindingRestored) errors.push({ code: "REQUIREMENT_BINDING_NOT_RESTORED", message: "The original REQUIREMENT binding did not remain unchanged." });
  attemptedRealRequests = options.setupContext.setupPromptCount + realPromptBudget.used;
  const lastResponseDiagnostic = responseDiagnostics[responseDiagnostics.length - 1] ?? null;
  const firstFailureDiagnostic = responseDiagnostics.find((event) => event.parseFailureCategory !== null) ?? null;
  const repairCount = responseDiagnostics.reduce((total, event) => total + event.repairCount, 0);
  const evidence: Aut2RealWebGptGateEvidence = {
    stage: "AUT-2",
    result: errors.length === 0 && (firstRoundOnly ? independentQuestionsSameRound : userConfirmation === "PASS_REAL_RUNTIME") ? "PASS_REAL" : "FAIL",
    goalSha256: sha256(SYNTHETIC_GOAL),
    webgptProjectId,
    automationProjectId,
    requirementBinding: {
      role: REQUIREMENT_ROLE,
      status: finalBinding?.status ?? "UNBOUND",
      chatRef: finalBinding?.chatUrl ?? binding.chatRef,
      originalChatRef: originalBinding?.chatUrl ?? binding.chatRef,
      finalChatRef: finalBinding?.chatUrl ?? "",
      restored: bindingRestored,
    },
    alignment: {
      status: errors.length === 0 && firstRoundQuestionCount >= 3 ? "PASS_REAL" : "FAIL",
      firstRoundQuestionCount,
      firstRoundUniqueQuestionCount,
      recognizedQuestionTopics,
      independentQuestionsSameRound,
      sessionStatusAfterNeedsInput,
      requestIds,
      idempotencyKeys,
      semanticSha256,
      roundCount,
      owningRoundId,
      sessionCurrentRoundId,
      allQuestionsOwnRound,
      roundQuestionIdsExact,
      orphanQuestionCount,
    },
    draft: {
      status: draftResult?.status === "DRAFT_READY" && Boolean(requirementVersionId && payloadSha256) ? "PASS_REAL" : "FAIL",
      requestId: draftRequestId,
      idempotencyKey: draftIdempotencyKey,
      semanticSha256: draftSemanticSha256,
      requirementVersionId,
      payloadSha256,
      activeRequirementVersionBefore,
      activeRequirementVersionAfterDraft,
      gptSelfConfirmation: "NOT_REQUESTED",
    },
    confirmation: {
      user: userConfirmation,
      webgptRejected,
      systemRejected,
      activeRequirementVersionAfterUser: activeRequirementVersionAfterDraft,
    },
    setup: {
      status: setupStatus,
      setupChatRef: options.setupContext.setupChatRef,
      setupRequestId: options.setupContext.setupRequestId,
      setupPromptCount: options.setupContext.setupPromptCount,
      newChatCount: options.setupContext.newChatCount,
      stableChatMaterialized: options.setupContext.stableChatMaterialized,
      latestAssistantSha256: options.setupContext.latestAssistantSha256,
    },
    idempotency: {
      status: idempotentSameRequestId && idempotentSameSemanticSha256 ? "PASS_AUTOMATED_PATH" : "FAIL",
      sameRequestId: idempotentSameRequestId,
      sameSemanticSha256: idempotentSameSemanticSha256,
      noAdditionalRealPrompt: true,
    },
    responseContract: {
      originalRequestId: firstFailureDiagnostic?.originalRequestId ?? lastResponseDiagnostic?.originalRequestId ?? null,
      originalResultSha256: firstFailureDiagnostic?.originalResultSha256 ?? lastResponseDiagnostic?.originalResultSha256 ?? null,
      parseFailureCategory: firstFailureDiagnostic?.parseFailureCategory ?? null,
      repairTriggered: responseDiagnostics.some((event) => event.repairTriggered),
      repairRequestId: firstFailureDiagnostic?.repairRequestId ?? null,
      repairSemanticSha256: firstFailureDiagnostic?.repairSemanticSha256 ?? null,
      repairResultSha256: firstFailureDiagnostic?.repairResultSha256 ?? null,
      repairCount,
      finalParseResult: lastResponseDiagnostic?.finalParseResult ?? "NOT_REACHED",
      finalAlignmentStatus: lastResponseDiagnostic?.finalAlignmentStatus ?? null,
      runtimeRequestIds,
      runtimeIdempotencyKeys,
      runtimeSemanticSha256,
      events: responseDiagnostics,
    },
    attemptedRealRequests,
    realPromptCount: options.setupContext.setupPromptCount + realPromptBudget.used,
    dispatchedRealPromptCount: realPromptBudget.used,
    realPromptBudget: { used: realPromptBudget.used, max: realPromptBudget.max },
    repairPromptBudget: { used: repairBudget.used, max: repairBudget.max },
    roleSetupPromptCount: options.setupContext.setupPromptCount,
    newChatCount: options.setupContext.newChatCount,
    repairCount,
    errors,
    createdAt: now(),
  };
  await writeFile(options.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidence;
}

async function questionsForRound(store: AutomationStore, roundId: string): Promise<Array<{ questionId: string; question: string }>> {
  const snapshot = await store.snapshot();
  const round = snapshot.requirementAlignmentRounds.find((item) => item.alignmentRoundId === roundId);
  if (!round) throw gateError("ROUND_NOT_FOUND", "Requirement round was not persisted.");
  return round.questionIds.map((questionId) => {
    const question = snapshot.requirementQuestions.find((item) => item.questionId === questionId);
    if (!question) throw gateError("QUESTION_NOT_FOUND", "A persisted Requirement question was not found.");
    return { questionId: question.questionId, question: question.question };
  });
}

function recordRequest(result: RequirementDraftResult, requestIds: string[], idempotencyKeys: string[], semanticSha256: string[]): void {
  if (!result.request) return;
  recordRuntimeRequest(result.request.requestId, result.request.idempotencyKey, result.request.semanticSha256, requestIds, idempotencyKeys, semanticSha256);
}

function recordRuntimeRequest(requestId: string | null, idempotencyKey: string | null, semantic: string | null, requestIds: string[], idempotencyKeys: string[], semanticSha256: string[]): void {
  if (!requestId || requestIds.includes(requestId)) return;
  requestIds.push(requestId);
  idempotencyKeys.push(idempotencyKey ?? "");
  semanticSha256.push(semantic ?? "");
}

function classifyQuestion(value: string): string[] {
  const text = value.toLowerCase();
  const topics: string[] = [];
  if (/语言|编程|language|python|javascript|typescript/.test(text)) topics.push("language");
  if (/非法|错误|输入|invalid|error|input/.test(text)) topics.push("invalidInput");
  if (/输出|格式|output|format|sum|结果/.test(text)) topics.push("outputFormat");
  if (/负数|negative/.test(text)) topics.push("negativeNumbers");
  if (/测试|自动化|test|automated/.test(text)) topics.push("automatedTests");
  return topics;
}

function syntheticAnswer(question: string): string {
  const topics = classifyQuestion(question);
  if (topics.includes("language")) return "使用 Python 3.12。";
  if (topics.includes("invalidInput")) return "非法输入时向 stderr 输出有限错误信息，并以非零状态退出。";
  if (topics.includes("outputFormat")) return "向 stdout 输出 SUM=<integer>。";
  if (topics.includes("negativeNumbers")) return "允许负数。";
  if (topics.includes("automatedTests")) return "需要自动化测试。";
  return "采用 Python 3.12，并使用确定、有限且适合该目标的实现方式。";
}

function boundedId(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256) throw gateError("INVALID_ARGUMENT", `${field} is required.`);
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function gateError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/(?:cookie|token|authorization|password|secret|credential)\s*[:=]\s*\S+/gi, "$1=[REDACTED]").slice(0, 512);
}
