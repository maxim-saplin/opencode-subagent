import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mockEnv, scriptPath } from "./mock-opencode";

const exec = promisify(execFile);
const STATUS = scriptPath("status.sh");

export async function waitForStatusDone(cwd: string, name?: string, timeoutSeconds = 20) {
  const args = ["--cwd", cwd];
  if (name) args.unshift("--name", name);
  const { stdout } = await exec(STATUS, args, { env: mockEnv(cwd), cwd });
  const json = JSON.parse(String(stdout ?? "").trim() || "{}");
  const agents = json.agents || [];
  const scoped = name ? agents.filter((a: any) => a.name === name) : agents;
  if (scoped.some((a: any) => a.status === "done")) return;

  const waitArgs = ["--timeout", String(timeoutSeconds), "--cwd", cwd];
  if (name) {
    waitArgs.unshift("--name", name);
    waitArgs.unshift("--wait-terminal");
  } else {
    waitArgs.unshift("--wait");
  }
  await exec(STATUS, waitArgs, { env: mockEnv(cwd), cwd });
}
