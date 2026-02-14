/**
 * Programmatic TUI fixture builder. No static JSON files.
 */
import type { RegistryAgent, ChildAgent, ExportMessage } from "../../../src/tui/data";

export interface FixtureScenario {
  name: string;
  agents: RegistryAgent[];
  /** For mock exportSession/readChildMessages - sessionId -> messages */
  sessionMessages?: Record<string, ExportMessage[]>;
}

/** Child agent with task-tool metadata. */
export function childAgent(opts: Partial<ChildAgent> & { sessionId: string }): ChildAgent {
  return {
    sessionId: opts.sessionId,
    status: opts.status ?? "done",
    title: opts.title ?? null,
    model: opts.model ?? null,
    startedAt: opts.startedAt ?? "2025-02-13T10:00:00.000Z",
    finishedAt: opts.finishedAt ?? "2025-02-13T10:05:00.000Z",
    usage: opts.usage ?? { messageCount: 5, dialogTokens: 1200, contextFullPct: 0.2 },
    ...opts,
  };
}

/** Registry agent with optional children. */
export function registryAgent(opts: Partial<RegistryAgent> & { name: string; sessionId?: string }): RegistryAgent {
  return {
    name: opts.name,
    status: opts.status ?? "done",
    pid: opts.pid ?? null,
    sessionId: opts.sessionId ?? null,
    exitCode: opts.exitCode ?? null,
    startedAt: opts.startedAt ?? "2025-02-13T10:00:00.000Z",
    updatedAt: opts.updatedAt ?? null,
    finishedAt: opts.finishedAt ?? "2025-02-13T10:10:00.000Z",
    model: opts.model ?? "opencode/gpt-5",
    variant: opts.variant ?? null,
    cwd: opts.cwd ?? null,
    usage: opts.usage ?? { messageCount: 10, dialogTokens: 5000, contextFullPct: 0.5 },
    children: opts.children ?? undefined,
    ...opts,
  };
}

/** ExportMessage with token metadata. */
export function exportMessage(opts: Partial<ExportMessage> & { role?: string }): ExportMessage {
  return {
    role: opts.role ?? "assistant",
    info: opts.info ?? undefined,
    parts: opts.parts ?? undefined,
    tokens: opts.tokens ?? undefined,
    content: opts.content ?? undefined,
    ...opts,
  };
}

/** Task-tool part for child session in message. */
export function taskToolPart(sessionId: string, title: string, extra?: Partial<Record<string, unknown>>) {
  return {
    type: "tool",
    tool: "task",
    state: {
      title,
      status: "done",
      metadata: { sessionId },
      time: { start: "2025-02-13T10:00:00.000Z", end: "2025-02-13T10:05:00.000Z" },
      ...extra,
    },
  };
}

/** Message part with tokens in info. */
export function textPart(text: string, tokens?: { input?: number; cache?: { read?: number } }) {
  return {
    type: "text",
    text,
    ...(tokens ? {} : {}),
  };
}

export const SCENARIO_EMPTY: FixtureScenario = {
  name: "empty",
  agents: [],
};

export const SCENARIO_SINGLE_RUNNING: FixtureScenario = {
  name: "single-running",
  agents: [
    registryAgent({
      name: "solo-agent",
      sessionId: "sess-solo-1",
      status: "running",
      pid: 12345,
      finishedAt: null,
    }),
  ],
  sessionMessages: {
    "sess-solo-1": [
      exportMessage({
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        info: { role: "user" },
      }),
      exportMessage({
        role: "assistant",
        parts: [{ type: "text", text: "Hi there!" }],
        info: { role: "assistant", tokens: { input: 50, cache: { read: 20 } } },
      }),
    ],
  },
};

export const SCENARIO_DIALOG_FOCUSED: FixtureScenario = {
  name: "dialog-focused",
  agents: [
    registryAgent({
      name: "dialog-agent",
      sessionId: "sess-dialog-1",
      status: "done",
      usage: { messageCount: 6, dialogTokens: 3200, contextFullPct: 0.3 },
    }),
  ],
  sessionMessages: {
    "sess-dialog-1": [
      exportMessage({ role: "user", parts: [{ type: "text", text: "Write tests" }], info: { role: "user" } }),
      exportMessage({
        role: "assistant",
        parts: [
          { type: "text", text: "I'll help." },
          taskToolPart("child-1", "Run tests", { title: "Run tests" }),
        ],
        info: { role: "assistant", tokens: { input: 200, cache: { read: 100 } } },
      }),
    ],
  },
};

export const SCENARIO_MIXED: FixtureScenario = {
  name: "mixed",
  agents: [
    registryAgent({
      name: "live-one",
      sessionId: "sess-live-1",
      status: "running",
      pid: 111,
      finishedAt: null,
    }),
    registryAgent({
      name: "done-with-children",
      sessionId: "sess-parent-1",
      status: "done",
      children: [
        childAgent({ sessionId: "child-a", title: "Task A", status: "done" }),
        childAgent({ sessionId: "child-b", title: "Task B", status: "done" }),
      ],
    }),
    registryAgent({
      name: "done-simple",
      sessionId: "sess-done-1",
      status: "done",
    }),
  ],
  sessionMessages: {
    "sess-parent-1": [
      exportMessage({ role: "user", parts: [{ type: "text", text: "Do multi" }], info: { role: "user" } }),
      exportMessage({
        role: "assistant",
        parts: [
          { type: "text", text: "Ok" },
          taskToolPart("child-a", "Task A"),
          taskToolPart("child-b", "Task B"),
        ],
        info: { role: "assistant", tokens: { input: 300, cache: { read: 150 } } },
      }),
    ],
    "child-a": [
      exportMessage({ role: "user", parts: [{ type: "text", text: "Sub A" }], info: { role: "user" } }),
      exportMessage({
        role: "assistant",
        parts: [{ type: "text", text: "Done A" }],
        info: { role: "assistant", tokens: { input: 10, cache: { read: 5 } } },
      }),
    ],
  },
};

export const ALL_SCENARIOS: FixtureScenario[] = [
  SCENARIO_EMPTY,
  SCENARIO_SINGLE_RUNNING,
  SCENARIO_DIALOG_FOCUSED,
  SCENARIO_MIXED,
];
