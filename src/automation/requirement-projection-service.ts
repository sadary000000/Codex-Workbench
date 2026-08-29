import { AutomationStore } from "./store.ts";
import type { RequirementAssumption, RequirementQuestion } from "./types.ts";
import type {
  AutomationRequirementAssumptionView,
  AutomationRequirementContentView,
  AutomationRequirementProjectView,
  AutomationRequirementQuestionView,
} from "../shared/automation-requirement-types.ts";

const MAX_ITEMS = 64;
const MAX_TEXT = 4_096;
const CONTENT_KEYS = [
  "schemaVersion", "goal", "scope", "outOfScope", "functionalRequirements", "technicalConstraints",
  "environmentConstraints", "acceptanceCriteria", "riskConstraints", "externalDependencies", "assumptions",
  "humanApprovalPoints", "knownDeferredGates", "createdFromAlignmentSessionId",
] as const;

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= MAX_TEXT ? text : null;
}

function boundedList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const items = value.map((item) => boundedString(item));
  return items.some((item) => item === null) ? null : items as string[];
}

function parseRequirementContent(
  canonicalPayload: string,
  requirementVersionId: string,
  issues: string[],
): { content: AutomationRequirementContentView; sourceAlignmentSessionId: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(canonicalPayload);
  } catch {
    issues.push(`REQUIREMENT_PAYLOAD_INVALID_JSON:${requirementVersionId}`);
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`REQUIREMENT_PAYLOAD_INVALID_SHAPE:${requirementVersionId}`);
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || Object.keys(record).length !== CONTENT_KEYS.length || CONTENT_KEYS.some((key) => !(key in record))) {
    issues.push(`REQUIREMENT_PAYLOAD_INVALID_SHAPE:${requirementVersionId}`);
    return null;
  }
  const goal = boundedString(record.goal);
  const sourceAlignmentSessionId = boundedString(record.createdFromAlignmentSessionId);
  const scope = boundedList(record.scope);
  const outOfScope = boundedList(record.outOfScope);
  const functionalRequirements = boundedList(record.functionalRequirements);
  const technicalConstraints = boundedList(record.technicalConstraints);
  const environmentConstraints = boundedList(record.environmentConstraints);
  const acceptanceCriteria = boundedList(record.acceptanceCriteria);
  const riskConstraints = boundedList(record.riskConstraints);
  const externalDependencies = boundedList(record.externalDependencies);
  const assumptions = boundedList(record.assumptions);
  const humanApprovalPoints = boundedList(record.humanApprovalPoints);
  const knownDeferredGates = boundedList(record.knownDeferredGates);
  if (!goal || !sourceAlignmentSessionId || !scope || !outOfScope || !functionalRequirements || !technicalConstraints || !environmentConstraints || !acceptanceCriteria || !riskConstraints || !externalDependencies || !assumptions || !humanApprovalPoints || !knownDeferredGates || functionalRequirements.length === 0) {
    issues.push(`REQUIREMENT_PAYLOAD_INVALID_BOUNDS:${requirementVersionId}`);
    return null;
  }
  return {
    sourceAlignmentSessionId,
    content: {
      goal,
      scope,
      outOfScope,
      functionalRequirements,
      technicalConstraints,
      environmentConstraints,
      acceptanceCriteria,
      riskConstraints,
      externalDependencies,
      assumptions,
      humanApprovalPoints,
      knownDeferredGates,
    },
  };
}

function questionView(question: RequirementQuestion): AutomationRequirementQuestionView {
  return {
    questionId: question.questionId,
    ordinal: question.ordinal,
    category: question.category ?? null,
    question: question.question,
    whyNeeded: question.whyNeeded ?? null,
    blocking: question.blocking,
    resolutionMode: question.resolutionMode,
    status: question.status,
    answer: question.answer,
    options: [...(question.options ?? [])],
    defaultRecommendation: question.defaultRecommendation ?? null,
    dependsOn: [...(question.dependsOn ?? [])],
  };
}

function assumptionView(assumption: RequirementAssumption): AutomationRequirementAssumptionView {
  return {
    assumptionId: assumption.assumptionId,
    statement: assumption.statement,
    impact: assumption.impact ?? null,
    confidence: assumption.confidence ?? null,
    blocking: assumption.blocking ?? false,
    status: assumption.status,
    rationale: assumption.rationale,
  };
}

