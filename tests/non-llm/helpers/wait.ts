import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mockEnv, scriptPath } from "./mock-opencode";

const exec = promisify(execFile);
const STATUS = scriptPath("status.sh");

export async function waitForStatusDone(cwd: string, name?: string, timeoutSeconds = 20) {
  const args = ["--json", "--cwd", cwd];
  if (name) args.unshift("--name", name);
  const { stdout } = await exec(STATUS, args, { env: mockEnv(cwd) });
  const json = JSON.parse(String(stdout ?? "").trim() || "{}");
  const agents = json.agents || [];
  if (agents.some((a: any) => a.status === "done")) return;

  const waitArgs = ["--wait", "--timeout", String(timeoutSeconds), "--json", "--cwd", cwd];
  if (name) waitArgs.unshift("--name", name);
  await exec(STATUS, waitArgs, { env: mockEnv(cwd) });
}
