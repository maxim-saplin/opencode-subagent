import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Box, Text } from "ink";
import { messageToText } from "./MessageBlock";
import { extractDialogTokens, type ExportMessage } from "./data";

export interface MessagePart {
  type: "text" | "tool";
  role?: "user" | "assistant";
  text?: string;
  tool?: string;
  content?: string;
}

export interface AgentDialogProps {
  messages: ExportMessage[];
  name: string;
  loading?: boolean;
  toolExpandedByDefault?: boolean;
  terminalWidth?: number;
  viewportHeight?: number;
  onVisibleLines?: (lines: string[]) => void;
  selectionRange?: { startY: number; endY: number } | null;
  /** Called by parent to wire keybindings (toggle + scroll). */
  onRegisterControls?: (controls: {
    toggleTools: () => void;
    scrollBy: (delta: number) => void;
    jumpToTop: () => void;
    jumpToBottom: () => void;
  }) => void;
  /** Back-compat: called when 't' is pressed; parent should toggle toolsExpanded. */
  onRegisterToggle?: (toggle: () => void) => void;
}

/** Parse message into parts for display. */
function messageToParts(msg: ExportMessage): MessagePart[] {
  const parts: MessagePart[] = [];
  const role = (msg.info && typeof msg.info === "object" ? (msg.info as { role?: string }).role : msg.role) || "";

  if (Array.isArray(msg.parts)) {
    for (const p of msg.parts) {
      if (!p || typeof p !== "object") continue;
      if (p.type === "text" && typeof p.text === "string") {
        parts.push({ type: "text", role: role as "user" | "assistant", text: p.text });
      } else if (p.type === "tool" && typeof p.tool === "string") {
        const partObj = p as { input?: string; state?: unknown };
        const content =
          typeof partObj.input === "string"
            ? partObj.input
            : partObj.state != null
              ? JSON.stringify(partObj.state, null, 2)
              : JSON.stringify(p);
        parts.push({ type: "tool", tool: p.tool, content });
      }
    }
  }

  if (parts.length === 0 && role) {
    const text = messageToText(msg);
    if (text) parts.push({ type: "text", role: role as "user" | "assistant", text });
  }
  return parts;
}

type DialogLine = { text: string; color?: "cyan" | "green" | "yellow"; bold?: boolean; dimColor?: boolean };

function normalizeDialogLines(lines: DialogLine[]): DialogLine[] {
  const out: DialogLine[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.text.trim().length === 0;
    if (isBlank && previousBlank) continue;
    out.push(line);
    previousBlank = isBlank;
  }
  while (out.length > 0 && out[out.length - 1]!.text.trim().length === 0) {
    out.pop();
  }
  return out;
}

function countTrailingBlankLines(lines: DialogLine[]): number {
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.text.trim().length === 0) count += 1;
    else break;
  }
  return count;
}

function buildFilledWindow(lines: DialogLine[], start: number, maxVisible: number): DialogLine[] {
  let cursor = Math.max(0, start);
  const out = lines.slice(cursor, cursor + maxVisible);
  cursor += out.length;

  while (out.length < maxVisible && cursor < lines.length) {
    out.push(lines[cursor]!);
    cursor += 1;
  }

  // If the page ends in blank lines but we still have content below, pull lines
  // from below to keep the viewport visually filled.
  for (let guard = 0; guard < maxVisible && cursor < lines.length; guard += 1) {
    const trailingBlank = countTrailingBlankLines(out);
    if (trailingBlank === 0) break;
    out.splice(Math.max(0, out.length - trailingBlank), trailingBlank);
    while (out.length < maxVisible && cursor < lines.length) {
      out.push(lines[cursor]!);
      cursor += 1;
    }
  }

  return out;
}

function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const normalized = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized.split("\n");
  const out: string[] = [];

  for (const para of paragraphs) {
    if (para === "") {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if (!line) {
        if (word.length <= w) {
          line = word;
        } else {
          for (let i = 0; i < word.length; i += w) out.push(word.slice(i, i + w));
          line = "";
        }
        continue;
      }
      if (line.length + 1 + word.length <= w) {
        line += " " + word;
        continue;
      }
      out.push(line);
      if (word.length <= w) {
        line = word;
      } else {
        for (let i = 0; i < word.length; i += w) out.push(word.slice(i, i + w));
        line = "";
      }
    }
    if (line) out.push(line);
  }

  return out;
}

function indentedLines(text: string, width: number, indent = "  "): string[] {
  const indentW = indent.length;
  const w = Math.max(1, width - indentW);
  const wrapped = wrapText(text, w);
  return wrapped.map((l) => indent + l);
}

