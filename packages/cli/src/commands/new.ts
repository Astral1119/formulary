/**
 * `formulary new` — bootstrap a new package authoring workspace.
 *
 * Three forms:
 *   formulary new ./mypkg/         — directory (agent / power-user)
 *   formulary new mypkg.xlsx       — local xlsx file
 *   formulary new --gsheets        — new sheet in your Drive
 *
 * Each form ends by registering the project in ~/.formulary/projects.json
 * and setting it as active so subsequent commands work without args.
 */

import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, basename, join } from "node:path";
import type { Manifest, Platform } from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import {
  registerProject,
  projectFromDirectory,
  projectFromXlsx,
  projectFromGSheets,
} from "../projects.js";
import { createSheet } from "../sheets-api.js";

export interface NewOptions {
  /** Override the package name (defaults to target basename). */
  name?: string;
  /** Pre-fill dependencies as a comma-separated list. */
  dependsOn?: string;
  /** Platforms supported (defaults to single platform for workbooks, both for dirs). */
  platforms?: string;
  /** Owner GitHub username (defaults to empty; auto-added at publish time). */
  owner?: string;
  /** Description for the manifest. */
  description?: string;
  /** Use Google Sheets as the target. */
  gsheets?: boolean;
  /** Auth profile for gsheets. */
  profile?: string;
}

export async function newProject(
  target: string | undefined,
  options: NewOptions,
): Promise<void> {
  // Decide form based on flags / target
  if (options.gsheets) {
    return newGSheetsProject(options);
  }
  if (!target) {
    throw new Error(
      "formulary new requires a target. Examples:\n" +
        "  formulary new ./mypkg/             # directory\n" +
        "  formulary new mypkg.xlsx           # xlsx file\n" +
        "  formulary new --gsheets --name x   # google sheets",
    );
  }
  if (target.endsWith(".xlsx")) {
    return newXlsxProject(target, options);
  }
  return newDirectoryProject(target, options);
}

// ─── Directory mode ───────────────────────────────────────────────

async function newDirectoryProject(
  dir: string,
  options: NewOptions,
): Promise<void> {
  const dirPath = resolve(dir);
  const name = options.name ?? basename(dirPath);
  const platforms = parsePlatforms(options.platforms, ["excel", "gsheets"]);

  // Refuse to overwrite an existing manifest
  try {
    await access(join(dirPath, "manifest.json"));
    throw new Error(
      `${dirPath}/manifest.json already exists. Use \`formulary check\` if you want to validate the existing project.`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  await mkdir(dirPath, { recursive: true });

  const manifest: Manifest = {
    name,
    version: "0.1.0",
    description: options.description ?? "",
    owners: options.owner ? [options.owner] : [],
    license: "MIT",
    dependencies: parseDependsOn(options.dependsOn),
    exports: [],
    platforms,
  };

  await writeFile(
    join(dirPath, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(join(dirPath, "functions.json"), "{}\n");
  await mkdir(join(dirPath, "tests"), { recursive: true });

  registerProject(projectFromDirectory(name, dirPath, platforms));

  console.log(`✓ created ${name}@0.1.0`);
  console.log(`  ${dirPath}`);
  console.log(`    manifest.json`);
  console.log(`    functions.json`);
  console.log(`    tests/`);
  console.log(`✓ registered as active project "${name}"`);
}

// ─── xlsx mode ────────────────────────────────────────────────────

async function newXlsxProject(
  xlsxPath: string,
  options: NewOptions,
): Promise<void> {
  const fullPath = resolve(xlsxPath);
  const name =
    options.name ?? basename(fullPath, ".xlsx").replace(/\W+/g, "-");

  // Refuse to overwrite an existing file
  try {
    await access(fullPath);
    throw new Error(
      `${fullPath} already exists. Pick a different filename or delete it first.`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const adapter = await ExcelAdapter.create();
  await adapter.writeMetadata({
    name,
    version: "0.1.0",
    description: options.description ?? "",
    license: "MIT",
    owners: options.owner ?? "",
    dependencies: parseDependsOn(options.dependsOn),
  });
  await adapter.writeLockfile({ packages: {} });

  const buf = await adapter.save();
  await writeFile(fullPath, buf);

  registerProject(projectFromXlsx(name, fullPath));

  console.log(`✓ created ${name}@0.1.0`);
  console.log(`  ${fullPath}`);
  console.log(`✓ registered as active project "${name}"`);
}

// ─── gsheets mode ─────────────────────────────────────────────────

async function newGSheetsProject(options: NewOptions): Promise<void> {
  const name = options.name;
  if (!name) {
    throw new Error(
      "formulary new --gsheets requires --name to title the new sheet",
    );
  }

  const profile = options.profile ?? "default";

  console.log(`Creating Google Sheet "${name}"...`);
  const sheet = await createSheet(name, profile);
  console.log(`  ${sheet.url}`);

  // Init the sheet's hidden metadata via the GSheetsAdapter (Playwright).
  // We have to launch Playwright here because the adapter writes hidden
  // sheets via the page.evaluate path. Slow but consistent with install.
  console.log("Initializing project metadata...");
  const { openGSheets } = await import("../adapter/gsheets-open.js");
  const { adapter, cleanup } = await openGSheets(sheet.url, profile, false);

  try {
    await adapter.writeMetadata({
      name,
      version: "0.1.0",
      description: options.description ?? "",
      license: "MIT",
      owners: options.owner ?? "",
      dependencies: parseDependsOn(options.dependsOn),
    });
    await adapter.writeLockfile({ packages: {} });
  } finally {
    await cleanup();
  }

  registerProject(
    projectFromGSheets(name, sheet.spreadsheetId, sheet.url, profile),
  );

  console.log(`✓ created ${name}@0.1.0`);
  console.log(`  ${sheet.url}`);
  console.log(`✓ registered as active project "${name}"`);
}

// ─── Helpers ──────────────────────────────────────────────────────

function parsePlatforms(
  raw: string | undefined,
  defaults: Platform[],
): Platform[] {
  if (!raw) return defaults;
  const valid: Platform[] = ["excel", "gsheets", "lattice"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Platform => valid.includes(s as Platform));
  if (parsed.length === 0) {
    throw new Error(
      `--platforms must be a comma-separated list from: ${valid.join(", ")}`,
    );
  }
  return parsed;
}

function parseDependsOn(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const entry of raw.split(",").map((s) => s.trim())) {
    if (!entry) continue;
    // Accept "name", "name@1.0.0", "name>=1.0.0"
    const m = /^([a-z][a-z0-9-]*)(.*)$/i.exec(entry);
    if (!m) continue;
    const name = m[1];
    let spec = m[2].trim();
    if (spec.startsWith("@")) spec = spec.slice(1);
    result[name] = spec || "*";
  }
  return result;
}
