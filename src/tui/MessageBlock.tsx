import React from "react";
import { Box, Text } from "ink";

export interface MessageBlockProps {
  role: "user" | "assistant";
  text: string;
  tokens?: number | null;
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  let out = "";
  for (const p of parts) {
    if (p && typeof p === "object" && "text" in p) {
      const t = (p as { text?: string }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

/** Render a single user or assistant message. */
export function MessageBlock({ role, text, tokens }: MessageBlockProps) {
  const prefix = role === "user" ? "user" : "assistant";
  const color = role === "user" ? "cyan" : "green";
  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {prefix}:
      </Text>
      <Text wrap="wrap">{text || "(empty)"}</Text>
      {role === "assistant" && tokens != null && tokens > 0 && (
        <Text dimColor>tokens: {tokens}</Text>
      )}
    </Box>
  );
}

/** Coerce message object to displayable text. */
export function messageToText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { parts?: unknown[]; content?: unknown };
  if (Array.isArray(m.parts)) {
    return extractTextFromParts(m.parts);
  }
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return extractTextFromParts(m.content);
  return "";
}
