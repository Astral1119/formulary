import type { FunctionDef, Manifest, Platform } from "./manifest.js";

/** A named function as it exists in a spreadsheet. */
export interface NamedFunction {
  name: string;
  definition: string;
  description?: string;
  parameters: NamedFunctionParameter[];
}

export interface NamedFunctionParameter {
  name: string;
  description?: string;
  examples: string[];
}

/**
 * Project metadata stored in the __manifest__ sheet.
 * Key-value pairs; dependencies use "dep:<name>" prefix.
 */
export interface ProjectMetadata {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  owners?: string;
  exports?: string;
  dependencies: Record<string, string>;
  [key: string]: string | Record<string, string> | undefined;
}

/** Lockfile stored in the hidden sheet. */
export interface Lockfile {
  packages: Record<string, LockEntry>;
}

export interface LockEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies: string[];
  functions: string[];
}

/**
 * Platform adapter interface.
 *
 * Each platform (Google Sheets, Excel, CLI) implements this interface
 * to provide platform-specific I/O capabilities to the core library.
 */
export interface PlatformAdapter {
  readonly platform: Platform;

  // Network
  fetchJSON(url: string): Promise<unknown>;
  fetchBinary(url: string): Promise<ArrayBuffer>;

  // Named function management
  listFunctions(): Promise<NamedFunction[]>;
  createFunction(fn: NamedFunction): Promise<void>;
  updateFunction(fn: NamedFunction): Promise<void>;
  deleteFunction(name: string): Promise<void>;

  // Metadata storage (hidden sheet)
  readMetadata(): Promise<ProjectMetadata | null>;
  writeMetadata(meta: ProjectMetadata): Promise<void>;
  readLockfile(): Promise<Lockfile | null>;
  writeLockfile(lock: Lockfile): Promise<void>;
}
