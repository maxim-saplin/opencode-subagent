import React from "react";
import { Box, Text } from "ink";
import { formatDuration } from "./data";
import type { ChildAgent } from "./data";

export interface ChildrenPanelProps {
  children: ChildAgent[];
  parentName: string;
  selectedIndex: number;
  onSelect: (child: ChildAgent) => void;
  terminalWidth?: number;
  viewportHeight?: number;
  onVisibleLines?: (lines: string[]) => void;
  selectionRange?: { startY: number; endY: number } | null;
}

/** List all children for selected parent; Enter drill-down. Parent handles keyboard. */
export function ChildrenPanel({
  children,
  parentName,
  selectedIndex,
  onSelect,
  terminalWidth = 120,
  viewportHeight = 20,
  onVisibleLines,
  selectionRange,
}: ChildrenPanelProps) {
  const ellipsize = (value: string, width: number) => {
    if (width <= 0) return "";
    if (value.length <= width) return value;
    if (width === 1) return value.slice(0, 1);
    return `${value.slice(0, width - 1)}…`;
  };
  const padRight = (value: string, width: number) => ellipsize(value, width).padEnd(width);
  const padLeft = (value: string, width: number) => ellipsize(value, width).padStart(width);
  const markerW = 2;
  let showUsage = terminalWidth >= 72;
  let showDur = terminalWidth >= 44;
  let statusW = terminalWidth >= 70 ? 10 : terminalWidth >= 52 ? 8 : 6;
  const durW = 8;
  const usageW = { msgW: 4, tknW: 8 };

  const fixedWithoutName = () => {
    const columns =
      2 + // name + status
      (showDur ? 1 : 0) +
      (showUsage ? 2 : 0);
    const gaps = Math.max(0, columns - 1);
    return (
      markerW +
      statusW +
      (showDur ? durW : 0) +
      (showUsage ? usageW.msgW + usageW.tknW : 0) +
      gaps
    );
  };

  for (let guard = 0; guard < 10 && fixedWithoutName() > terminalWidth; guard += 1) {
    if (showUsage) {
      showUsage = false;
      continue;
    }
    if (showDur) {
      showDur = false;
      continue;
    }
    if (statusW > 4) {
      statusW -= 1;
      continue;
    }
    break;
  }

  const msgW = showUsage ? usageW.msgW : 0;
  const tknW = showUsage ? usageW.tknW : 0;
  const columns = 2 + (showDur ? 1 : 0) + (showUsage ? 2 : 0);
  const gaps = Math.max(0, columns - 1);
  const fixedW = markerW + statusW + (showDur ? durW : 0) + msgW + tknW + gaps;
  const nameW = Math.max(0, terminalWidth - fixedW);
  const header = `  ${[
    padRight("NAME", nameW),
    padRight("STATUS", statusW),
    ...(showDur ? [padLeft("DUR", durW)] : []),
    ...(showUsage ? [padLeft("MSG", msgW), padLeft("TKN", tknW)] : []),
  ].join(" ")}`;

  const lines = children.map((child, i) => {
    const selected = i === selectedIndex;
    const title = child.title ?? child.sessionId ?? "?";
    const status = child.status ?? "-";
    const startMs = child.startedAt ? new Date(child.startedAt).getTime() : null;
    const endMs = child.finishedAt ? new Date(child.finishedAt).getTime() : null;
    const runtime = startMs != null && endMs != null ? formatDuration(Math.max(0, endMs - startMs)) : "-";
    const msg = child.usage?.messageCount != null ? String(child.usage.messageCount) : "-";
    const tkn = child.usage?.dialogTokens != null ? String(child.usage.dialogTokens) : "-";
    const text = `${selected ? "> " : "  "}${[
      padRight(title, nameW),
      padRight(String(status), statusW),
      ...(showDur ? [padLeft(runtime, durW)] : []),
      ...(showUsage ? [padLeft(msg, msgW), padLeft(tkn, tknW)] : []),
    ].join(" ")}`;
    return { text, selected };
  });
  const topLines = 2;
  const maxLines = Math.max(1, viewportHeight - topLines);
  const start = Math.max(0, Math.min(Math.max(0, lines.length - maxLines), selectedIndex - Math.floor(maxLines / 2)));
  const visible = lines.slice(start, start + maxLines);
  React.useEffect(() => {
    const out = [`Children of ${parentName}`, header];
    if (children.length === 0) out.push("No children");
    else out.push(...visible.map((line) => line.text));
    onVisibleLines?.(out);
  }, [onVisibleLines, parentName, header, children.length, visible]);

  return (
    <Box flexDirection="column">
      <Text
        bold
        color="cyan"
        backgroundColor={selectionRange && 1 >= selectionRange.startY && 1 <= selectionRange.endY ? "blue" : undefined}
      >
        Children of {parentName}
      </Text>
      <Text
        bold
        color="cyan"
        backgroundColor={selectionRange && 2 >= selectionRange.startY && 2 <= selectionRange.endY ? "blue" : undefined}
      >
        {header}
      </Text>
      {children.length === 0 ? (
        <Text
          dimColor
          backgroundColor={selectionRange && 3 >= selectionRange.startY && 3 <= selectionRange.endY ? "blue" : undefined}
        >
          No children
        </Text>
      ) : (
        visible.map((line, i) => (
          <Text
            key={`${i}-${line.text}`}
            color={line.selected ? "green" : undefined}
            bold={line.selected}
            backgroundColor={
              selectionRange && i + 3 >= selectionRange.startY && i + 3 <= selectionRange.endY ? "blue" : undefined
            }
          >
            {line.text}
          </Text>
        ))
      )}
    </Box>
  );
}
