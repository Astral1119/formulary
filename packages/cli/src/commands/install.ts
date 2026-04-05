import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Manifest, FunctionDef, PackageBundle, ProjectMetadata } from "@formulary/core";
import { resolveFunctions, validateManifest } from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { XlsxFile } from "../adapter/xlsx.js";

interface InstallOptions {
  create: boolean;
}

export async function install(
  packageDir: string,
  xlsxPath: string,
  options: InstallOptions,
): Promise<void> {
  // 1. Read package
  const bundle = await readPackage(packageDir);
  const manifest = bundle.manifest;

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `Invalid package manifest:\n  ${errors.join("\n  ")}`,
    );
  }

  if (!manifest.platforms.includes("excel")) {
    throw new Error(
      `Package "${manifest.name}" does not support excel (platforms: ${manifest.platforms.join(", ")})`,
    );
  }

  // 2. Resolve functions for excel platform
  const functions = resolveFunctions(bundle, "excel");
  const functionNames = Object.keys(functions);

  if (functionNames.length === 0) {
    throw new Error(`Package "${manifest.name}" has no functions to install`);
  }

  // 3. Open or create xlsx
  let adapter: ExcelAdapter;
  let fileExists = true;
  try {
    await access(xlsxPath);
  } catch {
    fileExists = false;
  }

  if (fileExists) {
    const data = await readFile(xlsxPath);
    adapter = await ExcelAdapter.open(new Uint8Array(data));
  } else if (options.create) {
    adapter = await ExcelAdapter.create();
  } else {
    throw new Error(
      `File not found: ${xlsxPath}\n  Use --create to create a new xlsx file`,
    );
  }

  // 4. Install functions
  // Remove existing functions from this package first (upgrade case)
  const existing = await adapter.listFunctions();
  const existingNames = new Set(existing.map((f) => f.name.toUpperCase()));

  let installed = 0;
  let updated = 0;

  for (const [name, def] of Object.entries(functions)) {
    const fn = {
      name,
      definition: def.definition,
      description: def.description,
    };

    if (existingNames.has(name.toUpperCase())) {
      await adapter.updateFunction(fn);
      updated++;
    } else {
      await adapter.createFunction(fn);
      installed++;
    }
  }

  // 5. Write metadata
  const meta: ProjectMetadata = (await adapter.readMetadata()) ?? {
    dependencies: {} as Record<string, string>,
  };
  meta.dependencies[manifest.name] = manifest.version;
  await adapter.writeMetadata(meta);

  // 6. Write lockfile
  const lock = (await adapter.readLockfile()) ?? { packages: {} };
  lock.packages[manifest.name] = {
    version: manifest.version,
    dependencies: Object.keys(manifest.dependencies),
    functions: functionNames,
  };
  await adapter.writeLockfile(lock);

  // 7. Save
  const output = await adapter.save();
  await writeFile(xlsxPath, output);

  // 8. Report
  const parts: string[] = [];
  if (installed > 0) parts.push(`${installed} added`);
  if (updated > 0) parts.push(`${updated} updated`);
  console.log(
    `✓ ${manifest.name}@${manifest.version} → ${xlsxPath} (${parts.join(", ")}, ${functionNames.length} functions)`,
  );
}

async function readPackage(dir: string): Promise<PackageBundle> {
  const manifestPath = join(dir, "__PROJECT__.json");
  const functionsPath = join(dir, "functions.json");

  let manifestData: string;
  try {
    manifestData = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(
      `Cannot read package manifest: ${manifestPath}\n  Expected __PROJECT__.json in the package directory`,
    );
  }

  let functionsData: string;
  try {
    functionsData = await readFile(functionsPath, "utf-8");
  } catch {
    throw new Error(
      `Cannot read functions: ${functionsPath}\n  Expected functions.json in the package directory`,
    );
  }

  const manifest: Manifest = JSON.parse(manifestData);
  const functions: Record<string, FunctionDef> = JSON.parse(functionsData);

  return { manifest, functions };
}
