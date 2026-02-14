import React from "react";
import { Box, Text } from "ink";
import { formatDuration, parseTimeMs } from "./data";
import type { RegistryAgent, ChildAgent } from "./data";

export interface DashboardProps {
  agents: RegistryAgent[];
  /** Index over combined list: [...liveRows, ...doneRows] */
  selectedIndex: number;
  nowMs: number;
  terminalWidth?: number;
  viewportHeight?: number;
  onVisibleLines?: (lines: string[]) => void;
  selectionRange?: { startY: number; endY: number } | null;
}

export function getFlattenedRows(agents: RegistryAgent[]) {
  return flattenWithChildren(
    agents.filter((a) => a && (a.status === "running" || a.status === "scheduled"))
  ).concat(
    flattenWithChildren(agents.filter((a) => a && (a.status === "done" || a.status === "unknown")))
  );
}

function flattenWithChildren(agents: RegistryAgent[]): { item: RegistryAgent | ChildAgent; isChild: boolean; parentName?: string }[] {
  const out: { item: RegistryAgent | ChildAgent; isChild: boolean; parentName?: string }[] = [];
  for (const a of agents) {
    if (!a || typeof a !== "object") continue;
    out.push({ item: a, isChild: false });
    const children = Array.isArray(a.children) ? a.children : [];
    for (const c of children) {
      if (c && typeof c === "object") {
        out.push({ item: c, isChild: true, parentName: a.name ?? undefined });
      }
    }
  }
  return out;
}

