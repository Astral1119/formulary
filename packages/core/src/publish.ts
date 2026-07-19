/**
 * Pure publish logic — registry update generation, preflight checks,
 * and the backend interface.
 *
 * Both the CLI (`cli/src/commands/publish.ts`) and Excel add-in
 * (`excel/src/publish/backend.ts`) import these. Concrete backends apply
 * the update to a registry — GitHub PR via `gh` CLI, GitHub REST API,
 * a local directory for tests, etc.
 */

import type { Manifest, FunctionDef, Platform } from "./manifest.js";
import { validateManifest } from "./manifest.js";

/** Describes all mutations needed to publish a version to the registry. */
export interface RegistryUpdate {
  manifest: Manifest;
  version: string;
  integrity: string;
  /**
   * The packed .fpkg as raw bytes (for browser backends) or a path
   * (for filesystem-based backends). Backends accept whichever they need.
   */
  fpkg: { kind: "bytes"; data: Uint8Array } | { kind: "path"; path: string };
  /** Relative path where the artifact should live in the registry. */
  artifactPath: string;
  /** Updated index entry for this package. */
  indexEntry: {
    latest: string;
    description: string;
    platforms: Platform[];
  };
  /** Updated version entry for meta.json. */
  versionEntry: VersionEntry;
}

export interface VersionEntry {
  artifact: string;
  integrity: string;
  dependencies: Record<string, string>;
  platformDependencies?: Partial<Record<Platform, Record<string, string>>>;
  exports: string[];
  platforms: Platform[];
}

export function buildRegistryUpdate(
  manifest: Manifest,
  fpkg: RegistryUpdate["fpkg"],
  integrity: string,
): RegistryUpdate {
  const { name, version } = manifest;
  const artifactPath = `packages/${name}/${version}/${name}-${version}.fpkg`;

  const versionEntry: VersionEntry = {
    artifact: artifactPath,
    integrity,
    dependencies: manifest.dependencies ?? {},
    exports: manifest.exports,
    platforms: manifest.platforms,
  };

  if (manifest.platformDependencies) {
    versionEntry.platformDependencies = manifest.platformDependencies;
  }

  return {
    manifest,
    version,
    integrity,
    fpkg,
    artifactPath,
    indexEntry: {
      latest: version,
      description: manifest.description,
      platforms: manifest.platforms,
    },
    versionEntry,
  };
}

/**
 * A registry backend applies a RegistryUpdate to a registry.
 * Implementations exist for GitHub PR (CLI, via `gh`), GitHub REST API
 * (browser, via fetch), and could exist for local-file backends in tests.
 */
export interface RegistryBackend {
  /** Apply the update. Returns a result string (typically a PR URL). */
  apply(update: RegistryUpdate): Promise<string>;
}

// ─── Preflight checks ─────────────────────────────────────────────

export interface PreflightCheck {
  ok: boolean;
  label: string;
  detail?: string;
}

/**
 * Functions that exfiltrate cell data via HTTP — rejected by the
 * registry policy. Static check on function bodies.
 */
export const FORBIDDEN_FUNCTIONS = new Set([
  "WEBSERVICE",
  "IMAGE",
  "HYPERLINK",
  "IMPORTDATA",
  "IMPORTHTML",
  "IMPORTXML",
  "IMPORTRANGE",
]);

export function findExfiltrationCalls(
  functions: Record<string, FunctionDef>,
): string[] {
  const hits = new Set<string>();
  for (const def of Object.values(functions)) {
    for (const fn of FORBIDDEN_FUNCTIONS) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, "i");
      if (re.test(def.definition)) hits.add(fn);
    }
  }
  return [...hits];
}

/**
 * Run all publish-time checks. Each check has an ok flag and optional
 * detail; the caller decides whether to block on failures or just warn.
 */
export function runPreflightChecks(
  manifest: Manifest,
  functions: Record<string, FunctionDef>,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // Structural manifest validity (semver, name format, platforms)
  const manifestErrors = validateManifest(manifest);
  checks.push({
    ok: manifestErrors.length === 0,
    label: "manifest is well-formed",
    detail: manifestErrors.join(", "),
  });

  // Description required for publish (user-facing in registry)
  checks.push({
    ok: !!manifest.description?.trim(),
    label: "description set",
    detail: manifest.description?.trim()
      ? undefined
      : "set the description field in your manifest",
  });

  // At least one function to publish
  const fnCount = Object.keys(functions).length;
  checks.push({
    ok: fnCount > 0,
    label: `at least one function (${fnCount})`,
    detail: fnCount > 0 ? undefined : "no functions to publish",
  });

  // No exfiltration functions
  const exfilHits = findExfiltrationCalls(functions);
  checks.push({
    ok: exfilHits.length === 0,
    label: "no exfiltration functions",
    detail: exfilHits.length
      ? `package uses ${exfilHits.join(", ")} — not allowed`
      : undefined,
  });

  return checks;
}

/**
 * Add the publisher to the manifest's owners list if not already present.
 * Returns a new manifest with synced owners and exports.
 */
export function syncManifestForPublish(
  manifest: Manifest,
  functions: Record<string, FunctionDef>,
  publisherUsername?: string,
): Manifest {
  const owners = [...manifest.owners];
  if (publisherUsername && !owners.includes(publisherUsername)) {
    owners.push(publisherUsername);
  }
  return {
    ...manifest,
    owners,
    exports: Object.keys(functions),
  };
}