/** Render user/assistant messages; tool parts collapsed by default (toggle with t); scrollable by parent. */
export function AgentDialog({
  messages,
  name,
  loading = false,
  toolExpandedByDefault = false,
  terminalWidth = 120,
  viewportHeight = 24,
  onVisibleLines,
  selectionRange,
  onRegisterControls,
  onRegisterToggle,
}: AgentDialogProps) {
  const [toolsExpanded, setToolsExpanded] = useState(toolExpandedByDefault);
  const [scrollTop, setScrollTop] = useState(0);

  const allParts = useMemo(() => {
    const out: { part: MessagePart; tokens?: number | null }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      const parts = messageToParts(m);
      const tokens =
        (m.info && typeof m.info === "object" && (m.info as { role?: string }).role === "assistant")
          ? extractDialogTokens([m])
          : null;
      for (let j = 0; j < parts.length; j++) {
        out.push({
          part: parts[j]!,
          tokens: parts[j]!.type === "text" ? tokens : undefined,
        });
      }
    }
    return out;
  }, [messages]);

  const contentLines: DialogLine[] = useMemo(() => {
    const w = Math.max(10, terminalWidth);
    const lines: DialogLine[] = [];
    for (let idx = 0; idx < allParts.length; idx += 1) {
      const entry = allParts[idx]!;
      const part = entry.part;
      if (part.type === "text") {
        const role = part.role ?? "assistant";
        const roleLine = role === "user" ? "user:" : "assistant:";
        lines.push({ text: roleLine, color: role === "user" ? "cyan" : "green", bold: true });
        const body = (part.text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        for (const l of indentedLines(body || "(empty)", w)) {
          lines.push({ text: l });
        }
        if (role === "assistant" && entry.tokens != null && entry.tokens > 0) {
          lines.push({ text: `  tokens: ${entry.tokens}`, dimColor: true });
        }
      } else {
        const tool = part.tool ?? "?";
        lines.push({ text: `tool: ${tool}`, color: "yellow" });
        const raw = part.content ?? "";
        const normalized = raw.replace(/\s+/g, " ").trim();
        const preview = normalized.length > 140 ? normalized.slice(0, 140) + "…" : normalized;
        const body = toolsExpanded ? raw || "(empty)" : preview || "(empty)";
        for (const l of indentedLines(body, w)) {
          lines.push({ text: l, dimColor: toolsExpanded ? false : true });
        }
      }
      if (idx < allParts.length - 1) {
        lines.push({ text: "" });
      }
    }
    return normalizeDialogLines(lines);
  }, [allParts, terminalWidth, toolsExpanded]);

  const headerLines: DialogLine[] = useMemo(
    () => [{ text: `Dialog: ${name}`, color: "cyan", bold: true }],
    [name]
  );

  const maxVisible = Math.max(1, viewportHeight - headerLines.length);
  const maxScrollTop = Math.max(0, contentLines.length - maxVisible);

  const atBottomRef = useRef(true);
  const initializedRef = useRef(false);
  useEffect(() => {
    atBottomRef.current = scrollTop >= maxScrollTop;
  }, [scrollTop, maxScrollTop]);

  // Clamp / keep-at-bottom when content changes.
  useEffect(() => {
    setScrollTop((prev) => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        return maxScrollTop;
      }
      const clamped = Math.max(0, Math.min(maxScrollTop, prev));
      return atBottomRef.current ? maxScrollTop : clamped;
    });
  }, [maxScrollTop, contentLines.length]);

  const toggleTools = useCallback(() => setToolsExpanded((v) => !v), []);
  const jumpToTop = useCallback(() => setScrollTop(0), []);
  const jumpToBottom = useCallback(() => setScrollTop(maxScrollTop), [maxScrollTop]);
  const scrollBy = useCallback(
    (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) return;
      setScrollTop((prev) => Math.max(0, Math.min(maxScrollTop, prev + delta)));
    },
    [maxScrollTop]
  );

  useEffect(() => {
    onRegisterToggle?.(toggleTools);
  }, [onRegisterToggle, toggleTools]);

  useEffect(() => {
    onRegisterControls?.({ toggleTools, scrollBy, jumpToTop, jumpToBottom });
  }, [onRegisterControls, toggleTools, scrollBy, jumpToTop, jumpToBottom]);

  const safeStart = Math.max(0, Math.min(scrollTop, Math.max(0, contentLines.length - maxVisible)));
  const visible = buildFilledWindow(contentLines, safeStart, maxVisible);
  useEffect(() => {
    const lines: string[] = headerLines.map((line) => line.text);
    if (allParts.length === 0) {
      lines.push(loading ? "Loading messages..." : "No messages");
    } else {
      lines.push(...visible.map((line) => line.text));
    }
    onVisibleLines?.(lines);
  }, [onVisibleLines, headerLines, allParts.length, loading, visible]);

  return (
    <Box flexDirection="column">
      {headerLines.map((l, i) => (
        <Text
          key={`h-${i}`}
          color={l.color}
          bold={l.bold}
          dimColor={l.dimColor}
          backgroundColor={selectionRange && i + 1 >= selectionRange.startY && i + 1 <= selectionRange.endY ? "blue" : undefined}
        >
          {l.text}
        </Text>
      ))}
      {allParts.length === 0 ? (
        <Text
          dimColor
          backgroundColor={
            selectionRange &&
            headerLines.length + 1 >= selectionRange.startY &&
            headerLines.length + 1 <= selectionRange.endY
              ? "blue"
              : undefined
          }
        >
          {loading ? "Loading messages..." : "No messages"}
        </Text>
      ) : (
        visible.map((l, i) => (
          <Text
            key={`l-${safeStart}-${i}`}
            color={l.color}
            bold={l.bold}
            dimColor={l.dimColor}
            backgroundColor={
              selectionRange &&
              headerLines.length + i + 1 >= selectionRange.startY &&
              headerLines.length + i + 1 <= selectionRange.endY
                ? "blue"
                : undefined
            }
          >
            {l.text}
          </Text>
        ))
      )}
    </Box>
  );
}
