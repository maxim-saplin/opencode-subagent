import React from "react";
import { Box, Text } from "ink";

export interface ToolBlockProps {
  tool: string;
  content: string;
  expanded: boolean;
  onToggle?: () => void;
}

/** Render a tool part; collapsed by default, show summary when collapsed. */
export function ToolBlock({ tool, content, expanded }: ToolBlockProps) {
  const preview = content.length > 80 ? content.slice(0, 80) + "…" : content;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="yellow">tool: {tool}</Text>
      {expanded ? (
        <Text wrap="wrap">{content || "(empty)"}</Text>
      ) : (
        <Text dimColor wrap="truncate">
          {preview || "(empty)"}
        </Text>
      )}
    </Box>
  );
}
