# Formulary Reconciler Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first pure `@formulary/core` reconciler contract: versioned target/workbook/project/lockfile/capability/diagnostic/change-plan types, normalization helpers, and an initial install-package planner.

**Architecture:** Keep the first implementation entirely in `packages/core` with no Excel, Google Sheets, Lattice, Playwright, network, or UI dependencies. The reconciler accepts already-loaded registry/package fixtures and a normalized `ReconcileInput`, then emits immutable dry-run `ChangePlan` objects. Existing CLI and add-in mutation flows remain unchanged until the contract is proven.

**Tech Stack:** TypeScript 5.8, Vitest, existing `@formulary/core` package, existing `Manifest`, `PackageBundle`, `NamedFunction`, `ProjectMetadata`, `Lockfile`, `PackageMeta`, `VersionMeta`, `pickVersion`, `resolveDeps`, and `resolveFunctions`.

---

## File Structure

- Create `packages/core/src/reconciler/types.ts`
  - Contract types: schema versions, `WorkbookTarget`, `WorkbookModel`, `ProjectState`, `LockfileState`, `CapabilityMap`, diagnostics, conflicts, warnings, `ChangePlan`, install intent, planner dependency interfaces.
- Create `packages/core/src/reconciler/normalize.ts`
  - Pure normalization helpers from today’s `NamedFunction`, `ProjectMetadata`, and `Lockfile` shapes into reconciler shapes.
- Create `packages/core/src/reconciler/plan-install.ts`
  - Initial `planInstallPackage` implementation.
- Create `packages/core/src/reconciler/index.ts`
  - Public re-export for reconciler module.
- Modify `packages/core/src/index.ts`
  - Re-export reconciler public API.
- Create `packages/core/test/reconciler.normalize.test.ts`
  - Tests for parameter normalization, project metadata normalization, and lockfile direct/transitive classification.
- Create `packages/core/test/reconciler.plan-install.test.ts`
  - Tests for clean install plan, collision, unsupported platform rendering, and missing capability.

## Task 1: Add Reconciler Contract Types

**Files:**
- Create: `packages/core/src/reconciler/types.ts`
- Create: `packages/core/src/reconciler/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the reconciler directory**

Run:

```bash
mkdir -p packages/core/src/reconciler
```

Expected: directory exists.

- [ ] **Step 2: Add contract types**

Create `packages/core/src/reconciler/types.ts`:

```ts
import type { Lockfile, NamedFunction, ProjectMetadata } from "../adapter.js";
import type { FunctionDef, PackageBundle, Platform } from "../manifest.js";
import type { PackageMeta, VersionMeta } from "../registry.js";

export const RECONCILER_SCHEMA_VERSION = 1;

export interface Versioned {
  schemaVersion: number;
}

export type WorkbookTarget =
  | {
      kind: "excel-workbook";
      platform: "excel";
      id: `excel:file:${string}` | `excel:session:${string}`;
      displayName?: string;
      path?: string;
    }
  | {
      kind: "google-sheet";
      platform: "gsheets";
      id: `gsheets:spreadsheet:${string}`;
      spreadsheetId: string;
      displayName?: string;
      url?: string;
    }
  | {
      kind: "lattice-project";
      platform: "lattice";
      id: `lattice:project:${string}`;
      displayName?: string;
      path?: string;
    }
  | {
      kind: "directory";
      platform: Platform;
      id: `directory:${string}`;
      displayName?: string;
      path: string;
    };

export interface WorkbookModel extends Versioned {
  targetId: WorkbookTarget["id"];
  functions: Record<string, WorkbookFunction>;
  observedMetadata?: ProjectMetadata;
  observedLockfile?: Lockfile;
}

export interface WorkbookFunction {
  name: string;
  definition: string;
  description?: string;
  parameters: FunctionParameter[];
  examples: FunctionExample[];
  origin: FunctionOrigin;
  hash: string;
}

export interface FunctionParameter {
  name: string;
  description?: string;
  examples: string[];
}

export interface FunctionExample {
  expression: string;
  description?: string;
}

