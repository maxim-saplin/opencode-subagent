import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "bun:test";
import {
  readRegistry,
  extractJsonSubstring,
  extractTaskChildren,
  readChildMessages,
  extractDialogTokens,
  parseTimeMs,
  formatDuration,
  formatTimestamp,
} from "../../src/tui/data";
import { cleanupTempDirs, registerTempDir } from "./helpers/cleanup";
import { exportMessage, taskToolPart } from "./helpers/tui-fixtures";

const ROOT = path.resolve(__dirname, "../..");

afterAll(cleanupTempDirs);

describe("tui data helpers", () => {
  describe("readRegistry", () => {
    it("returns registry when file exists", async () => {
      const cwd = path.join(ROOT, ".tmp", "tests", "tui-registry-ok");
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.mkdir(path.join(cwd, ".opencode-subagent"), { recursive: true });
      registerTempDir(cwd);

      const registry = { version: 4, agents: { foo: { name: "foo", status: "done" } } };
      await fs.writeFile(
        path.join(cwd, ".opencode-subagent", "registry.json"),
        JSON.stringify(registry),
        "utf8"
      );

      const result = await readRegistry(cwd);
      expect(result).toEqual(registry);
      expect(result.agents).toBeDefined();
      expect(result.agents!["foo"]).toEqual({ name: "foo", status: "done" });
    });

    it("returns empty registry when file missing", async () => {
      const cwd = path.join(ROOT, ".tmp", "tests", "tui-registry-missing");
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.mkdir(cwd, { recursive: true });
      registerTempDir(cwd);

      const result = await readRegistry(cwd);
      expect(result).toEqual({ agents: {} });
    });

    it("returns empty registry when file invalid", async () => {
      const cwd = path.join(ROOT, ".tmp", "tests", "tui-registry-invalid");
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.mkdir(path.join(cwd, ".opencode-subagent"), { recursive: true });
      registerTempDir(cwd);

      await fs.writeFile(path.join(cwd, ".opencode-subagent", "registry.json"), "not json", "utf8");

      const result = await readRegistry(cwd);
      expect(result).toEqual({ agents: {} });
    });
  });

  describe("extractJsonSubstring", () => {
    it("extracts object from text blob", () => {
      const text = 'prefix {"a":1,"b":[2,3]} suffix';
      expect(extractJsonSubstring(text)).toBe('{"a":1,"b":[2,3]}');
    });

    it("extracts first complete JSON object", () => {
      const text = '{"first":1} {"second":2}';
      expect(extractJsonSubstring(text)).toBe('{"first":1}');
    });

    it("extracts array", () => {
      const text = 'log: [1,2,3] end';
      expect(extractJsonSubstring(text)).toBe("[1,2,3]");
    });

    it("handles nested braces", () => {
      const text = 'x {"outer":{"inner":1}} y';
      expect(extractJsonSubstring(text)).toBe('{"outer":{"inner":1}}');
    });

    it("returns empty when no JSON", () => {
      expect(extractJsonSubstring("no json here")).toBe("");
      expect(extractJsonSubstring("")).toBe("");
    });

    it("handles strings with escaped quotes", () => {
      const text = '{"key":"value with \\"quote\\""}';
      expect(extractJsonSubstring(text)).toBe('{"key":"value with \\"quote\\""}');
    });
  });

  describe("extractTaskChildren", () => {
    it("extracts children from task-tool parts", () => {
      const exportData = {
        messages: [
          {
            role: "assistant",
            parts: [
              taskToolPart("child-1", "Task One"),
              taskToolPart("child-2", "Task Two"),
            ],
          },
        ],
      };
      const children = extractTaskChildren(exportData);
      expect(children).toHaveLength(2);
      expect(children[0]?.sessionId).toBe("child-1");
      expect(children[0]?.title).toBe("Task One");
      expect(children[1]?.sessionId).toBe("child-2");
      expect(children[1]?.title).toBe("Task Two");
    });

    it("returns empty for non-object", () => {
      expect(extractTaskChildren(null)).toEqual([]);
      expect(extractTaskChildren(undefined)).toEqual([]);
    });

    it("returns empty when no messages", () => {
      expect(extractTaskChildren({})).toEqual([]);
      expect(extractTaskChildren({ messages: [] })).toEqual([]);
    });

    it("ignores non-task tool parts", () => {
      const exportData = {
        messages: [
          {
            parts: [
              { type: "tool", tool: "search" },
              taskToolPart("child-1", "Task"),
            ],
          },
        ],
      };
      const children = extractTaskChildren(exportData);
      expect(children).toHaveLength(1);
      expect(children[0]?.sessionId).toBe("child-1");
    });
  });

  describe("readChildMessages", () => {
    it("returns messages from storage dir", async () => {
      const storageBase = path.join(ROOT, ".tmp", "tests", "tui-child-messages", "opencode", "storage");
      const storageParent = path.dirname(path.dirname(storageBase));
      await fs.rm(storageParent, { recursive: true, force: true });
      await fs.mkdir(storageBase, { recursive: true });
      registerTempDir(storageParent);

      const sessionId = "sess-xyz";
      const msgDir = path.join(storageBase, "message", sessionId);
      await fs.mkdir(msgDir, { recursive: true });

      const msg1 = { messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }] };
      const msg2 = { message: { role: "assistant", parts: [{ type: "text", text: "Hello" }] } };
      await fs.writeFile(path.join(msgDir, "0001.json"), JSON.stringify(msg1), "utf8");
      await fs.writeFile(path.join(msgDir, "0002.json"), JSON.stringify(msg2), "utf8");

      const result = await readChildMessages(sessionId, storageBase);
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe("user");
      expect(result[1]?.role).toBe("assistant");
    });

    it("returns empty for missing session dir", async () => {
      process.env.XDG_DATA_HOME = path.join(ROOT, ".tmp", "tests", "tui-child-missing");
      registerTempDir(process.env.XDG_DATA_HOME);
      const result = await readChildMessages("nonexistent-session");
      expect(result).toEqual([]);
    });

    it("returns empty for invalid sessionId", async () => {
      expect(await readChildMessages("")).toEqual([]);
      expect(await readChildMessages(null as unknown as string)).toEqual([]);
    });
  });

  describe("extractDialogTokens", () => {
    it("extracts tokens from last assistant message", () => {
      const messages = [
        exportMessage({ role: "user", info: { role: "user" } }),
        exportMessage({
          role: "assistant",
          info: { role: "assistant", tokens: { input: 100, cache: { read: 50 } } },
        }),
      ];
      expect(extractDialogTokens(messages)).toBe(150);
    });

    it("returns null when no assistant with tokens", () => {
      expect(extractDialogTokens([exportMessage({ role: "user" }), exportMessage({ role: "assistant" })]))
        .toBeNull();
    });

    it("returns null for undefined", () => {
      expect(extractDialogTokens(undefined)).toBeNull();
    });
  });

  describe("parseTimeMs", () => {
    it("parses ISO timestamp", () => {
      const ms = parseTimeMs("2025-02-13T10:00:00.000Z");
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    });

    it("returns null for invalid", () => {
      expect(parseTimeMs("")).toBeNull();
      expect(parseTimeMs(null)).toBeNull();
      expect(parseTimeMs(123)).toBeNull();
    });
  });

  describe("formatDuration", () => {
    it("formats HH:MM:SS", () => {
      expect(formatDuration(0)).toBe("00:00:00");
      expect(formatDuration(65_000)).toBe("00:01:05");
      expect(formatDuration(3661_000)).toBe("01:01:01");
    });

    it("returns - for invalid", () => {
      expect(formatDuration(-1)).toBe("-");
      expect(formatDuration(NaN)).toBe("-");
    });
  });

  describe("formatTimestamp", () => {
    it("formats ISO-like display", () => {
      const s = formatTimestamp("2025-02-13T10:00:00.000Z");
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it("returns - for invalid", () => {
      expect(formatTimestamp("")).toBe("-");
    });
  });
});
