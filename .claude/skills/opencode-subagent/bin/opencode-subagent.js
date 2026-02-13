#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { setTimeout: delay } = require("timers/promises");

const execFileAsync = promisify(execFile);

// Maximum buffer for execFile stdout (large exports may exceed Node's default)
const EXEC_MAX_BUFFER = 16 * 1024 * 1024; // 16 MB

const DEFAULT_MODEL = "opencode/gpt-5-nano";
const DEFAULT_WAIT_TIMEOUT_SEC = 100;
const EXPORT_TIMEOUT_MS = 15000;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 50;
const USAGE_DAEMON_INTERVAL_MS = 1000;
const USAGE_RUNNING_REFRESH_MS = 5000;
const USAGE_RETRY_BASE_MS = 2000;
const USAGE_RETRY_MAX_MS = 60000;
const USAGE_LOG_MAX_BYTES = 1024 * 1024;
const USAGE_LOG_TAIL_LINES = 200;
const OPENCODE_STORAGE_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
  "opencode",
  "storage"
);

function parseMajorVersion(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function readContractVersion() {
  const candidates = [
    path.resolve(__dirname, "../../../../package.json"),
    path.resolve(process.cwd(), "package.json"),
  ];

  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const json = JSON.parse(text);
      if (!json || typeof json !== "object") continue;
      const version = parseMajorVersion(json.version);
      if (version !== null && version > 0) return version;
    } catch {
      // ignore missing or invalid package.json
    }
  }

  fail("Missing package.json version", "E_VERSION_MISSING", {
    hint: "Set package.json version (e.g., 4.0.0) to define the contract major.",
  });
  return 0;
}

const CONTRACT_VERSION = readContractVersion();

function nowIso() {
  return new Date().toISOString();
}

function parseTimeMs(value) {
  if (!value || typeof value !== "string") return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function coerceFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch {
    return false;
  }
}

function registryDir(root) {
  return path.join(root, process.env.OPENCODE_PSA_DIR || ".opencode-subagent");
}

function registryPath(root) {
  return path.join(registryDir(root), "registry.json");
}

function lockPath(root) {
  return path.join(registryDir(root), "registry.lock");
}

function usageLogPath(root) {
  return path.join(registryDir(root), "usage-export.log");
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function errorPayload(message, code, details) {
  const out = { ok: false, error: message };
  if (code) out.code = code;
  if (details) out.details = details;
  return out;
}

function fail(message, code, details) {
  printJson(errorPayload(message, code, details));
  process.exit(1);
}

function resolveCommand(cmd) {
  const pathEnv = process.env.PATH || "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of parts) {
    const full = path.join(dir, cmd);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) return full;
    } catch {
      // ignore
    }
  }
  return null;
}

function requireCommand(cmd) {
  if (!resolveCommand(cmd)) {
    fail(`Missing required command: ${cmd}`, "E_CMD_MISSING", {
      hint: `Install '${cmd}' and ensure it is on PATH.`,
    });
  }
}

async function ensureCwd(input) {
  const cwd = path.resolve(input || process.cwd());
  let stat;
  try {
    stat = await fsp.stat(cwd);
  } catch {
    fail("Invalid --cwd", "E_CWD_INVALID", { cwd });
  }
  if (!stat.isDirectory()) {
    fail("Invalid --cwd", "E_CWD_INVALID", { cwd });
  }
  return cwd;
}

async function readRegistry(root) {
  const file = registryPath(root);
  try {
    const text = await fsp.readFile(file, "utf8");
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("bad registry");
    if (!data.agents || typeof data.agents !== "object") data.agents = {};
    if (!data.version) data.version = CONTRACT_VERSION;
    return data;
  } catch {
    return { version: CONTRACT_VERSION, agents: {} };
  }
}

async function writeRegistryAtomic(root, registry) {
  const dir = registryDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const file = registryPath(root);
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  const data = JSON.stringify(registry);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // ignore
  }
}

async function withRegistryLock(root, fn) {
  const dir = registryDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const lock = lockPath(root);
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lock, "wx");
      try {
        return await fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lock);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error("Registry lock timeout");
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

async function upsertAgent(root, record) {
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    if (!registry.agents || typeof registry.agents !== "object") registry.agents = {};
    registry.agents[record.name] = record;
    registry.updatedAt = record.updatedAt || nowIso();
    await writeRegistryAtomic(root, registry);
    return registry;
  });
}

async function upsertAgentWithRetry(root, record, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await upsertAgent(root, record);
      return;
    } catch (err) {
      lastErr = err;
      await delay(LOCK_RETRY_MS * 5);
    }
  }
  throw lastErr;
}

