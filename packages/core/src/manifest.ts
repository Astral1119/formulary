export interface Manifest {
  name: string;
  version: string;
  description: string;
  owners: string[];
  license: string;
  homepage?: string;
  keywords?: string[];
  dependencies: Record<string, string>; // name -> version specifier
  platformDependencies?: Partial<Record<Platform, Record<string, string>>>;
  exports: string[];
  platforms: Platform[];
}

export interface FunctionDef {
  definition: string;
  description: string;
  arguments: Record<string, ArgumentDef>;
}

export interface ArgumentDef {
  description: string;
  example: string;
}

export type Platform = "excel" | "gsheets" | "lattice";

export interface PackageBundle {
  manifest: Manifest;
  functions: Record<string, FunctionDef>;
  platformFunctions?: Partial<Record<Platform, Record<string, FunctionDef>>>;
  readme?: string;
}

/** Resolve functions for a specific platform: platform-specific overrides win. */
export function resolveFunctions(
  bundle: PackageBundle,
  platform: Platform,
): Record<string, FunctionDef> {
  const platformOverrides = bundle.platformFunctions?.[platform];
  if (!platformOverrides) return bundle.functions;
  return { ...bundle.functions, ...platformOverrides };
}

/** Resolve dependencies for a specific platform: shared + platform-specific. */
export function resolveDependencies(
  manifest: Manifest,
  platform: Platform,
): Record<string, string> {
  const shared = manifest.dependencies ?? {};
  const platformDeps = manifest.platformDependencies?.[platform] ?? {};
  return { ...shared, ...platformDeps };
}

/**
 * Structural validation: is this manifest well-formed?
 * Used at all stages (init, install, publish).
 *
 * Publish-only requirements (description, owners, exports) live in
 * preflight checks, not here, because a workbook in the middle of
 * authoring may legitimately have empty fields.
 */
export function validateManifest(manifest: Manifest): string[] {
  const errors: string[] = [];

  if (!manifest.name) errors.push("name is required");
  else if (!/^[a-z][a-z0-9-]*$/.test(manifest.name))
    errors.push(
      "name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens",
    );

  if (!manifest.version) errors.push("version is required");
  else if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
    errors.push("version must be semver (X.Y.Z)");

  if (!manifest.platforms?.length)
    errors.push("at least one platform is required");

  return errors;
}
