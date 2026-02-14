import React from "react";
import { render, cleanup } from "ink-testing-library";
import { describe, it, expect, afterEach } from "bun:test";
import { App } from "../../src/tui/App";
import type { DataProvider } from "../../src/tui/DataProvider";
import type { Registry, RegistryAgent, ExportMessage } from "../../src/tui/data";
import { SCENARIO_MIXED } from "./helpers/tui-fixtures";

afterEach(() => cleanup());

/** ANSI key sequences for ink useInput */
const KEYS = {
  down: "\x1b[B",
  up: "\x1b[A",
  enter: "\r",
  escape: "\x1b",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildMockProvider(scenario: { agents: RegistryAgent[]; sessionMessages?: Record<string, ExportMessage[]> }): DataProvider {
  const agentsRecord: Record<string, RegistryAgent> = {};
  for (const a of scenario.agents) {
    if (a.name) agentsRecord[a.name] = a;
  }
  const registry: Registry = { agents: agentsRecord };
  const sessionMessages = scenario.sessionMessages ?? {};

  return {
    readRegistry: () => Promise.resolve(registry),
    exportSession: (sessionId: string) => {
      const msgs = sessionMessages[sessionId];
      return Promise.resolve(msgs ? { messages: msgs } : { messages: [] });
    },
    readChildMessages: (sessionId: string) => {
      const msgs = sessionMessages[sessionId];
      return Promise.resolve(Array.isArray(msgs) ? msgs : []);
    },
  };
}

describe("TUI interactive crawl", () => {
  it("walks the main screen graph deterministically", async () => {
    const scenario = {
      agents: SCENARIO_MIXED.agents,
      sessionMessages: SCENARIO_MIXED.sessionMessages ?? {},
    };

    const provider = buildMockProvider(scenario);

    const exitMock = (() => {
      let called = false;
      const orig = process.exit;
      return {
        install() {
          (process as { exit?: (c?: number) => void }).exit = () => {
            called = true;
          };
        },
        restore() {
          (process as { exit?: (c?: number) => void }).exit = orig;
        },
        get called() {
          return called;
        },
      };
    })();

    exitMock.install();
    try {
      const { lastFrame, stdin } = render(
        <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} terminalWidth={52} terminalHeight={14} />
      );
      await sleep(50);

      // Dashboard invariants.
      let frame = lastFrame() ?? "";
      expect(frame).toContain("LIVE AGENTS");
      expect(frame).toContain("DONE AGENTS");
      expect(frame).toContain("q");

      // Move to the parent agent with children, open children panel.
      stdin.write("j");
      await sleep(25);
      stdin.write("c");
      await sleep(60);
      frame = lastFrame() ?? "";
      expect(frame).toContain("Children of");
      expect(frame).toContain("done-with-children");

      // Open child dialog (child-a has real messages in fixture).
      stdin.write(KEYS.enter);
      await sleep(80);
      frame = lastFrame() ?? "";
      expect(frame).toContain("Dialog:");
      expect(frame).toContain("Task A");
      expect(frame).toContain("Sub A");

      // Back to children, then dashboard.
      stdin.write(KEYS.escape);
      await sleep(60);
      frame = lastFrame() ?? "";
      expect(frame).toContain("Children of");
      stdin.write(KEYS.escape);
      await sleep(60);
      frame = lastFrame() ?? "";
      expect(frame).toContain("LIVE AGENTS");

      // Open parent dialog from dashboard (should include tool parts).
      // Ensure selection is on the parent row (not a child row).
      stdin.write("k");
      await sleep(25);
      stdin.write("j");
      await sleep(25);
      stdin.write(KEYS.enter);
      await sleep(80);
      frame = lastFrame() ?? "";
      expect(frame).toContain("Dialog:");
      expect(frame).toContain("done-with-children");
      expect(frame).toContain("tool:");

      // Quit always works from any screen.
      stdin.write("q");
      await sleep(20);
      expect(exitMock.called).toBe(true);
    } finally {
      exitMock.restore();
    }
  });
});