/** Read-only bounded projection for user Requirement review and question answering. */
export class AutomationRequirementProjectionService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async inspect(projectId: string): Promise<AutomationRequirementProjectView> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new Error(`AUTOMATION_REQUIREMENT_PROJECT_NOT_FOUND:${projectId}`);
    const issues: string[] = [];
    const sessions = document.requirementAlignmentSessions
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.alignmentSessionId.localeCompare(left.alignmentSessionId));
    const liveSessions = sessions.filter((item) => !["CANCELLED", "SUPERSEDED", "CONFIRMED"].includes(item.status));
    if (liveSessions.length > 1) issues.push(`MULTIPLE_LIVE_REQUIREMENT_SESSIONS:${liveSessions.length}`);
    const session = liveSessions[0] ?? sessions[0] ?? null;
    let roundView: AutomationRequirementProjectView["alignment"] extends infer T ? never : never;
    let alignment: AutomationRequirementProjectView["alignment"] = null;
    if (session) {
      let round = null;
      if (session.currentRoundId) {
        round = document.requirementAlignmentRounds.find((item) => item.alignmentRoundId === session.currentRoundId) ?? null;
        if (!round || round.alignmentSessionId !== session.alignmentSessionId) {
issues.push(`CURRENT_REQUIREMENT_ROUND_INVALID:${session.currentRoundId}`);
round = null;
        }
      }
      const questions: AutomationRequirementQuestionView[] = [];
      const assumptions: AutomationRequirementAssumptionView[] = [];
      if (round) {
        for (const questionId of round.questionIds) {
const question = document.requirementQuestions.find((item) => item.questionId === questionId);
if (!question || question.alignmentRoundId !== round.alignmentRoundId) issues.push(`REQUIREMENT_QUESTION_INVALID:${questionId}`);
else questions.push(questionView(question));
        }
        for (const assumptionId of round.assumptionIds) {
const assumption = document.requirementAssumptions.find((item) => item.assumptionId === assumptionId);
if (!assumption || assumption.alignmentSessionId !== session.alignmentSessionId) issues.push(`REQUIREMENT_ASSUMPTION_INVALID:${assumptionId}`);
else assumptions.push(assumptionView(assumption));
        }
      }
      alignment = {
        session: {
alignmentSessionId: session.alignmentSessionId,
status: session.status,
goal: session.goal ?? null,
currentRoundId: session.currentRoundId,
latestDraftVersionId: session.latestDraftVersionId ?? null,
updatedAt: session.updatedAt,
        },
        round: round ? {
alignmentRoundId: round.alignmentRoundId,
roundNumber: round.roundNumber,
status: round.status,
questions,
assumptions,
        } : null,
      };
    }

    const requirementVersionId = session?.latestDraftVersionId ?? project.activeRequirementVersionId;
    let requirement: AutomationRequirementProjectView["requirement"] = null;
    if (requirementVersionId) {
      const version = document.requirementVersions.find((item) => item.requirementVersionId === requirementVersionId) ?? null;
      if (!version || version.projectId !== projectId) {
        issues.push(`REQUIREMENT_VERSION_INVALID:${requirementVersionId}`);
      } else {
        const parsed = parseRequirementContent(version.canonicalPayload, version.requirementVersionId, issues);
        if (parsed) {
requirement = {
  requirementVersionId: version.requirementVersionId,
  version: version.version,
  status: version.status,
  payloadSha256: version.payloadSha256,
  createdAt: version.createdAt,
  confirmedAt: version.confirmedAt,
  sourceAlignmentSessionId: parsed.sourceAlignmentSessionId,
  content: parsed.content,
};
        }
      }
    }

    return {
      project: {
        projectId: project.projectId,
        name: project.name,
        lifecycle: project.lifecycle,
        activeRequirementVersionId: project.activeRequirementVersionId,
        activePlanVersionId: project.activePlanVersionId,
      },
      alignment,
      requirement,
      integrity: { status: issues.length === 0 ? "OK" : "DEGRADED", issues },
    };
  }
}
