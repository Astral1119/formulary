/**
 * Dependency resolver.
 *
 * Walks the dependency tree starting from a root package, resolving each
 * transitive dependency to the latest version that satisfies its specifier
 * and supports the target platform. Already-locked packages are skipped.
 *
 * I/O-free: package metadata is provided via a lookup function so callers
 * can fetch lazily, cache, or supply test fixtures.
 */

import type { Platform } from "./manifest.js";
import type { PackageMeta, VersionMeta } from "./registry.js";
import type { Lockfile } from "./adapter.js";
import { parseSemVer, compareSemVer, satisfies } from "./version.js";

/** A single resolved package ready for installation. */
export interface ResolvedPackage {
  name: string;
  version: string;
  meta: VersionMeta;
}

/** Fetches PackageMeta for a given package name. */
export type MetaFetcher = (name: string) => Promise<PackageMeta>;

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

/**
 * Resolve all transitive dependencies for a package.
 *
 * Returns a flat list of packages to install, excluding those already in
 * the lockfile. The root package itself is NOT included — only its deps.
 *
 * @param rootName    - The root package name
 * @param rootVersion - The root package version
 * @param fetchMeta   - Async function that returns PackageMeta for a name
 * @param lock        - Current lockfile (already-installed packages are skipped)
 * @param platform    - Target platform (filters versions that don't support it)
 */
export async function resolveDeps(
  rootName: string,
  rootVersion: string,
  fetchMeta: MetaFetcher,
  lock: Lockfile = { packages: {} },
  platform?: Platform,
): Promise<ResolvedPackage[]> {
  const toInstall: ResolvedPackage[] = [];
  const visited = new Set<string>();

  // Seed with already-locked packages
  for (const name of Object.keys(lock.packages)) {
    visited.add(name);
  }

  // Don't re-visit the root
  visited.add(rootName);

  async function visit(pkgName: string, specifier: string): Promise<void> {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const meta = await fetchMeta(pkgName);
    if (!meta) {
      throw new ResolveError(`Dependency not found in registry: ${pkgName}`);
    }

    const resolved = pickVersion(meta, specifier, platform);
    if (!resolved) {
      const platformNote = platform ? ` for platform "${platform}"` : "";
      throw new ResolveError(
        `No version of ${pkgName} satisfies "${specifier}"${platformNote}`,
      );
    }

    toInstall.push({
      name: pkgName,
      version: resolved.version,
      meta: resolved.meta,
    });

    // Recurse into this package's dependencies.
    // Merge shared deps + platform-specific deps if platform is known.
    const sharedDeps = resolved.meta.dependencies ?? {};
    const platformDeps =
      platform && resolved.meta.platformDependencies
        ? (resolved.meta.platformDependencies[platform] ?? {})
        : {};
    const allDeps = { ...sharedDeps, ...platformDeps };

    await Promise.all(
      Object.entries(allDeps).map(([depName, depSpec]) =>
        visit(depName, depSpec),
      ),
    );
  }

  // Resolve the root package's own deps
  const rootMeta = await fetchMeta(rootName);
  if (!rootMeta) {
    throw new ResolveError(`Package not found in registry: ${rootName}`);
  }

  const rootVersionMeta = rootMeta.versions[rootVersion];
  if (!rootVersionMeta) {
    throw new ResolveError(
      `Version ${rootVersion} not found for ${rootName}`,
    );
  }

  const sharedDeps = rootVersionMeta.dependencies ?? {};
  const platformDeps =
    platform && rootVersionMeta.platformDependencies
      ? (rootVersionMeta.platformDependencies[platform] ?? {})
      : {};
  const rootDeps = { ...sharedDeps, ...platformDeps };

  await Promise.all(
    Object.entries(rootDeps).map(([depName, depSpec]) =>
      visit(depName, depSpec),
    ),
  );

  return toInstall;
}

/**
 * Pick the latest version from a PackageMeta that satisfies a specifier
 * and supports the target platform (if specified).
 * Versions are sorted descending; first match wins (greedy latest).
 */
export function pickVersion(
  meta: PackageMeta,
  specifier: string,
  platform?: Platform,
): { version: string; meta: VersionMeta } | null {
  const versions = Object.keys(meta.versions)
    .map((v) => ({ str: v, parsed: parseSemVer(v) }))
    .filter((v) => v.parsed !== null)
    .sort((a, b) => compareSemVer(b.parsed!, a.parsed!)); // descending

  for (const v of versions) {
    if (specifier && !satisfies(v.str, specifier)) continue;

    const vMeta = meta.versions[v.str];

    // Skip versions that don't support the target platform
    if (platform && vMeta.platforms?.length && !vMeta.platforms.includes(platform)) {
      continue;
    }

    return { version: v.str, meta: vMeta };
  }

  return null;
}
