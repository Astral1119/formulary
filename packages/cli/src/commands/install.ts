import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import type {
  Manifest,
  FunctionDef,
  PackageBundle,
  ProjectMetadata,
  Lockfile,
  PackageMeta,
  VersionMeta,
  PlatformAdapter,
  Platform,
} from "@formulary/core";
import {
  resolveFunctions,
  validateManifest,
  resolveDeps,
  pickVersion,
  RegistryClient,
} from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { parseBundle } from "../bundle.js";
import { fetchJSON, fetchBinary } from "../network.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ?? "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

interface InstallOptions {
  create: boolean;
  adapter?: PlatformAdapter;
}

/**
 * Install a package.
 *
 * If `source` looks like a path (contains / or . or exists on disk),
 * installs from a local directory. Otherwise, fetches from the registry.
 */
export async function install(
  source: string,
  xlsxPath: string,
  options: InstallOptions,
): Promise<void> {
  if (source.endsWith(".fpkg") || source.endsWith(".gspkg") || source.endsWith(".zip")) {
    await installFromBundle(source, xlsxPath, options);
  } else if (await isLocalPath(source)) {
    await installLocal(source, xlsxPath, options);
  } else {
    await installFromRegistry(source, xlsxPath, options);
  }
}

// ─── Bundle install (.fpkg file) ──────────────────────────────────────────

async function installFromBundle(
  bundlePath: string,
  xlsxPath: string,
  options: InstallOptions,
): Promise<void> {
  const data = await readFile(resolve(bundlePath));
  const bundle = await parseBundle(data);
  const manifest = bundle.manifest;

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid package manifest:\n  ${errors.join("\n  ")}`);
  }

  const { adapter, isExcel, platform } = await getAdapter(xlsxPath, options);

  if (!manifest.platforms.includes(platform)) {
    throw new Error(
      `Package "${manifest.name}" does not support ${platform} (platforms: ${manifest.platforms.join(", ")})`,
    );
  }

  const lock = (await adapter.readLockfile()) ?? { packages: {} };
  const meta = (await adapter.readMetadata()) ?? { dependencies: {} as Record<string, string> };

  const functions = resolveFunctions(bundle, platform);
  const result = await installBundle(adapter, functions);

  meta.dependencies[manifest.name] = manifest.version;
  lock.packages[manifest.name] = {
    version: manifest.version,
    resolved: `local:${bundlePath}`,
    dependencies: Object.keys(manifest.dependencies),
    functions: Object.keys(functions),
  };

  await adapter.writeMetadata(meta);
  await adapter.writeLockfile(lock);

  if (isExcel) {
    await writeFile(xlsxPath, await (adapter as ExcelAdapter).save());
  }

  const target = isExcel ? xlsxPath : "Google Sheets";
  console.log(
    `✓ ${manifest.name}@${manifest.version} → ${target} (${result.added} added, ${result.updated} updated, ${Object.keys(functions).length} functions)`,
  );
}

// ─── Local install (directory) ────────────────────────────────────────────

async function installLocal(
  packageDir: string,
  xlsxPath: string,
  options: InstallOptions,
): Promise<void> {
  const bundle = await readLocalPackage(packageDir);
  const manifest = bundle.manifest;

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid package manifest:\n  ${errors.join("\n  ")}`);
  }

  const { adapter, isExcel, platform } = await getAdapter(xlsxPath, options);

  if (!manifest.platforms.includes(platform)) {
    throw new Error(
      `Package "${manifest.name}" does not support ${platform} (platforms: ${manifest.platforms.join(", ")})`,
    );
  }

  const lock = (await adapter.readLockfile()) ?? { packages: {} };
  const meta = (await adapter.readMetadata()) ?? { dependencies: {} as Record<string, string> };

  const functions = resolveFunctions(bundle, platform);
  const result = await installBundle(adapter, functions);

  meta.dependencies[manifest.name] = manifest.version;
  lock.packages[manifest.name] = {
    version: manifest.version,
    dependencies: Object.keys(manifest.dependencies),
    functions: Object.keys(functions),
  };

  await adapter.writeMetadata(meta);
  await adapter.writeLockfile(lock);

  if (isExcel) {
    await writeFile(xlsxPath, await (adapter as ExcelAdapter).save());
  }

  const target = isExcel ? xlsxPath : "Google Sheets";
  console.log(
    `✓ ${manifest.name}@${manifest.version} → ${target} (${result.added} added, ${result.updated} updated, ${Object.keys(functions).length} functions)`,
  );
}

// ─── Registry install ─────────────────────────────────────────────────────

