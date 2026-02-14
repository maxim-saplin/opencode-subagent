/**
 * Typed data helpers for TUI. Adapted from opencode-subagent CLI behavior.
 */
import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

const DEFAULT_OPENCODE_PSA_DIR = ".opencode-subagent";
const EXPORT_TIMEOUT_MS = 15_000;
const OPENCODE_STORAGE_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
  "opencode",
  "storage"
);

export interface RegistryAgent {
  name?: string | null;
  status?: string | null;
  pid?: number | null;
  sessionId?: string | null;
  exitCode?: number | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
  model?: string | null;
  variant?: string | null;
  cwd?: string | null;
  usage?: { messageCount?: number; dialogTokens?: number; contextFullPct?: number };
  children?: ChildAgent[];
  [k: string]: unknown;
}

export interface ChildAgent {
  sessionId?: string | null;
  status?: string | null;
  title?: string | null;
  model?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  usage?: { messageCount?: number; dialogTokens?: number; contextFullPct?: number } | null;
  [k: string]: unknown;
}

export interface Registry {
  version?: number;
  agents?: Record<string, RegistryAgent>;
  updatedAt?: string;
}

export interface ExportMessage {
  role?: string;
  info?: { role?: string; tokens?: { input?: number; cache?: { read?: number } } };
  parts?: Array<{ type?: string; tool?: string; text?: string; state?: unknown }>;
  tokens?: { input?: number };
  content?: unknown;
  [k: string]: unknown;
}

function registryDir(root: string): string {
  return path.join(root, process.env.OPENCODE_PSA_DIR || DEFAULT_OPENCODE_PSA_DIR);
}

function registryPath(root: string): string {
  return path.join(registryDir(root), "registry.json");
}

/** Read registry from orchestrator root (process.cwd()). Returns empty registry on missing/invalid. */
export async function readRegistry(root: string): Promise<Registry> {
  const file = registryPath(root);
  try {
    const text = await fs.readFile(file, "utf8");
    const data = JSON.parse(text) as Registry;
    if (!data || typeof data !== "object") throw new Error("bad registry");
    if (!data.agents || typeof data.agents !== "object") data.agents = {};
    return data;
  } catch {
    return { agents: {} };
  }
}

/** Extract first complete JSON value (object/array) from text blob. */
export function extractJsonSubstring(text: string): string {
  if (!text || typeof text !== "string") return "";
  const start = text.search(/[\{\[]/);
  if (start === -1) return "";
  let i = start;
  const len = text.length;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let quoteChar = "";

  for (; i < len; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}") {
      if (stack.length === 0) return "";
      const last = stack.pop();
      if (last !== "{") return "";
      if (stack.length === 0) return text.slice(start, i + 1);
      continue;
    }
    if (ch === "]") {
      if (stack.length === 0) return "";
      const last = stack.pop();
      if (last !== "[") return "";
      if (stack.length === 0) return text.slice(start, i + 1);
      continue;
    }
  }
  return "";
}

