import { describe, it, expect } from "vitest";
import {
  resolveDeps,
  pickVersion,
  ResolveError,
} from "../src/resolver.js";
import type { PackageMeta, VersionMeta } from "../src/registry.js";
import type { Lockfile } from "../src/adapter.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function versionMeta(
  deps: Record<string, string> = {},
  overrides: Partial<VersionMeta> = {},
): VersionMeta {
  return {
    artifact: "packages/test/0.0.0/test-0.0.0.fpkg",
    integrity: "sha256:fake",
    dependencies: deps,
    exports: ["TEST"],
    platforms: ["excel"],
    ...overrides,
  };
}

function pkgMeta(
  name: string,
  versions: Record<string, VersionMeta>,
): PackageMeta {
  return { name, owners: ["test"], versions };
}

/** Build a mock fetcher from a map of PackageMeta objects. */
function mockFetcher(
  packages: Record<string, PackageMeta>,
): (name: string) => Promise<PackageMeta> {
  return async (name: string) => {
    const meta = packages[name];
    if (!meta) throw new ResolveError(`Dependency not found in registry: ${name}`);
    return meta;
  };
}

// ---------------------------------------------------------------------------
// pickVersion
// ---------------------------------------------------------------------------

describe("pickVersion", () => {
  const meta = pkgMeta("test", {
    "1.0.0": versionMeta(),
    "1.1.0": versionMeta(),
    "2.0.0": versionMeta(),
  });

  it("picks latest when no specifier", () => {
    const result = pickVersion(meta, "");
    expect(result?.version).toBe("2.0.0");
  });

  it("picks latest satisfying >=", () => {
    const result = pickVersion(meta, ">=1.0.0");
    expect(result?.version).toBe("2.0.0");
  });

  it("picks latest satisfying ^", () => {
    const result = pickVersion(meta, "^1.0.0");
    expect(result?.version).toBe("1.1.0");
  });

  it("picks exact version", () => {
    const result = pickVersion(meta, "1.0.0");
    expect(result?.version).toBe("1.0.0");
  });

  it("returns null when nothing matches", () => {
    const result = pickVersion(meta, ">=3.0.0");
    expect(result).toBeNull();
  });

  it("filters by platform", () => {
    const multiPlatform = pkgMeta("test", {
      "1.0.0": versionMeta({}, { platforms: ["gsheets"] }),
      "2.0.0": versionMeta({}, { platforms: ["excel"] }),
      "3.0.0": versionMeta({}, { platforms: ["excel", "gsheets"] }),
    });

    expect(pickVersion(multiPlatform, "", "excel")?.version).toBe("3.0.0");
    expect(pickVersion(multiPlatform, "", "gsheets")?.version).toBe("3.0.0");
    expect(pickVersion(multiPlatform, "^2.0.0", "excel")?.version).toBe("2.0.0");
    expect(pickVersion(multiPlatform, "^1.0.0", "excel")).toBeNull(); // 1.0.0 is gsheets-only
  });

  it("ignores platform filter when platforms array is empty", () => {
    const noPlatforms = pkgMeta("test", {
      "1.0.0": versionMeta({}, { platforms: [] }),
    });
    // Empty platforms = universal, not restricted
    expect(pickVersion(noPlatforms, "", "excel")?.version).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// resolveDeps
// ---------------------------------------------------------------------------

describe("resolveDeps", () => {
  it("returns empty list for package with no deps", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta(),
      }),
    };

    const result = await resolveDeps("root", "1.0.0", mockFetcher(packages));
    expect(result).toEqual([]);
  });

  it("resolves a single direct dependency", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ utils: ">=1.0.0" }),
      }),
      utils: pkgMeta("utils", {
        "1.0.0": versionMeta(),
        "1.1.0": versionMeta(),
      }),
    };

    const result = await resolveDeps("root", "1.0.0", mockFetcher(packages));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("utils");
    expect(result[0].version).toBe("1.1.0"); // latest match
  });

  it("resolves transitive dependencies", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ alpha: ">=1.0.0" }),
      }),
      alpha: pkgMeta("alpha", {
        "1.0.0": versionMeta({ beta: ">=0.1.0" }),
      }),
      beta: pkgMeta("beta", {
        "0.1.0": versionMeta(),
        "0.2.0": versionMeta(),
      }),
    };

    const result = await resolveDeps("root", "1.0.0", mockFetcher(packages));
    const names = result.map((r) => r.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(result.find((r) => r.name === "beta")?.version).toBe("0.2.0");
  });

  it("skips packages already in the lockfile", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ utils: ">=1.0.0" }),
      }),
      utils: pkgMeta("utils", {
        "1.0.0": versionMeta(),
      }),
    };

    const lock: Lockfile = {
      packages: {
        utils: {
          version: "1.0.0",
          dependencies: [],
          functions: ["UTIL_FN"],
        },
      },
    };

    const result = await resolveDeps(
      "root",
      "1.0.0",
      mockFetcher(packages),
      lock,
    );
    expect(result).toEqual([]);
  });

  it("does not visit the same package twice (diamond deps)", async () => {
    let fetchCount = 0;
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ a: ">=1.0.0", b: ">=1.0.0" }),
      }),
      a: pkgMeta("a", {
        "1.0.0": versionMeta({ shared: ">=1.0.0" }),
      }),
      b: pkgMeta("b", {
        "1.0.0": versionMeta({ shared: ">=1.0.0" }),
      }),
      shared: pkgMeta("shared", {
        "1.0.0": versionMeta(),
      }),
    };

    const fetcher = async (name: string) => {
      if (name === "shared") fetchCount++;
      return mockFetcher(packages)(name);
    };

    const result = await resolveDeps("root", "1.0.0", fetcher);
    const names = result.map((r) => r.name).sort();
    expect(names).toEqual(["a", "b", "shared"]);
    // shared should only be fetched once due to visited set
    expect(fetchCount).toBeLessThanOrEqual(1);
  });

  it("throws when a dependency is not in the registry", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ missing: ">=1.0.0" }),
      }),
    };

    await expect(
      resolveDeps("root", "1.0.0", mockFetcher(packages)),
    ).rejects.toThrow("Dependency not found in registry: missing");
  });

  it("throws when no version satisfies the specifier", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ utils: ">=5.0.0" }),
      }),
      utils: pkgMeta("utils", {
        "1.0.0": versionMeta(),
      }),
    };

    await expect(
      resolveDeps("root", "1.0.0", mockFetcher(packages)),
    ).rejects.toThrow('No version of utils satisfies ">=5.0.0"');
  });

  it("throws when root package is not found", async () => {
    await expect(
      resolveDeps("ghost", "1.0.0", mockFetcher({})),
    ).rejects.toThrow("not found in registry: ghost");
  });

  it("throws when root version is not found", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta(),
      }),
    };

    await expect(
      resolveDeps("root", "9.9.9", mockFetcher(packages)),
    ).rejects.toThrow("Version 9.9.9 not found for root");
  });

  it("filters dependency versions by platform", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({ lib: ">=1.0.0" }),
      }),
      lib: pkgMeta("lib", {
        "1.0.0": versionMeta({}, { platforms: ["gsheets"] }),
        "2.0.0": versionMeta({}, { platforms: ["excel"] }),
      }),
    };

    const result = await resolveDeps(
      "root", "1.0.0", mockFetcher(packages),
      { packages: {} }, "excel",
    );
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("2.0.0");
  });

  it("resolves platform-specific dependencies", async () => {
    const packages = {
      root: pkgMeta("root", {
        "1.0.0": versionMeta({}, {
          platformDependencies: {
            excel: { "excel-shims": ">=1.0.0" },
          },
        }),
      }),
      "excel-shims": pkgMeta("excel-shims", {
        "1.0.0": versionMeta({}, { platforms: ["excel"] }),
      }),
    };

    // On excel: should resolve excel-shims
    const excelResult = await resolveDeps(
      "root", "1.0.0", mockFetcher(packages),
      { packages: {} }, "excel",
    );
    expect(excelResult.map((r) => r.name)).toContain("excel-shims");

    // On gsheets: should NOT resolve excel-shims
    const gsResult = await resolveDeps(
      "root", "1.0.0", mockFetcher(packages),
      { packages: {} }, "gsheets",
    );
    expect(gsResult).toEqual([]);
  });
});
