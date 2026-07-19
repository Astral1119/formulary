/**
 * `formulary info <pkg>` — show registry info for a package.
 *
 * Read-only: fetches the package's meta.json from the registry and
 * prints owners, latest version, dependencies, exports, etc.
 */

import { RegistryClient } from "@formulary/core";
import type { PackageMeta, VersionMeta } from "@formulary/core";
import { fetchJSON } from "../network.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ??
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

export async function info(pkgName: string): Promise<void> {
  const registry = new RegistryClient(REGISTRY_BASE);

  let meta: PackageMeta;
  try {
    const data = await fetchJSON(registry.packageMetaUrl(pkgName));
    meta = registry.parsePackageMeta(data);
  } catch (e) {
    throw new Error(
      `package "${pkgName}" not found in registry (${(e as Error).message})`,
    );
  }

  // Latest version (sort versions descending by simple semver)
  const versions = Object.keys(meta.versions);
  versions.sort((a, b) => compareVersions(b, a));
  const latest = versions[0];
  const latestMeta: VersionMeta | undefined = meta.versions[latest];

  console.log(`${meta.name}@${latest}`);
  if (meta.owners.length > 0) {
    console.log(`  by ${meta.owners.join(", ")}`);
  }

  if (latestMeta) {
    console.log(`  platforms: ${latestMeta.platforms.join(", ")}`);

    const deps = Object.entries(latestMeta.dependencies ?? {});
    if (deps.length > 0) {
      console.log(`  dependencies:`);
      for (const [n, s] of deps) {
        console.log(`    ${n} ${s}`);
      }
    } else {
      console.log(`  dependencies: none`);
    }

    if (latestMeta.platformDependencies) {
      for (const [platform, pdeps] of Object.entries(
        latestMeta.platformDependencies,
      )) {
        if (pdeps && Object.keys(pdeps).length > 0) {
          console.log(`  ${platform}-only dependencies:`);
          for (const [n, s] of Object.entries(pdeps)) {
            console.log(`    ${n} ${s}`);
          }
        }
      }
    }

    console.log(`  exports (${latestMeta.exports.length}):`);
    const wrapped = wrapList(latestMeta.exports, 60);
    for (const line of wrapped) {
      console.log(`    ${line}`);
    }

    console.log(`  integrity: ${latestMeta.integrity}`);
  }

  if (versions.length > 1) {
    console.log(`\n  versions:`);
    for (const v of versions) {
      console.log(`    ${v}${v === latest ? " (latest)" : ""}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const [aMain] = a.split("-");
  const [bMain] = b.split("-");
  const av = aMain.split(".").map(Number);
  const bv = bMain.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) - (bv[i] ?? 0);
  }
  return a.localeCompare(b);
}

function wrapList(items: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    if (current.length + item.length + 2 > maxWidth) {
      if (current) lines.push(current);
      current = item;
    } else {
      current = current ? `${current}, ${item}` : item;
    }
  }
  if (current) lines.push(current);
  return lines;
}
