from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one {label}; found {count}")
    return text.replace(old, new, 1)


main_path = Path("src/main/main.ts")
main = main_path.read_text(encoding="utf-8")
main = replace_once(main, '    command: undefined,\n', "", "dead ConversationMapCoordinator command injection")
main_path.write_text(main, encoding="utf-8")

path = Path("src/main/map-coordinator.ts")
text = path.read_text(encoding="utf-8")

for old in [
    'import { AppServerProcessClient } from "../codex/app-server-client.ts";\n',
    'import { startAndInitializeAppServerClient } from "../codex/app-server-bootstrap.ts";\n',
    'import { resolveCodexCommand } from "../codex/codex-command.ts";\n',
]:
    text = replace_once(text, old, "", old.strip())

text = replace_once(
    text,
    'import { dynamicToolResponse, isMapToolCall, MAP_DYNAMIC_TOOL_SPEC } from "../codex/map-tool.ts";\n',
    'import { dynamicToolResponse, isMapToolCall } from "../codex/map-tool.ts";\n',
    "map-tool import",
)
text = replace_once(text, '  command?: string;\n', "", "MapCoordinatorOptions.command")

normalize_start = text.index("function normalizeCompatibilityPatch(")
normalize_end = text.index("\nexport class ConversationMapCoordinator", normalize_start)
text = text[:normalize_start] + text[normalize_end + 1:]

for old in [
    '  private readonly fallbackScopes = new Map<string, { originalThreadId: string; originalTurnId: string }>();\n',
    '  private readonly fallbackStarted = new Set<string>();\n',
    '  private readonly command: string;\n',
    '  private compatibilityFallbackToolCalls = 0;\n',
    '    this.command = options.command ?? resolveCodexCommand();\n',
    '  get compatibilityFallbackToolCallCount(): number { return this.compatibilityFallbackToolCalls; }\n\n',
]:
    text = replace_once(text, old, "", old.strip())

text = replace_once(
    text,
    '  async markTurnCompleted(nativeThreadId: string, turnId: string | null, delta?: unknown): Promise<void> {\n',
    '  async markTurnCompleted(nativeThreadId: string, turnId: string | null, _delta?: unknown): Promise<void> {\n',
    "markTurnCompleted signature",
)

fallback_branch = '''    if (this.resumedThreads.has(key) && !this.fallbackStarted.has(`${key}\\u0000${turnId}`)) {\n      this.fallbackStarted.add(`${key}\\u0000${turnId}`);\n      try {\n        await this.store(key).updateSync({ dirty: false, status: "syncing" });\n        this.onChanged?.(await this.status(key));\n        await this.runCompatibilityFallback(key, turnId, delta);\n        return;\n      } catch (error) {\n        const meta = errorMeta(error);\n        try {\n          const map = await this.store(key).updateSync({ dirty: true, status: "dirty" });\n          this.onChanged?.({ ...await this.statusFromMap(key, map), error: meta });\n        } catch {\n          this.onChanged?.({ ...current, available: false, error: meta });\n        }\n        return;\n      }\n    }\n'''
text = replace_once(text, fallback_branch, "", "resumed compatibility fallback branch")

old_handler = '''    const params = message.params;\n    const fallback = this.fallbackScopes.get(params.threadId);\n    if (fallback) this.compatibilityFallbackToolCalls += 1;\n    const patchArguments = fallback ? normalizeCompatibilityPatch(params.arguments) : params.arguments;\n    const targetThreadId = fallback?.originalThreadId ?? params.threadId;\n    const status = await this.status(targetThreadId);\n'''
new_handler = '''    const params = message.params;\n    const patchArguments = params.arguments;\n    const targetThreadId = params.threadId;\n    const status = await this.status(targetThreadId);\n'''
text = replace_once(text, old_handler, new_handler, "fallback handler prelude")

fallback_validation_start = text.index("    if (fallback) {", text.index("async handleServerRequest"))
fallback_validation_end = text.index("    try {", fallback_validation_start)
text = text[:fallback_validation_start] + text[fallback_validation_end:]
text = replace_once(
    text,
    '      this.patchedTurnIds.set(targetThreadId, fallback?.originalTurnId ?? params.turnId);\n',
    '      this.patchedTurnIds.set(targetThreadId, params.turnId);\n',
    "patched turn correlation",
)

method_start = text.index("  private async runCompatibilityFallback(")
method_end = text.index("\n}\n\nexport function isMapStoreError", method_start)
text = text[:method_start] + text[method_end:]

for forbidden in [
    "AppServerProcessClient",
    "startAndInitializeAppServerClient",
    "resolveCodexCommand",
    "MAP_DYNAMIC_TOOL_SPEC",
    "fallbackScopes",
    "fallbackStarted",
    "runCompatibilityFallback",
    "compatibilityFallbackToolCall",
    "normalizeCompatibilityPatch",
    'client.request("thread/start"',
    'client.request("turn/start"',
]:
    if forbidden in text:
        raise SystemExit(f"forbidden maintenance-runtime symbol remains: {forbidden}")

path.write_text(text, encoding="utf-8")

Path("tests/r8-map-no-maintenance-runtime.test.ts").write_text('''import assert from "node:assert/strict";\nimport { mkdtemp } from "node:fs/promises";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\nimport { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";\n\nconst root = join(import.meta.dirname, "..");\nconst source = readFileSync(join(root, "src/main/map-coordinator.ts"), "utf8");\n\ntest("R8 Conversation Map coordinator never creates a maintenance App Server or Native Thread", () => {\n  for (const forbidden of [\n    "AppServerProcessClient",\n    "startAndInitializeAppServerClient",\n    "MAP_DYNAMIC_TOOL_SPEC",\n    "runCompatibilityFallback",\n    "fallbackScopes",\n    "fallbackStarted",\n    'request("thread/start"',\n    'request("turn/start"',\n  ]) {\n    assert.equal(source.includes(forbidden), false, `Map coordinator must not own ${forbidden}`);\n  }\n});\n\ntest("R8 resumed Conversation Map becomes dirty without advancing the source cursor", async () => {\n  const userDataDirectory = await mkdtemp(join(tmpdir(), "codex-workbench-r8-map-dirty-"));\n  const coordinator = new ConversationMapCoordinator({ userDataDirectory });\n  await coordinator.enable("resumed-thread");\n  coordinator.markResumedThread("resumed-thread", "C:/fake/project");\n  await coordinator.markTurnCompleted("resumed-thread", "turn-resumed", { status: "completed" });\n  const status = await coordinator.status("resumed-thread");\n  assert.equal(status.enabled, true);\n  assert.equal(status.sameTurn, "compatibility_fallback");\n  assert.equal(status.map?.sync.dirty, true);\n  assert.equal(status.map?.sync.status, "dirty");\n  assert.equal(status.map?.sync.lastProcessedTurnId, null);\n  assert.equal(status.map?.revision, 0);\n});\n''', encoding="utf-8")
