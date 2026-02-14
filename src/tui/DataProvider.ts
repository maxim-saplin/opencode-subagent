/**
 * DataProvider interface for TUI data access. Allows injection of mock provider in tests.
 */
import { readRegistry, exportSessionJson, readChildMessages } from "./data";
import type { Registry, ExportMessage } from "./data";

export interface DataProvider {
  readRegistry(root: string): Promise<Registry>;
  exportSession(sessionId: string, cwd: string): Promise<unknown>;
  readChildMessages(sessionId: string): Promise<ExportMessage[]>;
}

/** Default implementation using data.ts helpers. */
export const defaultDataProvider: DataProvider = {
  readRegistry,
  exportSession: exportSessionJson,
  readChildMessages,
};