async function installFromRegistry(
  source: string,
  xlsxPath: string,
  options: InstallOptions,
): Promise<void> {
  const { name, versionSpec } = parsePackageArg(source);
  const registry = new RegistryClient(REGISTRY_BASE);

  console.log(`Resolving ${name}...`);
  const pkgMeta = await fetchMeta(registry, name);

  const { adapter, isExcel, platform } = await getAdapter(xlsxPath, options);

  const picked = pickVersion(pkgMeta, versionSpec, platform);
  if (!picked) {
    throw new Error(
      versionSpec
        ? `No version of ${name} satisfies "${versionSpec}"`
        : `No versions found for ${name}`,
    );
  }

  const lock = (await adapter.readLockfile()) ?? { packages: {} };
  const meta = (await adapter.readMetadata()) ?? { dependencies: {} as Record<string, string> };

  const deps = await resolveDeps(
    name,
    picked.version,
    (depName: string) => fetchMeta(registry, depName),
    lock,
    platform,
  );

  const toInstall = [
    ...deps.map((d: { name: string; version: string; meta: VersionMeta }) => ({
      name: d.name,
      version: d.version,
      versionMeta: d.meta,
    })),
    { name, version: picked.version, versionMeta: picked.meta },
  ];

  let totalAdded = 0;
  let totalUpdated = 0;

  for (const pkg of toInstall) {
    const artifactUrl = registry.artifactUrl(pkg.versionMeta.artifact);
    console.log(`Downloading ${pkg.name}@${pkg.version}...`);
    const data = await fetchBinary(artifactUrl);

    const bundle = await parseBundle(data);
    const functions = resolveFunctions(bundle, platform);

    const result = await installBundle(adapter, functions);
    totalAdded += result.added;
    totalUpdated += result.updated;

    lock.packages[pkg.name] = {
      version: pkg.version,
      resolved: `registry:${pkg.name}/${pkg.version}`,
      integrity: pkg.versionMeta.integrity,
      dependencies: Object.keys(pkg.versionMeta.dependencies ?? {}),
      functions: Object.keys(functions),
    };
  }

  meta.dependencies[name] = `>=${picked.version}`;

  await adapter.writeMetadata(meta);
  await adapter.writeLockfile(lock);

  if (isExcel) {
    await writeFile(xlsxPath, await (adapter as ExcelAdapter).save());
  }

  const names = toInstall.map((p) => `${p.name}@${p.version}`);
  const target = isExcel ? xlsxPath : "Google Sheets";
  console.log(
    `✓ Installed ${names.join(", ")} → ${target} (${totalAdded} added, ${totalUpdated} updated)`,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getAdapter(
  xlsxPath: string,
  options: InstallOptions,
): Promise<{ adapter: PlatformAdapter; isExcel: boolean; platform: Platform }> {
  if (options.adapter) {
    return {
      adapter: options.adapter,
      isExcel: false,
      platform: options.adapter.platform,
    };
  }

  const adapter = await openOrCreate(xlsxPath, options);
  return { adapter, isExcel: true, platform: "excel" };
}

async function installBundle(
  adapter: PlatformAdapter,
  functions: Record<string, FunctionDef>,
): Promise<{ added: number; updated: number }> {
  const existing = await adapter.listFunctions();
  const existingNames = new Set(existing.map((f) => f.name.toUpperCase()));

  let added = 0;
  let updated = 0;

  for (const [name, def] of Object.entries(functions)) {
    const fn = {
      name,
      definition: def.definition,
      description: def.description,
      parameters: Object.entries(def.arguments).map(([argName, arg]) => ({
        name: argName,
        description: arg.description,
        examples: arg.example ? [arg.example] : [],
      })),
    };

    if (existingNames.has(name.toUpperCase())) {
      await adapter.updateFunction(fn);
      updated++;
    } else {
      await adapter.createFunction(fn);
      added++;
    }
  }

  return { added, updated };
}

async function openOrCreate(
  xlsxPath: string,
  options: InstallOptions,
): Promise<ExcelAdapter> {
  let fileExists = true;
  try {
    await access(xlsxPath);
  } catch {
    fileExists = false;
  }

  if (fileExists) {
    const data = await readFile(xlsxPath);
    return ExcelAdapter.open(new Uint8Array(data));
  } else if (options.create) {
    return ExcelAdapter.create();
  } else {
    throw new Error(
      `File not found: ${xlsxPath}\n  Use --create to create a new xlsx file`,
    );
  }
}

function parsePackageArg(arg: string): { name: string; versionSpec: string } {
  const atIdx = arg.indexOf("@");
  if (atIdx > 0) {
    return { name: arg.slice(0, atIdx), versionSpec: arg.slice(atIdx + 1) };
  }
  return { name: arg, versionSpec: "" };
}

async function isLocalPath(source: string): Promise<boolean> {
  if (source.includes("/") || source.includes("\\") || source.startsWith(".")) {
    return true;
  }
  try {
    await access(source);
    return true;
  } catch {
    return false;
  }
}

async function fetchMeta(
  registry: RegistryClient,
  name: string,
): Promise<PackageMeta> {
  const url = registry.packageMetaUrl(name);
  const data = await fetchJSON(url);
  return registry.parsePackageMeta(data);
}

async function readLocalPackage(dir: string): Promise<PackageBundle> {
  const manifestPath = join(dir, "manifest.json");
  const functionsPath = join(dir, "functions.json");

  let manifestData: string;
  try {
    manifestData = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(
      `Cannot read package manifest: ${manifestPath}\n  Expected manifest.json in the package directory`,
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
