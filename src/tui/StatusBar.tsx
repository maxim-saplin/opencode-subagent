import React from "react";
import { Box, Text } from "ink";

export type Screen = "dashboard" | "dialog" | "children";

export interface StatusBarProps {
  screen: Screen;
  hint?: string;
  width?: number;
}

const HINT_TOKENS: Record<Screen, string[]> = {
  dashboard: ["↑/↓ j/k or wheel move", "Enter drill-down", "c children", "drag select copies", "q quit"],
  children: ["↑/↓ j/k or wheel move", "Enter open dialog", "Esc back", "drag select copies", "q quit"],
  dialog: ["↑/↓ j/k or wheel scroll", "t toggle tools", "Esc back", "drag select copies", "q quit"],
};

function formatHint(tokens: string[], width: number): string {
  const max = Math.max(1, width);
  if (tokens.length === 0) return "";
  const joiner = " · ";
  const full = tokens.join(joiner);
  if (full.length <= max) return full;

  // Always preserve a quit affordance at the right edge.
  const quitToken = tokens[tokens.length - 1] ?? "q quit";
  if (max <= 1) return "q".slice(0, max);
  if (max < quitToken.length) return quitToken.slice(0, max);

  let out = quitToken;
  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    const candidate = `${tokens[i]}${joiner}${out}`;
    if (candidate.length <= max) out = candidate;
    else break;
  }

  if (out.length === full.length) return out;
  const withEllipsis = `… ${out}`;
  if (withEllipsis.length <= max) return withEllipsis;
  // Fall back to keeping the right-most content.
  return out.length <= max ? out : out.slice(out.length - max);
}

/** Bottom status bar with keyboard hints. */
export function StatusBar({ screen, hint, width = 120 }: StatusBarProps) {
  const value = hint ?? formatHint(HINT_TOKENS[screen] ?? ["q quit"], width);
  const max = Math.max(8, width);
  const text = value.length > max ? value.slice(0, max - 1) + "…" : value;
  return (
    <Box>
      <Text dimColor>{text}</Text>
    </Box>
  );
}
