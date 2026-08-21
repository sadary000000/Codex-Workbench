/**
 * AUT-1 adapter contracts only.
 *
 * These interfaces deliberately carry opaque references, not prompts,
 * transcripts, cookies, tokens, browser profiles, or native/WebGPT read models.
 * Implementations belong to a later integration stage.
 */

export interface NativeAutomationAdapter {
  createThread(input: { workspaceRef?: string | null; externalProjectRef?: string | null }): Promise<{ threadRef: string }>;
  resumeThread(threadRef: string): Promise<{ threadRef: string }>;
  forkThread(threadRef: string): Promise<{ threadRef: string }>;
  startTurn(input: { threadRef: string; inputRef?: string | null }): Promise<{ turnRef: string }>;
  interruptTurn(turnRef: string): Promise<{ turnRef: string; state: "INTERRUPTED" | "UNKNOWN" }>;
  getTurnState(turnRef: string): Promise<{ turnRef: string; state: "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "UNKNOWN" }>;
  getLatestResult(turnRef: string): Promise<{ resultRef: string | null; resultHash: string | null }>;
}

export interface WebGPTAutomationAdapter {
  getHealth(): Promise<{ state: "READY" | "BUSY" | "UNAVAILABLE" | "UNKNOWN" }>;
  submitRequest(input: { targetRef: string; inputRef?: string | null; idempotencyRef?: string | null }): Promise<{ requestRef: string }>;
  getRequest(requestRef: string): Promise<{ requestRef: string; state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN" }>;
  waitRequest(requestRef: string): Promise<{ requestRef: string; state: "COMPLETED" | "FAILED" | "UNKNOWN" }>;
  readRoleLatest(input: { roleRef: string; chatRef?: string | null }): Promise<{ resultRef: string | null; resultHash: string | null }>;
  readChatLatest(chatRef: string): Promise<{ resultRef: string | null; resultHash: string | null }>;
}

export type INativeAutomationAdapter = NativeAutomationAdapter;
export type IWebGPTAutomationAdapter = WebGPTAutomationAdapter;
