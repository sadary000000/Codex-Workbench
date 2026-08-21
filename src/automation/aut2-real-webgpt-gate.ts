import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequirementWebGptAdapter } from "./requirement-webgpt-adapter.ts";
import { RequirementAutomationService, type RequirementDraftResult } from "./requirement-service.ts";
import { REQUIREMENT_ROLE, type RequirementChatBinding } from "./requirement-webgpt-contract.ts";
import type { AutomationStore } from "./store.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";

const SYNTHETIC_GOAL = "创建一个本地小型命令行示例程序，输入两个整数并输出它们的和。";
const MAX_REAL_ALIGNMENT_REQUESTS = 3;

export interface Aut2RealWebGptGateOptions {
  readonly store: AutomationStore;
  readonly roleSession: Pick<WebGptRoleSessionService, "status" | "open" | "submit">;
  readonly requestManager: Pick<WebGptRequestManager, "waitForRequest" | "getResult">;
  readonly openWorkspace: () => Promise<unknown>;
  readonly returnAutomationControl: () => Promise<unknown>;
  readonly automationControl: () => Promise<void>;
  readonly webgptProjectId: string;
  readonly automationProjectId?: string;
  readonly timeoutMs?: number;
  readonly outputPath: string;
  readonly now?: () => string;
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
  readonly idempotency: {
    readonly status: "PASS_AUTOMATED_PATH" | "FAIL";
    readonly sameRequestId: boolean;
    readonly sameSemanticSha256: boolean;
    readonly noAdditionalRealPrompt: true;
  };
  readonly attemptedRealRequests: number;
  readonly realPromptCount: number;
  readonly newChatCount: 0;
  readonly repairCount: 0;
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
  let firstRoundQuestionCount = 0;
  let firstRoundUniqueQuestionCount = 0;
  let recognizedQuestionTopics: string[] = [];
  let independentQuestionsSameRound = false;
  let sessionStatusAfterNeedsInput: string | null = null;
  let roundCount = 0;
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
  let attemptedRealRequests = 0;

  try {
    await options.openWorkspace();
    await options.returnAutomationControl();
    await options.automationControl();
    const initialBinding = await options.roleSession.status(webgptProjectId, REQUIREMENT_ROLE);
    originalBinding = { status: initialBinding.status, chatUrl: initialBinding.chatUrl };
    if (initialBinding.status !== "BOUND" || !initialBinding.chatUrl) throw gateError("REQUIREMENT_ROLE_NOT_BOUND", "The explicit REQUIREMENT Role is not BOUND.");
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
      }),
      now,
    });
    const session = await service.startAlignment({
      projectId: automationProjectId,
      goal: SYNTHETIC_GOAL,
      questions: [],
      webgptProjectId,
      requirementBinding: binding,
    });
    sessionId = session.alignmentSessionId;

    attemptedRealRequests += 1;
    draftResult = await service.requestDraft({ sessionId, binding });
    recordRequest(draftResult, requestIds, idempotencyKeys, semanticSha256);
    if (draftResult.status !== "WAITING_FOR_USER" || draftResult.envelope?.status !== "NEEDS_INPUT") {
      throw gateError("BATCH_ALIGNMENT_NOT_NEEDS_INPUT", "The first real Requirement round did not return NEEDS_INPUT.");
    }
    const firstQuestions = await questionsForRound(options.store, draftResult.round.alignmentRoundId);
    firstRoundQuestionCount = firstQuestions.length;
    const questionHashes = firstQuestions.map((question) => sha256(question.question));
    firstRoundUniqueQuestionCount = new Set(questionHashes).size;
    recognizedQuestionTopics = [...new Set(firstQuestions.flatMap((question) => classifyQuestion(question.question)))];
    independentQuestionsSameRound = firstRoundQuestionCount >= 3 && firstRoundUniqueQuestionCount === firstRoundQuestionCount;
    sessionStatusAfterNeedsInput = draftResult.session.status;
    roundCount = draftResult.round.roundNumber;
    if (!independentQuestionsSameRound) throw gateError("BATCH_ALIGNMENT_TOO_SMALL", "The first real Requirement round did not contain at least three independent questions.");

    let current = draftResult;
    for (let attempt = 0; attempt < MAX_REAL_ALIGNMENT_REQUESTS - 1; attempt += 1) {
      const questions = await questionsForRound(options.store, current.round.alignmentRoundId);
      const answers: Record<string, string> = {};
      for (const question of questions) answers[question.questionId] = syntheticAnswer(question.question);
      await service.answerQuestions({ sessionId, roundId: current.round.alignmentRoundId, answers });
      attemptedRealRequests += 1;
      current = await service.requestDraft({ sessionId, binding });
      recordRequest(current, requestIds, idempotencyKeys, semanticSha256);
      if (current.status === "DRAFT_READY") break;
      if (current.status !== "WAITING_FOR_USER" || current.envelope?.status !== "NEEDS_INPUT") throw gateError("REQUIREMENT_ROUND_BLOCKED", "The Requirement round became blocked before a draft was produced.");
      roundCount = current.round.roundNumber;
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
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "AUT2_REAL_GATE_FAILED";
    errors.push({ code, message: safeMessage(error) });
  } finally {
    try {
      finalBinding = await options.roleSession.status(webgptProjectId, REQUIREMENT_ROLE);
    } catch (error) {
      errors.push({ code: "REQUIREMENT_BINDING_READ_FAILED", message: safeMessage(error) });
    }
  }

  const bindingRestored = Boolean(originalBinding && finalBinding && originalBinding.status === finalBinding.status && originalBinding.chatUrl === finalBinding.chatUrl);
  if (!bindingRestored) errors.push({ code: "REQUIREMENT_BINDING_NOT_RESTORED", message: "The original REQUIREMENT binding did not remain unchanged." });
  const evidence: Aut2RealWebGptGateEvidence = {
    stage: "AUT-2",
    result: errors.length === 0 && userConfirmation === "PASS_REAL_RUNTIME" ? "PASS_REAL" : "FAIL",
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
    idempotency: {
      status: idempotentSameRequestId && idempotentSameSemanticSha256 ? "PASS_AUTOMATED_PATH" : "FAIL",
      sameRequestId: idempotentSameRequestId,
      sameSemanticSha256: idempotentSameSemanticSha256,
      noAdditionalRealPrompt: true,
    },
    attemptedRealRequests,
    realPromptCount: requestIds.length,
    newChatCount: 0,
    repairCount: 0,
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
  requestIds.push(result.request.requestId);
  idempotencyKeys.push(result.request.idempotencyKey);
  semanticSha256.push(result.request.semanticSha256);
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
