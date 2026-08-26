import type { WebGptTargetReadiness, WebGptTargetReadinessState } from "../types.ts";
import type { WebGptNetworkCandidateState } from "../network/network-types.ts";

export interface WebGptTargetReadinessInput {
  expectedChatUrl: string;
  actualChatUrl: string | null;
  navigationReady: boolean;
  onChatPage: boolean;
  composerFound: boolean;
  historyReady: boolean;
  observerExpectedChatUrl: string | null;
  observerCandidateState: WebGptNetworkCandidateState;
  /** Allows the adapter to prove a bounded route alias without hiding the raw page URL. */
  identityMatches?: boolean;
  observerIdentityMatches?: boolean;
  /** A fresh observer epoch is distinct from a network completion candidate. */
  observerReady?: boolean;
}

const UNCERTAIN_OBSERVER_STATES = new Set<WebGptNetworkCandidateState>(["STALE", "AMBIGUOUS"]);

export function resolveWebGptTargetReadiness(input: WebGptTargetReadinessInput): WebGptTargetReadiness {
  // A home page (or a page whose canonical Chat identity is not available yet)
  // is not evidence that the target is wrong.  During Electron/SPA navigation
  // ChatGPT can briefly expose its global composer before the /c/:id route and
  // history have hydrated.  Treat that state as waiting; reserve mismatch for
  // a known, different Chat identity so A/B safety remains fail-closed.
  const pageIdentityKnown = input.actualChatUrl !== null;
  const pageIdentityMatches = pageIdentityKnown && (input.identityMatches ?? input.actualChatUrl === input.expectedChatUrl);
  const observerIdentityMatches = input.observerIdentityMatches
    ?? (input.observerExpectedChatUrl !== null && input.observerExpectedChatUrl === input.expectedChatUrl);
  const observerUncertain = UNCERTAIN_OBSERVER_STATES.has(input.observerCandidateState);
  const observerReady = input.observerReady
    ?? (input.observerExpectedChatUrl !== null && observerIdentityMatches && !observerUncertain);
  const navigationReady = input.navigationReady;
  const identityReady = navigationReady && pageIdentityMatches && input.onChatPage && observerReady;
  const historyReady = identityReady && input.historyReady;
  const observationReady = identityReady && observerReady;

  let state: WebGptTargetReadinessState;
  let reason: string;
  if (navigationReady && pageIdentityKnown && !pageIdentityMatches) {
    state = "TARGET_CHAT_MISMATCH";
    reason = "page_identity_mismatch";
  } else if (identityReady && historyReady && observationReady) {
    state = "READY";
    reason = "canonical_identity_and_history_converged";
  } else if (!navigationReady) {
    state = "WAITING_IDENTITY_READY";
    reason = "navigation_not_ready";
  } else if (!input.onChatPage || !input.composerFound) {
    state = "WAITING_IDENTITY_READY";
    reason = "chat_page_or_composer_not_ready";
  } else if (!observerIdentityMatches) {
    state = "WAITING_IDENTITY_READY";
    reason = "observer_target_not_converged";
  } else if (observerUncertain) {
    state = "WAITING_IDENTITY_READY";
    reason = `observer_${input.observerCandidateState.toLowerCase()}`;
  } else if (!observerReady) {
    state = "WAITING_IDENTITY_READY";
    reason = "observer_not_ready";
  } else if (!pageIdentityKnown) {
    state = "WAITING_IDENTITY_READY";
    reason = "page_identity_not_known";
  } else if (!input.historyReady) {
    state = "WAITING_IDENTITY_READY";
    reason = "history_not_hydrated";
  } else {
    state = "WAITING_IDENTITY_READY";
    reason = "identity_observation_not_ready";
  }

  return {
    expectedChatUrl: input.expectedChatUrl,
    pageChatUrl: input.actualChatUrl,
    navigationReady,
    identityReady,
    observerReady,
    historyReady,
    observationReady,
    state,
    reason,
    observerExpectedChatUrl: input.observerExpectedChatUrl,
    observerCandidateState: input.observerCandidateState,
  };
}