async function refreshRegistry(root, names) {
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const agents = registry.agents || {};
    const keys = names && names.length ? names : Object.keys(agents);
    const now = nowIso();
    let changed = false;

    for (const name of keys) {
      const record = agents[name];
      if (!record || typeof record !== "object") continue;
      const status = record.status;
      if (status === "scheduled" || status === "running") {
        const pid = Number(record.pid);
        const pidValid = Number.isFinite(pid) && pid > 0;
        const alive = pidValid ? isPidAlive(pid) : false;
        if (alive) {
          if (status !== "running") {
            record.status = "running";
            record.updatedAt = now;
            changed = true;
          }
        } else if (status === "running" || pidValid) {
          if (status !== "unknown" && status !== "done") {
            record.status = "unknown";
            record.updatedAt = now;
            if (record.finishedAt === undefined) record.finishedAt = null;
            if (record.exitCode === undefined) record.exitCode = null;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      registry.agents = agents;
      registry.updatedAt = now;
      await writeRegistryAtomic(root, registry);
    }

    return registry;
  });
}

function agentsArray(registry, nameFilter) {
  const agents = registry.agents || {};
  const names = Object.keys(agents).sort();
  const arr = [];
  for (const name of names) {
    if (nameFilter && name !== nameFilter) continue;
    arr.push(agents[name]);
  }
  return arr;
}

function sanitizeAgentForStatus(record) {
  if (!record || typeof record !== "object") return record;
  const out = {
    name: record.name ?? null,
    status: record.status ?? null,
    pid: record.pid ?? null,
    exitCode: record.exitCode ?? null,
    startedAt: record.startedAt ?? null,
    updatedAt: record.updatedAt ?? null,
    finishedAt: record.finishedAt ?? null,
  };
  if (record.usage !== undefined) out.usage = record.usage;
  if (record.model !== undefined) out.model = record.model;
  if (record.variant !== undefined) out.variant = record.variant;
  if (record.resumeCount !== undefined) out.resumeCount = record.resumeCount;
  if (Array.isArray(record.children)) {
    out.children = record.children.map((child) => ({
      sessionId: child && child.sessionId !== undefined ? child.sessionId : null,
      status: child && child.status !== undefined ? child.status : null,
      title: child && child.title !== undefined ? child.title : null,
      model: child && child.model !== undefined ? child.model : null,
      startedAt: child && child.startedAt !== undefined ? child.startedAt : null,
      finishedAt: child && child.finishedAt !== undefined ? child.finishedAt : null,
      usage: child && child.usage !== undefined ? child.usage : null,
    }));
  }
  return out;
}

function diffStatuses(prevAgents, nextAgents) {
  const byName = (arr) => {
    const map = new Map();
    for (const item of arr) {
      if (item && typeof item.name === "string") map.set(item.name, item);
    }
    return map;
  };
  const prev = byName(prevAgents);
  const next = byName(nextAgents);
  const changes = [];
  for (const [name, curr] of next.entries()) {
    const before = prev.get(name);
    if (!before || before.status !== curr.status) {
      changes.push({
        name,
        previousStatus: before ? before.status : null,
        status: curr.status,
        exitCode: curr.exitCode ?? null,
        finishedAt: curr.finishedAt ?? null,
      });
    }
  }
  return changes;
}

async function waitForTerminal(root, name, timeoutSec) {
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : null;
  let prevRegistry = await refreshRegistry(root, [name]);
  let prevAgents = agentsArray(prevRegistry, name);
  let current = prevAgents.find((a) => a && a.name === name);
  if (current && (current.status === "done" || current.status === "unknown")) {
    return { registry: prevRegistry, agents: prevAgents, changed: [] };
  }

  while (true) {
    await delay(500);
    const nextRegistry = await refreshRegistry(root, [name]);
    const nextAgents = agentsArray(nextRegistry, name);
    const changed = diffStatuses(prevAgents, nextAgents);
    current = nextAgents.find((a) => a && a.name === name);
    if (current && (current.status === "done" || current.status === "unknown")) {
      return { registry: nextRegistry, agents: nextAgents, changed };
    }
    prevRegistry = nextRegistry;
    prevAgents = nextAgents;
    if (deadline && Date.now() >= deadline) {
      return { registry: prevRegistry, agents: prevAgents, changed: [], timedOut: true };
    }
  }
}

function parseSessionList(data, title) {
  let sessions = data;
  if (sessions && typeof sessions === "object" && !Array.isArray(sessions) && Array.isArray(sessions.sessions)) {
    sessions = sessions.sessions;
  }
  if (!Array.isArray(sessions)) return "";
  let best = null;
  for (const s of sessions) {
    if (!s || typeof s !== "object") continue;
    if (s.title !== title) continue;
    const id = s.id || s.sessionId;
    if (!id || typeof id !== "string") continue;
    const ts = typeof s.updated === "number" ? s.updated : typeof s.created === "number" ? s.created : null;
    if (!best) {
      best = { ts, id };
      continue;
    }
    if (best.ts === null && ts !== null) best = { ts, id };
    else if (best.ts !== null && ts !== null && ts > best.ts) best = { ts, id };
    else if (best.ts === null && ts === null) best = { ts, id };
  }
  return best ? best.id : "";
}

async function discoverSessionId(title, cwd, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
    const { stdout } = await execFileAsync("opencode", ["session", "list", "--format", "json"], {
      cwd,
      timeout: 5000,
      maxBuffer: EXEC_MAX_BUFFER,
    });
      const text = String(stdout || "");
      const jsonText = extractJsonSubstring(text);
      if (jsonText) {
        const data = JSON.parse(jsonText);
        const id = parseSessionList(data, title);
        if (id) return id;
      }
    } catch {
      // ignore
    }
    await delay(500);
  }
  return "";
}

function coerceContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (typeof part === "string") out += part;
      else if (part && typeof part === "object" && typeof part.text === "string") out += part.text;
    }
    return out;
  }
  return null;
}

function extractLastAssistantText(data) {
  if (!data || typeof data !== "object") return "";
  if (Array.isArray(data.messages)) {
    let last = "";
    for (const m of data.messages) {
      if (!m || typeof m !== "object") continue;
      const role = (m.info && typeof m.info === "object" ? m.info.role : m.role) || "";
      if (role !== "assistant") continue;
      let text = "";
      if (Array.isArray(m.parts)) {
        const textParts = m.parts
          .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text);
        if (textParts.length) text = textParts.join("");
        else {
          const anyParts = m.parts
            .filter((p) => p && typeof p === "object" && typeof p.text === "string")
            .map((p) => p.text);
          if (anyParts.length) text = anyParts.join("");
        }
      }
      if (text) last = String(text).trim();
    }
    return last;
  }
  let last = "";
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }
    if (typeof node === "object") {
      if (node.role === "assistant") {
        const c = coerceContent(node.content);
        if (c !== null) last = String(c).trim();
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
  };
  walk(data);
  return last;
}