/** Run opencode export to stdout via temp file (avoids pipe truncation). */
export async function runExportToStdout(sessionId: string, cwd: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `opencode-export-${process.pid}-${Date.now()}.json`);
  const fd = fsSync.openSync(tmpPath, "w");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("opencode", ["export", sessionId], {
        cwd,
        stdio: ["ignore", fd, "pipe"],
      });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error("Export timed out"), { code: "ETIMEDOUT", killed: true }));
      }, EXPORT_TIMEOUT_MS);
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`opencode export exited with code ${code}`));
        } else {
          resolve();
        }
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    fsSync.closeSync(fd);
    return await fs.readFile(tmpPath, "utf8");
  } finally {
    try {
      fsSync.closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      fsSync.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

/** Export session as parsed JSON. */
export async function exportSessionJson(sessionId: string, cwd: string): Promise<unknown> {
  const stdout = await runExportToStdout(sessionId, cwd);
  const idx = stdout.search(/[\{\[]/);
  if (idx === -1) throw new Error("No JSON found in export output");
  const jsonText = extractJsonSubstring(stdout);
  if (!jsonText) throw new Error("No complete JSON value found in export output");
  return JSON.parse(jsonText);
}

function formatModelRef(model: unknown): string | null {
  if (!model) return null;
  if (typeof model === "string") return model;
  if (typeof model !== "object") return null;
  const m = model as Record<string, unknown>;
  const providerID = typeof m.providerID === "string" ? m.providerID : "";
  const modelID = typeof m.modelID === "string" ? m.modelID : "";
  if (!providerID || !modelID) return null;
  return `${providerID}/${modelID}`;
}

/** Extract task-tool child subagents from export data. */
export function extractTaskChildren(exportData: unknown): ChildAgent[] {
  if (!exportData || typeof exportData !== "object") return [];
  const data = exportData as { messages?: ExportMessage[] };
  if (!Array.isArray(data.messages)) return [];
  const bySessionId = new Map<string, ChildAgent>();
  const order: string[] = [];

  for (const message of data.messages) {
    if (!message || typeof message !== "object" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!part || typeof part !== "object") continue;
      if (part.type !== "tool" || part.tool !== "task") continue;
      const state = part.state && typeof part.state === "object" ? (part.state as Record<string, unknown>) : null;
      const metadata = state?.metadata && typeof state.metadata === "object" ? (state.metadata as Record<string, unknown>) : null;
      const sessionId = metadata && typeof metadata.sessionId === "string" ? metadata.sessionId : "";
      if (!sessionId) continue;
      const model = metadata ? formatModelRef(metadata.model) : null;
      const title = state && typeof state.title === "string" ? state.title : null;
      const status = state && typeof state.status === "string" ? state.status : null;
      const time = state?.time && typeof state.time === "object" ? (state.time as Record<string, string>) : null;
      const startedAt = time?.start && typeof time.start === "string" ? time.start : null;
      const finishedAt = time?.end && typeof time.end === "string" ? time.end : null;

      if (!bySessionId.has(sessionId)) order.push(sessionId);
      bySessionId.set(sessionId, { sessionId, status, title, model, startedAt, finishedAt });
    }
  }

  return order.map((id) => bySessionId.get(id)!).filter(Boolean);
}

/** Read full child messages from OpenCode storage. */
export async function readChildMessages(
  sessionId: string,
  storageBaseDir?: string
): Promise<ExportMessage[]> {
  if (!sessionId || typeof sessionId !== "string") return [];
  const base = storageBaseDir ?? OPENCODE_STORAGE_DIR;
  try {
    const dir = path.join(base, "message", sessionId);
    const entries = await fs.readdir(dir);
    const files = entries.filter((name) => name.endsWith(".json")).sort();
    const messages: ExportMessage[] = [];
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const text = await fs.readFile(full, "utf8");
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj.messages)) {
            for (const msg of obj.messages) {
              if (msg && typeof msg === "object") messages.push(msg as ExportMessage);
            }
          } else if (obj.message && typeof obj.message === "object") {
            messages.push(obj.message as ExportMessage);
          } else {
            messages.push(parsed as ExportMessage);
          }
        }
      } catch {
        /* Ignore malformed files */
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function coerceFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Extract dialog tokens from last assistant message. */
export function extractDialogTokens(messages: ExportMessage[] | undefined): number | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const role = (m.info && typeof m.info === "object" ? (m.info as { role?: string }).role : m.role) || "";
    if (role !== "assistant") continue;
    const info = m.info && typeof m.info === "object" ? (m.info as { tokens?: { input?: number; cache?: { read?: number } } }) : null;
    const directTokens = m.tokens && typeof m.tokens === "object" ? (m.tokens as { input?: number; cache?: { read?: number } }) : null;
    const tokens = info?.tokens || directTokens;
    const input = coerceFiniteNumber(tokens?.input) ?? 0;
    const cache = tokens && typeof tokens.cache === "object" ? (tokens.cache as { read?: number }) : null;
    const cacheRead = coerceFiniteNumber(cache?.read) ?? 0;
    const dialog = input + cacheRead;
    if (dialog > 0) return dialog;
  }
  return null;
}

/** Parse ISO timestamp to milliseconds. */
export function parseTimeMs(value: unknown): number | null {
  if (!value || typeof value !== "string") return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

/** Format timestamp for display (YYYY-MM-DD HH:mm:ss). */
export function formatTimestamp(value: unknown): string {
  const ms = parseTimeMs(value);
  if (ms === null) return "-";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Format duration in HH:MM:SS. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
