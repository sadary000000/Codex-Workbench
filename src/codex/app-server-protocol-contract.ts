/**
 * Stable contract facts recorded from the generated Codex App Server output.
 * This is deliberately a small production allowlist for the shared Host;
 * generated TypeScript is type-only, so it is not used as a serializer.
 */
export const CODEX_APP_SERVER_PROTOCOL_CONTRACT = Object.freeze({
  codexVersion: "codex-cli 0.147.0",
  binarySha256: "935A1911ED5564FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D",
  generationMode: "stable",
  generationCommands: Object.freeze([
    "codex app-server generate-ts --out <dir>",
    "codex app-server generate-json-schema --out <dir>",
  ]),
  generatedTsFileCount: 642,
  generatedJsonSchemaFileCount: 285,
  generatedTsTreeSha256: "3D23B8E14F3AFAAB404DA59BBF8F7541720EEBF75E7549940BDBF9808F09D152",
  generatedJsonSchemaTreeSha256: "0D2DDF85138073D0EA0A6828804349B65F18BF88F8B2FF7AEF62C9262B39390F",
});

export const SHARED_HOST_CORE_METHODS = Object.freeze(new Set([
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/read",
  "turn/start",
  "turn/interrupt",
  "model/list",
]));

export function isSharedHostCoreMethod(method: string): boolean {
  return SHARED_HOST_CORE_METHODS.has(method);
}
