import { createHash } from "node:crypto";

export type AutomationInputKind = "REQUIREMENT_PROMPT" | "OTHER";

export interface InputRefDescriptor {
  readonly inputRef: string;
  readonly kind: AutomationInputKind;
  readonly sha256: string;
  /** UTF-8 byte length, not JavaScript UTF-16 code-unit length. */
  readonly length: number;
}

export interface InputRefRegistration extends InputRefDescriptor {
  readonly ownerRef: string | null;
}

export class InputRefError extends Error {
  readonly code: "INPUT_REF_INVALID" | "INPUT_REF_UNRESOLVED" | "INPUT_REF_INTEGRITY_FAILED";

  constructor(code: InputRefError["code"], message: string) {
    super(message);
    this.name = "InputRefError";
    this.code = code;
  }
}

/**
 * Ephemeral provider-input registry.
 *
 * Automation persists only the descriptor.  The payload remains owned by
 * the current provider dispatch lifecycle and is never written to the
 * automation document, audit metadata, or a second requirement store.
 */
export class InputRefRegistry {
  private readonly payloads = new Map<string, { descriptor: InputRefDescriptor; payload: string; ownerRefs: Set<string> }>();

  register(input: { kind: AutomationInputKind; payload: string; ownerRef?: string | null }): InputRefRegistration {
    if (typeof input.payload !== "string" || input.payload.length === 0) throw new InputRefError("INPUT_REF_INVALID", "Provider input must be a non-empty string.");
    const sha256 = createHash("sha256").update(input.payload, "utf8").digest("hex");
    const descriptor: InputRefDescriptor = {
      inputRef: `automation-input-v1:${sha256}`,
      kind: input.kind,
      sha256,
      length: Buffer.byteLength(input.payload, "utf8"),
    };
    const existing = this.payloads.get(descriptor.inputRef);
    if (existing && (existing.descriptor.sha256 !== sha256 || existing.descriptor.length !== descriptor.length)) {
      throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "The existing InputRef has different content metadata.");
    }
    const ownerRefs = existing?.ownerRefs ?? new Set<string>();
    if (input.ownerRef) ownerRefs.add(input.ownerRef);
    this.payloads.set(descriptor.inputRef, { descriptor, payload: input.payload, ownerRefs });
    return { ...descriptor, ownerRef: input.ownerRef ?? null };
  }

  async resolve(inputRef: string, expected?: { kind?: AutomationInputKind; ownerRef?: string | null; sha256?: string; length?: number }): Promise<string> {
    if (typeof inputRef !== "string" || !inputRef.startsWith("automation-input-v1:")) throw new InputRefError("INPUT_REF_INVALID", "InputRef is not a recognized opaque reference.");
    const entry = this.payloads.get(inputRef);
    if (!entry) throw new InputRefError("INPUT_REF_UNRESOLVED", "InputRef is not available in the current provider dispatch lifecycle.");
    const actualHash = createHash("sha256").update(entry.payload, "utf8").digest("hex");
    const actualLength = Buffer.byteLength(entry.payload, "utf8");
    if (actualHash !== entry.descriptor.sha256 || actualLength !== entry.descriptor.length) throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "InputRef payload integrity does not match its descriptor.");
    if (expected?.kind !== undefined && entry.descriptor.kind !== expected.kind) throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "InputRef kind does not match the provider operation.");
    if (expected?.ownerRef && !entry.ownerRefs.has(expected.ownerRef)) throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "InputRef owner does not match the provider operation.");
    if (expected?.sha256 !== undefined && entry.descriptor.sha256 !== expected.sha256) throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "InputRef hash does not match the persisted descriptor.");
    if (expected?.length !== undefined && entry.descriptor.length !== expected.length) throw new InputRefError("INPUT_REF_INTEGRITY_FAILED", "InputRef length does not match the persisted descriptor.");
    return entry.payload;
  }

  has(inputRef: string): boolean {
    return this.payloads.has(inputRef);
  }

  /**
   * Release one owner after the provider has accepted (or rejected) the
   * request.  A shared deterministic InputRef remains available while any
   * owner still needs it; otherwise the raw payload leaves the process.
   */
  release(inputRef: string, ownerRef?: string | null): void {
    const entry = this.payloads.get(inputRef);
    if (!entry) return;
    if (ownerRef) entry.ownerRefs.delete(ownerRef);
    if (!ownerRef || entry.ownerRefs.size === 0) this.payloads.delete(inputRef);
  }

  clear(inputRef?: string): void {
    if (inputRef) this.payloads.delete(inputRef);
    else this.payloads.clear();
  }
}
