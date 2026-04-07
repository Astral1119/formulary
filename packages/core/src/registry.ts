import type { Platform } from "./manifest.js";

/** Lightweight package listing, fetched first. */
export interface RegistryIndex {
  packages: Record<string, RegistryIndexEntry>;
}

export interface RegistryIndexEntry {
  latest: string;
  description: string;
  platforms: Platform[];
}

/** Per-package metadata with all versions. */
export interface PackageMeta {
  name: string;
  owners: string[];
  versions: Record<string, VersionMeta>;
}

export interface VersionMeta {
  artifact: string; // relative path to .fpkg
  integrity: string; // sha256:...
  dependencies: Record<string, string>; // name -> version specifier
  platformDependencies?: Partial<Record<Platform, Record<string, string>>>;
  exports: string[];
  platforms: Platform[];
}

/**
 * Registry client — pure logic, I/O injected.
 *
 * Constructs URLs and parses responses. Actual fetching is done by the
 * platform adapter.
 */
export class RegistryClient {
  constructor(private baseUrl: string) {}

  indexUrl(): string {
    return `${this.baseUrl}/index.json`;
  }

  packageMetaUrl(name: string): string {
    return `${this.baseUrl}/packages/${name}/meta.json`;
  }

  artifactUrl(relativePath: string): string {
    return `${this.baseUrl}/${relativePath}`;
  }

  parseIndex(data: unknown): RegistryIndex {
    // TODO: proper validation
    return data as RegistryIndex;
  }

  parsePackageMeta(data: unknown): PackageMeta {
    // TODO: proper validation
    return data as PackageMeta;
  }
}
