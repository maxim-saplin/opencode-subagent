import * as fs from "node:fs/promises";

const tempDirs = new Set<string>();

export function registerTempDir(dir: string) {
  if (dir) tempDirs.add(dir);
}

export async function cleanupTempDirs() {
  const dirs = Array.from(tempDirs);
  tempDirs.clear();
  await Promise.all(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}