/** Dashboard: running/scheduled and done/unknown sections with child rows. */
export function Dashboard({
  agents,
  selectedIndex,
  nowMs,
  terminalWidth = 120,
  viewportHeight = 20,
  onVisibleLines,
  selectionRange,
}: DashboardProps) {
  const liveAgents = agents.filter((a) => a && (a.status === "running" || a.status === "scheduled"));
  const doneAgents = agents.filter((a) => a && (a.status === "done" || a.status === "unknown"));
  const liveRows = flattenWithChildren(liveAgents);
  const doneRows = flattenWithChildren(doneAgents);

  const toModel = (a: RegistryAgent | ChildAgent) => {
    const m = a.model ?? "-";
    const variant = (a as RegistryAgent).variant;
    return m !== "-" && variant ? `${m}-${variant}` : m;
  };

  const ellipsize = (value: string, width: number) => {
    if (width <= 0) return "";
    if (value.length <= width) return value;
    if (width === 1) return value.slice(0, 1);
    return `${value.slice(0, width - 1)}…`;
  };
  const padRight = (value: string, width: number) => ellipsize(value, width).padEnd(width);
  const padLeft = (value: string, width: number) => ellipsize(value, width).padStart(width);

  const markerW = 2;
  let showModel = terminalWidth >= 96;
  let showUsage = terminalWidth >= 76;
  let showDur = terminalWidth >= 44;

  let stateW = terminalWidth >= 70 ? 10 : terminalWidth >= 52 ? 8 : 6;
  let modelW = showModel ? (terminalWidth >= 124 ? 28 : 20) : 0;

  const usageWidths = { msgW: 4, tknW: 8, fullW: 6 };
  const durW = 8;

  const fixedWithoutName = () => {
    const columns =
      2 + // name + status
      (showModel ? 1 : 0) +
      (showDur ? 1 : 0) +
      (showUsage ? 3 : 0);
    const gapCount = Math.max(0, columns - 1);
    return (
      markerW +
      stateW +
      (showModel ? modelW : 0) +
      (showDur ? durW : 0) +
      (showUsage ? usageWidths.msgW + usageWidths.tknW + usageWidths.fullW : 0) +
      gapCount
    );
  };

  // Degrade columns until the fixed portion fits.
  for (let guard = 0; guard < 10 && fixedWithoutName() > terminalWidth; guard += 1) {
    if (showUsage) {
      showUsage = false;
      continue;
    }
    if (showModel) {
      showModel = false;
      modelW = 0;
      continue;
    }
    if (showDur) {
      showDur = false;
      continue;
    }
    if (stateW > 4) {
      stateW -= 1;
      continue;
    }
    break;
  }

  const msgW = showUsage ? usageWidths.msgW : 0;
  const tknW = showUsage ? usageWidths.tknW : 0;
  const fullW = showUsage ? usageWidths.fullW : 0;
  const columns = 2 + (showModel ? 1 : 0) + (showDur ? 1 : 0) + (showUsage ? 3 : 0);
  const gapCount = Math.max(0, columns - 1);
  const fixedW =
    markerW + stateW + (showModel ? modelW : 0) + (showDur ? durW : 0) + msgW + tknW + fullW + gapCount;
  const nameW = Math.max(0, terminalWidth - fixedW);

  const headerParts = [
    padRight("NAME", nameW),
    padRight("STATUS", stateW),
    ...(showModel ? [padRight("MODEL", modelW)] : []),
    ...(showDur ? [padLeft("DUR", durW)] : []),
    ...(showUsage ? [padLeft("MSG", msgW), padLeft("TKN", tknW), padLeft("FULL", fullW)] : []),
  ];
  const headerLine = `  ${headerParts.join(" ")}`;

  const formatRow = (row: { item: RegistryAgent | ChildAgent; isChild: boolean }, isDone: boolean, isSelected: boolean) => {
    const a = row.item;
    const nameBase = (a as RegistryAgent).name ?? (a as ChildAgent).title ?? (a as ChildAgent).sessionId ?? "?";
    const name = row.isChild ? `  - ${nameBase}` : nameBase;
    const status = String(a.status ?? "-");
    const model = toModel(a);
    const startedMs = parseTimeMs(a.startedAt);
    const endedMs = isDone ? parseTimeMs((a as ChildAgent).finishedAt ?? (a as RegistryAgent).finishedAt) : null;
    const runtime = startedMs === null
      ? "-"
      : isDone && endedMs !== null
        ? formatDuration(Math.max(0, endedMs - startedMs))
        : formatDuration(Math.max(0, nowMs - startedMs));
    const usage = a.usage;
    const msgCount = usage?.messageCount != null ? String(usage.messageCount) : "-";
    const dialogTkn = usage?.dialogTokens != null ? String(usage.dialogTokens) : "-";
    const pct = usage?.contextFullPct != null ? `${(usage.contextFullPct * 100).toFixed(1)}%` : "-";
    const parts = [
      padRight(name, nameW),
      padRight(status, stateW),
      ...(showModel ? [padRight(model, modelW)] : []),
      ...(showDur ? [padLeft(runtime, durW)] : []),
      ...(showUsage ? [padLeft(msgCount, msgW), padLeft(dialogTkn, tknW), padLeft(pct, fullW)] : []),
    ];
    return { line: `${isSelected ? "> " : "  "}${parts.join(" ")}`, selected: isSelected };
  };

  type ScreenLine = {
    kind: "header" | "empty" | "row" | "spacer";
    text: string;
    selected?: boolean;
    rowIndex?: number;
    color?: "cyan" | "green" | "yellow" | "magenta" | "white";
  };
  const lines: ScreenLine[] = [];
  let cursor = 0;
  lines.push({ kind: "header", text: "LIVE AGENTS", color: "cyan" });
  lines.push({ kind: "header", text: headerLine, color: "cyan" });
  if (liveRows.length === 0) {
    lines.push({ kind: "empty", text: "No agents running." });
  } else {
    for (let i = 0; i < liveRows.length; i += 1) {
      const out = formatRow(liveRows[i]!, false, cursor === selectedIndex);
      lines.push({ kind: "row", text: out.line, selected: out.selected, rowIndex: cursor });
      cursor += 1;
    }
  }

  // Keep a real printable spacer so Ink always renders the blank line.
  lines.push({ kind: "spacer", text: " " });
  lines.push({ kind: "header", text: "DONE AGENTS", color: "magenta" });
  lines.push({ kind: "header", text: headerLine, color: "magenta" });
  if (doneRows.length === 0) {
    lines.push({ kind: "empty", text: "No completed agents." });
  } else {
    for (let i = 0; i < doneRows.length; i += 1) {
      const out = formatRow(doneRows[i]!, true, cursor === selectedIndex);
      lines.push({ kind: "row", text: out.line, selected: out.selected, rowIndex: cursor });
      cursor += 1;
    }
  }

  const selectedLine = lines.findIndex((line) => line.rowIndex === selectedIndex);
  const maxLines = Math.max(1, viewportHeight);
  const start = selectedLine < 0
    ? 0
    : Math.max(0, Math.min(lines.length - maxLines, selectedLine - Math.floor(maxLines / 2)));
  const visible = lines.slice(start, start + maxLines);
  React.useEffect(() => {
    onVisibleLines?.(visible.map((line) => line.text));
  }, [onVisibleLines, visible]);

  return (
    <Box flexDirection="column">
      {visible.map((line, idx) => (
        (() => {
          const lineNo = idx + 1;
          const highlighted = Boolean(selectionRange && lineNo >= selectionRange.startY && lineNo <= selectionRange.endY);
          return (
        <Text
          key={`${line.kind}-${idx}-${line.rowIndex ?? "na"}`}
          bold={line.kind === "header" || Boolean(line.selected)}
          color={line.color ?? (line.selected ? "green" : undefined)}
          dimColor={line.kind === "empty" || line.kind === "spacer"}
          backgroundColor={highlighted ? "blue" : undefined}
        >
          {line.text}
        </Text>
          );
        })()
      ))}
    </Box>
  );
}