// Extract the first complete JSON value (object or array) from a text blob.
// This scans from the first '{' or '[' and finds the matching closing
// bracket while correctly handling string escapes. Returns the JSON
// substring or empty string if a complete JSON value wasn't found.
function extractJsonSubstring(text) {
  if (!text || typeof text !== "string") return "";
  const start = text.search(/[\{\[]/);
  if (start === -1) return "";
  let i = start;
  const len = text.length;
  const stack = [];
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

/**
 * Run opencode export writing to a temp file instead of a pipe.
 * Pipes truncate at 128KB when opencode CLI writes to them (e.g. via Node execFile).
 */
async function runExportToStdout(sessionId, cwd) {
  const tmpPath = path.join(os.tmpdir(), `opencode-export-${process.pid}-${Date.now()}.json`);
  const fd = fs.openSync(tmpPath, "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("opencode", ["export", sessionId], {
        cwd,
        stdio: ["ignore", fd, "pipe"],
      });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error("Export timed out"), { code: "ETIMEDOUT", killed: true }));
      }, EXPORT_TIMEOUT_MS);
      child.on("close", (code, signal) => {
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
    fs.closeSync(fd);
    return await fsp.readFile(tmpPath, "utf8");
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

async function exportSessionJson(sessionId, cwd) {
  const stdout = await runExportToStdout(sessionId, cwd);
  const idx = stdout.search(/[\{\[]/);
  if (idx === -1) throw new Error("No JSON found in export output");
  const jsonText = extractJsonSubstring(stdout);
  if (!jsonText) throw new Error("No complete JSON value found in export output");
  return JSON.parse(jsonText);
}

async function buildModelContextMap() {
  try {
    const { stdout } = await execFileAsync("opencode", ["models", "--verbose"], {
      timeout: 10000,
      maxBuffer: EXEC_MAX_BUFFER,
    });
    const map = new Map();
    const text = String(stdout || "");
    const blocks = text.split(/^(\S+\/\S+)\n/m).filter(Boolean);
    for (let i = 0; i < blocks.length - 1; i += 2) {
      const key = blocks[i].trim();
      try {
        const meta = JSON.parse(blocks[i + 1]);
        const ctx = meta && meta.limit ? meta.limit.context : null;
        if (typeof ctx === "number" && ctx > 0) map.set(key, ctx);
      } catch { /* skip unparseable */ }
    }
    return map;
  } catch {
    return new Map();
  }
}

function extractDialogTokens(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const role = (m.info && typeof m.info === "object" ? m.info.role : m.role) || "";
    if (role !== "assistant") continue;
    const info = m.info && typeof m.info === "object" ? m.info : null;
    const infoTokens = info && typeof info.tokens === "object" ? info.tokens : null;
    const directTokens = m.tokens && typeof m.tokens === "object" ? m.tokens : null;
    const tokens = infoTokens || directTokens;
    const input = coerceFiniteNumber(tokens ? tokens.input : null) || 0;
    const cache = tokens && typeof tokens.cache === "object" ? tokens.cache : null;
    const cacheRead = coerceFiniteNumber(cache ? cache.read : null) || 0;
    const dialog = input + cacheRead;
    if (dialog > 0) return dialog;
  }
  return null;
}

function extractContextWindow(exportData, modelContextMap, registryModel) {
  if (!exportData || typeof exportData !== "object") return null;
  const info = exportData.info && typeof exportData.info === "object" ? exportData.info : null;
  const model = info && typeof info.model === "object" ? info.model : exportData.model && typeof exportData.model === "object" ? exportData.model : null;
  if (model) {
    const value = model.contextWindow ?? model.context ?? model.context_window ?? null;
    const num = coerceFiniteNumber(value);
    if (num !== null && num > 0) return num;
  }
  if (registryModel && modelContextMap && modelContextMap.has(registryModel)) {
    return modelContextMap.get(registryModel);
  }
  return null;
}

function buildUsage(exportData, modelContextMap, registryModel) {
  const messages = exportData && Array.isArray(exportData.messages) ? exportData.messages : [];
  const messageCount = messages.length;
  const dialogTokens = extractDialogTokens(messages);
  const contextWindow = extractContextWindow(exportData, modelContextMap, registryModel);
  const contextFullPct = dialogTokens !== null && contextWindow !== null && contextWindow > 0
    ? dialogTokens / contextWindow
    : null;
  return { messageCount, dialogTokens, contextFullPct };
}

function formatModelRef(model) {
  if (!model) return null;
  if (typeof model === "string") return model;
  if (typeof model !== "object") return null;
  const providerID = typeof model.providerID === "string" ? model.providerID : "";
  const modelID = typeof model.modelID === "string" ? model.modelID : "";
  if (!providerID || !modelID) return null;
  return `${providerID}/${modelID}`;
}

function extractTaskChildren(exportData) {
  if (!exportData || typeof exportData !== "object" || !Array.isArray(exportData.messages)) return [];
  const bySessionId = new Map();
  const order = [];

  for (const message of exportData.messages) {
    if (!message || typeof message !== "object" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!part || typeof part !== "object") continue;
      if (part.type !== "tool" || part.tool !== "task") continue;
      const state = part.state && typeof part.state === "object" ? part.state : null;
      const metadata = state && state.metadata && typeof state.metadata === "object" ? state.metadata : null;
      const sessionId = metadata && typeof metadata.sessionId === "string" ? metadata.sessionId : "";
      if (!sessionId) continue;
      const model = metadata ? formatModelRef(metadata.model) : null;
      const title = state && typeof state.title === "string" ? state.title : null;
      const status = state && typeof state.status === "string" ? state.status : null;
      const time = state && state.time && typeof state.time === "object" ? state.time : null;
      const startedAt = time && typeof time.start === "string" ? time.start : null;
      const finishedAt = time && typeof time.end === "string" ? time.end : null;

      if (!bySessionId.has(sessionId)) order.push(sessionId);
      bySessionId.set(sessionId, {
        sessionId,
        status,
        title,
        model,
        startedAt,
        finishedAt,
      });
    }
  }

  return order.map((id) => bySessionId.get(id)).filter(Boolean);
}

async function readChildUsageFromStorage(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  try {
    const dir = path.join(OPENCODE_STORAGE_DIR, "message", sessionId);
    const files = (await fsp.readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const messages = [];
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const text = await fsp.readFile(full, "utf8");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.messages)) {
            for (const msg of parsed.messages) messages.push(msg);
          } else if (parsed.message && typeof parsed.message === "object") {
            messages.push(parsed.message);
          } else {
            messages.push(parsed);
          }
        }
      } catch {
        // Ignore malformed or partially written files while child session streams.
      }
    }
    const messageCount = messages.length;
    const dialogTokens = extractDialogTokens(messages);
    return { messageCount, dialogTokens, contextFullPct: null };
  } catch {
    return null;
  }
}

async function appendUsageLog(root, entry) {
  const dir = registryDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const file = usageLogPath(root);
  const line = `${JSON.stringify(entry)}\n`;
  await fsp.appendFile(file, line, "utf8");
  try {
    const stat = await fsp.stat(file);
    if (stat.size <= USAGE_LOG_MAX_BYTES) return;
    const content = await fsp.readFile(file, "utf8");
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-USAGE_LOG_TAIL_LINES);
    await fsp.writeFile(file, `${tail.join("\n")}\n`, "utf8");
  } catch {
    // ignore log rotation failures
  }
}

