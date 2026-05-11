import { readFile, writeFile } from "node:fs/promises";
import type { PlatformAdapter, Platform, VersionMeta } from "@formulary/core";
import {
  resolveFunctions,
  resolveDeps,
  pickVersion,
  RegistryClient,
} from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { parseBundle } from "../bundle.js";
import { fetchJSON, fetchBinary } from "../network.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ?? "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

interface UpgradeOptions {
  adapter?: PlatformAdapter;
}

export async function upgrade(
  packageName: string,
  xlsxPath: string,
  options: UpgradeOptions = {},
): Promise<void> {
  let adapter: PlatformAdapter;
  let isExcel = false;
  let platform: Platform;

  if (options.adapter) {
    adapter = options.adapter;
    platform = adapter.platform;
  } else {
    const data = await readFile(xlsxPath);
    adapter = await ExcelAdapter.open(new Uint8Array(data));
    isExcel = true;
    platform = "excel";
  }

  const lock = await adapter.readLockfile();
  if (!lock?.packages[packageName]) {
    throw new Error(`Package "${packageName}" is not installed`);
  }

  const meta = await adapter.readMetadata();
  const constraint = meta?.dependencies[packageName] ?? "";
  const currentVersion = lock.packages[packageName].version;

  const registry = new RegistryClient(REGISTRY_BASE);

  console.log(`Checking for updates to ${packageName}...`);
  const pkgMeta = registry.parsePackageMeta(
    await fetchJSON(registry.packageMetaUrl(packageName)),
  );

  const picked = pickVersion(pkgMeta, constraint, platform);
  if (!picked) {
    throw new Error(
      `No version of ${packageName} satisfies "${constraint}"`,
    );
  }

  if (picked.version === currentVersion) {
    console.log(`${packageName}@${currentVersion} is already the latest`);
    return;
  }

  console.log(
    `Upgrading ${packageName}: ${currentVersion} → ${picked.version}`,
  );

  // Remove old functions
  const oldFunctions = lock.packages[packageName].functions ?? [];
  for (const fn of oldFunctions) {
    await adapter.deleteFunction(fn);
  }

  // Resolve new dep tree
  const deps = await resolveDeps(
    packageName,
    picked.version,
    async (depName: string) =>
      registry.parsePackageMeta(
        await fetchJSON(registry.packageMetaUrl(depName)),
      ),
    {
      packages: Object.fromEntries(
        Object.entries(lock.packages).filter(([n]) => n !== packageName),
      ),
    },
    platform,
  );

  const toInstall = [
    ...deps.map((d: { name: string; version: string; meta: VersionMeta }) => ({
      name: d.name,
      version: d.version,
      versionMeta: d.meta,
    })),
    { name: packageName, version: picked.version, versionMeta: picked.meta },
  ];

  const existing = await adapter.listFunctions();
  const existingNames = new Set(existing.map((f) => f.name.toUpperCase()));

  for (const pkg of toInstall) {
    const artifactUrl = registry.artifactUrl(pkg.versionMeta.artifact);
    const bundle = await parseBundle(await fetchBinary(artifactUrl));
    const functions = resolveFunctions(bundle, platform);

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
      } else {
        await adapter.createFunction(fn);
      }
    }

    lock.packages[pkg.name] = {
      version: pkg.version,
      resolved: `registry:${pkg.name}/${pkg.version}`,
      integrity: pkg.versionMeta.integrity,
      dependencies: Object.keys(pkg.versionMeta.dependencies ?? {}),
      functions: Object.keys(functions),
    };
  }

  if (meta) {
    meta.dependencies[packageName] = `>=${picked.version}`;
    await adapter.writeMetadata(meta);
  }
  await adapter.writeLockfile(lock);

  if (isExcel) {
    await writeFile(xlsxPath, await (adapter as ExcelAdapter).save());
  }

  console.log(
    `✓ Upgraded ${packageName} ${currentVersion} → ${picked.version}`,
  );
}
