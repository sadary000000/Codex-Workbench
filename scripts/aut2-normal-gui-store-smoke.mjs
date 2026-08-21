import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = join(process.cwd(), "dist", "package", "Codex Workbench V1.exe");
const userData = await mkdtemp(join(tmpdir(), "codex-workbench-v1-aut2-gui-"));
const database = join(userData, "automation.db");
const environment = { ...process.env, AUT2_AUTOMATION_DB: database, AUT2_NORMAL_GUI_STORE_SMOKE: "1" };
delete environment.ELECTRON_RUN_AS_NODE;
const startedAt = Date.now();

const result = await new Promise((resolve) => {
  let settled = false;
  const child = execFile(executable, [`--user-data-dir=${userData}`], { windowsHide: true, env: environment, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (settled) return;
    settled = true;
    resolve({
      command: executable,
      exitCode: error?.code && typeof error.code === "number" ? error.code : error ? null : 0,
      signal: error?.signal ?? null,
      timedOut: false,
      elapsedMs: Date.now() - startedAt,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      userData,
      database,
    });
  });
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill();
    resolve({ command: executable, exitCode: null, signal: "TIMEOUT", timedOut: true, elapsedMs: Date.now() - startedAt, stdout: "", stderr: "", userData, database });
  }, 30_000);
  child.once("close", () => clearTimeout(timeout));
});

console.log(JSON.stringify(result));
await rm(userData, { recursive: true, force: true }).catch(() => undefined);
if (result.timedOut || result.exitCode !== 0) process.exitCode = 1;
