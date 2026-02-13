import * as path from "node:path";
import { registerTempDir } from "./cleanup";

export function mockEnv(cwd: string) {
  registerTempDir(cwd);
  const root = path.resolve(__dirname, "../../..");
  const mockBin = path.join(root, "tests", "mock-opencode");
  const mockDir = path.join(cwd, ".mock-opencode");
  const xdgDataHome = path.join(cwd, ".mock-xdg-data");
  const PATH = `${mockBin}:${process.env.PATH || ""}`;
  return {
    ...process.env,
    PATH,
    OPENCODE_MOCK_DIR: mockDir,
    XDG_DATA_HOME: xdgDataHome,
    OPENCODE_PSA_MODEL: "opencode/gpt-5-nano",
    OPENCODE_PSA_WAIT_TIMEOUT_SEC: "20",
  };
}

export function scriptPath(rel: string) {
  const root = path.resolve(__dirname, "../../..");
  return path.join(root, ".claude", "skills", "opencode-subagent", "scripts", rel);
}
