/**
 * Publish flow orchestration for the Excel add-in.
 *
 * Reads the current workbook, filters dep functions, builds a .fpkg,
 * runs preflight checks, and hands off to a RegistryBackend.
 */

import type {
  Manifest,
  FunctionDef,
  NamedFunction,
  PlatformAdapter,
  RegistryBackend,
} from "@formulary/core";
import {
  buildRegistryUpdate,
  unwrapLambda,
  runPreflightChecks as coreRunPreflightChecks,
  syncManifestForPublish,
  type PreflightCheck,
} from "@formulary/core";
import { buildBundle } from "../bundle.js";
import { integrity } from "./hash.js";

export type { PreflightCheck };

export interface ExtractResult {
  /** Functions that will be published as part of this package. */
  authorFunctions: NamedFunction[];
  /** Functions excluded because they belong to dependencies. */
  excludedFunctions: Array<{ name: string; package: string }>;
}

/**
 * Extract author functions from the workbook, filtering out anything
 * that belongs to an installed dependency package.
 */
export async function extractForPublish(
  adapter: PlatformAdapter,
): Promise<ExtractResult> {
  const allFunctions = await adapter.listFunctions();
  const lock = await adapter.readLockfile();

  const depMap = new Map<string, string>();
  if (lock) {
    for (const [pkgName, pkg] of Object.entries(lock.packages)) {
      for (const fn of pkg.functions) depMap.set(fn, pkgName);
    }
  }

  const authorFunctions: NamedFunction[] = [];
  const excludedFunctions: Array<{ name: string; package: string }> = [];

  for (const fn of allFunctions) {
    const dep = depMap.get(fn.name);
    if (dep) {
      excludedFunctions.push({ name: fn.name, package: dep });
    } else {
      authorFunctions.push(fn);
    }
  }

  return { authorFunctions, excludedFunctions };
}

/**
 * Convert a NamedFunction list into the functions.json shape.
 * Reuses LAMBDA arg parsing for any function whose adapter didn't
 * populate `arguments`.
 */
export function buildFunctionsJson(
  functions: NamedFunction[],
): Record<string, FunctionDef> {
  const result: Record<string, FunctionDef> = {};
  for (const fn of functions) {
    const argNames = fn.arguments ?? unwrapLambda(fn.definition).args;
    const argsObj: Record<string, { description: string; example: string }> = {};
    for (const argName of argNames) {
      argsObj[argName] = {
        description: fn.argumentDescriptions?.[argName] ?? "",
        example: fn.argumentExamples?.[argName] ?? "",
      };
    }
    result[fn.name] = {
      definition: fn.definition,
      description: fn.description ?? "",
      arguments: argsObj,
    };
  }
  return result;
}

// Re-export the core preflight runner for the taskpane to use.
export const runPreflightChecks = coreRunPreflightChecks;

// ─── Run publish ──────────────────────────────────────────────────

export async function runPublish(
  manifest: Manifest,
  functions: Record<string, FunctionDef>,
  backend: RegistryBackend,
  opts?: { publisherUsername?: string },
): Promise<string> {
  const syncedManifest = syncManifestForPublish(
    manifest,
    functions,
    opts?.publisherUsername,
  );

  const fpkgBytes = await buildBundle({
    manifest: syncedManifest,
    functions,
  });

  const integrityHash = await integrity(fpkgBytes);

  const update = buildRegistryUpdate(
    syncedManifest,
    { kind: "bytes", data: fpkgBytes },
    integrityHash,
  );

  return backend.apply(update);
}
