import * as path from "node:path";
import { registerTempDir } from "./cleanup";

export function mockEnv(cwd: string) {
  registerTempDir(cwd);
  const root = path.resolve(__dirname, "../../..");
  const mockBin = path.join(root, "tests", "mock-opencode");
  const mockDir = path.join(cwd, ".mock-opencode");
  const PATH = `${mockBin}:${process.env.PATH || ""}`;
  return {
    ...process.env,
    PATH,
    OPENCODE_MOCK_DIR: mockDir,
    OPENCODE_PSA_MODEL: "opencode/gpt-5-nano",
  };
}

export function scriptPath(rel: string) {
  const root = path.resolve(__dirname, "../../..");
  return path.join(root, ".claude", "skills", "opencode-subagent", "scripts", rel);
}
