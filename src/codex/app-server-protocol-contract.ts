/**
 * Stable contract facts recorded from the generated Codex App Server output.
 * This is deliberately a small production allowlist for the shared Host;
 * generated TypeScript is type-only, so it is not used as a serializer.
 */
export const CODEX_APP_SERVER_PROTOCOL_CONTRACT = Object.freeze({
  codexVersion: "codex-cli 0.147.0",
  binarySha256: "935A1911ED2556E4FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D",
  generationMode: "stable",
  generationCommands: Object.freeze([
    "codex app-server generate-ts --out <dir>",
    "codex app-server generate-json-schema --out <dir>",
  ]),
  generatedTsFileCount: 642,
  generatedJsonSchemaFileCount: 285,
  generatedTsTreeSha256: "3D23B8E14F3AFAAB404DA59BBF8F7541720EEBF75E7549940BDBF9808F09D152",
  generatedJsonSchemaTreeSha256: "0D2DDF85138073D0EA0A6828804349B65F18BF88F8B2FF7AEF62C9262B39390F",
  initializeResponseSchema: Object.freeze({
    version: "v1",
    title: "InitializeResponse",
    requiredFields: Object.freeze(["codexHome", "platformFamily", "platformOs", "userAgent"]),
    sha256: "62AD689C2CB6379913C1D72749CFD8DE5089D35760214123518EB92EEF11ACC9",
  }),
  initializeParamsSchema: Object.freeze({
    version: "v1",
    title: "InitializeParams",
    requiredFields: Object.freeze(["clientInfo"]),
    sha256: "6F0094BE9A65242EC779A40794CBD4FDFA32FCA1E45084A16ADFB50501D33EA2",
  }),
});

export interface AppServerSchemaProvenance {
  codexVersion: string;
  binarySha256: string;
  generatedJsonSchemaTreeSha256: string;
  initializeResponseSchemaSha256: string;
  initializeParamsSchemaSha256: string;
}

export const VERIFIED_APP_SERVER_SCHEMA_PROVENANCE: Readonly<AppServerSchemaProvenance> = Object.freeze({
  codexVersion: CODEX_APP_SERVER_PROTOCOL_CONTRACT.codexVersion,
  binarySha256: CODEX_APP_SERVER_PROTOCOL_CONTRACT.binarySha256,
  generatedJsonSchemaTreeSha256: CODEX_APP_SERVER_PROTOCOL_CONTRACT.generatedJsonSchemaTreeSha256,
  initializeResponseSchemaSha256: CODEX_APP_SERVER_PROTOCOL_CONTRACT.initializeResponseSchema.sha256,
  initializeParamsSchemaSha256: CODEX_APP_SERVER_PROTOCOL_CONTRACT.initializeParamsSchema.sha256,
});

/**
 * The generated schema is a checked-in provenance fact, not a runtime schema
 * loader.  Production accepts only the schema facts recorded for the same
 * verified binary; a changed/mixed contract fails before initialize is used.
 */
export function assertVerifiedAppServerSchemaProvenance(
  candidate: Partial<AppServerSchemaProvenance> = VERIFIED_APP_SERVER_SCHEMA_PROVENANCE,
): true {
  const keys: Array<keyof AppServerSchemaProvenance> = [
    "codexVersion",
    "binarySha256",
    "generatedJsonSchemaTreeSha256",
    "initializeResponseSchemaSha256",
    "initializeParamsSchemaSha256",
  ];
  for (const key of keys) {
    if (candidate[key] !== VERIFIED_APP_SERVER_SCHEMA_PROVENANCE[key]) {
      const error = new Error(`App Server generated schema provenance mismatch for ${key}.`) as Error & { code?: string };
      error.code = "APP_SERVER_SCHEMA_PROVENANCE_MISMATCH";
      throw error;
    }
  }
  return true;
}

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