function shouldRefreshUsage(record, nowMs) {
  if (!record || typeof record !== "object") return false;
  if (!record.sessionId) return false;
  if (record.status !== "running" && record.status !== "done" && record.status !== "unknown") return false;

  const retryAtMs = parseTimeMs(record.usageRetryAt);
  if (retryAtMs !== null && nowMs < retryAtMs) return false;

  const updatedMs = parseTimeMs(record.usageUpdatedAt);
  if (record.status === "running") {
    if (updatedMs === null) return true;
    return nowMs - updatedMs >= USAGE_RUNNING_REFRESH_MS;
  }

  if (updatedMs === null) return true;
  const finishedMs = parseTimeMs(record.finishedAt);
  if (finishedMs !== null && updatedMs < finishedMs) return true;
  return false;
}

async function updateAgentUsage(root, name, updater) {
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const record = registry.agents && registry.agents[name];
    if (!record) return null;
    const next = updater(record);
    if (!next) return null;
    registry.agents[name] = next;
    registry.updatedAt = nowIso();
    await writeRegistryAtomic(root, registry);
    return next;
  });
}

async function ensureDaemon(root) {
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const daemon = registry.daemon && typeof registry.daemon === "object" ? registry.daemon : null;
    if (daemon && daemon.pid && isPidAlive(daemon.pid)) return daemon;

    const child = spawn(process.execPath, [__filename, "status-daemon"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    registry.daemon = { pid: child.pid, startedAt: nowIso(), lastHeartbeatAt: nowIso() };
    await writeRegistryAtomic(root, registry);
    return registry.daemon;
  });
}

function formatTimestamp(value) {
  const ms = parseTimeMs(value);
  if (ms === null) return "-";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderTable(rows, columns) {
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const maxCell = rows.reduce((max, row) => Math.max(max, String(row[col.key] ?? "").length), 0);
    return Math.max(headerLen, maxCell);
  });

  const pad = (value, width) => String(value).padEnd(width);
  const padLeft = (value, width) => String(value).padStart(width);

  const header = columns
    .map((col, idx) => (col.align === "right" ? padLeft(col.header, widths[idx]) : pad(col.header, widths[idx])))
    .join("  ");

  const body = rows.map((row) =>
    columns
      .map((col, idx) => {
        const value = row[col.key] ?? "";
        return col.align === "right" ? padLeft(value, widths[idx]) : pad(value, widths[idx]);
      })
      .join("  ")
  );

  return [header, ...body].join("\n");
}

