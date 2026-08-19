export interface ThreadSelectionRequest {
  nativeThreadId: string;
  generation: number;
}

export function beginThreadSelection(generation: number, nativeThreadId: string): ThreadSelectionRequest {
  const id = nativeThreadId.trim();
  if (!id) throw new Error("nativeThreadId is required for selection.");
  return { nativeThreadId: id, generation };
}

export function isCurrentThreadSelection(
  request: ThreadSelectionRequest,
  currentGeneration: number,
  currentNativeThreadId: string | null,
): boolean {
  return request.generation === currentGeneration && request.nativeThreadId === currentNativeThreadId;
}
