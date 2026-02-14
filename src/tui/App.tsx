import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useStdout, useStdin } from "ink";
import { parseMouseInput, useGlobalInput, useListSelection } from "./hooks";
import type { KeyEvent } from "./hooks";
import { type RegistryAgent, type ChildAgent } from "./data";
import { defaultDataProvider, type DataProvider } from "./DataProvider";
import { Dashboard, getFlattenedRows } from "./Dashboard";
import { AgentDialog } from "./AgentDialog";
import { ChildrenPanel } from "./ChildrenPanel";
import { StatusBar } from "./StatusBar";
import type { ExportMessage } from "./data";

export type Screen = "dashboard" | "dialog" | "children";

export interface AppProps {
  cwd: string;
  refreshSeconds: number;
  dataProvider?: DataProvider;
  /** Test override. When omitted, reads from Ink stdout. */
  terminalWidth?: number;
  /** Test override. When omitted, reads from Ink stdout. */
  terminalHeight?: number;
}

function extractSelectedText(
  lines: string[],
  start: { x: number; y: number },
  end: { x: number; y: number }
): string {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) return "";

  let sx = Math.max(1, Math.floor(start.x));
  let sy = Math.max(1, Math.floor(start.y));
  let ex = Math.max(1, Math.floor(end.x));
  let ey = Math.max(1, Math.floor(end.y));

  if (sy > lines.length) return "";
  ey = Math.min(lines.length, ey);

  if (sy > ey || (sy === ey && sx > ex)) {
    [sx, ex] = [ex, sx];
    [sy, ey] = [ey, sy];
  }

  const out: string[] = [];
  for (let y = sy; y <= ey; y += 1) {
    const line = String(lines[y - 1] ?? "");
    if (sy === ey) {
      const from = Math.max(0, sx - 1);
      const to = Math.max(from, Math.min(line.length, ex));
      out.push(line.slice(from, to));
      continue;
    }
    if (y === sy) {
      out.push(line.slice(Math.max(0, sx - 1)));
      continue;
    }
    if (y === ey) {
      out.push(line.slice(0, Math.max(0, Math.min(line.length, ex))));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** App: screen stack, data fetching, keyboard nav. */
export function App({
  cwd,
  refreshSeconds,
  dataProvider = defaultDataProvider,
  terminalWidth: terminalWidthOverride,
  terminalHeight: terminalHeightOverride,
}: AppProps) {
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const terminalWidth = terminalWidthOverride ?? stdout?.columns ?? 120;
  const terminalHeight = terminalHeightOverride ?? stdout?.rows ?? 30;
  const [registry, setRegistry] = useState<{ agents: Record<string, RegistryAgent> }>({ agents: {} });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<RegistryAgent | null>(null);
  const [selectedChild, setSelectedChild] = useState<ChildAgent | null>(null);
  const [messages, setMessages] = useState<ExportMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [screenLines, setScreenLines] = useState<string[]>([]);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialogControls, setDialogControls] = useState<{
    toggleTools: () => void;
    scrollBy: (delta: number) => void;
    jumpToTop: () => void;
    jumpToBottom: () => void;
  } | null>(null);
  const [childrenSelectedIndex, setChildrenSelectedIndex] = useState(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionRange = selectionStart && selectionCurrent
    ? {
        startY: Math.min(selectionStart.y, selectionCurrent.y),
        endY: Math.max(selectionStart.y, selectionCurrent.y),
      }
    : null;

  const agents = Object.values(registry.agents ?? {}).filter(Boolean) as RegistryAgent[];
  const rows = getFlattenedRows(agents);
  const [selectedIndex, moveSelection] = useListSelection(rows);
  const children = selectedAgent?.children ?? [];
  const registerDialogControls = useCallback(
    (controls: { toggleTools: () => void; scrollBy: (delta: number) => void; jumpToTop: () => void; jumpToBottom: () => void }) => {
      setDialogControls(() => controls);
    },
    []
  );
  const updateScreenLines = useCallback((lines: string[]) => {
    setScreenLines((prev) => {
      if (prev.length === lines.length && prev.every((value, idx) => value === lines[idx])) {
        return prev;
      }
      return lines;
    });
  }, []);

  const refreshMs = refreshSeconds * 1000;
  // Never render more content rows than actually available terminal rows.
  const contentHeight = Math.max(1, terminalHeight - (toast ? 2 : 1));
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1400);
  }, []);
  const copyToClipboard = useCallback(
    (text: string) => {
      const out = stdout as { write?: (s: string) => unknown } | undefined;
      if (!text || !out || typeof out.write !== "function") return false;
      const encoded = Buffer.from(text, "utf8").toString("base64");
      out.write(`\x1b]52;c;${encoded}\x07`);
      return true;
    },
    [stdout]
  );
  const handleSelectionMouseEvent = useCallback(
    (ev: { mouseDown: boolean; mouseDrag: boolean; mouseUp: boolean; mouseX: number | null; mouseY: number | null }) => {
      if (ev.mouseDown && ev.mouseX != null && ev.mouseY != null) {
        const point = { x: ev.mouseX, y: ev.mouseY };
        setSelectionStart(point);
        setSelectionCurrent(point);
        return true;
      }
      if (ev.mouseDrag && ev.mouseX != null && ev.mouseY != null && selectionStart) {
        setSelectionCurrent({ x: ev.mouseX, y: ev.mouseY });
        return true;
      }
      if (ev.mouseUp && selectionStart) {
        const end = (ev.mouseX != null && ev.mouseY != null)
          ? { x: ev.mouseX, y: ev.mouseY }
          : (selectionCurrent ?? selectionStart);
        const selected = extractSelectedText(screenLines, selectionStart, end);
        setSelectionStart(null);
        setSelectionCurrent(null);
        if (selected) {
          const copied = copyToClipboard(selected);
          showToast(copied ? `Copied ${selected.length} chars` : "Selection copied");
        }
        return true;
      }
      return false;
    },
    [selectionStart, selectionCurrent, screenLines, copyToClipboard, showToast]
  );
  const handleWheelEvent = useCallback(
    (delta: number): boolean => {
      if (!Number.isFinite(delta) || delta === 0) return false;
      if (screen === "dashboard") {
        moveSelection(delta);
        return true;
      }
      if (screen === "children") {
        setChildrenSelectedIndex((i) => Math.max(0, Math.min(children.length - 1, i + delta)));
        return true;
      }
      if (screen === "dialog") {
        dialogControls?.scrollBy(delta);
        return true;
      }
      return false;
    },
    [screen, moveSelection, children.length, dialogControls]
  );
  const quit = useCallback(() => {
    const out = stdout as { write?: (s: string, cb?: () => void) => unknown } | undefined;
    if (out && typeof out.write === "function") {
      // Ensure shell prompt starts on a clean line after TUI exit.
      let exited = false;
      const exitNow = () => {
        if (exited) return;
        exited = true;
        process.exit(0);
      };
      out.write("\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[2K\r\n", exitNow);
      setTimeout(exitNow, 30);
      return;
    }
    process.exit(0);
  }, [stdout]);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Refresh registry periodically
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const r = await dataProvider.readRegistry(cwd);
      if (mounted) setRegistry(r as { agents: Record<string, RegistryAgent> });
    };
    load();
    const iv = setInterval(() => {
      setNowMs(Date.now());
      load();
    }, refreshMs);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, [cwd, refreshMs, dataProvider]);

  // Enable terminal mouse reporting so wheel events reach Ink input.
  useEffect(() => {
    const out = stdout as { isTTY?: boolean; write?: (s: string) => unknown } | undefined;
    if (!out || !out.isTTY || typeof out.write !== "function") return;
    out.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
    return () => {
      out.write?.("\x1b[?1000l\x1b[?1002l\x1b[?1006l");
    };
  }, [stdout]);

  // Some terminals don't forward mouse drag/up through Ink useInput; consume raw stdin too.
  useEffect(() => {
    const input = stdin as {
      on?: (event: string, cb: (chunk: Buffer | string) => void) => void;
      off?: (event: string, cb: (chunk: Buffer | string) => void) => void;
      removeListener?: (event: string, cb: (chunk: Buffer | string) => void) => void;
    } | undefined;
    if (!input || typeof input.on !== "function") return;
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");

      const sgr = text.match(/\x1b\[<\d+;\d+;\d+[mM]/g) ?? [];
      for (const seq of sgr) {
        const parsed = parseMouseInput(seq);
        if (parsed.wheelUp) handleWheelEvent(-1);
        if (parsed.wheelDown) handleWheelEvent(1);
        if (parsed.mouseDown || parsed.mouseDrag || parsed.mouseUp) {
          handleSelectionMouseEvent(parsed);
        }
      }

      for (let i = 0; i + 5 < text.length; i += 1) {
        if (text[i] === "\x1b" && text[i + 1] === "[" && text[i + 2] === "M") {
          const seq = text.slice(i, i + 6);
          const parsed = parseMouseInput(seq);
          if (parsed.wheelUp) handleWheelEvent(-1);
          if (parsed.wheelDown) handleWheelEvent(1);
          if (parsed.mouseDown || parsed.mouseDrag || parsed.mouseUp) {
            handleSelectionMouseEvent(parsed);
          }
          i += 5;
        }
      }
    };
    input.on("data", onData);
    return () => {
      if (typeof input.off === "function") input.off("data", onData);
      else input.removeListener?.("data", onData);
    };
  }, [stdin, handleSelectionMouseEvent, handleWheelEvent]);

  // Clamp children selection when list changes.
  useEffect(() => {
    if (screen !== "children") return;
    setChildrenSelectedIndex((i) => {
      if (children.length <= 0) return 0;
      return Math.max(0, Math.min(children.length - 1, i));
    });
  }, [screen, children.length]);

  const handleKey = useCallback(
    (ev: KeyEvent): boolean => {
      if (ev.input === "q" && !ev.ctrl) {
        quit();
        return true;
      }
      if (ev.wheelDown) return handleWheelEvent(1);
      if (ev.wheelUp) return handleWheelEvent(-1);
      if (handleSelectionMouseEvent(ev)) {
        return true;
      }

      if (screen === "dashboard") {
        if (ev.input === "j" || ev.downArrow) {
          moveSelection(1);
          return true;
        }
        if (ev.input === "k" || ev.upArrow) {
          moveSelection(-1);
          return true;
        }
        if (ev.escape) return true;
        if (ev.return) {
          const row = rows[selectedIndex];
          if (!row) return true;
          const agent = row.item as RegistryAgent;
          const hasSessionId = agent.sessionId && typeof agent.sessionId === "string";
          if (row.isChild && (row.item as ChildAgent).sessionId) {
            const child = row.item as ChildAgent;
            setSelectedChild(child);
            setSelectedAgent(agents.find((a) => a.children?.some((c) => c?.sessionId === child.sessionId)) ?? null);
            setPreviousScreen("dashboard");
            setScreen("dialog");
            return true;
          }
          if (hasSessionId && agent) {
            setSelectedAgent(agent);
            setSelectedChild(null);
            setPreviousScreen("dashboard");
            setScreen("dialog");
            return true;
          }
          return true;
        }
        if (ev.input === "c") {
          const row = rows[selectedIndex];
          if (!row) return true;
          const agent = row.item as RegistryAgent;
          if (row.isChild) return true;
          const agentChildren = agent.children ?? [];
          if (agentChildren.length > 0) {
            setSelectedAgent(agent);
            setSelectedChild(null);
            setChildrenSelectedIndex(0);
            setScreen("children");
            return true;
          }
          return true;
        }
      }

      if (screen === "children") {
        if (ev.escape) {
          setScreen("dashboard");
          setSelectedAgent(null);
          return true;
        }
        if (ev.input === "j" || ev.downArrow) {
          setChildrenSelectedIndex((i) => Math.min(children.length - 1, i + 1));
          return true;
        }
        if (ev.input === "k" || ev.upArrow) {
          setChildrenSelectedIndex((i) => Math.max(0, i - 1));
          return true;
        }
        if (ev.return) {
          const child = children[childrenSelectedIndex];
          if (child) {
            setSelectedChild(child);
            setPreviousScreen("children");
            setScreen("dialog");
          }
          return true;
        }
      }

      if (screen === "dialog") {
        if (ev.escape) {
          setScreen(previousScreen ?? "dashboard");
          if (previousScreen !== "children") {
            setSelectedAgent(null);
          }
          setSelectedChild(null);
          setPreviousScreen(null);
          return true;
        }
        if (ev.input === "j" || ev.downArrow) {
          dialogControls?.scrollBy(1);
          return true;
        }
        if (ev.input === "k" || ev.upArrow) {
          dialogControls?.scrollBy(-1);
          return true;
        }
        if (ev.input === "g") {
          dialogControls?.jumpToTop();
          return true;
        }
        if (ev.input === "G") {
          dialogControls?.jumpToBottom();
          return true;
        }
        if (ev.input === "t") {
          dialogControls?.toggleTools();
          return true;
        }
      }

      return false;
    },
    [
      screen,
      previousScreen,
      selectedIndex,
      rows,
      moveSelection,
      agents,
      dialogControls,
      children,
      childrenSelectedIndex,
      quit,
      handleSelectionMouseEvent,
      handleWheelEvent,
    ]
  );

  useGlobalInput(handleKey);

  // Load messages when on dialog screen: child = readChildMessages, parent = exportSession
  useEffect(() => {
    if (screen !== "dialog") return;
    const target = selectedChild ?? selectedAgent;
    const sessionId = (target as ChildAgent)?.sessionId ?? (selectedAgent as RegistryAgent)?.sessionId;
    const targetCwd = (selectedAgent as RegistryAgent)?.cwd ?? cwd;
    if (!sessionId || typeof sessionId !== "string") {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    let mounted = true;
    setMessagesLoading(true);
    setMessages([]);
    if (selectedChild) {
      dataProvider
        .readChildMessages(sessionId)
        .then((msgs) => {
          if (mounted) {
            setMessages(msgs);
            setMessagesLoading(false);
          }
        })
        .catch(() => {
          if (mounted) {
            setMessages([]);
            setMessagesLoading(false);
          }
        });
    } else {
      dataProvider
        .exportSession(sessionId, targetCwd)
        .then((data) => {
          if (!mounted) return;
          const exp = data as { messages?: ExportMessage[] };
          setMessages(Array.isArray(exp?.messages) ? exp.messages : []);
          setMessagesLoading(false);
        })
        .catch(() => {
          if (mounted) {
            setMessages([]);
            setMessagesLoading(false);
          }
        });
    }
    return () => {
      mounted = false;
    };
  }, [screen, selectedAgent, selectedChild, cwd, dataProvider]);

  const name = (selectedChild?.title ?? selectedChild?.sessionId ?? selectedAgent?.name ?? "?") as string;

  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight}>
      <Box flexDirection="column" flexGrow={1}>
        {screen === "dashboard" && (
          <Dashboard
            agents={agents}
            selectedIndex={selectedIndex}
            nowMs={nowMs}
            terminalWidth={terminalWidth}
            viewportHeight={contentHeight}
            onVisibleLines={updateScreenLines}
            selectionRange={selectionRange}
          />
        )}
        {screen === "children" && selectedAgent && (
          <ChildrenPanel
            children={children}
            parentName={selectedAgent.name ?? "?"}
            selectedIndex={childrenSelectedIndex}
            onSelect={(child) => {
              setSelectedChild(child);
              setScreen("dialog");
            }}
            terminalWidth={terminalWidth}
            viewportHeight={contentHeight}
            onVisibleLines={updateScreenLines}
            selectionRange={selectionRange}
          />
        )}
        {screen === "dialog" && (
          <AgentDialog
            messages={messages}
            name={name}
            loading={messagesLoading}
            terminalWidth={terminalWidth}
            viewportHeight={contentHeight}
            onRegisterControls={registerDialogControls}
            onVisibleLines={updateScreenLines}
            selectionRange={selectionRange}
          />
        )}
      </Box>
      {toast && (
        <Text color="black" backgroundColor="green">
          {toast}
        </Text>
      )}
      <StatusBar screen={screen} width={terminalWidth} />
    </Box>
  );
}
