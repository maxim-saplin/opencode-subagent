import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, afterEach } from "bun:test";
import { App } from "../../src/tui/App";
import type { DataProvider } from "../../src/tui/DataProvider";
import type { Registry, RegistryAgent, ExportMessage } from "../../src/tui/data";
import { SCENARIO_MIXED, registryAgent, childAgent } from "./helpers/tui-fixtures";
import { cleanup } from "ink-testing-library";

/** ANSI key sequences for ink useInput */
const KEYS = {
  down: "\x1b[B",
  up: "\x1b[A",
  enter: "\r",
  escape: "\x1b",
};

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

afterEach(() => cleanup());

describe("TUI navigation", () => {
  const scenario = {
    agents: SCENARIO_MIXED.agents,
    sessionMessages: SCENARIO_MIXED.sessionMessages ?? {},
  };

  it("renders dashboard with agents", async () => {
    const provider = buildMockProvider(scenario);
    const { lastFrame, waitUntilExit } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LIVE AGENTS");
    expect(frame).toContain("DONE AGENTS");
    expect(frame).toContain("live-one");
  });

  it("moves selection with j/k", async () => {
    const provider = buildMockProvider(scenario);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() ?? "";
    const idx1 = frame.indexOf("> ");
    stdin.write("j");
    await new Promise((r) => setTimeout(r, 20));
    frame = lastFrame() ?? "";
    const idx2 = frame.indexOf("> ");
    expect(idx2).toBeGreaterThanOrEqual(0);
  });

  it("moves selection with arrows", async () => {
    const provider = buildMockProvider(scenario);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(KEYS.down);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(KEYS.up);
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> ");
  });

  it("enters dialog on Enter when agent has sessionId", async () => {
    const single = {
      agents: [
        registryAgent({ name: "drill-agent", sessionId: "sess-1", status: "done" }),
      ],
      sessionMessages: {
        "sess-1": [
          { role: "user", parts: [{ type: "text", text: "Hi" }] },
          { role: "assistant", parts: [{ type: "text", text: "Hello" }] },
        ] as ExportMessage[],
      },
    };
    const provider = buildMockProvider(single);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(KEYS.enter);
    await new Promise((r) => setTimeout(r, 80));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dialog:");
    expect(frame).toContain("drill-agent");
  });

  it("shows loading indicator while dialog messages resolve", async () => {
    const single = {
      agents: [
        registryAgent({ name: "slow-dialog-agent", sessionId: "sess-slow-1", status: "done" }),
      ],
      sessionMessages: {
        "sess-slow-1": [
          { role: "assistant", parts: [{ type: "text", text: "Loaded" }] },
        ] as ExportMessage[],
      },
    };

    const provider: DataProvider = {
      ...buildMockProvider(single),
      exportSession: async (sessionId: string) => {
        await new Promise((r) => setTimeout(r, 80));
        const msgs = single.sessionMessages[sessionId] ?? [];
        return { messages: msgs };
      },
    };

    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(KEYS.enter);
    await new Promise((r) => setTimeout(r, 20));
    let frame = lastFrame() ?? "";
    expect(frame).toContain("Loading messages...");

    await new Promise((r) => setTimeout(r, 90));
    frame = lastFrame() ?? "";
    expect(frame).toContain("Loaded");
  });

  it("shows children panel on c when agent has children", async () => {
    const withChildren = {
      agents: [
        registryAgent({
          name: "parent-agent",
          sessionId: "sess-p",
          status: "done",
          children: [
            childAgent({ sessionId: "child-1", title: "Child One" }),
            childAgent({ sessionId: "child-2", title: "Child Two" }),
          ],
        }),
      ],
      sessionMessages: {},
    };
    const provider = buildMockProvider(withChildren);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Children of");
    expect(frame).toContain("parent-agent");
    expect(frame).toContain("Child One");
  });

  it("returns to dashboard on Esc from children", async () => {
    const withChildren = {
      agents: [
        registryAgent({
          name: "p",
          sessionId: "sess-p",
          status: "done",
          children: [childAgent({ sessionId: "c1", title: "C1" })],
        }),
      ],
      sessionMessages: {},
    };
    const provider = buildMockProvider(withChildren);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() ?? "";
    expect(frame).toContain("Children of");
    stdin.write(KEYS.escape);
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() ?? "";
    expect(frame).toContain("LIVE AGENTS");
    expect(frame).not.toContain("Children of");
  });

  it("returns to dashboard on Esc from dialog", async () => {
    const single = {
      agents: [registryAgent({ name: "d", sessionId: "s1", status: "done" })],
      sessionMessages: { s1: [] },
    };
    const provider = buildMockProvider(single);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(KEYS.enter);
    await new Promise((r) => setTimeout(r, 80));
    let frame = lastFrame() ?? "";
    expect(frame).toContain("Dialog:");
    stdin.write(KEYS.escape);
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() ?? "";
    expect(frame).toContain("LIVE AGENTS");
  });

  it("toggles tools in dialog with t", async () => {
    const single = {
      agents: [registryAgent({ name: "t", sessionId: "s1", status: "done" })],
      sessionMessages: {
        s1: [
          { role: "assistant", parts: [{ type: "text", text: "T" }, { type: "tool", tool: "task", input: "long content here" }] },
        ] as ExportMessage[],
      },
    };
    const provider = buildMockProvider(single);
    const { lastFrame, stdin } = render(
      <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(KEYS.enter);
    await new Promise((r) => setTimeout(r, 80));
    stdin.write("t");
    await new Promise((r) => setTimeout(r, 30));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dialog:");
  });

  it("q calls process.exit (mocked)", async () => {
    const exitMock = (() => {
      let called = false;
      let code = -1;
      const orig = process.exit;
      return {
        install() {
          (process as { exit?: (c?: number) => void }).exit = (c?: number) => {
            called = true;
            code = c ?? 0;
          };
        },
        restore() {
          (process as { exit?: (c?: number) => void }).exit = orig;
        },
        get called() {
          return called;
        },
        get code() {
          return code;
        },
      };
    })();
    exitMock.install();
    try {
      const provider = buildMockProvider(scenario);
      const { stdin } = render(
        <App cwd="/tmp" refreshSeconds={999} dataProvider={provider} />
      );
      await new Promise((r) => setTimeout(r, 50));
      stdin.write("q");
      await new Promise((r) => setTimeout(r, 30));
      expect(exitMock.called).toBe(true);
    } finally {
      exitMock.restore();
    }
  });
});
