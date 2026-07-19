import { describe, it, expect } from "vitest";
import { validateManifest, resolveFunctions, type Manifest, type PackageBundle } from "../src/index.js";

describe("validateManifest", () => {
  const validManifest: Manifest = {
    name: "my-package",
    version: "1.0.0",
    description: "A test package",
    owners: ["user"],
    license: "MIT",
    dependencies: {},
    exports: ["MY_FUNC"],
    platforms: ["gsheets"],
  };

  it("accepts a valid manifest", () => {
    expect(validateManifest(validManifest)).toEqual([]);
  });

  it("rejects missing name", () => {
    const errors = validateManifest({ ...validManifest, name: "" });
    expect(errors).toContain("name is required");
  });

  it("rejects invalid name format", () => {
    const errors = validateManifest({ ...validManifest, name: "MyPackage" });
    expect(errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("rejects invalid version", () => {
    const errors = validateManifest({ ...validManifest, version: "1.0" });
    expect(errors.some((e) => e.includes("semver"))).toBe(true);
  });

  it("rejects missing platforms", () => {
    const errors = validateManifest({ ...validManifest, platforms: [] });
    expect(errors.some((e) => e.includes("platform"))).toBe(true);
  });

  it("accepts empty exports (auto-synced at publish)", () => {
    expect(validateManifest({ ...validManifest, exports: [] })).toEqual([]);
  });

  it("accepts empty description (publish-time check)", () => {
    expect(validateManifest({ ...validManifest, description: "" })).toEqual([]);
  });

  it("accepts empty owners (publish-time check)", () => {
    expect(validateManifest({ ...validManifest, owners: [] })).toEqual([]);
  });
});

describe("resolveFunctions", () => {
  it("returns universal functions when no platform overrides", () => {
    const bundle: PackageBundle = {
      manifest: {} as Manifest,
      functions: { FUNC_A: { definition: "=1", description: "a", arguments: {} } },
    };
    const result = resolveFunctions(bundle, "gsheets");
    expect(result).toEqual(bundle.functions);
  });

  it("merges platform-specific overrides", () => {
    const bundle: PackageBundle = {
      manifest: {} as Manifest,
      functions: {
        FUNC_A: { definition: "=universal", description: "a", arguments: {} },
        FUNC_B: { definition: "=universal_b", description: "b", arguments: {} },
      },
      platformFunctions: {
        excel: {
          FUNC_A: { definition: "=excel_specific", description: "a (excel)", arguments: {} },
        },
      },
    };
    const result = resolveFunctions(bundle, "excel");
    expect(result.FUNC_A.definition).toBe("=excel_specific");
    expect(result.FUNC_B.definition).toBe("=universal_b");
  });
});
