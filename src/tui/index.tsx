import React from "react";
import { render } from "ink";
import { App } from "./App";

function parseArgs(): { cwd: string; refreshSeconds: number } {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let refreshSeconds = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) {
      cwd = args[++i]!;
    } else if (args[i] === "--refresh" && args[i + 1]) {
      const n = parseInt(args[++i]!, 10);
      if (Number.isFinite(n) && n > 0) refreshSeconds = n;
    }
  }

  return { cwd, refreshSeconds };
}

const { cwd, refreshSeconds } = parseArgs();
const { waitUntilExit } = render(
  <App cwd={cwd} refreshSeconds={refreshSeconds} />
);
waitUntilExit().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
