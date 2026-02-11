import * as fs from "node:fs/promises";
import * as path from "node:path";

const tempDirs = new Set<string>();

export function registerTempDir(dir: string) {
  if (dir) tempDirs.add(dir);
}

export async function cleanupTempDirs() {
  const dirs = Array.from(tempDirs);
  tempDirs.clear();
  // Collect ancestor .tmp dirs so the root is also removed
  const tmpRoots = new Set<string>();
  for (const dir of dirs) {
    const segments = dir.split(path.sep);
    const idx = segments.indexOf(".tmp");
    if (idx !== -1) tmpRoots.add(segments.slice(0, idx + 1).join(path.sep));
  }
  await Promise.all(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  for (const root of tmpRoots) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
