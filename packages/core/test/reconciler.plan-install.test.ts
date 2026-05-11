import { describe, expect, it } from "vitest";

import {
  RECONCILER_SCHEMA_VERSION,
  planInstallPackage,
  type Capability,
  type CapabilityMap,
  type FunctionOrigin,
  type PackageBundle,
  type PackageMeta,
  type ReconcileInput,
  type VersionMeta,
} from "../src/reconciler/index.js";

const direct: Capability = { level: "direct", canVerify: true };
const unsupported: Capability = { level: "unsupported" };

function capabilities(overrides: Partial<CapabilityMap> = {}): CapabilityMap {
  return {
    listFunctions: direct,
    createFunction: direct,
    updateFunction: direct,
    deleteFunction: direct,
    readMetadata: direct,
    writeMetadata: direct,
    readLockfile: direct,
    writeLockfile: direct,
    evaluateExamples: direct,
    runTests: direct,
    publish: direct,
    ...overrides,
  };
}

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  const base: ReconcileInput = {
    target: {
      kind: "excel-workbook",
      platform: "excel",
      id: "excel:file:test",
    },
    workbook: {
      schemaVersion: RECONCILER_SCHEMA_VERSION,
      targetId: "excel:file:test",
      functions: {},
    },
    project: {
      schemaVersion: RECONCILER_SCHEMA_VERSION,
      initialized: true,
      owners: [],
      directDependencies: {},
      exports: [],
      targetIds: ["excel:file:test"],
    },
    lockfile: {
      schemaVersion: RECONCILER_SCHEMA_VERSION,
      packages: {},
    },
    capabilities: capabilities(),
    diagnostics: [],
  };

  return { ...base, ...overrides };
}

function versionMeta(overrides: Partial<VersionMeta> = {}): VersionMeta {
  return {
    artifact: "packages/charter/1.0.0/charter-1.0.0.fpkg",
    integrity: "sha256:charter",
    dependencies: {},
    exports: ["CHARTER_MAP"],
    platforms: ["excel"],
    ...overrides,
  };
}

function packageMeta(version: VersionMeta = versionMeta()): PackageMeta {
  return namedPackageMeta("charter", version);
}

function namedPackageMeta(
  name: string,
  version: VersionMeta = versionMeta(),
): PackageMeta {
  return {
    name,
    owners: ["test"],
    versions: {
      "1.0.0": version,
    },
  };
}

function bundle(name = "charter"): PackageBundle {
  const functionName = name === "utils" ? "UTIL_ID" : "CHARTER_MAP";

  return {
    manifest: {
      name,
      version: "1.0.0",
      description: `${name} helpers.`,
      owners: ["test"],
      license: "MIT",
      dependencies: {},
      exports: [functionName],
      platforms: ["excel"],
    },
    functions: {
      [functionName]: {
        definition: "=LAMBDA(value, value)",
        description: `Maps a ${name} value.`,
        arguments: {
          value: {
            description: "Value to map.",
            example: "A1",
          },
        },
      },
    },
  };
}

function deps(meta: PackageMeta = packageMeta()) {
  return {
    packageMeta: async () => meta,
    packageBundle: async () => bundle(),
  };
}

function existingFunction(origin: FunctionOrigin) {
  return {
    name: "CHARTER_MAP",
    definition: "=LAMBDA(value, value)",
    parameters: [],
    examples: [],
    origin,
    hash: "sha256:existing",
  };
}