export type FunctionOrigin =
  | { kind: "local" }
  | { kind: "package"; packageName: string; version: string; integrity?: string }
  | { kind: "modified-package"; packageName: string; version: string; integrity?: string }
  | { kind: "unknown" };

export interface ProjectState extends Versioned {
  initialized: boolean;
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  owners: string[];
  license?: string;
  directDependencies: Record<string, string>;
  exports: string[];
  targetIds: WorkbookTarget["id"][];
}

export interface LockfileState extends Versioned {
  packages: Record<string, InstalledPackage>;
}

export interface InstalledPackage {
  name: string;
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies: string[];
  functions: string[];
  direct: boolean;
}

export type CapabilityLevel =
  | "direct"
  | "helper-backed"
  | "experimental"
  | "read-only"
  | "manual"
  | "unsupported";

export interface Capability {
  level: CapabilityLevel;
  reason?: string;
  requiresUserPresence?: boolean;
  canVerify?: boolean;
  canRollback?: boolean;
}

export interface CapabilityMap {
  listFunctions: Capability;
  createFunction: Capability;
  updateFunction: Capability;
  deleteFunction: Capability;
  readMetadata: Capability;
  writeMetadata: Capability;
  readLockfile: Capability;
  writeLockfile: Capability;
  evaluateExamples: Capability;
  runTests: Capability;
  publish: Capability;
}

export interface ReconcileInput {
  target: WorkbookTarget;
  workbook: WorkbookModel;
  project: ProjectState;
  lockfile: LockfileState;
  capabilities: CapabilityMap;
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: DiagnosticCode;
  message: string;
  targetId?: WorkbookTarget["id"];
  subject?: DiagnosticSubject;
  path?: string;
  expected?: unknown;
  actual?: unknown;
  suggestion?: string;
}

export type DiagnosticSubject =
  | { type: "function"; id: string }
  | { type: "dependency"; id: string }
  | { type: "manifest"; id: string }
  | { type: "lockfile"; id: string }
  | { type: "capability"; id: keyof CapabilityMap };

export type DiagnosticCode =
  | "missing-function"
  | "definition-drift"
  | "lockfile-integrity-mismatch"
  | "unsupported-platform"
  | "duplicate-export"
  | "undeclared-dependency"
  | "required-capability-unavailable"
  | "unsafe-function-call"
  | "metadata-incomplete";

export interface ChangePlan extends Versioned {
  id: string;
  kind: ChangePlanKind;
  target: WorkbookTarget;
  title: string;
  summary: string;
  steps: PlanStep[];
  conflicts: PlanConflict[];
  warnings: PlanWarning[];
  diagnostics: Diagnostic[];
  requiredCapabilities: CapabilityRequirement[];
  preview: PlanPreview;
  applyPolicy: ApplyPolicy;
}

export type ChangePlanKind =
  | "install-package"
  | "update-package"
  | "remove-package"
  | "repair-package"
  | "adopt-functions"
  | "detach-functions"
  | "publish-package"
  | "initialize-project";

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  label: string;
  packageName?: string;
  functionName?: string;
  before?: unknown;
  after?: unknown;
  capability: keyof CapabilityMap;
  reversible: boolean;
}

export type PlanStepKind =
  | "create-function"
  | "update-function"
  | "delete-function"
  | "write-project-metadata"
  | "write-lockfile"
  | "download-artifact"
  | "verify-integrity"
  | "verify-function"
  | "verify-lockfile"
  | "build-package-artifact"
  | "publish-registry-update";

export interface PlanConflict {
  id: string;
  severity: "blocking" | "warning";
  kind: ConflictKind;
  message: string;
  functionName?: string;
  packageName?: string;
  resolutions: ConflictResolution[];
}

export type ConflictKind =
  | "function-name-collision"
  | "installed-function-modified"
  | "package-function-missing"
  | "dependency-version-conflict"
  | "unsupported-platform-rendering"
  | "required-capability-unavailable"
  | "integrity-mismatch"
  | "metadata-incomplete"
  | "unsafe-function-call";

export interface ConflictResolution {
  id: string;
  label: string;
  effect: "skip" | "replace" | "rename" | "detach" | "repair" | "abort";
}

