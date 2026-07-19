/**
 * Extract — read functions and metadata from a workbook into a local
 * package directory ready for `formulary pack`/`publish`.
 *
 * Sync semantics:
 *   - functions.json (or functions.{platform}.json) is fully regenerated
 *     each run. Authors get fresh function definitions every time.
 *   - manifest.json is only generated on first run (or with --force).
 *     Author edits are preserved across re-extracts.
 *
 * Dependency filtering: functions belonging to installed deps (per the
 * lockfile) are excluded so the author's package only contains their
 * own work.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import type {
  PlatformAdapter,
  Manifest,
  FunctionDef,
  Platform,
  NamedFunction,
} from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { unwrapLambda } from "@formulary/core";

interface ExtractOptions {
  output: string;
  adapter?: PlatformAdapter;
  /** Write to functions.{platform}.json instead of functions.json */
  platform?: Platform;
  /** Regenerate manifest.json even if it already exists */
  force?: boolean;
}

export async function extract(
  xlsxPath: string,
  options: ExtractOptions,
): Promise<void> {
  // 1. Open adapter (Excel from file, or use injected GSheets adapter)
  let adapter: PlatformAdapter;
  if (options.adapter) {
    adapter = options.adapter;
  } else {
    const data = await readFile(xlsxPath);
    adapter = await ExcelAdapter.open(new Uint8Array(data));
  }

  // 2. Read functions, metadata, lockfile
  const allFunctions = await adapter.listFunctions();
  const meta = await adapter.readMetadata();
  const lock = await adapter.readLockfile();

  // 3. Build dependency function set (to exclude)
  const depFns = new Set<string>();
  if (lock) {
    for (const pkg of Object.values(lock.packages)) {
      for (const fn of pkg.functions) depFns.add(fn);
    }
  }

  // 4. Filter to author's functions
  const authorFunctions = allFunctions.filter((fn) => !depFns.has(fn.name));

  if (authorFunctions.length === 0) {
    console.log(
      "No author functions to extract.\n" +
        "  All functions in the workbook belong to installed dependencies.",
    );
    return;
  }

  // 5. Convert to functions.json format
  const functionsJson = buildFunctionsJson(authorFunctions);

  // 6. Ensure output dir exists
  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  // 7. Write functions file (always regenerated)
  const functionsFilename = options.platform
    ? `functions.${options.platform}.json`
    : "functions.json";
  const functionsPath = join(outputDir, functionsFilename);
  await writeFile(functionsPath, JSON.stringify(functionsJson, null, 2) + "\n");

  // 8. Write manifest stub if it doesn't exist (or --force)
  const manifestPath = join(outputDir, "manifest.json");
  const manifestExists = await fileExists(manifestPath);

  let wroteManifest = false;
  if (!manifestExists || options.force) {
    const manifest = buildManifestStub(
      meta,
      authorFunctions,
      adapter.platform,
      outputDir,
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    wroteManifest = true;
  }

  // 9. Report
  const fnCount = authorFunctions.length;
  const filteredCount = allFunctions.length - fnCount;
  const filteredNote =
    filteredCount > 0 ? ` (${filteredCount} dep functions excluded)` : "";

  console.log(`✓ Extracted ${fnCount} functions${filteredNote}`);
  console.log(`  → ${functionsPath}`);
  if (wroteManifest) {
    console.log(`  → ${manifestPath} (${options.force ? "regenerated" : "new"})`);
  } else {
    console.log(`  manifest.json preserved (use --force to regenerate)`);
  }
}

// ─── Conversion helpers ───────────────────────────────────────────

function buildFunctionsJson(
  functions: NamedFunction[],
): Record<string, FunctionDef> {
  const result: Record<string, FunctionDef> = {};

  for (const fn of functions) {
    // Get arg names — prefer the adapter-provided list, fall back to parsing
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

function buildManifestStub(
  meta: Awaited<ReturnType<PlatformAdapter["readMetadata"]>>,
  functions: NamedFunction[],
  platform: Platform,
  outputDir: string,
): Manifest {
  // Use metadata from the workbook if available, otherwise sensible defaults
  const name =
    (typeof meta?.name === "string" && meta.name) ||
    basename(outputDir) ||
    "my-package";

  const version =
    (typeof meta?.version === "string" && meta.version) || "0.1.0";

  const description =
    (typeof meta?.description === "string" && meta.description) || "";

  const ownersStr = typeof meta?.owners === "string" ? meta.owners : "";
  const owners = ownersStr
    ? ownersStr.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  const license =
    (typeof meta?.license === "string" && meta.license) || "MIT";

  // Dependencies come from the workbook's metadata sheet, but the project's
  // own dep on itself shouldn't appear — only deps that are also in the lockfile
  const dependencies: Record<string, string> = {};
  if (meta?.dependencies) {
    for (const [depName, spec] of Object.entries(meta.dependencies)) {
      if (depName !== name) dependencies[depName] = spec;
    }
  }

  return {
    name,
    version,
    description,
    owners,
    license,
    dependencies,
    exports: functions.map((f) => f.name),
    platforms: [platform],
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
