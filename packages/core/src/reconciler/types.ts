import type { Lockfile, NamedFunction, ProjectMetadata } from "../adapter.js";
import type { FunctionDef, PackageBundle, Platform } from "../manifest.js";
import type { PackageMeta, VersionMeta } from "../registry.js";

export type {
  Lockfile,
  NamedFunction,
  ProjectMetadata,
  FunctionDef,
  PackageBundle,
  Platform,
  PackageMeta,
  VersionMeta,
};

export const RECONCILER_SCHEMA_VERSION = 1;

export interface Versioned {
  schemaVersion: number;
}

export type SourceNamedFunction = NamedFunction;
export type SourceFunctionDef = FunctionDef;

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
  | {
      kind: "package";
      packageName: string;
      version: string;
      integrity?: string;
    }
  | {
      kind: "modified-package";
      packageName: string;
      version: string;
      integrity?: string;
    }
  | { kind: "unknown" };

export interface ProjectState extends Versioned {
  initialized: boolean;
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  owners: string[];
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
  acceptableLevels: Exclude<CapabilityLevel, "unsupported">[];
}

export interface PlanPreview {
  packages: Array<{
    name: string;
    version: string;
    direct: boolean;
  }>;
  functions: Array<{
    name: string;
    action: "create" | "update" | "delete" | "keep";
  }>;
}

export interface ApplyPolicy {
  applicable: boolean;
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
  packageBundle: (
    name: string,
    version: string,
    meta: VersionMeta,
  ) => Promise<PackageBundle>;
}