export interface PlanWarning {
  id: string;
  kind:
    | "helper-backed-operation"
    | "experimental-capability"
    | "transitive-dependency-change"
    | "no-post-write-verification"
    | "manual-review-required";
  message: string;
}

export interface CapabilityRequirement {
  capability: keyof CapabilityMap;
  minimum: Exclude<CapabilityLevel, "unsupported">;
}

export interface PlanPreview {
  packages: Array<{ name: string; version: string; direct: boolean }>;
  functions: Array<{ name: string; action: "create" | "update" | "delete" | "keep" }>;
}

export interface ApplyPolicy {
  applyable: boolean;
  blockedBy: string[];
  verification: "required" | "recommended" | "unavailable";
}

export interface InstallPackageIntent {
  kind: "install-package";
  packageName: string;
  versionSpec?: string;
}

export interface InstallPlanDependencies {
  packageMeta: (name: string) => Promise<PackageMeta>;
  packageBundle: (name: string, version: string, meta: VersionMeta) => Promise<PackageBundle>;
}

export type SourceNamedFunction = NamedFunction;
export type SourceFunctionDef = FunctionDef;
```

- [ ] **Step 3: Re-export reconciler module**

Create `packages/core/src/reconciler/index.ts`:

```ts
export * from "./types.js";
```

Modify `packages/core/src/index.ts` by adding this export at the end:

```ts
export * from "./reconciler/index.js";
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @formulary/core build
```

Expected: TypeScript compile succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/reconciler/index.ts packages/core/src/reconciler/types.ts
git commit -m "feat(core): add reconciler contract types"
```

## Task 2: Add Normalization Helpers

**Files:**
- Create: `packages/core/src/reconciler/normalize.ts`
- Modify: `packages/core/src/reconciler/index.ts`
- Test: `packages/core/test/reconciler.normalize.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `packages/core/test/reconciler.normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeFunction,
  normalizeLockfile,
  normalizeProjectMetadata,
} from "../src/reconciler/index.js";
import type { Lockfile, NamedFunction, ProjectMetadata } from "../src/adapter.js";

