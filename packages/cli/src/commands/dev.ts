/**
 * `formulary dev <package>` — fetch an existing package as a dev workspace.
 *
 * Downloads the package's .fpkg from the registry, unpacks it into a
 * directory, and registers as the active project. Subsequent edits +
 * `formulary publish` push a new version.
 *
 * Three forms (mirror `formulary new`):
 *   formulary dev charter                   — directory in cwd named after the package
 *   formulary dev charter --output ./mydir/ — explicit directory
 *   formulary dev charter mydir.xlsx        — unpack into a workbook
 *   formulary dev charter --gsheets         — unpack into a new google sheet
 */

import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import type { Manifest, FunctionDef, PackageMeta } from "@formulary/core";
import { RegistryClient, pickVersion } from "@formulary/core";
import { fetchJSON, fetchBinary } from "../network.js";
import { parseBundle } from "../bundle.js";
import {
  registerProject,
  projectFromDirectory,
  projectFromXlsx,
  projectFromGSheets,
} from "../projects.js";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { createSheet } from "../sheets-api.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ??
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

export interface DevOptions {
  /** Override the version (defaults to latest). */
  version?: string;
  /** Explicit output directory or file. */
  output?: string;
  /** Use a Google Sheet as the dev target. */
  gsheets?: boolean;
  /** Auth profile for gsheets. */
  profile?: string;
  /** xlsx output file (parsed from positional). */
  xlsxPath?: string;
}

export async function dev(
  pkgName: string,
  options: DevOptions,
): Promise<void> {
  // 1. Fetch the package meta and pick a version
  const registry = new RegistryClient(REGISTRY_BASE);
  console.log(`Fetching ${pkgName} from registry...`);
  const meta = await fetchJSON(registry.packageMetaUrl(pkgName)).then((d) =>
    registry.parsePackageMeta(d) as PackageMeta,
  );

  const picked = pickVersion(meta, options.version ?? "");
  if (!picked) {
    throw new Error(
      options.version
        ? `no version of ${pkgName} satisfies "${options.version}"`
        : `no versions found for ${pkgName}`,
    );
  }
  console.log(`  using ${pkgName}@${picked.version}`);

  // 2. Download and parse the bundle
  const artifactUrl = registry.artifactUrl(picked.meta.artifact);
  const fpkgData = await fetchBinary(artifactUrl);
  const bundle = await parseBundle(fpkgData);

  // 3. Decide target type
  if (options.gsheets) {
    return devGSheets(pkgName, bundle, options);
  }
  if (options.xlsxPath) {
    return devXlsx(pkgName, bundle, options.xlsxPath);
  }
  return devDirectory(pkgName, bundle, options);
}

// ─── Directory mode ───────────────────────────────────────────────

async function devDirectory(
  pkgName: string,
  bundle: { manifest: Manifest; functions: Record<string, FunctionDef>; readme?: string; platformFunctions?: Record<string, Record<string, FunctionDef>> },
  options: DevOptions,
): Promise<void> {
  const dirPath = resolve(options.output ?? `./${pkgName}`);

  // Refuse to overwrite an existing manifest
  try {
    await access(join(dirPath, "manifest.json"));
    throw new Error(
      `${dirPath}/manifest.json already exists — refusing to overwrite. Use a different --output.`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  await mkdir(dirPath, { recursive: true });
  await writeFile(
    join(dirPath, "manifest.json"),
    JSON.stringify(bundle.manifest, null, 2) + "\n",
  );
  await writeFile(
    join(dirPath, "functions.json"),
    JSON.stringify(bundle.functions, null, 2) + "\n",
  );

  // Optional platform overrides
  if (bundle.platformFunctions) {
    for (const [platform, funcs] of Object.entries(bundle.platformFunctions)) {
      if (funcs && Object.keys(funcs).length > 0) {
        await writeFile(
          join(dirPath, `functions.${platform}.json`),
          JSON.stringify(funcs, null, 2) + "\n",
        );
      }
    }
  }

  // Optional README
  if (bundle.readme) {
    await writeFile(join(dirPath, "README.md"), bundle.readme);
  }

  await mkdir(join(dirPath, "tests"), { recursive: true });

  registerProject(
    projectFromDirectory(
      bundle.manifest.name,
      dirPath,
      bundle.manifest.platforms,
    ),
  );

  console.log(`✓ ${bundle.manifest.name}@${bundle.manifest.version}`);
  console.log(`  ${dirPath}`);
  console.log(`✓ registered as active project`);
  console.log(`\nReady to iterate. Edit functions.json then \`formulary publish\`.`);
}

// ─── xlsx mode ────────────────────────────────────────────────────

async function devXlsx(
  _pkgName: string,
  bundle: { manifest: Manifest; functions: Record<string, FunctionDef> },
  xlsxPath: string,
): Promise<void> {
  const fullPath = resolve(xlsxPath);

  try {
    await access(fullPath);
    throw new Error(
      `${fullPath} already exists — refusing to overwrite.`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const adapter = await ExcelAdapter.create();

  // Write metadata
  await adapter.writeMetadata({
    name: bundle.manifest.name,
    version: bundle.manifest.version,
    description: bundle.manifest.description ?? "",
    license: bundle.manifest.license ?? "MIT",
    owners: bundle.manifest.owners.join(","),
    dependencies: bundle.manifest.dependencies ?? {},
  });
  await adapter.writeLockfile({ packages: {} });

  // Install the package's own functions into the workbook
  for (const [name, def] of Object.entries(bundle.functions)) {
    await adapter.createFunction({
      name,
      definition: def.definition,
      description: def.description,
    });
  }

  await writeFile(fullPath, await adapter.save());

  registerProject(projectFromXlsx(bundle.manifest.name, fullPath));

  console.log(`✓ ${bundle.manifest.name}@${bundle.manifest.version}`);
  console.log(`  ${fullPath}`);
  console.log(`✓ registered as active project`);
}

// ─── gsheets mode ─────────────────────────────────────────────────

async function devGSheets(
  _pkgName: string,
  bundle: { manifest: Manifest; functions: Record<string, FunctionDef> },
  options: DevOptions,
): Promise<void> {
  const profile = options.profile ?? "default";

  console.log(`Creating Google Sheet "${bundle.manifest.name}"...`);
  const sheet = await createSheet(bundle.manifest.name, profile);
  console.log(`  ${sheet.url}`);

  console.log("Initializing project metadata...");
  const { openGSheets } = await import("../adapter/gsheets-open.js");
  const { adapter, cleanup } = await openGSheets(sheet.url, profile, false);

  try {
    await adapter.writeMetadata({
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      description: bundle.manifest.description ?? "",
      license: bundle.manifest.license ?? "MIT",
      owners: bundle.manifest.owners.join(","),
      dependencies: bundle.manifest.dependencies ?? {},
    });
    await adapter.writeLockfile({ packages: {} });

    console.log(`Installing ${Object.keys(bundle.functions).length} functions...`);
    for (const [name, def] of Object.entries(bundle.functions)) {
      await adapter.createFunction({
        name,
        definition: def.definition,
        description: def.description,
      });
    }
  } finally {
    await cleanup();
  }

  registerProject(
    projectFromGSheets(
      bundle.manifest.name,
      sheet.spreadsheetId,
      sheet.url,
      profile,
    ),
  );

  console.log(`✓ ${bundle.manifest.name}@${bundle.manifest.version}`);
  console.log(`  ${sheet.url}`);
  console.log(`✓ registered as active project`);
}
