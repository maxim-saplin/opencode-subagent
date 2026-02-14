import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, afterEach } from "bun:test";
import { Dashboard, getFlattenedRows } from "../../src/tui/Dashboard";
import { AgentDialog } from "../../src/tui/AgentDialog";
import { ChildrenPanel } from "../../src/tui/ChildrenPanel";
import { StatusBar } from "../../src/tui/StatusBar";
import type { RegistryAgent, ChildAgent } from "../../src/tui/data";
import {
  SCENARIO_EMPTY,
  SCENARIO_SINGLE_RUNNING,
  SCENARIO_MIXED,
  registryAgent,
  childAgent,
  exportMessage,
} from "./helpers/tui-fixtures";
import { cleanup } from "ink-testing-library";

function toRegistryAgents(agents: Array<{ name: string }>): RegistryAgent[] {
  return agents.map((a) => (a as RegistryAgent));
}

afterEach(() => cleanup());

describe("Dashboard render", () => {
  it("shows LIVE AGENTS and DONE AGENTS headers", () => {
    const agents = toRegistryAgents(SCENARIO_EMPTY.agents);
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={0} nowMs={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LIVE AGENTS");
    expect(frame).toContain("DONE AGENTS");
  });

  it("shows no agents running when empty", () => {
    const agents = toRegistryAgents(SCENARIO_EMPTY.agents);
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={0} nowMs={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No agents running");
    expect(frame).toContain("No completed agents");
  });

  it("renders a visible spacer before DONE AGENTS", () => {
    const agents = toRegistryAgents(SCENARIO_EMPTY.agents);
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={0} nowMs={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/No agents running\.\n(?:\s*\n)DONE AGENTS/);
  });

  it("shows agent name when single running", () => {
    const agents = toRegistryAgents(SCENARIO_SINGLE_RUNNING.agents) as RegistryAgent[];
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={0} nowMs={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("solo-agent");
  });

  it("highlights selected row with ASCII marker", () => {
    const agents = toRegistryAgents(SCENARIO_MIXED.agents) as RegistryAgent[];
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={1} nowMs={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> ");
    expect(frame).toContain("done-with-child"); // name may be truncated by terminal width
  });

  it("keeps all rendered lines within narrow terminal widths", () => {
    const terminalWidth = 32;
    const agents = toRegistryAgents(SCENARIO_MIXED.agents) as RegistryAgent[];
    const { lastFrame } = render(
      <Dashboard
        agents={agents}
        selectedIndex={0}
        nowMs={Date.now()}
        terminalWidth={terminalWidth}
        viewportHeight={18}
      />
    );
    const frame = lastFrame() ?? "";
    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(terminalWidth);
    }
  });

  it("handles long names/models without overflowing", () => {
    const terminalWidth = 44;
    const agents: RegistryAgent[] = [
      registryAgent({
        name: "agent-with-a-very-very-very-very-long-name-that-must-truncate",
        status: "running",
        pid: 999,
        sessionId: "sess-long-1",
        model: "opencode/some-extremely-long-model-name-that-wont-fit",
        variant: "minimal",
        finishedAt: null,
        usage: { messageCount: 12345, dialogTokens: 999999, contextFullPct: 0.9999 },
      }),
    ];
    const { lastFrame } = render(
      <Dashboard agents={agents} selectedIndex={0} nowMs={Date.now()} terminalWidth={terminalWidth} viewportHeight={12} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LIVE AGENTS");
    expect(frame).toContain("agent-with-a-very");
    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(terminalWidth);
    }
  });
});

describe("AgentDialog render", () => {
  it("shows Dialog: {name} header", () => {
    const { lastFrame } = render(
      <AgentDialog messages={[]} name="test-agent" />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dialog:");
    expect(frame).toContain("test-agent");
  });

  it("shows No messages when empty", () => {
    const { lastFrame } = render(
      <AgentDialog messages={[]} name="test" />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No messages");
  });

  it("shows loading indicator while messages are loading", () => {
    const { lastFrame } = render(
      <AgentDialog messages={[]} name="test" loading />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Loading messages...");
  });

  it("shows user and assistant messages", () => {
    const messages = [
      exportMessage({ role: "user", parts: [{ type: "text", text: "Hello" }], info: { role: "user" } }),
      exportMessage({ role: "assistant", parts: [{ type: "text", text: "Hi!" }], info: { role: "assistant", tokens: { input: 10 } } }),
    ];
    const { lastFrame } = render(
      <AgentDialog messages={messages} name="test" />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("user:");
    expect(frame).toContain("assistant:");
    expect(frame).toContain("Hello");
    expect(frame).toContain("Hi!");
  });

  it("scrolls when viewport is small (default to bottom)", async () => {
    let controls:
      | {
          toggleTools: () => void;
          scrollBy: (delta: number) => void;
          jumpToTop: () => void;
          jumpToBottom: () => void;
        }
      | undefined;

    const messages = Array.from({ length: 40 }, (_, i) =>
      exportMessage({
        role: "assistant",
        parts: [{ type: "text", text: `msg-${i}` }],
        info: { role: "assistant", tokens: { input: 1 } },
      })
    );

    const { lastFrame } = render(
      <AgentDialog
        messages={messages}
        name="scroll-test"
        terminalWidth={60}
        viewportHeight={8}
        onRegisterControls={(c) => {
          controls = c;
        }}
      />
    );
    await new Promise((r) => setTimeout(r, 20));
    let frame = lastFrame() ?? "";
    expect(frame).toContain("msg-39");
    expect(frame).not.toContain("msg-0");

    controls?.scrollBy(-999);
    await new Promise((r) => setTimeout(r, 20));
    frame = lastFrame() ?? "";
    expect(frame).toContain("msg-0");
  });

  it("expands tool content when toggled", async () => {
    let controls:
      | {
          toggleTools: () => void;
          scrollBy: (delta: number) => void;
          jumpToTop: () => void;
          jumpToBottom: () => void;
        }
      | undefined;

    const long = "A".repeat(180) + " END_TOKEN";
    const messages = [
      exportMessage({
        role: "assistant",
        parts: [{ type: "tool", tool: "task", input: long }],
        info: { role: "assistant" },
      }),
    ];

    const { lastFrame } = render(
      <AgentDialog
        messages={messages}
        name="tool-test"
        terminalWidth={50}
        viewportHeight={10}
        onRegisterControls={(c) => {
          controls = c;
        }}
      />
    );
    await new Promise((r) => setTimeout(r, 20));
    let frame = lastFrame() ?? "";
    expect(frame).toContain("tool:");
    expect(frame).not.toContain("END_TOKEN");

    controls?.toggleTools();
    await new Promise((r) => setTimeout(r, 20));
    frame = lastFrame() ?? "";
    expect(frame).toContain("END_TOKEN");
  });
});

describe("ChildrenPanel render", () => {
  it("shows Children of {parent} header", () => {
    const { lastFrame } = render(
      <ChildrenPanel children={[]} parentName="parent-agent" selectedIndex={0} onSelect={() => {}} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Children of");
    expect(frame).toContain("parent-agent");
  });

  it("shows No children when empty", () => {
    const { lastFrame } = render(
      <ChildrenPanel children={[]} parentName="p" selectedIndex={0} onSelect={() => {}} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No children");
  });

  it("shows child titles", () => {
    const children: ChildAgent[] = [
      childAgent({ sessionId: "c1", title: "Task A" }),
      childAgent({ sessionId: "c2", title: "Task B" }),
    ];
    const { lastFrame } = render(
      <ChildrenPanel children={children} parentName="p" selectedIndex={0} onSelect={() => {}} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Task A");
    expect(frame).toContain("Task B");
  });

  it("keeps children panel lines within narrow terminal widths", () => {
    const terminalWidth = 30;
    const children: ChildAgent[] = [
      childAgent({ sessionId: "c1", title: "child-with-very-very-long-title-that-must-truncate" }),
      childAgent({ sessionId: "c2", title: "another-long-title" }),
    ];
    const { lastFrame } = render(
      <ChildrenPanel
        children={children}
        parentName="parent"
        selectedIndex={0}
        onSelect={() => {}}
        terminalWidth={terminalWidth}
        viewportHeight={10}
      />
    );
    const frame = lastFrame() ?? "";
    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(terminalWidth);
    }
  });
});

describe("StatusBar render", () => {
  it("shows dashboard hint", () => {
    const { lastFrame } = render(<StatusBar screen="dashboard" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k");
    expect(frame).toContain("Enter");
    expect(frame).toContain("q quit");
  });

  it("shows dialog hint for screen=dialog", () => {
    const { lastFrame } = render(<StatusBar screen="dialog" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("toggle tools");
    expect(frame).toContain("Esc back");
  });

  it("shows children hint for screen=children", () => {
    const { lastFrame } = render(<StatusBar screen="children" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Esc back");
  });

  it("keeps quit affordance visible at narrow widths", () => {
    const { lastFrame } = render(<StatusBar screen="dashboard" width={12} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("q");
  });
});

describe("getFlattenedRows", () => {
  it("flattens agents with children", () => {
    const agents: RegistryAgent[] = [
      registryAgent({
        name: "parent",
        children: [
          childAgent({ sessionId: "c1", title: "Child 1" }),
        ],
      }),
    ];
    const rows = getFlattenedRows(agents);
    expect(rows.length).toBeGreaterThanOrEqual(2); // parent + child
    expect(rows.some((r) => r.isChild)).toBe(true);
  });
});
