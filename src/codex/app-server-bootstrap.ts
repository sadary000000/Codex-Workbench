import type { AppServerClientPort } from "./app-server-client.ts";
import { validateInitializeResult, type InitializeResult } from "./app-server-capabilities.ts";

export interface AppServerInitializeOptions {
  clientInfo: { name: string; title: string; version: string };
  experimentalApi: boolean;
  timeoutMs: number;
}

/**
 * The only production bootstrap boundary for a direct App Server client.
 * The client itself owns verified-binary provenance; this helper owns the
 * initialize response contract and only announces readiness after validation.
 */
export async function startAndInitializeAppServerClient(
  client: AppServerClientPort,
  options: AppServerInitializeOptions,
): Promise<InitializeResult> {
  await client.start();
  const initialized = validateInitializeResult(await client.request("initialize", {
    clientInfo: options.clientInfo,
    capabilities: { experimentalApi: options.experimentalApi },
  }, options.timeoutMs), { experimentalApi: options.experimentalApi });
  client.notify("initialized", {});
  return initialized;
}