describe("planInstallPackage", () => {
  it("plans a clean package install without mutating source state", async () => {
    const source = input();

    const plan = await planInstallPackage(
      source,
      { kind: "install-package", packageName: "charter" },
      deps(),
    );

    expect(plan.applyPolicy.applicable).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.preview.packages).toEqual([
      { name: "charter", version: "1.0.0", direct: true },
    ]);
    expect(plan.preview.functions).toContainEqual({
      name: "CHARTER_MAP",
      action: "create",
    });
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "download-artifact",
      "verify-integrity",
      "create-function",
      "write-project-metadata",
      "write-lockfile",
      "verify-function",
      "verify-lockfile",
    ]);
    expect(source.workbook.functions).toEqual({});
    expect(source.lockfile.packages).toEqual({});
  });

  it("blocks when an incoming function collides with a local workbook function", async () => {
    const plan = await planInstallPackage(
      input({
        workbook: {
          schemaVersion: RECONCILER_SCHEMA_VERSION,
          targetId: "excel:file:test",
          functions: {
            CHARTER_MAP: existingFunction({ kind: "local" }),
          },
        },
      }),
      { kind: "install-package", packageName: "charter" },
      deps(),
    );

    expect(plan.applyPolicy.applicable).toBe(false);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        kind: "function-name-collision",
        functionName: "CHARTER_MAP",
        severity: "blocking",
      }),
    );
  });

  it.each([
    [
      "modified installed package function",
      { kind: "modified-package", packageName: "charter", version: "1.0.0" },
    ],
    ["unknown function", { kind: "unknown" }],
    [
      "function owned by another package",
      { kind: "package", packageName: "other", version: "1.0.0" },
    ],
  ] satisfies Array<[string, FunctionOrigin]>)(
    "blocks when an incoming function collides with a %s",
    async (_label, origin) => {
      const plan = await planInstallPackage(
        input({
          workbook: {
            schemaVersion: RECONCILER_SCHEMA_VERSION,
            targetId: "excel:file:test",
            functions: {
              CHARTER_MAP: existingFunction(origin),
            },
          },
        }),
        { kind: "install-package", packageName: "charter" },
        deps(),
      );

      expect(plan.applyPolicy.applicable).toBe(false);
      expect(plan.conflicts).toContainEqual(
        expect.objectContaining({
          kind: "function-name-collision",
          functionName: "CHARTER_MAP",
          severity: "blocking",
        }),
      );
    },
  );

  it("does not block an idempotent reinstall of the same package version", async () => {
    const plan = await planInstallPackage(
      input({
        workbook: {
          schemaVersion: RECONCILER_SCHEMA_VERSION,
          targetId: "excel:file:test",
          functions: {
            CHARTER_MAP: existingFunction({
              kind: "package",
              packageName: "charter",
              version: "1.0.0",
            }),
          },
        },
      }),
      { kind: "install-package", packageName: "charter" },
      deps(),
    );

    expect(plan.applyPolicy.applicable).toBe(true);
    expect(plan.conflicts).toEqual([]);
  });

  it("blocks when the package has no compatible version for the target platform", async () => {
    const plan = await planInstallPackage(
      input(),
      { kind: "install-package", packageName: "charter" },
      deps(packageMeta(versionMeta({ platforms: ["gsheets"] }))),
    );

    expect(plan.applyPolicy.applicable).toBe(false);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        kind: "unsupported-platform-rendering",
        severity: "blocking",
      }),
    );
  });

  it("blocks with an empty dry-run plan when a transitive dependency cannot resolve", async () => {
    const metas: Record<string, PackageMeta> = {
      charter: namedPackageMeta(
        "charter",
        versionMeta({ dependencies: { utils: "1.0.0" } }),
      ),
      utils: namedPackageMeta(
        "utils",
        versionMeta({
          artifact: "packages/utils/1.0.0/utils-1.0.0.fpkg",
          integrity: "sha256:utils",
          exports: ["UTIL_ID"],
          platforms: ["gsheets"],
        }),
      ),
    };

    const plan = await planInstallPackage(
      input(),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async (name) => metas[name],
        packageBundle: async (name) => bundle(name),
      },
    );

    expect(plan.applyPolicy.applicable).toBe(false);
    expect(plan.applyPolicy.blockedBy).toEqual([
      "dependency-version-conflict:charter",
    ]);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        id: "dependency-version-conflict:charter",
        kind: "dependency-version-conflict",
        packageName: "charter",
        severity: "blocking",
        resolutions: [expect.objectContaining({ effect: "abort" })],
      }),
    );
    expect(plan.steps).toEqual([]);
    expect(plan.preview.packages).toEqual([]);
    expect(plan.preview.functions).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "undeclared-dependency",
        message: expect.stringContaining(
          'No version of utils satisfies "1.0.0" for platform "excel"',
        ),
        targetId: "excel:file:test",
      }),
    );
  });

  it("blocks and diagnoses unavailable required write capabilities", async () => {
    const plan = await planInstallPackage(
      input({ capabilities: capabilities({ createFunction: unsupported }) }),
      { kind: "install-package", packageName: "charter" },
      deps(),
    );

    expect(plan.applyPolicy.applicable).toBe(false);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "required-capability-unavailable",
        subject: { type: "capability", id: "createFunction" },
      }),
    );
  });

  it.each(["manual", "helper-backed"] as const)(
    "blocks createFunction level %s under the direct-only policy",
    async (level) => {
      const plan = await planInstallPackage(
        input({ capabilities: capabilities({ createFunction: { level } }) }),
        { kind: "install-package", packageName: "charter" },
        deps(),
      );

      expect(plan.applyPolicy.applicable).toBe(false);
      expect(plan.conflicts).toContainEqual(
        expect.objectContaining({
          kind: "required-capability-unavailable",
          severity: "blocking",
        }),
      );
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "required-capability-unavailable",
          subject: { type: "capability", id: "createFunction" },
        }),
      );
    },
  );

  it.each(["readMetadata", "listFunctions", "readLockfile"] as const)(
    "blocks and diagnoses unavailable planned step capability %s",
    async (capability) => {
      const plan = await planInstallPackage(
        input({ capabilities: capabilities({ [capability]: unsupported }) }),
        { kind: "install-package", packageName: "charter" },
        deps(),
      );

      expect(plan.applyPolicy.applicable).toBe(false);
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "required-capability-unavailable",
          subject: { type: "capability", id: capability },
        }),
      );
      expect(plan.requiredCapabilities).toContainEqual({
        capability,
        acceptableLevels: ["direct"],
      });
    },
  );

  it("plans transitive dependency package functions before root package functions", async () => {
    const fetchedBundles: string[] = [];
    const metas: Record<string, PackageMeta> = {
      charter: namedPackageMeta(
        "charter",
        versionMeta({ dependencies: { utils: "1.0.0" } }),
      ),
      utils: namedPackageMeta(
        "utils",
        versionMeta({
          artifact: "packages/utils/1.0.0/utils-1.0.0.fpkg",
          integrity: "sha256:utils",
          exports: ["UTIL_ID"],
        }),
      ),
    };

    const plan = await planInstallPackage(
      input(),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async (name) => metas[name],
        packageBundle: async (name) => {
          fetchedBundles.push(name);
          return bundle(name);
        },
      },
    );

    const createFunctionNames = plan.steps
      .filter((step) => step.kind === "create-function")
      .map((step) => step.functionName);

    expect(fetchedBundles).toEqual(["utils", "charter"]);
    expect(createFunctionNames).toEqual(["UTIL_ID", "CHARTER_MAP"]);
    expect(plan.preview.packages).toEqual([
      { name: "utils", version: "1.0.0", direct: false },
      { name: "charter", version: "1.0.0", direct: true },
    ]);
  });
});
