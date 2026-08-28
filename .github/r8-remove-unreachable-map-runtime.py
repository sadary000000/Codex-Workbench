from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one anchor in {path}; found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/main/main.ts")
text = path.read_text(encoding="utf-8")

replace_once(
    "src/main/main.ts",
    'import { MAP_DYNAMIC_TOOL_SPEC, MAP_TOOL_CALL_METHOD } from "../codex/map-tool.ts";\n',
    "",
)
replace_once(
    "src/main/main.ts",
    '  /** Registers the model-facing Map tool; only valid on thread/start. */\n  mapToolEnabled?: boolean;\n',
    "",
)
replace_once(
    "src/main/main.ts",
    '''    // Ordinary model-facing Native Threads share one initialized Host. Map\n    // compatibility runtimes keep their existing isolated path because they\n    // require a separate dynamic-tool capability domain.\n    ...(target.mapToolEnabled\n      ? {}\n      : {\n          clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({\n            onServerRequest: clientOptions.onServerRequest,\n            onProcessExit: clientOptions.onProcessExit,\n          }),\n          skipInitialize: true,\n        }),\n''',
    '''    // Every production Native Thread uses the one initialized App Server Host.\n    // NativeThreadRuntime remains a thin per-thread adapter, never a second process.\n    clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({\n      onServerRequest: clientOptions.onServerRequest,\n      onProcessExit: clientOptions.onProcessExit,\n    }),\n    skipInitialize: true,\n''',
)
replace_once(
    "src/main/main.ts",
    '    dynamicTools: target.mapToolEnabled ? [MAP_DYNAMIC_TOOL_SPEC] : [],\n',
    "",
)
replace_once(
    "src/main/main.ts",
    '''      if (message.method === MAP_TOOL_CALL_METHOD) {\n        if (!target.mapToolEnabled) return failClosedServerRequest(message, createdRuntime?.nativeThreadId ?? messageThreadId(message));\n        return getConversationMaps().handleServerRequest(message);\n      }\n''',
    "",
)

text = path.read_text(encoding="utf-8")
inline_count = text.count(", mapToolEnabled: false")
if inline_count != 2:
    raise SystemExit(f"expected 2 inline false mapToolEnabled callers, found {inline_count}")
text = text.replace(", mapToolEnabled: false", "")
line_count = text.count("    mapToolEnabled: false,\n")
if line_count != 1:
    raise SystemExit(f"expected 1 multiline false mapToolEnabled caller, found {line_count}")
text = text.replace("    mapToolEnabled: false,\n", "")
path.write_text(text, encoding="utf-8")

if "mapToolEnabled" in text or "MAP_DYNAMIC_TOOL_SPEC" in text or "MAP_TOOL_CALL_METHOD" in text:
    raise SystemExit("dead Map runtime composition symbols remain in main.ts")

Path("tests/r8-shared-native-runtime-composition.test.ts").write_text('''import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\nimport test from "node:test";\n\nconst root = resolve(import.meta.dirname, "..");\nconst main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");\n\ntest("R8 production Native composition has no isolated Map App Server path", () => {\n  assert.equal(main.includes("mapToolEnabled"), false);\n  assert.equal(main.includes("MAP_DYNAMIC_TOOL_SPEC"), false);\n  assert.equal(main.includes("MAP_TOOL_CALL_METHOD"), false);\n  assert.ok(main.includes("clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({"));\n  assert.ok(main.includes("skipInitialize: true"));\n});\n\ntest("R8 unsupported server requests remain fail-closed after dead Map tool composition removal", () => {\n  const start = main.indexOf("onServerRequest: async (message: JsonRpcMessage) => {");\n  const end = main.indexOf("onTurnStartRequest:", start);\n  assert.notEqual(start, -1);\n  assert.ok(end > start);\n  const block = main.slice(start, end);\n  assert.ok(block.includes("!isNativeApprovalMethod(message.method)"));\n  assert.ok(block.includes("return failClosedServerRequest"));\n  assert.equal(block.includes("getConversationMaps().handleServerRequest"), false);\n});\n''', encoding="utf-8")
