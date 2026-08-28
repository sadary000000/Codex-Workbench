export interface StageK1DProvenance {
  source_commit: string | null;
  worktree_state: string | null;
  worktree_state_sha256: string | null;
  source_tree_sha256: string | null;
  build_timestamp: string | null;
  package_timestamp: string | null;
  executable_path: string | null;
  executable_sha256: string | null;
  expected_executable_sha256: string | null;
  runner_script_sha256: string | null;
  expected_runner_script_sha256: string | null;
  evidence_timestamp: string;
  verified: boolean;
  verification_errors: string[];
}

function stringValue(value: Record<string, unknown> | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

export function assessStageK1DProvenance(input: { manifest: Record<string, unknown> | null; executablePath: string; executableSha256: string | null; runnerScriptSha256: string | null }): StageK1DProvenance {
  const m = input.manifest;
  const errors: string[] = [];
  if (!m) errors.push("PACKAGE_MANIFEST_MISSING");
  const expectedExecutable = stringValue(m, "executable_sha256");
  const expectedRunner = stringValue(m, "runner_script_sha256");
  if (!input.executableSha256) errors.push("EXECUTABLE_HASH_UNAVAILABLE");
  else if (expectedExecutable && expectedExecutable !== input.executableSha256) errors.push("EXECUTABLE_HASH_MISMATCH");
  if (expectedRunner && input.runnerScriptSha256 !== expectedRunner) errors.push("RUNNER_SCRIPT_HASH_MISMATCH");
  return { source_commit: stringValue(m, "source_commit"), worktree_state: stringValue(m, "worktree_state"), worktree_state_sha256: stringValue(m, "worktree_state_sha256"), source_tree_sha256: stringValue(m, "source_tree_sha256"), build_timestamp: stringValue(m, "build_timestamp"), package_timestamp: stringValue(m, "package_timestamp"), executable_path: input.executablePath || null, executable_sha256: input.executableSha256, expected_executable_sha256: expectedExecutable, runner_script_sha256: input.runnerScriptSha256, expected_runner_script_sha256: expectedRunner, evidence_timestamp: new Date().toISOString(), verified: errors.length === 0, verification_errors: errors };
}