function renderDiagram(agents, nowMs) {
  const allAgents = Array.isArray(agents) ? agents : [];
  const liveAgents = allAgents.filter((agent) => agent && (agent.status === "running" || agent.status === "scheduled"));
  const doneAgents = allAgents.filter((agent) => agent && (agent.status === "done" || agent.status === "unknown"));
  const truncate = (value, max) => {
    const text = String(value ?? "");
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 3))}...`;
  };
  const childName = (title) => {
    const suffix = title ? `:${title}` : "";
    return `  - ${truncate(`task${suffix}`, 20)}`;
  };

  const toUsageColumns = (agent) => {
    const usage = agent && agent.usage && typeof agent.usage === "object" ? agent.usage : null;
    const messageCount = usage && Number.isFinite(usage.messageCount) ? String(usage.messageCount) : "-";
    const dialogTokens = usage && Number.isFinite(usage.dialogTokens) ? String(usage.dialogTokens) : "-";
    const pct = usage && Number.isFinite(usage.contextFullPct) ? `${(usage.contextFullPct * 100).toFixed(1)}%` : "-";
    return { messageCount, dialogTokens, pct };
  };

  const toModel = (agent) => {
    const modelBase = agent && agent.model ? agent.model : "-";
    const variantSuffix = agent && agent.variant ? `-${agent.variant}` : "";
    return modelBase !== "-" ? modelBase + variantSuffix : "-";
  };

  const baseLiveRow = (agent) => {
    const startedAt = formatTimestamp(agent.startedAt);
    const runtimeMs = parseTimeMs(agent.startedAt);
    const runtime = runtimeMs === null ? "-" : formatDuration(nowMs - runtimeMs);
    const { messageCount, dialogTokens, pct } = toUsageColumns(agent);
    const resumed = typeof agent.resumeCount === "number" && agent.resumeCount > 0 ? String(agent.resumeCount) : "-";
    return {
      name: agent && agent.name ? String(agent.name) : "",
      status: agent && agent.status ? String(agent.status) : "",
      model: toModel(agent),
      pid: agent && agent.pid ? String(agent.pid) : "-",
      startedAt,
      runtime,
      resumed,
      messageCount,
      dialogTokens,
      pct,
    };
  };

  const baseDoneRow = (agent) => {
    const startedAt = formatTimestamp(agent.startedAt);
    const finishedAt = formatTimestamp(agent.finishedAt);
    const startMs = parseTimeMs(agent.startedAt);
    const endMs = parseTimeMs(agent.finishedAt);
    const runtime = startMs === null || endMs === null ? "-" : formatDuration(endMs - startMs);
    const { messageCount, dialogTokens, pct } = toUsageColumns(agent);
    const resumed = typeof agent.resumeCount === "number" && agent.resumeCount > 0 ? String(agent.resumeCount) : "-";
    return {
      name: agent && agent.name ? String(agent.name) : "",
      status: agent && agent.status ? String(agent.status) : "",
      model: toModel(agent),
      pid: agent && agent.pid ? String(agent.pid) : "-",
      startedAt,
      finishedAt,
      runtime,
      resumed,
      messageCount,
      dialogTokens,
      pct,
    };
  };

  const liveRows = [];
  for (const agent of liveAgents) {
    liveRows.push(baseLiveRow(agent));
    const children = Array.isArray(agent.children) ? agent.children : [];
    const liveChildren = children.filter((child) => child && child.status === "running");
    for (const child of liveChildren) {
      const runtimeMs = parseTimeMs(child.startedAt);
      const runtime = runtimeMs === null ? "-" : formatDuration(nowMs - runtimeMs);
      const { messageCount, dialogTokens, pct } = toUsageColumns(child);
      liveRows.push({
        name: childName(child.title),
        status: child.status || "-",
        model: child.model || "-",
        pid: "-",
        startedAt: formatTimestamp(child.startedAt),
        runtime,
        resumed: "-",
        messageCount,
        dialogTokens,
        pct,
      });
    }
  }

  const doneRows = [];
  for (const agent of doneAgents) {
    doneRows.push(baseDoneRow(agent));
    const children = Array.isArray(agent.children) ? agent.children : [];
    const finishedChildren = children.filter((child) => child && child.status === "completed");
    for (const child of finishedChildren) {
      const startMs = parseTimeMs(child.startedAt);
      const endMs = parseTimeMs(child.finishedAt);
      const runtime = startMs === null || endMs === null ? "-" : formatDuration(endMs - startMs);
      const { messageCount, dialogTokens, pct } = toUsageColumns(child);
      doneRows.push({
        name: childName(child.title),
        status: child.status || "-",
        model: child.model || "-",
        pid: "-",
        startedAt: formatTimestamp(child.startedAt),
        finishedAt: formatTimestamp(child.finishedAt),
        runtime,
        resumed: "-",
        messageCount,
        dialogTokens,
        pct,
      });
    }
  }

  const lines = [];
  lines.push("LIVE AGENTS");
  if (liveRows.length === 0) {
    lines.push("No agents are running.");
  } else {
    lines.push(
      renderTable(liveRows, [
        { header: "NAME", key: "name" },
        { header: "STATUS", key: "status" },
        { header: "MODEL", key: "model" },
        { header: "PID", key: "pid", align: "right" },
        { header: "STARTED", key: "startedAt" },
        { header: "RUNTIME", key: "runtime", align: "right" },
        { header: "RESUMED", key: "resumed", align: "right" },
        { header: "MSG", key: "messageCount", align: "right" },
        { header: "DIALOG_TKN", key: "dialogTokens", align: "right" },
        { header: "FULL", key: "pct", align: "right" },
      ])
    );
  }

  lines.push("");
  lines.push("DONE AGENTS");
  if (doneRows.length === 0) {
    lines.push("No completed agents.");
  } else {
    lines.push(
      renderTable(doneRows, [
        { header: "NAME", key: "name" },
        { header: "STATUS", key: "status" },
        { header: "MODEL", key: "model" },
        { header: "PID", key: "pid", align: "right" },
        { header: "STARTED", key: "startedAt" },
        { header: "COMPLETED", key: "finishedAt" },
        { header: "RUNTIME", key: "runtime", align: "right" },
        { header: "RESUMED", key: "resumed", align: "right" },
        { header: "MSG", key: "messageCount", align: "right" },
        { header: "DIALOG_TKN", key: "dialogTokens", align: "right" },
        { header: "FULL", key: "pct", align: "right" },
      ])
    );
  }

  return lines.join("\n");
}

function clearDiagramScreen() {
  if (process.stdout.isTTY) {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    return;
  }
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25l");
  }
}

function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");
  }
}

function searchHistory(data, pattern, role) {
  const rx = new RegExp(pattern);
  const matches = [];
  if (!data || typeof data !== "object") return matches;
  if (Array.isArray(data.messages)) {
    let i = 0;
    for (const m of data.messages) {
      if (!m || typeof m !== "object") {
        i += 1;
        continue;
      }
      const r = (m.info && typeof m.info === "object" ? m.info.role : m.role) || "unknown";
      if (role !== "any" && r !== role) {
        i += 1;
        continue;
      }
      let text = "";
      if (Array.isArray(m.parts)) {
        const textParts = m.parts
          .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text);
        if (textParts.length) text = textParts.join("");
        else {
          const anyParts = m.parts
            .filter((p) => p && typeof p === "object" && typeof p.text === "string")
            .map((p) => p.text);
          if (anyParts.length) text = anyParts.join("");
        }
      }
      if (rx.test(text || "")) {
        matches.push({ index: i, role: r, snippet: String(text || "").replace(/\s+/g, " ").trim().slice(0, 200) });
      }
      i += 1;
    }
    return matches;
  }
  let i = 0;
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }
    if (typeof node === "object") {
      if (typeof node.role === "string" && node.content !== undefined) {
        const r = node.role;
        if (role === "any" || r === role) {
          const c = coerceContent(node.content) || "";
          if (rx.test(c)) {
            matches.push({ index: i, role: r, snippet: String(c).replace(/\s+/g, " ").trim().slice(0, 200) });
          }
        }
        i += 1;
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
  };
  walk(data);
  return matches;
}

async function runCommand(argv, forceResume) {
  let name = "";
  let prompt = "";
  let resume = forceResume === true;
  let agent = "";
  let model = "";
  let variant = "";
  let cwdInput = process.cwd();
  const files = [];

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        printJson({ ok: false, error: "Help not implemented" });
        return;
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--prompt":
        prompt = argv[i + 1] || "";
        i += 1;
        break;
      case "--resume":
        if (forceResume === undefined) resume = true;
        break;
      case "--agent":
        agent = argv[i + 1] || "";
        i += 1;
        break;
      case "--model":
        model = argv[i + 1] || "";
        i += 1;
        break;
      case "--variant":
        variant = argv[i + 1] || "";
        i += 1;
        break;
      case "--file":
        files.push(argv[i + 1] || "");
        i += 1;
        break;
      case "--cwd":
        cwdInput = argv[i + 1] || "";
        i += 1;
        break;
      default:
        fail("Unknown argument", "E_ARG_UNKNOWN", { arg: a });
    }
  }

  if (!name) fail("--name is required", "E_NAME_REQUIRED");
  if (!prompt) fail("--prompt is required", "E_PROMPT_REQUIRED", { hint: "Provide a non-empty prompt." });

  requireCommand("opencode");

  const registryRoot = process.cwd();
  const targetCwd = await ensureCwd(cwdInput);
  const title = `persistent-subagent: ${name}`;
  let sessionId = "";
  let mode = "new";

  const registry = await readRegistry(registryRoot);
  const existing = registry.agents && registry.agents[name];
  if (existing && !resume) {
    fail("Name already exists", "E_NAME_EXISTS", { name, existingCwd: existing.cwd || null });
  }
  if (existing && resume && existing.cwd && existing.cwd !== targetCwd) {
    fail("Name already exists", "E_NAME_EXISTS", { name, existingCwd: existing.cwd, cwd: targetCwd });
  }

  if (resume && existing) {
    if (!model && !process.env.OPENCODE_PSA_MODEL && existing.model) {
      model = existing.model;
    }
    if (!variant && !process.env.OPENCODE_PSA_VARIANT && existing.variant) {
      variant = existing.variant;
    }
  }

  const modelValue = model || process.env.OPENCODE_PSA_MODEL || DEFAULT_MODEL;
  const variantValue = variant || process.env.OPENCODE_PSA_VARIANT || "";

  if (resume) {
    mode = "resume";
    if (existing && typeof existing.sessionId === "string" && existing.sessionId) {
      sessionId = existing.sessionId;
    }
    if (!sessionId) {
      sessionId = await discoverSessionId(title, targetCwd, 5);
    }
    if (!sessionId) {
      fail("No session found for name", "E_SESSION_NOT_FOUND", { name });
    }
  }

  const startedAt = nowIso();
  const prevResumeCount = existing && typeof existing.resumeCount === "number" ? existing.resumeCount : 0;
  const scheduledRecord = {
    name,
    pid: null,
    sessionId: sessionId || null,
    status: "scheduled",
    exitCode: null,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    model: modelValue,
    variant: variantValue || null,
    resumeCount: resume ? prevResumeCount + 1 : 0,
    prompt,
    cwd: targetCwd,
  };

  await upsertAgent(registryRoot, scheduledRecord);

  try {
    await ensureDaemon(registryRoot);
  } catch {
    // daemon is best-effort; do not block agent start
  }

  const payload = {
    name,
    prompt,
    cwd: targetCwd,
    title,
    agent,
    model: modelValue,
    variant: variantValue,
    sessionId,
    files,
    startedAt,
    registryRoot,
    resumeCount: scheduledRecord.resumeCount,
  };

  const worker = spawn(process.execPath, [__filename, "run-worker"], {
    cwd: registryRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, OPENCODE_PSA_PAYLOAD: JSON.stringify(payload) },
  });
  worker.unref();

  printJson({
    ok: true,
    name,
    pid: worker.pid,
    status: "scheduled",
    model: modelValue,
    mode,
    startedAt,
  });
}

async function runWorker() {
  const payloadRaw = process.env.OPENCODE_PSA_PAYLOAD || "";
  if (!payloadRaw) {
    fail("Missing worker payload", "E_WORKER_PAYLOAD");
  }
  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    fail("Invalid worker payload", "E_WORKER_PAYLOAD");
  }

  const name = payload.name;
  const prompt = payload.prompt;
  const cwd = payload.cwd;
  const registryRoot = payload.registryRoot || process.cwd();
  const title = payload.title;
  const agent = payload.agent || "";
  const model = payload.model || DEFAULT_MODEL;
  const variant = payload.variant || "";
  const resumeCount = typeof payload.resumeCount === "number" ? payload.resumeCount : 0;
  const sessionId = payload.sessionId || "";
  const files = Array.isArray(payload.files) ? payload.files : [];
  const startedAt = payload.startedAt || nowIso();

  let pid = null;
  let discovered = sessionId;
  let exitCode = 1;
  let spawnError = null;
  let stderr = "";

  try {
    const args = ["run", prompt, "--title", title, "--model", model];
    if (variant) args.push("--variant", variant);
    if (agent) args.push("--agent", agent);
    if (sessionId) args.push("--session", sessionId);
    for (const file of files) {
      if (file) args.push("--file", file);
    }

    const child = spawn("opencode", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    pid = child.pid || null;
    const exitPromise = new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(typeof child.exitCode === "number" ? child.exitCode : 1);
        return;
      }
      child.once("exit", (code) => resolve(typeof code === "number" ? code : 1));
      child.once("error", () => resolve(1));
    });
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        if (stderr.length >= 8192) return;
        stderr += String(chunk || "");
        if (stderr.length > 8192) stderr = stderr.slice(0, 8192);
      });
    }
    child.on("error", (err) => {
      spawnError = err;
    });

    const runningRecord = {
      name,
      pid,
      sessionId: sessionId || null,
      status: "running",
      exitCode: null,
      startedAt,
      updatedAt: nowIso(),
      finishedAt: null,
      model,
      variant: variant || null,
      resumeCount,
      prompt,
      cwd,
    };

    await upsertAgentWithRetry(registryRoot, runningRecord, 10);

    if (!discovered) {
      discovered = await discoverSessionId(title, cwd, 40);
      if (discovered) {
        const updated = { ...runningRecord, sessionId: discovered, updatedAt: nowIso() };
        await upsertAgentWithRetry(registryRoot, updated, 10);
      }
    }

    exitCode = await exitPromise;

    if (!discovered) {
      discovered = await discoverSessionId(title, cwd, 10);
    }
  } catch (err) {
    if (!spawnError) spawnError = err;
  } finally {
    const errorInfo = spawnError ? String(spawnError.message || spawnError) : null;
    const stderrTrimmed = stderr.trim() || null;
    const finishedAt = nowIso();
    const doneRecord = {
      name,
      pid,
      sessionId: discovered || null,
      status: "done",
      exitCode,
      startedAt,
      updatedAt: finishedAt,
      finishedAt,
      model,
      variant: variant || null,
      resumeCount,
      prompt,
      cwd,
      error: errorInfo,
      stderr: stderrTrimmed,
    };
    try {
      await upsertAgentWithRetry(registryRoot, doneRecord, 10);
    } catch {
      // last-resort: avoid crashing the worker before exit
    }
  }

  process.exit(0);
}

async function statusDaemon() {
  requireCommand("opencode");
  const registryRoot = process.cwd();
  const modelContextMap = await buildModelContextMap();

  while (true) {
    const registry = await refreshRegistry(registryRoot, null);
    const agents = agentsArray(registry, null);
    const daemon = registry.daemon && typeof registry.daemon === "object" ? registry.daemon : null;
    if (daemon && daemon.pid && daemon.pid !== process.pid && isPidAlive(daemon.pid)) {
      return;
    }

    const hasActive = agents.some((agent) => agent && (agent.status === "scheduled" || agent.status === "running"));

    await withRegistryLock(registryRoot, async () => {
      const latest = await readRegistry(registryRoot);
      const startedAt = latest.daemon && latest.daemon.startedAt ? latest.daemon.startedAt : nowIso();
      latest.daemon = { pid: process.pid, startedAt, lastHeartbeatAt: nowIso() };
      latest.updatedAt = nowIso();
      await writeRegistryAtomic(registryRoot, latest);
    });

    const nowMs = Date.now();
    for (const agent of agents) {
      if (!shouldRefreshUsage(agent, nowMs)) continue;
      const name = agent.name;
      const sessionId = agent.sessionId;
      if (!name || !sessionId) continue;
      const targetCwd = agent.cwd || registryRoot;

      try {
        const exportData = await exportSessionJson(sessionId, targetCwd);
        const usage = buildUsage(exportData, modelContextMap, agent.model);
        const children = extractTaskChildren(exportData);
        for (const child of children) {
          child.usage = (await readChildUsageFromStorage(child.sessionId)) || null;
        }
        await updateAgentUsage(registryRoot, name, (record) => {
          if (!record || record.sessionId !== sessionId) return null;
          return {
            ...record,
            usage,
            children,
            usageUpdatedAt: nowIso(),
            usageRetryAt: null,
            usageAttempt: null,
            usageError: null,
          };
        });
      } catch (err) {
        const attempt = (agent.usageAttempt || 0) + 1;
        const delayMs = Math.min(USAGE_RETRY_MAX_MS, USAGE_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
        const retryAt = new Date(Date.now() + delayMs).toISOString();
        const message = err && err.message ? err.message : String(err);
        await appendUsageLog(registryRoot, {
          time: nowIso(),
          name,
          sessionId,
          error: message,
          attempt,
          retryAt,
        });
        await updateAgentUsage(registryRoot, name, (record) => {
          if (!record || record.sessionId !== sessionId) return null;
          return {
            ...record,
            usageRetryAt: retryAt,
            usageAttempt: attempt,
            usageError: message,
          };
        });
      }
    }

    if (!hasActive) {
      await withRegistryLock(registryRoot, async () => {
        const latest = await readRegistry(registryRoot);
        if (latest.daemon) {
          delete latest.daemon;
          latest.updatedAt = nowIso();
          await writeRegistryAtomic(registryRoot, latest);
        }
      });
      return;
    }

    await delay(USAGE_DAEMON_INTERVAL_MS);
  }
}

async function statusCommand(argv) {
  let name = "";
  let cwdInput = process.cwd();
  let wait = false;
  let waitTerminal = false;
  const timeoutSec =
    coerceFiniteNumber(process.env.OPENCODE_PSA_WAIT_TIMEOUT_SEC) ?? DEFAULT_WAIT_TIMEOUT_SEC;
  let diagram = false;
  let watchSec = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--cwd":
        cwdInput = argv[i + 1] || "";
        i += 1;
        break;
      case "--wait":
        wait = true;
        break;
      case "--wait-terminal":
        waitTerminal = true;
        break;
      case "--diagram":
        diagram = true;
        break;
      case "--watch":
        watchSec = Number(argv[i + 1]);
        if (!Number.isFinite(watchSec) || watchSec <= 0) {
          fail("Invalid --watch", "E_WATCH_INVALID", { value: argv[i + 1] });
        }
        diagram = true;
        i += 1;
        break;
      default:
        fail("Unknown argument", "E_ARG_UNKNOWN", { arg: a });
    }
  }

  if (waitTerminal && !name) {
    fail("--wait-terminal requires --name", "E_WAIT_NAME_REQUIRED");
  }

  const registryRoot = process.cwd();

  if (diagram) {
    try {
      await ensureDaemon(registryRoot);
    } catch {
      // diagram rendering should not fail if daemon cannot start
    }

    const watchMs = watchSec > 0 ? watchSec * 1000 : 0;
    if (watchMs > 0) {
      hideCursor();
      const restore = () => showCursor();
      process.once("exit", restore);
      process.once("SIGINT", () => {
        restore();
        process.exit(130);
      });
      process.once("SIGTERM", () => {
        restore();
        process.exit(143);
      });
    }
    while (true) {
      const registry = await refreshRegistry(registryRoot, name ? [name] : null);
      const agents = agentsArray(registry, name).map(sanitizeAgentForStatus);
      if (watchMs > 0) {
        clearDiagramScreen();
      }
      process.stdout.write(`${renderDiagram(agents, Date.now())}\n`);
      if (watchMs === 0) return;
      await delay(watchMs);
    }
  }

  if (!wait && !waitTerminal) {
    const registry = await refreshRegistry(registryRoot, name ? [name] : null);
    printJson({ ok: true, agents: agentsArray(registry, name).map(sanitizeAgentForStatus) });
    return;
  }

  if (waitTerminal) {
    const res = await waitForTerminal(registryRoot, name, timeoutSec);
    printJson({ ok: true, agents: res.agents.map(sanitizeAgentForStatus), changed: res.changed || [] });
    return;
  }

  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : null;
  let prevRegistry = await refreshRegistry(registryRoot, name ? [name] : null);
  let prevAgents = agentsArray(prevRegistry, name);

  while (true) {
    await delay(500);
    const nextRegistry = await refreshRegistry(registryRoot, name ? [name] : null);
    const nextAgents = agentsArray(nextRegistry, name);
    const changed = diffStatuses(prevAgents, nextAgents);
    if (changed.length > 0) {
      printJson({ ok: true, agents: nextAgents.map(sanitizeAgentForStatus), changed });
      return;
    }
    prevRegistry = nextRegistry;
    prevAgents = nextAgents;
    if (deadline && Date.now() >= deadline) {
      printJson({ ok: true, agents: prevAgents.map(sanitizeAgentForStatus), changed: [] });
      return;
    }
  }
}

async function resultCommand(argv) {
  let name = "";
  let cwdInput = process.cwd();
  let jsonMode = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--cwd":
        cwdInput = argv[i + 1] || "";
        i += 1;
        break;
      case "--json":
        jsonMode = true;
        break;
      default:
        fail("Unknown argument", "E_ARG_UNKNOWN", { arg: a });
    }
  }

  if (!name) fail("--name is required", "E_NAME_REQUIRED");
  requireCommand("opencode");

  const registryRoot = process.cwd();

  const registry = await refreshRegistry(registryRoot, [name]);
  const record = registry.agents ? registry.agents[name] : null;
  if (!record) {
    printJson(errorPayload("No session found for name", "E_NAME_NOT_FOUND"));
    process.exit(1);
  }

  if (record.status === "running" || record.status === "scheduled") {
    if (jsonMode) {
      printJson({ ok: true, name, status: record.status, lastAssistantText: null });
    }
    return;
  }

  const targetCwd = record.cwd || process.cwd();
  let sessionId = record.sessionId || "";
  if (!sessionId) {
    const title = `persistent-subagent: ${name}`;
    sessionId = await discoverSessionId(title, targetCwd, 5);
    if (sessionId) {
      const updated = { ...record, sessionId, updatedAt: nowIso() };
      await upsertAgent(registryRoot, updated);
    }
  }
  if (!sessionId) {
    printJson(errorPayload("Missing sessionId", "E_SESSIONID_MISSING"));
    process.exit(1);
  }

  let exportData;
  let exportStdout = "";
  try {
    exportStdout = await runExportToStdout(sessionId, targetCwd);
    // Some opencode CLI versions emit log lines before the JSON payload.
    // Find the first JSON object/array start and parse from there.
    const idx = exportStdout.search(/[\{\[]/);
    if (idx === -1) throw new Error("No JSON found in export output");
    const jsonText = extractJsonSubstring(exportStdout);
    if (!jsonText) throw new Error("No complete JSON value found in export output");
    exportData = JSON.parse(jsonText);
  } catch (err) {
    if (err && (err.killed || err.code === "ETIMEDOUT")) {
      printJson(errorPayload("Export timed out", "E_EXPORT_TIMEOUT"));
      process.exit(1);
    }
    printJson(errorPayload("Export failed", "E_EXPORT_FAILED", { message: err && err.message ? err.message : String(err), snippet: exportStdout.slice(0, 1024) }));
    process.exit(1);
  }

  const lastAssistantText = extractLastAssistantText(exportData) || "";
  if (jsonMode) {
    printJson({
      ok: true,
      name,
      sessionId,
      status: record.status,
      lastAssistantText: lastAssistantText || null,
    });
    return;
  }
  process.stdout.write(`${lastAssistantText}\n`);
}

async function searchCommand(argv) {
  let name = "";
  let pattern = "";
  let role = "any";
  let cwdInput = process.cwd();

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--pattern":
        pattern = argv[i + 1] || "";
        i += 1;
        break;
      case "--role":
        role = argv[i + 1] || "any";
        i += 1;
        break;
      case "--cwd":
        cwdInput = argv[i + 1] || "";
        i += 1;
        break;
      default:
        fail("Unknown argument", "E_ARG_UNKNOWN", { arg: a });
    }
  }

  if (!name) fail("--name is required", "E_NAME_REQUIRED");
  if (!pattern) fail("--pattern is required", "E_PATTERN_REQUIRED");
  requireCommand("opencode");

  const registryRoot = process.cwd();
  const registry = await refreshRegistry(registryRoot, [name]);
  const record = registry.agents ? registry.agents[name] : null;
  if (!record) {
    printJson(errorPayload("No session found for name", "E_NAME_NOT_FOUND"));
    process.exit(1);
  }

  const targetCwd = record.cwd || process.cwd();
  const sessionId = record.sessionId || "";
  if (!sessionId) {
    printJson(errorPayload("Missing sessionId", "E_SESSIONID_MISSING"));
    process.exit(1);
  }

  let exportData;
  let exportStdout2 = "";
  try {
    exportStdout2 = await runExportToStdout(sessionId, targetCwd);
    const idx = exportStdout2.search(/[\{\[]/);
    if (idx === -1) throw new Error("No JSON found in export output");
    const jsonText2 = extractJsonSubstring(exportStdout2);
    if (!jsonText2) throw new Error("No complete JSON value found in export output");
    exportData = JSON.parse(jsonText2);
  } catch (err) {
    if (err && (err.killed || err.code === "ETIMEDOUT")) {
      printJson(errorPayload("Export timed out", "E_EXPORT_TIMEOUT"));
      process.exit(1);
    }
    printJson(errorPayload("Export failed", "E_EXPORT_FAILED", { message: err && err.message ? err.message : String(err), snippet: exportStdout2.slice(0, 1024) }));
    process.exit(1);
  }

  let matches = [];
  try {
    matches = searchHistory(exportData, pattern, role || "any");
  } catch {
    printJson(errorPayload("Invalid pattern", "E_PATTERN_INVALID"));
    process.exit(1);
  }
  printJson({ ok: true, name, matches });
}

async function cancelCommand(argv) {
  let name = "";
  let cwdInput = process.cwd();
  let signal = "TERM";

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--cwd":
        cwdInput = argv[i + 1] || "";
        i += 1;
        break;
      case "--signal":
        signal = argv[i + 1] || "TERM";
        i += 1;
        break;
      default:
        fail("Unknown argument", "E_ARG_UNKNOWN", { arg: a });
    }
  }

  if (!name) fail("--name is required", "E_NAME_REQUIRED");

  const registryRoot = process.cwd();
  const registry = await refreshRegistry(registryRoot, [name]);
  const record = registry.agents ? registry.agents[name] : null;
  if (!record) {
    printJson(errorPayload("Agent not running", "E_NOT_RUNNING"));
    process.exit(1);
  }

  if (record.status !== "running") {
    printJson(errorPayload("Agent not running", "E_NOT_RUNNING", { status: record.status }));
    process.exit(1);
  }

  const pid = Number(record.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    printJson(errorPayload("Agent not running", "E_NOT_RUNNING"));
    process.exit(1);
  }

  if (signal !== "TERM" && signal !== "KILL") {
    printJson(errorPayload("Unsupported signal", "E_SIGNAL_UNSUPPORTED"));
    process.exit(1);
  }

  const signalValue = signal === "KILL" ? "SIGKILL" : "SIGTERM";

  try {
    process.kill(pid, signalValue);
  } catch {
    printJson(errorPayload("Failed to send signal", "E_SIGNAL_FAILED"));
    process.exit(1);
  }

  printJson({
    ok: true,
    name,
    pid,
    signalSent: signal,
    previousStatus: record.status,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "start") {
    await runCommand(argv.slice(1), false);
    return;
  }
  if (cmd === "resume") {
    await runCommand(argv.slice(1), true);
    return;
  }
  if (cmd === "run-worker") {
    await runWorker();
    return;
  }
  if (cmd === "status-daemon") {
    await statusDaemon();
    return;
  }
  if (cmd === "status") {
    await statusCommand(argv.slice(1));
    return;
  }
  if (cmd === "result") {
    await resultCommand(argv.slice(1));
    return;
  }
  if (cmd === "search") {
    await searchCommand(argv.slice(1));
    return;
  }
  if (cmd === "cancel") {
    await cancelCommand(argv.slice(1));
    return;
  }

  fail("Unknown command", "E_CMD_UNKNOWN", { cmd });
}

main().catch((err) => {
  const message = err && err.message ? err.message : "Unexpected error";
  printJson(errorPayload(message, "E_UNEXPECTED"));
  process.exit(1);
});
