import { randomUUID } from "node:crypto";
import { canonicalControlPlaneErrorCode, normalizeControlPlaneError } from "../shared/control-plane-errors.ts";
import type { WebGptCliCommand } from "./webgpt-command.ts";
import { WEBGPT_CONTROL_PROTOCOL_VERSION, type WebGptControlResponse } from "./webgpt-control.ts";

export interface PresentedWebGptCliOutput {
  stdout: string;
  stderr: string;
  exitCode: 0 | 1 | 2;
  response: WebGptControlResponse;
}

function publicResponse(response: WebGptControlResponse): WebGptControlResponse {
  if (response.ok) return response;
  const normalized = normalizeControlPlaneError(response.error ?? { code: "INTERNAL_ERROR", message: "WebGPT Control Plane 返回了无效错误。" });
  return { ...response, error: normalized };
}

export function cliFailureExitCode(response: WebGptControlResponse): 1 | 2 {
  if (response.ok) return 1;
  const code = canonicalControlPlaneErrorCode(response.error?.code ?? "INTERNAL_ERROR");
  return code === "INVALID_ARGUMENT" ? 2 : 1;
}

export function presentWebGptCliOutput(invocation: Pick<WebGptCliCommand, "json">, response: WebGptControlResponse): PresentedWebGptCliOutput {
  const outputResponse = publicResponse(response);
  if (invocation.json) {
    return {
      stdout: `${JSON.stringify(outputResponse)}\n`,
      stderr: "",
      exitCode: outputResponse.ok ? 0 : cliFailureExitCode(outputResponse),
      response: outputResponse,
    };
  }
  if (outputResponse.ok) {
    return {
      stdout: `${outputResponse.command}: OK\n${JSON.stringify(outputResponse.result ?? null, null, 2)}\n`,
      stderr: "",
      exitCode: 0,
      response: outputResponse,
    };
  }
  return {
    stdout: "",
    stderr: `${outputResponse.command}: ERROR [${outputResponse.error?.code ?? "INTERNAL_ERROR"}] ${outputResponse.error?.message ?? "未知错误"}\n`,
    exitCode: cliFailureExitCode(outputResponse),
    response: outputResponse,
  };
}

export function createWebGptCliArgumentError(message: string): WebGptControlResponse {
  return createWebGptCliFailure("INVALID_ARGUMENT", message);
}

export function createWebGptCliFailure(code: string, message: string): WebGptControlResponse {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: randomUUID(),
    ok: false,
    command: "webgpt",
    error: {
      code,
      message,
      retryable: false,
    },
  };
}