describe("reconciler normalization", () => {
  it("normalizes named-function arguments into parameter records", () => {
    const fn: NamedFunction = {
      name: "DOUBLE",
      definition: "LAMBDA(x, x * 2)",
      description: "Doubles a value",
      arguments: ["x"],
      argumentDescriptions: { x: "Value to double" },
      argumentExamples: { x: "21" },
    };

    expect(normalizeFunction(fn)).toMatchObject({
      name: "DOUBLE",
      definition: "LAMBDA(x, x * 2)",
      description: "Doubles a value",
      parameters: [{ name: "x", description: "Value to double", examples: ["21"] }],
      examples: [],
      origin: { kind: "unknown" },
    });
    expect(normalizeFunction(fn).hash).toMatch(/^sha256:/);
  });

  it("normalizes missing project metadata fields to stable empty values", () => {
    const meta: ProjectMetadata = { dependencies: { charter: "^1.0.0" } };

    expect(normalizeProjectMetadata(meta, ["excel:file:test"])).toEqual({
      schemaVersion: 1,
      initialized: true,
      name: undefined,
      version: undefined,
      description: undefined,
      owners: [],
      license: undefined,
      directDependencies: { charter: "^1.0.0" },
      exports: [],
      targetIds: ["excel:file:test"],
    });
  });

  it("marks lockfile packages as direct when project metadata lists them", () => {
    const lockfile: Lockfile = {
      packages: {
        charter: { version: "1.0.0", dependencies: ["utils"], functions: ["MAP"] },
        utils: { version: "1.0.0", dependencies: [], functions: ["UTIL"] },
      },
    };

    expect(normalizeLockfile(lockfile, { charter: "^1.0.0" })).toEqual({
      schemaVersion: 1,
      packages: {
        charter: {
          name: "charter",
          version: "1.0.0",
          resolved: undefined,
          integrity: undefined,
          dependencies: ["utils"],
          functions: ["MAP"],
          direct: true,
        },
        utils: {
          name: "utils",
          version: "1.0.0",
          resolved: undefined,
          integrity: undefined,
          dependencies: [],
          functions: ["UTIL"],
          direct: false,
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @formulary/core test -- reconciler.normalize.test.ts
```

Expected: FAIL because `normalizeFunction`, `normalizeProjectMetadata`, and `normalizeLockfile` are not exported.

- [ ] **Step 3: Implement normalization helpers**

Create `packages/core/src/reconciler/normalize.ts`:

```ts
import { createHash } from "node:crypto";
import type { Lockfile, NamedFunction, ProjectMetadata } from "../adapter.js";
import {
  RECONCILER_SCHEMA_VERSION,
  type FunctionOrigin,
  type LockfileState,
  type ProjectState,
  type WorkbookFunction,
  type WorkbookTarget,
} from "./types.js";

export function normalizeFunction(
  fn: NamedFunction,
  origin: FunctionOrigin = { kind: "unknown" },
): WorkbookFunction {
  const argNames = fn.arguments ?? [];
  return {
    name: fn.name,
    definition: fn.definition,
    description: fn.description,
    parameters: argNames.map((name) => ({
      name,
      description: fn.argumentDescriptions?.[name],
      examples: fn.argumentExamples?.[name] ? [fn.argumentExamples[name]] : [],
    })),
    examples: [],
    origin,
    hash: hashFunction(fn.name, fn.definition, argNames),
  };
}

export function normalizeProjectMetadata(
  meta: ProjectMetadata | null,
  targetIds: WorkbookTarget["id"][],
): ProjectState {
  return {
    schemaVersion: RECONCILER_SCHEMA_VERSION,
    initialized: meta !== null,
    name: meta?.name,
    version: meta?.version,
    description: meta?.description,
    owners: splitList(meta?.owners),
    license: meta?.license,
    directDependencies: meta?.dependencies ?? {},
    exports: splitList(meta?.exports),
    targetIds,
  };
}

export function normalizeLockfile(
  lockfile: Lockfile | null,
  directDependencies: Record<string, string>,
): LockfileState {
  const packages: LockfileState["packages"] = {};
  for (const [name, entry] of Object.entries(lockfile?.packages ?? {})) {
    packages[name] = {
      name,
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      dependencies: entry.dependencies ?? [],
      functions: entry.functions ?? [],
      direct: Object.prototype.hasOwnProperty.call(directDependencies, name),
    };
  }
  return { schemaVersion: RECONCILER_SCHEMA_VERSION, packages };
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hashFunction(name: string, definition: string, args: string[]): `sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ name, definition, args }));
  return `sha256:${hash.digest("hex")}`;
}
```

Modify `packages/core/src/reconciler/index.ts`:

```ts
export * from "./types.js";
export * from "./normalize.js";
```

- [ ] **Step 4: Run normalization tests**

Run:

```bash
pnpm --filter @formulary/core test -- reconciler.normalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reconciler/index.ts packages/core/src/reconciler/normalize.ts packages/core/test/reconciler.normalize.test.ts
git commit -m "feat(core): normalize reconciler inputs"
```

## Task 3: Add Install Package Planner

**Files:**
- Create: `packages/core/src/reconciler/plan-install.ts`
- Modify: `packages/core/src/reconciler/index.ts`
- Test: `packages/core/test/reconciler.plan-install.test.ts`

- [ ] **Step 1: Write failing install planner tests**

Create `packages/core/test/reconciler.plan-install.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RECONCILER_SCHEMA_VERSION,
  planInstallPackage,
  type Capability,
  type CapabilityMap,
  type PackageBundle,
  type PackageMeta,
  type ReconcileInput,
  type VersionMeta,
} from "../src/reconciler/index.js";

const direct: Capability = { level: "direct", canVerify: true };
const unsupported: Capability = { level: "unsupported", reason: "not available" };

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
    evaluateExamples: unsupported,
    runTests: unsupported,
    publish: unsupported,
    ...overrides,
  };
}

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    target: {
      kind: "excel-workbook",
      platform: "excel",
      id: "excel:file:test",
      displayName: "Test.xlsx",
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
    lockfile: { schemaVersion: RECONCILER_SCHEMA_VERSION, packages: {} },
    capabilities: capabilities(),
    diagnostics: [],
    ...overrides,
  };
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

function packageMeta(meta = versionMeta()): PackageMeta {
  return { name: "charter", owners: ["astral"], versions: { "1.0.0": meta } };
}

function bundle(): PackageBundle {
  return {
    manifest: {
      name: "charter",
      version: "1.0.0",
      description: "Object protocol foundation",
      owners: ["astral"],
      license: "MIT",
      dependencies: {},
      exports: ["CHARTER_MAP"],
      platforms: ["excel"],
    },
    functions: {
      CHARTER_MAP: {
        definition: "LAMBDA(x, x)",
        description: "Maps a value",
        arguments: { x: { description: "Value", example: "1" } },
      },
    },
  };
}

describe("planInstallPackage", () => {
  it("plans a clean package install without mutating workbook state", async () => {
    const plan = await planInstallPackage(
      input(),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async () => packageMeta(),
        packageBundle: async () => bundle(),
      },
    );

    expect(plan.applyPolicy.applyable).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.preview.packages).toEqual([{ name: "charter", version: "1.0.0", direct: true }]);
    expect(plan.preview.functions).toContainEqual({ name: "CHARTER_MAP", action: "create" });
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "download-artifact",
      "verify-integrity",
      "create-function",
      "write-project-metadata",
      "write-lockfile",
      "verify-function",
      "verify-lockfile",
    ]);
  });

  it("blocks when an existing local function collides with an installed function", async () => {
    const plan = await planInstallPackage(
      input({
        workbook: {
          schemaVersion: RECONCILER_SCHEMA_VERSION,
          targetId: "excel:file:test",
          functions: {
            CHARTER_MAP: {
              name: "CHARTER_MAP",
              definition: "LAMBDA(x, x + 1)",
              parameters: [],
              examples: [],
              origin: { kind: "local" },
              hash: "sha256:local",
            },
          },
        },
      }),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async () => packageMeta(),
        packageBundle: async () => bundle(),
      },
    );

    expect(plan.applyPolicy.applyable).toBe(false);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        kind: "function-name-collision",
        functionName: "CHARTER_MAP",
        severity: "blocking",
      }),
    );
  });

  it("blocks when no version supports the target platform", async () => {
    const plan = await planInstallPackage(
      input(),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async () => packageMeta(versionMeta({ platforms: ["gsheets"] })),
        packageBundle: async () => bundle(),
      },
    );

    expect(plan.applyPolicy.applyable).toBe(false);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({ kind: "unsupported-platform-rendering" }),
    );
  });

  it("blocks when a required write capability is unavailable", async () => {
    const plan = await planInstallPackage(
      input({ capabilities: capabilities({ createFunction: unsupported }) }),
      { kind: "install-package", packageName: "charter" },
      {
        packageMeta: async () => packageMeta(),
        packageBundle: async () => bundle(),
      },
    );

    expect(plan.applyPolicy.applyable).toBe(false);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "required-capability-unavailable",
        subject: { type: "capability", id: "createFunction" },
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @formulary/core test -- reconciler.plan-install.test.ts
```

Expected: FAIL because `planInstallPackage` is not exported.

- [ ] **Step 3: Implement the install planner**

Create `packages/core/src/reconciler/plan-install.ts`:

```ts
import { pickVersion, resolveDeps } from "../resolver.js";
import { resolveFunctions } from "../manifest.js";
import {
  RECONCILER_SCHEMA_VERSION,
  type CapabilityMap,
  type ChangePlan,
  type Diagnostic,
  type InstallPackageIntent,
  type InstallPlanDependencies,
  type PlanConflict,
  type PlanStep,
  type ReconcileInput,
  type Versioned,
} from "./types.js";

const REQUIRED_WRITE_CAPABILITIES: Array<keyof CapabilityMap> = [
  "createFunction",
  "writeMetadata",
  "writeLockfile",
];

export async function planInstallPackage(
  input: ReconcileInput,
  intent: InstallPackageIntent,
  deps: InstallPlanDependencies,
): Promise<ChangePlan> {
  const diagnostics: Diagnostic[] = [...input.diagnostics];
  const conflicts: PlanConflict[] = [];
  const steps: PlanStep[] = [];

  const meta = await deps.packageMeta(intent.packageName);
  const picked = pickVersion(meta, intent.versionSpec ?? "", input.target.platform);

  if (!picked) {
    conflicts.push({
      id: `unsupported-platform:${intent.packageName}`,
      severity: "blocking",
      kind: "unsupported-platform-rendering",
      packageName: intent.packageName,
      message: `${intent.packageName} has no version for ${input.target.platform}.`,
      resolutions: [{ id: "abort", label: "Cancel install", effect: "abort" }],
    });
    return buildPlan(input, intent, steps, conflicts, diagnostics, []);
  }

  const transitive = await resolveDeps(
    intent.packageName,
    picked.version,
    deps.packageMeta,
    toLockfile(input),
    input.target.platform,
  );
  const packages = [
    ...transitive.map((pkg) => ({ name: pkg.name, version: pkg.version, direct: false })),
    { name: intent.packageName, version: picked.version, direct: true },
  ];

  const bundle = await deps.packageBundle(intent.packageName, picked.version, picked.meta);
  const functions = resolveFunctions(bundle, input.target.platform);

  for (const name of Object.keys(functions)) {
    const existing = input.workbook.functions[name];
    if (existing && existing.origin.kind !== "package") {
      conflicts.push({
        id: `function-name-collision:${name}`,
        severity: "blocking",
        kind: "function-name-collision",
        functionName: name,
        packageName: intent.packageName,
        message: `${name} already exists as a ${existing.origin.kind} function.`,
        resolutions: [
          { id: "skip", label: `Do not install ${name}`, effect: "skip" },
          { id: "replace", label: `Replace existing ${name}`, effect: "replace" },
          { id: "abort", label: "Cancel install", effect: "abort" },
        ],
      });
    }
  }

  for (const capability of REQUIRED_WRITE_CAPABILITIES) {
    if (input.capabilities[capability].level === "unsupported") {
      diagnostics.push({
        severity: "error",
        code: "required-capability-unavailable",
        message: `${String(capability)} is required to install ${intent.packageName}.`,
        targetId: input.target.id,
        subject: { type: "capability", id: capability },
        suggestion: input.capabilities[capability].reason,
      });
      conflicts.push({
        id: `required-capability:${String(capability)}`,
        severity: "blocking",
        kind: "required-capability-unavailable",
        packageName: intent.packageName,
        message: `${String(capability)} is unavailable.`,
        resolutions: [{ id: "abort", label: "Cancel install", effect: "abort" }],
      });
    }
  }

  steps.push(
    {
      id: `download:${intent.packageName}`,
      kind: "download-artifact",
      label: `Download ${intent.packageName}@${picked.version}`,
      packageName: intent.packageName,
      capability: "readMetadata",
      reversible: true,
    },
    {
      id: `integrity:${intent.packageName}`,
      kind: "verify-integrity",
      label: `Verify ${intent.packageName}@${picked.version}`,
      packageName: intent.packageName,
      capability: "readMetadata",
      reversible: true,
    },
  );

  for (const name of Object.keys(functions)) {
    steps.push({
      id: `create-function:${name}`,
      kind: "create-function",
      label: `Create ${name}`,
      packageName: intent.packageName,
      functionName: name,
      capability: "createFunction",
      reversible: true,
    });
  }

  steps.push(
    {
      id: "write-project-metadata",
      kind: "write-project-metadata",
      label: `Record ${intent.packageName} as a direct dependency`,
      packageName: intent.packageName,
      capability: "writeMetadata",
      reversible: true,
    },
    {
      id: "write-lockfile",
      kind: "write-lockfile",
      label: "Write lockfile",
      packageName: intent.packageName,
      capability: "writeLockfile",
      reversible: true,
    },
    {
      id: `verify-function:${intent.packageName}`,
      kind: "verify-function",
      label: `Verify installed functions for ${intent.packageName}`,
      packageName: intent.packageName,
      capability: "listFunctions",
      reversible: true,
    },
    {
      id: "verify-lockfile",
      kind: "verify-lockfile",
      label: "Verify lockfile",
      packageName: intent.packageName,
      capability: "readLockfile",
      reversible: true,
    },
  );

  return buildPlan(input, intent, steps, conflicts, diagnostics, packages);
}

function buildPlan(
  input: ReconcileInput,
  intent: InstallPackageIntent,
  steps: PlanStep[],
  conflicts: PlanConflict[],
  diagnostics: Diagnostic[],
  packages: Array<{ name: string; version: string; direct: boolean }>,
): ChangePlan {
  const blockedBy = conflicts.filter((conflict) => conflict.severity === "blocking").map((c) => c.id);
  return {
    schemaVersion: RECONCILER_SCHEMA_VERSION,
    id: `install-package:${intent.packageName}:${intent.versionSpec ?? "latest"}`,
    kind: "install-package",
    target: input.target,
    title: `Install ${intent.packageName}`,
    summary: packages.length
      ? `Install ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}.`
      : `Install ${intent.packageName}.`,
    steps,
    conflicts,
    warnings: [],
    diagnostics,
    requiredCapabilities: REQUIRED_WRITE_CAPABILITIES.map((capability) => ({
      capability,
      minimum: "direct",
    })),
    preview: {
      packages,
      functions: steps
        .filter((step) => step.kind === "create-function" && step.functionName)
        .map((step) => ({ name: step.functionName!, action: "create" as const })),
    },
    applyPolicy: {
      applyable: blockedBy.length === 0,
      blockedBy,
      verification: "required",
    },
  };
}

function toLockfile(input: ReconcileInput) {
  return {
    packages: Object.fromEntries(
      Object.entries(input.lockfile.packages).map(([name, pkg]) => [
        name,
        {
          version: pkg.version,
          resolved: pkg.resolved,
          integrity: pkg.integrity,
          dependencies: pkg.dependencies,
          functions: pkg.functions,
        },
      ]),
    ),
  };
}
```

Modify `packages/core/src/reconciler/index.ts`:

```ts
export * from "./types.js";
export * from "./normalize.js";
export * from "./plan-install.js";
```

- [ ] **Step 4: Run install planner tests**

Run:

```bash
pnpm --filter @formulary/core test -- reconciler.plan-install.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all core tests**

Run:

```bash
pnpm --filter @formulary/core test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/reconciler/index.ts packages/core/src/reconciler/plan-install.ts packages/core/test/reconciler.plan-install.test.ts
git commit -m "feat(core): plan package installs"
```

## Task 4: Verify Build And Public API

**Files:**
- Modify only if verification reveals a missing export or type error.

- [ ] **Step 1: Build core**

Run:

```bash
pnpm --filter @formulary/core build
```

Expected: PASS and `packages/core/dist/reconciler/*` emitted.

- [ ] **Step 2: Run full workspace tests if dependencies are available**

Run:

```bash
pnpm test
```

Expected: PASS. If this fails because unrelated workspace packages lack dependencies or platform tools, record the exact failure and keep core verification as the gate.

- [ ] **Step 3: Inspect exports**

Run:

```bash
sed -n '1,260p' packages/core/src/index.ts
```

Expected: `export * from "./reconciler/index.js";` is present.

- [ ] **Step 4: Commit verification adjustments if needed**

If changes were needed:

```bash
git add packages/core/src/index.ts packages/core/src/reconciler
git commit -m "chore(core): expose reconciler api"
```

If no changes were needed, do not create an empty commit.

## Notes For Implementation

- This plan intentionally starts with a narrow install planner. Do not implement apply behavior yet.
- Do not edit CLI or Excel add-in flows in this slice.
- Do not introduce network fetching into the reconciler. Package metadata and bundles are injected.
- Do not include Google Sheets helper or Playwright concepts in core types.
- If `pnpm` cannot run because this clean worktree lacks dependencies, run `pnpm install` only after getting approval for network access if the sandbox blocks it.
